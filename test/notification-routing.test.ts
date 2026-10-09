import assert from "node:assert/strict";
import test from "node:test";
import { resolveNotificationWebhook } from "../src/notification-routing.ts";

test("uses the explicitly configured notification webhook when present", () => {
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

test("falls back to the Analog OS web app with the email-notification route", () => {
  const result = resolveNotificationWebhook({
    analogOSUrl: "https://script.google.com/macros/s/deployment/exec?route=analog-os&tenant=live",
    analogOSSecret: "o".repeat(32)
  });

  assert.deepEqual(result, {
    url: "https://script.google.com/macros/s/deployment/exec?route=analog-notification&tenant=live",
    signingSecret: "o".repeat(32),
    source: "analog_os_fallback"
  });
});

test("does not create an unsigned or unconfigured notification route", () => {
  assert.equal(resolveNotificationWebhook({}), null);
  assert.equal(
    resolveNotificationWebhook({
      analogOSUrl: "https://script.google.com/macros/s/deployment/exec",
      analogOSSecret: ""
    }),
    null
  );
});
