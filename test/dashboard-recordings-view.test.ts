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

test("recordings API returns only authenticated dashboard calls with archived recordings", async () => {
  const source = await readFile(new URL("src/routes/dashboard.ts", root), "utf8");
  const routeStart = source.indexOf('"/v1/dashboard/recordings"');
  assert.ok(routeStart >= 0, "dedicated dashboard recordings endpoint should exist");
  const route = source.slice(routeStart, source.indexOf('"/v1/dashboard/calls/:callId"', routeStart));
  assert.ok(route.includes("requireDashboard"));
  assert.ok(route.includes("recording_storage_key IS NOT NULL"));
  assert.ok(route.includes("ORDER BY c.created_at DESC"));
  assert.ok(route.includes("OFFSET"));
  assert.ok(!route.includes("recording_storage_key,"));
});
