import { Routes, Route, Navigate } from 'react-router-dom';
import { PlatformLayout } from './layouts/PlatformLayout';
import { PlatformLoginPage } from './pages/platform/PlatformLoginPage';
import { TenantListPage } from './pages/platform/TenantListPage';
import { TenantOnboardPage } from './pages/platform/TenantOnboardPage';
import { TenantDetailPage } from './pages/platform/TenantDetailPage';
import { PlanManagerPage } from './pages/platform/PlanManagerPage';
import { PlatformProtectedRoute } from './routes/PlatformProtectedRoute';
import { usePlatformAuthStore, hasPlatformToken } from './stores/platform-auth-store';
import { ErrorBoundary } from './components/ErrorBoundary';

/**
 * Router for the platform-admin app. Mounted by `App.tsx` when the
 * current hostname matches `admin.*` (or `VITE_FORCE_PLATFORM_ADMIN`).
 * Routes are intentionally short and don't overlap with tenant routes
 * since this app lives at a separate hostname.
 */
export function PlatformApp() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<PlatformLoginPage />} />
        <Route element={<PlatformProtectedRoute />}>
          <Route element={<PlatformLayout />}>
            <Route path="/" element={<PlatformRoot />} />
            <Route path="/tenants" element={<TenantListPage />} />
            <Route path="/tenants/new" element={<TenantOnboardPage />} />
            <Route path="/tenants/:id" element={<TenantDetailPage />} />
            <Route path="/plans" element={<PlanManagerPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

/** Default landing inside the platform app. */
function PlatformRoot() {
  const isAuthed = usePlatformAuthStore((s) => s.isAuthenticated);
  if (!isAuthed && !hasPlatformToken()) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to="/tenants" replace />;
}
