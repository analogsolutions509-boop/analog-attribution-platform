import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { db } from "../src/db.ts";
import { redis } from "../src/queue.ts";
import { registerSecondRingRoutes } from "../src/routes/secondring.ts";

test("accepts and queues a supplied recording when a call has no matching website number", async () => {
  const originalQuery = db.query;
  const originalLpush = redis.lpush;
  const sqlSeen: string[] = [];
  const insertedCallValues: unknown[][] = [];
  let queuedCallProcessing = false;
  const callId = "a0c0a0c0-1111-4222-8333-a0c0a0c0a0c0";

  db.query = (async (query: unknown, values?: unknown[]) => {
    const sql = typeof query === "string"
      ? query
      : String((query as { text?: string })?.text ?? "");
    sqlSeen.push(sql);

    if (sql.includes("FROM tracking_numbers tn")) {
      return { rows: [], rowCount: 0 } as never;
    }
    if (sql.includes("INSERT INTO calls(")) {
      insertedCallValues.push(values ?? []);
      return { rows: [{ id: callId }], rowCount: 1 } as never;
    }
    if (sql.includes("INSERT INTO analog_os_outbox")) {
      return { rows: [{ id: "b0b0b0b0-1111-4222-8333-b0b0b0b0b0b0" }], rowCount: 1 } as never;
    }
    if (sql.includes("INSERT INTO jobs")) {
      if (String(values?.[0]) === "call.process") queuedCallProcessing = true;
      return { rows: [{ id: "c0c0c0c0-1111-4222-8333-c0c0c0c0c0c0" }], rowCount: 1 } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof db.query;

  redis.lpush = (async () => 1) as typeof redis.lpush;

  const app = Fastify();
  try {
    await registerSecondRingRoutes(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/providers/secondring/webhook",
      headers: {
        "x-analog-provider-secret": process.env.ANALOG_PROVIDER_WEBHOOK_SECRET!
      },
      payload: {
        id: "secondring-unattributed-call-1",
        from: "+447700900123",
        to: "+447877310707",
        started_at: "2026-10-14T10:00:00.000Z",
        duration: 44,
        recording_url: "https://recordings.example.com/unattributed-call.mp3",
        recording_mime_type: "audio/mpeg"
      }
    });

    assert.equal(response.statusCode, 202, response.body);
    const body = response.json();
    assert.equal(body.ok, true);
    assert.equal(body.site_id, null);
    assert.equal(body.attribution_status, "unattributed");
    assert.equal(body.recording_received, true);
    assert.equal(insertedCallValues.length, 1);
    assert.equal(insertedCallValues[0]?.[0], null, "call is saved without a fabricated website attribution");
    assert.equal(queuedCallProcessing, true, "the recording is queued for archive and AI processing");
    assert.equal(sqlSeen.some(sql => sql.includes("INSERT INTO calls(")), true);
  } finally {
    await app.close();
    db.query = originalQuery;
    redis.lpush = originalLpush;
    redis.disconnect();
  }
});

test("dashboard and worker retain unattributed calls without inventing a website", async () => {
  const { readFile } = await import("node:fs/promises");
  const dashboard = await readFile(new URL("../src/routes/dashboard.ts", import.meta.url), "utf8");
  assert.ok((dashboard.match(/FROM calls c LEFT JOIN sites s ON s.id=c.site_id/g) ?? []).length >= 3,
    "call list, recording library and call detail must retain calls with no site");
  assert.match(dashboard, /COALESCE\(s\.name,'Unattributed \/ Shared Line'\) AS site_name/);
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /if \(call\.site_id && String\(call\.direction/);
  const migrationSql = await readFile(new URL("../migrations/023_unattributed_call_capture.sql", import.meta.url), "utf8");
  assert.match(migrationSql, /ALTER TABLE calls ALTER COLUMN site_id DROP NOT NULL/);
});
