import { Outlet } from 'react-router-dom';
import { useCanCheck } from '../hooks/usePermission';
import { AccessDenied } from './RoleGuard';

interface PermissionGuardProps {
  /** Permission keys — user must have at least one of them. */
  anyOf: string[];
}

/**
 * Route-level guard that checks fine-grained permission keys (e.g.
 * `purchases.list`). Renders an Access Denied panel when the user
 * lacks every key in `anyOf`. Owner role always passes (handled in
 * `useCanCheck`).
 */
export function PermissionGuard({ anyOf }: PermissionGuardProps) {
  const can = useCanCheck();
  const allowed = anyOf.some((k) => can(k));
  if (!allowed) return <AccessDenied />;
  return <Outlet />;
}
