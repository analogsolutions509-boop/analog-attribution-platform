import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overview displays a live registered websites metric", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");

  assert.match(html, /\["Websites",state\.sites\.length,"Registered websites"\]/);
});
