import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { verifyDashboardCredentials, createDashboardSession, verifyDashboardSession } from "../dashboard-auth.js";
import { getDashboardAccessMessage, isAllowedDashboardEmail } from "../dashboard-access.js";
import { createRecordingDownloadUrl } from "../storage/r2.js";
import { createJob } from "../jobs.js";
import { getAnalogOSReconciliationStatus, getLondonDateKey, getLondonMonthKey, getReadOnlyAnalogOSContext, validateReconciliationDate, validateReconciliationMonth } from "../analog-os-reconciliation.js";
import { getAnalogOSMonthlySnapshot } from "../analog-os-monthly.js";

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

type DashboardIdentity =
  | { kind: "auth0"; username: string; email: string; name?: string; picture?: string }
  | { kind: "legacy"; username: string }
  | { kind: "denied"; email: string; reason: "access_not_configured" | "email_not_verified" };

async function dashboardIdentity(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<DashboardIdentity | null> {
  const auth0Enabled = Boolean(
    config.AUTH0_DOMAIN &&
    config.AUTH0_CLIENT_ID &&
    config.AUTH0_CLIENT_SECRET &&
    config.AUTH0_SESSION_SECRET
  );

  if (auth0Enabled && app.auth0Client) {
    const session = await app.auth0Client.getSession({ request, reply });
    const user = session?.user;
    if (user?.sub) {
      const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
      if (!email) return { kind: "denied", email: "", reason: "access_not_configured" };
      if (user.email_verified === false) return { kind: "denied", email, reason: "email_not_verified" };
      if (!isAllowedDashboardEmail(email, config.ANALOG_DASHBOARD_ALLOWED_EMAILS, config.ANALOG_DASHBOARD_ALLOW_ANY_AUTH0_USER)) {
        return { kind: "denied", email, reason: "access_not_configured" };
      }
      return {
        kind: "auth0",
        username: email,
        email,
        name: typeof user.name === "string" ? user.name : undefined,
        picture: typeof user.picture === "string" ? user.picture : undefined
      };
    }
  }

  if (!config.ANALOG_DASHBOARD_PASSWORD) return null;
  const cookies = parseCookies(request.headers.cookie);
  const username = verifyDashboardSession(cookies[COOKIE_NAME], config.ANALOG_DASHBOARD_PASSWORD);
  return username ? { kind: "legacy", username } : null;
}

export async function requireDashboard(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const identity = await dashboardIdentity(app, request, reply);
  if (!identity) {
    reply.code(401).send({ error: "dashboard_auth_required" });
    return null;
  }
  if (identity.kind === "denied") {
    reply.code(403).send({ error: identity.reason, email: identity.email });
    return null;
  }
  return identity.username;
}

function setSession(reply: FastifyReply, username: string) {
  const session = createDashboardSession(username, config.ANALOG_DASHBOARD_PASSWORD ?? "");
  reply.header("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200`);
}

async function loadAnalogOSContextForCall(call: any): Promise<any | null> {
  const callerNumber = String(call.caller_number || "");
  const occurredAt = call.started_at || call.created_at;
  if (!call.site_id || !call.hostname || !occurredAt || callerNumber.replace(/\D/g, "").length < 7) return null;

  const occurredDate = new Date(occurredAt);
  if (Number.isNaN(occurredDate.getTime())) return null;

  try {
    return await getReadOnlyAnalogOSContext({
      date: getLondonDateKey(occurredDate),
      siteHostname: String(call.hostname),
      callerNumber,
      calledNumber: String(call.called_number || "")
    });
  } catch {
    // The OS history source is optional for call-detail rendering; a read failure
    // must never stop the Attribution call record from opening.
    return null;
  }
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

export function buildDashboardSitesQuery(): string {
  return `
      SELECT s.id,s.name,s.hostname,s.status,s.created_at,
             (SELECT COUNT(*) FROM tracking_numbers tn WHERE tn.site_id=s.id AND tn.active)::int AS tracking_numbers,
             (SELECT COUNT(*) FROM calls c WHERE c.site_id=s.id)::int AS total_calls,
             (SELECT COUNT(*) FROM leads l WHERE l.site_id=s.id)::int AS total_leads,
             COUNT(DISTINCT ss.supplier_id)::int AS supplier_count
      FROM sites s
      LEFT JOIN site_suppliers ss ON ss.site_id=s.id
      GROUP BY s.id
      ORDER BY s.name
    `;
}

export function buildDashboardNumbersQuery(filterBySite = false): string {
  return `
      SELECT tn.id,tn.phone_number,tn.label,tn.active,tn.created_at,
             s.id AS site_id,s.name AS site_name,s.hostname,
             tn.destination_supplier_id,
             dst.name AS destination_supplier_name,
             COALESCE(NULLIF(dst.contact_phone,''),NULLIF(dst.endpoint_url,'')) AS destination_number,
             tn.forwarding_number_id,
             fn.phone_number AS forwarding_number,
             fn.label AS forwarding_label,
             fn.provider AS forwarding_provider,
             fn.active AS forwarding_active,
             COALESCE(
               tn.active
               AND tn.forwarding_number_id IS NOT NULL
               AND fn.id IS NOT NULL
               AND fn.active,
               FALSE
             ) AS forwarding_ready,
             COALESCE(
               tn.active
               AND tn.forwarding_number_id IS NOT NULL
               AND fn.id IS NOT NULL
               AND fn.active,
               FALSE
             ) AS pool_ready,
             CASE
               WHEN NOT tn.active THEN 'tracking_number_inactive'
               WHEN tn.forwarding_number_id IS NULL THEN 'forwarding_number_missing'
               WHEN fn.id IS NULL THEN 'forwarding_number_not_found'
               WHEN NOT fn.active THEN 'forwarding_number_inactive'
               ELSE 'ready'
             END AS pool_issue,
             COALESCE(
               tn.destination_supplier_id IS NOT NULL
               AND dst.status='active'
               AND EXISTS (
                 SELECT 1 FROM site_suppliers assigned
                 WHERE assigned.site_id=tn.site_id
                   AND assigned.supplier_id=tn.destination_supplier_id
                   AND assigned.active
               )
               AND (
                 NULLIF(dst.contact_phone,'') IS NOT NULL
                 OR NULLIF(dst.endpoint_url,'') IS NOT NULL
               ),
               FALSE
             ) AS supplier_ready,
             CASE
               WHEN tn.destination_supplier_id IS NULL THEN 'default_supplier_missing'
               WHEN dst.id IS NULL OR dst.status <> 'active' THEN 'default_supplier_inactive'
               WHEN NOT EXISTS (
                 SELECT 1 FROM site_suppliers assigned
                 WHERE assigned.site_id=tn.site_id
                   AND assigned.supplier_id=tn.destination_supplier_id
                   AND assigned.active
               ) THEN 'default_supplier_not_assigned_to_site'
               WHEN NULLIF(dst.contact_phone,'') IS NULL
                 AND NULLIF(dst.endpoint_url,'') IS NULL THEN 'default_supplier_contact_missing'
               ELSE 'ready'
             END AS supplier_issue,
             COUNT(DISTINCT na.id)::int AS active_assignments,
             COUNT(DISTINCT ss.supplier_id)::int AS destination_count,
             COALESCE(
               STRING_AGG(
                 DISTINCT CONCAT(
                   'Rank ',ss.rank,': ',
                   COALESCE(NULLIF(sp.contact_phone,''),NULLIF(sp.endpoint_url,''),sp.name)
                 ),
                 ' | ' ORDER BY CONCAT(
                   'Rank ',ss.rank,': ',
                   COALESCE(NULLIF(sp.contact_phone,''),NULLIF(sp.endpoint_url,''),sp.name)
                 )
               ),
               ''
             ) AS destinations
      FROM tracking_numbers tn
      JOIN sites s ON s.id=tn.site_id
      LEFT JOIN suppliers dst ON dst.id=tn.destination_supplier_id
      LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id
      LEFT JOIN number_assignments na
        ON na.tracking_number_id=tn.id AND na.expires_at>NOW()
      LEFT JOIN site_suppliers ss
        ON ss.site_id=s.id AND ss.active
      LEFT JOIN suppliers sp
        ON sp.id=ss.supplier_id AND sp.status='active'
      ${filterBySite ? "WHERE tn.site_id=$1\n      " : ""}GROUP BY tn.id,s.id,dst.id,fn.id
      ORDER BY s.name,tn.phone_number
    `;
}

export type DashboardListFilters = {
  siteId?: string;
  q?: string;
  start?: string;
  end?: string;
  status?: string;
  leadType?: string;
  provider?: string;
  limit?: string;
  offset?: string;
};

export type BuiltDashboardListQuery = {
  sql: string;
  params: unknown[];
  limit: number;
  offset: number;
};

function boundedListValue(value: string | undefined, fallback: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), 0), max);
}

