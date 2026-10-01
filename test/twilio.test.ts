import test from "node:test";
import assert from "node:assert/strict";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks.js";
import {
  normalizeTwilioCall,
  validateTwilioRequest,
  buildIncomingCallTwiml,
  isTerminalTwilioStatus
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
    "+441615550100",
    "+447886074706",
    "https://api.example.com/v1/providers/twilio/status",
    "https://api.example.com/v1/providers/twilio/recording"
  );

  assert.ok(xml.includes("<Dial"));
  assert.ok(xml.includes('answerOnBridge="true"'));
  assert.ok(xml.includes('callerId="+441615550100"'));
  assert.ok(xml.includes('record="record-from-ringing-dual"'));
  assert.ok(xml.includes('recordingStatusCallback="https://api.example.com/v1/providers/twilio/recording"'));
  assert.ok(xml.includes('statusCallback="https://api.example.com/v1/providers/twilio/status"'));
  assert.ok(xml.includes('statusCallbackEvent="initiated ringing answered completed"'));
  assert.ok(xml.includes(">+447886074706</Number>"));
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
