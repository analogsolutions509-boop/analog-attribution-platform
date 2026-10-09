import "dotenv/config";
import { db } from "./db.js";
import { redis, closeQueue } from "./queue.js";
import { createJob, retryDelaySeconds } from "./jobs.js";
import { archiveRecording, completeTranscript } from "./calls.js";
import { downloadRecording, extensionForMimeType } from "./call-recording.js";
import { transcribeBytes } from "./call-intelligence/transcribe.js";
import { deliverAnalogOSEvent } from "./analog-os.js";
import { markAnalogOSEventAttempt, markAnalogOSEventSent, recoverAnalogOSEvents } from "./analog-os-outbox.js";
import { config } from "./config.js";
import { createLead } from "./leads.js";
import { normalizeCollectorEventLead } from "./collector-event-lead.js";
import { collectorEventQuery } from "./collector-event-query.js";
import { isRecoverableCollectorEventSchemaMismatch } from "./collector-event-recovery.js";
import { deliverNotification, queueNotification } from "./notifications.js";
import {
  ensureDailyAnalogOSReconciliationJob,
  reconcileAnalogOSDate
} from "./analog-os-reconciliation.js";

type JobEnvelope = {
  jobId?: string;
  type?: string;
  eventId?: string;
};

async function claimJob(id: string) {
  const result = await db.query(
    `UPDATE jobs
     SET status='processing', attempts=attempts+1, started_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND status IN ('queued','failed') AND attempts < max_attempts
     RETURNING attempts,max_attempts`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function finishJob(id: string) {
  await db.query(
    "UPDATE jobs SET status='completed', finished_at=NOW(), updated_at=NOW() WHERE id=$1",
    [id]
  );
}

async function failJob(id: string, error: string) {
  const job = await db.query("SELECT attempts,max_attempts FROM jobs WHERE id=$1", [id]);
  if (!job.rowCount) return;
  const { attempts, max_attempts: maxAttempts } = job.rows[0];
  const deadLetter = attempts >= maxAttempts;
  const delaySeconds = retryDelaySeconds(attempts);
  await db.query(
    `UPDATE jobs
     SET status=$2,
         last_error=$3,
         available_at=CASE WHEN $2='dead_letter' THEN available_at ELSE NOW() + ($4 * INTERVAL '1 second') END,
         started_at=NULL,
         finished_at=CASE WHEN $2='dead_letter' THEN NOW() ELSE NULL END,
         updated_at=NOW()
     WHERE id=$1`,
    [id, deadLetter ? "dead_letter" : "failed", error, delaySeconds]
  );
}

async function recoverJobs(): Promise<void> {
  const stale = await db.query(
    `UPDATE jobs
     SET status='queued', last_error='worker_lease_expired', started_at=NULL, available_at=NOW(), updated_at=NOW()
     WHERE status='processing' AND started_at < NOW() - INTERVAL '15 minutes'
     RETURNING id,job_type,payload`
  );
  const retryable = await db.query(
    `UPDATE jobs
     SET status='queued', updated_at=NOW()
     WHERE status='failed' AND attempts < max_attempts AND available_at <= NOW()
     RETURNING id,job_type,payload`
  );
  for (const job of [...stale.rows, ...retryable.rows]) {
    await redis.lpush("analog:jobs", JSON.stringify({
      jobId: job.id,
      type: job.job_type,
      ...(typeof job.payload?.eventId === "string" ? { eventId: job.payload.eventId } : {})
    }));
  }
}

async function processEvent(eventId: string) {
  const result = await db.query(
    collectorEventQuery,
    [eventId]
  );
  if (!result.rowCount) throw new Error("event_not_found");
  const event = result.rows[0];

  if (event.event_name !== "form_submit" && event.event_name !== "lead_submit") {
    return event;
  }

  const payload = event.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : {};
  const lead = normalizeCollectorEventLead(payload);
  if (!lead) return event;

  // Lead creation and notification queueing are idempotent across worker retries.
  const leadId = await createLead({
    siteId: event.site_id,
    visitorId: event.visitor_id,
    sessionId: event.session_id,
    source: "website_form",
    customerName: lead.customerName,
    companyName: lead.companyName,
    customerPhone: lead.customerPhone,
    customerEmail: lead.customerEmail,
    serviceType: lead.serviceType,
    requirements: lead.requirements,
    summary: lead.summary,
    sourceDetail: {
      event_key: event.event_key,
      event_id: event.id,
      page_url: event.page_url,
      page_path: event.page_path,
      occurred_at: event.occurred_at,
      utm_source: event.utm_source,
      utm_campaign: event.utm_campaign,
      capture_path: "worker_repairable_event"
    }
  });

  await Promise.all([
    queueNotification({leadId,recipientType:"internal",channel:"email"}),
    queueNotification({leadId,recipientType:"supplier",channel:"email"})
  ]);

  return event;
}

async function processAnalogOSEvent(outboxId: string) {
  const result = await db.query(
    "SELECT id,payload,status FROM analog_os_outbox WHERE id=$1",
    [outboxId]
  );
  if (!result.rowCount) throw new Error("analog_os_event_not_found");
  const event = result.rows[0];
  if (event.status === "sent") return;
  try {
    await deliverAnalogOSEvent(event.payload);
    await markAnalogOSEventSent(outboxId);
  } catch (error) {
    await markAnalogOSEventAttempt(outboxId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function recoverMissingCollectorLeadJobs(limit = 25): Promise<number> {
  const result = await db.query(
    `SELECT e.id
     FROM events e
     WHERE e.event_name IN ('form_submit','lead_submit')
       AND e.occurred_at >= NOW() - INTERVAL '30 days'
       AND NULLIF(BTRIM(COALESCE(
         e.payload->>'customer_phone',
         e.payload->>'phone',
         e.payload->>'customer_email',
         e.payload->>'email'
       )), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM leads l
         WHERE l.site_id=e.site_id
           AND l.source_detail->>'event_key'=e.event_key
       )
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.dedupe_key='event.process:' || e.id::text
           AND j.status IN ('queued','processing','failed')
       )
     ORDER BY e.occurred_at ASC
     LIMIT $1`,
    [limit]
  );

  for (const row of result.rows) {
    await createJob(
      "event.process",
      "event",
      row.id,
      { eventId: row.id },
      { forceRequeue: true }
    );
  }
  return result.rowCount ?? 0;
}

async function recoverDeadLetterCollectorEventJobs(limit = 25): Promise<number> {
  const result = await db.query(
    `SELECT id,job_type,status,aggregate_id,last_error
     FROM jobs
     WHERE job_type='event.process'
       AND status='dead_letter'
       AND (
         last_error ILIKE '%utm_source%does not exist%'
         OR last_error ILIKE '%utm_campaign%does not exist%'
       )
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit]
  );

  let recovered = 0;
  for (const row of result.rows) {
    if (!isRecoverableCollectorEventSchemaMismatch(
      String(row.job_type ?? "event.process"),
      String(row.status ?? "dead_letter"),
      String(row.last_error ?? "")
    )) continue;

    const eventId = String(row.aggregate_id);
    await createJob(
      "event.process",
      "event",
      eventId,
      { eventId },
      { forceRequeue: true }
    );
    recovered++;
  }
  return recovered;
}

async function processCall(callId: string) {
  const result = await db.query(
    "SELECT provider, recording_source_url, recording_mime_type FROM calls WHERE id=$1",
    [callId]
  );
  if (!result.rowCount) throw new Error("call_not_found");
  const call = result.rows[0];
  if (!call.recording_source_url) throw new Error("recording_source_url_missing");

  const recordingAuth = call.provider === "twilio" && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
    ? { username: config.TWILIO_ACCOUNT_SID, password: config.TWILIO_AUTH_TOKEN }
    : undefined;
  const recording = await downloadRecording(call.recording_source_url, 20_000, recordingAuth);
  const mimeType = call.recording_mime_type ?? recording.mimeType;
  const key = await archiveRecording(
    callId,
    recording.bytes,
    mimeType,
    extensionForMimeType(mimeType)
  );
  await db.query(
    "UPDATE calls SET recording_status='stored', recording_storage_key=$2, recording_mime_type=$3, updated_at=NOW() WHERE id=$1",
    [callId, key, mimeType]
  );

  const transcript = await transcribeBytes(recording.bytes, mimeType);
  await completeTranscript(callId, transcript, process.env.OPENAI_API_KEY ?? "");
}

async function handle(job: JobEnvelope) {
  if (job.type === "analog.os.reconcile" && job.jobId) {
    const result = await db.query("SELECT aggregate_id FROM jobs WHERE id=$1", [job.jobId]);
    if (!result.rowCount) throw new Error("job_not_found");
    await reconcileAnalogOSDate(result.rows[0].aggregate_id);
    return;
  }
  if (job.type === "analog.os.sync" && job.jobId) {
    const result = await db.query("SELECT aggregate_id FROM jobs WHERE id=$1", [job.jobId]);
    if (!result.rowCount) throw new Error("job_not_found");
    await processAnalogOSEvent(result.rows[0].aggregate_id);
    return;
  }
  if (job.type === "event.process" && job.eventId) {
    await processEvent(job.eventId);
    return;
  }
  if (job.type === "call.process" && job.jobId) {
    const result = await db.query("SELECT aggregate_id FROM jobs WHERE id=$1", [job.jobId]);
    if (!result.rowCount) throw new Error("job_not_found");
    await processCall(result.rows[0].aggregate_id);
    return;
  }
  if (job.type === "notification.send" && job.jobId) {
    const result = await db.query("SELECT aggregate_id FROM jobs WHERE id=$1", [job.jobId]);
    if (!result.rowCount) throw new Error("job_not_found");
    await deliverNotification(result.rows[0].aggregate_id);
    return;
  }
  throw new Error("unsupported_job");
}

let stopping = false;
let lastDailyReconciliationCheckAt = 0;
let lastCollectorEventRepairCheckAt = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  await recoverJobs();
  await recoverAnalogOSEvents().catch(() => undefined);
  if (Date.now() - lastCollectorEventRepairCheckAt >= 60_000) {
    lastCollectorEventRepairCheckAt = Date.now();
    await recoverDeadLetterCollectorEventJobs(25).catch(() => undefined);
    await recoverMissingCollectorLeadJobs(25).catch(() => undefined);
  }
  if (Date.now() - lastDailyReconciliationCheckAt >= 60_000) {
    lastDailyReconciliationCheckAt = Date.now();
    await ensureDailyAnalogOSReconciliationJob(createJob).catch(() => undefined);
  }
  const result = await redis.brpop("analog:jobs", 5);
  if (!result) continue;
  const payload = JSON.parse(result[1]) as JobEnvelope;
  if (!payload.jobId) continue;

  const claimed = await claimJob(payload.jobId);
  if (!claimed) continue;

  try {
    await handle(payload);
    await finishJob(payload.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(payload.jobId, message);
  }
}

await closeQueue();
await db.end();
