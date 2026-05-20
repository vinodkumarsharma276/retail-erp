/**
 * Tenant — the top-level multi-tenancy boundary. One row per onboarded
 * customer organisation. Maps to a subdomain (e.g. `vn.retailerp.com`)
 * via `slug`. Every shop, user, sale, etc. belongs to exactly one tenant.
 */
export interface Tenant {
  id: string;
  /** URL-safe subdomain slug. Must be unique. e.g. `vn`, `acme`. */
  slug: string;
  /** Display name shown in the UI header and on invoices. */
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** GSTIN of the org (optional — some tenants may have many shops with separate GSTs). */
  gstNumber: string | null;
  /** Optional custom domain (e.g. `erp.customer-domain.com`). */
  customDomain: string | null;
  status: TenantStatus;
  /** FK → Plan. Drives default feature set. */
  planId: string;
  trialEndsAt: string | null;
  /** Free-form structured metadata (billing customer id, notes, etc.). */
  billingMeta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type TenantStatus = 'active' | 'trial' | 'suspended' | 'cancelled';

/**
 * Plan — pricing tier. Each tenant references one plan; the plan's
 * `PlanFeature` rows seed the tenant's default feature toggles. Tenant
 * can override per-feature via `TenantFeature`.
 */
export interface Plan {
  id: string;
  /** Short stable code: `starter`, `pro`, `enterprise`. */
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  /** Visible in self-serve catalog. If false, only assignable by platform admin. */
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Default feature toggle for every plan. Tenants inherit these on
 * onboarding; per-tenant overrides live in `TenantFeature`.
 */
export interface PlanFeature {
  id: string;
  planId: string;
  featureKey: string;
  enabled: boolean;
  /** For limit-style features (e.g. max shops = 5). Free-form JSON. */
  valueJson: Record<string, unknown> | null;
}

/**
 * Per-tenant override of a feature flag. Absence of a row = use plan
 * default. Presence overrides it (even to `disabled` for a plan-enabled
 * feature).
 */
export interface TenantFeature {
  id: string;
  tenantId: string;
  featureKey: string;
  enabled: boolean;
  valueJson: Record<string, unknown> | null;
  /** Optional note explaining why this override exists (free trial, partner deal, etc.). */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Snapshot of a tenant's effective feature set, computed by merging
 * `PlanFeature` defaults with `TenantFeature` overrides. Sent from the
 * server in the login response so the client can gate UI without an
 * extra round trip.
 */
export interface TenantFeatureSnapshot {
  /** Feature key → enabled flag (always present for every known key). */
  flags: Record<string, boolean>;
  /** Feature key → typed value for limit-style features. Absent if no value set. */
  values: Record<string, unknown>;
}
