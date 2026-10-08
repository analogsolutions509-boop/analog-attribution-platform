import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WordPress collector defaults to the production first-party API", async () => {
  const source = await readFile(
    new URL("../wordpress/analog-attribution-collector/analog-attribution-collector.php", import.meta.url),
    "utf8"
  );
  assert.match(source, /api-jyu9-production\.up\.railway\.app/);
  assert.match(source, /enabled.*true/);
  assert.match(source, /v1\/public\/events/);
  assert.match(source, /v1\/public\/phone-pool\/assign/);
});

test("PDF reporting no longer brands the product as WhatConverts", async () => {
  const source = await readFile(
    new URL("../src/pdf-report.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /WhatConverts/i);
  assert.match(source, /Analog Attribution Performance Report/);
});
