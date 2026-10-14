import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/db.ts";
import { buildReport, buildReportWhere, isValidReportDateRange } from "../src/routes/reports.ts";

test("report filters constrain website, supplier, channel, status and dates with parameters", () => {
  const built = buildReportWhere({
    siteId: "site-1",
    supplierId: "supplier-1",
    channel: "phone_call",
    status: "quoted",
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-10-13T00:00:00.000Z"
  });
  assert.match(built.where, /l\.site_id=\$\d+/);
  assert.match(built.where, /lead_assignments la WHERE la\.lead_id=l\.id AND la\.supplier_id=\$\d+/);
  assert.match(built.where, /l\.source=\$\d+/);
  assert.match(built.where, /l\.status=\$\d+/);
  assert.ok(built.params.includes("site-1"));
  assert.ok(built.params.includes("supplier-1"));
  assert.ok(built.params.includes("phone_call"));
  assert.ok(built.params.includes("quoted"));
  assert.ok(built.params.includes("2026-10-01T00:00:00.000Z"));
  assert.ok(built.params.includes("2026-10-13T00:00:00.000Z"));
});

test("report date range validation rejects invalid and reversed dates", () => {
  assert.equal(isValidReportDateRange(undefined, undefined), true);
  assert.equal(isValidReportDateRange("2026-10-01T00:00:00.000Z", "2026-10-13T00:00:00.000Z"), true);
  assert.equal(isValidReportDateRange("not-a-date", "2026-10-13T00:00:00.000Z"), false);
  assert.equal(isValidReportDateRange("2026-10-13T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), false);
  assert.equal(isValidReportDateRange("2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), false);
});

test("report build uses the parameterized filter builder", async () => {
  const originalQuery = db.query;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const responses = [
    { rows: [{ leads: 2, touched: 1, sales: 1 }] },
    { rows: [{ day: "2026-10-13", leads: 2 }] },
    { rows: [{ supplier: "Supplier A", leads: 2, sales: 1 }] }
  ];
  let index = 0;
  db.query = (async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params || [] });
    return responses[index++];
  }) as typeof db.query;
  try {
    const report = await buildReport({ siteId: "site-1", start: "2026-10-01T00:00:00.000Z", end: "2026-10-14T00:00:00.000Z" });
    assert.equal(queries.length, 3);
    assert.match(queries[1].sql, /AS "day"/);
    assert.ok(queries.every((query) => query.sql.includes("l.site_id=$3")));
    assert.deepEqual(report.kpi, { leads: 2, touched: 1, sales: 1 });
    assert.equal(report.daily.length, 1);
    assert.equal(report.suppliers[0].supplier, "Supplier A");
  } finally {
    db.query = originalQuery;
  }
});
