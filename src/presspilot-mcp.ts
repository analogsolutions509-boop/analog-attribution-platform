import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { config } from "./config.js";
import {
  getPressPilotConnection,
  getPressPilotExecutor,
  listPressPilotConnections
} from "./presspilot.js";
import { executePressPilotPlan } from "./presspilot-runner.js";
import { planPressPilotTask } from "./presspilot-planner.js";

function jsonResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function serverFactory() {
  const server = new McpServer({
    name: "presspilot",
    version: "0.1.0"
  });

  server.registerTool(
    "presspilot_connections",
    {
      title: "List WordPress connections",
      description: "List WordPress sites paired with PressPilot without exposing credentials.",
      inputSchema: z.object({})
    },
    async () => jsonResult({ connections: await listPressPilotConnections() })
  );

  server.registerTool(
    "presspilot_execute_prompt",
    {
      title: "Execute a WordPress task",
      description: "Plan and execute a natural-language WordPress task using only PressPilot allowlisted tools.",
      inputSchema: z.object({
        connection_id: z.string().uuid(),
        prompt: z.string().min(1).max(8000),
        dry_run: z.boolean().optional()
      })
    },
    async ({ connection_id, prompt, dry_run }) => {
      if (!config.OPENAI_API_KEY) return jsonResult({ error: "openai_not_configured" }, true);
      const connection = await getPressPilotConnection(connection_id);
      if (!connection) return jsonResult({ error: "presspilot_connection_not_found" }, true);
      try {
        const plan = await planPressPilotTask(
          prompt,
          config.OPENAI_API_KEY,
          config.OPENAI_INTELLIGENCE_MODEL
        );
        const result = await executePressPilotPlan(
          await getPressPilotExecutor(connection_id),
          plan,
          dry_run === true
        );
        return jsonResult({ connection_id, prompt, dry_run: dry_run === true, plan, result });
      } catch (error) {
        return jsonResult({
          error: error instanceof Error ? error.message.split(":")[0] : "presspilot_execution_failed"
        }, true);
      }
    }
  );
  server.registerTool(
    "wordpress_get_site",
    {
      description: "Read the connected WordPress site's REST index.",
      inputSchema: z.object({ connection_id: z.string().uuid() })
    },
    async ({ connection_id }) => runConnectionTool(connection_id, "get_site")
  );

  server.registerTool(
    "wordpress_list_pages",
    {
      description: "List WordPress pages with optional search, status, slug and ordering.",
      inputSchema: z.object({
        connection_id: z.string().uuid(),
        search: z.string().optional(),
        status: z.string().optional(),
        per_page: z.number().int().min(1).max(20).optional()
      })
    },
    async ({ connection_id, ...args }) => runConnectionTool(connection_id, "list_pages", args)
  );

  server.registerTool(
    "wordpress_list_posts",
    {
      description: "List WordPress posts with optional search, status, slug and ordering.",
      inputSchema: z.object({
        connection_id: z.string().uuid(),
        search: z.string().optional(),
        status: z.string().optional(),
        per_page: z.number().int().min(1).max(20).optional()
      })
    },
    async ({ connection_id, ...args }) => runConnectionTool(connection_id, "list_posts", args)
  );
  server.registerTool(
    "wordpress_search_content",
    {
      description: "Search WordPress content for a page or post to operate on.",
      inputSchema: z.object({
        connection_id: z.string().uuid(),
        search: z.string().min(1).max(200)
      })
    },
    async ({ connection_id, search }) => runConnectionTool(connection_id, "search_content", { search })
  );

  server.registerTool(
    "wordpress_list_plugins",
    {
      description: "List installed WordPress plugins when the connected account has permission.",
      inputSchema: z.object({ connection_id: z.string().uuid() })
    },
    async ({ connection_id }) => runConnectionTool(connection_id, "list_plugins")
  );

  return server;
}

async function runConnectionTool(
  connectionId: string,
  op: string,
  args: Record<string, unknown> = {}
) {
  const connection = await getPressPilotConnection(connectionId);
  if (!connection) return jsonResult({ error: "presspilot_connection_not_found" }, true);
  try {
    const result = await executePressPilotPlan(
      await getPressPilotExecutor(connectionId),
      { operations: [{ op: op as never, args }] }
    );
    return jsonResult(result);
  } catch (error) {
    return jsonResult({
      error: error instanceof Error ? error.message.split(":")[0] : "wordpress_operation_failed"
    }, true);
  }
}

const handler = createMcpHandler(() => serverFactory(), { legacy: "stateless" });
export const pressPilotMcpNodeHandler = toNodeHandler(handler);
