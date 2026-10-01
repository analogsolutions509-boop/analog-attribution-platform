export type AnalogOSEvent = {
  type: string;
  occurred_at: string;
  aggregate_type: string;
  aggregate_id: string;
  data: unknown;
};

export function buildAnalogOSWebhookUrl(baseUrl: string): string {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}route=analog-os`;
}

export function buildAnalogOSEvent(
  type: string,
  aggregateType: string,
  aggregateId: string,
  data: unknown,
  occurredAt = new Date()
): AnalogOSEvent {
  return {
    type,
    occurred_at: occurredAt.toISOString(),
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    data
  };
}
