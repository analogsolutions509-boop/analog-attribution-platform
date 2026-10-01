import type { FastifyInstance } from "fastify";
import { requireDashboard } from "./dashboard.js";
import { db } from "../db.js";

export async function registerLeadSearchRoutes(app:FastifyInstance){
  app.get("/v1/dashboard/leads/search",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const q=request.query as Record<string,string|undefined>;
    const params:any[]=[];const parts:string[]=["1=1"];
    if(q.q){params.push("%"+q.q+"%");const n=params.length;parts.push("(l.id::text ILIKE $"+n+" OR l.customer_name ILIKE $"+n+" OR l.company_name ILIKE $"+n+" OR l.customer_phone ILIKE $"+n+" OR l.customer_email ILIKE $"+n+")");}
    if(q.siteId){params.push(q.siteId);parts.push("l.site_id=$"+params.length);}
    if(q.supplierId){params.push(q.supplierId);parts.push("EXISTS(SELECT 1 FROM lead_assignments la WHERE la.lead_id=l.id AND la.supplier_id=$"+params.length+")");}
    if(q.channel){params.push(q.channel);parts.push("l.source=$"+params.length);}
    if(q.status){params.push(q.status);parts.push("l.status=$"+params.length);}
    if(q.outcome){params.push(q.outcome);parts.push("l.outcome=$"+params.length);}
    if(q.start){params.push(q.start);parts.push("l.created_at >= $"+params.length+"::timestamptz");}
    if(q.end){params.push(q.end);parts.push("l.created_at < $"+params.length+"::timestamptz");}
    if(q.transcript){params.push(q.transcript);parts.push("EXISTS(SELECT 1 FROM calls cx JOIN call_transcripts tx ON tx.call_id=cx.id WHERE cx.lead_id=l.id AND to_tsvector('simple',coalesce(tx.full_text,'')) @@ plainto_tsquery('simple',$"+params.length+"))");}
    if(q.tag){params.push(q.tag);parts.push("l.tags ? $"+params.length);}
    if(q.minDuration){params.push(Number(q.minDuration));parts.push("EXISTS(SELECT 1 FROM calls cd WHERE cd.lead_id=l.id AND cd.duration_seconds >= $"+params.length+")");}
    if(q.maxDuration){params.push(Number(q.maxDuration));parts.push("EXISTS(SELECT 1 FROM calls cd WHERE cd.lead_id=l.id AND cd.duration_seconds <= $"+params.length+")");}
    const limit=Math.min(Math.max(Number(q.limit??50)||50,1),100);params.push(limit);
    const result=await db.query("SELECT l.id,l.site_id,l.status,l.outcome,l.source,l.customer_name,l.company_name,l.customer_phone,l.customer_email,l.service_type,l.summary,l.tags,l.created_at,s.name AS site_name,sp.name AS supplier,COUNT(c.id)::int call_count,MAX(c.duration_seconds)::int max_duration,MAX(c.created_at) last_call_at FROM leads l JOIN sites s ON s.id=l.site_id LEFT JOIN suppliers sp ON sp.id=l.routed_supplier_id LEFT JOIN calls c ON c.lead_id=l.id WHERE "+parts.join(" AND ")+" GROUP BY l.id,s.name,sp.name ORDER BY l.created_at DESC LIMIT $"+params.length,params);
    return reply.send({leads:result.rows});
  });
}
