import { db } from "./db.js";
import { routeLead } from "./routing.js";
import { normalizePhone } from "./utils/phone.js";
import { attributeNumberToCall } from "./number-pool.js";
import { queueAnalogOSEvent } from "./analog-os-outbox.js";
import { buildLeadOSEvent } from "./lead-event.js";

export type LeadInput = {
  siteId: string; visitorId?: string; sessionId?: string; source?: string;
  customerName?: string; companyName?: string; customerPhone?: string;
  customerEmail?: string; serviceType?: string; requirements?: Record<string, unknown>;
  summary?: string; sourceDetail?: Record<string, unknown>;
};

export async function createLead(input: LeadInput) {
  const result = await db.query(
    `INSERT INTO leads(site_id,visitor_id,session_id,source,customer_name,company_name,customer_phone,customer_email,service_type,requirements,summary,source_detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [input.siteId,input.visitorId??null,input.sessionId??null,input.source??"unknown",input.customerName??null,
     input.companyName??null,normalizePhone(input.customerPhone),input.customerEmail??null,input.serviceType??null,
     input.requirements??{},input.summary??null,input.sourceDetail??{}]
  );
  const leadId = result.rows[0].id as string;
  const supplierId = await routeLead(leadId,input.siteId,input.serviceType);
  const siteResult = await db.query(
    "SELECT name,hostname FROM sites WHERE id=$1 LIMIT 1",
    [input.siteId]
  );
  const site = siteResult.rows[0] ?? {};
  await queueAnalogOSEvent("lead.created", "lead", leadId, buildLeadOSEvent(
    {
      ...input,
      customerPhone: normalizePhone(input.customerPhone)
    },
    leadId,
    supplierId,
    site
  ));
  return leadId;
}

export async function attributeCallToLead(callId: string, siteId: string, phone?: string, startedAt?: string, calledNumber?: string) {
  const numberAttribution = await attributeNumberToCall(callId, siteId, calledNumber);
  if (numberAttribution) {
    const normalized = normalizePhone(phone);
    const lead = normalized ? await db.query(
      "SELECT id FROM leads WHERE site_id=$1 AND customer_phone=$2 ORDER BY created_at DESC LIMIT 1",
      [siteId,normalized]
    ) : { rowCount: 0, rows: [] as any[] };
    const leadId = lead.rowCount ? lead.rows[0].id : await createLead({
      siteId, visitorId: numberAttribution.visitor_id, sessionId: numberAttribution.session_id,
      source: "phone_call", customerPhone: phone, sourceDetail: { attribution: "dynamic_number", called_number: calledNumber }
    });
    await db.query("UPDATE calls SET lead_id=$2,updated_at=NOW() WHERE id=$1",[callId,leadId]);
    await queueAnalogOSEvent("call.attributed", "call", callId, {
      call_id: callId, lead_id: leadId, site_id: siteId, method: "dynamic_number"
    });
    return leadId;
  }
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const result = await db.query(
    "SELECT id FROM leads WHERE site_id=$1 AND customer_phone=$2 AND created_at<=COALESCE($3::timestamptz,NOW()) ORDER BY created_at DESC LIMIT 1",
    [siteId,normalized,startedAt??null]
  );
  if (!result.rowCount) return null;
  await db.query("UPDATE calls SET lead_id=$2,attribution_confidence=0.92,attribution_method='phone_exact',updated_at=NOW() WHERE id=$1",[callId,result.rows[0].id]);
  await queueAnalogOSEvent("call.attributed", "call", callId, {
    call_id: callId, lead_id: result.rows[0].id, site_id: siteId, method: "phone_exact"
  });
  return result.rows[0].id;
}
