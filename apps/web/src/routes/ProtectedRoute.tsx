import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, hasStoredToken } from '../stores/auth-store';
import { useShopStore } from '../stores/shop-store';
import { useMeQuery } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { UserRole } from '@retailerp/shared-types';

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const tokenExists = hasStoredToken();

  // Need rehydration: token in storage but store not yet hydrated
  const needsRehydration = tokenExists && !isHydrated;

  const { data, isLoading, isError } = useMeQuery(needsRehydration);

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
          isMobileOnly: data.user.isMobileOnly,
        },
        accessToken,
        refreshToken,
      );

      const shopId = localStorage.getItem('currentShopId');
      const shopName = localStorage.getItem('currentShopName');
      const shopCode = localStorage.getItem('currentShopCode');
      if (shopId && shopName && shopCode) {
        useShopStore.getState().setShop(shopId, shopName, shopCode);
      }
    }
  }, [data]);

  // Rehydration failed — clear token and send to login
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

  // Rehydrating — show spinner
  if (needsRehydration && isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Rehydration failed
  if (!isAuthenticated && !isLoading) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/**
 * Helper to determine the default landing page for a given role.
 */
export function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case UserRole.ADMIN:
      return '/dashboard';
    case UserRole.ACCOUNTANT:
    case UserRole.OTHERS:
      return '/products';
    default:
      return '/login';
  }
}
