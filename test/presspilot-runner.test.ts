import test from "node:test";
import assert from "node:assert/strict";
import { executePressPilotPlan } from "../src/presspilot-runner.js";

test("runner executes allowed operations sequentially and verifies mutations", async () => {
  const calls: string[] = [];
  const client = {
    listPages: async () => [{ id: 42, title: { rendered: "Old" } }],
    updatePage: async () => { calls.push("update"); return { id: 42, title: { rendered: "New" } }; },
    getPage: async () => { calls.push("verify"); return { id: 42, title: { rendered: "New" } }; }
  } as any;
  const result = await executePressPilotPlan(client, {
    operations: [
      { op: "list_pages", args: { search: "Ready Mix" } },
      { op: "update_page", args: { id: 42, title: "New" } }
    ]
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["update", "verify"]);
  assert.equal(result.operations.length, 2);
});

test("runner supports dry-run without writing to WordPress", async () => {
  let writes = 0;
  const client = {
    createPage: async () => { writes++; return { id: 9 }; }
  } as any;
  const result = await executePressPilotPlan(client, {
    operations: [{ op: "create_page", args: { title: "Test", content: "Body" } }]
  }, true);
  assert.equal(result.status, "completed");
  assert.equal(writes, 0);
  assert.equal(result.operations[0].status, "dry_run");
});
