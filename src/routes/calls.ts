import type { FastifyInstance } from "fastify";
import { resolveSite } from "../auth.js";
import { upsertIncomingCall } from "../calls.js";

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
      durationSeconds: typeof body.duration_seconds === "number" ? body.duration_seconds : undefined
    });
    return reply.code(202).send({ ok: true, call_id: callId });
  });
}
