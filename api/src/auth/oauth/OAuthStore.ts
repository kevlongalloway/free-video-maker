import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

import { logger } from "../../logger";

/**
 * Minimal, file-backed OAuth 2.1 state store: registered clients (via Dynamic
 * Client Registration), short-lived authorization codes, and access/refresh
 * tokens. Mirrors the TenantStore persistence approach so the whole auth layer
 * stays dependency-free and works on a single node with a persistent disk.
 *
 * Tokens are opaque random strings; we store them directly because they are
 * high-entropy (a DB compromise is already game-over for a single-tenant tool).
 * Swap this for Postgres/Redis to scale horizontally — the interface is small.
 */

export interface OAuthClient {
  client_id: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  created_at: number;
}

interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  tenantId: string;
  scope?: string;
  resource?: string;
  expiresAt: number;
}

interface TokenRecord {
  token: string;
  tenantId: string;
  clientId: string;
  scope?: string;
  expiresAt: number;
}

interface StoreShape {
  clients: Record<string, OAuthClient>;
  codes: Record<string, AuthCode>;
  accessTokens: Record<string, TokenRecord>;
  refreshTokens: Record<string, TokenRecord>;
}

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export class OAuthStore {
  private filePath: string;
  private data: StoreShape = {
    clients: {},
    codes: {},
    accessTokens: {},
    refreshTokens: {},
  };

  constructor(dataDirPath: string) {
    this.filePath = path.join(dataDirPath, "oauth.json");
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = fs.readJsonSync(this.filePath) as StoreShape;
        this.data.clients ??= {};
        this.data.codes ??= {};
        this.data.accessTokens ??= {};
        this.data.refreshTokens ??= {};
      }
    } catch (err) {
      logger.error(err, "Failed to load oauth store, starting empty");
      this.data = { clients: {}, codes: {}, accessTokens: {}, refreshTokens: {} };
    }
    this.gc();
  }

  private persist() {
    try {
      fs.writeJsonSync(this.filePath, this.data, { spaces: 2 });
    } catch (err) {
      logger.error(err, "Failed to persist oauth store");
    }
  }

  /** Drop anything expired. Cheap to run on load and on each token op. */
  private gc() {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of Object.entries(this.data.codes)) {
      if (v.expiresAt < now) {
        delete this.data.codes[k];
        changed = true;
      }
    }
    for (const [k, v] of Object.entries(this.data.accessTokens)) {
      if (v.expiresAt < now) {
        delete this.data.accessTokens[k];
        changed = true;
      }
    }
    for (const [k, v] of Object.entries(this.data.refreshTokens)) {
      if (v.expiresAt < now) {
        delete this.data.refreshTokens[k];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private static random(prefix: string): string {
    return prefix + crypto.randomBytes(32).toString("hex");
  }

  // ----- clients (Dynamic Client Registration) -----

  public registerClient(input: {
    redirect_uris: string[];
    client_name?: string;
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
    scope?: string;
  }): OAuthClient {
    const authMethod = input.token_endpoint_auth_method || "none";
    const client: OAuthClient = {
      client_id: OAuthStore.random("client_"),
      client_secret:
        authMethod === "none" ? undefined : OAuthStore.random("secret_"),
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
      grant_types: input.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: input.response_types ?? ["code"],
      token_endpoint_auth_method: authMethod,
      scope: input.scope,
      created_at: Date.now(),
    };
    this.data.clients[client.client_id] = client;
    this.persist();
    return client;
  }

  public getClient(clientId: string): OAuthClient | undefined {
    return this.data.clients[clientId];
  }

  // ----- authorization codes -----

  public createAuthCode(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    tenantId: string;
    scope?: string;
    resource?: string;
  }): string {
    const code = OAuthStore.random("code_");
    this.data.codes[code] = {
      code,
      ...input,
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    this.persist();
    return code;
  }

  /** One-time consume: returns the code record and deletes it. */
  public consumeAuthCode(code: string): AuthCode | undefined {
    const record = this.data.codes[code];
    if (!record) return undefined;
    delete this.data.codes[code];
    this.persist();
    if (record.expiresAt < Date.now()) return undefined;
    return record;
  }

  // ----- tokens -----

  public issueTokens(input: {
    tenantId: string;
    clientId: string;
    scope?: string;
  }): { accessToken: string; refreshToken: string; expiresIn: number } {
    const accessToken = OAuthStore.random("at_");
    const refreshToken = OAuthStore.random("rt_");
    const now = Date.now();
    this.data.accessTokens[accessToken] = {
      token: accessToken,
      tenantId: input.tenantId,
      clientId: input.clientId,
      scope: input.scope,
      expiresAt: now + ACCESS_TTL_MS,
    };
    this.data.refreshTokens[refreshToken] = {
      token: refreshToken,
      tenantId: input.tenantId,
      clientId: input.clientId,
      scope: input.scope,
      expiresAt: now + REFRESH_TTL_MS,
    };
    this.persist();
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    };
  }

  /** Resolve a bearer access token to the tenant it was issued for. */
  public getTenantIdForAccessToken(token: string): string | undefined {
    const record = this.data.accessTokens[token];
    if (!record) return undefined;
    if (record.expiresAt < Date.now()) {
      delete this.data.accessTokens[token];
      this.persist();
      return undefined;
    }
    return record.tenantId;
  }

  /** Rotate a refresh token, returning a fresh access+refresh pair. */
  public consumeRefreshToken(token: string, clientId: string):
    | { tenantId: string; scope?: string }
    | undefined {
    const record = this.data.refreshTokens[token];
    if (!record) return undefined;
    if (record.clientId !== clientId) return undefined;
    delete this.data.refreshTokens[token];
    this.persist();
    if (record.expiresAt < Date.now()) return undefined;
    return { tenantId: record.tenantId, scope: record.scope };
  }
}

/** Verify a PKCE code_verifier against a stored code_challenge (S256 only). */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(hash);
  const b = Buffer.from(challenge);
  // timingSafeEqual throws on length mismatch, so bail out first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
