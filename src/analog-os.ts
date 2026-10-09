import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { buildAnalogOSEvent, buildAnalogOSWebhookUrl } from "./analog-os-events.js";
import { assertAnalogOSDeliveryResponse } from "./analog-os-response.js";
import { requireAnalogOSDeliveryConfig } from "./analog-os-delivery-config.js";

export async function syncAnalogOS(type: string, data: unknown, aggregateType = "lead", aggregateId = "unknown") {
  const delivery = requireAnalogOSDeliveryConfig(
    config.ANALOG_OS_WEBHOOK_URL,
    config.ANALOG_OS_WEBHOOK_SECRET
  );
  const event = buildAnalogOSEvent(type, aggregateType, aggregateId, data);
  const canonicalBody = JSON.stringify(event);
  const signature = createHmac("sha256", delivery.secret).update(canonicalBody).digest("hex");
  const body = JSON.stringify({ event, signature });
  const response = await fetch(buildAnalogOSWebhookUrl(delivery.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-analog-signature": signature },
    body
  });
  const acknowledgement = await response.json().catch(() => null) as { ok?: boolean; error?: string; event?: string; aggregate_id?: string } | null;
  assertAnalogOSDeliveryResponse(response.status, acknowledgement);
}

export async function deliverAnalogOSEvent(payload: unknown): Promise<void> {
  const delivery = requireAnalogOSDeliveryConfig(
    config.ANALOG_OS_WEBHOOK_URL,
    config.ANALOG_OS_WEBHOOK_SECRET
  );
  const event = payload as { type: string; aggregate_type: string; aggregate_id: string; data: unknown; occurred_at: string };
  const canonicalBody = JSON.stringify(event);
  const signature = createHmac("sha256", delivery.secret).update(canonicalBody).digest("hex");
  const response = await fetch(buildAnalogOSWebhookUrl(delivery.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-analog-signature": signature },
    body: JSON.stringify({ event, signature })
  });
  const acknowledgement = await response.json().catch(() => null) as { ok?: boolean; error?: string; event?: string; aggregate_id?: string } | null;
  assertAnalogOSDeliveryResponse(response.status, acknowledgement);
}
