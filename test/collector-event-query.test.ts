import test from "node:test";
import assert from "node:assert/strict";
import { collectorEventQuery } from "../src/collector-event-query.js";

test("collector event worker query reads UTM attribution from sessions, not events", () => {
  assert.match(collectorEventQuery, /FROM\s+events\s+e/i);
  assert.match(collectorEventQuery, /LEFT JOIN\s+sessions\s+s\s+ON\s+s\.id\s*=\s*e\.session_id/i);
  assert.match(collectorEventQuery, /s\.utm_source/i);
  assert.match(collectorEventQuery, /s\.utm_campaign/i);
  assert.match(collectorEventQuery, /e\.payload/i);
  assert.doesNotMatch(collectorEventQuery, /e\.utm_source|e\.utm_campaign/i);
});
