import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableCollectorEventSchemaMismatch } from "../src/collector-event-recovery.js";

test("recovery accepts only dead-letter collector events with the known missing UTM-column error", () => {
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch(
      "event.process",
      "dead_letter",
      'column "utm_source" does not exist'
    ),
    true
  );
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch(
      "event.process",
      "dead_letter",
      'column "utm_campaign" does not exist'
    ),
    true
  );
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch(
      "event.process",
      "dead_letter",
      'column e.utm_source does not exist'
    ),
    true
  );
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch("event.process", "dead_letter", "notification_webhook_503"),
    false
  );
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch("call.process", "dead_letter", 'column "utm_source" does not exist'),
    false
  );
  assert.equal(
    isRecoverableCollectorEventSchemaMismatch("event.process", "failed", 'column "utm_source" does not exist'),
    false
  );
});
