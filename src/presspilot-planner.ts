import { validatePressPilotPlan, type PressPilotPlan } from "./presspilot-core.js";

type FetchLike = typeof fetch;

const operations = [
  "get_site",
  "list_posts",
  "list_pages",
  "create_post",
  "update_post",
  "create_page",
  "update_page",
  "list_plugins",
  "search_content"
] as const;

export const PRESSPILOT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: operations },
          args: { type: "object", additionalProperties: true }
        },
        required: ["op", "args"]
      }
    }
  },
  required: ["summary", "operations"]
} as const;
const PLANNER_INSTRUCTIONS = [
  "You are PressPilot, a controlled WordPress operations planner.",
  "Convert the user's request into at most five explicit WordPress operations.",
  "Only use the operations in the supplied schema. Never produce code, shell commands, arbitrary HTTP, SQL, credentials, or plugin installation instructions.",
  "Use search_content or list_pages/list_posts when an object ID must be discovered.",
  "For mutations, provide only the fields needed for the requested change.",
  "Keep content concise and preserve existing content unless the user explicitly asks to replace it.",
  "Never invent IDs, URLs, credentials, capabilities, or facts about the site.",
  "When the request cannot be completed with the allowed operations, return the safest useful read/search operations instead."
].join("\n");

export async function planPressPilotTask(
  prompt: string,
  apiKey: string,
  model: string,
  fetcher: FetchLike = globalThis.fetch
): Promise<PressPilotPlan & { summary: string }> {
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: PLANNER_INSTRUCTIONS,
      input: prompt.trim(),
      text: {
        format: {
          type: "json_schema",
          name: "presspilot_plan",
          strict: true,
          schema: PRESSPILOT_PLAN_JSON_SCHEMA
        }
      }
    })
  });
  if (!response.ok) {
    throw new Error("presspilot_planner_failed:" + response.status + ":" + (await response.text()).slice(0, 300));
  }
  const body = await response.json() as { output_text?: string };
  if (!body.output_text) throw new Error("presspilot_planner_missing_output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.output_text);
  } catch {
    throw new Error("invalid_plan");
  }
  const validated = validatePressPilotPlan(parsed);
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { summary?: unknown }).summary !== "string") {
    throw new Error("invalid_plan");
  }
  return {
    ...validated,
    summary: (parsed as { summary: string }).summary.trim() || "PressPilot task"
  };
}
