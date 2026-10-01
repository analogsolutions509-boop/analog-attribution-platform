import { timingSafeEqual, createHmac } from "node:crypto";

type JsonRecord = Record<string, any>;

export class DidwwClient {
  constructor(private readonly apiKey:string, private readonly baseUrl="https://api.didww.com/v3") {}

  private async request(path:string, init:RequestInit={}){
    const response=await fetch(new URL(path,this.baseUrl),{
      ...init,
      headers:{
        Accept:"application/vnd.api+json",
        "Content-Type":"application/vnd.api+json",
        "Api-Key":this.apiKey,
        ...(init.headers??{})
      }
    });
    const text=await response.text();
    let data:any={};
    try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    if(!response.ok) throw new Error("didww_"+response.status+":"+JSON.stringify(data).slice(0,500));
    return data;
  }

  listDids(){ return this.request("/dids"); }
  listInboundTrunks(){ return this.request("/voice_in_trunks"); }
  listOutboundTrunks(){ return this.request("/voice_out_trunks"); }

  createInboundTrunk(attributes:JsonRecord){
    return this.request("/voice_in_trunks",{method:"POST",body:JSON.stringify({data:{type:"voice_in_trunks",attributes}})});
  }

  createOutboundTrunk(attributes:JsonRecord){
    return this.request("/voice_out_trunks",{method:"POST",body:JSON.stringify({data:{type:"voice_out_trunks",attributes}})});
  }

  createCdrExport(exportType:"cdr_in"|"cdr_out",filters:JsonRecord,callbackUrl?:string){
    return this.request("/exports",{method:"POST",body:JSON.stringify({
      data:{type:"exports",attributes:{export_type:exportType,filters,...(callbackUrl?{callback_url:callbackUrl,callback_method:"post"}:{})}}
    })});
  }

  getExport(id:string){ return this.request("/exports/"+encodeURIComponent(id)); }
}

export function verifyDidwwCallback(raw:string,url:string,signature:string|undefined,apiKey:string){
  if(!signature||!apiKey) return false;
  const digest=createHmac("sha1",apiKey).update(url+raw).digest("hex");
  const a=Buffer.from(signature,"utf8"),b=Buffer.from(digest,"utf8");
  return a.length===b.length&&timingSafeEqual(a,b);
}

export function verifyDidwwCallEventAuth(
  headers:Record<string,string|string[]|undefined>,
  expectedHeader?:string,
  username?:string,
  password?:string
){
  const custom=typeof headers["x-didww-auth-token"]==="string" ? headers["x-didww-auth-token"]
    : typeof headers["x-auth-token"]==="string" ? headers["x-auth-token"]
    : typeof headers["x-analog-provider-secret"]==="string" ? headers["x-analog-provider-secret"] : undefined;
  if(expectedHeader && custom===expectedHeader) return true;

  const authorization=headers.authorization;
  if(username && password && typeof authorization==="string" && authorization.startsWith("Basic ")){
    try{
      const decoded=Buffer.from(authorization.slice(6),"base64").toString("utf8");
      const separator=decoded.indexOf(":");
      if(separator<0) return false;
      const gotUser=decoded.slice(0,separator),gotPassword=decoded.slice(separator+1);
      const ua=Buffer.from(gotUser),ub=Buffer.from(username);
      const pa=Buffer.from(gotPassword),pb=Buffer.from(password);
      return ua.length===ub.length && pa.length===pb.length && timingSafeEqual(ua,ub) && timingSafeEqual(pa,pb);
    }catch{return false}
  }
  return false;
}

export function normalizeDidwwCallEvent(payload:any){
  const root:JsonRecord=payload && typeof payload==="object" ? payload : {};
  const attributes:JsonRecord=root.attributes && typeof root.attributes==="object" ? root.attributes : (root.data && typeof root.data==="object" ? root.data : root);
  const type=String(root.type??root.event??attributes.event??"");
  const outbound=type.startsWith("outbound-");
  const providerCallId=String(root.id??attributes.call_id??attributes.callId??"");
  const connected=type.includes("connect");
  const ended=type.includes("end");
  const status=connected ? "answered" : ended ? "completed" : type.includes("start") ? "ringing" : undefined;
  return {
    event:type,
    providerCallId,
    callerNumber:typeof (attributes.src_number??attributes.original_src_number) === "string" ? String(attributes.src_number??attributes.original_src_number) : undefined,
    calledNumber:typeof (outbound ? attributes.dst_number : attributes.did_number) === "string" ? String(outbound ? attributes.dst_number : attributes.did_number) : undefined,
    direction:outbound ? "outbound" : "inbound",
    startedAt:typeof attributes.time_start==="string" ? attributes.time_start : undefined,
    connectedAt:typeof attributes.time_connect==="string" ? attributes.time_connect : undefined,
    endedAt:typeof attributes.time_end==="string" ? attributes.time_end : undefined,
    durationSeconds:Number.isFinite(Number(attributes.duration)) ? Number(attributes.duration) : undefined,
    status
  };
}