export function isValidDashboardDateFilter(value: string | undefined): boolean {
  return !value || !Number.isNaN(new Date(value).getTime());
}

export function isValidDashboardDateRange(start?: string, end?: string): boolean {
  if (!isValidDashboardDateFilter(start) || !isValidDashboardDateFilter(end)) return false;
  return !start || !end || new Date(end).getTime() > new Date(start).getTime();
}

export function buildDashboardCallsListQuery(filters: DashboardListFilters = {}): BuiltDashboardListQuery {
  const params: unknown[] = [];
  const clauses: string[] = ["1=1"];
  const add = (value: unknown) => { params.push(value); return "$" + params.length; };

  if (filters.siteId) clauses.push("c.site_id=" + add(filters.siteId));
  if (filters.q?.trim()) {
    const p = add("%" + filters.q.trim() + "%");
    clauses.push("(c.id::text ILIKE " + p + " OR c.provider_call_id ILIKE " + p +
      " OR l.id::text ILIKE " + p + " OR c.caller_number ILIKE " + p + " OR c.called_number ILIKE " + p +
      " OR s.name ILIKE " + p + " OR s.hostname ILIKE " + p +
      " OR l.customer_name ILIKE " + p + " OR l.customer_phone ILIKE " + p +
      " OR l.customer_email ILIKE " + p + ")");
  }
  if (filters.start) clauses.push("COALESCE(c.started_at,c.created_at) >= " + add(filters.start) + "::timestamptz");
  if (filters.end) clauses.push("COALESCE(c.started_at,c.created_at) < " + add(filters.end) + "::timestamptz");
  if (filters.status === "answered") clauses.push("COALESCE(c.duration_seconds,0)>0");
  else if (filters.status === "missed") clauses.push("COALESCE(c.duration_seconds,0)=0");
  else if (filters.status) clauses.push("c.status=" + add(filters.status));
  if (filters.leadType?.trim()) clauses.push("COALESCE(ci.lead_type,ci.intent,l.service_type,'') ILIKE " + add("%" + filters.leadType.trim() + "%"));
  if (filters.provider) clauses.push("c.provider=" + add(filters.provider));

  const limit = Math.min(Math.max(boundedListValue(filters.limit, 50, 100), 1), 100);
  const offset = boundedListValue(filters.offset, 0, 100000000);
  const limitParam = add(limit);
  const offsetParam = add(offset);
  const sql = "SELECT c.id,c.provider,c.provider_call_id,c.caller_number,c.called_number,c.direction," +
    "c.started_at,c.ended_at,c.duration_seconds,c.status,c.recording_status,c.transcript_status," +
    "c.lead_id,c.attribution_confidence,c.attribution_method,c.created_at,s.id AS site_id," +
    "s.name AS site_name,s.hostname,l.customer_name,l.company_name,l.customer_phone,l.customer_email," +
    "l.service_type,l.status AS lead_status,ci.summary,ci.intent,ci.urgency,ci.outcome,ci.lead_type," +
    "COUNT(*) OVER()::int AS total_count FROM calls c JOIN sites s ON s.id=c.site_id " +
    "LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN call_intelligence ci ON ci.call_id=c.id " +
    "WHERE " + clauses.join(" AND ") +
    " ORDER BY COALESCE(c.started_at,c.created_at) DESC LIMIT " + limitParam + " OFFSET " + offsetParam;
  return { sql, params, limit, offset };
}

