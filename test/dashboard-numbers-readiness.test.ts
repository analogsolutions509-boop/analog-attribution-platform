import test from "node:test";
import assert from "node:assert/strict";

test("number pool readiness follows the active forwarding route while supplier readiness is diagnosed separately", async () => {
  const [{ buildDashboardNumbersQuery }, { redis }] = await Promise.all([
    import("../src/routes/dashboard.ts"),
    import("../src/queue.ts")
  ]);
  redis.disconnect();
  const sql = buildDashboardNumbersQuery();

  assert.match(sql, /AS forwarding_ready/);
  assert.match(sql, /AS pool_ready/);
  assert.match(sql, /AS pool_issue/);
  assert.match(sql, /forwarding_number_missing/);
  assert.match(sql, /forwarding_number_inactive/);
  assert.match(sql, /AS supplier_ready/);
  assert.match(sql, /AS supplier_issue/);
  assert.match(sql, /default_supplier_not_assigned_to_site/);
  assert.match(sql, /default_supplier_contact_missing/);
  assert.match(sql, /NULLIF\(dst\.contact_phone,''\)/);
  assert.match(sql, /NULLIF\(dst\.endpoint_url,''\)/);
  assert.doesNotMatch(sql, /AND dst\.status='active'[\s\S]{0,200}AS pool_ready/);
});
