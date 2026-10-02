import type { FastifyInstance, FastifyRequest } from "fastify";
import twilio from "twilio";
import { config } from "../config.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { attributeCallToLead } from "../leads.js";
import { upsertIncomingCall } from "../calls.js";
import {
  buildIncomingCallTwiml,
  buildCustomerConferenceTwiml,
  buildOperatorWhisperTwiml,
  buildOperatorJoinConferenceTwiml,
  conferenceNameForCall,
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

function twilioClient() {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) return null;
  return twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
}

function callbackWithQuery(path: string, params: Record<string, string>): string {
  const url = new URL(publicCallback(path));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function startOperatorCall(from: string, callSid: string, website: string, caller?: string) {
  const client = twilioClient();
  if (!client || !config.TWILIO_OPERATOR_NUMBER) throw new Error("twilio_operator_not_configured");
  const conferenceName = conferenceNameForCall(callSid);
  return client.calls.create({
    to: config.TWILIO_OPERATOR_NUMBER,
    from: config.TWILIO_CALLER_ID ?? config.TWILIO_OPERATOR_NUMBER ?? from,
    url: callbackWithQuery("/v1/providers/twilio/operator", {
      conference: conferenceName,
      website,
      caller: caller ?? "unknown",
      callSid
    }),
    method: "POST"
  });
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
    if (!config.TWILIO_OPERATOR_NUMBER && !config.TWILIO_FORWARD_TO) {
      return reply.code(503).send({ error: "twilio_operator_or_forward_target_not_configured" });
    }

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

    if (config.TWILIO_OPERATOR_NUMBER) {
      const conferenceName = conferenceNameForCall(call.providerCallId);
      await db.query("UPDATE calls SET conference_name=$2, updated_at=NOW() WHERE id=$1", [callId, conferenceName]);
      await startOperatorCall(call.calledNumber, call.providerCallId, site.name, call.callerNumber);
      const xml = buildCustomerConferenceTwiml(
        conferenceName,
        publicCallback("/v1/providers/twilio/conference")
      );
      return reply.type("text/xml; charset=utf-8").send(xml);
    }
    const xml = buildIncomingCallTwiml(
      call.calledNumber,
      config.TWILIO_FORWARD_TO!,
      publicCallback("/v1/providers/twilio/status"),
      publicCallback("/v1/providers/twilio/recording")
    );
    return reply.type("text/xml; charset=utf-8").send(xml);
  });

  app.post("/v1/providers/twilio/operator", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const conference = typeof query.conference === "string" ? query.conference : "";
    const website = typeof query.website === "string" ? query.website : "Analog Solutions";
    const caller = typeof query.caller === "string" ? query.caller : undefined;
    if (!conference) return reply.code(400).send({ error: "conference_required" });
    const actionUrl = callbackWithQuery("/v1/providers/twilio/operator/action", {
      conference,
      callSid: typeof query.callSid === "string" ? query.callSid : ""
    });
    const xml = buildOperatorWhisperTwiml(conference, actionUrl, website, caller);
    return reply.type("text/xml; charset=utf-8").send(xml);
  });

  app.post("/v1/providers/twilio/operator/action", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const conference = typeof query.conference === "string" ? query.conference : "";
    const customerCallSid = typeof query.callSid === "string" ? query.callSid : "";
    const body = request.body as Record<string, unknown>;
    const digits = typeof body.Digits === "string" ? body.Digits : "";
    const operatorCallSid = typeof body.CallSid === "string" ? body.CallSid : "";
    if (!conference || !operatorCallSid || !customerCallSid) return reply.code(400).send({ error: "operator_context_required" });
    const client = twilioClient();
    if (!client) return reply.code(503).send({ error: "twilio_api_not_configured" });

    const conferenceRows = await client.conferences.list({ friendlyName: conference, status: "in-progress", limit: 1 });
    const activeConference = conferenceRows[0];
    if (!activeConference) return reply.code(409).send({ error: "conference_not_active" });

    if (digits === "2") {
      return reply.type("text/xml; charset=utf-8").send(buildOperatorJoinConferenceTwiml(conference));
    }
    if (digits === "3") {
      await activeConference.update({ status: "completed" });
      const response = new twilio.twiml.VoiceResponse();
      response.say("The call has been ended.");
      response.hangup();
      return reply.type("text/xml; charset=utf-8").send(response.toString());
    }
    if (digits !== "1") {
      const response = new twilio.twiml.VoiceResponse();
      response.say("Please press 1 to connect the supplier, 2 to keep the call with Analog, or 3 to end the call.");
      response.redirect(callbackWithQuery("/v1/providers/twilio/operator", {
        conference,
        callSid: customerCallSid,
        website: "Analog Solutions"
      }));
      return reply.type("text/xml; charset=utf-8").send(response.toString());
    }

    const call = await db.query(
      `SELECT c.called_number,c.destination_number,s.name AS supplier_name
       FROM calls c
       LEFT JOIN tracking_numbers tn ON tn.id=c.tracking_number_id
       LEFT JOIN suppliers s ON s.id=tn.destination_supplier_id
       WHERE c.provider='twilio' AND c.provider_call_id=$1
       LIMIT 1`,
      [customerCallSid]
    );
    const destination = call.rows[0]?.destination_number as string | undefined;
    if (!destination) {
      const response = new twilio.twiml.VoiceResponse();
      response.say("No supplier destination is configured for this call.");
      response.hangup();
      return reply.type("text/xml; charset=utf-8").send(response.toString());
    }
    const from = config.TWILIO_CALLER_ID ?? config.TWILIO_OPERATOR_NUMBER ?? (call.rows[0]?.called_number as string | undefined) ?? config.TWILIO_FORWARD_TO;
    if (!from) return reply.code(503).send({ error: "twilio_from_number_not_configured" });
    await activeConference.participants().create({
      from,
      to: destination,
      label: "supplier",
      earlyMedia: true
    });
    await activeConference.participants().get(operatorCallSid).remove().catch(() => undefined);
    const response = new twilio.twiml.VoiceResponse();
    response.say("The supplier is being connected now.");
    response.hangup();
    return reply.type("text/xml; charset=utf-8").send(response.toString());
  });

  app.post("/v1/providers/twilio/conference", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const body = request.body as Record<string, unknown>;
    const friendlyName = typeof body.FriendlyName === "string" ? body.FriendlyName.trim() : "";
    const event = typeof body.StatusCallbackEvent === "string" ? body.StatusCallbackEvent.trim() : "";
    if (friendlyName) {
      await db.query(
        "UPDATE calls SET status=CASE WHEN $2='conference-end' THEN 'completed' WHEN $2='conference-start' THEN 'in-progress' ELSE status END, ended_at=CASE WHEN $2='conference-end' THEN COALESCE(ended_at,NOW()) ELSE ended_at END, duration_seconds=CASE WHEN $2='conference-end' THEN COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (NOW()-started_at))::int)) ELSE duration_seconds END, updated_at=NOW() WHERE provider='twilio' AND conference_name=$1",
        [friendlyName, event]
      );
    }
    return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
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

    const conferenceName = typeof body.FriendlyName === "string" ? body.FriendlyName.trim() : "";
    if (!callSid && !conferenceName) return reply.code(400).send({ error: "call_or_conference_required" });
    if (!recordingUrl) return reply.code(400).send({ error: "recording_url_required" });
    if (!isSafeRecordingUrl(recordingUrl)) return reply.code(400).send({ error: "secure_recording_url_required" });
    if (recordingStatus === "absent" || recordingStatus === "failed") return reply.send({ ok: true, status: recordingStatus });

    if (recordingStatus === "in-progress") {
      if (callSid) {
        await db.query("UPDATE calls SET recording_source_url=$2, recording_status='recording', updated_at=NOW() WHERE provider='twilio' AND provider_call_id=$1", [callSid, recordingUrl]);
      } else {
        await db.query("UPDATE calls SET recording_source_url=$2, recording_status='recording', updated_at=NOW() WHERE provider='twilio' AND conference_name=$1", [conferenceName, recordingUrl]);
      }
      return reply.send({ ok: true, status: recordingStatus });
    }

    const result = callSid
      ? await db.query("UPDATE calls SET recording_source_url=$2, recording_status='ready', updated_at=NOW() WHERE provider='twilio' AND provider_call_id=$1 RETURNING id", [callSid, recordingUrl])
      : await db.query("UPDATE calls SET recording_source_url=$2, recording_status='ready', updated_at=NOW() WHERE provider='twilio' AND conference_name=$1 RETURNING id", [conferenceName, recordingUrl]);
    if (!result.rowCount) return reply.code(404).send({ error: "call_not_found" });

    await createJob("call.process", "call", result.rows[0].id, {}, { forceRequeue: true });
    return reply.send({ ok: true, call_id: result.rows[0].id, status: "recording_ready" });
  });
}
