import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalizeWazoEvent, verifyWazoWebhook, WazoClient } from "../src/providers/wazo.ts";

test("normalizes a Wazo call event",()=>{
  const result=normalizeWazoEvent({event:"call.created",data:{call:{id:"wazo-call-1",from:"+44123",to:"+44161",duration:11}}});
  assert.equal(result.event,"call.created");
  assert.equal(result.providerCallId,"wazo-call-1");
  assert.equal(result.callerNumber,"+44123");
  assert.equal(result.calledNumber,"+44161");
  assert.equal(result.durationSeconds,11);
});

test("validates HMAC webhook signatures",()=>{
  const body=JSON.stringify({hello:"world"});
  const secret="secret-value";
  const signature=createHmac("sha256",secret).update(body).digest("hex");
  assert.equal(verifyWazoWebhook(body,signature,secret),true);
  assert.equal(verifyWazoWebhook(body,signature.slice(1),secret),false);
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
    const body=await request!.json() as Record<string,unknown>;
    assert.equal(body.flow,"attended");
  }finally{globalThis.fetch=oldFetch}
});
