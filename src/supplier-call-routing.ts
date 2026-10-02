export function supplierInboundWhisper(input: {supplierName: string; siteName?: string | null}): string {
  const supplier=input.supplierName.trim() || "Unknown supplier";
  const site=input.siteName?.trim();
  return site ? `Supplier call from ${supplier} regarding ${site}.` : `Supplier call from ${supplier}.`;
}
