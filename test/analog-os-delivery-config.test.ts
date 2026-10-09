import test from "node:test";
import assert from "node:assert/strict";
import { requireAnalogOSDeliveryConfig } from "../src/analog-os-delivery-config.ts";

test("requires a webhook URL instead of treating an undelivered OS event as success", () => {
  assert.throws(
    () => requireAnalogOSDeliveryConfig(undefined, "test-secret"),
    /analog_os_webhook_url_missing/
  );
  assert.throws(
    () => requireAnalogOSDeliveryConfig(" ", "test-secret"),
    /analog_os_webhook_url_missing/
  );
});

test("requires a signing secret and trims delivery settings", () => {
  assert.throws(
    () => requireAnalogOSDeliveryConfig("https://example.invalid/exec", undefined),
    /analog_os_webhook_secret_missing/
  );
  assert.deepEqual(
    requireAnalogOSDeliveryConfig(" https://example.invalid/exec ", " test-secret "),
    { url: "https://example.invalid/exec", secret: "test-secret" }
  );
});
