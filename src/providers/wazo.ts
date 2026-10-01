import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Json = Record<string, unknown>;

export type WazoTransferInput = {
  context: string;
  exten: string;
  initiatorCall: string;
  transferredCall: string;
  flow: "blind" | "attended";
  timeout?: number;
  variables?: Record<string,string>;
};

export type WazoTransfer = {
  id?: string;
  status?: string;
  call?: Json;
};

function bodyRecord(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function timingSafeSecretEqual(left: string | undefined, right: string): boolean {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyWazoWebhook(raw: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = signature.replace(/^sha256=/i, "");
  return timingSafeSecretEqual(provided, expected);
}

export function wazoWebhookCallbackToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export function verifyWazoWebhookToken(token: string | undefined, secret: string): boolean {
  return timingSafeSecretEqual(token, wazoWebhookCallbackToken(secret));
}

export function normalizeWazoEvent(payload: unknown, defaultEvent?: string) {
  const root = bodyRecord(payload);
  const data = bodyRecord(root.data ?? payload);
  const call = bodyRecord(data.call ?? root.call);
  const source = Object.assign({}, data, call);

  const event = firstString(root.name, root.event, root.event_name, data.event, defaultEvent) ?? "";
  const providerCallId = firstString(call.id, call.call_id, data.call_id, root.call_id) ?? "";
  const callerNumber = firstString(
    call.caller_id_number, call.caller_number, call.from,
    data.caller_id_number, data.caller_number, data.from
  );
  const calledNumber = firstString(
    call.called_number, call.dialed_extension, call.destination_extension, call.to,
    data.called_number, data.dialed_extension, data.destination_extension, data.to
  );
  const startedAt = firstString(
    call.started_at, call.start_time, call.creation_time,
    data.started_at, data.start_time, data.creation_time
  );
  const endedAt = firstString(
    call.ended_at, call.end_time, call.hangup_time,
    data.ended_at, data.end_time, data.hangup_time
  );
  const durationValue = source.duration ?? source.duration_seconds;

  return {
    event,
    providerCallId,
    callerNumber,
    calledNumber,
    direction: firstString(call.direction, data.direction),
    startedAt,
    endedAt,
    durationSeconds: Number.isFinite(Number(durationValue)) ? Number(durationValue) : undefined,
    status: firstString(call.status, data.status),
    recordingUrl: firstString(call.recording_url, call.recordingUrl, data.recording_url, data.recordingUrl)
  };
}

export class WazoClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        "X-Auth-Token": this.token,
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(`wazo_${response.status}: ${JSON.stringify(data).slice(0,500)}`);
    return data;
  }

  async createTransfer(input: WazoTransferInput): Promise<WazoTransfer> {
    return await this.request("/api/calld/1.0/transfers", {
      method: "POST",
      body: JSON.stringify({
        context: input.context,
        exten: input.exten,
        flow: input.flow,
        initiator_call: input.initiatorCall,
        transferred_call: input.transferredCall,
        timeout: input.timeout ?? 20,
        variables: input.variables ?? {}
      })
    }) as WazoTransfer;
  }

  async completeTransfer(id: string) {
    return await this.request(`/api/calld/1.0/transfers/${encodeURIComponent(id)}/complete`, {method:"PUT"});
  }

  async cancelTransfer(id: string) {
    return await this.request(`/api/calld/1.0/transfers/${encodeURIComponent(id)}`, {method:"DELETE"});
  }

  async listWebhookSubscriptions() {
    return await this.request("/api/webhookd/1.0/subscriptions", {method:"GET"});
  }

  async createWebhookSubscription(subscription: Json) {
    return await this.request("/api/webhookd/1.0/subscriptions", {
      method:"POST",
      body:JSON.stringify(subscription)
    });
  }

  async updateWebhookSubscription(id: string, subscription: Json) {
    return await this.request(`/api/webhookd/1.0/subscriptions/${encodeURIComponent(id)}`, {
      method:"PUT",
      body:JSON.stringify(subscription)
    });
  }

  async createCall(
    source: {user: string; lineId?: number; fromMobile?: boolean},
    destination: {extension: string; context: string; priority?: number},
    variables: Record<string,string> = {}
  ) {
    return await this.request("/api/calld/1.0/calls", {
      method:"POST",
      body:JSON.stringify({
        source: {
          user: source.user,
          ...(source.lineId !== undefined ? {line_id: source.lineId} : {}),
          ...(source.fromMobile !== undefined ? {from_mobile: source.fromMobile} : {})
        },
        destination: {
          extension: destination.extension,
          context: destination.context,
          ...(destination.priority !== undefined ? {priority: destination.priority} : {})
        },
        variables
      })
    });
  }
  async answerCall(callId: string) {
    return await this.request(`/api/calld/1.0/calls/${encodeURIComponent(callId)}/answer`, {method:"PUT"});
  }
}