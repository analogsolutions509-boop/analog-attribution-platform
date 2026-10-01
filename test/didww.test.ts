import test from "node:test";
import assert from "node:assert/strict";
import { DidwwClient, normalizeDidwwCallEvent, verifyDidwwCallEventAuth, verifyDidwwCallback } from "../src/providers/didww.ts";
import { createHmac } from "node:crypto";

test("normalizes official DIDWW Voice IN call-end payload",()=>{
  const result=normalizeDidwwCallEvent({
    type:"incoming-call-end-event",
    id:"10-10282FC6-5F632C460006A397-AC8C7700",
    attributes:{
      time_start:"2026-10-02T10:00:00.000+00:00",
      time_end:"2026-10-02T10:01:05.000+00:00",
      call_id:"26-26-ABC",
      duration:65,
      did_number:"441612345678",
      src_number:"441234567890"
    }
  });
  assert.equal(result.providerCallId,"10-10282FC6-5F632C460006A397-AC8C7700");
  assert.equal(result.callerNumber,"441234567890");
  assert.equal(result.calledNumber,"441612345678");
  assert.equal(result.durationSeconds,65);
  assert.equal(result.status,"completed");
  assert.equal(result.direction,"inbound");
});

test("normalizes official DIDWW Voice OUT call-start payload",()=>{
  const result=normalizeDidwwCallEvent({
    type:"outbound-call-start-event",
    id:"outbound-1",
    attributes:{time_start:"2026-10-02T10:00:00Z",src_number:"441612345678",dst_number:"441234567890"}
  });
  assert.equal(result.providerCallId,"outbound-1");
  assert.equal(result.callerNumber,"441612345678");
  assert.equal(result.calledNumber,"441234567890");
  assert.equal(result.direction,"outbound");
  assert.equal(result.status,"ringing");
});

test("validates DIDWW Call Events custom header",()=>{
  assert.equal(
    verifyDidwwCallEventAuth({"x-auth-token":"secret"}, "secret"),
    true
  );
  assert.equal(
    verifyDidwwCallEventAuth({"x-auth-token":"wrong"}, "secret"),
    false
  );
});

test("validates DIDWW Call Events Basic Auth",()=>{
  const token=Buffer.from("analog:user-secret").toString("base64");
  assert.equal(
    verifyDidwwCallEventAuth({authorization:"Basic "+token}, undefined, "analog", "user-secret"),
    true
  );
  assert.equal(
    verifyDidwwCallEventAuth({authorization:"Basic "+token}, undefined, "analog", "wrong-secret"),
    false
  );
});

test("keeps HMAC verifier for DIDWW resource callbacks",()=>{
  const url="https://example.com/callback";
  const body='{"id":"1"}';
  const key="test-api-key";
  const sig=createHmac("sha1",key).update(url+body).digest("hex");
  assert.equal(verifyDidwwCallback(body,url,sig,key),true);
});

test("DIDWW client sends Api-Key header",async()=>{
  const oldFetch=globalThis.fetch;
  let request:Request|null=null;
  globalThis.fetch=async(input,init)=>{
    request=new Request(input,init);
    return new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/vnd.api+json"}});
  };
  try{
    const client=new DidwwClient("demo-key","https://api.didww.example/v3");
    await client.listDids();
    assert.equal(request?.headers.get("Api-Key"),"demo-key");
    assert.equal(request?.method,"GET");
  }finally{
    globalThis.fetch=oldFetch;
  }
});

