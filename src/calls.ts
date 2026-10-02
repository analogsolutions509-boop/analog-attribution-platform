import { createHash } from "node:crypto";
import { db } from "./db.js";
import { uploadRecording } from "./storage/r2.js";
import { analyzeTranscript } from "./call-intelligence/analyze.js";
import { transcribeFile } from "./call-intelligence/transcribe.js";
import { queueAnalogOSEvent } from "./analog-os-outbox.js";
import { queueNotification } from "./notifications.js";
import { normalizePhone } from "./utils/phone.js";

export async function resolveCallNumberRoute(siteId: string, calledNumber?: string) {
  const normalized = normalizePhone(calledNumber);
  if (!normalized) return null;
  const result = await db.query(
    `SELECT tn.id AS tracking_number_id,
            tn.phone_number AS tracking_number,
            tn.forwarding_number_id,
            fn.phone_number AS forwarding_number,
            COALESCE(NULLIF(s.contact_phone,''),NULLIF(s.endpoint_url,'')) AS destination_number
     FROM tracking_numbers tn
     LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id
     LEFT JOIN suppliers s ON s.id=tn.destination_supplier_id
     WHERE tn.site_id=$1
       AND regexp_replace(tn.phone_number,'\\D','','g')=$2
     LIMIT 1`,
    [siteId, normalized]
  );
  return result.rows[0] ?? null;
}

export type IncomingCall = {
  siteId: string;
  siteName?: string;
  hostname?: string;
  provider: string;
  providerCallId: string;
  callerNumber?: string;
  calledNumber?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  recordingMimeType?: string;
};

export async function upsertIncomingCall(input: IncomingCall): Promise<string> {
  const route = input.direction?.toLowerCase() === "outbound"
    ? null
    : await resolveCallNumberRoute(input.siteId, input.calledNumber);
  const result = await db.query(
    `INSERT INTO calls(
      site_id, provider, provider_call_id, caller_number, called_number, direction,
      started_at, ended_at, duration_seconds, recording_source_url, recording_mime_type,
      tracking_number_id, forwarding_number_id, tracking_number, forwarding_number, destination_number
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT(provider, provider_call_id) DO UPDATE SET
      caller_number=COALESCE(EXCLUDED.caller_number,calls.caller_number),
      called_number=COALESCE(EXCLUDED.called_number,calls.called_number),
      direction=COALESCE(EXCLUDED.direction,calls.direction),
      started_at=COALESCE(EXCLUDED.started_at,calls.started_at),
      ended_at=COALESCE(EXCLUDED.ended_at,calls.ended_at),
      duration_seconds=COALESCE(EXCLUDED.duration_seconds,calls.duration_seconds),
      recording_source_url=COALESCE(EXCLUDED.recording_source_url,calls.recording_source_url),
      recording_mime_type=COALESCE(EXCLUDED.recording_mime_type,calls.recording_mime_type),
      tracking_number_id=COALESCE(EXCLUDED.tracking_number_id,calls.tracking_number_id),
      forwarding_number_id=COALESCE(EXCLUDED.forwarding_number_id,calls.forwarding_number_id),
      tracking_number=COALESCE(EXCLUDED.tracking_number,calls.tracking_number),
      forwarding_number=COALESCE(EXCLUDED.forwarding_number,calls.forwarding_number),
      destination_number=COALESCE(EXCLUDED.destination_number,calls.destination_number),
      updated_at=NOW()
    RETURNING id`,
    [
      input.siteId,
      input.provider,
      input.providerCallId,
      input.callerNumber ?? null,
      input.calledNumber ?? null,
      input.direction ?? null,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.durationSeconds ?? null,
      input.recordingUrl ?? null,
      input.recordingMimeType ?? null,
      route?.tracking_number_id ?? null,
      route?.forwarding_number_id ?? null,
      route?.tracking_number ?? input.calledNumber ?? null,
      route?.forwarding_number ?? null,
      route?.destination_number ?? null
    ]
  );
  const callId = result.rows[0].id as string;
  await queueAnalogOSEvent("call.created", "call", callId, {
    call_id: callId,
    site_id: input.siteId,
    site_name: input.siteName ?? null,
    hostname: input.hostname ?? null,
    provider: input.provider,
    provider_call_id: input.providerCallId,
    caller_number: input.callerNumber ?? null,
    called_number: input.calledNumber ?? null,
    tracking_number: route?.tracking_number ?? input.calledNumber ?? null,
    forwarding_number: route?.forwarding_number ?? null,
    destination_number: route?.destination_number ?? null,
    tracking_number_id: route?.tracking_number_id ?? null,
    forwarding_number_id: route?.forwarding_number_id ?? null,
    direction: input.direction ?? null,
    started_at: input.startedAt ?? null,
    ended_at: input.endedAt ?? null,
    duration_seconds: input.durationSeconds ?? null,
    recording_url: input.recordingUrl ?? null
  });
  return callId;
}

