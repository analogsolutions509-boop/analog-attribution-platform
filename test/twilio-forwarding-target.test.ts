import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildTwilioDialPlan,
  resolveTwilioOperatorTarget,
  type TwilioSupplierRoute
} from "../src/providers/twilio-routing.ts";

const supplier = (
  supplierId: string,
  supplierName: string,
  destination: string,
  rank: number
): TwilioSupplierRoute => ({ supplierId, supplierName, destination, rank });

test("puts the assigned primary supplier first, followed by ranked fallbacks", () => {
  const plan = buildTwilioDialPlan(
    supplier("primary", "Assigned Primary", "+442071234567", 3),
    [
      supplier("rank-two", "Rank Two", "+442079876543", 2),
      supplier("rank-one", "Rank One", "+442071111111", 1)
    ]
  );
  assert.deepEqual(plan.map((target) => target.supplierId), [
    "primary",
    "rank-one",
    "rank-two"
  ]);
});

test("uses ranked supplier order when no tracking-number primary supplier is assigned", () => {
  const plan = buildTwilioDialPlan(null, [
    supplier("rank-three", "Rank Three", "+442071111113", 3),
    supplier("rank-one", "Rank One", "+442071111111", 1),
    supplier("rank-two", "Rank Two", "+442071111112", 2)
  ]);
  assert.deepEqual(plan.map((target) => target.supplierId), [
    "rank-one",
    "rank-two",
    "rank-three"
  ]);
});

test("filters invalid destinations and prevents duplicate destination numbers", () => {
  const plan = buildTwilioDialPlan(
    supplier("primary", "Primary", "+442071234567", 1),
    [
      supplier("duplicate", "Same number, different formatting", "+44 (20) 7123 4567", 2),
      supplier("url", "Not a telephone number", "https://supplier.example/lead", 3),
      supplier("invalid", "Invalid value", "not a phone number", 4),
      supplier("valid", "Valid Fallback", "+442071234568", 5)
    ],
    "https://not-a-phone.example"
  );
  assert.deepEqual(plan.map((target) => target.supplierId), ["primary", "valid"]);
});

test("uses a configured global forward target only after suppliers", () => {
  const plan = buildTwilioDialPlan(
    null,
    [supplier("supplier", "Supplier", "020 7123 4567", 1)],
    "+447700900123"
  );
  assert.deepEqual(plan.map((target) => target.destination), [
    "+442071234567",
    "+447700900123"
  ]);
  assert.equal(plan[1].supplierId, null);
});

test("does not append a legacy forward target when it duplicates a supplier number", () => {
  const plan = buildTwilioDialPlan(
    null,
    [supplier("supplier", "Supplier", "+447700900123", 1)],
    "07700 900123"
  );
  assert.equal(plan.length, 1);
});

test("legacy operator-target helper remains backwards compatible", () => {
  assert.equal(
    resolveTwilioOperatorTarget("+442071234567", "+447700900123"),
    "+442071234567"
  );
  assert.equal(resolveTwilioOperatorTarget(undefined, "+447700900123"), "+447700900123");
  assert.equal(resolveTwilioOperatorTarget(null, undefined), null);
});

test("incoming Twilio calls use direct dial plans and the ranked fallback callback", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const voiceStart = source.indexOf('app.post("/v1/providers/twilio/voice"');
  const operatorStart = source.indexOf('app.post("/v1/providers/twilio/operator"', voiceStart);
  assert.ok(voiceStart >= 0, "incoming voice webhook should exist");
  assert.ok(operatorStart > voiceStart, "the voice and dial-result routes should precede legacy operator routes");
  const incomingRoutes = source.slice(voiceStart, operatorStart);
  assert.ok(source.includes("buildTwilioDialPlan"));
  assert.ok(incomingRoutes.includes("getTwilioDialPlan"));
  assert.ok(incomingRoutes.includes("buildAutomaticDialResponse"));
  assert.ok(incomingRoutes.includes('app.post("/v1/providers/twilio/dial-result"'));
  assert.ok(incomingRoutes.includes("nextIndex < plan.length"));
  assert.ok(!incomingRoutes.includes("startOperatorCall"));
  assert.ok(!incomingRoutes.includes("buildCustomerConferenceTwiml"));
});

