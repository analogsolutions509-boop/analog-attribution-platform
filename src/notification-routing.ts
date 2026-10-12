export type NotificationWebhookConfig = {
  notificationUrl?: string;
  notificationSecret?: string;
  // Retained only for legacy callers; these values must never select the OS URL.
  analogOSUrl?: string;
  analogOSSecret?: string;
};

export type ResolvedNotificationWebhook = {
  url: string;
  signingSecret: string;
  source: "dedicated";
};

export function resolveNotificationWebhook(
  config: NotificationWebhookConfig
): ResolvedNotificationWebhook | null {
  const dedicatedUrl = String(config.notificationUrl || "").trim();
  // Backwards-compatible signing secret while the notification endpoint itself
  // is dedicated. An OS URL is never used as a notification transport.
  const signingSecret = String(config.notificationSecret || config.analogOSSecret || "").trim();
  if (!dedicatedUrl || signingSecret.length < 16) return null;

  let url: URL;
  try {
    url = new URL(dedicatedUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  return {
    url: url.toString(),
    signingSecret,
    source: "dedicated"
  };
}
