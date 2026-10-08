import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WhatConverts is disabled by default for the replacement platform", async () => {
  const config = await readFile(new URL("../src/config.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.match(config, /ENABLE_WHATCONVERTS: z\.enum\(\["true","false"\]\)\.default\("false"\)/);
  assert.match(app, /if \(config\.ENABLE_WHATCONVERTS\)\s*\{[\s\S]*registerWhatConvertsRoutes/s);
});

test("OpenAI intelligence default is the current Analog model label", async () => {
  const config = await readFile(new URL("../src/config.ts", import.meta.url), "utf8");
  assert.match(config, /OPENAI_INTELLIGENCE_MODEL: z\.string\(\)\.default\("gpt-5\.6-luna"\)/);
});
