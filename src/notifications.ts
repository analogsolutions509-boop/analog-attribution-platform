import { config } from "./config.js";
import { db } from "./db.js";
import { createJob } from "./jobs.js";
import { createOutcomeToken } from "./outcomes.js";
import { createRecordingDownloadUrl } from "./storage/r2.js";

type NotificationRequest = {
  leadId:string;
  callId?:string;
  recipientType:"internal"|"supplier";
  channel:"email"|"sms";
};

export async function queueNotification(input:NotificationRequest) {
  if (input.callId) {
    const existing = await db.query("SELECT id FROM notifications WHERE call_id=$1 AND recipient_type=$2 AND channel=$3 LIMIT 1",[input.callId,input.recipientType,input.channel]);
    if (existing.rowCount) return existing.rows[0].id as string;
  }
  const lead=await db.query(`SELECT l.*,s.name AS site_name,s.hostname,
    s.supplier_id AS site_supplier_id,
    sp.name AS supplier_name,sp.notification_email,sp.notification_sms
    FROM leads l JOIN sites s ON s.id=l.site_id
    LEFT JOIN suppliers sp ON sp.id=l.routed_supplier_id
    WHERE l.id=$1 LIMIT 1`,[input.leadId]);
  if(!lead.rowCount) throw new Error("lead_not_found");
  const row=lead.rows[0];
  const token = input.recipientType==="supplier"
    ? createOutcomeToken(input.leadId,row.routed_supplier_id)
    : null;
  if(token) await db.query(`INSERT INTO lead_outcome_tokens(lead_id,supplier_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4)`,[input.leadId,token.supplierId,token.hash,token.expiresAt]);
  const call=input.callId
    ? (await db.query(`SELECT c.*,ci.summary,ct.full_text FROM calls c
        LEFT JOIN call_intelligence ci ON ci.call_id=c.id
        LEFT JOIN call_transcripts ct ON ct.call_id=c.id
        WHERE c.id=$1 LIMIT 1`,[input.callId])).rows[0]
    : null;
  const recordingUrl=call?.recording_storage_key
    ? await createRecordingDownloadUrl(call.recording_storage_key).catch(()=>null) : null;
  const outcomeBase=config.PUBLIC_API_URL?.replace(/\/$/,"");
  const outcomes=token && outcomeBase ? {
    sale:`${outcomeBase}/v1/outcomes/${token.raw}/sale`,
    quoted:`${outcomeBase}/v1/outcomes/${token.raw}/quoted`,
    no_sale:`${outcomeBase}/v1/outcomes/${token.raw}/no_sale`,
    pending_sale:`${outcomeBase}/v1/outcomes/${token.raw}/pending_sale`
  } : null;
  const target = input.recipientType==="supplier"
    ? (input.channel==="sms" ? row.notification_sms : row.notification_email)
    : config.ANALOG_INTERNAL_NOTIFICATION_EMAIL;
  const payload={
    target:target ?? null,
    lead_id:input.leadId,call_id:input.callId ?? null,
    recipient_type:input.recipientType,channel:input.channel,
    website:row.site_name,hostname:row.hostname,
    caller_name:row.customer_name ?? null,
    caller_phone:input.recipientType==="internal" ? row.customer_phone ?? null : null,
    caller_email:input.recipientType==="internal" ? row.customer_email ?? null : null,
    supplier:input.recipientType==="supplier" ? row.supplier_name ?? null : null,
    summary:call?.summary ?? row.summary ?? null,
    transcript:call?.full_text ?? null,
    duration_seconds:call?.duration_seconds ?? null,
    recording_url:recordingUrl,
    outcome_links:outcomes,
    created_at:new Date().toISOString()
  };
  const result=await db.query(`INSERT INTO notifications(call_id,lead_id,recipient_type,channel,payload)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.callId ?? null,input.leadId,input.recipientType,input.channel,payload]);
  await createJob("notification.send","notification",result.rows[0].id,{});
  return result.rows[0].id as string;
}

export async function deliverNotification(notificationId:string) {
  const result=await db.query("SELECT id,payload,status FROM notifications WHERE id=$1",[notificationId]);
  if(!result.rowCount) throw new Error("notification_not_found");
  const row=result.rows[0];
  if(row.status==="sent") return;
  if(!config.ANALOG_NOTIFICATIONS_WEBHOOK_URL) {
    await db.query("UPDATE notifications SET status='skipped',last_error='webhook_not_configured',updated_at=NOW() WHERE id=$1",[notificationId]);
    return;
  }
  const body=JSON.stringify(row.payload);
  const response=await fetch(config.ANALOG_NOTIFICATIONS_WEBHOOK_URL,{
    method:"POST",
    headers:{"content-type":"application/json","x-analog-notification-secret":config.ANALOG_NOTIFICATIONS_WEBHOOK_SECRET ?? ""},
    body
  });
  if(!response.ok) throw new Error(`notification_webhook_${response.status}`);
  await db.query("UPDATE notifications SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=$1",[notificationId]);
}