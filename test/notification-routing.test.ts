import assert from "node:assert/strict";
import test from "node:test";
import { resolveNotificationWebhook } from "../src/notification-routing.ts";

test("uses the dedicated notification webhook when explicitly configured", () => {
  const result = resolveNotificationWebhook({
    notificationUrl: "https://notifications.example.test/webhook?tenant=analog",
    notificationSecret: "n".repeat(32),
    analogOSUrl: "https://script.google.com/macros/s/deployment/exec?route=analog-os",
    analogOSSecret: "o".repeat(32)
  });

  assert.deepEqual(result, {
    url: "https://notifications.example.test/webhook?tenant=analog",
    signingSecret: "n".repeat(32),
    source: "dedicated"
  });
});

test("does not fall back to the Analog OS endpoint when notification transport is missing", () => {
  assert.equal(resolveNotificationWebhook({
    analogOSUrl: "https://script.google.com/macros/s/deployment/exec?route=analog-os",
    analogOSSecret: "o".repeat(32)
  }), null);
});

test("a dedicated notification URL may temporarily use the configured signature secret", () => {
  const result = resolveNotificationWebhook({
    notificationUrl: "https://script.google.com/macros/s/deployment/exec?route=analog-notification",
    analogOSUrl: "https://script.google.com/macros/s/deployment/exec?route=analog-os",
    analogOSSecret: "o".repeat(32)
  });
  assert.equal(result?.url, "https://script.google.com/macros/s/deployment/exec?route=analog-notification");
  assert.equal(result?.signingSecret, "o".repeat(32));
  assert.equal(result?.source, "dedicated");
});

test("rejects missing signatures, missing endpoints and non-HTTPS endpoints", () => {
  assert.equal(resolveNotificationWebhook({}), null);
  assert.equal(resolveNotificationWebhook({
    notificationUrl: "https://notifications.example.test/webhook",
    notificationSecret: ""
  }), null);
  assert.equal(resolveNotificationWebhook({
    notificationUrl: "http://notifications.example.test/webhook",
    notificationSecret: "n".repeat(32)
  }), null);
});
