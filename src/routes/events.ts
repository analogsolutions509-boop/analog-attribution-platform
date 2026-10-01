import type { FastifyInstance } from "fastify";
import { eventSchema, ingestEvent } from "../events.js";
import { resolveSite } from "../auth.js";

export async function registerEventRoutes(app: FastifyInstance) {
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
