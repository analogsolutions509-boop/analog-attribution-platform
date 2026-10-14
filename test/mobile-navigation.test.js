import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("mobile layout keeps primary dashboard navigation available by touch", async () => {
  const html = await readFile(join(process.cwd(), "public", "dashboard.html"), "utf8");
  assert.match(html, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.side\s*\{[^}]*display:\s*block/s);
  assert.match(html, /\.nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /min-height:\s*44px/);
});
