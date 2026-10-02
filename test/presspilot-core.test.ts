import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  normalizeWordPressUrl,
  validatePressPilotPlan
} from "../src/presspilot-core.js";

test("normalizes a WordPress site URL to an origin", () => {
  assert.equal(normalizeWordPressUrl("https://Example.com/path/"), "https://example.com");
});

test("round-trips encrypted WordPress application passwords", () => {
  const encrypted = encryptSecret("app-password-123", "a".repeat(32));
  assert.notEqual(encrypted, "app-password-123");
  assert.equal(decryptSecret(encrypted, "a".repeat(32)), "app-password-123");
});

test("accepts only the supported PressPilot operations", () => {
  const plan = validatePressPilotPlan({
    operations: [
      { op: "list_pages", args: { search: "Ready Mix" } },
      { op: "update_page", args: { id: 42, title: "Ready Mix Concrete Manchester" } }
    ]
  });
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[1].op, "update_page");
});

test("rejects arbitrary code or REST passthrough operations", () => {
  assert.throws(
    () => validatePressPilotPlan({ operations: [{ op: "execute_code", args: { code: "rm -rf /" } }] }),
    /unsupported_operation/
  );
});
