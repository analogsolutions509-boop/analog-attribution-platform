import { db } from "./db.js";
export { normalizePhone } from "./utils/phone.js";

export async function routeLead(leadId: string, siteId: string, serviceType?: string, region?: string) {
  const rules = await db.query(
    `SELECT rr.supplier_id FROM routing_rules rr
     JOIN suppliers s ON s.id=rr.supplier_id AND s.status='active'
     WHERE rr.active AND (rr.site_id=$1 OR rr.site_id IS NULL)
       AND (rr.service_type IS NULL OR rr.service_type=$2)
       AND (rr.region IS NULL OR rr.region=$3)
     ORDER BY (rr.site_id IS NULL)::int, rr.priority ASC LIMIT 1`,
    [siteId, serviceType ?? null, region ?? null]
  );
  if (!rules.rowCount) {
    const fallback = await db.query("SELECT supplier_id FROM sites WHERE id=$1 AND supplier_id IS NOT NULL", [siteId]);
    if (!fallback.rowCount) return null;
    rules.rows[0] = fallback.rows[0];
  }
  const supplierId = rules.rows[0].supplier_id;
  await db.query("INSERT INTO lead_assignments(lead_id,supplier_id,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [leadId, supplierId, "routing_rule"]);
  await db.query("UPDATE leads SET routed_supplier_id=$2,updated_at=NOW() WHERE id=$1", [leadId, supplierId]);
  return supplierId as string;
}