test("Twilio recording callbacks resolve the original inbound call by callId", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const recordingStart = source.indexOf('app.post("/v1/providers/twilio/recording"');
  assert.ok(recordingStart >= 0);
  const recordingRoute = source.slice(recordingStart);
  assert.ok(recordingRoute.includes("requestedCallId"));
  assert.ok(recordingRoute.includes("recording_status='ready'"));
  assert.ok(recordingRoute.includes('createJob("call.process"'));
  assert.ok(recordingRoute.includes("requestedAttemptIndex < plan.length - 1"));
  assert.ok(recordingRoute.includes('reason: "fallback_pending"'));
  assert.ok(recordingRoute.includes("queueCallCompletionNotifications(String(call.id))"));
});

test("dial-leg status callbacks can close the parent call if Dial action is not delivered", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/v1/providers/twilio/transfer-status"');
  const end = source.indexOf('app.post("/v1/providers/twilio/operator/action"', start);
  assert.ok(start >= 0 && end > start);
  const statusRoute = source.slice(start, end);
  assert.ok(statusRoute.includes("ParentCallSid"));
  assert.ok(statusRoute.includes('["completed", "canceled"].includes(rawStatus)'));
  assert.ok(statusRoute.includes("queueCallCompletionNotifications(callId)"));
});

test("direct-dial recording callbacks are tied to the current supplier attempt", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  assert.ok(source.includes('callbackWithQuery("/v1/providers/twilio/recording", { callId, attemptIndex: String(attemptIndex) })'));
  assert.ok(source.includes('["absent", "failed"].includes(String(call.recording_status ?? "").toLowerCase())'));
  assert.ok(source.includes('["completed", "no-answer", "failed", "canceled"].includes(String(call.status ?? "").toLowerCase())'));
  assert.ok(source.includes('fallbackPending = !terminal && requestedAttemptIndex < plan.length - 1'));
});

test("dashboard does not show manual transfer controls for automatically routed Twilio calls", async () => {
  const source = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");
  assert.ok(source.includes("Automatic supplier routing"));
  assert.ok(source.includes('if(call.provider==="twilio"&&(!call.conference_name||!call.operator_call_sid))'));
});

test("includes the tracking number's assigned primary supplier even if it is not ranked separately", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function getTwilioDialPlan(");
  const end = source.indexOf("async function buildAutomaticDialResponse(", start);
  assert.ok(start >= 0 && end > start, "Twilio dial-plan resolver should exist");
  const resolver = source.slice(start, end);
  assert.ok(
    resolver.includes('OR s.id=$2'),
    "the primary supplier must be fetched even when it has no site_suppliers row"
  );
});

test("normalizes UK supplier phone numbers to E.164 before dialing", () => {
  const plan = buildTwilioDialPlan(null, [
    supplier("landline", "UK landline", "020 7123 4567", 1),
    supplier("mobile", "UK mobile", "07700 900123", 2),
    supplier("international", "International form", "0044 161 555 0100", 3)
  ]);
  assert.deepEqual(plan.map((target) => target.destination), [
    "+442071234567",
    "+447700900123",
    "+441615550100"
  ]);
});

test("validates the supplier whisper callback and returns the generated whisper TwiML", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  assert.ok(source.includes('app.post("/v1/providers/twilio/supplier-whisper"'));
  assert.ok(source.includes("twilioAuthorized(request)"));
  assert.ok(source.includes("buildSupplierWhisperTwiml(websiteName, supplierName)"));
  assert.ok(source.includes("supplierWhisperUrl"));
});
