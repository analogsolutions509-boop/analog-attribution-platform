import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { upsertIncomingCall } from "../calls.js";
import { attributeCallToLead } from "../leads.js";
import { isSafeRecordingUrl } from "../call-recording.js";
import { normalizePhone } from "../utils/phone.js";
import { normalizeSecondRingCall, verifyWebhookSecret } from "../providers/secondring.js";

function webhookCredential(request: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const direct = request.headers["x-analog-provider-secret"] ?? request.headers["x-secondring-webhook-secret"];
  if (typeof direct === "string" && direct) return direct;
  const authorization = request.headers.authorization;
  return typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;
}

async function resolveSite(payload: { siteId?: string; calledNumber?: string }) {
  if (payload.siteId) {
    const result = await db.query(
      "SELECT id,hostname,name,status FROM sites WHERE id=$1 AND status='active' LIMIT 1",
      [payload.siteId]
    );
    if (result.rowCount) return result.rows[0];
  }

  const calledNumber = normalizePhone(payload.calledNumber);
  if (!calledNumber) return null;

  const result = await db.query(
    "SELECT s.id,s.hostname,s.name,s.status " +
    "FROM tracking_numbers tn " +
    "JOIN sites s ON s.id=tn.site_id " +
    "WHERE tn.active AND s.status='active' " +
    "AND regexp_replace(tn.phone_number,'\\D','','g')=$1 " +
    "LIMIT 1",
    [calledNumber]
  );
  return result.rows[0] ?? null;
}

export async function registerSecondRingRoutes(app: FastifyInstance) {
  app.post("/v1/providers/secondring/webhook", async (request, reply) => {
    if (!config.ANALOG_PROVIDER_WEBHOOK_SECRET) {
      return reply.code(503).send({ error: "provider_webhook_not_configured" });
    }

    const credential = webhookCredential(request);
    if (!verifyWebhookSecret(credential, config.ANALOG_PROVIDER_WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: "invalid_provider_credential" });
    }

    const call = normalizeSecondRingCall(request.body);
    if (!call) {
      return reply.code(400).send({ error: "invalid_secondring_payload" });
    }
    if (call.recordingUrl && !isSafeRecordingUrl(call.recordingUrl)) {
      return reply.code(400).send({ error: "secure_recording_url_required" });
    }

    const site = await resolveSite(call);
    if (!site) {
      return reply.code(422).send({ error: "site_resolution_failed" });
    }

    const callId = await upsertIncomingCall({
      siteId: site.id,
      siteName: site.name,
      hostname: site.hostname,
      provider: "secondring",
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

    await attributeCallToLead(
      callId,
      site.id,
      call.callerNumber,
      call.startedAt,
      call.calledNumber
    );

    if (call.recordingUrl) {
      await createJob("call.process", "call", callId);
    }

    return reply.code(202).send({
      ok: true,
      call_id: callId,
      site_id: site.id,
      recording_received: Boolean(call.recordingUrl)
    });
  });
}
