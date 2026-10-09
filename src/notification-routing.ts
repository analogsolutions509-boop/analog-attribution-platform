export type NotificationWebhookConfig = {
  notificationUrl?: string;
  notificationSecret?: string;
  analogOSUrl?: string;
  analogOSSecret?: string;
};

export type ResolvedNotificationWebhook = {
  url: string;
  signingSecret: string;
  source: "dedicated" | "analog_os_fallback";
};

export function resolveNotificationWebhook(
  config: NotificationWebhookConfig
): ResolvedNotificationWebhook | null {
  const dedicatedUrl = String(config.notificationUrl || "").trim();
  const osUrl = String(config.analogOSUrl || "").trim();
  const signingSecret = String(config.notificationSecret || config.analogOSSecret || "").trim();
  const selectedUrl = dedicatedUrl || osUrl;

  if (!selectedUrl || signingSecret.length < 16) return null;

  const url = new URL(selectedUrl);
  if (!dedicatedUrl) {
    url.searchParams.set("route", "analog-notification");
  }

  return {
    url: url.toString(),
    signingSecret,
    source: dedicatedUrl ? "dedicated" : "analog_os_fallback"
  };
}
