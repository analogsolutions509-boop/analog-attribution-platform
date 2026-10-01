import type { FastifyInstance } from "fastify";
import { requireDashboard } from "./dashboard.js";
import { db } from "../db.js";
import { generateReportPdf } from "../pdf-report.js";

type Filters={siteId?:string;supplierId?:string;channel?:string;start?:string;end?:string};

function buildWhere(f:Filters){
  const params:any[]=[f.start??null,f.end??null];
  const parts=["l.created_at >= COALESCE($1::timestamptz, NOW()-INTERVAL '30 days')","l.created_at < COALESCE($2::timestamptz, NOW())"];
  if(f.siteId){params.push(f.siteId);parts.push("l.site_id=$"+params.length);}
  if(f.supplierId){params.push(f.supplierId);parts.push("EXISTS(SELECT 1 FROM lead_assignments la WHERE la.lead_id=l.id AND la.supplier_id=$"+params.length+")");}
  if(f.channel){params.push(f.channel);parts.push("l.source=$"+params.length);}
  return {where:parts.join(" AND "),params};
}

export async function buildReport(filters:Filters={}){
  const f=buildWhere(filters);
  const kpi=await db.query(
    "SELECT COUNT(*)::int leads, COUNT(*) FILTER(WHERE l.status IN ('sale','quoted','pending sale','no sale'))::int touched, COUNT(*) FILTER(WHERE l.outcome='sale')::int sales FROM leads l WHERE "+f.where,
    f.params
  );
  const daily=await db.query(
    "SELECT TO_CHAR(DATE_TRUNC('day',l.created_at),'YYYY-MM-DD') day, COUNT(*)::int leads FROM leads l WHERE "+f.where+" GROUP BY 1 ORDER BY 1",
    f.params
  );
  const suppliers=await db.query(
    "SELECT COALESCE(s.name,'Unassigned') supplier,COUNT(*)::int leads,COUNT(*) FILTER(WHERE l.outcome='sale')::int sales FROM leads l LEFT JOIN suppliers s ON s.id=l.routed_supplier_id WHERE "+f.where+" GROUP BY 1 ORDER BY leads DESC",
    f.params
  );
  return {kpi:kpi.rows[0],daily:daily.rows,suppliers:suppliers.rows};
}

function quoteCsv(value:unknown){return '"'+String(value??"").replaceAll('"','""')+'"';}
function toCsv(report:any){
  const rows:string[][]=[
    ["metric","value"],
    ["leads",String(report.kpi.leads)],
    ["touched",String(report.kpi.touched)],
    ["sales",String(report.kpi.sales)],
    [],
    ["day","leads"]
  ];
  for(const row of report.daily) rows.push([String(row.day),String(row.leads)]);
  rows.push([],["supplier","leads","sales"]);
  for(const row of report.suppliers) rows.push([String(row.supplier),String(row.leads),String(row.sales)]);
  return rows.map(row=>row.map(quoteCsv).join(",")).join("\n");
}

export async function registerReportRoutes(app:FastifyInstance){
  app.get("/v1/dashboard/reports/data",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    return reply.send(await buildReport(request.query as Filters));
  });
  app.get("/v1/dashboard/reports.csv",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    return reply.type("text/csv; charset=utf-8").header("content-disposition",'attachment; filename="analog-report.csv"').send(toCsv(await buildReport(request.query as Filters)));
  });
  app.get("/v1/dashboard/reports.pdf",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const q=request.query as Filters;
    const start=q.start??new Date(Date.now()-30*86400000).toISOString();
    const end=q.end??new Date().toISOString();
    const report=await buildReport({...q,start,end});
    return reply.type("application/pdf")
      .header("content-disposition",'attachment; filename="analog-super-whatconverts-report.pdf"')
      .send(await generateReportPdf(report,start,end));
  });
}