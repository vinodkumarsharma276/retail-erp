import { create } from 'zustand';
import type { AuthTenantContext, TenantFeatureSnapshot } from '@retailerp/shared-types';

/**
 * Tenant store — holds the active tenant's identity + effective feature
 * flags. Populated by the login response (and refreshed from `/auth/me`
 * on every navigation via ProtectedRoute). Persisted to localStorage so
 * a hard reload keeps the tenant chrome visible while `/auth/me` is in
 * flight.
 *
 * Feature flags are merged plan-defaults + per-tenant overrides on the
 * server (`getTenantFeatureSnapshot`), so the client can trust the map
 * as-is. Use the `useFeature(key)` hook to read individual flags.
 */
interface TenantState {
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  features: TenantFeatureSnapshot;
  setTenant: (tenant: AuthTenantContext, features: TenantFeatureSnapshot) => void;
  clearTenant: () => void;
}

const STORAGE_KEY = 'tenantContext';

function loadFromStorage(): {
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  features: TenantFeatureSnapshot;
} {
  if (typeof window === 'undefined') {
    return emptyTenant();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTenant();
    const parsed = JSON.parse(raw);
    return {
      tenantId: parsed.tenantId ?? null,
      tenantSlug: parsed.tenantSlug ?? null,
      tenantName: parsed.tenantName ?? null,
      features: {
        flags: parsed.features?.flags ?? {},
        values: parsed.features?.values ?? {},
      },
    };
  } catch {
    return emptyTenant();
  }
}

function emptyTenant() {
  return {
    tenantId: null,
    tenantSlug: null,
    tenantName: null,
    features: { flags: {}, values: {} } as TenantFeatureSnapshot,
  };
}

export const useTenantStore = create<TenantState>((set) => ({
  ...loadFromStorage(),
  setTenant: (tenant, features) => {
    const next = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      features,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage may be full or disabled — non-fatal.
    }
    set(next);
  },
  clearTenant: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
    }
    set(emptyTenant());
  },
}));

/** Read a feature flag synchronously (outside React). For UI use `useFeature`. */
export function isFeatureEnabled(key: string): boolean {
  return useTenantStore.getState().features.flags[key] === true;
}

/** Read a feature value (for limit-style features). */
export function getFeatureValue<T = unknown>(key: string): T | null {
  return (useTenantStore.getState().features.values[key] as T | undefined) ?? null;
}
