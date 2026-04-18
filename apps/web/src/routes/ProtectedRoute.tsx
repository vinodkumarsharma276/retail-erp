import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, hasStoredToken } from '../stores/auth-store';
import { useShopStore } from '../stores/shop-store';
import { useMeQuery } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { UserRole } from '@retailerp/shared-types';

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const tokenExists = hasStoredToken();

  // Need rehydration: token in storage but store not yet hydrated
  const needsRehydration = tokenExists && !isHydrated;

  const { data, isLoading, isError, isSuccess } = useMeQuery(needsRehydration);

  // Track if we've received data but haven't processed it in useEffect yet
  const pendingHydration = useRef(false);

  useEffect(() => {
    if (data?.user) {
      const accessToken = localStorage.getItem('accessToken') ?? '';
      const refreshToken = localStorage.getItem('refreshToken') ?? '';
      useAuthStore.getState().login(
        {
          id: data.user.id,
          username: data.user.username,
          fullName: data.user.fullName,
          role: data.user.role,
          roleId: (data.user as any).roleId ?? null,
          isMobileOnly: data.user.isMobileOnly,
        },
        accessToken,
        refreshToken,
        (data as any).permissions ?? [],
      );

      const shopId = localStorage.getItem('currentShopId');
      const shopName = localStorage.getItem('currentShopName');
      const shopCode = localStorage.getItem('currentShopCode');
      if (shopId && shopName && shopCode) {
        useShopStore.getState().setShop(shopId, shopName, shopCode);
      }
      pendingHydration.current = false;
    }
  }, [data]);

  // Mark pending when query succeeds but effect hasn't run yet
  if (isSuccess && data?.user && !isAuthenticated) {
    pendingHydration.current = true;
  }

  // Rehydration failed — clear token
  useEffect(() => {
    if (needsRehydration && isError) {
      localStorage.removeItem('accessToken');
      useAuthStore.getState().setHydrated();
    }
  }, [needsRehydration, isError]);

  // No token at all — go to login
  if (!tokenExists) {
    return <Navigate to="/login" replace />;
  }

  // Rehydrating — show spinner (query loading OR data received but not yet processed)
  if (needsRehydration && (isLoading || pendingHydration.current)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Rehydration definitively failed (error, not pending, not authenticated)
  if (!isAuthenticated && isError) {
    return <Navigate to="/login" replace />;
  }

  // Still waiting for auth to settle — show spinner rather than redirecting
  if (!isAuthenticated && !isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Outlet />;
}

/**
 * Helper to determine the default landing page for a given role.
 */
export function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case UserRole.OWNER:
    case UserRole.ADMIN:
      return '/dashboard';
    case UserRole.ACCOUNTANT:
    case UserRole.OTHERS:
      return '/products';
    default:
      return '/login';
  }
}
