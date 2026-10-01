import test from "node:test";
import assert from "node:assert/strict";
import { eventSchema } from "../src/event-schema.ts";

test("accepts a valid collector event", () => {
  const result = eventSchema.safeParse({
    event_key: "session-123-page-1",
    event_name: "page_view",
    occurred_at: new Date().toISOString(),
    visitor_key: "visitor-1",
    session_key: "session-1",
    page_url: "https://oldhamreadymixconcrete.co.uk/ready-mix-concrete/",
    page_path: "/ready-mix-concrete/",
    payload: { device: "mobile" }
  });
  assert.equal(result.success, true);
});

test("rejects unsafe event names", () => {
  const result = eventSchema.safeParse({
    event_key: "x",
    event_name: "Page View!",
    occurred_at: new Date().toISOString(),
    visitor_key: "v",
    session_key: "s",
    payload: {}
  });
  assert.equal(result.success, false);
});

test("requires visitor and session identity", () => {
  const result = eventSchema.safeParse({
    event_key: "x",
    event_name: "page_view",
    occurred_at: new Date().toISOString(),
    payload: {}
  });
  assert.equal(result.success, false);
});
