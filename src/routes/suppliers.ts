import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { requireDashboard } from "./dashboard.js";

function authorized(request:any) {
  return request.headers["x-analog-enrollment-secret"] === config.ANALOG_ENROLLMENT_SECRET;
}

export async function registerSupplierRoutes(app:FastifyInstance) {
  app.post("/v1/suppliers", async (request,reply)=>{
    if(!authorized(request)) return reply.code(401).send({error:"unauthorized"});
    const body=request.body as Record<string,unknown>;
    if(typeof body.name!=="string") return reply.code(400).send({error:"name_required"});
    const result=await db.query("INSERT INTO suppliers(name,endpoint_url) VALUES($1,$2) RETURNING id,name,status,endpoint_url",[body.name.trim(),typeof body.endpoint_url==="string"?body.endpoint_url:null]);
    return reply.code(201).send({supplier:result.rows[0]});
  });

  app.post("/v1/routing-rules", async (request,reply)=>{
    if(!authorized(request)) return reply.code(401).send({error:"unauthorized"});
    const body=request.body as Record<string,unknown>;
    if(typeof body.supplier_id!=="string") return reply.code(400).send({error:"supplier_id_required"});
    const result=await db.query("INSERT INTO routing_rules(supplier_id,site_id,service_type,region,priority) VALUES($1,$2,$3,$4,$5) RETURNING *",[body.supplier_id,typeof body.site_id==="string"?body.site_id:null,typeof body.service_type==="string"?body.service_type:null,typeof body.region==="string"?body.region:null,typeof body.priority==="number"?body.priority:100]);
    return reply.code(201).send({rule:result.rows[0]});
  });

  app.get("/v1/dashboard/suppliers", async (request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const q=request.query as Record<string,string|undefined>;
    if(!q.siteId) return reply.code(400).send({error:"siteId_required"});
    const result=await db.query("SELECT ss.rank,s.id,s.name,s.status,s.contact_phone,s.notification_email,s.notification_sms,ss.active FROM site_suppliers ss JOIN suppliers s ON s.id=ss.supplier_id WHERE ss.site_id=$1 ORDER BY ss.rank",[q.siteId]);
    return reply.send({suppliers:result.rows});
  });

  app.post("/v1/dashboard/site-suppliers", async (request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const body=request.body as Record<string,unknown>;
    const siteId=typeof body.site_id==="string"?body.site_id:"";
    const supplierId=typeof body.supplier_id==="string"?body.supplier_id:"";
    const rank=Number(body.rank);
    if(!siteId||!supplierId||!Number.isInteger(rank)||rank<1||rank>5) return reply.code(400).send({error:"site_id_supplier_id_rank_required"});
    const exists=await db.query("SELECT id FROM site_suppliers WHERE site_id=$1 AND (supplier_id=$2 OR rank=$3)",[siteId,supplierId,rank]);
    if(exists.rowCount) return reply.code(409).send({error:"supplier_or_rank_already_assigned"});
    const result=await db.query("INSERT INTO site_suppliers(site_id,supplier_id,rank) VALUES($1,$2,$3) RETURNING *",[siteId,supplierId,rank]);
    return reply.code(201).send({assignment:result.rows[0]});
  });
}
