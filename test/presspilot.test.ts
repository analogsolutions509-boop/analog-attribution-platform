import test from "node:test";
import assert from "node:assert/strict";
import { WordPressClient } from "../src/presspilot.js";

test("WordPress client uses application-password basic auth and the v2 endpoint", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ id: 7, name: "Analog" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const client = new WordPressClient("https://example.com", "admin", "abcd efgh", fetcher);
  await client.verify();
  assert.equal(seen?.url, "https://example.com/wp-json/wp/v2/users/me?context=edit");
  assert.equal(seen?.init?.headers && (seen.init.headers as Record<string,string>).Authorization, "Basic " + Buffer.from("admin:abcd efgh").toString("base64"));
});

test("WordPress client bounds list requests and sends JSON mutations", async () => {
  const requests: string[] = [];
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    requests.push(String(url) + " " + (init?.method ?? "GET"));
    return new Response(JSON.stringify({ id: 42, title: { rendered: "Updated" } }), { status: 200 });
  };
  const client = new WordPressClient("https://example.com", "admin", "secret", fetcher);
  await client.listPages({ search: "mix", per_page: 999 });
  await client.updatePage({ id: 42, title: "Updated", content: "Body", parent: 5 });
  assert.match(requests[0], /per_page=20/);
  assert.equal(requests[1], "https://example.com/wp-json/wp/v2/pages/42 POST");
});


test("PressPilot agent rotate request sends the old bearer token and proposed replacement", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ rotated: true }), { status: 200 });
  };
  const { PressPilotAgentClient } = await import("../src/presspilot.js");
  const client = new PressPilotAgentClient("https://example.com/wp-json/presspilot/v1/agent", "old-token", fetcher);
  const result = await client.rotateToken("new-token");
  assert.deepEqual(result, { rotated: true });
  assert.equal(seen?.url, "https://example.com/wp-json/presspilot/v1/rotate");
  assert.equal((seen?.init?.headers as Record<string,string>).Authorization, "Bearer old-token");
  assert.deepEqual(JSON.parse(String(seen?.init?.body)), { new_token: "new-token" });
});

test("PressPilot agent revoke request uses the current bearer token", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ revoked: true }), { status: 200 });
  };
  const { PressPilotAgentClient } = await import("../src/presspilot.js");
  const client = new PressPilotAgentClient("https://example.com/wp-json/presspilot/v1/agent", "current-token", fetcher);
  const result = await client.revokeToken();
  assert.deepEqual(result, { revoked: true });
  assert.equal(seen?.url, "https://example.com/wp-json/presspilot/v1/revoke");
  assert.equal((seen?.init?.headers as Record<string,string>).Authorization, "Bearer current-token");
});
