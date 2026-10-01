import { DidwwClient } from "../src/providers/didww.ts";

const key = process.env.DIDWW_API_KEY;
if (!key) {
  console.error("DIDWW_API_KEY is not configured");
  process.exit(2);
}

const client = new DidwwClient(key, process.env.DIDWW_API_URL ?? "https://api.didww.com/v3");

try {
  const [dids, inbound, outbound] = await Promise.all([
    client.listDids(),
    client.listInboundTrunks(),
    client.listOutboundTrunks()
  ]);

  console.log(JSON.stringify({
    ok: true,
    didsCount: Array.isArray((dids as any).data) ? (dids as any).data.length : null,
    inboundTrunksCount: Array.isArray((inbound as any).data) ? (inbound as any).data.length : null,
    outboundTrunksCount: Array.isArray((outbound as any).data) ? (outbound as any).data.length : null
  }, null, 2));
} catch (error) {
  console.error(String(error));
  process.exit(1);
}
