import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeWazoEvent, verifyWazoWebhook, verifyWazoWebhookToken, wazoWebhookCallbackToken, WazoClient } from "../src/providers/wazo.ts";

test("normalizes a Wazo call event",()=>{
  const result=normalizeWazoEvent({event:"call.created",data:{call:{id:"wazo-call-1",from:"+44123",to:"+44161",duration:11}}});
  assert.equal(result.event,"call.created");
  assert.equal(result.providerCallId,"wazo-call-1");
  assert.equal(result.callerNumber,"+44123");
  assert.equal(result.calledNumber,"+44161");
  assert.equal(result.durationSeconds,11);
});

test("normalizes the documented Wazo call_created envelope",()=>{
  const result=normalizeWazoEvent({
    name:"call_created",
    origin_uuid:"wazo-uuid",
    data:{
      call_id:"1455123422.8",
      caller_id_name:"John Doe",
      caller_id_number:"+441234567890",
      dialed_extension:"441611234567",
      creation_time:"2026-10-02T00:00:00Z",
      direction:"external",
      status:"Ring",
      user_uuid:"user-1"
    }
  });
  assert.equal(result.event,"call_created");
  assert.equal(result.providerCallId,"1455123422.8");
  assert.equal(result.callerNumber,"+441234567890");
  assert.equal(result.calledNumber,"441611234567");
  assert.equal(result.direction,"external");
  assert.equal(result.startedAt,"2026-10-02T00:00:00Z");
  assert.equal(result.status,"Ring");
});

test("normalizes the Wazo HTTP webhook data-only body with a supplied event",()=>{
  const result=normalizeWazoEvent({
    call_id:"1455123422.9",
    caller_id_number:"+441234567890",
    dialed_extension:"441611234567",
    creation_time:"2026-10-02T00:00:01Z",
    status:"Ring"
  },"call_created");
  assert.equal(result.event,"call_created");
  assert.equal(result.providerCallId,"1455123422.9");
  assert.equal(result.callerNumber,"+441234567890");
  assert.equal(result.calledNumber,"441611234567");
  assert.equal(result.startedAt,"2026-10-02T00:00:01Z");
});

test("validates HMAC webhook signatures",()=>{
  const body=JSON.stringify({hello:"world"});
  const secret="secret-value";
  const signature=createHmac("sha256",secret).update(body).digest("hex");
  assert.equal(verifyWazoWebhook(body,signature,secret),true);
  assert.equal(verifyWazoWebhook(body,signature.slice(1),secret),false);
});

test("validates Wazo callback path tokens",()=>{
  const token=wazoWebhookCallbackToken("webhook-secret");
  assert.notEqual(token,"webhook-secret");
  assert.match(token,/^[A-Za-z0-9_-]+$/);
  assert.equal(verifyWazoWebhookToken(token,"webhook-secret"),true);
  assert.equal(verifyWazoWebhookToken("webhook-secret-extra","webhook-secret"),false);
  assert.equal(verifyWazoWebhookToken(undefined,"webhook-secret"),false);
});

test("Wazo client maps attended transfer",async()=>{
  const oldFetch=globalThis.fetch;
  let request:Request|null=null;
  globalThis.fetch=async(input,init)=>{request=new Request(input,init);return new Response(JSON.stringify({id:"transfer-1"}),{status:200,headers:{"content-type":"application/json"}})};
  try{
    const client=new WazoClient("https://wazo.example/","token");
    const result=await client.createTransfer({context:"default",exten:"44161",initiatorCall:"call-1",transferredCall:"call-1",flow:"attended"});
    assert.equal(result.id,"transfer-1");
    assert.equal(request?.headers.get("X-Auth-Token"),"token");
    assert.equal(request?.method,"POST");
    assert.equal(request?.url,"https://wazo.example/api/calld/1.0/transfers");
    const body=await request!.json() as Record<string,unknown>;
    assert.equal(body.flow,"attended");
  }finally{globalThis.fetch=oldFetch}
});

test("Wazo client creates an HTTP call-event subscription",async()=>{
  const oldFetch=globalThis.fetch;
  let request:Request|null=null;
  globalThis.fetch=async(input,init)=>{request=new Request(input,init);return new Response(JSON.stringify({uuid:"sub-1"}),{status:201,headers:{"content-type":"application/json"}})};
  try{
    const client=new WazoClient("https://wazo.example/","token");
    const result=await client.createWebhookSubscription({
      name:"Analog Call Events",
      service:"http",
      events:["call_created","call_updated","call_ended"],
      config:{method:"post",url:"https://api.example/wazo/{{ event_name }}/secret",verify_certificate:"true"}
    });
    assert.equal((result as Record<string,unknown>).uuid,"sub-1");
    assert.equal(request?.method,"POST");
    assert.equal(request?.url,"https://wazo.example/api/webhookd/1.0/subscriptions");
    const body=await request!.json() as Record<string,unknown>;
    assert.equal(body.service,"http");
    assert.deepEqual(body.events,["call_created","call_updated","call_ended"]);
  }finally{globalThis.fetch=oldFetch}
});
test("Wazo client originates a call with the documented call payload",async()=>{
  const oldFetch=globalThis.fetch;
  let request:Request|null=null;
  globalThis.fetch=async(input,init)=>{request=new Request(input,init);return new Response(JSON.stringify({call_id:"call-2"}),{status:201,headers:{"content-type":"application/json"}})};
  try{
    const client=new WazoClient("https://wazo.example/","token");
    const result=await client.createCall(
      {user:"user-1",lineId:54,fromMobile:false},
      {extension:"01611234567",context:"default",priority:1},
      {ANALOG_CALL_ID:"analog-call-2"}
    );
    assert.equal((result as Record<string,unknown>).call_id,"call-2");
    assert.equal(request?.url,"https://wazo.example/api/calld/1.0/calls");
    const body=await request!.json() as Record<string,any>;
    assert.deepEqual(body.source,{user:"user-1",line_id:54,from_mobile:false});
    assert.deepEqual(body.destination,{extension:"01611234567",context:"default",priority:1});
    assert.deepEqual(body.variables,{ANALOG_CALL_ID:"analog-call-2"});
  }finally{globalThis.fetch=oldFetch}
});