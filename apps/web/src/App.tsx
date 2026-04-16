import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthLayout } from './layouts/AuthLayout';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductListPage } from './pages/products/ProductListPage';
import { ProductAddPage } from './pages/products/ProductAddPage';
import { ProductDetailPage } from './pages/products/ProductDetailPage';
import { ProtectedRoute, getDefaultRoute } from './routes/ProtectedRoute';
import { RoleGuard } from './routes/RoleGuard';
import { useAuthStore } from './stores/auth-store';
import { UserRole } from '@retailerp/shared-types';

function App() {
  return (
    <Routes>
      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Protected routes — require authentication */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          {/* Admin-only routes */}
          <Route element={<RoleGuard allowedRoles={[UserRole.ADMIN]} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<Placeholder title="Employees" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Route>

          {/* Admin + Accountant routes */}
          <Route
            element={
              <RoleGuard
                allowedRoles={[UserRole.ADMIN, UserRole.ACCOUNTANT]}
              />
            }
          >
            <Route path="/products/new" element={<ProductAddPage />} />
            <Route path="/products/:id/edit" element={<ProductAddPage />} />
            <Route
              path="/distributors"
              element={<Placeholder title="Distributors" />}
            />
            <Route
              path="/purchases"
              element={<Placeholder title="Purchases" />}
            />
            <Route
              path="/installments"
              element={<Placeholder title="Installments" />}
            />
            <Route
              path="/expenses"
              element={<Placeholder title="Expenses" />}
            />
            <Route
              path="/bank"
              element={<Placeholder title="Bank Statements" />}
            />
          </Route>

          {/* Admin + Accountant + Others routes */}
          <Route
            element={
              <RoleGuard
                allowedRoles={[
                  UserRole.ADMIN,
                  UserRole.ACCOUNTANT,
                  UserRole.OTHERS,
                ]}
              />
            }
          >
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route
              path="/customers"
              element={<Placeholder title="Customers" />}
            />
            <Route path="/sales" element={<Placeholder title="Sales" />} />
            <Route
              path="/sales/new"
              element={<Placeholder title="New Sale" />}
            />
            <Route
              path="/transfers"
              element={<Placeholder title="Transfers" />}
            />
          </Route>
        </Route>
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<RootRedirect />} />

      {/* Fallback — redirect unknown routes to login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

/**
 * Root route — redirect based on auth state and role.
 */
function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const target = user ? getDefaultRoute(user.role) : '/products';
  return <Navigate to={target} replace />;
}

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{title}</h1>
      <p className="text-muted-foreground">
        This section will be built in upcoming phases.
      </p>
    </div>
  );
}

export default App;
