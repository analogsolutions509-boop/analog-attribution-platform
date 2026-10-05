import { config } from "./config.js";
import { db } from "./db.js";
import { decryptSecret, encryptSecret, generateAgentToken, generatePairingCode, generateEnrollmentToken, hashAgentToken, hashPairingCode, hashEnrollmentToken, isPairingCodeFormatValid, normalizeWordPressUrl } from "./presspilot-core.js";

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
  connection_mode: "rest" | "agent";
  agent_endpoint: string | null;
  agent_version: string | null;
  agent_last_seen_at: string | null;
}

export interface StoredPressPilotConnection extends PressPilotConnection {
  appPassword: string;
  agentToken: string | null;
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

  async elementorEditText(args: Record<string, unknown>) {
    const id = numericId(args.id);
    const find = String(args.search ?? "").trim();
    const replace = String(args.content ?? "");
    if (!find) throw new Error("elementor_text_search_required");
    return this.request<Record<string, unknown>>("/wp-json/wpvibe/v1/content/edit", {
      method: "POST",
      body: JSON.stringify({
        target_type: "meta", post_id: id, meta_key: "_elementor_data",
        old_content: find, new_content: replace, replace_all: args.replace_all === true
      })
    });
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
    "SELECT id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at,encrypted_app_password,encrypted_agent_token FROM presspilot_connections WHERE id=$1",
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  const isAgent = row.connection_mode === "agent";
  return {
    ...row,
    capabilities: row.capabilities ?? {},
    appPassword: isAgent ? "" : decryptSecret(row.encrypted_app_password, config.ANALOG_SITE_KEY_SECRET),
    agentToken: isAgent && row.encrypted_agent_token
      ? decryptSecret(row.encrypted_agent_token, config.ANALOG_SITE_KEY_SECRET)
      : null
  };
}

export async function listPressPilotConnections() {
  const result = await db.query(
    "SELECT id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at FROM presspilot_connections ORDER BY created_at DESC"
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
    "RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at",
    [siteId, baseUrl, username, encrypted, JSON.stringify(capabilities), input.createdBy ?? null]
  );
  return result.rows[0] as PressPilotConnection;
}
export async function verifyPressPilotConnection(id: string): Promise<PressPilotConnection> {
  const stored = await getPressPilotConnection(id);
  if (!stored) throw new Error("presspilot_connection_not_found");
  try {
    const client = stored.connection_mode === "agent"
      ? new PressPilotAgentClient(stored.agent_endpoint!, stored.agentToken!)
      : new WordPressClient(stored.base_url, stored.wp_username, stored.appPassword);
    await client.verify();
    await db.query("UPDATE presspilot_connections SET status='verified',last_verified_at=NOW(),last_error=NULL,agent_last_seen_at=CASE WHEN connection_mode='agent' THEN NOW() ELSE agent_last_seen_at END,updated_at=NOW() WHERE id=$1", [id]);
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
export class PressPilotAgentClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetcher: FetchLike = globalThis.fetch
  ) {}

  private async request<T>(url: string, body: unknown): Promise<T> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) throw new Error("presspilot_agent_" + response.status + ":" + text.slice(0, 240));
    const parsed = text ? JSON.parse(text) as { result?: T; error?: string; rotated?: boolean; revoked?: boolean } : {};
    if (parsed.error) throw new Error("presspilot_agent:" + parsed.error);
    return parsed.result !== undefined ? parsed.result as T : parsed as T;
  }

  private async call<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>(this.endpoint, { operation, args });
  }

  async verify() { return this.call<Record<string, unknown>>("get_site"); }
  async getSite() { return this.call<Record<string, unknown>>("get_site"); }
  async listPosts(args: Record<string, unknown>) { return this.call<unknown[]>("list_posts", args); }
  async listPages(args: Record<string, unknown>) { return this.call<unknown[]>("list_pages", args); }
  async listPlugins() { return this.call<unknown[]>("list_plugins"); }
  async searchContent(args: Record<string, unknown>) { return this.call<unknown[]>("search_content", args); }
  async elementorEditText(args: Record<string, unknown>) { return this.call<Record<string, unknown>>("elementor_edit_text", args); }

