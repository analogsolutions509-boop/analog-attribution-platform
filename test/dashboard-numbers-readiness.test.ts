import test from "node:test";
import assert from "node:assert/strict";

test("number pool readiness requires a real destination and active linked route", async () => {
  const [{ buildDashboardNumbersQuery }, { redis }] = await Promise.all([
    import("../src/routes/dashboard.ts"),
    import("../src/queue.ts")
  ]);
  redis.disconnect();
  const sql = buildDashboardNumbersQuery();

  assert.match(sql, /AS pool_ready/);
  assert.match(sql, /AS pool_issue/);
  assert.match(sql, /forwarding_number_missing/);
  assert.match(sql, /destination_supplier_not_assigned_to_site/);
  assert.match(sql, /destination_contact_missing/);
  assert.match(sql, /NULLIF\(dst\.contact_phone,''\)/);
  assert.match(sql, /NULLIF\(dst\.endpoint_url,''\)/);
  assert.doesNotMatch(sql, /NULLIF\(dst\.endpoint_url,''\),dst\.name/);
});
