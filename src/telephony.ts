import { config } from "./config.js";
import { WazoClient } from "./providers/wazo.js";

export type TransferRequest = {
  callId: string;
  initiatorCall: string;
  transferredCall: string;
  context: string;
  destination: string;
  mode: "blind" | "warm";
  timeout?: number;
  websiteName?: string;
  forwardingNumber?: string;
};

export function getWazoClient(): WazoClient | null {
  if (!config.WAZO_API_URL || !config.WAZO_AUTH_TOKEN) return null;
  return new WazoClient(config.WAZO_API_URL, config.WAZO_AUTH_TOKEN);
}

export async function executeWazoTransfer(input: TransferRequest) {
  const client = getWazoClient();
  if (!client) throw new Error("wazo_not_configured");
  return client.createTransfer({
    context: input.context,
    exten: input.destination,
    initiatorCall: input.initiatorCall,
    transferredCall: input.transferredCall,
    flow: input.mode === "warm" ? "attended" : "blind",
    timeout: input.timeout ?? 20,
    variables: {
      ANALOG_WEBSITE_NAME: input.websiteName ?? "",
      ANALOG_CALL_ID: input.callId,
      ANALOG_FORWARDING_NUMBER: input.forwardingNumber ?? ""
    }
  });
}

export function telephonyMode() {
  return config.TELEPHONY_PROVIDER;
}