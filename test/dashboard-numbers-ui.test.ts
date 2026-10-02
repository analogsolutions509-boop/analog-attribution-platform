import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dashboard exposes a Numbers side-panel page", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");

  assert.ok(html.includes('data-view="numbers">Numbers</button>'));
  assert.ok(html.includes('id="numbersView"'));
  assert.ok(html.includes('id="numbersTable"'));
  assert.ok(html.includes("Forwarding number"));
  assert.ok(html.includes('src="/numbers.js"'));
  assert.ok(html.includes('api("/v1/dashboard/numbers"+q)'));
});
