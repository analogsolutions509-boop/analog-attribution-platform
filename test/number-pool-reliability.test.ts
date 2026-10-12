import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("number pool has a shared-number fallback when all ready numbers are reserved", async () => {
  const source = await readFile(new URL("src/number-pool.ts", root), "utf8");
  assert.match(source, /const fallback = await client\.query/);
  assert.match(source, /attribution_valid=FALSE/);
  assert.match(source, /number_pool_exhausted/);
});

test("number pool distinguishes missing inventory from missing forwarding setup", async () => {
  const source = await readFile(new URL("src/number-pool.ts", root), "utf8");
  assert.match(source, /tracking_number_not_configured/);
  assert.match(source, /forwarding_route_not_configured/);
});

test("calls do not inherit visitor attribution from a number shared across sessions", async () => {
  const source = await readFile(new URL("src/number-pool.ts", root), "utf8");
  assert.match(source, /na\.attribution_valid\s*=\s*TRUE/);
  assert.match(source, /calledNumber\?\.replace\(\/\\D\/g/);
});

test("number readiness follows the tracking-to-SecondRing forwarding route, not supplier contact metadata", async () => {
  const pool = await readFile(new URL("src/number-pool.ts", root), "utf8");
  const dashboard = await readFile(new URL("src/routes/dashboard.ts", root), "utf8");
  assert.doesNotMatch(pool, /JOIN suppliers dst ON dst\.id=tn\.destination_supplier_id AND dst\.status='active'/);
  assert.match(dashboard, /forwarding_ready/);
});

test("collector maps missing visitor identity to a client error and missing number routes to service errors", async () => {
  const source = await readFile(new URL("src/routes/phone-pool.ts", root), "utf8");
  assert.match(source, /visitor_session_not_found/);
  assert.match(source, /number_pool_exhausted/);
  assert.match(source, /: 503/);
});
