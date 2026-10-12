import type { FastifyInstance, FastifyRequest } from "fastify";
import twilio from "twilio";
import { config } from "../config.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { queueAnalogOSEvent } from "../analog-os-outbox.js";
import { attributeCallToLead } from "../leads.js";
import { publishCallUpdated, queueCallCompletionNotifications, upsertIncomingCall } from "../calls.js";
import { queueNotification } from "../notifications.js";
import {
  buildIncomingCallTwiml,
  buildSupplierWhisperTwiml,
  buildCustomerConferenceTwiml,
  buildOperatorWhisperTwiml,
  buildOperatorJoinConferenceTwiml,
  buildSupplierBridgeTwiml,
  conferenceNameForCall,
  isTerminalTwilioStatus,
  normalizeTwilioCall,
  validateTwilioRequest
} from "../providers/twilio.js";
import { isSafeRecordingUrl } from "../call-recording.js";
import { normalizePhone } from "../utils/phone.js";
import { buildTwilioDialPlan, type TwilioDialTarget, type TwilioSupplierRoute } from "../providers/twilio-routing.js";

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
    "SELECT s.id,s.hostname,s.name,s.status,tn.id AS tracking_number_id,tn.destination_supplier_id," +
    "fn.phone_number AS forwarding_number " +
    "FROM tracking_numbers tn JOIN sites s ON s.id=tn.site_id " +
    "LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id AND fn.active " +
    "WHERE tn.active AND s.status='active' " +
    "AND regexp_replace(tn.phone_number,'[^0-9]','','g')=$1 LIMIT 1",
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

async function getTwilioDialPlan(
  siteId: string,
  trackingNumberId?: string | null
): Promise<TwilioDialTarget[]> {
  let primarySupplierId: string | null = null;
  if (trackingNumberId) {
    const route = await db.query(
      "SELECT destination_supplier_id FROM tracking_numbers WHERE id=$1 AND site_id=$2 LIMIT 1",
      [trackingNumberId, siteId]
    );
    primarySupplierId = typeof route.rows[0]?.destination_supplier_id === "string"
      ? route.rows[0].destination_supplier_id
      : null;
  }

  const result = await db.query(
    'SELECT s.id AS "supplierId", s.name AS "supplierName", s.contact_phone AS destination, ss.rank ' +
    "FROM suppliers s LEFT JOIN site_suppliers ss ON ss.supplier_id=s.id AND ss.site_id=$1 AND ss.active " +
    "WHERE s.status='active' AND (ss.id IS NOT NULL OR s.id=$2) " +
    "ORDER BY CASE WHEN s.id=$2 THEN 0 ELSE ss.rank END",
    [siteId, primarySupplierId]
  );
  const suppliers = result.rows as TwilioSupplierRoute[];
  const primary = suppliers.find((supplier) => supplier.supplierId === primarySupplierId) ?? null;
  const fallbacks = suppliers.filter((supplier) => supplier.supplierId !== primarySupplierId);
  return buildTwilioDialPlan(primary, fallbacks, config.TWILIO_FORWARD_TO);
}

