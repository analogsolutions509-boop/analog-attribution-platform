import test from "node:test";
import assert from "node:assert/strict";
import { extensionForMimeType } from "../src/call-recording.ts";

test("recording MIME types map to safe archive extensions", () => {
  assert.equal(extensionForMimeType("audio/mpeg"), "mp3");
  assert.equal(extensionForMimeType("audio/wav"), "wav");
  assert.equal(extensionForMimeType("audio/x-wav"), "wav");
});

test("unknown recording MIME types use a safe binary extension", () => {
  assert.equal(extensionForMimeType("application/octet-stream"), "bin");
});
