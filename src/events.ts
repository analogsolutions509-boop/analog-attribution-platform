import { db } from "./db.js";
import { enqueueEvent } from "./queue.js";
import { eventSchema, type CollectorEvent } from "./event-schema.js";
import { createLead } from "./leads.js";

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
    await client.query("COMMIT");
    const eventId = event.rows[0]?.id ?? null;
    if (eventId) await enqueueEvent(eventId);
    const payload = input.payload as Record<string, unknown>;
    const phone = typeof payload.phone === "string" ? payload.phone : typeof payload.customer_phone === "string" ? payload.customer_phone : undefined;
    const email = typeof payload.email === "string" ? payload.email : typeof payload.customer_email === "string" ? payload.customer_email : undefined;
    if (eventId && (input.event_name === "lead_submit" || input.event_name === "form_submit") && (phone || email)) {
      await createLead({
        siteId, visitorId, sessionId, source: "website_form",
        customerName: typeof payload.name === "string" ? payload.name : undefined,
        companyName: typeof payload.company_name === "string" ? payload.company_name : undefined,
        customerPhone: phone, customerEmail: email,
        serviceType: typeof payload.service_type === "string" ? payload.service_type : undefined,
        requirements: typeof payload.requirements === "object" && payload.requirements ? payload.requirements as Record<string, unknown> : {},
        summary: typeof payload.message === "string" ? payload.message : undefined,
        sourceDetail: { event_key: input.event_key, page_url: input.page_url, utm_source: input.utm_source, utm_campaign: input.utm_campaign }
      });
    }
    return { inserted: Boolean(eventId), eventId, visitorId, sessionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
