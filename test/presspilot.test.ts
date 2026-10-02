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
