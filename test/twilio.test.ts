import test from "node:test";
import assert from "node:assert/strict";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks.js";
import {
  normalizeTwilioCall,
  validateTwilioRequest,
  buildIncomingCallTwiml,
  isTerminalTwilioStatus,
  buildCustomerConferenceTwiml,
  buildOperatorWhisperTwiml,
  buildSupplierBridgeTwiml
} from "../src/providers/twilio.ts";

test("normalizes an incoming Twilio voice webhook", () => {
  const result = normalizeTwilioCall({
    CallSid: "CA123",
    AccountSid: "AC123",
    From: "+447000111222",
    To: "+441615550100",
    Direction: "inbound",
    CallStatus: "in-progress",
    Timestamp: "Thu, 01 Oct 2026 18:30:00 +0000"
  });

  assert.deepEqual(result, {
    providerCallId: "CA123",
    callerNumber: "+447000111222",
    calledNumber: "+441615550100",
    direction: "inbound",
    status: "in-progress",
    startedAt: "Thu, 01 Oct 2026 18:30:00 +0000",
    endedAt: undefined,
    durationSeconds: undefined
  });
});

test("validates Twilio's signed form webhook", () => {
  const authToken = "12345";
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212"
  };
  const signature = getExpectedTwilioSignature(authToken, url, params);

  assert.equal(validateTwilioRequest(url, params, signature, authToken), true);
  assert.equal(validateTwilioRequest(url, params, "not-valid", authToken), false);
});

test("builds TwiML that records the call and bridges it to the configured destination", () => {
  const xml = buildIncomingCallTwiml(
    "+447886074706",
    "https://api.example.com/v1/providers/twilio/status",
    "https://api.example.com/v1/providers/twilio/recording"
  );

  assert.ok(xml.includes("<Dial"));
  assert.ok(xml.includes('answerOnBridge="true"'));
  assert.ok(!xml.includes("callerId="), "the supplier should receive the original caller ID, not the tracking number");
  assert.ok(xml.includes('record="record-from-ringing-dual"'));
  assert.ok(xml.includes('recordingStatusCallback="https://api.example.com/v1/providers/twilio/recording"'));
  assert.ok(xml.includes('statusCallback="https://api.example.com/v1/providers/twilio/status"'));
  assert.ok(xml.includes('statusCallbackEvent="initiated ringing answered completed"'));
  assert.ok(xml.includes(">+447886074706</Number>"));
});

test("builds automatic direct-dial TwiML with recording notice and ranked-fallback callback", () => {
  const xml = buildIncomingCallTwiml(
    "+447886074706",
    undefined,
    "https://api.example.com/v1/providers/twilio/recording?callId=call-123",
    "https://api.example.com/v1/providers/twilio/dial-result?callId=call-123&attemptIndex=0"
  );

  assert.ok(xml.includes("This call may be recorded for quality assurance purposes."));
  assert.ok(xml.includes('action="https://api.example.com/v1/providers/twilio/dial-result?callId=call-123&amp;attemptIndex=0"'));
  assert.ok(!xml.includes("callerId="), "direct dialing must preserve the caller's number and avoid callback loops");
  assert.ok(xml.includes('recordingStatusCallback="https://api.example.com/v1/providers/twilio/recording?callId=call-123"'));
  assert.ok(xml.includes('record="record-from-ringing-dual"'));
  assert.ok(xml.includes(">+447886074706</Number>"));
  assert.ok(!xml.includes("statusCallbackEvent="));
});

test("normalizes Dial status callbacks and duration", () => {
  const result = normalizeTwilioCall({
    CallSid: "CA456",
    From: "+447000111222",
    To: "+441615550100",
    DialCallStatus: "completed",
    DialCallDuration: "143"
  });
  assert.equal(result?.status, "completed");
  assert.equal(result?.durationSeconds, 143);
});

test("recognizes terminal Twilio call states", () => {
  assert.equal(isTerminalTwilioStatus("completed"), true);
  assert.equal(isTerminalTwilioStatus("busy"), true);
  assert.equal(isTerminalTwilioStatus("failed"), true);
  assert.equal(isTerminalTwilioStatus("no-answer"), true);
  assert.equal(isTerminalTwilioStatus("ringing"), false);
  assert.equal(isTerminalTwilioStatus("in-progress"), false);
});

test("builds the free-trial customer conference flow", () => {
  const xml = buildCustomerConferenceTwiml("analog-abc123", "https://api.example.com/v1/providers/twilio/conference");
  assert.ok(xml.includes("<Conference"));
  assert.ok(xml.includes("analog-abc123"));
  assert.ok(xml.includes('startConferenceOnEnter="true"'));
  assert.ok(xml.includes('record="record-from-start"'));
  assert.ok(xml.includes('recordingStatusCallback="https://api.example.com/v1/providers/twilio/conference"'));
  assert.ok(xml.includes('recordingStatusCallbackEvent="in-progress completed absent"'));
  assert.ok(xml.includes("quality assurance purposes"));
  assert.ok(!xml.includes('waitUrl=""'), "conference should use Twilio's default hold music instead of silence");
});

test("whispers the website to the operator and then joins the live customer conference for dashboard transfers", () => {
  const xml = buildOperatorWhisperTwiml("analog-abc123", "https://api.example.com/v1/providers/twilio/operator/action", "Birmingham Ready Mix", "+447000111222");
  assert.ok(xml.includes("This call is from Birmingham Ready Mix"));
  assert.ok(xml.includes("+447000111222"));
  assert.ok(xml.includes("quality assurance"));
  assert.ok(xml.includes("<Conference"));
  assert.ok(xml.includes("analog-abc123"));
  assert.ok(xml.includes('startConferenceOnEnter="true"'));
  assert.ok(!xml.includes("<Gather"), "primary supplier transfer uses the dashboard buttons, not a keypad call-centre menu");
});

test("builds the supplier conference leg", () => {
  const xml = buildSupplierBridgeTwiml("analog-abc123", "Chorley's Concrete");
  assert.ok(xml.includes("Chorley's Concrete"));
  assert.ok(xml.includes("analog-abc123"));
});

import { buildSupplierWhisperTwiml } from "../src/providers/twilio.ts";

test("builds a supplier-side whisper identifying the originating website without exposing the caller number", () => {
  const xml = buildSupplierWhisperTwiml("Birmingham Ready Mix", "Primary supplier");
  assert.ok(xml.includes("Analog Solutions"));
  assert.ok(xml.includes("Birmingham Ready Mix"));
  assert.ok(xml.includes("Primary supplier"));
  assert.ok(xml.includes("recorded"));
  assert.ok(!xml.includes("+447000111222"));
});

test("executes the supplier whisper on the called leg before bridging", () => {
  const xml = buildIncomingCallTwiml(
    "+442071234567",
    undefined,
    "https://api.example.com/v1/providers/twilio/recording?callId=call-123&attemptIndex=0",
    "https://api.example.com/v1/providers/twilio/dial-result?callId=call-123&attemptIndex=0",
    true,
    "https://api.example.com/v1/providers/twilio/supplier-whisper"
  );
  assert.ok(xml.includes('url="https://api.example.com/v1/providers/twilio/supplier-whisper"'));
  assert.ok(xml.includes('method="POST"'));
});
