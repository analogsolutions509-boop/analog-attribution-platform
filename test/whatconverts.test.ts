import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWhatConvertsCall,
  isWhatConvertsPhoneCall,
  verifyWhatConvertsWebhook
} from "../src/providers/whatconverts.ts";

test("recognizes a WhatConverts phone-call webhook", () => {
  assert.equal(isWhatConvertsPhoneCall({
    lead_type: "Phone Call",
    lead_id: 153928
  }), true);
  assert.equal(isWhatConvertsPhoneCall({ lead_type: "Web Form", lead_id: 153928 }), false);
});

test("normalizes a completed WhatConverts call", () => {
  const result = normalizeWhatConvertsCall({
    trigger: "new",
    lead_id: 153928,
    lead_type: "Phone Call",
    lead_state: "Completed",
    call_status: "Completed",
    date_created: "2026-10-02T08:00:00Z",
    last_updated: "2026-10-02T08:04:00Z",
    tracking_number: "+441615550100",
    destination_number: "+447877310707",
    caller_number: "+447000111222",
    caller_name: "Test Caller",
    call_duration_seconds: 202,
    answer_status: "Answered",
    recording: "https://app.whatconverts.com/recording/13451345/download",
    play_recording: "https://app.whatconverts.com/recording/13451345/play"
  });

  assert.deepEqual(result, {
    providerCallId: "wc-153928",
    leadId: "153928",
    callerNumber: "+447000111222",
    calledNumber: "+441615550100",
    destinationNumber: "+447877310707",
    direction: "inbound",
    status: "completed",
    startedAt: "2026-10-02T08:00:00Z",
    endedAt: "2026-10-02T08:03:22.000Z",
    durationSeconds: 202,
    recordingUrl: "https://app.whatconverts.com/recording/13451345/download",
    recordingMimeType: undefined,
    answerStatus: "Answered"
  });
});

test("normalizes an in-progress call without inventing duration or recording", () => {
  const result = normalizeWhatConvertsCall({
    trigger: "new",
    lead_id: 153929,
    lead_type: "Phone Call",
    lead_state: "In Progress",
    call_status: "In Progress",
    date_created: "2026-10-02T08:00:00Z",
    tracking_number: "+441615550100",
    destination_number: "+447877310707",
    caller_number: "+447000111222"
  });

  assert.equal(result?.providerCallId, "wc-153929");
  assert.equal(result?.status, "in-progress");
  assert.equal(result?.durationSeconds, undefined);
  assert.equal(result?.recordingUrl, undefined);
});

test("accepts the shared provider secret", () => {
  assert.equal(verifyWhatConvertsWebhook("secret-1234567890123456", "secret-1234567890123456"), true);
  assert.equal(verifyWhatConvertsWebhook("wrong", "secret-1234567890123456"), false);
});
