import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("GET /presspilot serves the PressPilot command center", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/presspilot" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.match(response.body, /PressPilot/);
  } finally {
    await app.close();
  }
});
