import assert from "node:assert/strict";
import test from "node:test";
import { assertAnalogOSDeliveryResponse } from "../src/analog-os-response.ts";

test("accepts a successful OS webhook acknowledgement", () => {
  assert.doesNotThrow(() => assertAnalogOSDeliveryResponse(200, { ok: true, event: "lead.created" }));
});

test("rejects HTTP 200 when Apps Script reports a failed sheet sync", () => {
  assert.throws(
    () => assertAnalogOSDeliveryResponse(200, { ok: false, error: "attribution_sync_failed" }),
    /analog_os_sync_rejected:attribution_sync_failed/
  );
});

test("rejects HTTP errors and malformed JSON acknowledgements", () => {
  assert.throws(() => assertAnalogOSDeliveryResponse(503, null), /analog_os_sync_failed:503/);
  assert.throws(() => assertAnalogOSDeliveryResponse(200, null), /analog_os_sync_rejected:invalid_acknowledgement/);
});
