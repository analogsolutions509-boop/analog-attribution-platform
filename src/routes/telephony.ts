import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { executeWazoTransfer, getWazoClient } from "../telephony.js";
import { normalizeWazoEvent, verifyWazoWebhook, verifyWazoWebhookToken } from "../providers/wazo.js";
import { queueAnalogOSEvent } from "../analog-os-outbox.js";
import { createJob } from "../jobs.js";
import { attributeCallToLead } from "../leads.js";
import { resolveCallNumberRoute, upsertIncomingCall } from "../calls.js";
import { requireDashboard } from "./dashboard.js";

const WAZO_CALL_EVENTS = new Set(["call_created", "call_updated", "call_ended"]);

type WazoWebhookOptions = {
  callbackEvent?: string;
  callbackToken?: string;
  legacyHmac?: string;
};

export async function registerTelephonyRoutes(app: FastifyInstance) {
  const handleWazoWebhook = async (request: any, reply: any, options: WazoWebhookOptions) => {
    const raw = JSON.stringify(request.body ?? {});

    if (options.callbackToken !== undefined) {
      if (!verifyWazoWebhookToken(options.callbackToken, config.WAZO_WEBHOOK_SECRET ?? "")) {
        return reply.code(401).send({error:"invalid_wazo_callback_token"});
      }
      if (!options.callbackEvent || !WAZO_CALL_EVENTS.has(options.callbackEvent)) {
        return reply.code(400).send({error:"unsupported_wazo_event"});
      }
    } else if (!verifyWazoWebhook(raw, options.legacyHmac, config.WAZO_WEBHOOK_SECRET ?? "")) {
      return reply.code(401).send({error:"invalid_wazo_signature"});
    }

    const event = normalizeWazoEvent(request.body, options.callbackEvent);
    if (!event.providerCallId) return reply.code(400).send({error:"provider_call_id_required"});

    const existing = await db.query("SELECT id,site_id FROM calls WHERE provider='wazo' AND provider_call_id=$1 LIMIT 1",[event.providerCallId]);
    if (existing.rowCount) {
      const callId=existing.rows[0].id as string;
      await db.query("UPDATE calls SET caller_number=COALESCE($2,caller_number),called_number=COALESCE($3,called_number),direction=COALESCE($4,direction),started_at=COALESCE($5,started_at),ended_at=COALESCE($6,ended_at),duration_seconds=COALESCE($7,duration_seconds),status=$8,recording_source_url=COALESCE($9,recording_source_url),updated_at=NOW() WHERE id=$1",[callId,event.callerNumber??null,event.calledNumber??null,event.direction??null,event.startedAt??null,event.endedAt??null,event.durationSeconds??null,(event.status ?? event.event) || "updated",event.recordingUrl??null]);
      if (event.direction?.toLowerCase() !== "outbound") {
        const route = await resolveCallNumberRoute(existing.rows[0].site_id, event.calledNumber);
        await db.query("UPDATE calls SET tracking_number_id=COALESCE($2,tracking_number_id),forwarding_number_id=COALESCE($3,forwarding_number_id),tracking_number=COALESCE($4,tracking_number),forwarding_number=COALESCE($5,forwarding_number),destination_number=COALESCE($6,destination_number) WHERE id=$1",[callId,route?.tracking_number_id??null,route?.forwarding_number_id??null,route?.tracking_number??null,route?.forwarding_number??null,route?.destination_number??null]);
      }
      if(event.recordingUrl) await createJob("call.process","call",callId,{}, {forceRequeue:true});
      await attributeCallToLead(callId,existing.rows[0].site_id,event.callerNumber,event.startedAt,event.calledNumber);
      return reply.send({ok:true,updated:true,call_id:callId});
    }

    const number = event.calledNumber?.replace(/\D/g,"") ?? "";
    const site = await db.query("SELECT s.id,s.name,s.hostname FROM tracking_numbers tn JOIN sites s ON s.id=tn.site_id WHERE tn.active AND regexp_replace(tn.phone_number,'\\D','','g')=$1 LIMIT 1",[number]);
    if (!site.rowCount) return reply.code(422).send({error:"site_resolution_failed"});
    const callId = await upsertIncomingCall({
      siteId: site.rows[0].id,
      siteName: site.rows[0].name,
      hostname: site.rows[0].hostname,
      provider: "wazo",
      providerCallId: event.providerCallId,
      callerNumber: event.callerNumber,
      calledNumber: event.calledNumber,
      direction: event.direction,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationSeconds: event.durationSeconds,
      recordingUrl: event.recordingUrl
    });
    return reply.code(202).send({ok:true,call_id:callId,event:event.event});
  };

  app.post("/v1/providers/wazo/webhook", async (request, reply) => {
    const signature = typeof request.headers["x-wazo-signature"] === "string" ? request.headers["x-wazo-signature"] : undefined;
    return handleWazoWebhook(request, reply, {legacyHmac:signature});
  });

  app.post<{Params:{event:string;token:string}}>("/v1/providers/wazo/webhook/:event/:token", async (request, reply) => {
    return handleWazoWebhook(request, reply, {callbackEvent:request.params.event, callbackToken:request.params.token});
  });

  app.post<{Params:{callId:string}}>("/v1/telephony/calls/:callId/transfer", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const body=request.body as Record<string,unknown>;
    const supplierId=typeof body.supplier_id==="string"?body.supplier_id:"";
    const mode=body.mode==="warm"?"warm":"blind";
    if(!supplierId) return reply.code(400).send({error:"supplier_id_required"});
    const call=await db.query("SELECT c.id,c.provider,c.provider_call_id,c.site_id,c.tracking_number,c.forwarding_number,c.destination_number,s.name AS site_name FROM calls c JOIN sites s ON s.id=c.site_id WHERE c.id=$1",[request.params.callId]);
    if(!call.rowCount) return reply.code(404).send({error:"call_not_found"});
    const supplier=await db.query(`SELECT ss.rank,s.id,s.name,COALESCE(s.contact_phone,s.endpoint_url) AS destination FROM site_suppliers ss JOIN suppliers s ON s.id=ss.supplier_id WHERE ss.site_id=$1 AND ss.supplier_id=$2 AND ss.active AND s.status='active'`,[call.rows[0].site_id,supplierId]);
    if(!supplier.rowCount || !supplier.rows[0].destination) return reply.code(422).send({error:"supplier_destination_not_configured"});
    const attempt=await db.query(`INSERT INTO transfer_attempts(call_id,supplier_id,mode,provider,rank,result) VALUES($1,$2,$3,'wazo',$4,'initiated') RETURNING id`,[call.rows[0].id,supplierId,mode,supplier.rows[0].rank]);
    try {
      const transfer=await executeWazoTransfer({callId:call.rows[0].id,initiatorCall:call.rows[0].provider_call_id,transferredCall:call.rows[0].provider_call_id,context:config.WAZO_CONTEXT,destination:supplier.rows[0].destination,mode,websiteName:call.rows[0].site_name,forwardingNumber:call.rows[0].forwarding_number ?? undefined});
      await db.query("UPDATE transfer_attempts SET provider_transfer_id=$2,result='ringing' WHERE id=$1",[attempt.rows[0].id,String((transfer as any).id ?? "")]);
      await queueAnalogOSEvent("transfer.started","call",call.rows[0].id,{call_id:call.rows[0].id,supplier_id:supplierId,attempt_id:attempt.rows[0].id,mode,provider:"wazo"});
      return reply.code(202).send({ok:true,attempt_id:attempt.rows[0].id,transfer});
    } catch(error) {
      await db.query("UPDATE transfer_attempts SET result='failed',metadata=$2 WHERE id=$1",[attempt.rows[0].id,{error:String(error)}]);
      return reply.code(502).send({error:"transfer_failed",detail:String(error).slice(0,300),attempt_id:attempt.rows[0].id});
    }
  });

  app.post<{Params:{transferId:string}}>("/v1/telephony/transfers/:transferId/complete", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const client=getWazoClient(); if(!client) return reply.code(503).send({error:"wazo_not_configured"});
    await client.completeTransfer(request.params.transferId);
    await db.query("UPDATE transfer_attempts SET result='answered',answered_at=COALESCE(answered_at,NOW()) WHERE provider='wazo' AND provider_transfer_id=$1",[request.params.transferId]);
    return reply.send({ok:true});
  });

  app.get("/v1/telephony/status", async (_request, reply) => reply.send({
    ok:true,
    provider:config.TELEPHONY_PROVIDER,
    wazo_configured:Boolean(getWazoClient()),
    twilio_configured:Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN),
    twilio_operator_configured:Boolean(config.TWILIO_OPERATOR_NUMBER),
    twilio_ready:Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_OPERATOR_NUMBER)
  }));
}