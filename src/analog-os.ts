import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { buildAnalogOSEvent, buildAnalogOSWebhookUrl } from "./analog-os-events.js";

export async function syncAnalogOS(type: string, data: unknown, aggregateType = "lead", aggregateId = "unknown") {
  if (!config.ANALOG_OS_WEBHOOK_URL) return;
  const event = buildAnalogOSEvent(type, aggregateType, aggregateId, data);
  const canonicalBody = JSON.stringify(event);
  const signature = config.ANALOG_OS_WEBHOOK_SECRET
    ? createHmac("sha256", config.ANALOG_OS_WEBHOOK_SECRET).update(canonicalBody).digest("hex")
    : "";
  const body = JSON.stringify({ event, signature });
  const response = await fetch(buildAnalogOSWebhookUrl(config.ANALOG_OS_WEBHOOK_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-analog-signature": signature },
    body
  });
  if (!response.ok) throw new Error(`analog_os_sync_failed:${response.status}`);
}

export async function deliverAnalogOSEvent(payload: unknown): Promise<void> {
  if (!config.ANALOG_OS_WEBHOOK_URL) return;
  const event = payload as { type: string; aggregate_type: string; aggregate_id: string; data: unknown; occurred_at: string };
  const canonicalBody = JSON.stringify(event);
  const signature = config.ANALOG_OS_WEBHOOK_SECRET
    ? createHmac("sha256", config.ANALOG_OS_WEBHOOK_SECRET).update(canonicalBody).digest("hex")
    : "";
  const response = await fetch(buildAnalogOSWebhookUrl(config.ANALOG_OS_WEBHOOK_URL), {
    method: "POST",
    headers: { "content-type": "application/json", "x-analog-signature": signature },
    body: JSON.stringify({ event, signature })
  });
  if (!response.ok) throw new Error(`analog_os_sync_failed:${response.status}`);
}
