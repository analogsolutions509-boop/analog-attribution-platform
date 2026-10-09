export type AnalogOSResponseBody = {
  ok?: boolean;
  error?: string;
  event?: string;
  aggregate_id?: string;
};

export function assertAnalogOSDeliveryResponse(
  status: number,
  body: AnalogOSResponseBody | null
): void {
  if (status < 200 || status >= 300) {
    throw new Error("analog_os_sync_failed:" + status);
  }
  if (!body || body.ok !== true) {
    const reason = body && typeof body.error === "string" ? body.error : "invalid_acknowledgement";
    throw new Error("analog_os_sync_rejected:" + reason);
  }
}
