/**
 * Pick the number that should ring the operator for an incoming tracked call.
 * A live per-site forwarding route takes precedence; the global operator
 * number remains a safe fallback for legacy/unmapped routes.
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
