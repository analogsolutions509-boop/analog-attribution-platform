import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { resolveSite } from "../auth.js";
import { assignTrackingNumber } from "../number-pool.js";
import { requireDashboard } from "./dashboard.js";
import { isAllowedCollectorOrigin, resolvePublicCollectorSite } from "../public-collector.js";

export async function registerPhonePoolRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/forwarding-numbers", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query(
      "SELECT id,phone_number,label,provider,active,created_at FROM forwarding_numbers ORDER BY active DESC,phone_number"
    );
    return reply.send({ forwarding_numbers: result.rows });
  });

  app.post("/v1/dashboard/forwarding-numbers", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body = request.body as Record<string, unknown>;
    const phoneNumber = typeof body.phone_number === "string" ? body.phone_number.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() || null : null;
    const provider = typeof body.provider === "string" ? body.provider.trim() || "unknown" : "unknown";
    if (!phoneNumber) return reply.code(400).send({ error: "phone_number_required" });
    try {
      const result = await db.query(
        "INSERT INTO forwarding_numbers(phone_number,label,provider) VALUES($1,$2,$3) RETURNING *",
        [phoneNumber, label, provider]
      );
      return reply.code(201).send({ forwarding_number: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "forwarding_number_already_exists" });
      }
      throw error;
    }
  });

  app.patch<{ Params: { forwardingNumberId: string } }>("/v1/dashboard/forwarding-numbers/:forwardingNumberId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body = request.body as Record<string, unknown>;
    const current = await db.query("SELECT * FROM forwarding_numbers WHERE id=$1 LIMIT 1", [request.params.forwardingNumberId]);
    if (!current.rowCount) return reply.code(404).send({ error: "forwarding_number_not_found" });
    const row = current.rows[0];
    const phoneNumber = typeof body.phone_number === "string" ? body.phone_number.trim() : row.phone_number;
    const label = typeof body.label === "string" ? body.label.trim() || null : row.label;
    const provider = typeof body.provider === "string" ? body.provider.trim() || "unknown" : row.provider;
    const active = typeof body.active === "boolean" ? body.active : row.active;
    if (!phoneNumber) return reply.code(400).send({ error: "phone_number_required" });
    if (!active) {
      const usage = await db.query(
        "SELECT COUNT(*)::int AS count FROM tracking_numbers WHERE forwarding_number_id=$1 AND active",
        [request.params.forwardingNumberId]
      );
      if (Number(usage.rows[0]?.count || 0) > 0) {
        return reply.code(409).send({ error: "forwarding_number_in_use" });
      }
    }
    try {
      const result = await db.query(
        "UPDATE forwarding_numbers SET phone_number=$2,label=$3,provider=$4,active=$5 WHERE id=$1 RETURNING *",
        [request.params.forwardingNumberId, phoneNumber, label, provider, active]
      );
      return reply.send({ forwarding_number: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "forwarding_number_already_exists" });
      }
      throw error;
    }
  });

  app.delete<{ Params: { forwardingNumberId: string } }>("/v1/dashboard/forwarding-numbers/:forwardingNumberId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const inUse = await db.query(
      "SELECT COUNT(*)::int AS count FROM tracking_numbers WHERE forwarding_number_id=$1",
      [request.params.forwardingNumberId]
    );
    if (Number(inUse.rows[0]?.count || 0) > 0) {
      return reply.code(409).send({ error: "forwarding_number_in_use" });
    }
    const result = await db.query(
      "DELETE FROM forwarding_numbers WHERE id=$1 RETURNING id,phone_number",
      [request.params.forwardingNumberId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "forwarding_number_not_found" });
    return reply.send({ ok: true, forwarding_number: result.rows[0] });
  });

  app.post("/v1/tracking-numbers", async (request, reply) => {
    if (request.headers["x-analog-enrollment-secret"] !== config.ANALOG_ENROLLMENT_SECRET)
      return reply.code(401).send({ error: "unauthorized" });
    const body = request.body as Record<string, unknown>;
    if (typeof body.site_id !== "string" || typeof body.phone_number !== "string")
      return reply.code(400).send({ error: "site_id_and_phone_number_required" });
    const forwardingNumberId =
      typeof body.forwarding_number_id === "string" ? body.forwarding_number_id.trim() || null : null;
    if (forwardingNumberId) {
      const forwarding = await db.query(
        "SELECT id FROM forwarding_numbers WHERE id=$1 AND active LIMIT 1",
        [forwardingNumberId]
      );
      if (!forwarding.rowCount) return reply.code(400).send({ error: "forwarding_number_not_active" });
    }
    const result = await db.query(
      "INSERT INTO tracking_numbers(site_id,phone_number,label,forwarding_number_id) VALUES($1,$2,$3,$4) ON CONFLICT(site_id,phone_number) DO UPDATE SET active=true,label=EXCLUDED.label,forwarding_number_id=EXCLUDED.forwarding_number_id RETURNING *",
      [body.site_id,body.phone_number,typeof body.label==="string"?body.label:null,forwardingNumberId]
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
    const forwardingNumberId =
      typeof body.forwarding_number_id === "string" ? body.forwarding_number_id.trim() || null : null;
    const active = body.active !== false;
    if (!siteId || !numbers.length) return reply.code(400).send({ error: "site_id_and_number_required" });
    if (active && (!forwardingNumberId || !destinationSupplierId)) {
      return reply.code(400).send({ error: "active_number_requires_forwarding_and_destination" });
    }
    if (forwardingNumberId) {
      const forwarding = await db.query("SELECT id FROM forwarding_numbers WHERE id=$1 AND active LIMIT 1", [forwardingNumberId]);
      if (!forwarding.rowCount) return reply.code(400).send({ error: "forwarding_number_not_active" });
    }
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
          "INSERT INTO tracking_numbers(site_id,phone_number,label,destination_supplier_id,forwarding_number_id,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(site_id,phone_number) DO NOTHING RETURNING *",
          [siteId, phoneNumber, label, destinationSupplierId, forwardingNumberId, active]
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
      "SELECT id,site_id,phone_number,label,active,destination_supplier_id,forwarding_number_id FROM tracking_numbers WHERE id=$1 LIMIT 1",
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
    const hasForwarding = Object.prototype.hasOwnProperty.call(body, "forwarding_number_id");
    let forwardingNumberId = current.forwarding_number_id;
    if (hasForwarding) {
      forwardingNumberId = body.forwarding_number_id === null || body.forwarding_number_id === ""
        ? null
        : typeof body.forwarding_number_id === "string" ? body.forwarding_number_id.trim() : null;
    }
    if (!siteId || !phoneNumber) return reply.code(400).send({ error: "site_id_and_number_required" });
    if (active && (!forwardingNumberId || !destinationSupplierId)) {
      return reply.code(400).send({ error: "active_number_requires_forwarding_and_destination" });
    }
    if (forwardingNumberId) {
      const forwarding = await db.query("SELECT id FROM forwarding_numbers WHERE id=$1 AND active LIMIT 1", [forwardingNumberId]);
      if (!forwarding.rowCount) return reply.code(400).send({ error: "forwarding_number_not_active" });
    }
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
        "UPDATE tracking_numbers SET site_id=$2,phone_number=$3,label=$4,active=$5,destination_supplier_id=$6,forwarding_number_id=$7 WHERE id=$1 RETURNING *",
        [numberId, siteId, phoneNumber, label, active, destinationSupplierId, forwardingNumberId]
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

  app.post("/v1/public/phone-pool/assign", async (request, reply) => {
    const hostname = typeof (request.query as { site?: unknown }).site === "string"
      ? String((request.query as { site?: string }).site).trim()
      : "";
    const site = await resolvePublicCollectorSite(hostname);
    if (!site) return reply.code(403).send({ error: "collector_site_not_allowed" });
    if (!isAllowedCollectorOrigin(request.headers.origin as string | undefined, site.hostname)) {
      return reply.code(403).send({ error: "collector_origin_not_allowed" });
    }
    const body = request.body as Record<string, unknown>;
    if (typeof body.visitor_id !== "string" || typeof body.session_id !== "string") {
      return reply.code(400).send({ error: "visitor_id_and_session_id_required" });
    }
    const assigned = await assignTrackingNumber(site.id, body.visitor_id, body.session_id);
    if (!assigned) return reply.code(409).send({ error: "number_pool_exhausted" });
    return reply.send({ ok: true, phone_number: assigned.phoneNumber, expires_at: assigned.expiresAt });
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
