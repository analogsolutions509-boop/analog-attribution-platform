export function requireAnalogOSDeliveryConfig(
  webhookUrl: string | undefined,
  webhookSecret: string | undefined
): { url: string; secret: string } {
  const url = String(webhookUrl ?? "").trim();
  if (!url) throw new Error("analog_os_webhook_url_missing");

  const secret = String(webhookSecret ?? "").trim();
  if (!secret) throw new Error("analog_os_webhook_secret_missing");

  return { url, secret };
}
