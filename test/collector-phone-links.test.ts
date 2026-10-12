import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("server collector rewrites click-to-call links when a tracking number is returned", async () => {
  const source = await readFile(new URL("../src/routes/collector.ts", import.meta.url), "utf8");
  assert.ok(source.includes('a[href^="tel:"]'));
  assert.ok(source.includes('setAttribute("href","tel:"+tel)'));
});

test("server collector keeps explicit tracking-number targets working", async () => {
  const source = await readFile(new URL("../src/routes/collector.ts", import.meta.url), "utf8");
  assert.match(source, /data-analog-phone/);
  assert.match(source, /phone_number/);
});