export function buildDashboardRecordingsListQuery(filters: DashboardListFilters = {}): BuiltDashboardListQuery {
  const params: unknown[] = [];
  const clauses: string[] = ["c.recording_storage_key IS NOT NULL", "c.recording_status='stored'"];
  const add = (value: unknown) => { params.push(value); return "$" + params.length; };

  if (filters.siteId) clauses.push("c.site_id=" + add(filters.siteId));
  if (filters.q?.trim()) {
    const p = add("%" + filters.q.trim() + "%");
    clauses.push("(c.id::text ILIKE " + p + " OR l.id::text ILIKE " + p + " OR c.caller_number ILIKE " + p +
      " OR c.called_number ILIKE " + p + " OR s.name ILIKE " + p + " OR s.hostname ILIKE " + p +
      " OR l.customer_name ILIKE " + p + " OR l.customer_phone ILIKE " + p +
      " OR EXISTS(SELECT 1 FROM call_transcripts tx WHERE tx.call_id=c.id AND tx.full_text ILIKE " + p + ")" +
      " OR ci.summary ILIKE " + p + ")");
  }
  if (filters.start) clauses.push("COALESCE(c.started_at,c.created_at) >= " + add(filters.start) + "::timestamptz");
  if (filters.end) clauses.push("COALESCE(c.started_at,c.created_at) < " + add(filters.end) + "::timestamptz");
  if (filters.leadType?.trim()) clauses.push("COALESCE(ci.lead_type,ci.intent,l.service_type,'') ILIKE " + add("%" + filters.leadType.trim() + "%"));

  const limit = Math.min(Math.max(boundedListValue(filters.limit, 50, 100), 1), 100);
  const offset = boundedListValue(filters.offset, 0, 100000000);
  const limitParam = add(limit);
  const offsetParam = add(offset);
  const sql = "SELECT c.id,c.caller_number,c.called_number,c.direction,c.started_at,c.created_at," +
    "c.duration_seconds,c.recording_status,c.transcript_status,c.lead_id,s.id AS site_id," +
    "s.name AS site_name,s.hostname,l.customer_name,l.customer_phone,ci.summary,ci.outcome,ci.lead_type," +
    "COUNT(*) OVER()::int AS total_count FROM calls c JOIN sites s ON s.id=c.site_id " +
    "LEFT JOIN leads l ON l.id=c.lead_id LEFT JOIN call_intelligence ci ON ci.call_id=c.id WHERE " + clauses.join(" AND ") +
    " ORDER BY COALESCE(c.started_at,c.created_at) DESC LIMIT " + limitParam + " OFFSET " + offsetParam;
  return { sql, params, limit, offset };
}

