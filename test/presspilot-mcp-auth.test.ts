import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProtectedResourceMetadata,
  buildOAuthChallenge,
  claimsToPressPilotAuthInfo,
  hasRequiredScopes
} from "../src/presspilot-mcp-auth.js";

test("builds protected resource metadata for the MCP origin", () => {
  const value = buildProtectedResourceMetadata(
    "https://api-jyu9-production.up.railway.app",
    "https://tenant.example.auth0.com/",
    ["presspilot:read", "presspilot:write"]
  );
  assert.deepEqual(value, {
    resource: "https://api-jyu9-production.up.railway.app",
    authorization_servers: ["https://tenant.example.auth0.com/"],
    scopes_supported: ["presspilot:read", "presspilot:write"],
    resource_documentation: "https://analogsolution.com"
  });
});

test("builds an OAuth challenge that points ChatGPT to protected-resource metadata", () => {
  const value = buildOAuthChallenge(
    "https://api-jyu9-production.up.railway.app/.well-known/oauth-protected-resource",
    ["presspilot:read", "presspilot:write"],
    "invalid_token",
    "PressPilot authentication is required."
  );
  assert.match(value, /resource_metadata="/);
  assert.match(value, /scope="presspilot:read presspilot:write"/);
  assert.match(value, /error="invalid_token"/);
  assert.match(value, /error_description="PressPilot authentication is required\."/);
});

test("maps Auth0 JWT claims into MCP AuthInfo with expiry, audience and scopes", () => {
  const value = claimsToPressPilotAuthInfo(
    "token-value",
    {
      sub: "auth0|123",
      azp: "chatgpt-client",
      aud: "https://api-jyu9-production.up.railway.app",
      exp: 2000000000,
      scope: "openid presspilot:read",
      permissions: ["presspilot:write"],
      email: "owner@example.com",
      name: "Analog Solutions"
    },
    "https://api-jyu9-production.up.railway.app"
  );
  assert.equal(value.token, "token-value");
  assert.equal(value.clientId, "chatgpt-client");
  assert.equal(value.expiresAt, 2000000000);
  assert.deepEqual(value.scopes, ["openid", "presspilot:read", "presspilot:write"]);
  assert.equal(value.resource?.toString(), "https://api-jyu9-production.up.railway.app/");
  assert.deepEqual(value.extra, {
    sub: "auth0|123",
    email: "owner@example.com",
    name: "Analog Solutions"
  });
});

test("scope checking requires every requested scope", () => {
  assert.equal(hasRequiredScopes(["presspilot:read", "presspilot:write"], ["presspilot:read"]), true);
  assert.equal(hasRequiredScopes(["presspilot:read"], ["presspilot:read", "presspilot:write"]), false);
});
