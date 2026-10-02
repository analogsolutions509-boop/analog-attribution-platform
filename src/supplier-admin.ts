export type SupplierInput = {
  name: string;
  contact_phone?: string | null;
  notification_email?: string | null;
  notification_sms?: string | null;
  endpoint_url?: string | null;
  status?: "active" | "paused";
};

export function normalizeSupplierInput(input: Record<string, unknown>): SupplierInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("name_required");
  if (name.length > 160) throw new Error("name_too_long");

  const optionalText = (key: string, max = 160) => {
    const value = input[key];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new Error(`${key}_must_be_text`);
    const trimmed = value.trim();
    if (trimmed.length > max) throw new Error(`${key}_too_long`);
    return trimmed || null;
  };

  const status = input.status === "paused" ? "paused" : "active";
  const endpoint = optionalText("endpoint_url", 500);
  if (endpoint && !/^https?:\/\//i.test(endpoint) && !/^sip:/i.test(endpoint)) {
    throw new Error("endpoint_url_invalid");
  }

  return {
    name,
    contact_phone: optionalText("contact_phone"),
    notification_email: optionalText("notification_email"),
    notification_sms: optionalText("notification_sms"),
    endpoint_url: endpoint,
    status
  };
}

export function supplierDestination(supplier: SupplierInput): string | null {
  return supplier.contact_phone || supplier.endpoint_url || null;
}
