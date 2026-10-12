import test from "node:test";
import assert from "node:assert/strict";
import { registerCollectorRoutes } from "../src/routes/collector.js";

test("collector package download serves a valid plugin ZIP without exposing server files", async () => {
  const routes = new Map<string, (request: unknown, reply: any) => Promise<unknown>>();
  const app = {
    get(route: string, handler: (request: unknown, reply: any) => Promise<unknown>) {
      routes.set(route, handler);
    }
  };
  await registerCollectorRoutes(app as never);

  const handler = routes.get("/v1/downloads/analog-attribution-collector.zip");
  assert.ok(handler, "the public collector ZIP endpoint must be registered");

  const state: { type?: string; headers: Record<string, string>; status?: number; body?: unknown } = {
    headers: {}
  };
  const reply = {
    code(status: number) { state.status = status; return this; },
    type(value: string) { state.type = value; return this; },
    header(name: string, value: string) { state.headers[name.toLowerCase()] = value; return this; },
    send(body: unknown) { state.body = body; return body; }
  };
  await handler({ log: { error() {} } }, reply);

  assert.equal(state.status, undefined);
  assert.equal(state.type, "application/zip");
  assert.equal(state.headers["content-disposition"], 'attachment; filename="analog-attribution-collector.zip"');
  assert.ok(Buffer.isBuffer(state.body));
  const archive = state.body as Buffer;
  assert.equal(archive.readUInt32LE(0), 0x04034b50, "ZIP local-file header signature");
  assert.ok(archive.includes(Buffer.from("analog-attribution-collector/analog-attribution-collector.php")));
  assert.ok(archive.includes(Buffer.from("analog-attribution-collector/assets/collector.js")));
});
