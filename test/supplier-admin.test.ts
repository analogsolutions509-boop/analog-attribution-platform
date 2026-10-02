import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSupplierInput, supplierDestination } from "../src/supplier-admin.js";

test("supplier onboarding trims fields and defaults to active", () => {
  const supplier = normalizeSupplierInput({
    name: "  Chorley's Concrete  ",
    contact_phone: "  +441234567890  ",
    notification_email: " sales@example.com ",
    endpoint_url: "sip:supplier@example.com"
  });
  assert.equal(supplier.name, "Chorley's Concrete");
  assert.equal(supplier.contact_phone, "+441234567890");
  assert.equal(supplier.notification_email, "sales@example.com");
  assert.equal(supplier.status, "active");
});

test("supplier onboarding accepts paused suppliers and SIP endpoints", () => {
  const supplier = normalizeSupplierInput({
    name: "Supplier B", status: "paused", endpoint_url: "sip:1000@supplier.test"
  });
  assert.equal(supplier.status, "paused");
  assert.equal(supplier.endpoint_url, "sip:1000@supplier.test");
});

test("supplier onboarding requires a name and rejects unsafe endpoints", () => {
  assert.throws(() => normalizeSupplierInput({name: ""}), /name_required/);
  assert.throws(() => normalizeSupplierInput({name: "Supplier", endpoint_url: "javascript:alert(1)"}), /endpoint_url_invalid/);
});

test("supplier destination prefers a phone number, then SIP endpoint", () => {
  assert.equal(supplierDestination({name:"A", contact_phone:"01615550100", endpoint_url:"sip:a@example.com"}), "01615550100");
  assert.equal(supplierDestination({name:"A", contact_phone:null, endpoint_url:"sip:a@example.com"}), "sip:a@example.com");
  assert.equal(supplierDestination({name:"A", contact_phone:null, endpoint_url:null}), null);
});
