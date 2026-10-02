import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDashboardNumbersQuery } from "../src/routes/dashboard.js";

test("dashboard numbers query exposes a primary destination supplier per number", () => {
  const sql = buildDashboardNumbersQuery();
  assert.match(sql, /destination_supplier_id/);
  assert.match(sql, /LEFT JOIN suppliers dst/);
  assert.match(sql, /destination_number/);
});

test("number management migration adds destination supplier linkage", async () => {
  const sql = await readFile(new URL("../migrations/013_number_management.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE tracking_numbers\s+ADD COLUMN IF NOT EXISTS destination_supplier_id UUID/);
  assert.match(sql, /REFERENCES suppliers\(id\)/);
});

test("dashboard numbers page exposes add, edit, deactivate and delete controls", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");
  assert.ok(html.includes("Add tracking number"));
  assert.ok(html.includes("Edit"));
  assert.ok(html.includes("Deactivate"));
  assert.ok(html.includes("Delete"));
  assert.ok(html.includes("/v1/dashboard/numbers"));
});
