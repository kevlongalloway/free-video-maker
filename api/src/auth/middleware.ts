import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";

import { logger } from "../logger";
import { TenantStore } from "./TenantStore";
import { OAuthStore } from "./oauth/OAuthStore";
import { extractApiKey } from "./apiKey";
import { Tenant, planFor } from "./types";

/**
 * Optional extras for `authenticate`. When an OAuthStore is supplied, bearer
 * tokens issued by the embedded OAuth server are accepted in addition to raw
 * API keys. When a resourceMetadataUrl is supplied, 401s carry the
 * `WWW-Authenticate` header that tells MCP clients where to start OAuth.
 */
export interface AuthOptions {
  oauth?: OAuthStore;
  resourceMetadataUrl?: string;
}

// Augment Express' Request so downstream handlers can read `req.tenant`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

/** A synthetic tenant used when auth is disabled (local/OSS single-user mode). */
const LOCAL_TENANT: Tenant = {
  id: "local",
  name: "Local",
  plan: "scale",
  apiKeyHash: "",
  apiKeyLast4: "local",
  disabled: false,
  isAdmin: true,
  createdAt: new Date(0).toISOString(),
};

/**
 * Authentication middleware. When auth is disabled it transparently injects a
 * local admin tenant so existing single-user / Docker workflows keep working.
 * When enabled it requires a valid, non-disabled API key.
 */
export function authenticate(
  store: TenantStore,
  authEnabled: boolean,
  opts: AuthOptions = {},
) {
  // Emit a 401 with the OAuth discovery pointer (RFC 9728) when configured, so
  // MCP clients know to begin the OAuth flow instead of just failing.
  const unauthorized = (res: ExpressResponse, message: string): void => {
    if (opts.resourceMetadataUrl) {
      res.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${opts.resourceMetadataUrl}"`,
      );
    }
    res.status(401).json({ error: "Unauthorized", message });
  };

  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    if (!authEnabled) {
      req.tenant = LOCAL_TENANT;
      next();
      return;
    }

    const rawKey = extractApiKey(
      req.headers as {
        authorization?: string;
        "x-api-key"?: string | string[];
      },
    );
    if (!rawKey) {
      unauthorized(
        res,
        "Missing credentials. Send an API key or OAuth bearer token in the 'Authorization' header.",
      );
      return;
    }

    // A credential can be either a raw API key or an OAuth access token.
    let tenant = store.getByRawKey(rawKey);
    if (!tenant && opts.oauth) {
      const tenantId = opts.oauth.getTenantIdForAccessToken(rawKey);
      if (tenantId) tenant = store.getById(tenantId);
    }
    if (!tenant) {
      unauthorized(res, "Invalid or expired credentials");
      return;
    }
    if (tenant.disabled) {
      res.status(403).json({
        error: "Forbidden",
        message: "This account is disabled. Contact support.",
      });
      return;
    }

    req.tenant = tenant;
    next();
  };
}

/** Restrict a route to admin tenants (used by the provisioning API). */
export function requireAdmin(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  if (!req.tenant?.isAdmin) {
    res.status(403).json({ error: "Forbidden", message: "Admin access required" });
    return;
  }
  next();
}

/**
 * Enforce the tenant's monthly video quota before a create/render call.
 * Attach this only to endpoints that actually enqueue a render.
 */
export function enforceQuota(store: TenantStore) {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const tenant = req.tenant;
    if (!tenant) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const plan = planFor(tenant);
    if (plan.monthlyVideoQuota === -1) {
      next();
      return;
    }
    const usage = store.getUsage(tenant.id);
    if (usage.count >= plan.monthlyVideoQuota) {
      logger.info(
        { tenantId: tenant.id, plan: plan.id, usage },
        "Quota exceeded",
      );
      res.status(429).json({
        error: "Quota exceeded",
        message: `Monthly limit of ${plan.monthlyVideoQuota} videos reached on the ${plan.name} plan.`,
        plan: plan.id,
        used: usage.count,
        limit: plan.monthlyVideoQuota,
        period: usage.period,
      });
      return;
    }
    next();
  };
}
