import { timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type NormalizedSecondRingCall = {
  providerCallId: string;
  callerNumber?: string;
  calledNumber?: string;
  direction?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  recordingMimeType?: string;
  siteId?: string;
};

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function recordsFromPayload(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root) return [];
  const data = asRecord(root.data);
  const call = asRecord(root.call);
  const event = asRecord(root.event);
  const nestedCall = asRecord(data?.call);
  return [root, data, call, event, nestedCall].filter(
    (value): value is JsonRecord => Boolean(value)
  );
}

function firstString(records: JsonRecord[], keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function firstNumber(records: JsonRecord[], keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (Number.isFinite(number) && number >= 0) return number;
    }
  }
  return undefined;
}

function nestedRecording(records: JsonRecord[]): JsonRecord[] {
  const result: JsonRecord[] = [];
  for (const record of records) {
    for (const key of ["recording", "call_recording", "media"]) {
      const nested = asRecord(record[key]);
      if (nested) result.push(nested);
    }
  }
  return result;
}

export function verifyWebhookSecret(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (receivedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(receivedBytes, expectedBytes);
}

export function normalizeSecondRingCall(payload: unknown): NormalizedSecondRingCall | null {
  const records = recordsFromPayload(payload);
  if (!records.length) return null;

  const providerCallId = firstString(records, [
    "provider_call_id", "providerCallId", "call_id", "callId", "id"
  ]);
  if (!providerCallId) return null;

  const recordings = [...nestedRecording(records), ...records];
  return {
    providerCallId,
    callerNumber: firstString(records, [
      "caller_number", "callerNumber", "from_number", "from", "caller", "source_number"
    ]),
    calledNumber: firstString(records, [
      "called_number", "calledNumber", "destination_number", "destination", "to_number", "to", "did"
    ]),
    direction: firstString(records, ["direction", "call_direction", "callDirection"]),
    startedAt: firstString(records, ["started_at", "startedAt", "start_time", "startTime", "timestamp"]),
    endedAt: firstString(records, ["ended_at", "endedAt", "end_time", "endTime"]),
    durationSeconds: firstNumber(records, ["duration_seconds", "durationSeconds", "duration"]),
    recordingUrl: firstString(recordings, ["recording_url", "recordingUrl", "url", "download_url"]),
    recordingMimeType: firstString(recordings, ["recording_mime_type", "recordingMimeType", "mime_type", "mimeType", "content_type"]),
    siteId: firstString(records, ["site_id", "siteId"])
  };
}
