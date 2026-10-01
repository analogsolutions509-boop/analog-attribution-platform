import { callIntelligenceSchema } from "./schema.js";
import { CALL_INTELLIGENCE_INSTRUCTIONS } from "./prompt.js";

export async function analyzeTranscript(
  transcript: string,
  apiKey: string,
  model = "gpt-5.6-luna"
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: CALL_INTELLIGENCE_INSTRUCTIONS,
      input: transcript,
      text: {
        format: {
          type: "json_schema",
          name: "analog_call_intelligence",
          description: "Structured call intelligence extracted only from the supplied transcript.",
          strict: true,
          schema: callIntelligenceSchema
        }
      }
    })
  });
  if (!response.ok) throw new Error(`intelligence_failed:${response.status}:${await response.text()}`);
  const body = (await response.json()) as { output_text?: string };
  if (!body.output_text) throw new Error("intelligence_missing_output");
  return JSON.parse(body.output_text);
}
