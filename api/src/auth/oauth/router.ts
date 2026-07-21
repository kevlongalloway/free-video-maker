import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";

import { logger } from "../../logger";
import { TenantStore } from "../TenantStore";
import { OAuthStore, verifyPkce } from "./OAuthStore";

/**
 * A tiny, spec-compliant OAuth 2.1 authorization server so MCP clients
 * (Claude's connectors on web + mobile) can auto-discover and sign in:
 *
 *   1. Client hits /mcp and gets 401 + WWW-Authenticate pointing here.
 *   2. GET /.well-known/oauth-protected-resource  -> which AS to use.
 *   3. GET /.well-known/oauth-authorization-server -> endpoints below.
 *   4. POST /oauth/register  -> Dynamic Client Registration (RFC 7591).
 *   5. GET  /oauth/authorize -> consent screen; user pastes their API key.
 *   6. POST /oauth/token     -> authorization_code (PKCE) / refresh_token.
 *
 * The user proves identity on the consent screen with their existing Free
 * Video Maker API key, so tokens map 1:1 onto tenants — no new user database.
 */
export class OAuthRouter {
  public router: express.Router;

  constructor(
    private oauth: OAuthStore,
    private tenants: TenantStore,
    private baseUrl: string,
  ) {
    this.router = express.Router();
    // CORS is header-only and safe to run for every request that passes
    // through here. Body parsers, however, must NOT be global: this router is
    // mounted at "/", so a global parser would consume the body of downstream
    // /mcp and /api requests (breaking the MCP SSE transport). They are applied
    // per-route below instead.
    this.router.use(cors);
    this.setupRoutes();
  }

