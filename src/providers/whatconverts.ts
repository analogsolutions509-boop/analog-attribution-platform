import { timingSafeEqual } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type NormalizedWhatConvertsCall = {
  providerCallId: string;
  leadId: string;
  callerNumber?: string;
  calledNumber?: string;
  destinationNumber?: string;
  direction: "inbound";
  status?: "in-progress" | "completed" | "missed" | "busy" | "no-answer" | "failed";
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  recordingMimeType?: string;
  answerStatus?: string;
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringField(body: JsonRecord, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(body: JsonRecord, key: string): number | undefined {
  const value = body[key];
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function isWhatConvertsPhoneCall(payload: unknown): boolean {
  const body = record(payload);
  return body !== null && String(body.lead_type ?? "").trim().toLowerCase() === "phone call" && body.lead_id !== undefined && body.lead_id !== null;
}

function normalizeStatus(callStatus?: string, answerStatus?: string, leadState?: string): NormalizedWhatConvertsCall["status"] {
  const value = (callStatus ?? "") + " " + (leadState ?? "");
  const normalized = value.toLowerCase();
  const answer = (answerStatus ?? "").toLowerCase();
  if (normalized.includes("in progress")) return "in-progress";
  if (normalized.includes("completed")) return "completed";
  if (answer.includes("busy")) return "busy";
  if (answer.includes("no answer") || answer.includes("missed")) return "no-answer";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("missed")) return "missed";
  return undefined;
}

function calculateEnd(startedAt?: string, durationSeconds?: number): string | undefined {
  if (!startedAt || durationSeconds === undefined) return undefined;
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) return undefined;
  return new Date(start.getTime() + durationSeconds * 1000).toISOString();
}

export function normalizeWhatConvertsCall(payload: unknown): NormalizedWhatConvertsCall | null {
  const body = record(payload);
  if (!body || !isWhatConvertsPhoneCall(body)) return null;
  const leadId = String(body.lead_id).trim();
  const durationSeconds = numberField(body, "call_duration_seconds");
  const startedAt = stringField(body, "date_created");
  const answerStatus = stringField(body, "answer_status");
  return {
    providerCallId: "wc-" + leadId,
    leadId,
    callerNumber: stringField(body, "caller_number"),
    calledNumber: stringField(body, "tracking_number"),
    destinationNumber: stringField(body, "destination_number"),
    direction: "inbound",
    status: normalizeStatus(stringField(body, "call_status"), answerStatus, stringField(body, "lead_state")),
    startedAt,
    endedAt: calculateEnd(startedAt, durationSeconds),
    durationSeconds,
    recordingUrl: stringField(body, "recording") ?? stringField(body, "play_recording"),
    recordingMimeType: undefined,
    answerStatus
  };
}

export function verifyWhatConvertsWebhook(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
