import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("call detail loads historical OS data through the read-only source, not the recovery table", async () => {
  const dashboard = await readFile(new URL("../src/routes/dashboard.ts", import.meta.url), "utf8");
  const start = dashboard.indexOf("async function loadAnalogOSContextForCall");
  const end = dashboard.indexOf("export function buildDashboardLeadsQuery", start);
  assert.ok(start >= 0 && end > start, "call history loader exists");
  const loader = dashboard.slice(start, end);
  assert.ok(loader.includes("getReadOnlyAnalogOSContext"));
  assert.ok(loader.includes("getLondonDateKey(occurredDate)"));
  assert.ok(loader.includes("catch"));
  assert.ok(!loader.includes("db.query"));
  assert.ok(!loader.includes("analog_os_recovery_records"));
});
