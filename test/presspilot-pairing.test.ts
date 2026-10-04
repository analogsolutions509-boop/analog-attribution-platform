import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  generateAgentToken,
  hashAgentToken,
  generatePairingCode,
  hashPairingCode,
  isPairingCodeFormatValid,
  generateEnrollmentToken,
  hashEnrollmentToken,
  isPressPilotBridgeSecretValid
} from "../src/presspilot-core.js";

test("generates a human-enterable pairing code", () => {
  const code = generatePairingCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{6}$/);
  assert.equal(isPairingCodeFormatValid(code), true);
});

test("pairing codes hash deterministically without storing the raw code", () => {
  const code = "ABCD-234567";
  const a = hashPairingCode(code, "test-secret-12345678");
  const b = hashPairingCode(code, "test-secret-12345678");
  assert.equal(a, b);
  assert.notEqual(a, code);
});

test("agent tokens are high-entropy and unique", () => {
  const a = generateAgentToken();
  const b = generateAgentToken();
  assert.equal(typeof a, "string");
  assert.ok(a.length >= 40);
  assert.notEqual(a, b);
});
test("pairing code format rejects lookalike and malformed values", () => {
  assert.equal(isPairingCodeFormatValid("ABCD-234567"), true);
  assert.equal(isPairingCodeFormatValid("ABCD-23456"), false);
  assert.equal(isPairingCodeFormatValid("abcd-234567"), false);
  assert.equal(isPairingCodeFormatValid("ABCD-IO4567"), false);
});


test("enrollment tokens are high-entropy and unique", () => {
  const a = generateEnrollmentToken();
  const b = generateEnrollmentToken();
  assert.ok(a.length >= 40);
  assert.notEqual(a, b);
});

test("enrollment tokens hash deterministically without storing the raw token", () => {
  const token = generateEnrollmentToken();
  const a = hashEnrollmentToken(token, "test-secret-12345678");
  const b = hashEnrollmentToken(token, "test-secret-12345678");
  assert.equal(a, b);
  assert.notEqual(a, token);
});

test("enrollment token hashes are secret-bound", () => {
  const token = "enrollment-token-example";
  assert.notEqual(
    hashEnrollmentToken(token, "secret-one"),
    hashEnrollmentToken(token, "secret-two")
  );
});

test("MainWP bridge secret comparison is exact and safe for length mismatches", () => {
  const secret = "mainwp-secret-example-0123456789";
  assert.equal(isPressPilotBridgeSecretValid(secret, secret), true);
  assert.equal(isPressPilotBridgeSecretValid(secret + "x", secret), false);
  assert.equal(isPressPilotBridgeSecretValid("", ""), false);
  assert.equal(isPressPilotBridgeSecretValid("wrong-secret", secret), false);
});
