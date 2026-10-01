import { db } from "./db.js";
import { redis } from "./queue.js";
import { retryDelaySeconds } from "./job-utils.js";

export { retryDelaySeconds } from "./job-utils.js";

export async function createJob(
  jobType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
  options: { forceRequeue?: boolean } = {}
) {
  const dedupeKey = `${jobType}:${aggregateId}`;
  const result = await db.query(
    `INSERT INTO jobs(job_type, aggregate_type, aggregate_id, dedupe_key, payload)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       payload=EXCLUDED.payload,
       status=CASE WHEN $6 OR jobs.status IN ('failed','dead_letter') THEN 'queued' ELSE jobs.status END,
       attempts=CASE WHEN $6 THEN 0 ELSE jobs.attempts END,
       available_at=CASE WHEN $6 OR jobs.status IN ('failed','dead_letter') THEN NOW() ELSE jobs.available_at END,
       last_error=CASE WHEN $6 OR jobs.status IN ('failed','dead_letter') THEN NULL ELSE jobs.last_error END,
       finished_at=CASE WHEN $6 OR jobs.status IN ('failed','dead_letter') THEN NULL ELSE jobs.finished_at END,
       updated_at=NOW()
     RETURNING id`,
    [jobType, aggregateType, aggregateId, dedupeKey, payload, options.forceRequeue === true]
  );
  const jobId = result.rows[0].id;
  await redis.lpush("analog:jobs", JSON.stringify({
    jobId,
    type: jobType,
    ...(typeof payload.eventId === "string" ? { eventId: payload.eventId } : {})
  }));
  return jobId;
}
