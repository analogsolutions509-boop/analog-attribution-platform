import { createHmac, timingSafeEqual } from "node:crypto";

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

export function verifyWazoWebhook(raw: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const left = Buffer.from(signature.replace(/^sha256=/i, ""), "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeWazoEvent(payload: unknown) {
  const root = bodyRecord(payload);
  const data = bodyRecord(root.data);
  const call = bodyRecord(data.call ?? root.call);
  const event = String(root.event ?? root.event_name ?? data.event ?? "");
  return {
    event,
    providerCallId: String(call.id ?? call.call_id ?? data.call_id ?? root.call_id ?? ""),
    callerNumber: typeof (call.caller_number ?? call.from) === "string"
      ? String(call.caller_number ?? call.from) : undefined,
    calledNumber: typeof (call.called_number ?? call.to) === "string"
      ? String(call.called_number ?? call.to) : undefined,
    direction: typeof call.direction === "string" ? call.direction : undefined,
    startedAt: typeof (call.started_at ?? call.start_time) === "string"
      ? String(call.started_at ?? call.start_time) : undefined,
    endedAt: typeof (call.ended_at ?? call.end_time) === "string"
      ? String(call.ended_at ?? call.end_time) : undefined,
    durationSeconds: Number.isFinite(Number(call.duration ?? call.duration_seconds))
      ? Number(call.duration ?? call.duration_seconds) : undefined,
    recordingUrl: typeof call.recording_url === "string" ? call.recording_url : undefined
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

  async createCall(source: string, destination: string, variables: Record<string,string> = {}) {
    return await this.request("/api/calld/1.0/calls", {
      method:"POST",
      body:JSON.stringify({source_user:source,destination_user:destination,variables})
    });
  }

  async answerCall(callId: string) {
    return await this.request(`/api/calld/1.0/calls/${encodeURIComponent(callId)}/answer`, {method:"PUT"});
  }
}