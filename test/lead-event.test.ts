import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLeadOSEvent } from "../src/lead-event.ts";

test("lead OS event includes canonical site identity and lead data", () => {
  const event = buildLeadOSEvent(
    {
      siteId: "site-1",
      source: "website_form",
      customerName: "Test Customer",
      customerPhone: "+447000000000",
      customerEmail: "test@example.invalid",
      serviceType: "ready mix concrete",
      requirements: { quantity: "6m3" },
      summary: "C30 concrete for Birmingham"
    },
    "lead-1",
    "supplier-1",
    {
      name: "Rebar Birmingham",
      hostname: "rebarbirmingham.co.uk",
      supplierName: "Chorley's Concrete",
      supplierEmail: "orders@example.invalid"
    }
  );

  assert.equal(event.lead_id, "lead-1");
  assert.equal(event.site_id, "site-1");
  assert.equal(event.site_name, "Rebar Birmingham");
  assert.equal(event.hostname, "rebarbirmingham.co.uk");
  assert.equal(event.supplier_id, "supplier-1");
  assert.equal(event.supplier_name, "Chorley's Concrete");
  assert.equal(event.supplier_email, "orders@example.invalid");
  assert.equal(event.customer_name, "Test Customer");
  assert.equal(event.service_type, "ready mix concrete");
});
