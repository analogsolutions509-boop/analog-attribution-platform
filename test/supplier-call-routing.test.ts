import test from "node:test";
import assert from "node:assert/strict";
import { supplierInboundWhisper } from "../src/supplier-call-routing.js";

test("supplier inbound whisper identifies supplier and site", () => {
  assert.equal(
    supplierInboundWhisper({supplierName:"Chorley's Concrete",siteName:"Birmingham Ready Mix"}),
    "Supplier call from Chorley's Concrete regarding Birmingham Ready Mix."
  );
});

test("supplier inbound whisper falls back safely", () => {
  assert.equal(supplierInboundWhisper({supplierName:"Supplier",siteName:""}), "Supplier call from Supplier.");
});
