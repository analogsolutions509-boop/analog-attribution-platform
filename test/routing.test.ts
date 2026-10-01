import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../src/utils/phone.js";

test("phone normalization strips formatting", () => {
  assert.equal(normalizePhone("+44 (0) 161 555 0100"), "4401615550100");
});

test("invalid short phone values are ignored", () => {
  assert.equal(normalizePhone("12345"), null);
});
