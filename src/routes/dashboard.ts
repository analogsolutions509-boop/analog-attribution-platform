import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { verifyDashboardCredentials, createDashboardSession, verifyDashboardSession } from "../dashboard-auth.js";
import { createRecordingDownloadUrl } from "../storage/r2.js";

const COOKIE_NAME = "analog_dashboard_session";
const UI_ROOT = join(process.cwd(), "public");

function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function dashboardUser(request: FastifyRequest): string | null {
  if (!config.ANALOG_DASHBOARD_PASSWORD) return null;
  const cookies = parseCookies(request.headers.cookie);
  return verifyDashboardSession(cookies[COOKIE_NAME], config.ANALOG_DASHBOARD_PASSWORD);
}

function requireDashboard(request: FastifyRequest, reply: FastifyReply): string | null {
  const user = dashboardUser(request);
  if (!user) {
    reply.code(401).send({ error: "dashboard_auth_required" });
    return null;
  }
  return user;
}

function setSession(reply: FastifyReply, username: string) {
  const session = createDashboardSession(username, config.ANALOG_DASHBOARD_PASSWORD ?? "");
  reply.header("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200`);
}

export function buildDashboardLeadsQuery(where: string, limitPosition: number): string {
  return `
      SELECT l.id,l.site_id,l.status,l.source,l.customer_name,l.company_name,l.customer_phone,
             l.customer_email,l.service_type,l.summary,l.created_at,l.updated_at,
             s.name AS site_name,s.hostname,
             COUNT(c.id)::int AS call_count,
             MAX(c.created_at) AS last_call_at,
             (SELECT c2.id FROM calls c2 WHERE c2.lead_id=l.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1) AS latest_call_id
      FROM leads l JOIN sites s ON s.id=l.site_id
      LEFT JOIN calls c ON c.lead_id=l.id
      ${where}
      GROUP BY l.id,s.name,s.hostname
      ORDER BY l.created_at DESC LIMIT $${limitPosition}
    `;
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (_request, reply) => {
    const html = await readFile(join(UI_ROOT, "dashboard.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/dashboard/manifest.json", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "manifest.json"), "utf8");
    return reply.type("application/manifest+json").send(body);
  });

  app.get("/dashboard/sw.js", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "sw.js"), "utf8");
    return reply.type("application/javascript; charset=utf-8").send(body);
  });

  app.post("/v1/dashboard/login", async (request, reply) => {
    if (!config.ANALOG_DASHBOARD_PASSWORD) return reply.code(503).send({ error: "dashboard_not_configured" });
    const body = request.body as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!verifyDashboardCredentials(username, password, config.ANALOG_DASHBOARD_USERNAME, config.ANALOG_DASHBOARD_PASSWORD)) {
      return reply.code(401).send({ error: "invalid_dashboard_credentials" });
    }
    setSession(reply, username);
    return reply.send({ ok: true, user: username });
  });

  app.post("/v1/dashboard/logout", async (request, reply) => {
    if (!dashboardUser(request)) return reply.code(401).send({ error: "dashboard_auth_required" });
    reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`);
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { siteId?: string } }>("/v1/dashboard/summary", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const params: unknown[] = [];
    let siteFilter = "";
    if (request.query.siteId) {
      params.push(request.query.siteId);
      siteFilter = ` AND site_id=$${params.length}`;
    }
    const result = await db.query(`
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE COALESCE(duration_seconds,0) > 0)::int AS answered_calls,
        COUNT(*) FILTER (WHERE COALESCE(duration_seconds,0) = 0)::int AS missed_calls,
        COUNT(*) FILTER (WHERE lead_id IS NOT NULL)::int AS attributed_calls,
        COUNT(*) FILTER (WHERE recording_status = 'stored')::int AS recordings,
        COUNT(*) FILTER (WHERE transcript_status = 'complete')::int AS transcripts,
        ROUND(AVG(duration_seconds) FILTER (WHERE COALESCE(duration_seconds,0) > 0),1) AS avg_call_duration
      FROM calls
      WHERE created_at >= NOW() - INTERVAL '30 days'${siteFilter}
    `, params);
    const leads = await db.query(`SELECT COUNT(*)::int AS total FROM leads WHERE created_at >= NOW() - INTERVAL '30 days'${request.query.siteId ? ` AND site_id=$1` : ""}`, request.query.siteId ? [request.query.siteId] : []);
    const trend = await db.query(`
      SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS calls
      FROM calls
      WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'${siteFilter}
      GROUP BY 1 ORDER BY 1
    `, params);
    return reply.send({ summary: result.rows[0], leads: leads.rows[0], trend: trend.rows });
  });

  app.get<{ Querystring: { limit?: string; siteId?: string } }>("/v1/dashboard/calls", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const limit = Math.min(Math.max(Number(request.query.limit ?? 25) || 25, 1), 100);
    const siteId = request.query.siteId;
    const params: unknown[] = [];
    let where = "";
    if (siteId) { params.push(siteId); where = `WHERE c.site_id=$${params.length}`; }
    params.push(limit);
    const result = await db.query(`
      SELECT c.id,c.provider,c.provider_call_id,c.caller_number,c.called_number,c.direction,
             c.started_at,c.ended_at,c.duration_seconds,c.status,c.recording_status,c.transcript_status,
             c.lead_id,c.attribution_confidence,c.attribution_method,c.created_at,
             s.name AS site_name,s.hostname,
             l.customer_name,l.company_name,l.customer_phone,l.customer_email,l.service_type,l.status AS lead_status,
             ci.summary,ci.intent,ci.urgency,ci.outcome
      FROM calls c
      JOIN sites s ON s.id=c.site_id
      LEFT JOIN leads l ON l.id=c.lead_id
      LEFT JOIN call_intelligence ci ON ci.call_id=c.id
      ${where}
      ORDER BY c.created_at DESC LIMIT $${params.length}
    `, params);
    return reply.send({ calls: result.rows });
  });

  app.get<{ Params: { callId: string } }>("/v1/dashboard/calls/:callId", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const callResult = await db.query(`
      SELECT c.*,s.name AS site_name,s.hostname
      FROM calls c JOIN sites s ON s.id=c.site_id WHERE c.id=$1 LIMIT 1
    `, [request.params.callId]);
    if (!callResult.rowCount) return reply.code(404).send({ error: "call_not_found" });
    const call = callResult.rows[0];
    const [lead, intelligence, transcript, segments] = await Promise.all([
      call.lead_id ? db.query("SELECT * FROM leads WHERE id=$1", [call.lead_id]) : Promise.resolve({ rows: [] as any[] }),
      db.query("SELECT * FROM call_intelligence WHERE call_id=$1", [call.id]),
      db.query("SELECT id,provider,model,language,status,full_text,duration_seconds,completed_at FROM call_transcripts WHERE call_id=$1", [call.id]),
      db.query("SELECT segment_index,speaker_label,speaker_role,start_seconds,end_seconds,text FROM transcript_segments WHERE transcript_id=(SELECT id FROM call_transcripts WHERE call_id=$1) ORDER BY segment_index", [call.id])
    ]);
    const recordingUrl = call.recording_storage_key ? await createRecordingDownloadUrl(call.recording_storage_key) : null;
    return reply.send({
      call,
      lead: lead.rows[0] ?? null,
      intelligence: intelligence.rows[0] ?? null,
      transcript: transcript.rows[0] ? { ...transcript.rows[0], segments: segments.rows } : null,
      recording: call.recording_storage_key ? { url: recordingUrl, expires_in_seconds: 900 } : null
    });
  });

  app.get<{ Querystring: { limit?: string; siteId?: string } }>("/v1/dashboard/leads", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const limit = Math.min(Math.max(Number(request.query.limit ?? 25) || 25, 1), 100);
    const params: unknown[] = [];
    let where = "";
    if (request.query.siteId) { params.push(request.query.siteId); where = `WHERE l.site_id=$${params.length}`; }
    params.push(limit);
    const result = await db.query(buildDashboardLeadsQuery(where, params.length), params);
    return reply.send({ leads: result.rows });
  });

  app.get("/v1/dashboard/sites", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const result = await db.query(`
      SELECT s.id,s.name,s.hostname,s.status,s.created_at,
             (SELECT COUNT(*) FROM tracking_numbers tn WHERE tn.site_id=s.id AND tn.active)::int AS tracking_numbers,
             (SELECT COUNT(*) FROM calls c WHERE c.site_id=s.id)::int AS total_calls,
             (SELECT COUNT(*) FROM leads l WHERE l.site_id=s.id)::int AS total_leads
      FROM sites s ORDER BY s.name
    `);
    return reply.send({ sites: result.rows });
  });

  app.get("/v1/dashboard/system", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const [jobs, outbox] = await Promise.all([
      db.query(`SELECT status,COUNT(*)::int AS count FROM jobs GROUP BY status ORDER BY status`),
      db.query(`SELECT status,COUNT(*)::int AS count FROM analog_os_outbox GROUP BY status ORDER BY status`)
    ]);
    return reply.send({ jobs: jobs.rows, analog_os_outbox: outbox.rows });
  });
}
