import test from "node:test";
import assert from "node:assert/strict";
import { buildSupplierOnboarding } from "../src/supplier-onboarding.js";

test("supplier onboarding requires the complete call route", () => {
  assert.deepEqual(buildSupplierOnboarding({
    siteId:"site-1", supplierId:"supplier-1", trackingNumberId:"tracking-1",
    forwardingNumberId:"forwarding-1", rank:1, active:true
  }), {
    siteId:"site-1", supplierId:"supplier-1", trackingNumberId:"tracking-1",
    forwardingNumberId:"forwarding-1", rank:1, active:true
  });
});

test("supplier onboarding rejects an incomplete route", () => {
  assert.throws(() => buildSupplierOnboarding({
    siteId:"site-1", supplierId:"supplier-1", rank:1, active:true
  }), /tracking_number_id_required/);
  assert.throws(() => buildSupplierOnboarding({
    siteId:"site-1", supplierId:"supplier-1", trackingNumberId:"tracking-1", rank:1, active:true
  }), /forwarding_number_id_required/);
});

test("supplier onboarding validates rank", () => {
  assert.throws(() => buildSupplierOnboarding({
    siteId:"site-1", supplierId:"supplier-1", trackingNumberId:"tracking-1", forwardingNumberId:"forwarding-1", rank:6, active:true
  }), /rank_invalid/);
});
