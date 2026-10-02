import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { attributeCallToLead } from "../leads.js";
import { publishCallUpdated, upsertIncomingCall } from "../calls.js";
import { isSafeRecordingUrl } from "../call-recording.js";
import { normalizePhone } from "../utils/phone.js";
import { normalizeWhatConvertsCall, verifyWhatConvertsWebhook } from "../providers/whatconverts.js";

function webhookCredential(request: FastifyRequest): string | undefined {
  const direct = request.headers["x-analog-provider-secret"];
  if (typeof direct === "string" && direct) return direct;
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7);
  const query = request.query as Record<string, unknown>;
  return typeof query.secret === "string" ? query.secret : undefined;
}

async function resolveSite(calledNumber?: string) {
  const normalized = normalizePhone(calledNumber);
  if (!normalized) return null;
  const result = await db.query(
    "SELECT s.id,s.hostname,s.name,s.status FROM tracking_numbers tn JOIN sites s ON s.id=tn.site_id WHERE tn.active AND s.status='active' AND regexp_replace(tn.phone_number,'[^0-9]','','g')=$1 LIMIT 1",
    [normalized]
  );
  return result.rows[0] ?? null;
}

export async function registerWhatConvertsRoutes(app: FastifyInstance) {
  app.post("/v1/providers/whatconverts/webhook", async (request, reply) => {
    if (!config.ANALOG_PROVIDER_WEBHOOK_SECRET) return reply.code(503).send({ error: "provider_webhook_not_configured" });
    if (!verifyWhatConvertsWebhook(webhookCredential(request), config.ANALOG_PROVIDER_WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "invalid_provider_credential" });
    }

    const call = normalizeWhatConvertsCall(request.body);
    if (!call) return reply.code(400).send({ error: "invalid_whatconverts_phone_call_payload" });
    if (call.recordingUrl && !isSafeRecordingUrl(call.recordingUrl)) {
      return reply.code(400).send({ error: "secure_recording_url_required" });
    }

    const site = await resolveSite(call.calledNumber);
    if (!site) return reply.code(422).send({ error: "site_resolution_failed" });

    const callId = await upsertIncomingCall({
      siteId: site.id,
      siteName: site.name,
      hostname: site.hostname,
      provider: "whatconverts",
      providerCallId: call.providerCallId,
      callerNumber: call.callerNumber,
      calledNumber: call.calledNumber,
      direction: call.direction,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSeconds: call.durationSeconds,
      recordingUrl: call.recordingUrl,
      recordingMimeType: call.recordingMimeType
    });

    await attributeCallToLead(callId, site.id, call.callerNumber, call.startedAt, call.calledNumber);
    await db.query("UPDATE calls SET status=$2, updated_at=NOW() WHERE id=$1", [callId, call.status ?? "received"]);

    if (call.recordingUrl) await createJob("call.process", "call", callId, {}, { forceRequeue: true });
    await publishCallUpdated(callId);

    return reply.code(202).send({
      ok: true,
      call_id: callId,
      lead_id: call.leadId,
      site_id: site.id,
      status: call.status ?? "received",
      recording_received: Boolean(call.recordingUrl)
    });
  });
}
