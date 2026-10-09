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

test("daily Analog OS reconciliation is wired into the worker and dashboard", async () => {
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/routes/dashboard.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../migrations/016_analog_os_reconciliation.sql", import.meta.url), "utf8");
  assert.ok(worker.includes('job.type === "analog.os.reconcile"'));
  assert.ok(worker.includes("ensureDailyAnalogOSReconciliationJob"));
  assert.ok(dashboard.includes("/v1/dashboard/analog-os/reconcile"));
  assert.ok(dashboard.includes("/v1/dashboard/analog-os/reconciliation"));
  assert.ok(migration.includes("analog_os_reconciliation_runs"));
  assert.ok(migration.includes("analog_os_recovery_records"));
});

test("first-party form leads queue both internal and supplier email notifications", async () => {
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  assert.ok(worker.includes("const leadId = await createLead({"));
  assert.ok(worker.includes('queueNotification({leadId,recipientType:"internal",channel:"email"})'));
  assert.ok(worker.includes('queueNotification({leadId,recipientType:"supplier",channel:"email"})'));
});
