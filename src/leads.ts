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
  const callId = typeof input.sourceDetail?.call_id === "string"
    ? input.sourceDetail.call_id.trim()
    : "";
  if (callId) {
    const existingCallLead = await db.query(
      "SELECT id FROM leads WHERE site_id=$1 AND source_detail->>'call_id'=$2 LIMIT 1",
      [input.siteId, callId]
    );
    if (existingCallLead.rowCount) return existingCallLead.rows[0].id as string;
  }

  const eventKey = typeof input.sourceDetail?.event_key === "string"
    ? input.sourceDetail.event_key.trim()
    : "";

  if (eventKey) {
    const existing = await db.query(
      `SELECT id,source,customer_name,company_name,customer_phone,customer_email,service_type,requirements,summary,routed_supplier_id
       FROM leads
       WHERE site_id=$1 AND source_detail->>'event_key'=$2
       ORDER BY created_at ASC LIMIT 1`,
      [input.siteId,eventKey]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      const leadId = row.id as string;
      const supplierId = row.routed_supplier_id || await routeLead(leadId,input.siteId,row.service_type || input.serviceType);
      const outbox = await db.query(
        "SELECT id FROM analog_os_outbox WHERE aggregate_type='lead' AND aggregate_id=$1 AND event_type='lead.created' LIMIT 1",
        [leadId]
      );
      if (!outbox.rowCount) {
        const siteResult = await db.query(
          `SELECT s.name,s.hostname,
                  sp.name AS "supplierName",sp.notification_email AS "supplierEmail"
           FROM sites s LEFT JOIN suppliers sp ON sp.id=$2
           WHERE s.id=$1 LIMIT 1`,
          [input.siteId,supplierId]
        );
        await queueAnalogOSEvent("lead.created","lead",leadId,buildLeadOSEvent({
          siteId:input.siteId,
          source:row.source || input.source,
          customerName:row.customer_name || input.customerName,
          companyName:row.company_name || input.companyName,
          customerPhone:normalizePhone(row.customer_phone || input.customerPhone) ?? undefined,
          customerEmail:row.customer_email || input.customerEmail,
          serviceType:row.service_type || input.serviceType,
          requirements:row.requirements || input.requirements || {},
          summary:row.summary || input.summary
        },leadId,supplierId,siteResult.rows[0] ?? {}));
      }
      return leadId;
    }
  }

  const insertSql = `INSERT INTO leads(site_id,visitor_id,session_id,source,customer_name,company_name,customer_phone,customer_email,service_type,requirements,summary,source_detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)${callId ? " ON CONFLICT DO NOTHING" : ""} RETURNING id`;
  const result = await db.query(
    insertSql,
    [input.siteId,input.visitorId??null,input.sessionId??null,input.source??"unknown",input.customerName??null,
     input.companyName??null,normalizePhone(input.customerPhone),input.customerEmail??null,input.serviceType??null,
     input.requirements??{},input.summary??null,input.sourceDetail??{}]
  );
  if (!result.rowCount && callId) {
    const existingCallLead = await db.query(
      "SELECT id FROM leads WHERE site_id=$1 AND source_detail->>'call_id'=$2 LIMIT 1",
      [input.siteId, callId]
    );
    if (existingCallLead.rowCount) return existingCallLead.rows[0].id as string;
  }
  if (!result.rowCount) throw new Error("lead_insert_failed");
  const leadId = result.rows[0].id as string;
  const supplierId = await routeLead(leadId,input.siteId,input.serviceType);
  const siteResult = await db.query(
    `SELECT s.name,s.hostname,
            sp.name AS "supplierName",sp.notification_email AS "supplierEmail"
     FROM sites s LEFT JOIN suppliers sp ON sp.id=$2
     WHERE s.id=$1 LIMIT 1`,
    [input.siteId,supplierId]
  );
  const site = siteResult.rows[0] ?? {};
  await queueAnalogOSEvent("lead.created", "lead", leadId, buildLeadOSEvent(
    {
      ...input,
      customerPhone: normalizePhone(input.customerPhone) ?? undefined
    },
    leadId,
    supplierId,
    site
  ));
  return leadId;
}

export async function attributeCallToLead(callId: string, siteId: string, phone?: string, startedAt?: string, calledNumber?: string) {
  const call = await db.query(
    "SELECT lead_id,started_at FROM calls WHERE id=$1 AND site_id=$2 LIMIT 1",
    [callId, siteId]
  );
  if (!call.rowCount) return null;
  if (call.rows[0].lead_id) return call.rows[0].lead_id as string;

  // Provider retries must enrich the original call lead rather than create
  // another lead each time the provider sends a status/recording event.
  const existingCallLead = await db.query(
    "SELECT id FROM leads WHERE site_id=$1 AND source_detail->>'call_id'=$2 LIMIT 1",
    [siteId, callId]
  );
  if (existingCallLead.rowCount) {
    const leadId = existingCallLead.rows[0].id as string;
    await db.query("UPDATE calls SET lead_id=$2,updated_at=NOW() WHERE id=$1", [callId, leadId]);
    return leadId;
  }

  const numberAttribution = await attributeNumberToCall(callId, siteId, calledNumber);
  const normalized = normalizePhone(phone);
  const callStartedAt = startedAt ?? call.rows[0].started_at ?? null;

  const matchedLead = normalized
    ? await db.query(
        "SELECT id FROM leads WHERE site_id=$1 AND customer_phone=$2 AND created_at<=COALESCE($3::timestamptz,NOW()) ORDER BY created_at DESC LIMIT 1",
        [siteId, normalized, callStartedAt]
      )
    : { rowCount: 0, rows: [] as any[] };

  if (matchedLead.rowCount) {
    const leadId = matchedLead.rows[0].id as string;
    const method = numberAttribution ? "dynamic_number" : "phone_exact";
    await db.query(
      "UPDATE calls SET lead_id=$2,attribution_confidence=$3,attribution_method=$4,updated_at=NOW() WHERE id=$1",
      [callId, leadId, numberAttribution ? 0.99 : 0.92, method]
    );
    await queueAnalogOSEvent("call.attributed", "call", callId, {
      call_id: callId, lead_id: leadId, site_id: siteId, method
    });
    return leadId;
  }

  // Every incoming call gets a lead record, even when there was no web form
  // or visitor-level number attribution. The called tracking number still
  // identifies the website, while visitor-level attribution remains unknown.
  const method = numberAttribution ? "dynamic_number" : "tracking_number_site";
  const leadId = await createLead({
    siteId,
    visitorId: numberAttribution?.visitor_id,
    sessionId: numberAttribution?.session_id,
    source: "phone_call",
    customerPhone: phone,
    sourceDetail: {
      call_id: callId,
      attribution: method,
      called_number: calledNumber ?? null,
      call_started_at: callStartedAt
    }
  });
  await db.query(
    "UPDATE calls SET lead_id=$2,attribution_confidence=$3,attribution_method=$4,updated_at=NOW() WHERE id=$1",
    [callId, leadId, numberAttribution ? 0.99 : 0.85, method]
  );
  await queueAnalogOSEvent("call.attributed", "call", callId, {
    call_id: callId, lead_id: leadId, site_id: siteId, method
  });
  return leadId;
}
