import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalCollectorHostname,
  isAllowedCollectorOrigin,
  parseCollectorHostAllowlist
} from "../src/public-collector.ts";

test("canonicalizes collector hostnames without protocol or trailing dot", () => {
  assert.equal(canonicalCollectorHostname("HTTPS://WWW.Example.Co.UK/"), "www.example.co.uk");
  assert.equal(canonicalCollectorHostname("example.co.uk."), "example.co.uk");
});

test("collector origin must match the registered HTTPS hostname", () => {
  assert.equal(isAllowedCollectorOrigin("https://example.co.uk", "example.co.uk"), true);
  assert.equal(isAllowedCollectorOrigin("https://www.example.co.uk", "example.co.uk"), false);
  assert.equal(isAllowedCollectorOrigin("http://example.co.uk", "example.co.uk"), false);
  assert.equal(isAllowedCollectorOrigin("https://evil.example", "example.co.uk"), false);
  assert.equal(isAllowedCollectorOrigin(undefined, "example.co.uk"), false);
});

test("collector host allowlist accepts exact hosts and ignores blanks", () => {
  assert.deepEqual(
    parseCollectorHostAllowlist("a.co.uk, ,B.co.uk,a.co.uk"),
    ["a.co.uk", "b.co.uk"]
  );
});
