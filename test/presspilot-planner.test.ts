import test from "node:test";
import assert from "node:assert/strict";
import { planPressPilotTask } from "../src/presspilot-planner.js";

test("planner accepts OpenAI structured plans and keeps them within the PressPilot allowlist", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: "Update the Ready Mix page",
        operations: [
          { op: "search_content", args: { search: "Ready Mix" } },
          { op: "update_page", args: { id: 42, title: "Ready Mix Concrete Manchester" } }
        ]
      })
    }), { status: 200 });
  const plan = await planPressPilotTask("Find the Ready Mix page and update its title", "test-key", "gpt-5.6-luna", fetcher);
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations[1].op, "update_page");
});

test("planner reads structured text from the raw Responses API output array", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({ summary: "Read the site", operations: [{ op: "get_site", args: { id: null, search: null, status: null, slug: null, author: null, page: null, orderby: null, order: null, per_page: null, title: null, content: null, excerpt: null } }] })
        }]
      }]
    }), { status: 200 });
  const plan = await planPressPilotTask("Read the site", "test-key", "gpt-6-luna", fetcher);
  assert.equal(plan.operations[0].op, "get_site");
});

test("planner rejects malformed model output", async () => {
  const fetcher = async () => new Response(JSON.stringify({ output_text: "{bad" }), { status: 200 });
  await assert.rejects(
    () => planPressPilotTask("do something", "test-key", "gpt-5.6-luna", fetcher),
    /invalid_plan/
  );
});
