import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { resolveSite } from "../auth.js";
import { assignTrackingNumber } from "../number-pool.js";

export async function registerPhonePoolRoutes(app: FastifyInstance) {
  app.post("/v1/tracking-numbers", async (request, reply) => {
    if (request.headers["x-analog-enrollment-secret"] !== config.ANALOG_ENROLLMENT_SECRET)
      return reply.code(401).send({ error: "unauthorized" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.site_id !== "string" || typeof body.phone_number !== "string")
      return reply.code(400).send({ error: "site_id_and_phone_number_required" });
    const result = await db.query(
      "INSERT INTO tracking_numbers(site_id,phone_number,label) VALUES($1,$2,$3) ON CONFLICT(site_id,phone_number) DO UPDATE SET active=true,label=EXCLUDED.label RETURNING *",
      [body.site_id,body.phone_number,typeof body.label==="string"?body.label:null]
    );
    return reply.code(201).send({ tracking_number: result.rows[0] });
  });

  app.post("/v1/phone-pool/assign", async (request, reply) => {
    const site = await resolveSite(request.headers["x-analog-site-key"] as string | undefined);
    if (!site) return reply.code(401).send({ error: "invalid_site_key" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.visitor_id !== "string" || typeof body.session_id !== "string")
      return reply.code(400).send({ error: "visitor_id_and_session_id_required" });
    const assigned = await assignTrackingNumber(site.id,body.visitor_id,body.session_id);
    if (!assigned) return reply.code(409).send({ error: "number_pool_exhausted" });
    return reply.send({ ok: true, phone_number: assigned.phoneNumber, expires_at: assigned.expiresAt });
  });
}
