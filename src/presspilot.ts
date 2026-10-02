import { config } from "./config.js";
import { db } from "./db.js";
import { decryptSecret, encryptSecret, normalizeWordPressUrl } from "./presspilot-core.js";

type FetchLike = typeof fetch;

export interface PressPilotConnection {
  id: string;
  site_id: string | null;
  base_url: string;
  wp_username: string;
  status: string;
  capabilities: Record<string, unknown>;
  last_verified_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StoredPressPilotConnection extends PressPilotConnection {
  appPassword: string;
}

function authHeader(username: string, appPassword: string): string {
  return "Basic " + Buffer.from(username + ":" + appPassword, "utf8").toString("base64");
}
export class WordPressClient {
  constructor(
    public readonly baseUrl: string,
    private readonly username: string,
    private readonly appPassword: string,
    private readonly fetcher: FetchLike = globalThis.fetch
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(
      this.baseUrl + path,
      {
        ...init,
        headers: {
          Authorization: authHeader(this.username, this.appPassword),
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {})
        }
      }
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error("wordpress_" + response.status + ":" + text.slice(0, 240));
    }
    return text ? JSON.parse(text) as T : undefined as T;
  }

  async verify() {
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/users/me?context=edit");
  }

  async getSite() {
    return this.request<Record<string, unknown>>("/wp-json");
  }

  async listPosts(args: Record<string, unknown>) {
    return this.request<unknown[]>("/wp-json/wp/v2/posts" + queryString(args));
  }

  async listPages(args: Record<string, unknown>) {
    return this.request<unknown[]>("/wp-json/wp/v2/pages" + queryString(args));
  }

  async listPlugins() {
    return this.request<unknown[]>("/wp-json/wp/v2/plugins?per_page=100");
  }
  async searchContent(args: Record<string, unknown>) {
    const search = String(args.search ?? "").trim();
    if (!search) throw new Error("search_required");
    const params = new URLSearchParams({ search, per_page: "20" });
    return this.request<unknown[]>("/wp-json/wp/v2/search?" + params.toString());
  }

  async createPost(args: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/posts", {
      method: "POST",
      body: JSON.stringify(contentPayload(args))
    });
  }

  async updatePost(args: Record<string, unknown>) {
    const id = numericId(args.id);
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/posts/" + id, {
      method: "POST",
      body: JSON.stringify(contentPayload(args))
    });
  }

  async createPage(args: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/pages", {
      method: "POST",
      body: JSON.stringify(pagePayload(args))
    });
  }

  async updatePage(args: Record<string, unknown>) {
    const id = numericId(args.id);
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/pages/" + id, {
      method: "POST",
      body: JSON.stringify(pagePayload(args))
    });
  }

  async getPost(id: number) {
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/posts/" + id);
  }

  async getPage(id: number) {
    return this.request<Record<string, unknown>>("/wp-json/wp/v2/pages/" + id);
  }
}
function numericId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error("wordpress_id_required");
  return id;
}

function queryString(args: Record<string, unknown>): string {
  const allowed = ["search", "status", "slug", "author", "page", "orderby", "order"];
  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = args[key];
    if (value !== undefined && value !== null && String(value) !== "") {
      params.set(key, String(value));
    }
  }
  const perPage = Math.min(Math.max(Number(args.per_page ?? 20) || 20, 1), 20);
  params.set("per_page", String(perPage));
  const encoded = params.toString();
  return encoded ? "?" + encoded : "";
}

function contentPayload(args: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const key of ["title", "content", "status", "slug", "excerpt"]) {
    if (args[key] !== undefined) payload[key] = args[key];
  }
  if (!payload.title && !payload.content && !payload.slug) {
    throw new Error("content_required");
  }
  return payload;
}

function pagePayload(args: Record<string, unknown>) {
  const payload = contentPayload(args);
  if (args.parent !== undefined) payload.parent = numericId(args.parent);
  return payload;
}
export async function getPressPilotConnection(id: string): Promise<StoredPressPilotConnection | null> {
  const result = await db.query(
    "SELECT id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,encrypted_app_password FROM presspilot_connections WHERE id=$1",
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    capabilities: row.capabilities ?? {},
    appPassword: decryptSecret(row.encrypted_app_password, config.ANALOG_SITE_KEY_SECRET)
  };
}

export async function listPressPilotConnections() {
  const result = await db.query(
    "SELECT id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at FROM presspilot_connections ORDER BY created_at DESC"
  );
  return result.rows as PressPilotConnection[];
}
export async function savePressPilotConnection(input: {
  siteId?: string | null;
  baseUrl: string;
  wpUsername: string;
  appPassword: string;
  createdBy?: string | null;
}): Promise<PressPilotConnection> {
  const baseUrl = normalizeWordPressUrl(input.baseUrl);
  const username = input.wpUsername.trim();
  const appPassword = input.appPassword.trim();
  if (!username || !appPassword) throw new Error("wordpress_credentials_required");
  const client = new WordPressClient(baseUrl, username, appPassword);
  const user = await client.verify();
  const siteResult = input.siteId
    ? await db.query("SELECT id FROM sites WHERE id=$1", [input.siteId])
    : await db.query("SELECT id FROM sites WHERE lower(hostname)=lower($1)", [new URL(baseUrl).hostname]);
  const siteId = siteResult.rows[0]?.id ?? null;
  let plugins = false;
  try {
    await client.listPlugins();
    plugins = true;
  } catch {}
  const capabilities = { rest: true, content: true, plugins, user_id: user.id ?? null };
  const encrypted = encryptSecret(appPassword, config.ANALOG_SITE_KEY_SECRET);
  const result = await db.query(
    "INSERT INTO presspilot_connections(site_id,base_url,wp_username,encrypted_app_password,status,capabilities,last_verified_at,last_error,created_by) " +
    "VALUES($1,$2,$3,$4,'verified',$5,NOW(),NULL,$6) " +
    "ON CONFLICT(base_url,wp_username) DO UPDATE SET site_id=EXCLUDED.site_id,encrypted_app_password=EXCLUDED.encrypted_app_password,status='verified',capabilities=EXCLUDED.capabilities,last_verified_at=NOW(),last_error=NULL,updated_at=NOW() " +
    "RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at",
    [siteId, baseUrl, username, encrypted, JSON.stringify(capabilities), input.createdBy ?? null]
  );
  return result.rows[0] as PressPilotConnection;
}
export async function verifyPressPilotConnection(id: string): Promise<PressPilotConnection> {
  const stored = await getPressPilotConnection(id);
  if (!stored) throw new Error("presspilot_connection_not_found");
  try {
    const client = new WordPressClient(stored.base_url, stored.wp_username, stored.appPassword);
    await client.verify();
    await db.query("UPDATE presspilot_connections SET status='verified',last_verified_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1", [id]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "wordpress_verify_failed";
    await db.query("UPDATE presspilot_connections SET status='error',last_error=$2,updated_at=NOW() WHERE id=$1", [id, message.slice(0, 1000)]);
    throw error;
  }
  const refreshed = await getPressPilotConnection(id);
  if (!refreshed) throw new Error("presspilot_connection_not_found");
  return refreshed;
}

export function createWordPressClient(connection: StoredPressPilotConnection): WordPressClient {
  return new WordPressClient(connection.base_url, connection.wp_username, connection.appPassword);
}