export async function attachRecording(callId: string, recordingUrl: string, mimeType?: string): Promise<void> {
  await db.query(
    "UPDATE calls SET recording_source_url=$2, recording_mime_type=COALESCE($3,recording_mime_type), recording_status='ready', updated_at=NOW() WHERE id=$1",
    [callId, recordingUrl, mimeType ?? null]
  );
  await queueAnalogOSEvent("recording.ready", "call", callId, {
    call_id: callId, recording_url: recordingUrl, recording_mime_type: mimeType ?? null
  });
}

export async function archiveRecording(
  callId: string,
  bytes: Uint8Array,
  mimeType: string,
  extension: string
): Promise<string> {
  const call = await db.query("SELECT site_id FROM calls WHERE id=$1", [callId]);
  if (!call.rowCount) throw new Error("call_not_found");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `recordings/${new Date().getUTCFullYear()}/${call.rows[0].site_id}/${callId}.${extension}`;
  await uploadRecording(key, bytes, mimeType);
  await db.query(
    `INSERT INTO recording_assets(
      call_id, storage_provider, bucket, object_key, mime_type, size_bytes, sha256, status
    ) VALUES($1,'cloudflare_r2',$2,$3,$4,$5,$6,'stored')
    ON CONFLICT(object_key) DO UPDATE SET
      size_bytes=EXCLUDED.size_bytes,
      sha256=EXCLUDED.sha256,
      status='stored',
      updated_at=NOW()`,
    [callId, process.env.R2_BUCKET ?? "analog-call-recordings", key, mimeType, bytes.byteLength, hash]
  );
  await db.query(
    "UPDATE calls SET recording_status='stored', recording_storage_key=$2, recording_sha256=$3, updated_at=NOW() WHERE id=$1",
    [callId, key, hash]
  );
  await queueAnalogOSEvent("recording.archived", "call", callId, {
    call_id: callId, storage_key: key, mime_type: mimeType, size_bytes: bytes.byteLength, sha256: hash
  });
  return key;
}

