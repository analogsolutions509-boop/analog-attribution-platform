import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { config } from "./config.js";

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm"
};

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  return MIME_EXTENSIONS[normalized] ?? "bin";
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && b >= 18 && b <= 19) ||
    a === 0 || a >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fe80:") || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("ff");
}

export function isSafeRecordingUrl(recordingUrl: string): boolean {
  try {
    const url = new URL(recordingUrl);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") ||
        hostname === "metadata.google.internal") return false;
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) return !isPrivateIpv4(hostname);
    if (ipVersion === 6) return !isPrivateIpv6(hostname);
    return true;
  } catch {
    return false;
  }
}

async function assertSafeResolvedHost(recordingUrl: string): Promise<void> {
  if (!isSafeRecordingUrl(recordingUrl)) throw new Error("unsafe_recording_url");
  const hostname = new URL(recordingUrl).hostname;
  if (isIP(hostname)) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) =>
    isIP(address) === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address))) {
    throw new Error("unsafe_recording_host");
  }
}

async function readResponseWithLimit(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > config.RECORDING_MAX_BYTES) throw new Error("recording_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > config.RECORDING_MAX_BYTES) {
        await reader.cancel();
        throw new Error("recording_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function downloadRecording(
  recordingUrl: string,
  timeoutMs = 20_000
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let currentUrl = recordingUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    await assertSafeResolvedHost(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(currentUrl, { method: "GET", redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) throw new Error("recording_redirect_limit");
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) throw new Error(`recording_download_failed:${response.status}`);
      const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
      return { bytes: await readResponseWithLimit(response), mimeType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("recording_redirect_limit");
}
