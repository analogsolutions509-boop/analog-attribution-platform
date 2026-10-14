import type { FastifyInstance } from "fastify";
import { requireDashboard } from "./dashboard.js";
import { db } from "../db.js";
import { generateReportPdf } from "../pdf-report.js";

type Filters={siteId?:string;supplierId?:string;channel?:string;status?:string;start?:string;end?:string};

export function isValidReportDateRange(start?:string,end?:string):boolean{
  const startMs=start?new Date(start).getTime():null;
  const endMs=end?new Date(end).getTime():null;
  if(startMs!==null&&!Number.isFinite(startMs))return false;
  if(endMs!==null&&!Number.isFinite(endMs))return false;
  return startMs===null||endMs===null||endMs>startMs;
}

export function buildReportWhere(f:Filters){
  const params:any[]=[f.start??null,f.end??null];
  const parts=["l.created_at >= COALESCE($1::timestamptz, NOW()-INTERVAL '30 days')","l.created_at < COALESCE($2::timestamptz, NOW())"];
  if(f.siteId){params.push(f.siteId);parts.push("l.site_id=$"+params.length);}
  if(f.supplierId){params.push(f.supplierId);parts.push("EXISTS(SELECT 1 FROM lead_assignments la WHERE la.lead_id=l.id AND la.supplier_id=$"+params.length+")");}
  if(f.channel){params.push(f.channel);parts.push("l.source=$"+params.length);}
  if(f.status){params.push(f.status);parts.push("l.status=$"+params.length);}
  return {where:parts.join(" AND "),params};
}

export async function buildReport(filters:Filters={}){
  if(!isValidReportDateRange(filters.start,filters.end)) throw new Error("invalid_report_date_range");
  const f=buildReportWhere(filters);
  const kpi=await db.query(
    "SELECT COUNT(*)::int leads, COUNT(*) FILTER(WHERE l.status IN ('sale','quoted','pending sale','no sale'))::int touched, COUNT(*) FILTER(WHERE l.outcome='sale')::int sales FROM leads l WHERE "+f.where,
    f.params
  );
  const daily=await db.query(
    "SELECT TO_CHAR(DATE_TRUNC('day',l.created_at),'YYYY-MM-DD') AS \"day\", COUNT(*)::int leads FROM leads l WHERE "+f.where+" GROUP BY 1 ORDER BY 1",
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
    const filters=request.query as Filters;
    if(!isValidReportDateRange(filters.start,filters.end)) return reply.code(400).send({error:"invalid_report_date_range"});
    return reply.send(await buildReport(filters));
  });
  app.get("/v1/dashboard/reports.csv",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const filters=request.query as Filters;
    if(!isValidReportDateRange(filters.start,filters.end)) return reply.code(400).send({error:"invalid_report_date_range"});
    return reply.type("text/csv; charset=utf-8").header("content-disposition",'attachment; filename="analog-report.csv"').send(toCsv(await buildReport(filters)));
  });
  app.get("/v1/dashboard/reports.pdf",async(request,reply)=>{
    if(!(await requireDashboard(app,request,reply))) return;
    const q=request.query as Filters;
    if(!isValidReportDateRange(q.start,q.end)) return reply.code(400).send({error:"invalid_report_date_range"});
    const start=q.start??new Date(Date.now()-30*86400000).toISOString();
    const end=q.end??new Date().toISOString();
    const report=await buildReport({...q,start,end});
    return reply.type("application/pdf")
      .header("content-disposition",'attachment; filename="analog-attribution-report.pdf"')
      .send(await generateReportPdf(report,start,end));
  });
}
