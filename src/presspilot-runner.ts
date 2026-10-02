import type { PressPilotPlan } from "./presspilot-core.js";
import type { WordPressClient } from "./presspilot.js";

type Client = Pick<
  WordPressClient,
  "getSite" | "listPosts" | "listPages" | "createPost" | "updatePost" |
  "createPage" | "updatePage" | "listPlugins" | "searchContent" | "elementorEditText" | "getPost" | "getPage"
>;

export interface PressPilotOperationResult {
  op: string;
  status: "completed" | "dry_run";
  result?: unknown;
  verification?: unknown;
}

export interface PressPilotRunResult {
  status: "completed";
  operations: PressPilotOperationResult[];
}

const MUTATIONS = new Set(["create_post","update_post","create_page","update_page","elementor_edit_text"]);

function mutationId(op: string, result: unknown, args: Record<string, unknown>): number | null {
  const candidate = args.id ?? (result && typeof result === "object" ? (result as Record<string, unknown>).id : null);
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 ? id : null;
}
export async function executePressPilotPlan(
  client: Client,
  plan: PressPilotPlan,
  dryRun = false
): Promise<PressPilotRunResult> {
  const operations: PressPilotOperationResult[] = [];
  for (const operation of plan.operations) {
    if (dryRun && MUTATIONS.has(operation.op)) {
      operations.push({ op: operation.op, status: "dry_run" });
      continue;
    }

    const args = operation.args;
    let result: unknown;
    switch (operation.op) {
      case "get_site": result = await client.getSite(); break;
      case "list_posts": result = await client.listPosts(args); break;
      case "list_pages": result = await client.listPages(args); break;
      case "create_post": result = await client.createPost(args); break;
      case "update_post": result = await client.updatePost(args); break;
      case "create_page": result = await client.createPage(args); break;
      case "update_page": result = await client.updatePage(args); break;
      case "list_plugins": result = await client.listPlugins(); break;
      case "search_content": result = await client.searchContent(args); break;
      case "elementor_edit_text": result = await client.elementorEditText(args); break;
    }

    const item: PressPilotOperationResult = { op: operation.op, status: "completed", result };
    if (MUTATIONS.has(operation.op)) {
      const id = mutationId(operation.op, result, args);
      if (operation.op === "elementor_edit_text") {
        const verification = result && typeof result === "object"
          ? (result as Record<string, unknown>).verification
          : undefined;
        if (verification !== undefined) item.verification = verification;
      } else if (id !== null) {
        item.verification = operation.op.includes("post")
          ? await client.getPost(id)
          : await client.getPage(id);
      }
    }
    operations.push(item);
  }

  return { status: "completed", operations };
}
