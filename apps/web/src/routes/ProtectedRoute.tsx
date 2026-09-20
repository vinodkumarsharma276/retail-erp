import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore, hasStoredToken } from '../stores/auth-store';
import { useShopStore } from '../stores/shop-store';
import { useTenantStore } from '../stores/tenant-store';
import { useMeQuery } from '../hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { UserRole } from '@retailerp/shared-types';
import { usePreferencesStore } from '../stores/preferences-store';

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const tokenExists = hasStoredToken();
  const location = useLocation();
  const qc = useQueryClient();

  // Need rehydration: token in storage but store not yet hydrated
  const needsRehydration = tokenExists && !isHydrated;

  // Always run /auth/me while a token exists so that permission / role
  // changes made elsewhere propagate into this session without a hard
  // refresh. The first run rehydrates the store; subsequent refetches
  // just sync permissions.
  const { data, isLoading, isError, isSuccess } = useMeQuery(tokenExists);

  // Refetch permissions on every navigation so an admin's edit takes
  // effect on the affected user's next page load. Without this the
  // permission Set in zustand could lag by up to a focus event.
  useEffect(() => {
    if (tokenExists && isAuthenticated) {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    }
  }, [location.pathname, tokenExists, isAuthenticated, qc]);

  // Track if we've received data but haven't processed it in useEffect yet
  const pendingHydration = useRef(false);

  useEffect(() => {
    if (!data?.user) return;

    const store = useAuthStore.getState();
    const perms = (data as any).permissions ?? [];

    // Sync user preferences into the global store + format helpers.
    usePreferencesStore.getState().setPreferences(
      ((data.user as any).preferences as any) ?? null,
    );

    // Tenant context + feature flags — refreshed on every /auth/me so a
    // platform-admin feature toggle takes effect on the user's next
    // navigation, not after a hard reload.
    const meTenant = (data as any).tenant;
    const meFeatures = (data as any).features;
    if (meTenant && meFeatures) {
      useTenantStore.getState().setTenant(meTenant, meFeatures);
    }

    if (!store.isAuthenticated) {
      // First hydration after a page load — full login().
      const accessToken = localStorage.getItem('accessToken') ?? '';
      const refreshToken = localStorage.getItem('refreshToken') ?? '';
      store.login(
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
        perms,
      );

      const shopId = localStorage.getItem('currentShopId');
      const shopName = localStorage.getItem('currentShopName');
      const shopCode = localStorage.getItem('currentShopCode');
      if (shopId && shopName && shopCode) {
        useShopStore.getState().setShop(shopId, shopName, shopCode);
      }
    } else {
      // Already authenticated — background refetch. Just keep perms in
      // sync so sidebar / guards react to role changes.
      store.setPermissions(perms);
    }
    pendingHydration.current = false;
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
 * Helper to determine the default landing page for a given role. If the
 * user has set a `defaultLandingPage` preference and the chosen route is
 * permitted for their role, that takes precedence over the role default.
 */
export function getDefaultRoute(role: UserRole, preferred?: string | null): string {
  if (preferred && preferred.startsWith('/') && preferred !== '/') {
    return preferred;
  }
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
