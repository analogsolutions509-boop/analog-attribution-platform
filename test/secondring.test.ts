import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSecondRingCall,
  verifyWebhookSecret
} from "../src/providers/secondring.ts";

test("provider secret comparison is exact and length-safe", () => {
  assert.equal(verifyWebhookSecret("secret-123", "secret-123"), true);
  assert.equal(verifyWebhookSecret("secret-12", "secret-123"), false);
  assert.equal(verifyWebhookSecret("wrong", "secret-123"), false);
  assert.equal(verifyWebhookSecret(undefined, "secret-123"), false);
});

test("normalizes a flat call payload into the canonical call shape", () => {
  const result = normalizeSecondRingCall({
    id: "sr-call-1",
    from: "+44 7000 111222",
    to: "+44 161 5550100",
    started_at: "2026-10-01T08:00:00Z",
    duration: 93,
    recording_url: "https://recordings.example.com/a.mp3"
  });

  assert.deepEqual(result, {
    providerCallId: "sr-call-1",
    callerNumber: "+44 7000 111222",
    calledNumber: "+44 161 5550100",
    direction: undefined,
    startedAt: "2026-10-01T08:00:00Z",
    endedAt: undefined,
    durationSeconds: 93,
    recordingUrl: "https://recordings.example.com/a.mp3",
    recordingMimeType: undefined,
    siteId: undefined
  });
});
test("normalizes nested and camelCase provider fields", () => {
  const result = normalizeSecondRingCall({
    data: {
      call: {
        callId: "sr-call-2",
        caller_number: "+44 7000 333444",
        destination: "+44 161 5550100",
        recording: { url: "https://recordings.example.com/b.wav", mime_type: "audio/wav" },
        duration_seconds: 120,
        siteId: "site-123"
      }
    }
  });

  assert.equal(result?.providerCallId, "sr-call-2");
  assert.equal(result?.callerNumber, "+44 7000 333444");
  assert.equal(result?.calledNumber, "+44 161 5550100");
  assert.equal(result?.durationSeconds, 120);
  assert.equal(result?.recordingMimeType, "audio/wav");
  assert.equal(result?.siteId, "site-123");
});

test("rejects payloads without a stable provider call id", () => {
  assert.equal(normalizeSecondRingCall({ from: "+44 7000 111222" }), null);
});
