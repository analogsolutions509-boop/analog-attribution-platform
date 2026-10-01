import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardSession, verifyDashboardSession, verifyDashboardCredentials } from "../src/dashboard-auth.js";

test("dashboard session round-trips and expires", () => {
  const cookie = createDashboardSession("admin", "a-secret-value", 1_000, 3_600);
  assert.equal(verifyDashboardSession(cookie, "a-secret-value", 2_000), "admin");
  assert.equal(verifyDashboardSession(cookie, "a-secret-value", 4_601_000), null);
});

test("dashboard credentials accept only the configured username and password", () => {
  assert.equal(verifyDashboardCredentials("admin", "secret-123456", "admin", "secret-123456"), true);
  assert.equal(verifyDashboardCredentials("admin", "wrong-password", "admin", "secret-123456"), false);
  assert.equal(verifyDashboardCredentials("other", "secret-123456", "admin", "secret-123456"), false);
});

test("dashboard session rejects tampering and wrong secrets", () => {
  const cookie = createDashboardSession("admin", "a-secret-value", 1_000, 3_600);
  const parts = cookie.split(".");
  const tampered = `admin|4600|tampered.${parts[1]}`;
  assert.equal(verifyDashboardSession(tampered, "a-secret-value", 2_000), null);
  assert.equal(verifyDashboardSession(cookie, "wrong-secret", 2_000), null);
  assert.equal(verifyDashboardSession("", "a-secret-value", 2_000), null);
});
