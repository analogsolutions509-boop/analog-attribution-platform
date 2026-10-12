import test from "node:test";
import assert from "node:assert/strict";
import { jobDedupeKey, retryDelaySeconds } from "../src/job-utils.ts";

test("job retry delay increases with attempts and is capped", () => {
  assert.equal(retryDelaySeconds(1), 5);
  assert.equal(retryDelaySeconds(2), 10);
  assert.equal(retryDelaySeconds(3), 20);
  assert.equal(retryDelaySeconds(10), 300);
});

test("collector event retries reuse the ingester's canonical dedupe key", () => {
  assert.equal(jobDedupeKey("event.process", "event-1"), "event:event-1");
  assert.equal(jobDedupeKey("call.process", "call-1"), "call.process:call-1");
});
