import type { FastifyInstance } from "fastify";
import { requireDashboard } from "./dashboard.js";
import { db } from "../db.js";

export async function registerLeadSearchRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/leads/search", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const q = request.query as Record<string, string | undefined>;
    if (q.start && q.end && Number.isFinite(new Date(q.start).getTime()) && Number.isFinite(new Date(q.end).getTime()) && new Date(q.end).getTime() <= new Date(q.start).getTime()) {
      return reply.code(400).send({ error: "invalid_date_range" });
    }
    const params: unknown[] = [];
    const parts: string[] = ["1=1"];
    const add = (value: unknown) => { params.push(value); return "$" + params.length; };

    if (q.q?.trim()) {
      const p = add("%" + q.q.trim() + "%");
      parts.push("(l.id::text ILIKE " + p + " OR l.customer_name ILIKE " + p +
        " OR l.company_name ILIKE " + p + " OR l.customer_phone ILIKE " + p +
        " OR l.customer_email ILIKE " + p + ")");
    }
    if (q.siteId) parts.push("l.site_id=" + add(q.siteId));
    if (q.supplierId) parts.push("EXISTS(SELECT 1 FROM lead_assignments la WHERE la.lead_id=l.id AND la.supplier_id=" + add(q.supplierId) + ")");
    if (q.channel) parts.push("l.source=" + add(q.channel));
    if (q.status) parts.push("l.status=" + add(q.status));
    if (q.outcome) parts.push("l.outcome=" + add(q.outcome));
    if (q.start) {
      if (Number.isNaN(new Date(q.start).getTime())) return reply.code(400).send({ error: "invalid_date_filter" });
      parts.push("l.created_at >= " + add(q.start) + "::timestamptz");
    }
    if (q.end) {
      if (Number.isNaN(new Date(q.end).getTime())) return reply.code(400).send({ error: "invalid_date_filter" });
      parts.push("l.created_at < " + add(q.end) + "::timestamptz");
    }
    if (q.transcript?.trim()) parts.push("EXISTS(SELECT 1 FROM calls cx JOIN call_transcripts tx ON tx.call_id=cx.id WHERE cx.lead_id=l.id AND to_tsvector('simple',coalesce(tx.full_text,'')) @@ plainto_tsquery('simple'," + add(q.transcript.trim()) + "))");
    if (q.tag) parts.push("l.tags ? " + add(q.tag));
    if (q.minDuration && Number.isFinite(Number(q.minDuration))) parts.push("EXISTS(SELECT 1 FROM calls cd WHERE cd.lead_id=l.id AND cd.duration_seconds >= " + add(Number(q.minDuration)) + ")");
    if (q.maxDuration && Number.isFinite(Number(q.maxDuration))) parts.push("EXISTS(SELECT 1 FROM calls cd WHERE cd.lead_id=l.id AND cd.duration_seconds <= " + add(Number(q.maxDuration)) + ")");

    const requestedLimit = Number(q.limit ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50, 1), 100);
    const requestedOffset = Number(q.offset ?? 0);
    const offset = Math.min(Math.max(Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0, 0), 100000000);
    const limitParam = add(limit);
    const offsetParam = add(offset);
    const result = await db.query(
      "SELECT l.id,l.site_id,l.status,l.outcome,l.source,l.customer_name,l.company_name,l.customer_phone," +
      "l.customer_email,l.service_type,l.summary,l.tags,l.created_at,s.name AS site_name,s.hostname," +
      "sp.name AS supplier,COUNT(c.id)::int call_count,MAX(c.duration_seconds)::int max_duration," +
      "MAX(c.created_at) last_call_at,COUNT(*) OVER()::int total_count " +
      "FROM leads l JOIN sites s ON s.id=l.site_id LEFT JOIN suppliers sp ON sp.id=l.routed_supplier_id " +
      "LEFT JOIN calls c ON c.lead_id=l.id WHERE " + parts.join(" AND ") +
      " GROUP BY l.id,s.name,s.hostname,sp.name ORDER BY l.created_at DESC LIMIT " + limitParam + " OFFSET " + offsetParam,
      params
    );
    const total = Number(result.rows[0]?.total_count ?? (offset + result.rows.length));
    const leads = result.rows.map(({ total_count: _totalCount, ...lead }: Record<string, unknown>) => lead);
    return reply.send({ leads, limit, offset, total, hasMore: offset + leads.length < total });
  });
}
