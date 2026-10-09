import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCollectorEventLead } from "../src/collector-event-lead.ts";

test("collector form events are queued and leads are materialized by the retryable worker", async () => {
  const eventsSource = await readFile(new URL("../src/events.ts", import.meta.url), "utf8");
  const workerSource = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");

  assert.match(eventsSource, /if \(eventId\) await enqueueEvent\(eventId\)/);
  assert.doesNotMatch(eventsSource, /await createLead\(/);
  assert.match(workerSource, /event\.event_name !== "form_submit" && event\.event_name !== "lead_submit"/);
  assert.match(workerSource, /normalizeCollectorEventLead\(payload\)/);
  assert.match(workerSource, /source_detail->>'event_key'=\$2/);
  assert.match(workerSource, /recoverMissingCollectorLeadJobs/);
  assert.match(workerSource, /forceRequeue: true/);
});

test("the exact payload emitted by the collector can become a qualified lead input", () => {
  const lead = normalizeCollectorEventLead({
    customer_name: "Jane Smith",
    customer_phone: "+447700900123",
    customer_email: "jane@example.invalid",
    service_type: "Ready Mix Concrete",
    requirements: { quantity: "8m3" },
    message: "Need C30 delivery"
  });
  assert.ok(lead);
  assert.equal(lead.customerName, "Jane Smith");
  assert.equal(lead.customerPhone, "+447700900123");
  assert.equal(lead.customerEmail, "jane@example.invalid");
  assert.equal(lead.summary, "Need C30 delivery");
});
