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
  calledNumber: string,
  forwardTo: string,
  statusCallbackUrl: string,
  recordingCallbackUrl: string
): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    callerId: calledNumber,
    answerOnBridge: true,
    record: "record-from-ringing-dual",
    recordingStatusCallback: recordingCallbackUrl,
    recordingStatusCallbackMethod: "POST",
    recordingStatusCallbackEvent: ["completed", "absent"],
    recordingTrack: "both"
  });
  dial.number({
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
  }, forwardTo);
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

export function buildCustomerConferenceTwiml(conferenceName: string, statusCallbackUrl: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial();
  dial.conference({
    startConferenceOnEnter: false,
    endConferenceOnExit: false,
    statusCallback: statusCallbackUrl,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["start", "end", "join", "leave"],
    beep: "false"
  }, conferenceName);
  return response.toString();
}

export function buildOperatorWhisperTwiml(
  conferenceName: string,
  actionUrl: string,
  websiteName: string,
  callerNumber?: string
): string {
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    numDigits: 1,
    timeout: 8,
    action: actionUrl,
    method: "POST"
  });
  gather.say(`Analog call from ${websiteName}. Caller ${callerNumber ?? "unknown"}. Press 1 to connect the supplier. Press 2 to keep the call with Analog. Press 3 to end the call.`);
  response.say("No selection received. The call will remain with Analog.");
  response.redirect(actionUrl);
  return response.toString();
}

export function buildOperatorJoinConferenceTwiml(conferenceName: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial();
  dial.conference({ endConferenceOnExit: false }, conferenceName);
  return response.toString();
}

export function buildSupplierBridgeTwiml(conferenceName: string, supplierName: string): string {
  const response = new twilio.twiml.VoiceResponse();
  response.say(`Connecting you to ${supplierName}.`);
  const dial = response.dial();
  dial.conference({ endConferenceOnExit: false }, conferenceName);
  return response.toString();
}
