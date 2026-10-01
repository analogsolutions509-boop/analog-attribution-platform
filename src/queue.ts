import { Redis } from "ioredis";
import { config } from "./config.js";
import { db } from "./db.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

export async function enqueueEvent(eventId: string): Promise<void> {
  const dedupeKey = `event:${eventId}`;
  const result = await db.query(
    "INSERT INTO jobs(job_type, aggregate_type, aggregate_id, dedupe_key, payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET updated_at=NOW() RETURNING id",
    ["event.process", "event", eventId, dedupeKey, { eventId }]
  );
  await redis.lpush("analog:jobs", JSON.stringify({
    jobId: result.rows[0].id,
    type: "event.process",
    eventId
  }));
}

export async function closeQueue(): Promise<void> {
  await redis.quit();
}
