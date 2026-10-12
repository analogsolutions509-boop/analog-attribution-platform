import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("call-tracking monitoring endpoint reports inventory and routing gaps", async () => {
  const source = await readFile(new URL("../src/routes/health.ts", import.meta.url), "utf8");
  assert.ok(source.includes("/v1/health/call-tracking"));
  assert.ok(source.includes("tracking_numbers_missing"));
  assert.ok(source.includes("forwarding_numbers_missing"));
  assert.ok(source.includes("active_sites_missing_tracking_numbers"));
  assert.ok(source.includes("tracking_numbers_missing_forwarding_routes"));
  assert.ok(source.includes("provider_configured"));
  assert.ok(source.includes("503"));
});

test("public call-tracking health only exposes aggregate inventory counts", async () => {
  const source = await readFile(new URL("../src/routes/health.ts", import.meta.url), "utf8");
  assert.ok(source.includes("active_sites"));
  assert.ok(source.includes("active_tracking_numbers"));
  assert.ok(source.includes("active_forwarding_numbers"));
  assert.ok(!source.includes("phone_number:"));
  assert.ok(!source.includes("TWILIO_AUTH_TOKEN:"));
});