export function buildDashboardSiteDetailQuery(): string {
  return "SELECT s.id,s.name,s.hostname,s.status,s.created_at," +
    "(SELECT COUNT(*)::int FROM visitors v WHERE v.site_id=s.id AND v.last_seen_at>=NOW()-INTERVAL '30 days') AS visitors_30d," +
    "(SELECT COUNT(*)::int FROM sessions se WHERE se.site_id=s.id AND se.last_seen_at>=NOW()-INTERVAL '30 days') AS sessions_30d," +
    "(SELECT COUNT(*)::int FROM events e WHERE e.site_id=s.id AND e.occurred_at>=NOW()-INTERVAL '30 days' AND e.event_name='page_view') AS page_views_30d," +
    "(SELECT COUNT(*)::int FROM events e WHERE e.site_id=s.id AND e.occurred_at>=NOW()-INTERVAL '30 days' AND e.event_name='phone_click') AS phone_clicks_30d," +
    "(SELECT COUNT(*)::int FROM events e WHERE e.site_id=s.id AND e.occurred_at>=NOW()-INTERVAL '30 days' AND e.event_name IN ('form_submit','lead_submit')) AS form_submissions_30d," +
    "(SELECT COUNT(*)::int FROM calls c WHERE c.site_id=s.id AND c.created_at>=NOW()-INTERVAL '30 days') AS calls_30d," +
    "(SELECT COUNT(*)::int FROM leads l WHERE l.site_id=s.id AND l.created_at>=NOW()-INTERVAL '30 days') AS leads_30d " +
    "FROM sites s WHERE s.id=$1 LIMIT 1";
}

export function buildDashboardJobsByTypeQuery(): string {
  return `
    SELECT job_type,status,COUNT(*)::int AS count
    FROM jobs
    GROUP BY job_type,status
    ORDER BY job_type,status
  `;
}

export function buildDashboardDeadLetterSummaryQuery(): string {
  return `
    SELECT
      job_type,
      CASE
        WHEN last_error IS NULL OR BTRIM(last_error)='' THEN 'no_error'
        WHEN last_error ILIKE '%utm_source%does not exist%' OR last_error ILIKE '%utm_campaign%does not exist%' THEN 'collector_event_utm_schema_mismatch'
        WHEN last_error LIKE 'analog_os_sync_failed:%' THEN 'analog_os_sync_failed'
        WHEN last_error LIKE 'analog_os_sync_rejected:%' THEN 'analog_os_sync_rejected'
        WHEN last_error LIKE 'notification_webhook_%' THEN 'notification_webhook_failed'
        WHEN last_error LIKE '%recording_source_url_missing%' THEN 'recording_source_url_missing'
        WHEN last_error LIKE '%call_not_found%' THEN 'call_not_found'
        WHEN last_error LIKE '%event_not_found%' THEN 'event_not_found'
        WHEN last_error LIKE '%invalid_signature%' THEN 'invalid_signature'
        ELSE 'other'
      END AS error_category,
      COUNT(*)::int AS count,
      MIN(updated_at) AS oldest_updated_at,
      MAX(updated_at) AS latest_updated_at
    FROM jobs
    WHERE status='dead_letter'
    GROUP BY job_type,error_category
    ORDER BY count DESC,job_type
  `;
}

