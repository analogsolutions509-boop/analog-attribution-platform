import { db } from "./db.js";
import { createJob } from "./jobs.js";
import { buildAnalogOSEvent } from "./analog-os-events.js";
import { shouldRecoverAnalogOSEvent } from "./analog-os-recovery-policy.js";

export async function queueAnalogOSEvent(
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  data: unknown
): Promise<string> {
  const event = buildAnalogOSEvent(eventType, aggregateType, aggregateId, data);
  const result = await db.query(
    `INSERT INTO analog_os_outbox(event_type,aggregate_type,aggregate_id,payload)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [event.type, event.aggregate_type, event.aggregate_id, event]
  );
  const outboxId = result.rows[0].id as string;
  await createJob("analog.os.sync", "analog_os_event", outboxId);
  return outboxId;
}

export async function markAnalogOSEventSent(id: string): Promise<void> {
  await db.query(
    `UPDATE analog_os_outbox SET status='sent', sent_at=NOW(), last_error=NULL,
     updated_at=NOW() WHERE id=$1`,
    [id]
  );
}

export async function markAnalogOSEventAttempt(id: string, error: string): Promise<void> {
  await db.query(
    `UPDATE analog_os_outbox SET attempts=attempts+1,last_error=$2,updated_at=NOW()
     WHERE id=$1`,
    [id, error]
  );
}

export async function recoverAnalogOSEvents(limit = 25): Promise<number> {
  const result = await db.query(
    `SELECT o.id,o.status AS outbox_status,
            j.status AS job_status,j.attempts,j.max_attempts,
            j.available_at,j.updated_at AS job_updated_at
     FROM analog_os_outbox o
     LEFT JOIN jobs j ON j.dedupe_key='analog.os.sync:' || o.id::text
     WHERE o.status='queued'
       AND (
         j.id IS NULL
         OR j.status='completed'
         OR (j.status='failed' AND j.attempts<j.max_attempts AND COALESCE(j.available_at,NOW())<=NOW())
         OR (
           (j.status='dead_letter' OR (j.status='failed' AND j.attempts>=j.max_attempts))
           AND j.updated_at<=NOW()-INTERVAL '1 hour'
         )
       )
     ORDER BY o.created_at ASC
     LIMIT $1`,
    [limit]
  );

  let recovered = 0;
  for (const row of result.rows) {
    const job = row.job_status ? {
      status: String(row.job_status),
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      updatedAt: row.job_updated_at
    } : null;

    if (!shouldRecoverAnalogOSEvent(String(row.outbox_status), job)) continue;

    const attempts = Number(row.attempts ?? 0);
    const maxAttempts = Number(row.max_attempts ?? 0);
    const forceRequeue = row.job_status === "completed"
      || row.job_status === "dead_letter"
      || (row.job_status === "failed" && attempts >= maxAttempts);

    await createJob("analog.os.sync", "analog_os_event", row.id, {}, { forceRequeue });
    recovered++;
  }
  return recovered;
}
