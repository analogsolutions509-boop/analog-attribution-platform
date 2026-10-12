import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every inbound call can produce a call-linked lead and provider retries reuse it", async () => {
  const leads = await readFile(new URL("../src/leads.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../migrations/020_call_routing_reliability.sql", import.meta.url), "utf8");
  assert.match(leads, /source_detail->>'call_id'/);
  assert.match(leads, /source: "phone_call"/);
  assert.match(leads, /tracking_number_site/);
  assert.match(leads, /ON CONFLICT DO NOTHING/);
  assert.match(migration, /idx_leads_site_call_id/);
});

test("supplier notifications include the transcript but omit caller contact details", async () => {
  const source = await readFile(new URL("../src/notifications.ts", import.meta.url), "utf8");
  assert.match(source, /caller_phone:input\.recipientType==="internal" \? row\.customer_phone/);
  assert.match(source, /caller_email:input\.recipientType==="internal" \? row\.customer_email/);
  assert.match(source, /transcript:call\?\.full_text \?\? null/);
});