export function buildLeadFlowQuery(): string {
  return `
    WITH v AS (
      SELECT site_id, COUNT(*)::int AS visitors
      FROM visitors
      WHERE last_seen_at >= NOW() - INTERVAL '7 days'
      GROUP BY site_id
    ),
    se AS (
      SELECT site_id, COUNT(*)::int AS sessions
      FROM sessions
      WHERE last_seen_at >= NOW() - INTERVAL '7 days'
      GROUP BY site_id
    ),
    ev AS (
      SELECT site_id,
             COUNT(*) FILTER (WHERE event_name='page_view')::int AS page_views,
             COUNT(*) FILTER (WHERE event_name='phone_click')::int AS phone_clicks,
             COUNT(*) FILTER (WHERE event_name IN ('form_submit','lead_submit'))::int AS lead_events
      FROM events
      WHERE occurred_at >= NOW() - INTERVAL '7 days'
      GROUP BY site_id
    ),
    na AS (
      SELECT tn.site_id, COUNT(*)::int AS number_assignments
      FROM number_assignments a
      JOIN tracking_numbers tn ON tn.id=a.tracking_number_id
      WHERE a.assigned_at >= NOW() - INTERVAL '7 days'
      GROUP BY tn.site_id
    ),
    l AS (
      SELECT site_id, COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE source='analog_os_recovery')::int AS recovered_leads
      FROM leads
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY site_id
    ),
    c AS (
      SELECT site_id, COUNT(*)::int AS calls
      FROM calls
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY site_id
    )
    SELECT s.id,s.name,s.hostname,s.status,
           COALESCE(v.visitors,0)::int AS visitors,
           COALESCE(se.sessions,0)::int AS sessions,
           COALESCE(ev.page_views,0)::int AS page_views,
           COALESCE(ev.phone_clicks,0)::int AS phone_clicks,
           COALESCE(na.number_assignments,0)::int AS number_assignments,
           COALESCE(ev.lead_events,0)::int AS lead_events,
           COALESCE(l.leads,0)::int AS leads,
           COALESCE(l.recovered_leads,0)::int AS recovered_leads,
           COALESCE(c.calls,0)::int AS calls
    FROM sites s
    LEFT JOIN v ON v.site_id=s.id
    LEFT JOIN se ON se.site_id=s.id
    LEFT JOIN ev ON ev.site_id=s.id
    LEFT JOIN na ON na.site_id=s.id
    LEFT JOIN l ON l.site_id=s.id
    LEFT JOIN c ON c.site_id=s.id
    ORDER BY s.name
  `;
}

