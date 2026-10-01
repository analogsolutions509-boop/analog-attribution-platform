import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { resolveSite } from "../auth.js";
import { db } from "../db.js";
import { createLead } from "../leads.js";

function secretOk(request:any) {
  const value=request.headers["x-analog-channel-secret"];
  return typeof value==="string" && value===config.ANALOG_PROVIDER_WEBHOOK_SECRET;
}

async function recordMessage(input:any) {
  await db.query(`INSERT INTO lead_messages(lead_id,site_id,channel,direction,sender,recipient,subject,body,metadata)
    VALUES($1,$2,$3,'inbound',$4,$5,$6,$7,$8)`,[input.leadId,input.siteId,input.channel,input.sender ?? null,input.recipient ?? null,
      input.subject ?? null,input.body ?? "",input.metadata ?? {}]);
}

export async function registerOmnichannelRoutes(app:FastifyInstance) {
  app.post("/v1/providers/form/webhook", async (request,reply)=>{
    const site=await resolveSite(request.headers["x-analog-site-key"] as string|undefined);
    if(!site) return reply.code(401).send({error:"invalid_site_key"});
    const body=request.body as Record<string,unknown>;
    if(typeof body.customer_phone!=="string"&&typeof body.customer_email!=="string")
      return reply.code(400).send({error:"customer_phone_or_email_required"});
    const leadId=await createLead({siteId:site.id,visitorId:typeof body.visitor_id==="string"?body.visitor_id:undefined,
      sessionId:typeof body.session_id==="string"?body.session_id:undefined,source:"form",
      customerName:typeof body.customer_name==="string"?body.customer_name:undefined,
      companyName:typeof body.company_name==="string"?body.company_name:undefined,
      customerPhone:typeof body.customer_phone==="string"?body.customer_phone:undefined,
      customerEmail:typeof body.customer_email==="string"?body.customer_email:undefined,
      serviceType:typeof body.service_type==="string"?body.service_type:undefined,
      summary:typeof body.message==="string"?body.message:undefined,sourceDetail:{page_url:body.page_url ?? null}});
    await recordMessage({leadId,siteId:site.id,channel:"form",sender:body.customer_email,body:body.message,metadata:body});
    return reply.code(201).send({ok:true,lead_id:leadId});
  });

  app.post("/v1/providers/email/webhook", async (request,reply)=>{
    if(!secretOk(request)) return reply.code(401).send({error:"invalid_channel_secret"});
    const body=request.body as Record<string,unknown>;
    const siteId=typeof body.site_id==="string"?body.site_id:"";
    if(!siteId||typeof body.from!=="string") return reply.code(400).send({error:"site_id_and_from_required"});
    const leadId=await createLead({siteId,source:"email",customerName:typeof body.from_name==="string"?body.from_name:undefined,
      customerEmail:body.from,summary:typeof body.text==="string"?body.text:undefined,sourceDetail:{subject:body.subject ?? null}});
    await recordMessage({leadId,siteId,channel:"email",sender:body.from,recipient:body.to,subject:body.subject,body:body.text,metadata:body});
    return reply.code(201).send({ok:true,lead_id:leadId});
  });

  app.post("/v1/providers/sms/webhook", async (request,reply)=>{
    if(!secretOk(request)) return reply.code(401).send({error:"invalid_channel_secret"});
    const body=request.body as Record<string,unknown>;
    const siteId=typeof body.site_id==="string"?body.site_id:"";
    if(!siteId||typeof body.from!=="string") return reply.code(400).send({error:"site_id_and_from_required"});
    const leadId=await createLead({siteId,source:"sms",customerPhone:body.from,summary:typeof body.body==="string"?body.body:undefined,sourceDetail:{to:body.to ?? null}});
    await recordMessage({leadId,siteId,channel:"sms",sender:body.from,recipient:body.to,body:body.body,metadata:body});
    return reply.code(201).send({ok:true,lead_id:leadId});
  });
}