import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeAnalogOSMonthLeads,
  getMonthDateKeys,
  getPreviousLondonMonthKey,
  validateReconciliationMonth
} from "../src/analog-os-reconciliation.ts";

test("validates real YYYY-MM calendar months", () => {
  assert.equal(validateReconciliationMonth("2024-02"), "2024-02");
  assert.equal(validateReconciliationMonth("2026-10"), "2026-10");
  assert.throws(() => validateReconciliationMonth("2026-13"), /invalid_reconciliation_month/);
  assert.throws(() => validateReconciliationMonth("2026-2"), /invalid_reconciliation_month/);
  assert.throws(() => validateReconciliationMonth("2026-02-01"), /invalid_reconciliation_month/);
});

test("builds complete date keys for a closed month, including leap days", () => {
  const leapFebruary = getMonthDateKeys("2024-02", new Date("2024-06-05T12:00:00.000Z"));
  assert.equal(leapFebruary.length, 29);
  assert.equal(leapFebruary[0], "2024-02-01");
  assert.equal(leapFebruary.at(-1), "2024-02-29");

  const September = getMonthDateKeys("2026-09", new Date("2026-10-14T12:00:00.000Z"));
  assert.equal(September.length, 30);
  assert.equal(September.at(-1), "2026-09-30");
});

test("limits the current London month to today's date rather than requesting future exports", () => {
  const days = getMonthDateKeys("2026-10", new Date("2026-10-14T12:00:00.000Z"));
  assert.equal(days.length, 14);
  assert.equal(days[0], "2026-10-01");
  assert.equal(days.at(-1), "2026-10-14");
});

test("calculates the previous London calendar month across year boundaries", () => {
  assert.equal(getPreviousLondonMonthKey(new Date("2026-01-14T12:00:00.000Z")), "2025-12");
  assert.equal(getPreviousLondonMonthKey(new Date("2026-10-14T12:00:00.000Z")), "2026-09");
});

test("deduplicates monthly source exports by source and stable source record, newest first", () => {
  const makeLead = (source: string, source_record: string, occurred_at: string, customer_name: string) => ({
    source, source_record, os_lead_id: source_record.split(":").at(-1) || "",
    occurred_at, website: "example.com", service: "Concrete", location: "",
    customer_name, customer_email: "", customer_phone: "", subject: "", enquiry: "",
    classification: "", confidence: "", assigned_client: "", client_email: "",
    forwarded: "", forwarded_at: "", client_response: "", quote_value: "", sale_value: "",
    commission_rate: "", commission_due: "", status: "new", original_message_id: "",
    notes: "", metadata: {}
  });
  const leads = [
    makeLead("EMAIL", "EMAIL:10", "2026-10-02T09:00:00.000Z", "Older"),
    makeLead("EMAIL", "EMAIL:10", "2026-10-02T09:00:00.000Z", "Duplicate"),
    makeLead("WHATCONVERTS", "WHATCONVERTS:10", "2026-10-04T09:00:00.000Z", "Different source"),
    makeLead("EMAIL", "EMAIL:11", "2026-10-03T09:00:00.000Z", "Newer")
  ];
  const unique = dedupeAnalogOSMonthLeads(leads as any);
  assert.equal(unique.length, 3);
  assert.equal(unique[0]?.source_record, "WHATCONVERTS:10");
  assert.deepEqual(unique.map(lead => lead.source_record), ["WHATCONVERTS:10", "EMAIL:11", "EMAIL:10"]);
});

import { readFile } from "node:fs/promises";

test("monthly historical OS leads use an authenticated read-only dashboard endpoint", async () => {
  const route = await readFile(new URL("../src/routes/dashboard.ts", import.meta.url), "utf8");
  const start = route.indexOf('"/v1/dashboard/analog-os/monthly"');
  const end = route.indexOf('"/v1/dashboard/analog-os/reconcile"', start);
  assert.ok(start >= 0 && end > start);
  const handler = route.slice(route.lastIndexOf('app.get', start), end);
  assert.ok(handler.includes("requireDashboard(app, request, reply)"));
  assert.ok(handler.includes("getAnalogOSMonthlySnapshot"));
  assert.ok(handler.includes("future_month_not_allowed"));
  assert.ok(handler.includes("No partial monthly snapshot was saved"));
});

test("monthly OS snapshot persistence is isolated from active leads and supplier routing", async () => {
  const service = await readFile(new URL("../src/analog-os-monthly.ts", import.meta.url), "utf8");
  assert.match(service, /INSERT INTO analog_os_monthly_snapshots/);
  assert.match(service, /getReadOnlyAnalogOSMonth/);
  assert.doesNotMatch(service, /INSERT\s+INTO\s+leads|createLead\s*\(|queueNotification\s*\(/i);
});

test("dashboard has a separate selectable monthly OS history list and refresh control", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");
  assert.match(html, /id="osMonth"/);
  assert.match(html, /id="osMonthlyRefreshBtn"/);
  assert.match(html, /id="osMonthlyTable"/);
  assert.match(html, /function loadOSMonthly\(refresh=false\)/);
  assert.match(html, /view==="leads"[^\n]*loadOSMonthly\(false\)/);
  assert.match(html, /refresh\?"&refresh=1":""/);
});
