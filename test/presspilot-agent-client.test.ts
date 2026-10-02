import test from "node:test";
import assert from "node:assert/strict";
import { PressPilotAgentClient } from "../src/presspilot.js";

test("agent client sends bearer token and allowlisted operation payloads", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
  };
  const client = new PressPilotAgentClient(
    "https://example.com/wp-json/presspilot/v1/agent",
    "agent-secret",
    fetcher
  );

  const result = await client.getSite();

  assert.deepEqual(result, { ok: true });
  assert.equal(seen?.url, "https://example.com/wp-json/presspilot/v1/agent");
  const headers = seen?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer agent-secret");
  assert.deepEqual(
    JSON.parse(String(seen?.init?.body)),
    { operation: "get_site", args: {} }
  );
});


test("agent client sends the Elementor text operation with its target arguments", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ result: { changed_documents: 1 } }), { status: 200 });
  };
  const client = new PressPilotAgentClient(
    "https://example.com/wp-json/presspilot/v1/agent",
    "agent-secret",
    fetcher
  );
  const result = await client.elementorEditText({
    id: 1373,
    search: "CALL US NOW +447877310707",
    content: "CALL US NOW<br>+447877310707",
    widget_type: "heading",
    replace_all: true
  });
  assert.deepEqual(result, { changed_documents: 1 });
  assert.deepEqual(JSON.parse(String(seen?.init?.body)), {
    operation: "elementor_edit_text",
    args: {
      id: 1373,
      search: "CALL US NOW +447877310707",
      content: "CALL US NOW<br>+447877310707",
      widget_type: "heading",
      replace_all: true
    }
  });
});
