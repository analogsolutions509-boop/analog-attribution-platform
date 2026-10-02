import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { executePressPilotPlan } from "../presspilot-runner.js";
import { planPressPilotTask } from "../presspilot-planner.js";
import {
  createWordPressClient,
  createPressPilotPairing,
  claimPressPilotPairing,
  getPressPilotConnection,
  getPressPilotExecutor,
  listPressPilotConnections,
  savePressPilotConnection,
  verifyPressPilotConnection
} from "../presspilot.js";
import { requireDashboard } from "./dashboard.js";
import { pressPilotMcpNodeHandler } from "../presspilot-mcp.js";

const UI_ROOT = join(process.cwd(), "public");

function publicConnection(connection: Awaited<ReturnType<typeof listPressPilotConnections>>[number]) {
  return {
    ...connection,
    capabilities: connection.capabilities ?? {}
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validMcpToken(header: string | undefined): boolean {
  const expected = config.PRESSPILOT_MCP_TOKEN;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const target = Buffer.from(expected, "utf8");
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}
export async function registerPressPilotRoutes(app: FastifyInstance) {
  app.all("/mcp", async (request, reply) => {
    if (!config.PRESSPILOT_MCP_TOKEN) {
      return reply.code(503).send({ error: "presspilot_mcp_not_configured" });
    }
    if (!validMcpToken(request.headers.authorization)) {
      return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "unauthorized" });
    }
    return pressPilotMcpNodeHandler(request.raw, reply.raw, request.body);
  });

  app.get("/presspilot", async (_request, reply) => {
    const html = await readFile(join(UI_ROOT, "presspilot.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/v1/presspilot/connections", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const connections = await listPressPilotConnections();
    return reply.send({ connections: connections.map(publicConnection) });
  });

  app.post("/v1/presspilot/pairings", async (request, reply) => {
    const username = await requireDashboard(app, request, reply);
    if (!username) return;
    try {
      return reply.code(201).send(await createPressPilotPairing(username));
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "pairing_create_failed" });
    }
  });

  app.post("/v1/presspilot/pair", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = asString(body.code);
    const siteUrl = asString(body.site_url);
    if (!code || !siteUrl) return reply.code(400).send({ error: "code_site_url_required" });
    try {
      const result = await claimPressPilotPairing({
        code,
        siteUrl,
        agentName: asString(body.agent_name) || undefined,
        agentVersion: asString(body.agent_version) || undefined
      });
      return reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "pairing_claim_failed";
      return reply.code(400).send({ error: message.split(":")[0] });
    }
  });

  app.post("/v1/presspilot/onboard-agent", async (request, reply) => {
    const username = await requireDashboard(app, request, reply);
    if (!username) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const siteUrl = asString(body.site_url);
    if (!siteUrl) return reply.code(400).send({ error: "site_url_required" });

    try {
      const normalized = new URL(siteUrl).origin;
      if (new URL(normalized).protocol !== "https:") {
        return reply.code(400).send({ error: "https_required_for_agent" });
      }

      const pairing = await createPressPilotPairing(username);
      const apiBase = (config.PUBLIC_API_URL ?? ("https://" + (request.headers.host ?? ""))).replace(/\/$/, "");
      if (!apiBase.startsWith("https://")) {
        return reply.code(500).send({ error: "presspilot_public_api_url_required" });
      }

      const response = await fetch(normalized + "/wp-json/presspilot/v1/pair", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          code: pairing.code,
          site_url: normalized,
          api_base_url: apiBase
        })
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : "agent_pair_http_" + response.status;
        return reply.code(502).send({ error: message.split(":")[0] });
      }

      const connectionId = typeof data.connection_id === "string" ? data.connection_id : "";
      const connection = connectionId ? await getPressPilotConnection(connectionId) : null;
      return reply.code(201).send({
        paired: true,
        site_url: normalized,
        connection: connection ? publicConnection(connection) : null,
        agent: { name: "presspilot-agent", version: data.agent_version ?? null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent_onboarding_failed";
      return reply.code(502).send({ error: message.split(":")[0] });
    }
  });

  app.post("/v1/presspilot/connections", async (request, reply) => {
    const username = await requireDashboard(app, request, reply);
    if (!username) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const baseUrl = asString(body.base_url);
    const wpUsername = asString(body.wp_username);
    const appPassword = asString(body.app_password);
    const siteId = asString(body.site_id) || null;
    if (!baseUrl || !wpUsername || !appPassword) {
      return reply.code(400).send({ error: "base_url_wp_username_app_password_required" });
    }
    try {
      const connection = await savePressPilotConnection({
        baseUrl, wpUsername, appPassword, siteId, createdBy: username
      });
      return reply.code(201).send({ connection: publicConnection(connection) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "presspilot_connection_failed";
      return reply.code(400).send({ error: message.split(":")[0] });
    }
  });

  app.post<{ Params: { id: string } }>("/v1/presspilot/connections/:id/verify", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    try {
      const connection = await verifyPressPilotConnection(request.params.id);
      return reply.send({ connection: publicConnection(connection) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "wordpress_verify_failed";
      return reply.code(400).send({ error: message.split(":")[0] });
    }
  });
  app.post("/v1/presspilot/execute", async (request, reply) => {
    const username = await requireDashboard(app, request, reply);
    if (!username) return;
    if (!config.OPENAI_API_KEY) {
      return reply.code(503).send({ error: "openai_not_configured" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const connectionId = asString(body.connection_id);
    const prompt = asString(body.prompt);
    const dryRun = body.dry_run === true;
    if (!connectionId || !prompt) {
      return reply.code(400).send({ error: "connection_id_prompt_required" });
    }

    const connection = await getPressPilotConnection(connectionId);
    if (!connection) return reply.code(404).send({ error: "presspilot_connection_not_found" });

    const run = await db.query(
      "INSERT INTO presspilot_runs(connection_id,created_by,prompt,status,started_at) VALUES($1,$2,$3,'planning',NOW()) RETURNING id",
      [connectionId, username, prompt]
    );
    const runId = run.rows[0].id as string;

    try {
      const plan = await planPressPilotTask(
        prompt,
        config.OPENAI_API_KEY,
        config.OPENAI_INTELLIGENCE_MODEL
      );
      await db.query(
        "UPDATE presspilot_runs SET status='running',plan=$2 WHERE id=$1",
        [runId, JSON.stringify(plan)]
      );

      const client = await getPressPilotExecutor(connectionId);
      const result = await executePressPilotPlan(client, plan, dryRun);
      await db.query(
        "UPDATE presspilot_runs SET status='completed',results=$2,completed_at=NOW() WHERE id=$1",
        [runId, JSON.stringify(result)]
      );
      return reply.send({
        run_id: runId,
        prompt,
        dry_run: dryRun,
        plan,
        result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "presspilot_execution_failed";
      await db.query(
        "UPDATE presspilot_runs SET status='failed',error=$2,completed_at=NOW() WHERE id=$1",
        [runId, message.slice(0, 2000)]
      );
      return reply.code(502).send({ run_id: runId, error: message.split(":")[0] });
    }
  });
  app.get<{ Params: { id: string } }>("/v1/presspilot/runs/:id", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const result = await db.query(
      "SELECT id,connection_id,created_by,prompt,status,plan,results,error,created_at,started_at,completed_at FROM presspilot_runs WHERE id=$1",
      [request.params.id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "presspilot_run_not_found" });
    return reply.send({ run: result.rows[0] });
  });

  app.get("/v1/presspilot/runs", async (request, reply) => {
    if (!(await requireDashboard(app, request, reply))) return;
    const q = request.query as { connection_id?: string };
    const params: unknown[] = [];
    let where = "";
    if (q.connection_id) {
      params.push(q.connection_id);
      where = "WHERE connection_id=$1";
    }
    const result = await db.query(
      "SELECT id,connection_id,prompt,status,created_at,completed_at FROM presspilot_runs " +
      where + " ORDER BY created_at DESC LIMIT 50",
      params
    );
    return reply.send({ runs: result.rows });
  });
}
