import { createHmac, randomUUID } from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";
import { routeLead } from "./routing.js";

const LONDON_TZ = "Europe/London";

export type AnalogOSLead = {
  source: string;
  source_record: string;
  os_lead_id: string;
  occurred_at: string;
  website: string;
  service: string;
  location: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  subject: string;
  enquiry: string;
  classification: string;
  confidence: string;
  assigned_client: string;
  forwarded: string;
  quote_value: string;
  sale_value: string;
  commission_rate: string;
  status: string;
  original_message_id: string;
  notes: string;
  metadata: Record<string, unknown>;
};

export type AnalogOSLeadExport = {
  ok: boolean;
  date: string;
  generated_at: string;
  leads: AnalogOSLead[];
  counts: { total: number; whatconverts: number; email: number };
  signature: string;
};

export function validateReconciliationDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_reconciliation_date");
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("invalid_reconciliation_date");
  }
  return value;
}

export function canonicalHostname(value: string): string {
  return String(value || "").trim()
    .replace(/^https?:\/\//i, "").split("/")[0].split(":")[0]
    .toLowerCase().replace(/^www\./, "");
}

export function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhoneDigits(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function buildAnalogOSPullUrl(baseUrl: string): string {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return baseUrl + separator + "route=analog-attribution-reconcile";
}

export function signAnalogOSRequest(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyAnalogOSExport(
  payload: Omit<AnalogOSLeadExport, "signature">,
  signature: string,
  secret: string
): boolean {
  return signAnalogOSRequest(JSON.stringify(payload), secret) === String(signature || "").trim();
}

export function getLondonDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

export function getPreviousLondonDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return getLondonDateKey(new Date(Date.UTC(year, month - 1, day, 12) - 86400000));
}

export function shouldQueueDailyReconciliation(value = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ, hour: "2-digit", hour12: false
  }).format(value));
  return hour >= 2;
}

export function normalizeOSLead(raw: Record<string, unknown>): AnalogOSLead {
  const source = String(raw.source || "unknown");
  const osLeadId = String(raw.os_lead_id || raw.lead_id || "").trim();
  return {
    source,
    source_record: String(raw.source_record || (source + ":" + osLeadId)).trim(),
    os_lead_id: osLeadId,
    occurred_at: String(raw.occurred_at || raw.created_at || new Date().toISOString()),
    website: canonicalHostname(String(raw.website || raw.website_url || raw.hostname || "")),
    service: String(raw.service || raw.service_type || "").trim(),
    location: String(raw.location || "").trim(),
    customer_name: String(raw.customer_name || "").trim(),
    customer_email: normalizeEmail(String(raw.customer_email || "")),
    customer_phone: String(raw.customer_phone || "").trim(),
    subject: String(raw.subject || "").trim(),
    enquiry: String(raw.enquiry || raw.summary || "").trim(),
    classification: String(raw.classification || "").trim(),
    confidence: String(raw.confidence || "").trim(),
    assigned_client: String(raw.assigned_client || "").trim(),
    forwarded: String(raw.forwarded || "").trim(),
    quote_value: String(raw.quote_value || "").trim(),
    sale_value: String(raw.sale_value || "").trim(),
    commission_rate: String(raw.commission_rate || "").trim(),
    status: String(raw.status || "new").trim(),
    original_message_id: String(raw.original_message_id || "").trim(),
    notes: String(raw.notes || "").trim(),
    metadata: raw.metadata && typeof raw.metadata === "object"
      ? raw.metadata as Record<string, unknown> : {}
  };
}
function getPullSecret(): string {
  const secret = config.ANALOG_OS_WEBHOOK_SECRET;
  if (!secret) throw new Error("analog_os_pull_secret_missing");
  return secret;
}

function getPullUrl(): string {
  const base = config.ANALOG_OS_PULL_URL || config.ANALOG_OS_WEBHOOK_URL;
  if (!base) throw new Error("analog_os_pull_url_missing");
  return buildAnalogOSPullUrl(base);
}

async function fetchOSLeads(date: string): Promise<AnalogOSLeadExport> {
  const secret = getPullSecret();
  const requestPayload = { date, request_id: randomUUID() };
  const canonicalBody = JSON.stringify(requestPayload);
  const signature = signAnalogOSRequest(canonicalBody, secret);
  const response = await fetch(getPullUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({ request: requestPayload, signature })
  });
  if (!response.ok) throw new Error("analog_os_pull_failed:" + response.status);
  const raw = await response.json() as Partial<AnalogOSLeadExport>;
  const signedPayload = {
    ok: Boolean(raw.ok),
    date: validateReconciliationDate(String(raw.date || "")),
    generated_at: String(raw.generated_at || ""),
    leads: Array.isArray(raw.leads) ? raw.leads : [],
    counts: raw.counts || { total: 0, whatconverts: 0, email: 0 }
  };
  if (!signedPayload.ok || signedPayload.date !== date || !signedPayload.generated_at) {
    throw new Error("analog_os_pull_invalid_response");
  }
  if (!verifyAnalogOSExport(signedPayload as Omit<AnalogOSLeadExport, "signature">, String(raw.signature || ""), secret)) {
    throw new Error("analog_os_pull_invalid_signature");
  }

  const payload = {
    ...signedPayload,
    leads: signedPayload.leads.map((lead) => normalizeOSLead(lead as Record<string, unknown>))
  };
  return { ...payload, signature: String(raw.signature) };
}

