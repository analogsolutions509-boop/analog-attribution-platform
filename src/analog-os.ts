import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { buildAnalogOSEvent, buildAnalogOSWebhookUrl } from "./analog-os-events.js";
import { assertAnalogOSDeliveryResponse } from "./analog-os-response.js";

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
  const acknowledgement = await response.json().catch(() => null) as { ok?: boolean; error?: string; event?: string; aggregate_id?: string } | null;
  assertAnalogOSDeliveryResponse(response.status, acknowledgement);
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
  const acknowledgement = await response.json().catch(() => null) as { ok?: boolean; error?: string; event?: string; aggregate_id?: string } | null;
  assertAnalogOSDeliveryResponse(response.status, acknowledgement);
}
