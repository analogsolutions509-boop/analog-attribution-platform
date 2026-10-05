import {
  createMcpHandler,
  McpServer
} from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { config } from "./config.js";
import {
  PRESSPILOT_READ_SCOPE,
  PRESSPILOT_WRITE_SCOPE,
  buildOAuthChallenge,
  buildPressPilotResourceMetadataUrl,
  hasRequiredScopes
} from "./presspilot-mcp-auth.js";
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

function requiredScopesForTool(name: string): string[] {
  return name === "presspilot_execute_prompt"
    ? [PRESSPILOT_WRITE_SCOPE]
    : [PRESSPILOT_READ_SCOPE];
}

function registerPressPilotTool(
  server: McpServer,
  name: string,
  descriptor: Record<string, unknown>,
  callback: (...args: any[]) => any
) {
  const scopes = requiredScopesForTool(name);
  const securitySchemes = [{ type: "oauth2", scopes }];
  const nextDescriptor = {
    ...descriptor,
    securitySchemes,
    _meta: {
      ...((descriptor._meta as Record<string, unknown> | undefined) ?? {}),
      securitySchemes
    }
  };
  return (server.registerTool as any)(name, nextDescriptor, callback);
}

function requireMcpScopes(
  authInfo: AuthInfo | undefined,
  requiredScopes: string[]
) {
  if (!authInfo) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "oauth_required" }) }],
      _meta: {
        "mcp/www_authenticate": [
          buildOAuthChallenge(
            buildPressPilotResourceMetadataUrl(
              config.PRESSPILOT_OAUTH_AUDIENCE ?? config.PUBLIC_API_URL ?? "https://api-jyu9-production.up.railway.app"
            ),
            requiredScopes,
            "invalid_token",
            "PressPilot authentication is required."
          )
        ]
      },
      isError: true
    };
  }
  if (!hasRequiredScopes(authInfo.scopes, requiredScopes)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "insufficient_scope", required_scopes: requiredScopes }) }],
      _meta: {
        "mcp/www_authenticate": [
          buildOAuthChallenge(
            buildPressPilotResourceMetadataUrl(
              config.PRESSPILOT_OAUTH_AUDIENCE ?? config.PUBLIC_API_URL ?? "https://api-jyu9-production.up.railway.app"
            ),
            requiredScopes,
            "insufficient_scope",
            "The requested PressPilot permission is not granted."
          )
        ]
      },
      isError: true
    };
  }
  return null;
}

function serverFactory() {
  const server = new McpServer({
    name: "presspilot",
    version: "0.2.1"
  });

  registerPressPilotTool(
    server,
    "presspilot_connections",
    {
      title: "List WordPress connections",
      description: "List WordPress sites paired with PressPilot without exposing credentials.",
      inputSchema: z.object({})
    },
    async (_args, ctx) => {
      const authError = requireMcpScopes(ctx.http?.authInfo, [PRESSPILOT_READ_SCOPE]);
      if (authError) return authError;
      return jsonResult({ connections: await listPressPilotConnections() });
    }
  );

  registerPressPilotTool(
    server,
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
    async ({ connection_id, prompt, dry_run }, ctx) => {
      const authError = requireMcpScopes(ctx.http?.authInfo, [PRESSPILOT_WRITE_SCOPE]);
      if (authError) return authError;
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
  registerPressPilotTool(
    server,
    "wordpress_get_site",
    {
      description: "Read the connected WordPress site's REST index.",
      inputSchema: z.object({ connection_id: z.string().uuid() })
    },
    async ({ connection_id }, ctx) => runConnectionTool(connection_id, "get_site", {}, ctx, [PRESSPILOT_READ_SCOPE])
  );

  registerPressPilotTool(
    server,
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
    async ({ connection_id, ...args }, ctx) => runConnectionTool(connection_id, "list_pages", args, ctx, [PRESSPILOT_READ_SCOPE])
  );

  registerPressPilotTool(
    server,
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
    async ({ connection_id, ...args }, ctx) => runConnectionTool(connection_id, "list_posts", args, ctx, [PRESSPILOT_READ_SCOPE])
  );
  registerPressPilotTool(
    server,
    "wordpress_search_content",
    {
      description: "Search WordPress content for a page or post to operate on.",
      inputSchema: z.object({
        connection_id: z.string().uuid(),
        search: z.string().min(1).max(200)
      })
    },
    async ({ connection_id, search }, ctx) => runConnectionTool(connection_id, "search_content", { search }, ctx, [PRESSPILOT_READ_SCOPE])
  );

  registerPressPilotTool(
    server,
    "wordpress_list_plugins",
    {
      description: "List installed WordPress plugins when the connected account has permission.",
      inputSchema: z.object({ connection_id: z.string().uuid() })
    },
    async ({ connection_id }, ctx) => runConnectionTool(connection_id, "list_plugins", {}, ctx, [PRESSPILOT_READ_SCOPE])
  );

  registerPressPilotTool(
    server,
    "presspilot_profile",
    {
      title: "PressPilot profile",
      description: "Return the stable identity for the currently authenticated PressPilot connection.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        id: z.string(),
        email: z.string().optional(),
        name: z.string().optional()
      }),
      _meta: { "openai/profile": true }
    },
    async (_args, ctx) => {
      const profile = ctx.http?.authInfo?.extra ?? {};
      const output = {
        id: typeof profile.sub === "string" ? profile.sub : ctx.http?.authInfo?.clientId ?? "unknown",
        ...(typeof profile.email === "string" ? { email: profile.email } : {}),
        ...(typeof profile.name === "string" ? { name: profile.name } : {})
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output
      };
    }
  );

  return server;
}

async function runConnectionTool(
  connectionId: string,
  op: string,
  args: Record<string, unknown> = {},
  ctx: { http?: { authInfo?: AuthInfo } },
  requiredScopes: string[]
) {
  const authError = requireMcpScopes(ctx.http?.authInfo, requiredScopes);
  if (authError) return authError;

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
