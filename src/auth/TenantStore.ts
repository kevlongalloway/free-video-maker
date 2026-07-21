import fs from "fs-extra";
import path from "path";
import cuid from "cuid";

import { logger } from "../logger";
import {
  Tenant,
  PlanId,
  UsageRecord,
  currentPeriod,
} from "./types";
import { generateApiKey, hashApiKey, last4 } from "./apiKey";

interface StoreShape {
  tenants: Record<string, Tenant>; // by tenant id
  usage: Record<string, UsageRecord>; // by tenant id
  ownership: Record<string, string>; // videoId -> tenant id
}

/**
 * File-backed, write-through tenant/usage/ownership store.
 *
 * This keeps the reference implementation dependency-free and works out of the
 * box on a single node with a persistent disk. For horizontal scaling replace
 * this class with a Postgres/Redis-backed implementation exposing the same
 * interface — nothing else in the auth layer needs to change.
 */
export class TenantStore {
  private filePath: string;
  private data: StoreShape = { tenants: {}, usage: {}, ownership: {} };
  private byKeyHash = new Map<string, string>(); // apiKeyHash -> tenant id

  constructor(dataDirPath: string) {
    this.filePath = path.join(dataDirPath, "tenants.json");
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = fs.readJsonSync(this.filePath) as StoreShape;
        this.data.tenants ??= {};
        this.data.usage ??= {};
        this.data.ownership ??= {};
      }
    } catch (err) {
      logger.error(err, "Failed to load tenant store, starting empty");
      this.data = { tenants: {}, usage: {}, ownership: {} };
    }
    this.rebuildIndex();
  }

  private rebuildIndex() {
    this.byKeyHash.clear();
    for (const tenant of Object.values(this.data.tenants)) {
      this.byKeyHash.set(tenant.apiKeyHash, tenant.id);
    }
  }

  private persist() {
    try {
      fs.writeJsonSync(this.filePath, this.data, { spaces: 2 });
    } catch (err) {
      logger.error(err, "Failed to persist tenant store");
    }
  }

  /**
   * Ensure an admin tenant exists whose raw key equals the provided value.
   * Called at boot from ADMIN_API_KEY so the operator always has a way in and
   * can provision customer tenants through the admin API.
   */
  public ensureAdmin(rawAdminKey: string): void {
    const keyHash = hashApiKey(rawAdminKey);
    if (this.byKeyHash.has(keyHash)) {
      return;
    }
    const id = "admin";
    const tenant: Tenant = {
      id,
      name: "Administrator",
      plan: "scale",
      apiKeyHash: keyHash,
      apiKeyLast4: last4(rawAdminKey),
      disabled: false,
      isAdmin: true,
      createdAt: new Date().toISOString(),
    };
    this.data.tenants[id] = tenant;
    this.persist();
    this.rebuildIndex();
    logger.info("Bootstrapped admin tenant from ADMIN_API_KEY");
  }

  public getByRawKey(rawKey: string): Tenant | undefined {
    const id = this.byKeyHash.get(hashApiKey(rawKey));
    return id ? this.data.tenants[id] : undefined;
  }

  public getById(id: string): Tenant | undefined {
    return this.data.tenants[id];
  }

  public list(): Tenant[] {
    return Object.values(this.data.tenants);
  }

  /** Create a tenant and return both the record and the one-time raw key. */
  public create(input: {
    name: string;
    email?: string;
    plan?: PlanId;
    isAdmin?: boolean;
  }): { tenant: Tenant; apiKey: string } {
    const rawKey = generateApiKey();
    const id = cuid();
    const tenant: Tenant = {
      id,
      name: input.name,
      email: input.email,
      plan: input.plan ?? "free",
      apiKeyHash: hashApiKey(rawKey),
      apiKeyLast4: last4(rawKey),
      disabled: false,
      isAdmin: input.isAdmin ?? false,
      createdAt: new Date().toISOString(),
    };
    this.data.tenants[id] = tenant;
    this.persist();
    this.rebuildIndex();
    return { tenant, apiKey: rawKey };
  }

  public update(
    id: string,
    patch: Partial<Pick<Tenant, "name" | "email" | "plan" | "disabled">>,
  ): Tenant | undefined {
    const tenant = this.data.tenants[id];
    if (!tenant) return undefined;
    Object.assign(tenant, patch);
    this.persist();
    return tenant;
  }

  /** Rotate a tenant's key, returning the new one-time raw key. */
  public rotateKey(id: string): { tenant: Tenant; apiKey: string } | undefined {
    const tenant = this.data.tenants[id];
    if (!tenant) return undefined;
    const rawKey = generateApiKey();
    tenant.apiKeyHash = hashApiKey(rawKey);
    tenant.apiKeyLast4 = last4(rawKey);
    this.persist();
    this.rebuildIndex();
    return { tenant, apiKey: rawKey };
  }

  public delete(id: string): boolean {
    if (!this.data.tenants[id]) return false;
    delete this.data.tenants[id];
    delete this.data.usage[id];
    this.persist();
    this.rebuildIndex();
    return true;
  }

  // ----- usage / quota -----

  public getUsage(tenantId: string): UsageRecord {
    const period = currentPeriod();
    const existing = this.data.usage[tenantId];
    if (!existing || existing.period !== period) {
      return { period, count: 0 };
    }
    return existing;
  }

  public incrementUsage(tenantId: string): void {
    const period = currentPeriod();
    const existing = this.data.usage[tenantId];
    if (!existing || existing.period !== period) {
      this.data.usage[tenantId] = { period, count: 1 };
    } else {
      existing.count += 1;
    }
    this.persist();
  }

  // ----- video ownership -----

  public setOwner(videoId: string, tenantId: string): void {
    this.data.ownership[videoId] = tenantId;
    this.persist();
  }

  public getOwner(videoId: string): string | undefined {
    return this.data.ownership[videoId];
  }

  public isOwner(videoId: string, tenantId: string): boolean {
    // Videos with no recorded owner (e.g. created before auth was enabled)
    // are only visible to admins; regular tenants are denied by default.
    return this.data.ownership[videoId] === tenantId;
  }

  public listVideoIdsForTenant(tenantId: string): string[] {
    return Object.entries(this.data.ownership)
      .filter(([, owner]) => owner === tenantId)
      .map(([videoId]) => videoId);
  }

  public removeOwnership(videoId: string): void {
    if (this.data.ownership[videoId]) {
      delete this.data.ownership[videoId];
      this.persist();
    }
  }
}
