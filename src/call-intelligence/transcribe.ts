import { readFile } from "node:fs/promises";

export type DiarizedSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
};

export type DiarizedTranscript = {
  task: string;
  duration: number;
  text: string;
  segments: DiarizedSegment[];
};

export async function transcribeFile(
  filePath: string,
  apiKey: string,
  model = "gpt-4o-transcribe-diarize"
): Promise<DiarizedTranscript> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "call.mp3");
  form.append("model", model);
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!response.ok) throw new Error(`transcription_failed:${response.status}:${await response.text()}`);
  return (await response.json()) as DiarizedTranscript;
}
