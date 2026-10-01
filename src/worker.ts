import "dotenv/config";
import { db } from "./db.js";
import { redis, closeQueue } from "./queue.js";
import { archiveRecording, completeTranscript } from "./calls.js";
import { downloadRecording, extensionForMimeType } from "./call-recording.js";
import { transcribeBytes } from "./call-intelligence/transcribe.js";

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
  const status = job.rowCount && job.rows[0].attempts >= job.rows[0].max_attempts
    ? "dead_letter"
    : "failed";
  await db.query(
    "UPDATE jobs SET status=$2, last_error=$3, finished_at=CASE WHEN $2='dead_letter' THEN NOW() ELSE NULL END, updated_at=NOW() WHERE id=$1",
    [id, status, error]
  );
}

async function processEvent(eventId: string) {
  const result = await db.query(
    "SELECT id,event_name,payload FROM events WHERE id=$1",
    [eventId]
  );
  if (!result.rowCount) throw new Error("event_not_found");
  return result.rows[0];
}

async function processCall(callId: string) {
  const result = await db.query(
    "SELECT recording_source_url, recording_mime_type FROM calls WHERE id=$1",
    [callId]
  );
  if (!result.rowCount) throw new Error("call_not_found");
  const call = result.rows[0];
  if (!call.recording_source_url) throw new Error("recording_source_url_missing");

  const recording = await downloadRecording(call.recording_source_url);
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
  throw new Error("unsupported_job");
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
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
