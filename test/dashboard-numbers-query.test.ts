import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardNumbersQuery } from "../src/routes/dashboard.js";

test("dashboard numbers query combines tracking numbers with website and ranked destinations", () => {
  const sql = buildDashboardNumbersQuery();

  assert.match(sql, /FROM tracking_numbers tn/);
  assert.match(sql, /JOIN sites s ON s\.id=tn\.site_id/);
  assert.match(sql, /LEFT JOIN site_suppliers ss\s+ON ss\.site_id=s\.id AND ss\.active/);
  assert.match(sql, /LEFT JOIN suppliers sp\s+ON sp\.id=ss\.supplier_id AND sp\.status='active'/);
  assert.match(sql, /STRING_AGG/);
  assert.match(sql, /GROUP BY tn\.id,s\.id/);
});