async function findPlatformSite(hostname: string) {
  const host = canonicalHostname(hostname);
  if (!host) return null;
  const result = await db.query(
    "SELECT id,hostname,name FROM sites WHERE REPLACE(LOWER(hostname),'www.','')=$1 AND status='active' LIMIT 1",
    [host]
  );
  return result.rows[0] ?? null;
}
async function findExistingLead(
  siteId: string,
  date: string,
  lead: AnalogOSLead
): Promise<{ id: string; method: string } | null> {
  if (lead.source_record) {
    const bySource = await db.query(
      "SELECT id FROM leads WHERE source_detail->>'analog_os_source_record'=$1 ORDER BY created_at DESC LIMIT 1",
      [lead.source_record]
    );
    if (bySource.rowCount) return { id: bySource.rows[0].id, method: "source_record" };
  }

  const email = normalizeEmail(lead.customer_email);
  const phone = normalizePhoneDigits(lead.customer_phone);
  if (!email && !phone) return null;

  const sql =
    "SELECT id FROM leads " +
    "WHERE site_id=$1 " +
    "AND created_at >= ($2::date AT TIME ZONE 'Europe/London') " +
    "AND created_at < (($2::date + INTERVAL '1 day') AT TIME ZONE 'Europe/London') " +
    "AND (($3 <> '' AND LOWER(COALESCE(customer_email,''))=$3) " +
    "OR ($4 <> '' AND REGEXP_REPLACE(COALESCE(customer_phone,''),'\\D','','g')=$4)) " +
    "ORDER BY created_at ASC LIMIT 1";
  const result = await db.query(sql, [siteId, date, email, phone]);
  return result.rowCount
    ? { id: result.rows[0].id, method: "same_day_email_or_phone" } : null;
}

function recoverySourceDetail(lead: AnalogOSLead, date: string) {
  return {
    analog_os_recovered: true,
    analog_os_reconciliation_date: date,
    analog_os_source: lead.source,
    analog_os_source_record: lead.source_record,
    analog_os_lead_id: lead.os_lead_id,
    analog_os_original_message_id: lead.original_message_id || null,
    analog_os_assigned_client: lead.assigned_client || null,
    analog_os_forwarded: lead.forwarded || null,
    analog_os_metadata: lead.metadata,
    recovery_reason: "lead_present_in_analog_os_missing_from_attribution_platform"
  };
}

async function saveRecoveryRecord(input: {
  date: string; lead: AnalogOSLead; status: string;
  matchMethod?: string; platformLeadId?: string; error?: string;
}) {
  await db.query(
    "INSERT INTO analog_os_recovery_records " +
    "(reconciliation_date,source,source_record,os_lead_id,status,match_method,platform_lead_id,payload,last_error) " +
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) " +
    "ON CONFLICT(reconciliation_date,source,source_record) DO UPDATE SET " +
    "os_lead_id=EXCLUDED.os_lead_id,status=EXCLUDED.status,match_method=EXCLUDED.match_method," +
    "platform_lead_id=EXCLUDED.platform_lead_id,payload=EXCLUDED.payload,last_error=EXCLUDED.last_error,updated_at=NOW()",
    [
      input.date,input.lead.source,input.lead.source_record,input.lead.os_lead_id,input.status,
      input.matchMethod || null,input.platformLeadId || null,input.lead,input.error || null
    ]
  );
}
async function importRecoveredLead(date: string, lead: AnalogOSLead, siteId: string): Promise<string> {
  const createdAt = new Date(lead.occurred_at);
  if (Number.isNaN(createdAt.getTime())) throw new Error("analog_os_lead_invalid_timestamp");

  const result = await db.query(
    "INSERT INTO leads " +
    "(site_id,source,customer_name,company_name,customer_phone,customer_email,service_type," +
    "requirements,summary,source_detail,tags,created_at,updated_at) " +
    "VALUES($1,'analog_os_recovery',$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11,$11) RETURNING id",
    [
      siteId,
      lead.customer_name || null,
      String(lead.metadata.company_name || "") || null,
      lead.customer_phone || null,
      lead.customer_email || null,
      lead.service || null,
      JSON.stringify(lead.metadata.requirements || {}),
      lead.enquiry || null,
      JSON.stringify(recoverySourceDetail(lead, date)),
      JSON.stringify(["recovered_from_analog_os"]),
      createdAt.toISOString()
    ]
  );
  const leadId = result.rows[0].id as string;
  await routeLead(leadId, siteId, lead.service || undefined, lead.location || undefined);
  return leadId;
}