export async function registerDashboardRoutes(app: FastifyInstance) {
  const auth0Enabled = Boolean(
    config.AUTH0_DOMAIN &&
    config.AUTH0_CLIENT_ID &&
    config.AUTH0_CLIENT_SECRET &&
    config.AUTH0_SESSION_SECRET
  );

  if (auth0Enabled) {
    const redirectToAuth0 = async (
      request: FastifyRequest,
      reply: FastifyReply,
      authorizationParams: Record<string, string>
    ) => {
      if (!app.auth0Client) return reply.code(503).send({ error: "auth0_not_ready" });
      const redirectUri = new URL("/auth/callback", config.AUTH0_APP_BASE_URL).toString();
      const authorizationUrl = await app.auth0Client.startInteractiveLogin(
        {
          authorizationParams: { redirect_uri: redirectUri, ...authorizationParams },
          appState: { returnTo: "/dashboard" }
        },
        { request, reply }
      );
      return reply.redirect(authorizationUrl.href);
    };

    app.get("/auth/google", async (request, reply) =>
      redirectToAuth0(request, reply, { connection: "google-oauth2" })
    );
    app.get("/auth/signup", async (request, reply) =>
      redirectToAuth0(request, reply, { screen_hint: "signup" })
    );
  }

  app.get("/v1/dashboard/auth/status", async (request, reply) => {
    const identity = await dashboardIdentity(app, request, reply);
    if (!identity) {
      return reply.send({
        auth0Enabled,
        authenticated: false,
        legacyLoginAvailable: Boolean(config.ANALOG_DASHBOARD_PASSWORD)
      });
    }
    if (identity.kind === "denied") {
      return reply.send({
        auth0Enabled,
        authenticated: true,
        accessGranted: false,
        email: identity.email,
        error: identity.reason,
        message: getDashboardAccessMessage(identity.email, identity.reason)
      });
    }
    return reply.send({
      auth0Enabled,
      authenticated: true,
      accessGranted: true,
      provider: identity.kind,
      user: identity.kind === "auth0"
        ? { email: identity.email, name: identity.name ?? null, picture: identity.picture ?? null }
        : { username: identity.username }
    });
  });

  app.get("/dashboard", async (_request, reply) => {
    const html = await readFile(join(UI_ROOT, "dashboard.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/dashboard/manifest.json", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "manifest.json"), "utf8");
    return reply.type("application/manifest+json").send(body);
  });

  app.get("/suppliers.js", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "suppliers.js"), "utf8");
    return reply.type("application/javascript; charset=utf-8").send(body);
  });

  app.get("/numbers.js", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "numbers.js"), "utf8");
    return reply.type("application/javascript; charset=utf-8").send(body);
  });

  app.get("/onboarding.js", async (_request, reply) => {
    const body = await readFile(join(UI_ROOT, "onboarding.js"), "utf8");
    return reply.type("application/javascript; charset=utf-8").send(body);
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
    const identity = await dashboardIdentity(app, request, reply);
    if (!identity) return reply.code(401).send({ error: "dashboard_auth_required" });
    if (identity.kind !== "legacy") return reply.code(400).send({ error: "use_auth0_logout" });
    reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`);
    return reply.send({ ok: true });
  });

  app.get<{ Querystring: { siteId?: string } }>("/v1/dashboard/summary", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
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

  app.get<{ Querystring: DashboardListFilters }>("/v1/dashboard/calls", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    if (!isValidDashboardDateRange(request.query.start, request.query.end)) {
      return reply.code(400).send({ error: "invalid_date_filter" });
    }
    const built = buildDashboardCallsListQuery(request.query);
    const result = await db.query(built.sql, built.params);
    const total = Number(result.rows[0]?.total_count ?? (built.offset + result.rows.length));
    const calls = result.rows.map(({ total_count: _totalCount, ...call }: Record<string, unknown>) => call);
    return reply.send({ calls, limit: built.limit, offset: built.offset, total, hasMore: built.offset + calls.length < total });
  });



  app.get<{ Querystring: DashboardListFilters }>("/v1/dashboard/recordings", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    if (!isValidDashboardDateRange(request.query.start, request.query.end)) {
      return reply.code(400).send({ error: "invalid_date_filter" });
    }
    const built = buildDashboardRecordingsListQuery(request.query);
    const result = await db.query(built.sql, built.params);
    const total = Number(result.rows[0]?.total_count ?? (built.offset + result.rows.length));
    const recordings = result.rows.map(({ total_count: _totalCount, ...recording }: Record<string, unknown>) => recording);
    return reply.send({ recordings, limit: built.limit, offset: built.offset, total, hasMore: built.offset + recordings.length < total });
  });


  app.get<{ Params: { callId: string } }>("/v1/dashboard/calls/:callId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const callResult = await db.query(`
      SELECT c.*,s.name AS site_name,s.hostname
      FROM calls c JOIN sites s ON s.id=c.site_id WHERE c.id=$1 LIMIT 1
    `, [request.params.callId]);
    if (!callResult.rowCount) return reply.code(404).send({ error: "call_not_found" });
    const call = callResult.rows[0];
    const [lead, intelligence, transcript, segments, osContext] = await Promise.all([
      call.lead_id ? db.query("SELECT * FROM leads WHERE id=$1", [call.lead_id]) : Promise.resolve({ rows: [] as any[] }),
      db.query("SELECT * FROM call_intelligence WHERE call_id=$1", [call.id]),
      db.query("SELECT id,provider,model,language,status,full_text,duration_seconds,completed_at FROM call_transcripts WHERE call_id=$1", [call.id]),
      db.query("SELECT segment_index,speaker_label,speaker_role,start_seconds,end_seconds,text FROM transcript_segments WHERE transcript_id=(SELECT id FROM call_transcripts WHERE call_id=$1) ORDER BY segment_index", [call.id]),
      loadAnalogOSContextForCall(call)
    ]);
    const recordingUrl = call.recording_storage_key ? await createRecordingDownloadUrl(call.recording_storage_key) : null;
    return reply.send({
      call,
      lead: lead.rows[0] ?? null,
      intelligence: intelligence.rows[0] ?? null,
      analog_os_context: osContext.rows[0] ?? null,
      transcript: transcript.rows[0] ? { ...transcript.rows[0], segments: segments.rows } : null,
      recording: call.recording_storage_key ? { url: recordingUrl, expires_in_seconds: 900 } : null
    });
  });

  app.get<{ Querystring: { limit?: string; siteId?: string } }>("/v1/dashboard/leads", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const limit = Math.min(Math.max(Number(request.query.limit ?? 25) || 25, 1), 100);
    const params: unknown[] = [];
    let where = "";
    if (request.query.siteId) { params.push(request.query.siteId); where = `WHERE l.site_id=$${params.length}`; }
    params.push(limit);
    const result = await db.query(buildDashboardLeadsQuery(where, params.length), params);
    return reply.send({ leads: result.rows });
  });

  app.get<{ Params: { leadId: string } }>("/v1/dashboard/lead-details/:leadId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const leadId = request.params.leadId;
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return reply.code(404).send({ error: "lead_not_found" });
    const leadResult = await db.query(
      "SELECT l.*,s.name AS site_name,s.hostname,sp.name AS supplier " +
      "FROM leads l JOIN sites s ON s.id=l.site_id LEFT JOIN suppliers sp ON sp.id=l.routed_supplier_id " +
      "WHERE l.id=$1 LIMIT 1",
      [leadId]
    );
    if (!leadResult.rowCount) return reply.code(404).send({ error: "lead_not_found" });
    const [callsResult, messagesResult] = await Promise.all([
      db.query(
        "SELECT c.id,c.site_id,c.provider,c.caller_number,c.called_number,c.direction,c.started_at,c.ended_at," +
        "c.duration_seconds,c.status,c.recording_status,c.transcript_status,c.recording_storage_key," +
        "ci.summary,ci.intent,ci.lead_type,ci.urgency,ci.outcome,tx.full_text AS transcript " +
        "FROM calls c LEFT JOIN call_intelligence ci ON ci.call_id=c.id " +
        "LEFT JOIN call_transcripts tx ON tx.call_id=c.id WHERE c.lead_id=$1 " +
        "ORDER BY COALESCE(c.started_at,c.created_at) DESC LIMIT 100",
        [leadId]
      ),
      db.query(
        "SELECT id,channel,direction,sender,recipient,subject,body,created_at " +
        "FROM lead_messages WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 100",
        [leadId]
      )
    ]);
    const calls = await Promise.all(callsResult.rows.map(async (call: Record<string, unknown>) => {
      const key = typeof call.recording_storage_key === "string" ? call.recording_storage_key : "";
      const recordingUrl = key ? await createRecordingDownloadUrl(key) : null;
      const { recording_storage_key: _storageKey, ...safeCall } = call;
      return { ...safeCall, recording_url: recordingUrl, recording_expires_in_seconds: recordingUrl ? 900 : null };
    }));
    return reply.send({ lead: leadResult.rows[0], calls, messages: messagesResult.rows });
  });

  app.get("/v1/dashboard/sites", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query(buildDashboardSitesQuery());
    return reply.send({ sites: result.rows });
  });

  app.get<{ Params: { siteId: string } }>("/v1/dashboard/sites/:siteId", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const siteId = request.params.siteId;
    if (!/^[0-9a-f-]{36}$/i.test(siteId)) return reply.code(404).send({ error: "site_not_found" });
    const siteResult = await db.query(buildDashboardSiteDetailQuery(), [siteId]);
    if (!siteResult.rowCount) return reply.code(404).send({ error: "site_not_found" });
    const [suppliers, numbers, recentCalls] = await Promise.all([
      db.query(
        "SELECT ss.rank,ss.active,s.id,s.name,s.status,s.contact_phone,s.notification_email " +
        "FROM site_suppliers ss JOIN suppliers s ON s.id=ss.supplier_id WHERE ss.site_id=$1 ORDER BY ss.rank",
        [siteId]
      ),
      db.query(
        "SELECT tn.id,tn.phone_number,tn.label,tn.active,tn.forwarding_number_id,fn.phone_number AS forwarding_number," +
        "dst.name AS destination_supplier FROM tracking_numbers tn " +
        "LEFT JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id " +
        "LEFT JOIN suppliers dst ON dst.id=tn.destination_supplier_id WHERE tn.site_id=$1 ORDER BY tn.phone_number",
        [siteId]
      ),
      db.query(
        "SELECT c.id,c.caller_number,c.started_at,c.created_at,c.duration_seconds,c.status,c.recording_status,ci.summary " +
        "FROM calls c LEFT JOIN call_intelligence ci ON ci.call_id=c.id WHERE c.site_id=$1 " +
        "ORDER BY COALESCE(c.started_at,c.created_at) DESC LIMIT 10",
        [siteId]
      )
    ]);
    return reply.send({
      site: siteResult.rows[0],
      suppliers: suppliers.rows,
      numbers: numbers.rows,
      recent_calls: recentCalls.rows,
      seo: {
        status: "not_connected",
        note: "Google Search Console, GA4 and SEO ranking data are not currently connected to this Attribution website record."
      }
    });
  });

  app.get<{ Querystring: { siteId?: string } }>("/v1/dashboard/numbers", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const params: unknown[] = [];
    if (request.query.siteId) params.push(request.query.siteId);
    const result = await db.query(buildDashboardNumbersQuery(Boolean(request.query.siteId)), params);
    return reply.send({ numbers: result.rows });
  });

  app.get<{ Querystring: { month?: string; refresh?: string } }>("/v1/dashboard/analog-os/monthly", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const requestedMonth = typeof request.query.month === "string" ? request.query.month : getLondonMonthKey();
    let month: string;
    try {
      month = validateReconciliationMonth(requestedMonth);
    } catch {
      return reply.code(400).send({ error: "invalid_reconciliation_month" });
    }
    if (month > getLondonMonthKey()) {
      return reply.code(400).send({ error: "future_month_not_allowed" });
    }

    try {
      const snapshot = await getAnalogOSMonthlySnapshot(month, {
        refresh: request.query.refresh === "1" || request.query.refresh === "true"
      });
      return reply.send(snapshot);
    } catch (error) {
      request.log.warn({ month, reason: error instanceof Error ? error.message : "unknown" }, "Analog OS monthly export unavailable");
      return reply.code(502).send({
        error: "analog_os_month_unavailable",
        month,
        message: "The full month could not be verified. No partial monthly snapshot was saved."
      });
    }
  });

  app.post("/v1/dashboard/analog-os/reconcile", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    return reply.code(410).send({
      error: "analog_os_reconciliation_disabled",
      mode: "read_only",
      message: "Historical Analog OS data is display-only. Lead imports and supplier routing are disabled."
    });
  });
  app.get<{ Querystring: { date?: string } }>("/v1/dashboard/analog-os/reconciliation", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const date = typeof request.query.date === "string" ? request.query.date : "";
    return reply.send(await getAnalogOSReconciliationStatus(date));
  });

  app.get("/v1/dashboard/lead-flow", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const query = request.query as { siteId?: string };
    const params: unknown[] = [];
    let filter = "";
    if (query.siteId) {
      params.push(query.siteId);
      filter = " WHERE s.id=$1";
    }
    const sql = buildLeadFlowQuery().replace(
      "    ORDER BY s.name",
      filter + "\n    ORDER BY s.name"
    );
    const result = await db.query(sql, params);
    return reply.send({
      window_days: 7,
      stages: [
        "visitors","sessions","page_views","number_assignments",
        "phone_clicks","lead_events","leads","calls"
      ],
      sites: result.rows
    });
  });

  app.get("/v1/dashboard/system", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const [jobs, outbox, jobsByType, deadLetterSummary, auditLog] = await Promise.all([
      db.query("SELECT status,COUNT(*)::int AS count FROM jobs GROUP BY status ORDER BY status"),
      db.query("SELECT status,COUNT(*)::int AS count FROM analog_os_outbox GROUP BY status ORDER BY status"),
      db.query(buildDashboardJobsByTypeQuery()),
      db.query(buildDashboardDeadLetterSummaryQuery()),
      db.query("SELECT created_at,actor_type,actor_id,action,entity_type,entity_id FROM audit_log ORDER BY created_at DESC LIMIT 50")
    ]);
    const configured = (yes: boolean) => yes ? "configured" : "not_configured";
    const integrations = [
      { name: "Dashboard authentication", status: configured(Boolean(config.AUTH0_DOMAIN && config.AUTH0_CLIENT_ID && config.AUTH0_CLIENT_SECRET && config.AUTH0_SESSION_SECRET)), detail: "Auth0" },
      { name: "Selected telephony provider", status: "selected", detail: config.TELEPHONY_PROVIDER },
      { name: "Wazo", status: configured(Boolean(config.WAZO_API_URL && config.WAZO_AUTH_TOKEN)), detail: "Voice provider credentials" },
      { name: "SecondRing", status: config.TELEPHONY_PROVIDER === "secondring" ? configured(Boolean(config.TELEPHONY_INTERNAL_SECRET)) : "not_selected", detail: "Selected through the telephony provider setting" },
      { name: "Twilio", status: configured(Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN)), detail: "Voice / transfer credentials" },
      { name: "DIDWW", status: configured(Boolean(config.DIDWW_API_KEY && config.DIDWW_CALLBACK_SECRET)), detail: "Number provisioning / callbacks" },
      { name: "Recording storage (R2)", status: configured(Boolean(config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY)), detail: "Private recording storage" },
      { name: "Transcription", status: configured(config.TRANSCRIPTION_PROVIDER === "deepgram" ? Boolean(config.DEEPGRAM_API_KEY) : Boolean(config.OPENAI_API_KEY)), detail: config.TRANSCRIPTION_PROVIDER },
      { name: "Analog OS read-only history", status: configured(Boolean((config.ANALOG_OS_PULL_URL || config.ANALOG_OS_WEBHOOK_URL) && config.ANALOG_OS_WEBHOOK_SECRET)), detail: "Signed historical source; view-only" },
      { name: "MainWP / PressPilot bridge", status: configured(Boolean(config.PRESSPILOT_MCP_TOKEN && config.PRESSPILOT_MAINWP_SECRET)), detail: "Fleet control bridge" },
      { name: "WhatConverts connector", status: config.ENABLE_WHATCONVERTS ? "enabled" : "disabled", detail: "Legacy connector flag" }
    ];
    return reply.send({
      jobs: jobs.rows,
      analog_os_outbox: outbox.rows,
      jobs_by_type: jobsByType.rows,
      dead_letter_summary: deadLetterSummary.rows,
      integrations,
      audit_log: auditLog.rows
    });
  });
}
