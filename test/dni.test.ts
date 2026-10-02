import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WordPress collector contains a first-party dynamic-number assignment path", async () => {
  const source = await readFile(new URL("../wordpress/analog-attribution-collector/assets/collector.js", import.meta.url), "utf8");
  assert.match(source, /phoneEndpoint/);
  assert.match(source, /data-analog-phone/);
  assert.match(source, /href.*tel:/);
  assert.match(source, /visitor_id/);
  assert.match(source, /session_id/);
});

test("WordPress collector does not manufacture non-UUID visitor or session IDs", async () => {
  const source = await readFile(new URL("../wordpress/analog-attribution-collector/assets/collector.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /id\('v'\)/);
  assert.doesNotMatch(source, /id\('s'\)/);
  assert.match(source, /crypto\.randomUUID\(\)/);
});

test("WordPress plugin exposes a same-origin phone assignment proxy", async () => {
  const source = await readFile(new URL("../wordpress/analog-attribution-collector/analog-attribution-collector.php", import.meta.url), "utf8");
  assert.match(source, /register_rest_route\('analog\/v1', '\/phone'/);
  assert.match(source, /v1\/phone-pool\/assign/);
});
