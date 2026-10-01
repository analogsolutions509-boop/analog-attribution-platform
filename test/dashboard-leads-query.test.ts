import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardLeadsQuery } from "../src/routes/dashboard.js";

test("dashboard leads query joins calls for count and latest call attribution", () => {
  const sql = buildDashboardLeadsQuery("", 2);

  assert.match(sql, /FROM leads l JOIN sites s ON s\.id=l\.site_id/);
  assert.match(sql, /LEFT JOIN calls c ON c\.lead_id=l\.id/);
  assert.match(sql, /SELECT c2\.id FROM calls c2/);
  assert.match(sql, /WHERE c2\.lead_id=l\.id/);
  assert.match(sql, /ORDER BY c2\.created_at DESC, c2\.id DESC/);
  assert.match(sql, /LIMIT 1/);
  assert.doesNotMatch(sql, /MAX\(c\.id\)/);
});
