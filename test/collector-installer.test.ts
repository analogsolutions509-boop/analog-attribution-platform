import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("collector plugin is self-contained and does not depend on a companion JS file", async () => {
  const plugin = await readFile(
    new URL("../wordpress/analog-attribution-collector/analog-attribution-collector.php", import.meta.url),
    "utf8",
  );

  assert.match(plugin, /ANALOG_COLLECTOR_JS/);
  assert.match(plugin, /wp_add_inline_script\(/);
  assert.doesNotMatch(plugin, /plugins_url\(['"]assets\/collector\.js/);
});

test("collector plugin still exposes the first-party REST proxy routes", async () => {
  const plugin = await readFile(
    new URL("../wordpress/analog-attribution-collector/analog-attribution-collector.php", import.meta.url),
    "utf8",
  );

  assert.match(plugin, /register_rest_route\('analog\/v1', '\/event'/);
  assert.match(plugin, /register_rest_route\('analog\/v1', '\/phone'/);
});
