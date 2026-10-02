import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalogOSPullUrl,
  canonicalHostname,
  getPreviousLondonDateKey,
  normalizeOSLead,
  normalizeEmail,
  normalizePhoneDigits,
  shouldQueueDailyReconciliation,
  signAnalogOSRequest,
  validateReconciliationDate,
  verifyAnalogOSExport
} from "../src/analog-os-reconciliation.ts";

test("validates only real ISO calendar dates", () => {
  assert.equal(validateReconciliationDate("2026-10-02"), "2026-10-02");
  assert.throws(() => validateReconciliationDate("2026-02-30"), /invalid_reconciliation_date/);
  assert.throws(() => validateReconciliationDate("02-10-2026"), /invalid_reconciliation_date/);
});

test("builds the OS reconciliation route from the base web app URL", () => {
  assert.equal(
    buildAnalogOSPullUrl("https://example.test/exec"),
    "https://example.test/exec?route=analog-attribution-reconcile"
  );
  assert.equal(
    buildAnalogOSPullUrl("https://example.test/exec?x=1"),
    "https://example.test/exec?x=1&route=analog-attribution-reconcile"
  );
});

test("normalizes OS lead identity fields without changing the lead source id", () => {
  const lead = normalizeOSLead({
    source: "WHATCONVERTS",
    lead_id: "153928",
    website_url: "https://www.readymixmanchester.co.uk/",
    customer_email: " BUYER@EXAMPLE.COM ",
    customer_phone: "+44 7000 111222",
    summary: "Need C30 concrete"
  });
  assert.equal(lead.source_record, "WHATCONVERTS:153928");
  assert.equal(lead.website, "readymixmanchester.co.uk");
  assert.equal(lead.customer_email, "buyer@example.com");
  assert.equal(lead.customer_phone, "+44 7000 111222");
  assert.equal(lead.enquiry, "Need C30 concrete");
});

test("normalizes matching primitives consistently", () => {
  assert.equal(canonicalHostname("https://WWW.Example.com/path"), "example.com");
  assert.equal(normalizeEmail(" A@Example.COM "), "a@example.com");
  assert.equal(normalizePhoneDigits("+44 (7000) 111-222"), "447000111222");
});

test("uses the UK calendar day when scheduling yesterday reconciliation", () => {
  const late = new Date("2026-10-02T23:30:00Z");
  assert.equal(getPreviousLondonDateKey(late), "2026-10-02");
  assert.equal(shouldQueueDailyReconciliation(new Date("2026-10-02T00:30:00Z")), false);
  assert.equal(shouldQueueDailyReconciliation(new Date("2026-10-02T02:30:00Z")), true);
});

test("creates deterministic request signatures", () => {
  const body = JSON.stringify({ date: "2026-10-02", request_id: "abc" });
  const first = signAnalogOSRequest(body, "test-secret");
  const second = signAnalogOSRequest(body, "test-secret");
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("verifies the OS signature before transport normalization changes lead fields", () => {
  const payload = {
    ok: true,
    date: "2026-10-02",
    generated_at: "2026-10-02T09:00:00.000Z",
    leads: [{
      source: "EMAIL",
      source_record: "EMAIL:42",
      os_lead_id: "42",
      occurred_at: "2026-10-02T08:00:00.000Z",
      website: "https://www.Example.com/",
      service: "Ready Mix",
      location: "Manchester",
      customer_name: "Buyer",
      customer_email: " BUYER@EXAMPLE.COM ",
      customer_phone: "+44 7000 111222",
      subject: "Concrete",
      enquiry: "Need C30",
      classification: "LEAD",
      confidence: "HIGH",
      assigned_client: "Client",
      forwarded: "YES",
      quote_value: "£500",
      sale_value: "",
      commission_rate: "7%",
      status: "new",
      original_message_id: "msg-42",
      notes: "",
      metadata: {}
    }],
    counts: { total: 1, whatconverts: 0, email: 1 }
  };
  const signature = signAnalogOSRequest(JSON.stringify(payload), "test-secret");
  assert.equal(verifyAnalogOSExport(payload, signature, "test-secret"), true);
  assert.equal(normalizeOSLead(payload.leads[0]).customer_email, "buyer@example.com");
});
