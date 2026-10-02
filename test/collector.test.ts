import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collectorPath = new URL("../wordpress/analog-attribution-collector/assets/collector.js", import.meta.url);

test("collector automatically observes contact forms", async () => {
  const source = await readFile(collectorPath, "utf8");
  assert.match(source, /form_submit/);
  assert.match(source, /customer_phone/);
  assert.match(source, /customer_email/);
  assert.match(source, /querySelectorAll\('form'\)/);
  assert.match(source, /addEventListener\('submit'/);
  assert.match(source, /MutationObserver/);
});

test("collector preserves explicit lead capture for custom calculators", async () => {
  const source = await readFile(collectorPath, "utf8");
  assert.match(source, /captureForm/);
  assert.match(source, /lead_submit/);
  assert.match(source, /window\.AnalogAttribution/);
});
