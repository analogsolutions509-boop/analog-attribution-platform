import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { buildNotificationEnvelope } from "../src/notification-envelope.ts";

test("notification envelope signs the exact payload with the shared OS secret", () => {
  const payload = { target: "ops@example.invalid", channel: "email", lead_id: "lead-1" };
  const secret = "shared-test-secret-123456789";
  const envelope = buildNotificationEnvelope(payload, secret);

  assert.deepEqual(envelope.payload, payload);
  assert.equal(
    envelope.signature,
    createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex")
  );
  assert.notEqual(envelope.signature, buildNotificationEnvelope(payload, secret + "x").signature);
});

test("notification envelope refuses a missing signing secret", () => {
  assert.throws(() => buildNotificationEnvelope({ channel: "email" }, ""), /notification_signing_secret_missing/);
});
