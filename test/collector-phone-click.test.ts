import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("API-generated collector records phone and email click intent while preserving existing destinations", async () => {
  const source = await readFile(new URL("../src/routes/collector.ts", import.meta.url), "utf8");
  assert.match(source, /addEventListener\(["']click["']/);
  assert.match(source, /send\(["']phone_click["']/);
  assert.match(source, /send\(["']email_click["']/);
  assert.match(source, /href\.replace\(\/\^tel:\/i/);
  assert.match(source, /href\.replace\(\/\^mailto:\/i/);
  assert.match(source, /target\.getAttribute\(["']href["']\)/);
});

test("phone and email clicks are intent events, not fabricated call or lead records", async () => {
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const start = worker.indexOf("async function processEvent");
  const end = worker.indexOf("async function processAnalogOSEvent", start);
  const handler = worker.slice(start, end);
  assert.match(handler, /event\.event_name !== "form_submit"/);
  assert.match(handler, /event\.event_name !== "lead_submit"/);
  assert.match(handler, /if \(event\.event_name !== "form_submit" && event\.event_name !== "lead_submit"\) \{\s*return event;/);
});
