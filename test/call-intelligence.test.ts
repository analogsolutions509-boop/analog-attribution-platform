import test from "node:test";
import assert from "node:assert/strict";
import { callIntelligenceSchema } from "../src/call-intelligence/schema.ts";

test("call intelligence requires auditable extracted fields", () => {
  assert.equal(callIntelligenceSchema.type, "object");
  assert.deepEqual(
    callIntelligenceSchema.required.slice(-2),
    ["confidence", "extracted_fields"]
  );
  assert.equal(
    callIntelligenceSchema.properties.construction_requirements.properties.delivery_location.anyOf[1].type,
    "null"
  );
});

test("call intelligence is closed for strict structured output", () => {
  assert.equal(callIntelligenceSchema.additionalProperties, false);
  assert.equal(callIntelligenceSchema.properties.construction_requirements.additionalProperties, false);
  assert.equal(callIntelligenceSchema.properties.extracted_fields.items.additionalProperties, false);
});
