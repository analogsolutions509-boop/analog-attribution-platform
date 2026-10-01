import type { FastifyInstance } from "fastify";
import { resolveSite } from "../auth.js";
import { db } from "../db.js";
import { createJob } from "../jobs.js";
import { attachRecording, upsertIncomingCall } from "../calls.js";
import { createRecordingDownloadUrl } from "../storage/r2.js";
import { attributeCallToLead } from "../leads.js";

export async function registerCallRoutes(app: FastifyInstance) {
  app.post("/v1/calls/events", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });

    const body = request.body as Record<string, unknown>;
    if (body.provider !== "secondring") {
      return reply.code(400).send({ error: "unsupported_provider" });
    }
    if (typeof body.provider_call_id !== "string") {
      return reply.code(400).send({ error: "provider_call_id_required" });
    }

    const callId = await upsertIncomingCall({
      siteId: site.id,
      provider: "secondring",
      providerCallId: body.provider_call_id,
      callerNumber: typeof body.caller_number === "string" ? body.caller_number : undefined,
      calledNumber: typeof body.called_number === "string" ? body.called_number : undefined,
      direction: typeof body.direction === "string" ? body.direction : undefined,
      startedAt: typeof body.started_at === "string" ? body.started_at : undefined,
      endedAt: typeof body.ended_at === "string" ? body.ended_at : undefined,
      durationSeconds: typeof body.duration_seconds === "number" ? body.duration_seconds : undefined,
      recordingUrl: typeof body.recording_url === "string" ? body.recording_url : undefined,
      recordingMimeType: typeof body.recording_mime_type === "string" ? body.recording_mime_type : undefined
    });
    await attributeCallToLead(
      callId,
      site.id,
      typeof body.caller_number === "string" ? body.caller_number : undefined,
      typeof body.started_at === "string" ? body.started_at : undefined,
      typeof body.called_number === "string" ? body.called_number : undefined
    );
    if (body.recording_url) {
      await createJob("call.process", "call", callId);
    }
    return reply.code(202).send({ ok: true, call_id: callId });
  });

  app.post<{ Params: { callId: string } }>("/v1/calls/:callId/recording", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });

    const body = request.body as Record<string, unknown>;
    if (typeof body.recording_url !== "string" || !body.recording_url.startsWith("https://")) {
      return reply.code(400).send({ error: "secure_recording_url_required" });
    }

    const result = await db.query("SELECT id FROM calls WHERE id=$1 AND site_id=$2", [
      request.params.callId,
      site.id
    ]);
    if (!result.rowCount) return reply.code(404).send({ error: "call_not_found" });

    await attachRecording(
      request.params.callId,
      body.recording_url,
      typeof body.recording_mime_type === "string" ? body.recording_mime_type : undefined
    );
    await createJob("call.process", "call", request.params.callId);
    return reply.code(202).send({ ok: true, call_id: request.params.callId, status: "recording_ready" });
  });

  app.get<{ Params: { callId: string } }>("/v1/calls/:callId/recording", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });

    const result = await db.query(
      "SELECT recording_storage_key FROM calls WHERE id=$1 AND site_id=$2",
      [request.params.callId, site.id]
    );
    if (!result.rowCount || !result.rows[0].recording_storage_key) {
      return reply.code(404).send({ error: "recording_not_archived" });
    }

    const url = await createRecordingDownloadUrl(result.rows[0].recording_storage_key);
    return reply.send({ ok: true, url, expires_in_seconds: 900 });
  });
}
