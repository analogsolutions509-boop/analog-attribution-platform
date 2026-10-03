import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";

export const PRESSPILOT_READ_SCOPE = "presspilot:read";
export const PRESSPILOT_WRITE_SCOPE = "presspilot:write";

export interface PressPilotOAuthOptions {
  issuer: string;
  resource: string;
}

export function normalizeOAuthIssuer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("oauth_issuer_required");
  return trimmed.endsWith("/") ? trimmed : trimmed + "/";
}

export function buildProtectedResourceMetadata(
  resource: string,
  issuer: string,
  scopes: string[]
) {
  return {
    resource: new URL(resource).origin,
    authorization_servers: [normalizeOAuthIssuer(issuer)],
    scopes_supported: [...scopes],
    resource_documentation: "https://analogsolution.com"
  };
}

export function buildOAuthChallenge(
  resourceMetadataUrl: string,
  scopes: string[] = [],
  error?: string,
  errorDescription?: string
): string {
  const parts = [
    'Bearer',
    'resource_metadata="' + resourceMetadataUrl + '"',
    ...(scopes.length ? ['scope="' + scopes.join(" ") + '"'] : []),
    ...(error ? ['error="' + error + '"'] : []),
    ...(errorDescription ? ['error_description="' + errorDescription.replace(/"/g, "\\\"") + '"'] : [])
  ];
  return parts.join(" ");
}

export function hasRequiredScopes(
  grantedScopes: string[],
  requiredScopes: string[]
): boolean {
  const granted = new Set(grantedScopes);
  return requiredScopes.every((scope) => granted.has(scope));
}
export function claimsToPressPilotAuthInfo(
  token: string,
  claims: JWTPayload & Record<string, unknown>,
  resource: string
): AuthInfo {
  if (typeof claims.exp !== "number") throw new Error("oauth_exp_required");
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("oauth_sub_required");
  }

  const scopeClaims = typeof claims.scope === "string"
    ? claims.scope.split(/\s+/).filter(Boolean)
    : [];
  const permissionClaims = Array.isArray(claims.permissions)
    ? claims.permissions.filter((value): value is string => typeof value === "string")
    : [];
  const scopes = [...new Set([...scopeClaims, ...permissionClaims])];

  const clientId =
    typeof claims.azp === "string" && claims.azp
      ? claims.azp
      : typeof claims.client_id === "string" && claims.client_id
        ? claims.client_id
        : claims.sub;

  return {
    token,
    clientId,
    scopes,
    expiresAt: claims.exp,
    resource: new URL(resource),
    extra: {
      sub: claims.sub,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      ...(typeof claims.name === "string" ? { name: claims.name } : {})
    }
  };
}
export function createPressPilotTokenVerifier(
  options: PressPilotOAuthOptions
): OAuthTokenVerifier {
  const issuer = normalizeOAuthIssuer(options.issuer);
  const resource = new URL(options.resource).origin;
  const jwks = createRemoteJWKSet(
    new URL(new URL(issuer).origin + "/.well-known/jwks.json")
  );

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: resource
      });
      return claimsToPressPilotAuthInfo(
        token,
        payload as JWTPayload & Record<string, unknown>,
        resource
      );
    }
  };
}
export async function verifyPressPilotAuthorizationHeader(
  authorization: string | undefined,
  options: {
    issuer?: string;
    resource: string;
    developmentToken?: string;
  }
): Promise<AuthInfo> {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("oauth_token_required");

  const supplied = match[1];
  if (options.developmentToken) {
    const left = Buffer.from(supplied, "utf8");
    const right = Buffer.from(options.developmentToken, "utf8");
    if (left.length === right.length && timingSafeEqual(left, right)) {
      return {
        token: supplied,
        clientId: "presspilot-development",
        scopes: [PRESSPILOT_READ_SCOPE, PRESSPILOT_WRITE_SCOPE],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(options.resource),
        extra: { development: true }
      };
    }
  }

  if (!options.issuer) throw new Error("oauth_not_configured");
  return createPressPilotTokenVerifier({
    issuer: options.issuer,
    resource: options.resource
  }).verifyAccessToken(supplied);
}

export function buildPressPilotResourceUrl(publicApiUrl: string): string {
  return new URL(publicApiUrl).origin;
}

export function buildPressPilotResourceMetadataUrl(publicApiUrl: string): string {
  return new URL(
    "/.well-known/oauth-protected-resource",
    buildPressPilotResourceUrl(publicApiUrl)
  ).toString();
}
