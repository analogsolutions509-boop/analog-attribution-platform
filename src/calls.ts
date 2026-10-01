import { createHash } from "node:crypto";
import { db } from "./db.js";
import { uploadRecording } from "./storage/r2.js";
import { analyzeTranscript } from "./call-intelligence/analyze.js";
import { transcribeFile } from "./call-intelligence/transcribe.js";

export type IncomingCall = {
  siteId: string;
  provider: string;
  providerCallId: string;
  callerNumber?: string;
  calledNumber?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
};

export async function upsertIncomingCall(input: IncomingCall): Promise<string> {
  const result = await db.query(
    `INSERT INTO calls(
      site_id, provider, provider_call_id, caller_number, called_number, direction,
      started_at, ended_at, duration_seconds
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT(provider, provider_call_id) DO UPDATE SET
      caller_number=COALESCE(EXCLUDED.caller_number,calls.caller_number),
      called_number=COALESCE(EXCLUDED.called_number,calls.called_number),
      direction=COALESCE(EXCLUDED.direction,calls.direction),
      started_at=COALESCE(EXCLUDED.started_at,calls.started_at),
      ended_at=COALESCE(EXCLUDED.ended_at,calls.ended_at),
      duration_seconds=COALESCE(EXCLUDED.duration_seconds,calls.duration_seconds),
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
      input.durationSeconds ?? null
    ]
  );
  return result.rows[0].id as string;
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
    ) VALUES($1,'openai',$2,NULL,'complete',$3,$4,NOW())
    ON CONFLICT(call_id) DO UPDATE SET
      model=EXCLUDED.model,
      status='complete',
      full_text=EXCLUDED.full_text,
      duration_seconds=EXCLUDED.duration_seconds,
      completed_at=NOW()
    RETURNING id`,
    [callId, process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-transcribe", transcript.text, transcript.duration]
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
}
