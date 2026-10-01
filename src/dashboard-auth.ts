import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

type SessionPayload = {
  username: string;
  expiresAt: number;
  nonce: string;
};

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifyDashboardCredentials(
  username: string,
  password: string,
  expectedUsername: string,
  expectedPassword: string
): boolean {
  if (!username || !password || !expectedUsername || !expectedPassword) return false;
  const userOk = username === expectedUsername;
  const left = Buffer.from(password, "utf8");
  const right = Buffer.from(expectedPassword, "utf8");
  const passwordOk = left.length === right.length && timingSafeEqual(left, right);
  return userOk && passwordOk;
}

export function createDashboardSession(
  username: string,
  secret: string,
  nowMs = Date.now(),
  ttlSeconds = SESSION_TTL_SECONDS
): string {
  const payload: SessionPayload = {
    username,
    expiresAt: Math.floor(nowMs / 1000) + ttlSeconds,
    nonce: randomBytes(18).toString("base64url")
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyDashboardSession(
  cookie: string | undefined,
  secret: string,
  nowMs = Date.now()
): string | null {
  if (!cookie || !secret) return null;
  const [encoded, signature] = cookie.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.username || !payload.expiresAt || Math.floor(nowMs / 1000) >= payload.expiresAt) return null;
    return payload.username;
  } catch {
    return null;
  }
}

export { SESSION_TTL_SECONDS };
