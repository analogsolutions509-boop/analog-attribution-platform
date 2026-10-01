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

export async function downloadRecording(
  recordingUrl: string,
  timeoutMs = 20_000
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(recordingUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`recording_download_failed:${response.status}`);
    }
    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType };
  } finally {
    clearTimeout(timer);
  }
}
