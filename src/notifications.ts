import { config } from "./config.js";
import { db } from "./db.js";
import { createJob } from "./jobs.js";
import { createOutcomeToken } from "./outcomes.js";
import { createRecordingDownloadUrl } from "./storage/r2.js";
import { buildNotificationEnvelope } from "./notification-envelope.js";

type NotificationRequest = {
  leadId:string;
  callId?:string;
  recipientType:"internal"|"supplier";
  channel:"email"|"sms";
};

export async function queueNotification(input:NotificationRequest) {
  const existing = await db.query(
    `SELECT id,status FROM notifications
     WHERE lead_id=$1 AND recipient_type=$2 AND channel=$3
       AND call_id IS NOT DISTINCT FROM $4
     ORDER BY created_at DESC LIMIT 1`,
    [input.leadId,input.recipientType,input.channel,input.callId ?? null]
  );
  if (existing.rowCount) {
    const notificationId = existing.rows[0].id as string;
    const status = String(existing.rows[0].status || "").toLowerCase();
    if (status === "sent") return notificationId;

    if (status === "skipped") {
      await db.query(
        "UPDATE notifications SET status='pending',last_error=NULL,updated_at=NOW() WHERE id=$1",
        [notificationId]
      );
      await createJob("notification.send","notification",notificationId,{}, {forceRequeue:true});
    } else {
      await createJob("notification.send","notification",notificationId,{});
    }
    return notificationId;
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
    transcript:input.recipientType === "internal" ? call?.full_text ?? null : null,
    duration_seconds:call?.duration_seconds ?? null,
    recording_url:recordingUrl,
    outcome_links:outcomes,
    created_at:new Date().toISOString()
  };
  const result=await db.query(`INSERT INTO notifications(call_id,lead_id,recipient_type,channel,payload)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.callId ?? null,input.leadId,input.recipientType,input.channel,payload]);
  const notificationId = result.rows[0].id as string;
  const storedPayload = { ...payload, notification_id: notificationId };
  await db.query("UPDATE notifications SET payload=$2,updated_at=NOW() WHERE id=$1",[notificationId,storedPayload]);
  await createJob("notification.send","notification",notificationId,{});
  return notificationId;
}

export async function deliverNotification(notificationId:string) {
  const result=await db.query("SELECT id,payload,status FROM notifications WHERE id=$1",[notificationId]);
  if(!result.rowCount) throw new Error("notification_not_found");
  const row=result.rows[0];
  if(row.status==="sent") return;

  const payload = { ...(row.payload as Record<string, unknown>) };
  const channel = String(payload.channel ?? "");
  const recipientType = String(payload.recipient_type ?? "");
  const skip = async (reason: string) => {
    await db.query(
      "UPDATE notifications SET status='skipped',last_error=$2,updated_at=NOW() WHERE id=$1",
      [notificationId, reason]
    );
  };

  if(channel === "sms") {
    await skip("sms_provider_not_configured");
    return;
  }
  if(channel !== "email") {
    await skip("unsupported_notification_channel");
    return;
  }

  if(!config.ANALOG_NOTIFICATIONS_WEBHOOK_URL) {
    await skip("webhook_not_configured");
    return;
  }

  let target = String(payload.target ?? "").trim();
  if(!target && recipientType === "internal") {
    target = config.ANALOG_INTERNAL_NOTIFICATION_EMAIL || "info@analogsolution.com";
    payload.target = target;
  }
  if(!target) {
    await skip("notification_recipient_missing");
    return;
  }

  const signingSecret = config.ANALOG_NOTIFICATIONS_WEBHOOK_SECRET || config.ANALOG_OS_WEBHOOK_SECRET || "";
  const envelope = buildNotificationEnvelope(payload, signingSecret);
  const response=await fetch(config.ANALOG_NOTIFICATIONS_WEBHOOK_URL,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(envelope)
  });
  const responseBody = await response.json().catch(() => null) as { ok?: boolean; error?: string; duplicate?: boolean } | null;
  if(!response.ok) throw new Error(`notification_webhook_${response.status}`);
  if(responseBody?.ok !== true) {
    const reason = String(responseBody?.error ?? "notification_webhook_rejected");
    if(reason === "recipient_missing" || reason === "unsupported_channel" || reason === "supplier_email_missing") {
      await skip(reason);
      return;
    }
    throw new Error(reason);
  }

  await db.query(
    "UPDATE notifications SET payload=$2,status='sent',sent_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1",
    [notificationId,payload]
  );
}