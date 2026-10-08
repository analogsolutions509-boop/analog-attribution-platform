export type LeadEventSite = {
  name?: string | null;
  hostname?: string | null;
};

export type LeadEventInput = {
  siteId: string;
  source?: string;
  customerName?: string;
  companyName?: string;
  customerPhone?: string;
  customerEmail?: string;
  serviceType?: string;
  requirements?: Record<string, unknown>;
  summary?: string;
};

function canonicalHostname(value: unknown): string | null {
  const hostname = String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase()
    .replace(/^www\./, "");
  return hostname || null;
}

export function buildLeadOSEvent(
  input: LeadEventInput,
  leadId: string,
  supplierId: string | null,
  site: LeadEventSite = {}
) {
  return {
    lead_id: leadId,
    site_id: input.siteId,
    site_name: site.name ?? null,
    hostname: canonicalHostname(site.hostname),
    supplier_id: supplierId,
    source: input.source ?? "unknown",
    customer_name: input.customerName ?? null,
    company_name: input.companyName ?? null,
    customer_phone: input.customerPhone ?? null,
    customer_email: input.customerEmail ?? null,
    service_type: input.serviceType ?? null,
    requirements: input.requirements ?? {},
    summary: input.summary ?? null
  };
}
