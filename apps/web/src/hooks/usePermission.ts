import { useAuthStore } from '../stores/auth-store';

/**
 * Permission checks for the UI. The list comes from the server already
 * resolved — role + per-user overrides, minus features the tenant has
 * switched off, minus anything whose prerequisites are missing — so there
 * is deliberately no "owner can do anything" shortcut: an owner can't use
 * a module their plan doesn't include.
 */
export function usePermission(key: string): boolean {
  return useAuthStore((s) => s.permissions.has(key));
}

/** True if any of the given keys are granted. */
export function useAnyPermission(...keys: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return keys.some((k) => permissions.has(k));
}

/** The function form, for callbacks and loops. */
export function useCanCheck(): (key: string) => boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return (key: string) => permissions.has(key);
}
