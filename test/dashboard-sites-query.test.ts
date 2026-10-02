import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSitesQuery } from "../src/routes/dashboard.js";

test("dashboard sites query includes the supplier count for each website", () => {
  const sql = buildDashboardSitesQuery();

  assert.match(sql, /FROM sites s/);
  assert.match(sql, /COUNT\(DISTINCT ss\.supplier_id\)::int AS supplier_count/);
  assert.match(sql, /LEFT JOIN site_suppliers ss ON ss\.site_id=s\.id/);
});
