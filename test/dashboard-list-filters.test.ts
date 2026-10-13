import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildDashboardCallsListQuery, buildDashboardRecordingsListQuery, isValidDashboardDateRange } from "../src/routes/dashboard.ts";

test("calls list filters are parameterized and support date range, lead type and pagination", () => {
  const built = buildDashboardCallsListQuery({
    siteId: "site-1",
    q: "caller-123",
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-10-13T00:00:00.000Z",
    status: "missed",
    leadType: "commercial",
    provider: "secondring",
    limit: "25",
    offset: "50"
  });
  assert.match(built.sql, /c\.site_id=\$\d+/);
  assert.match(built.sql, /c\.caller_number ILIKE \$\d+/);
  assert.match(built.sql, /COALESCE\(c\.started_at,c\.created_at\) >= \$\d+::timestamptz/);
  assert.match(built.sql, /COALESCE\(c\.started_at,c\.created_at\) < \$\d+::timestamptz/);
  assert.match(built.sql, /COALESCE\(c\.duration_seconds,0\)>0|COALESCE\(c\.duration_seconds,0\)=0/);
  assert.match(built.sql, /COALESCE\(ci\.lead_type,ci\.intent,l\.service_type,''\) ILIKE \$\d+/);
  assert.match(built.sql, /c\.provider=\$\d+/);
  assert.match(built.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.ok(built.params.includes("%caller-123%"));
  assert.ok(built.params.includes("%commercial%"));
  assert.ok(built.params.includes("secondring"));
  assert.equal(built.limit, 25);
  assert.equal(built.offset, 50);
});

test("calls and recordings list pagination is bounded", () => {
  const calls = buildDashboardCallsListQuery({ limit: "999999", offset: "-7" });
  assert.equal(calls.limit, 100);
  assert.equal(calls.offset, 0);
  const recordings = buildDashboardRecordingsListQuery({ limit: "999999", offset: "-7" });
  assert.equal(recordings.limit, 100);
  assert.equal(recordings.offset, 0);
});

test("calls and recordings reject invalid or reversed date ranges", () => {
  assert.equal(isValidDashboardDateRange(undefined, undefined), true);
  assert.equal(isValidDashboardDateRange("2026-10-01T00:00:00.000Z", "2026-10-13T00:00:00.000Z"), true);
  assert.equal(isValidDashboardDateRange("not-a-date", "2026-10-13T00:00:00.000Z"), false);
  assert.equal(isValidDashboardDateRange("2026-10-13T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), false);
  assert.equal(isValidDashboardDateRange("2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), false);
});

test("recording transcript search uses EXISTS so one call is not duplicated", () => {
  const built = buildDashboardRecordingsListQuery({ q: "ready mix" });
  assert.match(built.sql, /EXISTS\(SELECT 1 FROM call_transcripts tx WHERE tx.call_id=c.id AND tx.full_text ILIKE \$\d+\)/);
  assert.doesNotMatch(built.sql, /LEFT JOIN call_transcripts tx/);
});

test("recordings query is read-only, site-scoped, searchable and date-filterable", () => {
  const built = buildDashboardRecordingsListQuery({
    siteId: "site-2",
    q: "rebar",
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
    leadType: "quote",
    limit: "20",
    offset: "20"
  });
  assert.match(built.sql, /recording_storage_key IS NOT NULL/);
  assert.match(built.sql, /recording_status='stored'/);
  assert.match(built.sql, /c\.site_id=\$\d+/);
  assert.match(built.sql, /s\.hostname ILIKE \$\d+/);
  assert.match(built.sql, /COALESCE\(c\.started_at,c\.created_at\) >= \$\d+::timestamptz/);
  assert.match(built.sql, /COALESCE\(ci\.lead_type,ci\.intent,l\.service_type,''\) ILIKE \$\d+/);
  assert.match(built.sql, /LIMIT \$\d+ OFFSET \$\d+/);
  assert.doesNotMatch(built.sql, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
});

test("dashboard exposes full navigation, caller contact links, and report preview controls", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");
  assert.match(html, /id="callSearch"/);
  assert.match(html, /id="callStart"/);
  assert.match(html, /id="recordingStart"/);
  assert.match(html, /id="leadStart"/);
  assert.match(html, /function phoneActions\(/);
  assert.match(html, /function openLead\(/);
  assert.match(html, /function openSite\(/);
  assert.match(html, /id="reportPreview"/);
  assert.match(html, /function loadReportPreview\(/);
  assert.match(html, /data-view="system"[^>]*>Settings/);
});
