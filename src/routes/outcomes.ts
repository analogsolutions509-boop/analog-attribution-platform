import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { consumeOutcomeToken, createOutcomeToken } from "../outcomes.js";
import { requireDashboard } from "./dashboard.js";

export async function registerOutcomeRoutes(app:FastifyInstance) {
  app.get<{Params:{token:string,outcome:string}}>(
    "/v1/outcomes/:token/:outcome", async(request,reply)=>{
      try {
        const result=await consumeOutcomeToken(request.params.token,request.params.outcome);
        const label=result.outcome.replaceAll("_"," ");
        return reply.type("text/html; charset=utf-8").send(`<!doctype html><html><body style="font:16px system-ui;padding:40px"><h1>Outcome recorded</h1><p>Lead ${result.leadId} is now marked <b>${label}</b>.</p><p>Thank you, Analog Solutions.</p></body></html>`);
      } catch(error) {
        const safe=String(error).replace(/[<>]/g,"");
        return reply.code(410).type("text/html; charset=utf-8").send(`<!doctype html><html><body style="font:16px system-ui;padding:40px"><h1>Link unavailable</h1><p>${safe}</p></body></html>`);
      }
    });

  app.post<{Params:{leadId:string}}>(
    "/v1/dashboard/leads/:leadId/outcome", async(request,reply)=>{
      if(!(await requireDashboard(app,request,reply))) return;
      const body=request.body as Record<string,unknown>;
      if(typeof body.outcome!=="string"||typeof body.token!=="string") return reply.code(400).send({error:"outcome_and_token_required"});
      try {
        const result=await consumeOutcomeToken(body.token,body.outcome);
        if(result.leadId!==request.params.leadId) return reply.code(403).send({error:"lead_mismatch"});
        return reply.send({ok:true,...result});
      } catch(error) { return reply.code(400).send({error:String(error)}); }
    });

  app.post<{Params:{leadId:string}}>(
    "/v1/dashboard/leads/:leadId/outcome-link", async(request,reply)=>{
      if(!(await requireDashboard(app,request,reply))) return;
      const lead=await db.query("SELECT id,routed_supplier_id FROM leads WHERE id=$1",[request.params.leadId]);
      if(!lead.rowCount) return reply.code(404).send({error:"lead_not_found"});
      const token=createOutcomeToken(request.params.leadId,lead.rows[0].routed_supplier_id);
      await db.query("INSERT INTO lead_outcome_tokens(lead_id,supplier_id,token_hash,expires_at) VALUES($1,$2,$3,$4)",
        [token.leadId,token.supplierId,token.hash,token.expiresAt]);
      return reply.send({ok:true,expires_at:token.expiresAt,token:token.raw});
    });
}