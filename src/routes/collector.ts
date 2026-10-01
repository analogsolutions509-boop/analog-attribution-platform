import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { resolveSite } from "../auth.js";

export async function registerCollectorRoutes(app: FastifyInstance) {
  app.get("/v1/collector.js", async (request, reply) => {
    const siteKey = (request.query as { site_key?: string }).site_key;
    const site = await resolveSite(siteKey);
    if (!site) return reply.code(401).type("text/plain").send("/* invalid site key */");
    if (!config.PUBLIC_API_URL) return reply.code(503).type("text/plain").send("/* collector not configured */");
    const api = JSON.stringify(config.PUBLIC_API_URL.replace(/\/$/,""));
    const key = JSON.stringify(siteKey);
    const script = `(()=>{const A=${api},K=${key},S="analog_visitor",SS="analog_session";
const id=(n)=>{let v=localStorage.getItem(n);if(!v){v=crypto.randomUUID();localStorage.setItem(n,v)}return v};
const visitor=id(S),session=sessionStorage.getItem(SS)||crypto.randomUUID();sessionStorage.setItem(SS,session);
const q=new URLSearchParams(location.search),event=async(name,payload={})=>fetch(A+"/v1/events",{method:"POST",headers:{"content-type":"application/json","x-analog-site-key":K},body:JSON.stringify({event_key:crypto.randomUUID(),event_name:name,occurred_at:new Date().toISOString(),visitor_key:visitor,session_key:session,page_url:location.href,page_path:location.pathname,referrer:document.referrer||null,utm_source:q.get("utm_source"),utm_medium:q.get("utm_medium"),utm_campaign:q.get("utm_campaign"),utm_term:q.get("utm_term"),utm_content:q.get("utm_content"),payload})}).catch(()=>{});
event("page_view");
fetch(A+"/v1/phone-pool/assign",{method:"POST",headers:{"content-type":"application/json","x-analog-site-key":K},body:JSON.stringify({visitor_id:visitor,session_id:session})}).then(r=>r.ok?r.json():null).then(x=>{if(!x?.phone_number)return;document.querySelectorAll("[data-analog-phone]").forEach(e=>{e.textContent=x.phone_number;if(e.tagName==="A")e.href="tel:"+x.phone_number.replace(/\s/g,"")});});
window.AnalogCollector={track:event,visitor,session};})();`;
    return reply.type("application/javascript; charset=utf-8").header("cache-control","public,max-age=300").send(script);
  });
}
