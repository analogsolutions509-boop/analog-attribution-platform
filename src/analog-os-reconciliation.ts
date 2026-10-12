import { createHmac, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";

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
  client_email: string;
  forwarded: string;
  forwarded_at: string;
  client_response: string;
  quote_value: string;
  sale_value: string;
  commission_rate: string;
  commission_due: string;
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
    client_email: normalizeEmail(String(raw.client_email || "")),
    forwarded: String(raw.forwarded || "").trim(),
    forwarded_at: String(raw.forwarded_at || "").trim(),
    client_response: String(raw.client_response || "").trim(),
    quote_value: String(raw.quote_value || "").trim(),
    sale_value: String(raw.sale_value || "").trim(),
    commission_rate: String(raw.commission_rate || "").trim(),
    commission_due: String(raw.commission_due || "").trim(),
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

/**
 * Fetch a signed, date-scoped export from Analog OS. This request only reads the
 * source export; it does not update Google Sheets or the Attribution database.
 */
async function fetchOSLeadsReadOnly(dateInput: string): Promise<AnalogOSLeadExport> {
  const date = validateReconciliationDate(dateInput);
  const secret = getPullSecret();
  const requestPayload = { date, request_id: randomUUID() };
  const signature = signAnalogOSRequest(JSON.stringify(requestPayload), secret);
  const response = await fetch(getPullUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ request: requestPayload, signature }),
    signal: AbortSignal.timeout(5000)
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
  if (!verifyAnalogOSExport(
    signedPayload as Omit<AnalogOSLeadExport, "signature">,
    String(raw.signature || ""),
    secret
  )) {
    throw new Error("analog_os_pull_invalid_signature");
  }
  return {
    ...signedPayload,
    leads: signedPayload.leads.map((lead) => normalizeOSLead(lead as unknown as Record<string, unknown>)),
    signature: String(raw.signature)
  };
}

export type ReadOnlyAnalogOSContextInput = {
  date: string;
  leads: AnalogOSLead[];
  siteHostname: string;
  callerNumber: string;
  calledNumber: string;
  generatedAt: string;
};

export function selectReadOnlyAnalogOSContext(input: ReadOnlyAnalogOSContextInput) {
  const date = validateReconciliationDate(input.date);
  const hostname = canonicalHostname(input.siteHostname);
  const callerDigits = normalizePhoneDigits(input.callerNumber);
  const calledDigits = normalizePhoneDigits(input.calledNumber);
  if (!hostname || callerDigits.length < 7) return null;

  const matches = input.leads.filter((lead) => {
    if (normalizePhoneDigits(lead.customer_phone) !== callerDigits) return false;
    const websiteMatches = canonicalHostname(lead.website) === hostname;
    const metadata = lead.metadata || {};
    const trackingDigits = normalizePhoneDigits(String(
      metadata.tracking_number ?? metadata.trackingNumber ?? metadata.call_tracking_number ?? ""
    ));
    const routeMatches = Boolean(calledDigits) && trackingDigits === calledDigits;
    return websiteMatches || routeMatches;
  });

  if (matches.length !== 1) return null;
  const lead = matches[0];
  if (!lead) return null;
  const websiteMatches = canonicalHostname(lead.website) === hostname;
  return {
    reconciliation_date: date,
    source: lead.source,
    source_record: lead.source_record,
    os_lead_id: lead.os_lead_id,
    status: "historical_read_only",
    match_method: websiteMatches ? "exact caller + website" : "exact caller + tracking number",
    payload: lead,
    updated_at: input.generatedAt
  };
}

export async function getReadOnlyAnalogOSContext(input: {
  date: string;
  siteHostname: string;
  callerNumber: string;
  calledNumber: string;
}) {
  const exported = await fetchOSLeadsReadOnly(input.date);
  return selectReadOnlyAnalogOSContext({
    ...input,
    leads: exported.leads,
    generatedAt: exported.generated_at
  });
}

/**
 * Historical OS reconciliation has been retired. This entry point intentionally
 * performs no HTTP fetch, database mutation, lead creation, or supplier routing.
 * Call-detail history is retrieved separately through the signed read-only export.
 */
export async function reconcileAnalogOSDate(dateInput: string) {
  const date = validateReconciliationDate(dateInput);
  return {
    date,
    status: "disabled_read_only",
    osLeads: 0,
    matched: 0,
    imported: 0,
    duplicates: 0,
    unresolved: 0,
    errors: 0
  };
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

export async function ensureDailyAnalogOSReconciliationJob(
  _createJobFn: (
    jobType: string, aggregateType: string, aggregateId: string
  ) => Promise<unknown>
): Promise<null> {
  // Intentionally do not queue legacy recovery/import jobs in read-only mode.
  return null;
}
export function buildRecoveryFingerprint(date: string, lead: AnalogOSLead, siteHostname: string): string {
  return [
    date, canonicalHostname(siteHostname), normalizeEmail(lead.customer_email),
    normalizePhoneDigits(lead.customer_phone), lead.source
  ].join("|");
}
