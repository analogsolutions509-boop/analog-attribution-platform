import type { FastifyInstance } from "fastify";
import { eventSchema, ingestEvent } from "../events.js";
import { resolveSite } from "../auth.js";
import { isAllowedCollectorOrigin, resolvePublicCollectorSite } from "../public-collector.js";

export async function registerEventRoutes(app: FastifyInstance) {
  app.post("/v1/public/events", async (request, reply) => {
    const hostname = typeof (request.query as { site?: unknown }).site === "string"
      ? String((request.query as { site?: string }).site).trim()
      : "";
    const site = await resolvePublicCollectorSite(hostname);
    if (!site) return reply.code(403).send({ error: "collector_site_not_allowed" });
    if (!isAllowedCollectorOrigin(request.headers.origin as string | undefined, site.hostname)) {
      return reply.code(403).send({ error: "collector_origin_not_allowed" });
    }

    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_event",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      });
    }

    const result = await ingestEvent(site.id, parsed.data);
    return reply.code(result.inserted ? 201 : 200).send({
      ok: true,
      duplicate: !result.inserted,
      ...result
    });
  });

  app.post("/v1/events", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });

    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_event",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message
        }))
      });
    }

    const result = await ingestEvent(site.id, parsed.data);
    return reply.code(result.inserted ? 201 : 200).send({
      ok: true,
      duplicate: !result.inserted,
      ...result
    });
  });
}
