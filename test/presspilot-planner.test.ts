import test from "node:test";
import assert from "node:assert/strict";
import { planPressPilotTask, PRESSPILOT_PLANNER_INSTRUCTIONS } from "../src/presspilot-planner.js";

test("planner accepts OpenAI structured plans and keeps them within the PressPilot allowlist", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({
      output_text: JSON.stringify({
        summary: "Update the Ready Mix page",
        operations: [
          { op: "search_content", args: { id: null, search: "Ready Mix", status: null, slug: null, author: null, page: 1, orderby: null, order: null, per_page: 10, title: null, content: null, excerpt: null, widget_type: null, replace_all: null } },
          { op: "update_page", args: { id: 42, search: null, status: null, slug: null, author: null, page: null, orderby: null, order: null, per_page: null, title: "Ready Mix Concrete Manchester", content: null, excerpt: null, widget_type: null, replace_all: null } }
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
          text: JSON.stringify({ summary: "Read the site", operations: [{ op: "get_site", args: { id: null, search: null, status: null, slug: null, author: null, page: null, orderby: null, order: null, per_page: null, title: null, content: null, excerpt: null, widget_type: null, replace_all: null } }] })
        }]
      }]
    }), { status: 200 });
  const plan = await planPressPilotTask("Read the site", "test-key", "gpt-6-luna", fetcher);
  assert.equal(plan.operations[0].op, "get_site");
});

test("planner prioritizes exact text search over guessed page-title discovery", () => {
  assert.match(PRESSPILOT_PLANNER_INSTRUCTIONS, /Use search_content for distinctive text targets/);
  assert.match(PRESSPILOT_PLANNER_INSTRUCTIONS, /Never infer site-wide or all-pages scope/);
});

test("planner rejects malformed model output", async () => {
  const fetcher = async () => new Response(JSON.stringify({ output_text: "{bad" }), { status: 200 });
  await assert.rejects(
    () => planPressPilotTask("do something", "test-key", "gpt-5.6-luna", fetcher),
    /invalid_plan/
  );
});


test("planner can produce the Elementor text operation for a line-break layout request", async () => {
  const fetcher = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({
      summary: "Put the phone number on the line below CALL US NOW across the matching Elementor headings.",
      operations: [{
        op: "elementor_edit_text",
        args: {
          id: null, search: "CALL US NOW +447877310707",
          status: null, slug: null, author: null, page: null, orderby: null, order: null, per_page: null,
          title: null, content: "CALL US NOW<br>+447877310707", excerpt: null,
          widget_type: "heading", replace_all: true
        }
      }]
    })
  }), { status: 200 });
  const plan = await planPressPilotTask("Put +447877310707 underneath CALL US NOW.", "test-key", "gpt-6-luna", fetcher);
  assert.equal(plan.operations[0].op, "elementor_edit_text");
  assert.equal(plan.operations[0].args.content, "CALL US NOW<br>+447877310707");
  assert.equal(plan.operations[0].args.replace_all, true);
});
