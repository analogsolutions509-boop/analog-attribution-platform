import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { attributeCallToLead } from "../leads.js";
import { upsertIncomingCall } from "../calls.js";
import {
  buildIncomingCallTwiml,
  isTerminalTwilioStatus,
  normalizeTwilioCall,
  validateTwilioRequest
} from "../providers/twilio.js";
import { isSafeRecordingUrl } from "../call-recording.js";
import { normalizePhone } from "../utils/phone.js";

function requestUrl(request: FastifyRequest): string {
  const base = config.PUBLIC_API_URL ?? config.AUTH0_APP_BASE_URL;
  return new URL(request.raw.url ?? request.url, base).toString();
}

function formParams(request: FastifyRequest): Record<string, string> {
  const body = request.body as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(body ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function twilioAuthorized(request: FastifyRequest): boolean {
  const authToken = config.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  return validateTwilioRequest(
    requestUrl(request),
    formParams(request),
    typeof request.headers["x-twilio-signature"] === "string" ? request.headers["x-twilio-signature"] : undefined,
    authToken
  );
}

async function resolveSiteByNumber(calledNumber: string | undefined) {
  const normalized = normalizePhone(calledNumber);
  if (!normalized) return null;
  const result = await db.query(
    `SELECT s.id,s.hostname,s.name,s.status
     FROM tracking_numbers tn
     JOIN sites s ON s.id=tn.site_id
     WHERE tn.active AND s.status='active'
       AND regexp_replace(tn.phone_number,'\\D','','g')=$1
     LIMIT 1`,
    [normalized]
  );
  return result.rows[0] ?? null;
}

function publicCallback(path: string): string {
  const base = config.PUBLIC_API_URL ?? config.AUTH0_APP_BASE_URL;
  return new URL(path, base).toString();
}

export async function registerTwilioRoutes(app: FastifyInstance) {
  app.post("/v1/providers/twilio/voice", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });

    const call = normalizeTwilioCall(request.body);
    if (!call || !call.calledNumber) {
      return reply.code(400).send({ error: "invalid_twilio_voice_payload" });
    }
    const site = await resolveSiteByNumber(call.calledNumber);
    if (!site) return reply.code(422).send({ error: "site_resolution_failed" });
    if (!config.TWILIO_FORWARD_TO) return reply.code(503).send({ error: "twilio_forward_target_not_configured" });

    const callId = await upsertIncomingCall({
      siteId: site.id,
      siteName: site.name,
      hostname: site.hostname,
      provider: "twilio",
      providerCallId: call.providerCallId,
      callerNumber: call.callerNumber,
      calledNumber: call.calledNumber,
      direction: call.direction,
      startedAt: call.startedAt ?? new Date().toISOString()
    });
    await attributeCallToLead(callId, site.id, call.callerNumber, call.startedAt, call.calledNumber);

    const xml = buildIncomingCallTwiml(
      call.calledNumber,
      config.TWILIO_FORWARD_TO,
      publicCallback("/v1/providers/twilio/status"),
      publicCallback("/v1/providers/twilio/recording")
    );
    return reply.type("text/xml; charset=utf-8").send(xml);
  });

  app.post("/v1/providers/twilio/status", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });

    const call = normalizeTwilioCall(request.body);
    if (!call || !call.calledNumber) {
      return reply.code(400).send({ error: "invalid_twilio_status_payload" });
    }

    const result = await db.query(
      `UPDATE calls
       SET caller_number=COALESCE($2,caller_number),
           called_number=COALESCE($3,called_number),
           direction=COALESCE($4,direction),
           status=$5,
           duration_seconds=COALESCE($6,duration_seconds),
           ended_at=COALESCE($7,ended_at),
           updated_at=NOW()
       WHERE provider='twilio' AND provider_call_id=$1
       RETURNING id,site_id`,
      [
        call.providerCallId,
        call.callerNumber ?? null,
        call.calledNumber,
        call.direction ?? null,
        call.status ?? "received",
        call.durationSeconds ?? null,
        call.status && isTerminalTwilioStatus(call.status) ? call.endedAt ?? new Date().toISOString() : null
      ]
    );

    if (!result.rowCount) {
      const site = await resolveSiteByNumber(call.calledNumber);
      if (!site) return reply.code(422).send({ error: "site_resolution_failed" });
      await upsertIncomingCall({
        siteId: site.id,
        siteName: site.name,
        hostname: site.hostname,
        provider: "twilio",
        providerCallId: call.providerCallId,
        callerNumber: call.callerNumber,
        calledNumber: call.calledNumber,
        direction: call.direction,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationSeconds: call.durationSeconds
      });
    }

    return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
  });

  app.post("/v1/providers/twilio/recording", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });

    const body = request.body as Record<string, unknown>;
    const callSid = typeof body.CallSid === "string" ? body.CallSid.trim() : "";
    const recordingUrl = typeof body.RecordingUrl === "string" ? body.RecordingUrl.trim() : "";
    const recordingStatus = typeof body.RecordingStatus === "string" ? body.RecordingStatus : "";

    if (!callSid || !recordingUrl) return reply.code(400).send({ error: "recording_fields_required" });
    if (!isSafeRecordingUrl(recordingUrl)) return reply.code(400).send({ error: "secure_recording_url_required" });
    if (recordingStatus === "absent" || recordingStatus === "failed") {
      return reply.send({ ok: true, status: recordingStatus });
    }

    const result = await db.query(
      `UPDATE calls
       SET recording_source_url=$2,
           recording_status='ready',
           updated_at=NOW()
       WHERE provider='twilio' AND provider_call_id=$1
       RETURNING id`,
      [callSid, recordingUrl]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "call_not_found" });

    await createJob("call.process", "call", result.rows[0].id, {}, { forceRequeue: true });
    return reply.send({ ok: true, call_id: result.rows[0].id, status: "recording_ready" });
  });
}
