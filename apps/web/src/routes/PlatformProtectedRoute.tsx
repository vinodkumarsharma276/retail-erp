import { Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { usePlatformAuthStore, hasPlatformToken } from '../stores/platform-auth-store';
import { usePlatformMeQuery } from '../hooks/usePlatform';

/**
 * Gate for `admin.*` routes. Mirrors the per-tenant `ProtectedRoute`:
 *   - If no platform token in storage → redirect to /login.
 *   - If token exists but store not yet hydrated, call `/platform/auth/me`
 *     to refresh the in-memory state.
 *   - On 401 (expired) → clear token + redirect to /login.
 */
export function PlatformProtectedRoute() {
  const isAuthenticated = usePlatformAuthStore((s) => s.isAuthenticated);
  const isHydrated = usePlatformAuthStore((s) => s.isHydrated);
  const setUser = usePlatformAuthStore((s) => s.setUser);
  const setHydrated = usePlatformAuthStore((s) => s.setHydrated);
  const tokenExists = hasPlatformToken();
  const needsRehydration = tokenExists && !isHydrated;

  const meQuery = usePlatformMeQuery(tokenExists);

  useEffect(() => {
    if (meQuery.data?.platformUser) {
      setUser(meQuery.data.platformUser);
    }
  }, [meQuery.data, setUser]);

  useEffect(() => {
    if (needsRehydration && meQuery.isError) {
      // Token is stale — clear and let the user log in fresh.
      localStorage.removeItem('platformAccessToken');
      localStorage.removeItem('platformRefreshToken');
      setHydrated();
    }
  }, [needsRehydration, meQuery.isError, setHydrated]);

  if (!tokenExists) {
    return <Navigate to="/login" replace />;
  }

  if (needsRehydration && meQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (!isAuthenticated && meQuery.isError) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
