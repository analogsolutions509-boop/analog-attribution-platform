import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readNumberPoolSource() {
  return readFile(new URL("../src/number-pool.ts", import.meta.url), "utf8");
}

test("number pool resolves collector visitor and session keys to canonical UUID rows", async () => {
  const source = await readNumberPoolSource();
  assert.match(source, /visitor_key/);
  assert.match(source, /session_key/);
  assert.match(source, /visitor_id/);
  assert.match(source, /session_id/);
});

test("number pool scopes identity lookups to the website", async () => {
  const source = await readNumberPoolSource();
  assert.match(source, /site_id=\$1/);
});

test("tracking assignment only uses routes that satisfy live dashboard readiness", async () => {
  const source = await readNumberPoolSource();
  const existingAssignmentQuery = source.slice(
    source.indexOf("const existing"),
    source.indexOf("const expires")
  );
  const candidateQuery = source.slice(
    source.indexOf("const result = await client.query"),
    source.indexOf("if (!result.rowCount)", source.indexOf("const result = await client.query"))
  );

  for (const query of [existingAssignmentQuery, candidateQuery]) {
    assert.match(query, /JOIN forwarding_numbers\s+fn ON fn\.id=tn\.forwarding_number_id AND fn\.active/i);
    assert.match(query, /JOIN suppliers\s+dst ON dst\.id=tn\.destination_supplier_id AND dst\.status='active'/i);
    assert.match(query, /site_suppliers\s+assigned/i);
    assert.match(query, /assigned\.site_id=tn\.site_id/i);
    assert.match(query, /assigned\.supplier_id=tn\.destination_supplier_id/i);
    assert.match(query, /assigned\.active/i);
    assert.match(query, /contact_phone/i);
    assert.match(query, /endpoint_url/i);
  }
});
