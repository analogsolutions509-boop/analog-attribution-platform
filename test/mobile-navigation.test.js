import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("phone layout retains primary navigation and stable touch targets", async () => {
  const html = await readFile(join(process.cwd(), "public", "dashboard.html"), "utf8");
  assert.match(html, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.side\s*\{[^}]*display:\s*block/s);
  assert.match(html, /\.nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /min-height:\s*44px/);
  assert.match(html, /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{/);
});
