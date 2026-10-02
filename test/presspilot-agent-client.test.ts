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
