import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { generateSiteKey, hashGeneratedSiteKey } from "../auth.js";

export async function registerEnrollmentRoutes(app: FastifyInstance) {
  app.post("/v1/sites/enroll", async (request, reply) => {
    if (request.headers["x-analog-enrollment-secret"] !== config.ANALOG_ENROLLMENT_SECRET)
      return reply.code(401).send({ error: "invalid_enrollment_secret" });
    const body = request.body as { hostname?: string; name?: string };
    const hostname = body.hostname?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!hostname || !name) return reply.code(400).send({ error: "hostname_and_name_required" });
    const existing = await db.query("SELECT id,hostname,name,status FROM sites WHERE hostname=$1", [hostname]);
    const siteKey = generateSiteKey();
    if (existing.rowCount) {
      await db.query("UPDATE sites SET name=$2,site_key_hash=$3,updated_at=NOW() WHERE hostname=$1", [hostname,name,hashGeneratedSiteKey(siteKey)]);
      return reply.send({ site: { ...existing.rows[0], name }, site_key: siteKey, rotated: true });
    }
    const result = await db.query(
      "INSERT INTO sites(site_key_hash,hostname,name) VALUES($1,$2,$3) RETURNING id,hostname,name,status",
      [hashGeneratedSiteKey(siteKey),hostname,name]
    );
    return reply.code(201).send({ site: result.rows[0], site_key: siteKey, rotated: false });
  });
}
