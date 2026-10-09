export type CollectorEventLead = {
  customerName?: string;
  companyName?: string;
  customerPhone?: string;
  customerEmail?: string;
  serviceType?: string;
  requirements: Record<string, unknown>;
  summary?: string;
};

function optionalText(value: unknown, maxLength = 1000): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, maxLength);
  return result || undefined;
}

export function normalizeCollectorEventLead(
  payload: Record<string, unknown>
): CollectorEventLead | null {
  const customerPhone = optionalText(payload.customer_phone ?? payload.phone, 100);
  const customerEmail = optionalText(payload.customer_email ?? payload.email, 320)?.toLowerCase();
  if (!customerPhone && !customerEmail) return null;

  const rawRequirements = payload.requirements;
  const requirements = rawRequirements && typeof rawRequirements === "object" && !Array.isArray(rawRequirements)
    ? rawRequirements as Record<string, unknown>
    : {};

  const customerName = optionalText(payload.customer_name ?? payload.name, 200);
  const companyName = optionalText(payload.company_name, 200);
  const serviceType = optionalText(payload.service_type, 200);
  const summary = optionalText(payload.message ?? payload.summary, 4000);

  return {
    ...(customerName ? { customerName } : {}),
    ...(companyName ? { companyName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(serviceType ? { serviceType } : {}),
    requirements,
    ...(summary ? { summary } : {})
  };
}
