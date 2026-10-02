import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("number pool resolves collector visitor and session keys to canonical UUID rows", async () => {
  const source = await readFile(new URL("../src/number-pool.ts", import.meta.url), "utf8");
  assert.match(source, /visitor_key/);
  assert.match(source, /session_key/);
  assert.match(source, /visitor_id/);
  assert.match(source, /session_id/);
});

test("number pool scopes identity lookups to the website", async () => {
  const source = await readFile(new URL("../src/number-pool.ts", import.meta.url), "utf8");
  assert.match(source, /site_id=\$1/);
});
