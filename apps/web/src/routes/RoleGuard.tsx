import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';
import { UserRole } from '@retailerp/shared-types';
import { ShieldX } from 'lucide-react';
import { getDefaultRoute } from './ProtectedRoute';

interface RoleGuardProps {
  allowedRoles: UserRole[];
  /** If true, shows an "Access Denied" message instead of redirecting. */
  showDenied?: boolean;
}

export function RoleGuard({ allowedRoles, showDenied = false }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    if (showDenied) {
      return <AccessDenied />;
    }
    return <Navigate to={getDefaultRoute(user.role)} replace />;
  }

  return <Outlet />;
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ShieldX className="h-16 w-16 text-destructive mb-4" />
      <h1 className="text-2xl font-semibold mb-2">Access Denied</h1>
      <p className="text-muted-foreground max-w-md">
        You do not have permission to access this page. Contact your
        administrator if you believe this is an error.
      </p>
    </div>
  );
}
