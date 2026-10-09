import { createHmac } from "node:crypto";

export type NotificationEnvelope = {
  payload: Record<string, unknown>;
  signature: string;
};

export function buildNotificationEnvelope(
  payload: Record<string, unknown>,
  secret: string
): NotificationEnvelope {
  if (!secret || secret.length < 16) {
    throw new Error("notification_signing_secret_missing");
  }

  return {
    payload,
    signature: createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex")
  };
}
