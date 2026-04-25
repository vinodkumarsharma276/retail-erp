import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthLayout } from './layouts/AuthLayout';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductListPage } from './pages/products/ProductListPage';
import { ProductAddPage } from './pages/products/ProductAddPage';
import { ProductDetailPage } from './pages/products/ProductDetailPage';
import { DistributorListPage } from './pages/distributors/DistributorListPage';
import { DistributorFormPage } from './pages/distributors/DistributorFormPage';
import { DistributorDetailPage } from './pages/distributors/DistributorDetailPage';
import { PurchaseListPage } from './pages/purchases/PurchaseListPage';
import { PurchaseCreatePage } from './pages/purchases/PurchaseCreatePage';
import { PurchaseDetailPage } from './pages/purchases/PurchaseDetailPage';
import { CustomerListPage } from './pages/customers/CustomerListPage';
import { CustomerFormPage } from './pages/customers/CustomerFormPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { SaleListPage } from './pages/sales/SaleListPage';
import { SaleCreatePage } from './pages/sales/SaleCreatePage';
import { SaleDetailPage } from './pages/sales/SaleDetailPage';
import { RegisterScanPage } from './pages/sales/RegisterScanPage';
import { InstallmentListPage } from './pages/installments/InstallmentListPage';
import { InstallmentDetailPage } from './pages/installments/InstallmentDetailPage';
import { TransferListPage } from './pages/transfers/TransferListPage';
import { TransferCreatePage } from './pages/transfers/TransferCreatePage';
import { TransferDetailPage } from './pages/transfers/TransferDetailPage';
import { ExpenseListPage } from './pages/expenses/ExpenseListPage';
import { ExpenseFormPage } from './pages/expenses/ExpenseFormPage';
import { BankPage } from './pages/bank/BankPage';
import { EmployeeListPage } from './pages/employees/EmployeeListPage';
import { EmployeeFormPage } from './pages/employees/EmployeeFormPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { FormBuilderPage } from './pages/settings/FormBuilderPage';
import { CategoryManagerPage } from './pages/settings/CategoryManagerPage';
import RolesUsersPage from './pages/settings/RolesUsersPage';
import { ProtectedRoute, getDefaultRoute } from './routes/ProtectedRoute';
import { RoleGuard } from './routes/RoleGuard';
import { PermissionGuard } from './routes/PermissionGuard';
import { useAuthStore } from './stores/auth-store';
import { UserRole } from '@retailerp/shared-types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';

function App() {
  return (
    <ErrorBoundary>
    <ToastContainer />
    <Routes>
      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Protected routes — require authentication */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          {/* Admin-only routes */}
          <Route element={<RoleGuard allowedRoles={[UserRole.OWNER, UserRole.ADMIN]} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/employees/new" element={<EmployeeFormPage />} />
            <Route path="/employees/:id/edit" element={<EmployeeFormPage />} />
            <Route path="/settings" element={<SettingsPage />}>
              <Route path="forms" element={<FormBuilderPage />} />
              <Route path="categories" element={<CategoryManagerPage />} />
              <Route path="roles" element={<RolesUsersPage />} />
            </Route>
          </Route>

          {/* Admin + Accountant routes */}
          <Route
            element={
              <RoleGuard
                allowedRoles={[UserRole.OWNER, UserRole.ADMIN, UserRole.ACCOUNTANT]}
              />
            }
          >
            <Route path="/products/:id/edit" element={<ProductAddPage />} />
            <Route path="/distributors" element={<DistributorListPage />} />
            <Route path="/distributors/new" element={<DistributorFormPage />} />
            <Route path="/distributors/:id" element={<DistributorDetailPage />} />
            <Route path="/distributors/:id/edit" element={<DistributorFormPage />} />
            <Route element={<PermissionGuard anyOf={['purchases.list']} />}>
              <Route path="/purchases" element={<PurchaseListPage />} />
            </Route>
            <Route element={<PermissionGuard anyOf={['purchases.create']} />}>
              <Route path="/purchases/new" element={<PurchaseCreatePage />} />
            </Route>
            <Route element={<PermissionGuard anyOf={['purchases.detail']} />}>
              <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
            </Route>
            <Route path="/installments" element={<InstallmentListPage />} />
            <Route
              path="/installments/:scheduleId"
              element={<InstallmentDetailPage />}
            />
            <Route path="/expenses" element={<ExpenseListPage />} />
            <Route path="/expenses/new" element={<ExpenseFormPage />} />
            <Route path="/expenses/:id/edit" element={<ExpenseFormPage />} />
            <Route path="/bank" element={<BankPage />} />
          </Route>

          {/* Admin-only transfer creation */}
          <Route element={<RoleGuard allowedRoles={[UserRole.ADMIN]} />}>
            <Route path="/transfers/new" element={<TransferCreatePage />} />
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
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
            <Route element={<PermissionGuard anyOf={['sales.list']} />}>
              <Route path="/sales" element={<SaleListPage />} />
            </Route>
            <Route element={<PermissionGuard anyOf={['sales.list']} />}>
              <Route path="/sales/scan-register" element={<RegisterScanPage />} />
            </Route>
            <Route
              element={
                <PermissionGuard
                  anyOf={[
                    'sales.create_full_payment',
                    'sales.create_partial_with_promise',
                    'sales.create_self_finance',
                    'sales.create_company_finance',
                  ]}
                />
              }
            >
              <Route path="/sales/new" element={<SaleCreatePage />} />
            </Route>
            <Route element={<PermissionGuard anyOf={['sales.edit']} />}>
              <Route path="/sales/:id/edit" element={<SaleCreatePage />} />
            </Route>
            <Route element={<PermissionGuard anyOf={['sales.detail']} />}>
              <Route path="/sales/:id" element={<SaleDetailPage />} />
            </Route>
            <Route path="/transfers" element={<TransferListPage />} />
            <Route path="/transfers/:id" element={<TransferDetailPage />} />
          </Route>
        </Route>
      </Route>

      {/* Root redirect */}
      <Route path="/" element={<RootRedirect />} />

      {/* Fallback — redirect unknown routes to login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </ErrorBoundary>
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

export default App;
