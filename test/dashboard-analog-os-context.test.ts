import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardCallAnalogOSFallbackQuery,
  selectUniqueDashboardAnalogOSContext
} from "../src/routes/dashboard.js";

test("Analog OS fallback lookup is constrained to the call's site, UK date, website, and caller", () => {
  const sql = buildDashboardCallAnalogOSFallbackQuery();
  assert.match(sql, /reconciliation_date/);
  assert.match(sql, /payload->>'website'/);
  assert.match(sql, /payload->>'customer_phone'/);
  assert.match(sql, /Europe\/London/);
  assert.match(sql, /LIMIT 2/);
});

test("only an unambiguous Analog OS record is attached to an Attribution call", () => {
  const matched = { os_lead_id: "OS-123" };
  assert.strictEqual(selectUniqueDashboardAnalogOSContext([matched]), matched);
  assert.strictEqual(selectUniqueDashboardAnalogOSContext([]), null);
  assert.strictEqual(
    selectUniqueDashboardAnalogOSContext([matched, { os_lead_id: "OS-456" }]),
    null
  );
});
