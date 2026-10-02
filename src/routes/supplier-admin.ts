import type { FastifyInstance } from "fastify";
import { requireDashboard } from "./dashboard.js";
import { db } from "../db.js";
import { normalizeSupplierInput } from "../supplier-admin.js";

export async function registerSupplierAdminRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/supplier-directory", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query(
      "SELECT s.id,s.name,s.status,s.endpoint_url,s.contact_phone,s.notification_email,s.notification_sms,s.created_at," +
      " COUNT(DISTINCT ss.site_id)::int AS website_count," +
      " COALESCE(json_agg(json_build_object('assignment_id',ss.id,'site_id',ss.site_id,'site_name',st.name,'hostname',st.hostname,'rank',ss.rank,'active',ss.active) ORDER BY ss.rank) FILTER (WHERE ss.id IS NOT NULL),'[]'::json) AS assignments" +
      " FROM suppliers s LEFT JOIN site_suppliers ss ON ss.supplier_id=s.id LEFT JOIN sites st ON st.id=ss.site_id" +
      " GROUP BY s.id ORDER BY s.name"
    );
    return reply.send({ suppliers: result.rows });
  });

  app.post("/v1/dashboard/supplier-directory", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    try {
      const input = normalizeSupplierInput((request.body ?? {}) as Record<string, unknown>);
      const result = await db.query(
        "INSERT INTO suppliers(name,status,endpoint_url,contact_phone,notification_email,notification_sms) " +
        "VALUES($1,$2,$3,$4,$5,$6) " +
        "RETURNING id,name,status,endpoint_url,contact_phone,notification_email,notification_sms,created_at",
        [input.name,input.status,input.endpoint_url,input.contact_phone,input.notification_email,input.notification_sms]
      );
      return reply.code(201).send({ supplier: result.rows[0] });
    } catch (error) {
      const message = String(error).replace(/[<>]/g, "");
      if (/_(required|invalid|must_be_text|too_long)$/.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  app.patch<{Params:{supplierId:string}}>("/v1/dashboard/supplier-directory/:supplierId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    try {
      const input = normalizeSupplierInput((request.body ?? {}) as Record<string, unknown>);
      const result = await db.query(
        "UPDATE suppliers SET name=$2,status=$3,endpoint_url=$4,contact_phone=$5,notification_email=$6,notification_sms=$7,updated_at=NOW() " +
        "WHERE id=$1 RETURNING id,name,status,endpoint_url,contact_phone,notification_email,notification_sms,created_at,updated_at",
        [request.params.supplierId,input.name,input.status,input.endpoint_url,input.contact_phone,input.notification_email,input.notification_sms]
      );
      if (!result.rowCount) return reply.code(404).send({ error: "supplier_not_found" });
      return reply.send({ supplier: result.rows[0] });
    } catch (error) {
      const message = String(error).replace(/[<>]/g, "");
      if (/_(required|invalid|must_be_text|too_long)$/.test(message)) return reply.code(400).send({ error: message });
      throw error;
    }
  });

  app.post<{Params:{siteId:string}}>("/v1/dashboard/sites/:siteId/suppliers", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const supplierId = typeof body.supplier_id === "string" ? body.supplier_id : "";
    const rank = Number(body.rank);
    if (!supplierId || !Number.isInteger(rank) || rank < 1 || rank > 5) {
      return reply.code(400).send({ error: "supplier_id_and_rank_required" });
    }
    const site = await db.query("SELECT id FROM sites WHERE id=$1", [request.params.siteId]);
    if (!site.rowCount) return reply.code(404).send({ error: "site_not_found" });
    const supplier = await db.query("SELECT id FROM suppliers WHERE id=$1 AND status='active'", [supplierId]);
    if (!supplier.rowCount) return reply.code(404).send({ error: "active_supplier_not_found" });
    try {
      const result = await db.query(
        "INSERT INTO site_suppliers(site_id,supplier_id,rank) VALUES($1,$2,$3) RETURNING id,site_id,supplier_id,rank,active",
        [request.params.siteId,supplierId,rank]
      );
      return reply.code(201).send({ assignment: result.rows[0] });
    } catch (error) {
      const detail = String(error);
      if (detail.includes("site_suppliers_site_id_supplier_id_key")) return reply.code(409).send({ error: "supplier_already_assigned" });
      if (detail.includes("site_suppliers_site_id_rank_key")) return reply.code(409).send({ error: "rank_already_assigned" });
      throw error;
    }
  });

  app.delete<{Params:{assignmentId:string}}>("/v1/dashboard/site-supplier-assignments/:assignmentId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query(
      "DELETE FROM site_suppliers WHERE id=$1 RETURNING id,site_id,supplier_id",
      [request.params.assignmentId]
    );
    if (!result.rowCount) return reply.code(404).send({ error: "assignment_not_found" });
    return reply.send({ ok: true, assignment: result.rows[0] });
  });
}
