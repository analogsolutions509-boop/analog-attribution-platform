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
  "search_content",
  "elementor_edit_text"
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
          args: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: ["integer", "null"] },
              search: { type: ["string", "null"] },
              status: { type: ["string", "null"] },
              slug: { type: ["string", "null"] },
              author: { type: ["integer", "string", "null"] },
              page: { type: ["integer", "null"] },
              orderby: { type: ["string", "null"] },
              order: { type: ["string", "null"] },
              per_page: { type: ["integer", "null"] },
              title: { type: ["string", "null"] },
              content: { type: ["string", "null"] },
              excerpt: { type: ["string", "null"] },
              widget_type: { type: ["string", "null"] },
              replace_all: { type: ["boolean", "null"] }
            },
            required: ["id", "search", "status", "slug", "author", "page", "orderby", "order", "per_page", "title", "content", "excerpt", "widget_type", "replace_all"]
          }
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
  "For Elementor text or layout requests, use elementor_edit_text when the requested change can be expressed as an exact text replacement inside an Elementor widget.",
  "For requests to put one part of a phrase underneath another part, preserve the wording and insert a <br> at the requested line break.",
  "For an explicitly site-wide/global change, elementor_edit_text may use id=null with replace_all=true; otherwise target the specific discovered page id.",
  "For Elementor text operations, widget_type should be used when the request identifies a heading, paragraph, button, or other widget type.",
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
  const body = await response.json() as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  const outputText = body.output_text ?? body.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();
  if (!outputText) throw new Error("presspilot_planner_missing_output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
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
