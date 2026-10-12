import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Twilio conference completion ensures a call lead exists before later notification processing", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const conferenceRoute = source.slice(
    source.indexOf('app.post("/v1/providers/twilio/conference"'),
    source.indexOf('app.post("/v1/providers/twilio/status"')
  );
  assert.match(conferenceRoute, /attributeCallToLead/);
  assert.match(conferenceRoute, /conference-end/);
});

test("Twilio absent or failed recordings still trigger internal and supplier email notifications", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/v1/providers/twilio/recording"');
  const recordingRoute = source.slice(start);
  const terminalRecordingStatus = recordingRoute.indexOf('normalizedRecordingStatus === "absent" || normalizedRecordingStatus === "failed"');
  const recordingUrlRequired = recordingRoute.indexOf('if (!recordingUrl)');
  assert.ok(terminalRecordingStatus >= 0);
  assert.ok(recordingUrlRequired >= 0);
  assert.ok(terminalRecordingStatus < recordingUrlRequired, "absence callbacks commonly have no recording URL");
  assert.match(recordingRoute, /queueNotification\(\{ leadId, callId: String\(call\.id\), recipientType: "internal", channel: "email" \}\)/);
  assert.match(recordingRoute, /queueNotification\(\{ leadId, callId: String\(call\.id\), recipientType: "supplier", channel: "email" \}\)/);
});

test("recording and transcription failures still ensure a call lead and queue notification emails", async () => {
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const calls = await readFile(new URL("../src/calls.ts", import.meta.url), "utf8");
  assert.match(worker, /attributeCallToLead/);
  assert.match(worker, /queueCallCompletionNotifications/);
  assert.match(calls, /export async function queueCallCompletionNotifications/);
  assert.match(calls, /if \(!apiKey\) \{[\s\S]*queueCallCompletionNotifications/);
});
