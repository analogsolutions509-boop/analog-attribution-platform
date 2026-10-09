import { db } from "./db.js";
import { enqueueEvent } from "./queue.js";
import { eventSchema, type CollectorEvent } from "./event-schema.js";
// Form leads are materialized by the worker so transient DB or outbox failures are retryable.

export { eventSchema };

export async function ingestEvent(siteId: string, input: CollectorEvent) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const visitor = await client.query(
      "INSERT INTO visitors(site_id, visitor_key) VALUES($1,$2) ON CONFLICT(site_id, visitor_key) DO UPDATE SET last_seen_at=NOW() RETURNING id",
      [siteId, input.visitor_key]
    );
    const visitorId = visitor.rows[0].id;
    const session = await client.query(
      "INSERT INTO sessions(site_id, visitor_id, session_key, started_at, last_seen_at, landing_path, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content) VALUES($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(site_id, session_key) DO UPDATE SET last_seen_at=NOW() RETURNING id",
      [siteId, visitorId, input.session_key, input.occurred_at, input.page_path ?? null, input.referrer ?? null, input.utm_source ?? null, input.utm_medium ?? null, input.utm_campaign ?? null, input.utm_term ?? null, input.utm_content ?? null]
    );
    const sessionId = session.rows[0].id;
    const event = await client.query(
      "INSERT INTO events(site_id, visitor_id, session_id, event_key, event_name, occurred_at, page_url, page_path, payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(site_id,event_key) DO NOTHING RETURNING id",
      [siteId, visitorId, sessionId, input.event_key, input.event_name, input.occurred_at, input.page_url ?? null, input.page_path ?? null, input.payload]
    );
    const inserted = Boolean(event.rows[0]?.id);
    let eventId = event.rows[0]?.id ?? null;
    if (!eventId) {
      const existing = await client.query(
        "SELECT id FROM events WHERE site_id=$1 AND event_key=$2 LIMIT 1",
        [siteId, input.event_key]
      );
      eventId = existing.rows[0]?.id ?? null;
    }
    await client.query("COMMIT");

    // Queue even a duplicate key: this repairs an event whose previous enqueue failed.
    // The job's dedupe key keeps the event idempotent across retries.
    if (eventId) await enqueueEvent(eventId);
    return { inserted, eventId, visitorId, sessionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
