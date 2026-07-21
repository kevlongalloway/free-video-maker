import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";

import { TenantStore } from "../../auth/TenantStore";
import { requireAdmin } from "../../auth/middleware";
import { PLANS, PlanId, planFor, Tenant } from "../../auth/types";
import { logger } from "../../logger";

/**
 * Admin/provisioning API. Every route requires an admin API key. The frontend
 * onboarding/billing flow calls these (server-to-server) to create a tenant
 * and receive the one-time API key to hand to the new customer.
 */
export class AdminRouter {
  public router: express.Router;

  constructor(private store: TenantStore) {
    this.router = express.Router();
    this.router.use(express.json());
    this.router.use(requireAdmin);
    this.setupRoutes();
  }

  private setupRoutes() {
    // List available plans.
    this.router.get("/plans", (_req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json({ plans: Object.values(PLANS) });
    });

    // List all tenants (never exposes key hashes' raw value).
    this.router.get(
      "/tenants",
      (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json({
          tenants: this.store.list().map((t) => this.publicTenant(t)),
        });
      },
    );

    // Provision a new customer. Returns the raw API key exactly once.
    this.router.post(
      "/tenants",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { name, email, plan } = req.body ?? {};
        if (!name || typeof name !== "string") {
          res.status(400).json({ error: "name is required" });
          return;
        }
        if (plan && !(plan in PLANS)) {
          res.status(400).json({
            error: "invalid plan",
            validPlans: Object.keys(PLANS),
          });
          return;
        }
        const { tenant, apiKey } = this.store.create({
          name,
          email,
          plan: plan as PlanId | undefined,
        });
        logger.info({ tenantId: tenant.id, plan: tenant.plan }, "Tenant created");
        res.status(201).json({
          tenant: this.publicTenant(tenant),
          apiKey, // shown once — the caller must store/deliver it now.
        });
      },
    );

    // Inspect one tenant + current usage.
    this.router.get(
      "/tenants/:id",
      (req: ExpressRequest, res: ExpressResponse) => {
        const tenant = this.store.getById(req.params.id);
        if (!tenant) {
          res.status(404).json({ error: "tenant not found" });
          return;
        }
        res.status(200).json({ tenant: this.publicTenant(tenant) });
      },
    );

    // Update plan / disable / rename (e.g. on subscription change).
    this.router.patch(
      "/tenants/:id",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { name, email, plan, disabled } = req.body ?? {};
        if (plan && !(plan in PLANS)) {
          res.status(400).json({ error: "invalid plan" });
          return;
        }
        const tenant = this.store.update(req.params.id, {
          name,
          email,
          plan,
          disabled,
        });
        if (!tenant) {
          res.status(404).json({ error: "tenant not found" });
          return;
        }
        res.status(200).json({ tenant: this.publicTenant(tenant) });
      },
    );

    // Rotate a compromised/expiring key.
    this.router.post(
      "/tenants/:id/rotate-key",
      (req: ExpressRequest, res: ExpressResponse) => {
        const result = this.store.rotateKey(req.params.id);
        if (!result) {
          res.status(404).json({ error: "tenant not found" });
          return;
        }
        res.status(200).json({
          tenant: this.publicTenant(result.tenant),
          apiKey: result.apiKey,
        });
      },
    );

    // Off-board a customer.
    this.router.delete(
      "/tenants/:id",
      (req: ExpressRequest, res: ExpressResponse) => {
        const ok = this.store.delete(req.params.id);
        if (!ok) {
          res.status(404).json({ error: "tenant not found" });
          return;
        }
        res.status(200).json({ success: true });
      },
    );
  }

  /** Shape returned to the operator — includes usage but never a raw key. */
  private publicTenant(t: Tenant) {
    const usage = this.store.getUsage(t.id);
    const plan = planFor(t);
    return {
      id: t.id,
      name: t.name,
      email: t.email,
      plan: t.plan,
      disabled: t.disabled,
      isAdmin: t.isAdmin,
      createdAt: t.createdAt,
      apiKeyLast4: t.apiKeyLast4,
      usage: {
        period: usage.period,
        used: usage.count,
        limit: plan.monthlyVideoQuota,
      },
    };
  }
}
