import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { generateSiteKey, hashGeneratedSiteKey } from "../auth.js";

export async function registerEnrollmentRoutes(app: FastifyInstance) {
  app.post("/v1/sites/enroll", async (request, reply) => {
    const secret = request.headers["x-analog-enrollment-secret"];
    if (secret !== config.ANALOG_ENROLLMENT_SECRET) {
      return reply.code(401).send({ error: "invalid_enrollment_secret" });
    }

    const body = request.body as { hostname?: string; name?: string };
    const hostname = body.hostname?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!hostname || !name) {
      return reply.code(400).send({ error: "hostname_and_name_required" });
    }

    const siteKey = generateSiteKey();
    const result = await db.query(
      "INSERT INTO sites(site_key_hash, hostname, name) VALUES($1,$2,$3) ON CONFLICT(hostname) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW() RETURNING id, hostname, name, status",
      [hashGeneratedSiteKey(siteKey), hostname, name]
    );

    return reply.code(201).send({
      site: result.rows[0],
      site_key: siteKey
    });
  });
}
