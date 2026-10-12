/**
 * Routing primitives for Twilio's automatic supplier-forwarding flow.
 * A call tries the tracking number's assigned primary supplier first, then
 * the website's active ranked suppliers, and finally a legacy global target.
 */
export type TwilioSupplierRoute = {
  supplierId?: string | null;
  supplierName?: string | null;
  destination?: string | null;
  rank?: number | null;
};

export type TwilioDialTarget = {
  supplierId: string | null;
  supplierName: string;
  destination: string;
  rank: number | null;
};

function dialablePhone(value: string | null | undefined): string | null {
  const candidate = String(value ?? "").trim();
  if (!candidate || !/^[+()\d\s.-]+$/.test(candidate)) return null;

  const digits = candidate.replace(/\D/g, "");
  let normalized: string;
  if (candidate.startsWith("+")) {
    normalized = "+" + digits;
  } else if (digits.startsWith("00")) {
    normalized = "+" + digits.slice(2);
  } else if (digits.startsWith("44")) {
    normalized = "+" + digits;
  } else if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) {
    normalized = "+44" + digits.slice(1);
  } else {
    return null;
  }

  const normalizedDigits = normalized.replace(/\D/g, "");
  if (normalizedDigits.length < 7 || normalizedDigits.length > 15) return null;
  return normalized;
}
function phoneKey(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // This platform currently targets UK suppliers. Compare +44 and national
  // trunk-prefix forms as the same destination so a fallback is not dialled twice.
  if (digits.startsWith("44") && digits.length === 12) return "0" + digits.slice(2);
  if (digits.length === 10) return "0" + digits;
  return digits;
}

function rankValue(value: number | null | undefined): number {
  return Number.isInteger(value) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

/**
 * Build an ordered, duplicate-free dial plan. Only telephone destinations
 * are accepted; endpoint URLs are not valid Twilio voice dial targets.
 */
export function buildTwilioDialPlan(
  primary: TwilioSupplierRoute | null | undefined,
  rankedSuppliers: TwilioSupplierRoute[],
  legacyForwardTarget?: string | null
): TwilioDialTarget[] {
  const plan: TwilioDialTarget[] = [];
  const usedPhoneNumbers = new Set<string>();
  const usedSupplierIds = new Set<string>();

  const append = (route: TwilioSupplierRoute) => {
    const destination = dialablePhone(route.destination);
    if (!destination) return;

    const key = phoneKey(destination);
    const supplierId = String(route.supplierId ?? "").trim() || null;
    if (usedPhoneNumbers.has(key)) return;
    if (supplierId && usedSupplierIds.has(supplierId)) return;

    plan.push({
      supplierId,
      supplierName: String(route.supplierName ?? "").trim() || "Supplier",
      destination,
      rank: Number.isInteger(route.rank) ? Number(route.rank) : null
    });
    usedPhoneNumbers.add(key);
    if (supplierId) usedSupplierIds.add(supplierId);
  };

  if (primary) append(primary);
  const orderedFallbacks = [...rankedSuppliers].sort(
    (left, right) => rankValue(left.rank) - rankValue(right.rank)
  );
  for (const supplier of orderedFallbacks) append(supplier);

  const legacy = dialablePhone(legacyForwardTarget);
  if (legacy) {
    append({
      supplierId: null,
      supplierName: "Legacy forwarding target",
      destination: legacy,
      rank: null
    });
  }
  return plan;
}

/**
 * Legacy helper kept for compatibility with older integrations. New inbound
 * call routing should use buildTwilioDialPlan and direct supplier dialing.
 */
export function resolveTwilioOperatorTarget(
  siteForwardingNumber: string | null | undefined,
  globalOperatorNumber: string | null | undefined
): string | null {
  const siteTarget = String(siteForwardingNumber ?? "").trim();
  if (siteTarget) return siteTarget;

  const globalTarget = String(globalOperatorNumber ?? "").trim();
  return globalTarget || null;
}
