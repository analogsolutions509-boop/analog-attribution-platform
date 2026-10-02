import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadFlowQuery } from "../src/routes/dashboard.ts";

test("lead flow diagnostic measures every critical attribution stage", () => {
  const sql = buildLeadFlowQuery();
  for (const stage of [
    "visitors","sessions","page_views","phone_clicks",
    "number_assignments","lead_events","leads","calls","recovered_leads"
  ]) {
    assert.match(sql, new RegExp(stage));
  }
  assert.match(sql, /INTERVAL '7 days'/);
  assert.match(sql, /FROM sites s/);
});
