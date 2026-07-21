/**
 * Multi-tenant auth model for offering the video/ad engine as a subscription
 * service. A "tenant" is a paying customer (or their app). Every API key maps
 * to exactly one tenant; every rendered video is owned by the tenant that
 * created it.
 */

export type PlanId = "free" | "starter" | "growth" | "scale";

export interface Plan {
  id: PlanId;
  name: string;
  /** videos allowed per calendar month. -1 = unlimited. */
  monthlyVideoQuota: number;
  /** how many jobs this tenant may have in-flight at once. */
  maxConcurrentJobs: number;
  /** REST/MCP requests per minute, soft rate limit. */
  rateLimitPerMinute: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyVideoQuota: 5,
    maxConcurrentJobs: 1,
    rateLimitPerMinute: 20,
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyVideoQuota: 50,
    maxConcurrentJobs: 1,
    rateLimitPerMinute: 60,
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyVideoQuota: 300,
    maxConcurrentJobs: 3,
    rateLimitPerMinute: 120,
  },
  scale: {
    id: "scale",
    name: "Scale",
    monthlyVideoQuota: -1,
    maxConcurrentJobs: 10,
    rateLimitPerMinute: 600,
  },
};

export interface Tenant {
  id: string;
  name: string;
  email?: string;
  plan: PlanId;
  /** sha256 of the raw API key; the raw key is shown only once at creation. */
  apiKeyHash: string;
  /** last 4 chars of the raw key, for display in dashboards. */
  apiKeyLast4: string;
  disabled: boolean;
  /** admin tenants may manage other tenants via /api/admin. */
  isAdmin: boolean;
  createdAt: string;
}

/** What the auth middleware attaches to the request. */
export type AuthContext = Tenant;

export interface UsageRecord {
  /** YYYY-MM period the count applies to. */
  period: string;
  count: number;
}

export function currentPeriod(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function planFor(tenant: Tenant): Plan {
  return PLANS[tenant.plan] ?? PLANS.free;
}
