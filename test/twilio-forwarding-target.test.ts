import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveTwilioOperatorTarget } from "../src/providers/twilio-routing.ts";

test("prefers the active per-site forwarding number over the global operator number", () => {
  assert.equal(
    resolveTwilioOperatorTarget("+442071234567", "+447700900123"),
    "+442071234567"
  );
});

test("uses the configured global operator number when a site has no forwarding target", () => {
  assert.equal(
    resolveTwilioOperatorTarget(undefined, "+447700900123"),
    "+447700900123"
  );
});

test("returns null when neither a per-site nor global operator number exists", () => {
  assert.equal(resolveTwilioOperatorTarget(null, undefined), null);
});

test("the incoming Twilio handler resolves the forwarding target for the current call", async () => {
  const source = await readFile(new URL("../src/routes/twilio.ts", import.meta.url), "utf8");
  assert.match(source, /resolveTwilioOperatorTarget/);
  assert.match(source, /LEFT JOIN forwarding_numbers fn ON fn\.id=tn\.forwarding_number_id AND fn\.active/);
  assert.match(source, /startOperatorCall\([^\n]*operatorTarget/);
  assert.match(source, /if \(operatorTarget\) \{/);
});
