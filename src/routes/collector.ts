import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { resolveSite } from "../auth.js";
import { isAllowedCollectorHostname, resolvePublicCollectorSite } from "../public-collector.js";

function collectorScript(api: string, siteKey?: string, hostname?: string): string {
  const direct = Boolean(hostname);
  const eventsUrl = direct
    ? api + "/v1/public/events?site=" + encodeURIComponent(hostname!)
    : api + "/v1/events";
  const phoneUrl = direct
    ? api + "/v1/public/phone-pool/assign?site=" + encodeURIComponent(hostname!)
    : api + "/v1/phone-pool/assign";
  const key = siteKey ? JSON.stringify(siteKey) : "null";
  return `(()=>{const A=${JSON.stringify(api)},K=${key},EU=${JSON.stringify(eventsUrl)},PU=${JSON.stringify(phoneUrl)},S="analog_visitor",SS="analog_session";
const id=(n)=>{let v=localStorage.getItem(n);if(!v){v=crypto.randomUUID();localStorage.setItem(n,v)}return v};
const visitor=id(S),session=sessionStorage.getItem(SS)||crypto.randomUUID();sessionStorage.setItem(SS,session);
const q=new URLSearchParams(location.search);
const headers=K?{"content-type":"application/json","x-analog-site-key":K}:{"content-type":"application/json","origin":location.origin};
const send=async(name,payload={})=>fetch(EU,{method:"POST",headers,keepalive:true,body:JSON.stringify({event_key:crypto.randomUUID(),event_name:name,occurred_at:new Date().toISOString(),visitor_key:visitor,session_key:session,page_url:location.href,page_path:location.pathname,referrer:document.referrer||null,utm_source:q.get("utm_source"),utm_medium:q.get("utm_medium"),utm_campaign:q.get("utm_campaign"),utm_term:q.get("utm_term"),utm_content:q.get("utm_content"),payload})}).catch(()=>{});
const pageViewReady = send("page_view");
const clean=v=>{if(typeof v!=="string")return;v=v.trim();return v?v.slice(0,1000):undefined};
const keyOf=k=>k.toLowerCase().replace(/[^a-z0-9]/g,"");
const pick=(f,names)=>{for(const k of Object.keys(f)){if(names.includes(keyOf(k))){const v=clean(f[k]);if(v)return v}}};
const captureForm=form=>{if(form.dataset.analogCaptured)return;const fields={};form.querySelectorAll("input,textarea,select").forEach(el=>{if(el.disabled||el.type==="submit"||el.type==="button"||el.type==="hidden")return;const value=el.value;if(!value)return;fields[el.name||el.id||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"field"]=value});
const phone=pick(fields,["phone","phonenumber","mobile","mobilenumber","telephone","tel","yourphone","formfieldsphone"]);
const email=pick(fields,["email","emailaddress","youremail","formfieldsemail"]);
const name=pick(fields,["name","fullname","yourname","customername","contactname","formfieldsname"]);
const company=pick(fields,["company","companyname","business","businessname","formfieldscompany"]);
const message=pick(fields,["message","details","enquiry","inquiry","requirements","description","yourmessage","formfieldsmessage"]);
const service=pick(fields,["service","servicetype","projecttype","typeofservice","formfieldsservice"]);
if(!phone&&!email)return;form.dataset.analogCaptured="1";send("form_submit",{name,company_name:company,phone,customer_phone:phone,email,customer_email:email,service_type:service,message});};
document.addEventListener("submit",e=>captureForm(e.target),true);
pageViewReady.then(() => fetch(PU,{method:"POST",headers,body:JSON.stringify({visitor_id:visitor,session_id:session})})).then(r=>r.ok?r.json():null).then(x=>{if(!x?.phone_number)return;document.querySelectorAll("[data-analog-phone]").forEach(e=>{e.textContent=x.phone_number;if(e.tagName==="A")e.href="tel:"+x.phone_number.replace(/\\s/g,"")})}).catch(()=>{});
window.AnalogCollector={track:send,captureForm,visitor,session};
})();`;
}

export async function registerCollectorRoutes(app: FastifyInstance) {
  app.get("/v1/collector.js", async (request, reply) => {
    const query = request.query as { site_key?: string; hostname?: string };
    const siteKey = query.site_key?.trim();
    const hostname = query.hostname?.trim();
    if (!siteKey && !hostname) return reply.code(400).type("text/plain").send("/* site_key or hostname required */");

    let site;
    if (siteKey) {
      site = await resolveSite(siteKey);
      if (!site) return reply.code(401).type("text/plain").send("/* invalid site key */");
    } else {
      if (!hostname || !isAllowedCollectorHostname(hostname)) {
        return reply.code(403).type("text/plain").send("/* collector hostname not allowed */");
      }
      site = await resolvePublicCollectorSite(hostname);
      if (!site) return reply.code(403).type("text/plain").send("/* collector site unavailable */");
    }

    if (!config.PUBLIC_API_URL) return reply.code(503).type("text/plain").send("/* collector not configured */");
    const api = config.PUBLIC_API_URL.replace(/\/$/,"");
    return reply
      .type("application/javascript; charset=utf-8")
      .header("cache-control","public,max-age=300")
      .send(collectorScript(api, siteKey, hostname));
  });
}
