import test from "node:test";
import assert from "node:assert/strict";
import { extensionForMimeType, isSafeRecordingUrl } from "../src/call-recording.ts";

test("recording MIME types map to safe archive extensions", () => {
  assert.equal(extensionForMimeType("audio/mpeg"), "mp3");
  assert.equal(extensionForMimeType("audio/wav"), "wav");
  assert.equal(extensionForMimeType("audio/x-wav"), "wav");
});

test("unknown recording MIME types use a safe binary extension", () => {
  assert.equal(extensionForMimeType("application/octet-stream"), "bin");
});

test("recording URLs must use HTTPS and reject local targets", () => {
  assert.equal(isSafeRecordingUrl("https://recordings.example.com/call.mp3"), true);
  assert.equal(isSafeRecordingUrl("http://recordings.example.com/call.mp3"), false);
  assert.equal(isSafeRecordingUrl("https://localhost/call.mp3"), false);
  assert.equal(isSafeRecordingUrl("https://127.0.0.1/call.mp3"), false);
  assert.equal(isSafeRecordingUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeRecordingUrl("https://user:pass@recordings.example.com/call.mp3"), false);
});
