import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';
import { useMeQuery } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useShopStore } from '../stores/shop-store';
import { UserRole } from '@retailerp/shared-types';

export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const setShop = useShopStore((s) => s.setShop);

  // If we have a token in sessionStorage but no user in memory (page refresh),
  // fetch the current user via /auth/me to rehydrate the store.
  const hasToken = !!sessionStorage.getItem('accessToken');
  const needsRehydration = hasToken && !user;

  const { data, isLoading, isError } = useMeQuery(needsRehydration);

  useEffect(() => {
    if (data?.user) {
      const accessToken = sessionStorage.getItem('accessToken') ?? '';
      const refreshToken = localStorage.getItem('refreshToken') ?? '';
      login(
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

      // Also rehydrate the available shops list if needed
      const shopId = localStorage.getItem('currentShopId');
      const shopName = localStorage.getItem('currentShopName');
      const shopCode = localStorage.getItem('currentShopCode');
      if (shopId && shopName && shopCode) {
        setShop(shopId, shopName, shopCode);
      }
    }
  }, [data, login, setShop]);

  // No token at all — redirect to login
  if (!hasToken) {
    return <Navigate to="/login" replace />;
  }

  // Token exists but we're rehydrating the user
  if (needsRehydration && isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Token was invalid
  if (needsRehydration && isError) {
    sessionStorage.removeItem('accessToken');
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
