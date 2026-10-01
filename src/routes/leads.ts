import type { FastifyInstance } from "fastify";
import { resolveSite } from "../auth.js";
import { createLead } from "../leads.js";

export async function registerLeadRoutes(app: FastifyInstance) {
  app.post("/v1/leads", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.customer_phone !== "string" && typeof body.customer_email !== "string") {
      return reply.code(400).send({ error: "customer_phone_or_email_required" });
    }
    const leadId = await createLead({
      siteId: site.id,
      visitorId: typeof body.visitor_id === "string" ? body.visitor_id : undefined,
      sessionId: typeof body.session_id === "string" ? body.session_id : undefined,
      source: typeof body.source === "string" ? body.source : "website",
      customerName: typeof body.customer_name === "string" ? body.customer_name : undefined,
      companyName: typeof body.company_name === "string" ? body.company_name : undefined,
      customerPhone: typeof body.customer_phone === "string" ? body.customer_phone : undefined,
      customerEmail: typeof body.customer_email === "string" ? body.customer_email : undefined,
      serviceType: typeof body.service_type === "string" ? body.service_type : undefined,
      requirements: typeof body.requirements === "object" && body.requirements ? body.requirements as Record<string, unknown> : {},
      summary: typeof body.summary === "string" ? body.summary : undefined,
      sourceDetail: typeof body.source_detail === "object" && body.source_detail ? body.source_detail as Record<string, unknown> : {}
    });
    return reply.code(201).send({ ok: true, lead_id: leadId });
  });
}
