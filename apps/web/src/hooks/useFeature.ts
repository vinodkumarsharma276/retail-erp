import { useTenantStore } from '../stores/tenant-store';

/**
 * Reactive feature-flag hook. Re-renders the consuming component when
 * the flag for `key` changes (e.g. after a fresh `/auth/me` refresh).
 *
 * The key must exist in `packages/shared-types/src/features.ts` (FeatureKey).
 * Unknown keys read as disabled.
 *
 * Example:
 *   const showBank = useFeature('bank.reconciliation');
 *   if (!showBank) return null;
 */
export function useFeature(key: string): boolean {
  return useTenantStore((s) => s.features.flags[key] === true);
}

/**
 * Reactive read of a feature value (limit-style features carry a JSON
 * value, e.g. `{ max: 5 }`). Returns `null` when the key is unknown or
 * has no value attached.
 */
export function useFeatureValue<T = unknown>(key: string): T | null {
  return useTenantStore((s) => (s.features.values[key] as T | undefined) ?? null);
}
