import { readFile } from "node:fs/promises";
import { config } from "../config.js";

export type DiarizedSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
};

export type DiarizedTranscript = {
  provider: string;
  model: string;
  duration: number;
  text: string;
  segments: DiarizedSegment[];
};

type DeepgramResponse = {
  metadata?: { duration?: number; model_info?: Record<string, { name?: string }> };
  results?: {
    utterances?: Array<{
      id?: string;
      start: number;
      end: number;
      transcript: string;
      speaker: number;
    }>;
    channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };
};

async function transcribeWithDeepgram(
  bytes: Uint8Array,
  mimeType: string
): Promise<DiarizedTranscript> {
  if (!config.DEEPGRAM_API_KEY) throw new Error("deepgram_not_configured");
  const url =
    "https://api.deepgram.com/v1/listen" +
    `?model=${encodeURIComponent(config.DEEPGRAM_MODEL)}` +
    `&diarize_model=${encodeURIComponent(config.DEEPGRAM_DIARIZE_MODEL)}` +
    "&utterances=true&punctuate=true";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${config.DEEPGRAM_API_KEY}`,
      "Content-Type": mimeType
    },
    body: Buffer.from(bytes)
  });
  if (!response.ok) {
    throw new Error(`deepgram_transcription_failed:${response.status}`);
  }

  const body = (await response.json()) as DeepgramResponse;
  const utterances = body.results?.utterances ?? [];
  const text = utterances.map((u) => u.transcript).join(" ").trim();

  return {
    provider: "deepgram",
    model: config.DEEPGRAM_MODEL,
    duration: body.metadata?.duration ?? (utterances.at(-1)?.end ?? 0),
    text,
    segments: utterances.map((u, index) => ({
      id: u.id ?? `dg-${index}`,
      start: u.start,
      end: u.end,
      text: u.transcript,
      speaker: `speaker_${u.speaker}`
    }))
  };
}

async function transcribeWithOpenAI(
  bytes: Uint8Array,
  mimeType: string
): Promise<DiarizedTranscript> {
  if (!config.OPENAI_API_KEY) throw new Error("openai_not_configured");
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(bytes)], { type: mimeType }), "call.audio");
  form.append("model", config.OPENAI_TRANSCRIPTION_MODEL);
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`openai_transcription_failed:${response.status}`);
  }

  const body = (await response.json()) as { text?: string; duration?: number };
  const text = body.text ?? "";
  return {
    provider: "openai",
    model: config.OPENAI_TRANSCRIPTION_MODEL,
    duration: body.duration ?? 0,
    text,
    segments: text
      ? [{ id: "openai-0", start: 0, end: body.duration ?? 0, text, speaker: "unknown" }]
      : []
  };
}

export async function transcribeBytes(
  bytes: Uint8Array,
  mimeType = "audio/mpeg"
): Promise<DiarizedTranscript> {

  if (config.TRANSCRIPTION_PROVIDER === "deepgram") {
    try {
      return await transcribeWithDeepgram(bytes, mimeType);
    } catch (error) {
      if (!config.OPENAI_API_KEY) throw error;
      return transcribeWithOpenAI(bytes, mimeType);
    }
  }

  return transcribeWithOpenAI(bytes, mimeType);
}

export async function transcribeFile(
  filePath: string,
  mimeType = "audio/mpeg"
): Promise<DiarizedTranscript> {
  return transcribeBytes(await readFile(filePath), mimeType);
}
