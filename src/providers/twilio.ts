import twilio from "twilio";
import { createHash } from "node:crypto";

export type NormalizedTwilioCall = {
  providerCallId: string;
  callerNumber?: string;
  calledNumber?: string;
  direction?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
};

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function normalizeTwilioCall(payload: unknown): NormalizedTwilioCall | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  const providerCallId = stringField(body, "CallSid");
  if (!providerCallId) return null;

  const status = stringField(body, "CallStatus") ?? stringField(body, "DialCallStatus");
  const terminal = isTerminalTwilioStatus(status);
  return {
    providerCallId,
    callerNumber: stringField(body, "From") ?? stringField(body, "Caller"),
    calledNumber: stringField(body, "To"),
    direction: stringField(body, "Direction"),
    status,
    startedAt: stringField(body, "Timestamp"),
    endedAt: terminal ? stringField(body, "Timestamp") : undefined,
    durationSeconds: numberField(body, "CallDuration") ?? numberField(body, "DialCallDuration")
  };
}

export function validateTwilioRequest(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
  authToken: string
): boolean {
  if (!signature || !authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

export function buildIncomingCallTwiml(
  forwardTo: string,
  statusCallbackUrl: string | undefined,
  recordingCallbackUrl: string,
  dialActionUrl?: string,
  announceRecordingNotice = true,
  supplierWhisperUrl?: string
): string {
  const response = new twilio.twiml.VoiceResponse();
  if (announceRecordingNotice) {
    response.say("This call may be recorded for quality assurance purposes.");
  }
  const dial = response.dial({
    answerOnBridge: true,
    ...(dialActionUrl ? { action: dialActionUrl, method: "POST" } : {}),
    record: "record-from-ringing-dual",
    recordingStatusCallback: recordingCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed", "absent"],
    recordingTrack: "both"
  });
  const numberOptions = {
    ...(supplierWhisperUrl ? { url: supplierWhisperUrl, method: "POST" as const } : {}),
    ...(statusCallbackUrl ? {
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: "POST" as const,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] as ("initiated" | "ringing" | "answered" | "completed")[]
    } : {})
  };
  dial.number(numberOptions, forwardTo);
  return response.toString();
}

export function buildSupplierWhisperTwiml(websiteName: string, supplierName: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(
    "This call is from Analog Solutions for " + supplierName + ", from the website " + websiteName + ". " +
    "The call may be recorded for quality assurance. The customer is on the line."
  );
  return response.toString();
}
export function isTerminalTwilioStatus(status?: string): boolean {
  return status === "completed" || status === "busy" || status === "failed" ||
    status === "no-answer" || status === "canceled";
}

export function stableCallFingerprint(callSid: string): string {
  return createHash("sha256").update(callSid).digest("hex");
}

export function conferenceNameForCall(callSid: string): string {
  return `analog-${stableCallFingerprint(callSid).slice(0, 24)}`;
}

export function buildCustomerConferenceTwiml(
  conferenceName: string,
  statusCallbackUrl: string,
  recordingCallbackUrl = statusCallbackUrl
): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say("This call may be recorded for quality assurance purposes.");
  const dial = response.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
    record: "record-from-start",
    recordingStatusCallback: recordingCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["start", "end", "join", "leave"],
    beep: "false"
  }, conferenceName);
  return response.toString();
}

export function buildOperatorWhisperTwiml(
  conferenceName: string,
  _actionUrl: string,
  websiteName: string,
  callerNumber?: string
): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(`This call is from ${websiteName}. Caller ${callerNumber ?? "unknown"}. The call is recorded for quality assurance.`);
  const dial = response.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false
  }, conferenceName);
  return response.toString();
}

export function buildOperatorJoinConferenceTwiml(conferenceName: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial();
  dial.conference({ endConferenceOnExit: false }, conferenceName);
  return response.toString();
}

export function buildSupplierBridgeTwiml(
  conferenceName: string,
  supplierName: string,
  websiteName = "the website"
): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(`This call is from Analog Solutions, regarding a lead from ${websiteName}. Please stay on the line while we connect you with ${supplierName}.`);
  const dial = response.dial();
  dial.conference({ endConferenceOnExit: false }, conferenceName);
  return response.toString();
}
