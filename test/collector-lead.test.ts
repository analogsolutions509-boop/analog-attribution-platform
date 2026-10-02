import test from "node:test";
import assert from "node:assert/strict";
import { extractLeadPayload, shouldAutoCaptureForm } from "../src/collector-lead.ts";

test("extracts common Elementor/WordPress lead fields", () => {
  const result = extractLeadPayload({
    "form_fields[name]": " Jane Smith ",
    "form_fields[email]": "jane@example.com",
    "form_fields[phone]": "+44 7700 900123",
    "form_fields[message]": "Need 8m3 C30",
    "form_fields[service]": "Ready Mix Concrete"
  });
  assert.deepEqual(result, {
    name: "Jane Smith", phone: "+44 7700 900123", customer_phone: "+44 7700 900123", email: "jane@example.com", customer_email: "jane@example.com", service_type: "Ready Mix Concrete", message: "Need 8m3 C30"
  });
});

test("does not create a lead from forms without contact identity", () => {
  assert.equal(shouldAutoCaptureForm({ search: "concrete" }), false);
});

test("captures phone-only and email-only forms", () => {
  assert.ok(extractLeadPayload({ telephone: "+441234567890" }));
  assert.ok(extractLeadPayload({ email_address: "lead@example.com" }));
});
