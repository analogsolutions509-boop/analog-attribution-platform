import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collectorRoutePath = new URL("../src/routes/collector.ts", import.meta.url);

test("server collector waits for page-view ingestion before requesting a tracking number", async () => {
  const source = await readFile(collectorRoutePath, "utf8");
  const pageView = source.indexOf('const pageViewReady = send("page_view");');
  const assignment = source.indexOf("pageViewReady.then(() => fetch(PU");

  assert.notEqual(pageView, -1, "page-view request must be retained as a promise");
  assert.notEqual(assignment, -1, "number assignment must wait for that promise");
  assert.ok(pageView < assignment, "page-view ingestion must be initiated before number assignment");
});
