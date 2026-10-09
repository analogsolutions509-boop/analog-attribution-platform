import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCollectorEventLead } from "../src/collector-event-lead.ts";

test("normalizes the payload emitted by the live website collector", () => {
  assert.deepEqual(
    normalizeCollectorEventLead({
      customer_name: " Jane Smith ",
      customer_phone: "+44 7700 900123",
      customer_email: "Jane@Example.com",
      company_name: "Builder Ltd",
      service_type: "Ready Mix Concrete",
      requirements: { quantity: "8m3", grade: "C30" },
      message: "Need delivery on Monday"
    }),
    {
      customerName: "Jane Smith",
      companyName: "Builder Ltd",
      customerPhone: "+44 7700 900123",
      customerEmail: "jane@example.com",
      serviceType: "Ready Mix Concrete",
      requirements: { quantity: "8m3", grade: "C30" },
      summary: "Need delivery on Monday"
    }
  );
});

test("accepts phone-only and email-only enquiries without inventing missing fields", () => {
  assert.deepEqual(normalizeCollectorEventLead({ phone: "+447000000000" }), {
    customerPhone: "+447000000000",
    requirements: {}
  });
  assert.deepEqual(normalizeCollectorEventLead({ email: "x@example.com" }), {
    customerEmail: "x@example.com",
    requirements: {}
  });
});

test("rejects submissions without a contact identity", () => {
  assert.equal(normalizeCollectorEventLead({ message: "Need concrete" }), null);
});
