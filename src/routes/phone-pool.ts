import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { resolveSite } from "../auth.js";
import { assignTrackingNumber } from "../number-pool.js";
import { requireDashboard } from "./dashboard.js";

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

  app.post("/v1/dashboard/numbers", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body = request.body as Record<string, unknown>;
    const siteId = typeof body.site_id === "string" ? body.site_id.trim() : "";
    const suppliedNumbers = Array.isArray(body.numbers) ? body.numbers : [];
    const numbers = [...new Set([
      ...(typeof body.phone_number === "string" ? [body.phone_number] : []),
      ...suppliedNumbers.filter((value): value is string => typeof value === "string")
    ].map((value) => value.trim()).filter(Boolean))];
    const label = typeof body.label === "string" ? body.label.trim() || null : null;
    const destinationSupplierId =
      typeof body.destination_supplier_id === "string" ? body.destination_supplier_id.trim() || null : null;
    if (!siteId || !numbers.length) return reply.code(400).send({ error: "site_id_and_number_required" });
    const site = await db.query("SELECT id FROM sites WHERE id=$1 LIMIT 1", [siteId]);
    if (!site.rowCount) return reply.code(404).send({ error: "site_not_found" });
    if (destinationSupplierId) {
      const destination = await db.query(
        "SELECT s.id FROM suppliers s JOIN site_suppliers ss ON ss.supplier_id=s.id WHERE s.id=$1 AND ss.site_id=$2 AND ss.active AND s.status='active' LIMIT 1",
        [destinationSupplierId, siteId]
      );
      if (!destination.rowCount) return reply.code(400).send({ error: "destination_supplier_not_assigned" });
    }
    const client = await db.connect();
    const created: unknown[] = [];
    const skipped: string[] = [];
    try {
      await client.query("BEGIN");
      for (const phoneNumber of numbers) {
        const result = await client.query(
          "INSERT INTO tracking_numbers(site_id,phone_number,label,destination_supplier_id) VALUES($1,$2,$3,$4) ON CONFLICT(site_id,phone_number) DO NOTHING RETURNING *",
          [siteId, phoneNumber, label, destinationSupplierId]
        );
        if (result.rowCount) created.push(result.rows[0]);
        else skipped.push(phoneNumber);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return reply.code(201).send({ numbers: created, skipped });
  });

  app.patch<{ Params: { numberId: string } }>("/v1/dashboard/numbers/:numberId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body = request.body as Record<string, unknown>;
    const numberId = request.params.numberId;
    const existing = await db.query(
      "SELECT id,site_id,phone_number,label,active,destination_supplier_id FROM tracking_numbers WHERE id=$1 LIMIT 1",
      [numberId]
    );
    if (!existing.rowCount) return reply.code(404).send({ error: "tracking_number_not_found" });
    const current = existing.rows[0];
    const siteId = typeof body.site_id === "string" ? body.site_id.trim() : current.site_id;
    const phoneNumber = typeof body.phone_number === "string" ? body.phone_number.trim() : current.phone_number;
    const label = typeof body.label === "string" ? body.label.trim() || null : current.label;
    const active = typeof body.active === "boolean" ? body.active : current.active;
    const hasDestination = Object.prototype.hasOwnProperty.call(body, "destination_supplier_id");
    let destinationSupplierId = current.destination_supplier_id;
    if (hasDestination) {
      destinationSupplierId = body.destination_supplier_id === null || body.destination_supplier_id === ""
        ? null
        : typeof body.destination_supplier_id === "string" ? body.destination_supplier_id.trim() : null;
    } else if (siteId !== current.site_id) {
      destinationSupplierId = null;
    }
    if (!siteId || !phoneNumber) return reply.code(400).send({ error: "site_id_and_number_required" });
    if (siteId !== current.site_id) {
      const site = await db.query("SELECT id FROM sites WHERE id=$1 LIMIT 1", [siteId]);
      if (!site.rowCount) return reply.code(404).send({ error: "site_not_found" });
    }
    if (destinationSupplierId) {
      const destination = await db.query(
        "SELECT s.id FROM suppliers s JOIN site_suppliers ss ON ss.supplier_id=s.id WHERE s.id=$1 AND ss.site_id=$2 AND ss.active AND s.status='active' LIMIT 1",
        [destinationSupplierId, siteId]
      );
      if (!destination.rowCount) return reply.code(400).send({ error: "destination_supplier_not_assigned" });
    }
    const duplicate = await db.query(
      "SELECT id FROM tracking_numbers WHERE site_id=$1 AND phone_number=$2 AND id<>$3 LIMIT 1",
      [siteId, phoneNumber, numberId]
    );
    if (duplicate.rowCount) return reply.code(409).send({ error: "tracking_number_already_exists_for_site" });
    const changedIdentity = siteId !== current.site_id || phoneNumber !== current.phone_number;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (changedIdentity) {
        await client.query("DELETE FROM number_assignments WHERE tracking_number_id=$1", [numberId]);
      }
      const result = await client.query(
        "UPDATE tracking_numbers SET site_id=$2,phone_number=$3,label=$4,active=$5,destination_supplier_id=$6 WHERE id=$1 RETURNING *",
        [numberId, siteId, phoneNumber, label, active, destinationSupplierId]
      );
      await client.query("COMMIT");
      return reply.send({ tracking_number: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete<{ Params: { numberId: string } }>("/v1/dashboard/numbers/:numberId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query("DELETE FROM tracking_numbers WHERE id=$1 RETURNING id,site_id,phone_number", [request.params.numberId]);
    if (!result.rowCount) return reply.code(404).send({ error: "tracking_number_not_found" });
    return reply.send({ ok: true, tracking_number: result.rows[0] });
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