async function beginRun(date: string) {
  await db.query(
    "INSERT INTO analog_os_reconciliation_runs " +
    "(reconciliation_date,status,requested_at,started_at,completed_at,os_leads,matched,imported,duplicates,unresolved,errors,last_error) " +
    "VALUES($1,'running',NOW(),NOW(),NULL,0,0,0,0,0,0,NULL) " +
    "ON CONFLICT(reconciliation_date) DO UPDATE SET " +
    "status='running',requested_at=NOW(),started_at=NOW(),completed_at=NULL," +
    "os_leads=0,matched=0,imported=0,duplicates=0,unresolved=0,errors=0,last_error=NULL,updated_at=NOW()",
    [date]
  );
}

async function finishRun(date: string, counts: {
  osLeads: number; matched: number; imported: number; duplicates: number;
  unresolved: number; errors: number; lastError?: string | null;
}) {
  await db.query(
    "UPDATE analog_os_reconciliation_runs SET status='completed',completed_at=NOW(),os_leads=$2," +
    "matched=$3,imported=$4,duplicates=$5,unresolved=$6,errors=$7,last_error=$8,updated_at=NOW() " +
    "WHERE reconciliation_date=$1",
    [date,counts.osLeads,counts.matched,counts.imported,counts.duplicates,counts.unresolved,counts.errors,counts.lastError || null]
  );
}

async function failRun(date: string, error: string) {
  await db.query(
    "UPDATE analog_os_reconciliation_runs SET status='failed',completed_at=NOW(),last_error=$2,updated_at=NOW() WHERE reconciliation_date=$1",
    [date,error]
  );
}
export async function reconcileAnalogOSDate(dateInput: string) {
  const date = validateReconciliationDate(dateInput);
  await beginRun(date);
  const counts = { osLeads: 0, matched: 0, imported: 0, duplicates: 0, unresolved: 0, errors: 0 };
  try {
    const exported = await fetchOSLeads(date);
    counts.osLeads = exported.leads.length;

    for (const lead of exported.leads) {
      try {
        const existingRecovery = await db.query(
          "SELECT id,status,platform_lead_id FROM analog_os_recovery_records " +
          "WHERE reconciliation_date=$1 AND source=$2 AND source_record=$3 LIMIT 1",
          [date,lead.source,lead.source_record]
        );
        if (existingRecovery.rowCount && existingRecovery.rows[0].platform_lead_id) {
          counts.duplicates++;
          continue;
        }

        const site = await findPlatformSite(lead.website);
        if (!site) {
          counts.unresolved++;
          await saveRecoveryRecord({date,lead,status:"unresolved",error:"site_not_registered_in_platform"});
          continue;
        }

        const existing = await findExistingLead(site.id, date, lead);
        if (existing) {
          counts.matched++;
          await saveRecoveryRecord({
            date,lead,status:"matched_existing",matchMethod:existing.method,platformLeadId:existing.id
          });
          continue;
        }

        const leadId = await importRecoveredLead(date, lead, site.id);
        counts.imported++;
        await saveRecoveryRecord({
          date,lead,status:"imported",matchMethod:"recovered",platformLeadId:leadId
        });
      } catch (error) {
        counts.errors++;
        await saveRecoveryRecord({
          date,lead,status:"error",
          error:error instanceof Error ? error.message : String(error)
        }).catch(() => undefined);
      }
    }

    await finishRun(date, counts);
    return { date, status: "completed", ...counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(date, message);
    throw error;
  }
}

export async function getAnalogOSReconciliationStatus(dateInput: string) {
  const date = validateReconciliationDate(dateInput);
  const result = await db.query(
    "SELECT reconciliation_date,status,requested_at,started_at,completed_at,os_leads,matched,imported," +
    "duplicates,unresolved,errors,last_error,updated_at FROM analog_os_reconciliation_runs WHERE reconciliation_date=$1",
    [date]
  );
  if (!result.rowCount) return { date, status: "not_run" };
  return result.rows[0];
}

export async function ensureDailyAnalogOSReconciliationJob(createJobFn: (
  jobType: string, aggregateType: string, aggregateId: string
) => Promise<unknown>) {
  const now = new Date();
  if (!shouldQueueDailyReconciliation(now)) return null;
  const date = getPreviousLondonDateKey(now);
  const dedupeKey = "analog.os.reconcile:" + date;
  const existing = await db.query("SELECT id,status FROM jobs WHERE dedupe_key=$1 LIMIT 1", [dedupeKey]);
  if (existing.rowCount) return existing.rows[0].id as string;
  return createJobFn("analog.os.reconcile", "date", date);
}

export function buildRecoveryFingerprint(date: string, lead: AnalogOSLead, siteHostname: string): string {
  return [
    date, canonicalHostname(siteHostname), normalizeEmail(lead.customer_email),
    normalizePhoneDigits(lead.customer_phone), lead.source
  ].join("|");
}
