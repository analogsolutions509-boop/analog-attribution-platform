import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashAgentToken } from "../src/presspilot-core.js";

test("agent token hashes can be reproduced by the WordPress agent", () => {
  const token = "known-high-entropy-agent-token";
  const expected = createHash("sha256").update(token, "utf8").digest("hex");
  assert.equal(hashAgentToken(token, "server-secret"), expected);
});
