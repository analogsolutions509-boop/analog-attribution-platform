import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { upsertIncomingCall } from "../calls.js";
import { attributeCallToLead } from "../leads.js";
import { createJob } from "../jobs.js";
import { isSafeRecordingUrl } from "../call-recording.js";
import { normalizeDidwwCallEvent, verifyDidwwCallEventAuth } from "../providers/didww.js";

function authOk(request:any){
  return verifyDidwwCallEventAuth(
    request.headers,
    config.DIDWW_CALLBACK_SECRET,
    config.DIDWW_CALLBACK_USERNAME,
    config.DIDWW_CALLBACK_PASSWORD
  );
}

export async function registerDidwwRoutes(app:FastifyInstance){
  app.post("/v1/providers/didww/call-events", async(request,reply)=>{
    const authConfigured=Boolean(
      config.DIDWW_CALLBACK_SECRET ||
      (config.DIDWW_CALLBACK_USERNAME && config.DIDWW_CALLBACK_PASSWORD)
    );
    if(!authConfigured) return reply.code(503).send({error:"didww_callback_auth_not_configured"});
    if(!authOk(request)) return reply.code(401).send({error:"invalid_didww_callback_auth"});

    const event=normalizeDidwwCallEvent(request.body);
    if(!event.providerCallId) return reply.code(400).send({error:"provider_call_id_required"});
    if(!event.calledNumber) return reply.code(400).send({error:"called_number_required"});

    if(event.recordingUrl && !isSafeRecordingUrl(event.recordingUrl)) {
      return reply.code(400).send({error:"secure_recording_url_required"});
    }
    const called=event.calledNumber.replace(/\D/g,"");
    const site=await db.query(
      "SELECT s.id,s.hostname,s.name FROM tracking_numbers tn JOIN sites s ON s.id=tn.site_id WHERE tn.active AND regexp_replace(tn.phone_number,'\\D','','g')=$1 LIMIT 1",
      [called]
    );
    const resolvedSite=site.rows[0] ?? null;

    const callId=await upsertIncomingCall({
      siteId:resolvedSite?.id ?? null,
      siteName:resolvedSite?.name,
      hostname:resolvedSite?.hostname,
      provider:"didww",
      providerCallId:event.providerCallId,
      callerNumber:event.callerNumber,
      calledNumber:event.calledNumber,
      direction:event.direction,
      startedAt:event.startedAt,
      endedAt:event.endedAt,
      durationSeconds:event.durationSeconds,
      recordingUrl:event.recordingUrl,
      recordingMimeType:event.recordingMimeType
    });

    await db.query(
      "UPDATE calls SET status=COALESCE($2,status),updated_at=NOW() WHERE id=$1",
      [callId,event.status??null]
    );
    if(resolvedSite?.id) await attributeCallToLead(callId,resolvedSite.id,event.callerNumber,event.startedAt,event.calledNumber);

    if(event.recordingUrl){
      await createJob("call.process","call",callId,{}, {forceRequeue:true});
    }

    return reply.code(202).send({
      ok:true,
      call_id:callId,
      site_id:resolvedSite?.id ?? null,
      attribution_status:resolvedSite?.id ? "attributed" : "unattributed",
      event:event.event,
      direction:event.direction,
      recording_received:Boolean(event.recordingUrl)
    });
  });

  app.get("/v1/providers/didww/status", async(_request,reply)=>reply.send({
    ok:true,
    api_configured:Boolean(config.DIDWW_API_KEY),
    callback_configured:Boolean(config.DIDWW_CALLBACK_SECRET || (config.DIDWW_CALLBACK_USERNAME && config.DIDWW_CALLBACK_PASSWORD)),
    api_url:config.DIDWW_API_URL
  }));
}

