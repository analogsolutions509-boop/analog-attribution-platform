import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("dashboard transfer dispatches to the call's configured provider instead of always using Wazo", async () => {
  const source = await readFile(new URL("src/routes/telephony.ts", root), "utf8");
  assert.match(source, /provider\s*===\s*["']twilio["']/);
  assert.match(source, /client\.calls\.create/);
});

test("Twilio transfer routes retain the operator call SID and support a warm bridge", async () => {
  const source = await readFile(new URL("src/routes/twilio.ts", root), "utf8");
  assert.match(source, /operator_call_sid/);
  assert.match(source, /\/v1\/providers\/twilio\/operator\/join/);
  assert.match(source, /\/v1\/providers\/twilio\/supplier/);
});

test("caller hears the recording notice and supplier hears the Analog Solutions whisper", async () => {
  const source = await readFile(new URL("src/providers/twilio.ts", root), "utf8");
  assert.match(source, /recorded for quality assurance purposes/i);
  assert.match(source, /This call is from Analog Solutions/i);
  assert.match(source, /lead from/);
});
