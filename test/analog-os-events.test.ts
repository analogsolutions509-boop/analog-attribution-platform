import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalogOSWebhookUrl, buildAnalogOSEvent } from "../src/analog-os-events.js";

test("Analog OS webhook URL receives its route without losing an existing query", () => {
  assert.equal(buildAnalogOSWebhookUrl("https://example.com/webhook"), "https://example.com/webhook?route=analog-os");
  assert.equal(buildAnalogOSWebhookUrl("https://example.com/webhook?token=abc"), "https://example.com/webhook?token=abc&route=analog-os");
});

test("Analog OS events carry stable envelope metadata", () => {
  const event = buildAnalogOSEvent("call.created", "call", "call-1", { provider: "secondring" }, new Date("2026-10-01T09:00:00Z"));
  assert.deepEqual(event, {
    type: "call.created",
    occurred_at: "2026-10-01T09:00:00.000Z",
    aggregate_type: "call",
    aggregate_id: "call-1",
    data: { provider: "secondring" }
  });
});