async function buildAutomaticDialResponse(
  callId: string,
  calledNumber: string,
  plan: TwilioDialTarget[],
  attemptIndex: number,
  announceRecordingNotice: boolean,
  websiteName: string
): Promise<string> {
  const target = plan[attemptIndex];
  if (!target) {
    const unavailable = new twilio.twiml.VoiceResponse();
    unavailable.say("We're sorry, no supplier is available to take your call right now. Please try again later.");
    unavailable.hangup();
    return unavailable.toString();
  }

  let attemptId: string | null = null;
  if (target.supplierId) {
    const attempt = await db.query(
      "INSERT INTO transfer_attempts(call_id,supplier_id,mode,provider,rank,result,metadata) " +
      "VALUES($1,$2,'blind','twilio',$3,'initiated',$4::jsonb) RETURNING id",
      [callId, target.supplierId, target.rank, JSON.stringify({
        automatic: true,
        destination: target.destination,
        supplier_name: target.supplierName,
        sequence_index: attemptIndex
      })]
    );
    attemptId = String(attempt.rows[0].id);
  }

  const statusCallbackUrl = callbackWithQuery("/v1/providers/twilio/transfer-status", {
    callId,
    attemptIndex: String(attemptIndex),
    ...(attemptId ? { attemptId } : {})
  });
  const recordingCallbackUrl = callbackWithQuery("/v1/providers/twilio/recording", { callId, attemptIndex: String(attemptIndex) });
  const dialActionUrl = callbackWithQuery("/v1/providers/twilio/dial-result", {
    callId,
    attemptIndex: String(attemptIndex),
    website: websiteName
  });
  const supplierWhisperUrl = target.supplierId
    ? callbackWithQuery("/v1/providers/twilio/supplier-whisper", {
        website: websiteName,
        supplier: target.supplierName
      })
    : undefined;
  return buildIncomingCallTwiml(
    target.destination,
    statusCallbackUrl,
    recordingCallbackUrl,
    dialActionUrl,
    announceRecordingNotice,
    supplierWhisperUrl
  );
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

    const plan = await getTwilioDialPlan(site.id, site.tracking_number_id);
    if (!plan.length) {
      await db.query(
        "UPDATE calls SET status='failed',ended_at=NOW(),updated_at=NOW() WHERE id=$1",
        [callId]
      );
      const unavailable = new twilio.twiml.VoiceResponse();
      unavailable.say("We're sorry, we cannot connect your call to a supplier right now. Please try again later.");
      unavailable.hangup();
      return reply.type("text/xml; charset=utf-8").send(unavailable.toString());
    }

    const xml = await buildAutomaticDialResponse(callId, call.calledNumber, plan, 0, true, String(site.name ?? "the website"));
    return reply.type("text/xml; charset=utf-8").send(xml);
  });

  app.post("/v1/providers/twilio/dial-result", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const body = formParams(request);
    const callId = typeof query.callId === "string" ? query.callId : "";
    const attemptIndex = typeof query.attemptIndex === "string" ? Number(query.attemptIndex) : Number.NaN;
    const websiteName = typeof query.website === "string" ? query.website.slice(0, 120) : "the website";
    if (!callId || !Number.isInteger(attemptIndex) || attemptIndex < 0 || !body.CallSid || !body.DialCallStatus) {
      return reply.code(400).send({ error: "dial_result_context_required" });
    }

    const result = await db.query(
      "SELECT id,site_id,provider_call_id,called_number,tracking_number_id,recording_status FROM calls WHERE id=$1 AND provider='twilio' LIMIT 1",
      [callId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "call_not_found" });
    const call = result.rows[0];
    if (String(call.provider_call_id) !== body.CallSid) {
      return reply.code(409).send({ error: "dial_result_call_mismatch" });
    }

    const dialStatus = String(body.DialCallStatus).toLowerCase();
    const durationRaw = Number(body.DialCallDuration);
    const duration = Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : null;
    if (dialStatus === "completed") {
      await db.query(
        "UPDATE calls SET status='completed',ended_at=COALESCE(ended_at,NOW()),duration_seconds=COALESCE($2,duration_seconds),updated_at=NOW() WHERE id=$1",
        [callId, duration]
      );
      if (["absent", "failed"].includes(String(call.recording_status ?? "").toLowerCase())) {
        await queueCallCompletionNotifications(callId).catch(() => undefined);
      }
      await publishCallUpdated(callId).catch(() => undefined);
      return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
    }

    if (!["no-answer", "busy", "failed"].includes(dialStatus)) {
      return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
    }

    const plan = await getTwilioDialPlan(String(call.site_id), call.tracking_number_id);
    const nextIndex = attemptIndex + 1;
    if (nextIndex < plan.length) {
      await db.query(
        "UPDATE calls SET status='in-progress',updated_at=NOW() WHERE id=$1",
        [callId]
      );
      const nextXml = await buildAutomaticDialResponse(
        callId,
        String(call.called_number ?? ""),
        plan,
        nextIndex,
        false,
        websiteName
      );
      return reply.type("text/xml; charset=utf-8").send(nextXml);
    }

    await db.query(
      "UPDATE calls SET status=$2,ended_at=COALESCE(ended_at,NOW()),duration_seconds=COALESCE($3,duration_seconds),updated_at=NOW() WHERE id=$1",
      [callId, dialStatus === "no-answer" || dialStatus === "busy" ? "no-answer" : "failed", duration]
    );
    // When all suppliers failed to answer, keep the missed-call lead visible even if no recording exists.
    await queueCallCompletionNotifications(callId).catch(() => undefined);
    await publishCallUpdated(callId).catch(() => undefined);
    const unavailable = new twilio.twiml.VoiceResponse();
    unavailable.say("We're sorry, no supplier is available to take your call right now. Please try again later.");
    unavailable.hangup();
    return reply.type("text/xml; charset=utf-8").send(unavailable.toString());
  });

  app.post("/v1/providers/twilio/supplier-whisper", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const websiteName = typeof query.website === "string" ? query.website.slice(0, 120) : "the website";
    const supplierName = typeof query.supplier === "string" ? query.supplier.slice(0, 120) : "the supplier";
    return reply.type("text/xml; charset=utf-8").send(buildSupplierWhisperTwiml(websiteName, supplierName));
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
    const body = request.body as Record<string, unknown>;
    const operatorCallSid = typeof body.CallSid === "string" ? body.CallSid : "";
    const customerCallSid = typeof query.callSid === "string" ? query.callSid : "";
    if (operatorCallSid && customerCallSid) {
      await db.query(
        "UPDATE calls SET operator_call_sid=COALESCE(operator_call_sid,$2),updated_at=NOW() WHERE provider='twilio' AND provider_call_id=$1",
        [customerCallSid, operatorCallSid]
      );
    }
    const xml = buildOperatorWhisperTwiml(conference, actionUrl, website, caller);
    return reply.type("text/xml; charset=utf-8").send(xml);
  });

  app.post("/v1/providers/twilio/operator/join", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const conference = typeof query.conference === "string" ? query.conference : "";
    if (!conference) return reply.code(400).send({ error: "conference_required" });
    return reply.type("text/xml; charset=utf-8").send(buildOperatorJoinConferenceTwiml(conference));
  });

  app.post("/v1/providers/twilio/supplier", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const conference = typeof query.conference === "string" ? query.conference : "";
    const supplier = typeof query.supplier === "string" ? query.supplier : "the supplier";
    const website = typeof query.website === "string" ? query.website : "the website";
    if (!conference) return reply.code(400).send({ error: "conference_required" });
    return reply.type("text/xml; charset=utf-8").send(buildSupplierBridgeTwiml(conference, supplier, website));
  });

  app.post("/v1/providers/twilio/transfer-status", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });
    const query = request.query as Record<string, unknown>;
    const attemptId = typeof query.attemptId === "string" ? query.attemptId : "";
    const callId = typeof query.callId === "string" ? query.callId : "";
    const body = formParams(request);
    const callSid = typeof body.CallSid === "string" ? body.CallSid : "";
    const parentCallSid = typeof body.ParentCallSid === "string" ? body.ParentCallSid : "";
    const rawStatus = typeof body.CallStatus === "string" ? body.CallStatus.toLowerCase() : "";
    if ((!attemptId && !callId) || !callSid || !rawStatus) {
      return reply.code(400).send({ error: "transfer_status_context_required" });
    }
    const failed = ["busy", "failed", "no-answer", "canceled"].includes(rawStatus);
    const result = rawStatus === "in-progress" ? "answered" :
      rawStatus === "completed" ? "completed" :
      failed ? "failed" :
      rawStatus === "ringing" ? "ringing" : "initiated";
    const durationRaw = typeof body.CallDuration === "string" ? Number(body.CallDuration) : Number.NaN;
    const duration = Number.isFinite(durationRaw) && durationRaw >= 0 ? durationRaw : null;

    if (attemptId) {
      await db.query(
        "UPDATE transfer_attempts SET " +
        "provider_transfer_id=COALESCE(provider_transfer_id,$2), " +
        "result=$3, " +
        "answered_at=CASE WHEN $3 IN ('answered','completed') THEN COALESCE(answered_at,NOW()) ELSE answered_at END, " +
        "ended_at=CASE WHEN $3 IN ('completed','failed') THEN COALESCE(ended_at,NOW()) ELSE ended_at END, " +
        "ring_seconds=COALESCE($4,ring_seconds), " +
        "metadata=metadata || $5::jsonb " +
        "WHERE id=$1 AND provider='twilio'",
        [attemptId, callSid, result, duration, JSON.stringify({ twilio_call_status: rawStatus })]
      );
    }

    // A Dial action is not guaranteed when the original caller hangs up first.
    // The dialed-number status callback also closes out a terminal parent call.
    if (callId && ["completed", "canceled"].includes(rawStatus)) {
      const parent = await db.query(
        "SELECT id,provider_call_id,status,recording_status FROM calls WHERE id=$1 AND provider='twilio' LIMIT 1",
        [callId]
      );
      if (parent.rowCount) {
        const call = parent.rows[0];
        if (parentCallSid && String(call.provider_call_id) !== parentCallSid) {
          return reply.code(409).send({ error: "transfer_status_call_mismatch" });
        }
        const terminalStatus = rawStatus === "completed" ? "completed" : "canceled";
        await db.query(
          "UPDATE calls SET status=$2,ended_at=COALESCE(ended_at,NOW()),duration_seconds=COALESCE($3,duration_seconds),updated_at=NOW() " +
          "WHERE id=$1 AND status NOT IN ('no-answer','failed','canceled')",
          [callId, terminalStatus, duration]
        );
        if (terminalStatus === "canceled" ||
            ["absent", "failed"].includes(String(call.recording_status ?? "").toLowerCase())) {
          await queueCallCompletionNotifications(callId).catch(() => undefined);
        }
        await publishCallUpdated(callId).catch(() => undefined);
      }
    }

    return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
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
      `SELECT c.called_number,c.destination_number,s.name AS supplier_name,site.name AS website_name
       FROM calls c
       JOIN sites site ON site.id=c.site_id
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
    const from = config.TWILIO_CALLER_ID ?? (call.rows[0]?.called_number as string | undefined) ?? config.TWILIO_FORWARD_TO;
    if (!from) return reply.code(503).send({ error: "twilio_from_number_not_configured" });
    await client.calls.create({
      from,
      to: destination,
      url: callbackWithQuery("/v1/providers/twilio/supplier", {
        conference,
        supplier: String(call.rows[0]?.supplier_name ?? "the supplier"),
        website: String(call.rows[0]?.website_name ?? "the website")
      }),
      method: "POST"
    });
    await client.calls(operatorCallSid).update({ status: "completed" }).catch(() => undefined);
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
      const updated = await db.query(
        `UPDATE calls
         SET status=CASE WHEN $2='conference-end' THEN 'completed' WHEN $2='conference-start' THEN 'in-progress' ELSE status END,
             ended_at=CASE WHEN $2='conference-end' THEN COALESCE(ended_at,NOW()) ELSE ended_at END,
             duration_seconds=CASE WHEN $2='conference-end' THEN COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (NOW()-started_at))::int)) ELSE duration_seconds END,
             updated_at=NOW()
         WHERE provider='twilio' AND conference_name=$1
         RETURNING id,site_id,caller_number,called_number,started_at`,
        [friendlyName, event]
      );
      if (updated.rowCount) {
        const call = updated.rows[0];
        if (event === "conference-end") {
          await attributeCallToLead(
            String(call.id),
            String(call.site_id),
            typeof call.caller_number === "string" ? call.caller_number : undefined,
            call.started_at ? new Date(call.started_at).toISOString() : undefined,
            typeof call.called_number === "string" ? call.called_number : undefined
          );
        }
        await publishCallUpdated(String(call.id)).catch(() => undefined);
      }
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

    if (result.rowCount) await publishCallUpdated(result.rows[0].id as string);

    if (!result.rowCount) {
      const site = await resolveSiteByNumber(call.calledNumber);
      if (!site) return reply.code(422).send({ error: "site_resolution_failed" });
      const newCallId = await upsertIncomingCall({
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
      await publishCallUpdated(newCallId);
    }

    return reply.type("text/xml; charset=utf-8").send("<Response></Response>");
  });

  app.post("/v1/providers/twilio/recording", async (request, reply) => {
    if (!twilioAuthorized(request)) return reply.code(401).send({ error: "invalid_twilio_signature" });

    const body = request.body as Record<string, unknown>;
    const callSid = typeof body.CallSid === "string" ? body.CallSid.trim() : "";
    const recordingUrl = typeof body.RecordingUrl === "string" ? body.RecordingUrl.trim() : "";
    const recordingStatus = typeof body.RecordingStatus === "string" ? body.RecordingStatus : "";
    const query = request.query as Record<string, unknown>;
    const requestedCallId = typeof query.callId === "string" ? query.callId.trim() : "";
    const conferenceName =
      (typeof query.conference === "string" ? query.conference.trim() : "") ||
      (typeof body.FriendlyName === "string" ? body.FriendlyName.trim() : "");
    if (!callSid && !conferenceName && !requestedCallId) return reply.code(400).send({ error: "call_or_conference_required" });

    const normalizedRecordingStatus = recordingStatus.toLowerCase();
    if (normalizedRecordingStatus === "absent" || normalizedRecordingStatus === "failed") {
      const requestedAttemptIndex = typeof query.attemptIndex === "string"
        ? Number(query.attemptIndex)
        : Number.NaN;
      const callResult = requestedCallId
        ? await db.query(
            "SELECT id,site_id,caller_number,called_number,started_at,status,tracking_number_id FROM calls WHERE id=$1 LIMIT 1",
            [requestedCallId]
          )
        : callSid
          ? await db.query(
              "SELECT id,site_id,caller_number,called_number,started_at,status,tracking_number_id FROM calls WHERE provider='twilio' AND provider_call_id=$1 LIMIT 1",
              [callSid]
            )
          : await db.query(
              "SELECT id,site_id,caller_number,called_number,started_at,status,tracking_number_id FROM calls WHERE provider='twilio' AND conference_name=$1 LIMIT 1",
              [conferenceName]
            );
      if (!callResult.rowCount) return reply.code(404).send({ error: "call_not_found" });

      const call = callResult.rows[0];
      const terminal = ["completed", "no-answer", "failed", "canceled"].includes(String(call.status ?? "").toLowerCase());
      let fallbackPending = false;
      if (requestedCallId && Number.isInteger(requestedAttemptIndex) && requestedAttemptIndex >= 0) {
        const plan = await getTwilioDialPlan(String(call.site_id), call.tracking_number_id);
        fallbackPending = !terminal && requestedAttemptIndex < plan.length - 1;
      }
      await db.query(
        "UPDATE calls SET recording_status=$2,updated_at=NOW() WHERE id=$1",
        [call.id, normalizedRecordingStatus]
      );
      if (requestedCallId && Number.isInteger(requestedAttemptIndex) && requestedAttemptIndex >= 0) {
        // Keep recording state current, but do not notify while a fallback remains or the Dial result is unresolved.
        if (fallbackPending) {
          return reply.send({
            ok: true,
            call_id: call.id,
            status: normalizedRecordingStatus,
            ignored: true,
            reason: "fallback_pending"
          });
        }
        if (terminal) {
          await queueCallCompletionNotifications(String(call.id)).catch(() => undefined);
          await publishCallUpdated(String(call.id)).catch(() => undefined);
        }
        return reply.send({
          ok: true,
          call_id: call.id,
          status: normalizedRecordingStatus,
          notification_queued: terminal
        });
      }
      const leadId = await attributeCallToLead(
        String(call.id),
        String(call.site_id),
        typeof call.caller_number === "string" ? call.caller_number : undefined,
        call.started_at ? new Date(call.started_at).toISOString() : undefined,
        typeof call.called_number === "string" ? call.called_number : undefined
      );
      if (leadId) {
        await Promise.all([
          queueNotification({ leadId, callId: String(call.id), recipientType: "internal", channel: "email" }),
          queueNotification({ leadId, callId: String(call.id), recipientType: "supplier", channel: "email" })
        ]);
      }
      await publishCallUpdated(String(call.id)).catch(() => undefined);
      return reply.send({ ok: true, call_id: call.id, status: normalizedRecordingStatus, notification_queued: Boolean(leadId) });
    }

    if (!recordingUrl) return reply.code(400).send({ error: "recording_url_required" });
    if (!isSafeRecordingUrl(recordingUrl)) return reply.code(400).send({ error: "secure_recording_url_required" });

    if (recordingStatus === "in-progress") {
      if (requestedCallId) {
        await db.query(
          "UPDATE calls SET recording_source_url=$2,recording_status='recording',updated_at=NOW() WHERE id=$1",
          [requestedCallId, recordingUrl]
        );
      } else if (callSid) {
        await db.query(
          "UPDATE calls SET recording_source_url=$2,recording_status='recording',updated_at=NOW() WHERE provider='twilio' AND provider_call_id=$1",
          [callSid, recordingUrl]
        );
      } else {
        await db.query(
          "UPDATE calls SET recording_source_url=$2,recording_status='recording',updated_at=NOW() WHERE provider='twilio' AND conference_name=$1",
          [conferenceName, recordingUrl]
        );
      }
      return reply.send({ ok: true, status: recordingStatus });
    }

    const result = requestedCallId
      ? await db.query(
          "UPDATE calls SET recording_source_url=$2,recording_status='ready',updated_at=NOW() WHERE id=$1 RETURNING id",
          [requestedCallId, recordingUrl]
        )
      : callSid
        ? await db.query(
            "UPDATE calls SET recording_source_url=$2,recording_status='ready',updated_at=NOW() WHERE provider='twilio' AND provider_call_id=$1 RETURNING id",
            [callSid, recordingUrl]
          )
        : await db.query(
            "UPDATE calls SET recording_source_url=$2,recording_status='ready',updated_at=NOW() WHERE provider='twilio' AND conference_name=$1 RETURNING id",
            [conferenceName, recordingUrl]
          );
    if (!result.rowCount) return reply.code(404).send({ error: "call_not_found" });

    const readyCallId = result.rows[0].id as string;
    await queueAnalogOSEvent("recording.ready", "call", readyCallId, {
      call_id: readyCallId, recording_url: recordingUrl, recording_status: "ready"
    });
    await publishCallUpdated(readyCallId);
    await createJob("call.process", "call", readyCallId, {}, { forceRequeue: true });
    return reply.send({ ok: true, call_id: result.rows[0].id, status: "recording_ready" });
  });
}
