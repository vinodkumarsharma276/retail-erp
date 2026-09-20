import { useAuthStore } from '../stores/auth-store';

/**
 * Returns true if the current user's role grants the given permission key.
 * Owner role implicitly grants all permissions even if a key is missing
 * (defensive — should not be needed since the seed assigns all keys to Owner).
 */
export function usePermission(key: string): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'owner') return true;
  return permissions.has(key);
}

/** Returns true if any of the given keys are granted. */
export function useAnyPermission(...keys: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  const role = useAuthStore((s) => s.user?.role);
  if (role === 'owner') return true;
  return keys.some((k) => permissions.has(k));
}

/** Returns the function form for use in callbacks / non-component code. */
export function useCanCheck(): (key: string) => boolean {
  const permissions = useAuthStore((s) => s.permissions);
  const role = useAuthStore((s) => s.user?.role);
  return (key: string) => role === 'owner' || permissions.has(key);
}