  private metadataDoc() {
    return {
      issuer: this.baseUrl,
      authorization_endpoint: `${this.baseUrl}/oauth/authorize`,
      token_endpoint: `${this.baseUrl}/oauth/token`,
      registration_endpoint: `${this.baseUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_post",
        "client_secret_basic",
      ],
      scopes_supported: ["mcp"],
    };
  }

  private protectedResourceDoc() {
    return {
      resource: `${this.baseUrl}/mcp`,
      authorization_servers: [this.baseUrl],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    };
  }

  private setupRoutes() {
    const json = express.json();
    const form = express.urlencoded({ extended: true });

    // ---- discovery metadata (RFC 8414 + RFC 9728) ----
    // Register both the bare path and the resource-suffixed variant that
    // path-aware MCP clients probe (…/oauth-protected-resource/mcp).
    this.router.get(
      [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/mcp",
      ],
      (_req, res) => res.json(this.metadataDoc()),
    );
    this.router.get(
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ],
      (_req, res) => res.json(this.protectedResourceDoc()),
    );

    // ---- Dynamic Client Registration (RFC 7591) ----
    this.router.post("/oauth/register", json, (req, res) => {
      const body = req.body ?? {};
      const redirectUris: string[] = body.redirect_uris;
      if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
        return res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "redirect_uris is required",
        });
      }
      const client = this.oauth.registerClient({
        redirect_uris: redirectUris,
        client_name: body.client_name,
        grant_types: body.grant_types,
        response_types: body.response_types,
        token_endpoint_auth_method: body.token_endpoint_auth_method,
        scope: body.scope,
      });
      logger.info(
        { clientId: client.client_id, name: client.client_name },
        "OAuth client registered",
      );
      return res.status(201).json({
        client_id: client.client_id,
        client_secret: client.client_secret,
        client_id_issued_at: Math.floor(client.created_at / 1000),
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
        scope: client.scope,
      });
    });

    // ---- authorization endpoint ----
    this.router.get("/oauth/authorize", (req, res) => {
      const p = req.query as Record<string, string>;
      const client = this.oauth.getClient(p.client_id);
      if (!client) {
        return res
          .status(400)
          .send(errorPage("Unknown client_id. Re-add the connector."));
      }
      if (!client.redirect_uris.includes(p.redirect_uri)) {
        return res
          .status(400)
          .send(errorPage("redirect_uri does not match the registered client."));
      }
      if (p.response_type !== "code") {
        return this.redirectError(res, p, "unsupported_response_type");
      }
      if (!p.code_challenge || p.code_challenge_method !== "S256") {
        return this.redirectError(
          res,
          p,
          "invalid_request",
          "PKCE with S256 is required",
        );
      }
      // Render the consent + login screen; params ride along as hidden inputs.
      return res.status(200).send(
        consentPage({
          clientName: client.client_name || "an application",
          params: {
            client_id: p.client_id,
            redirect_uri: p.redirect_uri,
            response_type: p.response_type,
            code_challenge: p.code_challenge,
            code_challenge_method: p.code_challenge_method,
            state: p.state ?? "",
            scope: p.scope ?? "mcp",
            resource: p.resource ?? "",
          },
        }),
      );
    });

    this.router.post("/oauth/authorize", form, (req, res) => {
      const b = req.body as Record<string, string>;
      const client = this.oauth.getClient(b.client_id);
      if (!client || !client.redirect_uris.includes(b.redirect_uri)) {
        return res.status(400).send(errorPage("Invalid client or redirect_uri."));
      }
      const tenant = b.api_key
        ? this.tenants.getByRawKey(b.api_key.trim())
        : undefined;
      if (!tenant || tenant.disabled) {
        // Re-render with an error but keep the flow parameters intact.
        return res.status(401).send(
          consentPage({
            clientName: client.client_name || "an application",
            error: tenant?.disabled
              ? "That account is disabled."
              : "Invalid API key. Paste a valid Free Video Maker API key.",
            params: {
              client_id: b.client_id,
              redirect_uri: b.redirect_uri,
              response_type: "code",
              code_challenge: b.code_challenge,
              code_challenge_method: b.code_challenge_method,
              state: b.state ?? "",
              scope: b.scope ?? "mcp",
              resource: b.resource ?? "",
            },
          }),
        );
      }
      const code = this.oauth.createAuthCode({
        clientId: b.client_id,
        redirectUri: b.redirect_uri,
        codeChallenge: b.code_challenge,
        codeChallengeMethod: b.code_challenge_method,
        tenantId: tenant.id,
        scope: b.scope,
        resource: b.resource,
      });
      const url = new URL(b.redirect_uri);
      url.searchParams.set("code", code);
      if (b.state) url.searchParams.set("state", b.state);
      logger.info({ tenantId: tenant.id }, "OAuth authorization granted");
      return res.redirect(url.toString());
    });

    // ---- token endpoint ----
    // Accept both form-encoded (the OAuth default) and JSON bodies.
    this.router.post("/oauth/token", form, json, (req, res) => {
      const b = req.body as Record<string, string>;
      const grantType = b.grant_type;

      // Authenticate the client (public clients use PKCE, no secret).
      const clientId = b.client_id || basicAuthClientId(req);
      const client = clientId ? this.oauth.getClient(clientId) : undefined;
      if (!client) {
        return res
          .status(401)
          .json({ error: "invalid_client", error_description: "Unknown client" });
      }
      if (client.token_endpoint_auth_method !== "none") {
        const secret = b.client_secret || basicAuthSecret(req);
        if (!secret || secret !== client.client_secret) {
          return res
            .status(401)
            .json({ error: "invalid_client", error_description: "Bad secret" });
        }
      }

      if (grantType === "authorization_code") {
        const record = this.oauth.consumeAuthCode(b.code);
        if (!record || record.clientId !== client.client_id) {
          return res.status(400).json({ error: "invalid_grant" });
        }
        if (record.redirectUri !== b.redirect_uri) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          });
        }
        if (
          !b.code_verifier ||
          !verifyPkce(
            b.code_verifier,
            record.codeChallenge,
            record.codeChallengeMethod,
          )
        ) {
          return res.status(400).json({
            error: "invalid_grant",
            error_description: "PKCE verification failed",
          });
        }
        const tokens = this.oauth.issueTokens({
          tenantId: record.tenantId,
          clientId: client.client_id,
          scope: record.scope,
        });
        return res.json(tokenResponse(tokens, record.scope));
      }

      if (grantType === "refresh_token") {
        const result = this.oauth.consumeRefreshToken(
          b.refresh_token,
          client.client_id,
        );
        if (!result) {
          return res.status(400).json({ error: "invalid_grant" });
        }
        const tokens = this.oauth.issueTokens({
          tenantId: result.tenantId,
          clientId: client.client_id,
          scope: result.scope,
        });
        return res.json(tokenResponse(tokens, result.scope));
      }

      return res.status(400).json({ error: "unsupported_grant_type" });
    });
  }

  /** Redirect an OAuth error back to the client when we have a valid redirect. */
  private redirectError(
    res: ExpressResponse,
    p: Record<string, string>,
    error: string,
    description?: string,
  ) {
    const url = new URL(p.redirect_uri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    if (p.state) url.searchParams.set("state", p.state);
    return res.redirect(url.toString());
  }
}

// ----- helpers -----

function cors(req: ExpressRequest, res: ExpressResponse, next: NextFunction) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

function basicAuthClientId(req: ExpressRequest): string | undefined {
  const decoded = decodeBasic(req);
  return decoded?.[0];
}
function basicAuthSecret(req: ExpressRequest): string | undefined {
  const decoded = decodeBasic(req);
  return decoded?.[1];
}
function decodeBasic(req: ExpressRequest): [string, string] | undefined {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("basic ")) return undefined;
  try {
    const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = raw.indexOf(":");
    if (idx === -1) return undefined;
    return [
      decodeURIComponent(raw.slice(0, idx)),
      decodeURIComponent(raw.slice(idx + 1)),
    ];
  } catch {
    return undefined;
  }
}

function tokenResponse(
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  scope?: string,
) {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: scope ?? "mcp",
  };
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function consentPage(opts: {
  clientName: string;
  params: Record<string, string>;
  error?: string;
}): string {
  const hidden = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
    .join("\n      ");
  const errorHtml = opts.error
    ? `<p class="error">${esc(opts.error)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize • Free Video Maker</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0b0b0f; color: #f5f5f7; padding: 24px; }
    .card { width: 100%; max-width: 380px; background: #17171d; border: 1px solid #2a2a33;
      border-radius: 16px; padding: 28px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
    h1 { font-size: 20px; margin: 0 0 6px; }
    p { font-size: 14px; line-height: 1.5; color: #b9b9c2; margin: 0 0 18px; }
    strong { color: #f5f5f7; }
    label { display: block; font-size: 13px; margin: 0 0 6px; color: #d0d0d8; }
    input[type=password], input[type=text] { width: 100%; box-sizing: border-box;
      padding: 12px 14px; border-radius: 10px; border: 1px solid #33333f;
      background: #0f0f14; color: #fff; font-size: 15px; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; border: 0; border-radius: 10px; cursor: pointer;
      background: #6d5efc; color: #fff; font-size: 15px; font-weight: 600; }
    button:hover { background: #5a4be8; }
    .error { color: #ff8a8a; background: #3a1b1b; border: 1px solid #5c2a2a;
      padding: 10px 12px; border-radius: 10px; font-size: 13px; }
    .hint { font-size: 12px; color: #7c7c88; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize access</h1>
    <p><strong>${esc(opts.clientName)}</strong> wants to connect to your Free Video
      Maker account. Paste your API key to approve.</p>
    ${errorHtml}
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <label for="api_key">API key</label>
      <input id="api_key" name="api_key" type="password" autocomplete="off"
        placeholder="svm_live_…" autofocus />
      <button type="submit">Authorize</button>
    </form>
    <p class="hint">Your key is used only to verify who you are and is never shared
      with the connecting app.</p>
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Error</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 20px;color:#c00">
<h2>Authorization error</h2><p style="color:#333">${esc(message)}</p></body></html>`;
}
