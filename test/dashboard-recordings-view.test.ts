import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("dashboard exposes a dedicated recording library and inline playback controls", async () => {
  const source = await readFile(new URL("public/dashboard.html", root), "utf8");
  assert.match(source, /data-view="recordings"/);
  assert.match(source, /id="recordingsView"/);
  assert.match(source, /id="recordingsTable"/);
  assert.match(source, /function playRecording\(/);
  assert.match(source, /expires_in_seconds/);
  assert.match(source, /<audio[^>]*controls/);
});

test("recordings API uses an authenticated paginated query builder restricted to archived audio", async () => {
  const source = await readFile(new URL("src/routes/dashboard.ts", root), "utf8");
  const routeStart = source.indexOf('"/v1/dashboard/recordings"');
  assert.ok(routeStart >= 0, "dedicated dashboard recordings endpoint should exist");
  const route = source.slice(routeStart, source.indexOf('"/v1/dashboard/calls/:callId"', routeStart));
  assert.ok(route.includes("requireDashboard"));
  assert.ok(route.includes("buildDashboardRecordingsListQuery"));
  assert.ok(route.includes("hasMore"));
  const builderStart = source.indexOf("export function buildDashboardRecordingsListQuery");
  const builderEnd = source.indexOf("export function buildDashboardSiteDetailQuery", builderStart);
  assert.ok(builderStart >= 0 && builderEnd > builderStart);
  const builder = source.slice(builderStart, builderEnd);
  assert.ok(builder.includes("recording_storage_key IS NOT NULL"));
  assert.ok(builder.includes("recording_status='stored'"));
  assert.ok(builder.includes("OFFSET"));
  assert.ok(builder.includes("ORDER BY COALESCE(c.started_at,c.created_at) DESC"));
  assert.ok(!builder.match(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i));
});
