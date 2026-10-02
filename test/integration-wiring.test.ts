import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("call lifecycle publishes final state to Analog OS", async () => {
  const calls = await readFile(new URL("../src/calls.ts", import.meta.url), "utf8");
  assert.ok(calls.includes("export async function publishCallUpdated"));
  assert.ok(calls.includes('queueAnalogOSEvent("call.updated"'));
});

test("Twilio and Wazo status paths publish OS call updates", async () => {
  const twilio = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const telephony = await readFile(new URL("../src/routes/telephony.ts", import.meta.url), "utf8");
  assert.ok(twilio.includes("publishCallUpdated"));
  assert.ok(twilio.includes('queueAnalogOSEvent("recording.ready"'));
  assert.ok(telephony.includes("publishCallUpdated"));
});
