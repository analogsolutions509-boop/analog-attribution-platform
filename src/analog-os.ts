import { createHmac } from "node:crypto";
import { config } from "./config.js";

export async function syncAnalogOS(type: string, data: unknown) {
  if (!config.ANALOG_OS_WEBHOOK_URL) return;
  const body = JSON.stringify({ type, occurred_at: new Date().toISOString(), data });
  const signature = config.ANALOG_OS_WEBHOOK_SECRET
    ? createHmac("sha256",config.ANALOG_OS_WEBHOOK_SECRET).update(body).digest("hex") : "";
  const response = await fetch(config.ANALOG_OS_WEBHOOK_URL,{
    method:"POST",
    headers:{"content-type":"application/json","x-analog-signature":signature},
    body
  });
  if (!response.ok) throw new Error(`analog_os_sync_failed:${response.status}`);
}