async createPost(args: Record<string, unknown>) {
    return this.call<Record<string, unknown>>("create_post", args);
  }
  async updatePost(args: Record<string, unknown>) {
    return this.call<Record<string, unknown>>("update_post", args);
  }
  async createPage(args: Record<string, unknown>) {
    return this.call<Record<string, unknown>>("create_page", args);
  }
  async updatePage(args: Record<string, unknown>) {
    return this.call<Record<string, unknown>>("update_page", args);
  }
  async rotateToken(newToken: string) {
    if (!newToken.trim()) throw new Error("new_agent_token_required");
    return this.request<Record<string, unknown>>(this.endpoint.replace(/\/agent$/, "/rotate"), { new_token: newToken });
  }
  async revokeToken() {
    return this.request<Record<string, unknown>>(this.endpoint.replace(/\/agent$/, "/revoke"), {});
  }
  async getPost(id: number) {
    return this.call<Record<string, unknown>>("get_post", { id });
  }
  async getPage(id: number) {
    return this.call<Record<string, unknown>>("get_page", { id });
  }
}

export async function createPressPilotPairing(createdBy?: string | null) {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const result = await db.query(
    "INSERT INTO presspilot_pairings(code_hash,created_by,expires_at) VALUES($1,$2,$3) RETURNING id,expires_at,created_at",
    [hashPairingCode(code, config.ANALOG_SITE_KEY_SECRET), createdBy ?? null, expiresAt]
  );
  return { id: result.rows[0].id as string, code, expires_at: result.rows[0].expires_at, created_at: result.rows[0].created_at };
}

