import test from "node:test";
import assert from "node:assert/strict";
import {
  getDashboardAccessMessage,
  isAllowedDashboardEmail,
  normalizeDashboardEmail
} from "../src/dashboard-access.js";

test("normalizes dashboard emails for case-insensitive matching", () => {
  assert.equal(normalizeDashboardEmail(" Owner@Example.COM "), "owner@example.com");
});

test("allows exact configured email addresses", () => {
  assert.equal(isAllowedDashboardEmail("owner@example.com", "admin@example.com, owner@example.com", false), true);
  assert.equal(isAllowedDashboardEmail("other@example.com", "admin@example.com,owner@example.com", false), false);
});

test("allows any authenticated user only when explicitly enabled", () => {
  assert.equal(isAllowedDashboardEmail("other@example.com", "", true), true);
  assert.equal(isAllowedDashboardEmail("other@example.com", "", false), false);
});

test("denies missing email", () => {
  assert.equal(isAllowedDashboardEmail("", "owner@example.com", true), false);
});

test("explains which authenticated account was denied dashboard access", () => {
  assert.equal(
    getDashboardAccessMessage("owner@example.com", "access_not_configured"),
    "Authenticated as owner@example.com, but this account is not authorized for dashboard access."
  );
  assert.equal(
    getDashboardAccessMessage("owner@example.com", "email_not_verified"),
    "Authenticated as owner@example.com, but the email address is not verified."
  );
});
