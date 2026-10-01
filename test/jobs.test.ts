import test from "node:test";
import assert from "node:assert/strict";
import { retryDelaySeconds } from "../src/job-utils.ts";

test("job retry delay increases with attempts and is capped", () => {
  assert.equal(retryDelaySeconds(1), 5);
  assert.equal(retryDelaySeconds(2), 10);
  assert.equal(retryDelaySeconds(3), 20);
  assert.equal(retryDelaySeconds(10), 300);
});