export async function completeTranscript(
  callId: string,
  transcript: Awaited<ReturnType<typeof transcribeFile>>,
  apiKey: string
): Promise<void> {
  const tx = await db.query(
    `INSERT INTO call_transcripts(
      call_id, provider, model, language, status, full_text, duration_seconds, completed_at
    ) VALUES($1,$2,$3,NULL,'complete',$4,$5,NOW())
    ON CONFLICT(call_id) DO UPDATE SET
      model=EXCLUDED.model,
      status='complete',
      full_text=EXCLUDED.full_text,
      duration_seconds=EXCLUDED.duration_seconds,
      completed_at=NOW()
    RETURNING id`,
    [callId, transcript.provider, transcript.model, transcript.text, transcript.duration]
  );
  const transcriptId = tx.rows[0].id as string;
  await db.query("DELETE FROM transcript_segments WHERE transcript_id=$1", [transcriptId]);
  for (let i = 0; i < transcript.segments.length; i++) {
    const segment = transcript.segments[i];
    await db.query(
      `INSERT INTO transcript_segments(
        transcript_id, segment_index, speaker_label, start_seconds, end_seconds, text
      ) VALUES($1,$2,$3,$4,$5,$6)`,
      [transcriptId, i, segment.speaker, segment.start, segment.end, segment.text]
    );
  }

  await queueAnalogOSEvent("transcript.completed", "call", callId, {
    call_id: callId, transcript_id: transcriptId, provider: transcript.provider,
    model: transcript.model, duration_seconds: transcript.duration
  });

  if (!apiKey) return;
  const intelligence = await analyzeTranscript(transcript.text, apiKey);
  await db.query(
    `INSERT INTO call_intelligence(
      call_id, model, summary, customer_name, company_name, customer_email, customer_phone,
      intent, lead_type, buying_stage, urgency, sentiment, outcome, next_action,
      objections, questions, commitments, topics, construction_requirements, confidence, raw_output
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    ON CONFLICT(call_id) DO UPDATE SET
      model=EXCLUDED.model,
      summary=EXCLUDED.summary,
      customer_name=EXCLUDED.customer_name,
      company_name=EXCLUDED.company_name,
      customer_email=EXCLUDED.customer_email,
      customer_phone=EXCLUDED.customer_phone,
      intent=EXCLUDED.intent,
      lead_type=EXCLUDED.lead_type,
      buying_stage=EXCLUDED.buying_stage,
      urgency=EXCLUDED.urgency,
      sentiment=EXCLUDED.sentiment,
      outcome=EXCLUDED.outcome,
      next_action=EXCLUDED.next_action,
      objections=EXCLUDED.objections,
      questions=EXCLUDED.questions,
      commitments=EXCLUDED.commitments,
      topics=EXCLUDED.topics,
      construction_requirements=EXCLUDED.construction_requirements,
      confidence=EXCLUDED.confidence,
      raw_output=EXCLUDED.raw_output,
      updated_at=NOW()`,
    [
      callId,
      process.env.OPENAI_INTELLIGENCE_MODEL ?? "gpt-5.6-luna",
      intelligence.summary,
      intelligence.customer_name,
      intelligence.company_name,
      intelligence.customer_email,
      intelligence.customer_phone,
      intelligence.intent,
      intelligence.lead_type,
      intelligence.buying_stage,
      intelligence.urgency,
      intelligence.sentiment,
      intelligence.outcome,
      intelligence.next_action,
      intelligence.objections,
      intelligence.questions,
      intelligence.commitments,
      intelligence.topics,
      intelligence.construction_requirements,
      intelligence.confidence,
      intelligence
    ]
  );

  await db.query("DELETE FROM call_extracted_fields WHERE call_id=$1", [callId]);
  for (const field of intelligence.extracted_fields) {
    await db.query(
      `INSERT INTO call_extracted_fields(
        call_id, field_key, field_group, normalized_value, display_value, confidence,
        evidence_start_seconds, evidence_end_seconds, evidence_text, source_type
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        callId,
        field.field_key,
        field.field_group,
        field.normalized_value,
        field.display_value,
        field.confidence,
        field.evidence_start_seconds,
        field.evidence_end_seconds,
        field.evidence_text,
        field.source_type
      ]
    );
  }

  await db.query(
    "UPDATE calls SET transcript_status='complete', transcript_text=$2, transcript_segments=$3, intelligence=$4, updated_at=NOW() WHERE id=$1",
    [callId, transcript.text, transcript.segments, intelligence]
  );
  await queueAnalogOSEvent("call.intelligence.completed", "call", callId, {
    call_id: callId, transcript_id: transcriptId, intelligence
  });
  const lead = await db.query("SELECT lead_id FROM calls WHERE id=$1", [callId]);
  const leadId = lead.rows[0]?.lead_id as string | undefined;
  if (leadId) {
    await Promise.all([
      queueNotification({leadId, callId, recipientType:"internal", channel:"email"}),
      queueNotification({leadId, callId, recipientType:"supplier", channel:"email"}),
      queueNotification({leadId, callId, recipientType:"supplier", channel:"sms"})
    ]);
  }
}
