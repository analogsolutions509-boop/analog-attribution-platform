import { db } from "./db.js";
import { createJob } from "./jobs.js";
import { buildAnalogOSEvent } from "./analog-os-events.js";

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
    `SELECT o.id FROM analog_os_outbox o
     WHERE o.status='queued'
       AND NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.dedupe_key='analog.os.sync:' || o.id::text
       )
     ORDER BY o.created_at ASC LIMIT $1`,
    [limit]
  );
  for (const row of result.rows) {
    await createJob("analog.os.sync", "analog_os_event", row.id);
  }
  return result.rowCount ?? 0;
}
