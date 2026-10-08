import assert from "node:assert/strict";
import { test } from "node:test";

test("dashboard serves all JavaScript assets referenced by the shell", async () => {
  const [{ buildApp }, { redis }] = await Promise.all([
    import("../src/app.js"),
    import("../src/queue.js")
  ]);
  redis.disconnect();

  const app = buildApp();
  await app.ready();
  try {
    for (const asset of ["/suppliers.js", "/numbers.js", "/onboarding.js"]) {
      const response = await app.inject({ method: "GET", url: asset });
      assert.equal(response.statusCode, 200, asset + " should be served");
      assert.match(
        response.headers["content-type"] ?? "",
        /application\/javascript/,
        asset + " should be JavaScript"
      );
      assert.ok(response.body.length > 50, asset + " should not be empty");
    }
  } finally {
    await app.close();
  }
});
