import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";

function authorized(request: any) {
  return request.headers["x-analog-enrollment-secret"] === config.ANALOG_ENROLLMENT_SECRET;
}

export async function registerSupplierRoutes(app: FastifyInstance) {
  app.post("/v1/suppliers", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.name !== "string") return reply.code(400).send({ error: "name_required" });
    const result = await db.query(
      "INSERT INTO suppliers(name,endpoint_url) VALUES($1,$2) RETURNING id,name,status,endpoint_url",
      [body.name.trim(), typeof body.endpoint_url === "string" ? body.endpoint_url : null]
    );
    return reply.code(201).send({ supplier: result.rows[0] });
  });

  app.post("/v1/routing-rules", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.supplier_id !== "string") return reply.code(400).send({ error: "supplier_id_required" });
    const result = await db.query(
      "INSERT INTO routing_rules(supplier_id,site_id,service_type,region,priority) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [body.supplier_id,typeof body.site_id==="string"?body.site_id:null,typeof body.service_type==="string"?body.service_type:null,typeof body.region==="string"?body.region:null,typeof body.priority==="number"?body.priority:100]
    );
    return reply.code(201).send({ rule: result.rows[0] });
  });
}
