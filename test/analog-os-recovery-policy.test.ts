import test from "node:test";
import assert from "node:assert/strict";
import { shouldRecoverAnalogOSEvent } from "../src/analog-os-recovery-policy.ts";

const now = Date.parse("2026-10-09T12:00:00.000Z");

test("recovers a queued outbox item that has no worker job", () => {
  assert.equal(shouldRecoverAnalogOSEvent("queued", null, now), true);
});

test("does not duplicate jobs that are queued or processing", () => {
  assert.equal(shouldRecoverAnalogOSEvent("queued", { status: "queued" }, now), false);
  assert.equal(shouldRecoverAnalogOSEvent("queued", { status: "processing" }, now), false);
});

test("repairs completed jobs when the outbox was not marked sent", () => {
  assert.equal(shouldRecoverAnalogOSEvent("queued", { status: "completed" }, now), true);
});

test("retries failed jobs when their next retry is due, but not early", () => {
  assert.equal(shouldRecoverAnalogOSEvent("queued", {
    status: "failed", attempts: 1, maxAttempts: 5,
    availableAt: "2026-10-09T12:01:00.000Z"
  }, now), false);
  assert.equal(shouldRecoverAnalogOSEvent("queued", {
    status: "failed", attempts: 1, maxAttempts: 5,
    availableAt: "2026-10-09T11:59:00.000Z"
  }, now), true);
});

test("retries dead-letter jobs only after the cooldown", () => {
  assert.equal(shouldRecoverAnalogOSEvent("queued", {
    status: "dead_letter", attempts: 5, maxAttempts: 5,
    updatedAt: "2026-10-09T11:30:00.000Z"
  }, now), false);
  assert.equal(shouldRecoverAnalogOSEvent("queued", {
    status: "dead_letter", attempts: 5, maxAttempts: 5,
    updatedAt: "2026-10-09T10:59:00.000Z"
  }, now), true);
});

test("does not recover an outbox event already marked sent", () => {
  assert.equal(shouldRecoverAnalogOSEvent("sent", null, now), false);
});
