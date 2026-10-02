export type SupplierOnboardingInput = {
  siteId?: unknown;
  supplierId?: unknown;
  trackingNumberId?: unknown;
  forwardingNumberId?: unknown;
  rank?: unknown;
  active?: unknown;
};

export function buildSupplierOnboarding(input: SupplierOnboardingInput) {
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const siteId = text(input.siteId);
  const supplierId = text(input.supplierId);
  const trackingNumberId = text(input.trackingNumberId);
  const forwardingNumberId = text(input.forwardingNumberId);
  const rank = Number(input.rank);
  if (!siteId) throw new Error("site_id_required");
  if (!supplierId) throw new Error("supplier_id_required");
  if (!trackingNumberId) throw new Error("tracking_number_id_required");
  if (!forwardingNumberId) throw new Error("forwarding_number_id_required");
  if (!Number.isInteger(rank) || rank < 1 || rank > 5) throw new Error("rank_invalid");
  return {siteId, supplierId, trackingNumberId, forwardingNumberId, rank, active: input.active !== false};
}
