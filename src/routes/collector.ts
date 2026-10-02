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
const q=new URLSearchParams(location.search);
const send=async(name,payload={})=>fetch(A+"/v1/events",{method:"POST",headers:{"content-type":"application/json","x-analog-site-key":K},keepalive:true,body:JSON.stringify({event_key:crypto.randomUUID(),event_name:name,occurred_at:new Date().toISOString(),visitor_key:visitor,session_key:session,page_url:location.href,page_path:location.pathname,referrer:document.referrer||null,utm_source:q.get("utm_source"),utm_medium:q.get("utm_medium"),utm_campaign:q.get("utm_campaign"),utm_term:q.get("utm_term"),utm_content:q.get("utm_content"),payload})}).catch(()=>{});
send("page_view");
const clean=v=>{if(typeof v!=="string")return;v=v.trim();return v?v.slice(0,1000):undefined};
const keyOf=k=>k.toLowerCase().replace(/[^a-z0-9]/g,"");
const pick=(f,names)=>{for(const k of Object.keys(f)){if(names.includes(keyOf(k))){const v=clean(f[k]);if(v)return v}}};
const captureForm=form=>{
if(form.dataset.analogCaptured)return;
const fields={};
form.querySelectorAll("input,textarea,select").forEach(el=>{
  if(el.disabled||el.type==="submit"||el.type==="button"||el.type==="hidden")return;
  const value=el.value;
  if(!value)return;
  fields[el.name||el.id||el.getAttribute("aria-label")||el.getAttribute("placeholder")||"field"]=value;
});
const phone=pick(fields,["phone","phonenumber","mobile","mobilenumber","telephone","tel","yourphone","formfieldsphone"]);
const email=pick(fields,["email","emailaddress","youremail","formfieldsemail"]);
const name=pick(fields,["name","fullname","yourname","customername","contactname","formfieldsname"]);
const company=pick(fields,["company","companyname","business","businessname","formfieldscompany"]);
const message=pick(fields,["message","details","enquiry","inquiry","requirements","description","yourmessage","formfieldsmessage"]);
const service=pick(fields,["service","servicetype","projecttype","typeofservice","formfieldsservice"]);
if(!phone&&!email)return;
form.dataset.analogCaptured="1";
send("form_submit",{name,company_name:company,phone,customer_phone:phone,email,customer_email:email,service_type:service,message});
};
document.addEventListener("submit",e=>captureForm(e.target),true);
fetch(A+"/v1/phone-pool/assign",{method:"POST",headers:{"content-type":"application/json","x-analog-site-key":K},body:JSON.stringify({visitor_id:visitor,session_id:session})}).then(r=>r.ok?r.json():null).then(x=>{
if(!x?.phone_number)return;document.querySelectorAll("[data-analog-phone]").forEach(e=>{e.textContent=x.phone_number;if(e.tagName==="A")e.href="tel:"+x.phone_number.replace(/\s/g,"")});
});
window.AnalogCollector={track:send,captureForm,visitor,session};
})();`;
    return reply.type("application/javascript; charset=utf-8").header("cache-control","public,max-age=300").send(script);
  });
}