export async function claimPressPilotPairing(input: {
  code: string;
  siteUrl: string;
  agentName?: string;
  agentVersion?: string;
}) {
  const code = input.code.trim().toUpperCase();
  if (!isPairingCodeFormatValid(code)) throw new Error("invalid_pairing_code");
  const baseUrl = normalizeWordPressUrl(input.siteUrl);
  if (new URL(baseUrl).protocol !== "https:") throw new Error("https_required_for_agent");
  const token = generateAgentToken();
  const tokenHash = hashAgentToken(token, config.ANALOG_SITE_KEY_SECRET);
  const encryptedAgentToken = encryptSecret(token, config.ANALOG_SITE_KEY_SECRET);
  const endpoint = baseUrl + "/wp-json/presspilot/v1/agent";

  await db.query("BEGIN");
  try {
    const pairing = await db.query(
      "SELECT id,created_by FROM presspilot_pairings WHERE code_hash=$1 AND claimed_at IS NULL AND expires_at>NOW() FOR UPDATE",
      [hashPairingCode(code, config.ANALOG_SITE_KEY_SECRET)]
    );
    const row = pairing.rows[0];
    if (!row) throw new Error("pairing_code_expired_or_invalid");

    const existing = await db.query(
      "SELECT id FROM presspilot_connections WHERE base_url=$1 AND connection_mode='agent' LIMIT 1",
      [baseUrl]
    );

const connection = existing.rows[0]?.id
      ? await db.query(
        "UPDATE presspilot_connections SET encrypted_agent_token=$2,agent_endpoint=$3,agent_token_hash=$4,agent_version=$5,status='verified',agent_last_seen_at=NOW(),last_verified_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at",
        [existing.rows[0].id, encryptedAgentToken, endpoint, tokenHash, input.agentVersion ?? null]
      )
      : await db.query(
        "INSERT INTO presspilot_connections(base_url,wp_username,encrypted_app_password,encrypted_agent_token,status,capabilities,last_verified_at,last_error,created_by,connection_mode,agent_endpoint,agent_token_hash,agent_version,agent_last_seen_at) VALUES($1,'__presspilot_agent__',$2,$3,'verified',$4,NOW(),NULL,$5,'agent',$6,$7,$8,NOW()) RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at",
        [baseUrl, encryptSecret("", config.ANALOG_SITE_KEY_SECRET), encryptedAgentToken, JSON.stringify({ rest: false, agent: true, content: true }), row.created_by ?? null, endpoint, tokenHash, input.agentVersion ?? null]
      );

    await db.query(
      "UPDATE presspilot_pairings SET claimed_at=NOW(),connection_id=$2 WHERE id=$1",
      [row.id, connection.rows[0].id]
    );
    await db.query("COMMIT");
    return { connection: connection.rows[0], agent_token: token, agent_name: input.agentName ?? null };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function getPressPilotExecutor(connectionId: string) {
  const connection = await getPressPilotConnection(connectionId);
  if (!connection) throw new Error("presspilot_connection_not_found");
  if (connection.connection_mode === "agent") {
    if (!connection.agent_endpoint || !connection.agentToken) throw new Error("presspilot_agent_not_paired");
    await db.query(
      "UPDATE presspilot_connections SET agent_last_seen_at=NOW(),updated_at=NOW() WHERE id=$1",
      [connectionId]
    );
    return new PressPilotAgentClient(connection.agent_endpoint, connection.agentToken);
  }
  return createWordPressClient(connection);
}


export async function rotatePressPilotAgentToken(id: string): Promise<PressPilotConnection> {
  const stored = await getPressPilotConnection(id);
  if (!stored) throw new Error("presspilot_connection_not_found");
  if (stored.connection_mode !== "agent" || !stored.agent_endpoint || !stored.agentToken) {
    throw new Error("presspilot_agent_not_paired");
  }

  const nextToken = generateAgentToken();
  const tokenHash = hashAgentToken(nextToken, config.ANALOG_SITE_KEY_SECRET);
  const encryptedAgentToken = encryptSecret(nextToken, config.ANALOG_SITE_KEY_SECRET);
  let remoteRotated = false;

  await db.query("BEGIN");
  try {
    await db.query(
      "UPDATE presspilot_connections SET encrypted_agent_token=$2,agent_token_hash=$3,status='pending',last_error=NULL,updated_at=NOW() WHERE id=$1",
      [id, encryptedAgentToken, tokenHash]
    );

    const client = new PressPilotAgentClient(stored.agent_endpoint, stored.agentToken);
    await client.rotateToken(nextToken);
    remoteRotated = true;

    await db.query(
      "UPDATE presspilot_connections SET status='verified',last_verified_at=NOW(),agent_last_seen_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1",
      [id]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    if (remoteRotated) {
      try {
        const rollbackClient = new PressPilotAgentClient(stored.agent_endpoint, nextToken);
        await rollbackClient.rotateToken(stored.agentToken);
      } catch {}
    }
    throw error;
  }

  const refreshed = await getPressPilotConnection(id);
  if (!refreshed) throw new Error("presspilot_connection_not_found");
  return refreshed;
}

export async function revokePressPilotAgentToken(id: string): Promise<PressPilotConnection> {
  const stored = await getPressPilotConnection(id);
  if (!stored) throw new Error("presspilot_connection_not_found");
  if (stored.connection_mode !== "agent" || !stored.agent_endpoint || !stored.agentToken) {
    throw new Error("presspilot_agent_not_paired");
  }

  await db.query("BEGIN");
  try {
    await db.query(
      "UPDATE presspilot_connections SET status='disabled',encrypted_agent_token=NULL,agent_token_hash=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1",
      [id]
    );
    const client = new PressPilotAgentClient(stored.agent_endpoint, stored.agentToken);
    await client.revokeToken();
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  const refreshed = await db.query(
    "SELECT id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at FROM presspilot_connections WHERE id=$1",
    [id]
  );
  if (!refreshed.rows[0]) throw new Error("presspilot_connection_not_found");
  return refreshed.rows[0] as PressPilotConnection;
}

export async function createPressPilotEnrollment(siteUrl: string, createdBy?: string | null) {
  const baseUrl = normalizeWordPressUrl(siteUrl);
  if (new URL(baseUrl).protocol !== "https:") throw new Error("https_required_for_agent");
  const token = generateEnrollmentToken();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const result = await db.query(
    "INSERT INTO presspilot_enrollments(token_hash,site_url,created_by,expires_at) VALUES($1,$2,$3,$4) RETURNING id,site_url,expires_at,created_at",
    [hashEnrollmentToken(token, config.ANALOG_SITE_KEY_SECRET), baseUrl, createdBy ?? null, expiresAt]
  );
  return { id: result.rows[0].id as string, site_url: result.rows[0].site_url as string, token, expires_at: result.rows[0].expires_at, created_at: result.rows[0].created_at };
}

export async function claimPressPilotEnrollment(input: {
  token: string;
  siteUrl: string;
  agentName?: string;
  agentVersion?: string;
}) {
  const token = input.token.trim();
  const baseUrl = normalizeWordPressUrl(input.siteUrl);
  if (new URL(baseUrl).protocol !== "https:") throw new Error("https_required_for_agent");
  const agentToken = generateAgentToken();
  const tokenHash = hashAgentToken(agentToken, config.ANALOG_SITE_KEY_SECRET);
  const encryptedAgentToken = encryptSecret(agentToken, config.ANALOG_SITE_KEY_SECRET);
  const endpoint = baseUrl + "/wp-json/presspilot/v1/agent";

  await db.query("BEGIN");
  try {
    const enrollment = await db.query(
      "SELECT id,site_url,created_by FROM presspilot_enrollments WHERE token_hash=$1 AND claimed_at IS NULL AND expires_at>NOW() FOR UPDATE",
      [hashEnrollmentToken(token, config.ANALOG_SITE_KEY_SECRET)]
    );
    const row = enrollment.rows[0];
    if (!row) throw new Error("enrollment_token_expired_or_invalid");
    if (normalizeWordPressUrl(String(row.site_url)) !== baseUrl) throw new Error("enrollment_site_mismatch");

    const existing = await db.query(
      "SELECT id FROM presspilot_connections WHERE base_url=$1 AND connection_mode='agent' LIMIT 1",
      [baseUrl]
    );
    const connection = existing.rows[0]?.id
      ? await db.query(
        "UPDATE presspilot_connections SET encrypted_agent_token=$2,agent_endpoint=$3,agent_token_hash=$4,agent_version=$5,status='verified',agent_last_seen_at=NOW(),last_verified_at=NOW(),last_error=NULL,updated_at=NOW() WHERE id=$1 RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at",
        [existing.rows[0].id, encryptedAgentToken, endpoint, tokenHash, input.agentVersion ?? null]
      )
      : await db.query(
        "INSERT INTO presspilot_connections(base_url,wp_username,encrypted_app_password,encrypted_agent_token,status,capabilities,last_verified_at,last_error,created_by,connection_mode,agent_endpoint,agent_token_hash,agent_version,agent_last_seen_at) VALUES($1,'__presspilot_agent__',$2,$3,'verified',$4,NOW(),NULL,$5,'agent',$6,$7,$8,NOW()) RETURNING id,site_id,base_url,wp_username,status,capabilities,last_verified_at,last_error,created_by,created_at,connection_mode,agent_endpoint,agent_version,agent_last_seen_at",
        [baseUrl, encryptSecret("", config.ANALOG_SITE_KEY_SECRET), encryptedAgentToken, JSON.stringify({ rest: false, agent: true, content: true }), row.created_by ?? null, endpoint, tokenHash, input.agentVersion ?? null]
      );

    await db.query("UPDATE presspilot_enrollments SET claimed_at=NOW(),connection_id=$2 WHERE id=$1", [row.id, connection.rows[0].id]);
    await db.query("COMMIT");
    return { connection: connection.rows[0], agent_token: agentToken, agent_name: input.agentName ?? null };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
