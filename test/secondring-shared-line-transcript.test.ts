import test from "node:test";
import assert from "node:assert/strict";
import { selectSecondRingSiteResolution } from "../src/providers/secondring.ts";
import { buildTranscriptCompletedData } from "../src/analog-os-transcript.ts";

test("shared line calls with no site or tracking-number match are explicitly unattributed", () => {
  const shared = { id: "sink-id", hostname: "shared-secondring-line.internal", name: "SecondRing Shared Line (Unattributed)", status: "paused" };
  assert.deepEqual(
    selectSecondRingSiteResolution({ sharedLineSite: shared }),
    { ...shared, attributionMethod: "shared_line_unattributed" }
  );
});

test("an explicit active site beats the shared-line fallback", () => {
  const direct = { id: "site-1", hostname: "pilot.example", name: "Pilot", status: "active" };
  const shared = { id: "sink-id", hostname: "shared-secondring-line.internal", name: "SecondRing Shared Line (Unattributed)", status: "paused" };
  assert.deepEqual(
    selectSecondRingSiteResolution({ explicitSite: direct, sharedLineSite: shared }),
    { ...direct, attributionMethod: "explicit_site_id" }
  );
});

test("a known dedicated tracking number beats the shared-line fallback", () => {
  const dedicated = { id: "site-1", hostname: "pilot.example", name: "Pilot", status: "active" };
  const shared = { id: "sink-id", hostname: "shared-secondring-line.internal", name: "SecondRing Shared Line (Unattributed)", status: "paused" };
  assert.deepEqual(
    selectSecondRingSiteResolution({ calledNumberSite: dedicated, sharedLineSite: shared }),
    { ...dedicated, attributionMethod: "called_number" }
  );
});

test("transcript payload carries full text and segments alongside call and archive metadata", () => {
  const data = buildTranscriptCompletedData({
    id: "call-1",
    site_id: "site-1",
    site_name: "Pilot",
    hostname: "pilot.example",
    provider: "secondring",
    provider_call_id: "sr-1",
    caller_number: "+447000111222",
    called_number: "+447000333444",
    direction: "inbound",
    started_at: "2026-10-14T08:00:00.000Z",
    ended_at: "2026-10-14T08:02:00.000Z",
    duration_seconds: 120,
    attribution_method: "shared_line_unattributed",
    recording_status: "stored",
    recording_storage_key: "recordings/2026/site-1/call-1.mp3",
    recording_sha256: "a".repeat(64)
  }, "tx-1", {
    provider: "deepgram",
    model: "nova-3",
    duration: 120,
    text: "Customer asks for ready-mix concrete.",
    segments: [{ id: "s1", start: 0, end: 2, text: "Customer asks for ready-mix concrete.", speaker: "speaker_0" }]
  }, new Date("2026-10-14T08:03:00.000Z"));

  assert.equal(data.call_id, "call-1");
  assert.equal(data.transcript_id, "tx-1");
  assert.equal(data.site_name, "Pilot");
  assert.equal(data.hostname, "pilot.example");
  assert.equal(data.transcript_text, "Customer asks for ready-mix concrete.");
  assert.equal(data.transcript_status, "complete");
  assert.equal(data.recording_status, "stored");
  assert.equal(data.recording_storage_key, "recordings/2026/site-1/call-1.mp3");
  assert.equal(data.transcript_segments.length, 1);
  assert.equal(data.transcript_segments[0].speaker, "speaker_0");
});
