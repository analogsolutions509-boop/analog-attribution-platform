import { db } from "./db.js";
import { redis } from "./queue.js";

export async function createJob(
  jobType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {}
) {
  const dedupeKey = `${jobType}:${aggregateId}`;
  const result = await db.query(
    "INSERT INTO jobs(job_type, aggregate_type, aggregate_id, dedupe_key, payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET updated_at=NOW() RETURNING id",
    [jobType, aggregateType, aggregateId, dedupeKey, payload]
  );
  const jobId = result.rows[0].id;
  await redis.lpush("analog:jobs", jobId);
  return jobId;
}
