import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const readUi = (name) => readFile(join(root, "public", name));
const readUiText = async (name) => (await readUi(name)).toString("utf8");

test("PWA manifest is standalone and points to real PNG icons", async () => {
  const manifest = JSON.parse(await readUiText("manifest.json"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/dashboard/");
  assert.equal(manifest.scope, "/dashboard/");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/dashboard\/icons\/[a-z0-9-]+\.png$/i);
    const fileName = icon.src.split("/").at(-1);
    const bytes = await readUi("icons/" + fileName);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(icon.sizes === "192x192" || icon.sizes === "512x512");
  }
});

test("dashboard offers install guidance and registers the service worker", async () => {
  const html = await readUiText("dashboard.html");
  assert.match(html, /id="installAppBtn"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /serviceWorker\.register\(["']\/dashboard\/sw\.js["']/);
  assert.match(html, /beforeinstallprompt/);
});

test("service worker does not cache API or authenticated business data", async () => {
  const worker = await readUiText("sw.js");
  assert.match(worker, /url\.pathname\.startsWith\(["']\/v1\/["']\)/);
  assert.match(worker, /caches\.open/);
  assert.match(worker, /\/dashboard\/manifest\.json/);
  assert.match(worker, /startsWith\(["']\/auth\/["']\)/);
});
