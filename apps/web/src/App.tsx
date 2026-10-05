import { lazy } from 'react';
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
import { PurchaseImportPage } from './pages/purchases/PurchaseImportPage';
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
import { BankLayout } from './pages/bank/components/BankLayout';
import { EmployeeListPage } from './pages/employees/EmployeeListPage';
import { EmployeeFormPage } from './pages/employees/EmployeeFormPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { FormBuilderPage } from './pages/settings/FormBuilderPage';
import { CategoryManagerPage } from './pages/settings/CategoryManagerPage';
import RolesUsersPage from './pages/settings/RolesUsersPage';
import PreferencesPage from './pages/preferences/PreferencesPage';
import { ProtectedRoute, getDefaultRoute } from './routes/ProtectedRoute';
import { PermissionGuard } from './routes/PermissionGuard';
import { useAuthStore } from './stores/auth-store';
import { usePreferencesStore } from './stores/preferences-store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { isPlatformAdminHost } from './lib/host';
import { PlatformApp } from './PlatformApp';

const BankDashboardPage = lazy(() => import('./pages/bank/BankDashboardPage'));
const BankUploadPage = lazy(() => import('./pages/bank/BankUploadPage'));
const BankReviewPage = lazy(() => import('./pages/bank/BankReviewPage'));
const BankTransactionsPage = lazy(() => import('./pages/bank/BankTransactionsPage'));
const BankStatementsPage = lazy(() => import('./pages/bank/BankStatementsPage'));
const BankRulesPage = lazy(() => import('./pages/bank/BankRulesPage'));

function App() {
  // Hostname-based router branch: `admin.*` renders the platform-admin
  // app; everything else renders the per-tenant app. The decision is made
  // once per page load (hostname doesn't change without a full reload).
  if (isPlatformAdminHost()) {
    return <PlatformApp />;
  }

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
          {/* Available to every authenticated user */}
          <Route path="/preferences" element={<PreferencesPage />} />

          {/*
            Every page is opened by permission, never by role name. The
            permission list is already resolved for the tenant (features
            switched off and broken prerequisites removed), so a page a user
            can't use isn't reachable from the menu or by typing the URL.
          */}
          <Route element={<PermissionGuard anyOf={['dashboard.view']} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['products.list']} />}>
            <Route path="/products" element={<ProductListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['products.detail']} />}>
            <Route path="/products/:id" element={<ProductDetailPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['products.edit']} />}>
            <Route path="/products/:id/edit" element={<ProductAddPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['distributors.list']} />}>
            <Route path="/distributors" element={<DistributorListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['distributors.create']} />}>
            <Route path="/distributors/new" element={<DistributorFormPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['distributors.detail']} />}>
            <Route path="/distributors/:id" element={<DistributorDetailPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['distributors.edit']} />}>
            <Route path="/distributors/:id/edit" element={<DistributorFormPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['purchases.list']} />}>
            <Route path="/purchases" element={<PurchaseListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['purchases.create']} />}>
            <Route path="/purchases/new" element={<PurchaseCreatePage />} />
            <Route path="/purchases/import" element={<PurchaseImportPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['purchases.detail']} />}>
            <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['customers.list']} />}>
            <Route path="/customers" element={<CustomerListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['customers.create']} />}>
            <Route path="/customers/new" element={<CustomerFormPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['customers.detail']} />}>
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['customers.edit']} />}>
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['sales.list']} />}>
            <Route path="/sales" element={<SaleListPage />} />
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
            <Route path="/sales/scan-register" element={<RegisterScanPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['sales.edit']} />}>
            <Route path="/sales/:id/edit" element={<SaleCreatePage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['sales.detail']} />}>
            <Route path="/sales/:id" element={<SaleDetailPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['installments.list']} />}>
            <Route path="/installments" element={<InstallmentListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['installments.detail']} />}>
            <Route path="/installments/:scheduleId" element={<InstallmentDetailPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['transfers.list']} />}>
            <Route path="/transfers" element={<TransferListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['transfers.initiate']} />}>
            <Route path="/transfers/new" element={<TransferCreatePage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['transfers.detail']} />}>
            <Route path="/transfers/:id" element={<TransferDetailPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['expenses.list']} />}>
            <Route path="/expenses" element={<ExpenseListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['expenses.create']} />}>
            <Route path="/expenses/new" element={<ExpenseFormPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['expenses.edit']} />}>
            <Route path="/expenses/:id/edit" element={<ExpenseFormPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['bank.view']} />}>
            <Route path="/bank" element={<BankLayout />}>
              <Route index element={<BankDashboardPage />} />
              <Route path="review" element={<BankReviewPage />} />
              <Route path="transactions" element={<BankTransactionsPage />} />
              <Route path="statements" element={<BankStatementsPage />} />
              <Route path="rules" element={<BankRulesPage />} />
              <Route element={<PermissionGuard anyOf={['bank.upload_statement']} />}>
                <Route path="upload" element={<BankUploadPage />} />
              </Route>
            </Route>
          </Route>

          <Route element={<PermissionGuard anyOf={['employees.list']} />}>
            <Route path="/employees" element={<EmployeeListPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['employees.create']} />}>
            <Route path="/employees/new" element={<EmployeeFormPage />} />
          </Route>
          <Route element={<PermissionGuard anyOf={['employees.edit']} />}>
            <Route path="/employees/:id/edit" element={<EmployeeFormPage />} />
          </Route>

          <Route element={<PermissionGuard anyOf={['settings.view']} />}>
            <Route path="/settings" element={<SettingsPage />}>
              <Route element={<PermissionGuard anyOf={['forms.view']} />}>
                <Route path="forms" element={<FormBuilderPage />} />
              </Route>
              <Route element={<PermissionGuard anyOf={['categories.list']} />}>
                <Route path="categories" element={<CategoryManagerPage />} />
              </Route>
              <Route element={<PermissionGuard anyOf={['roles.list', 'users.list']} />}>
                <Route path="roles" element={<RolesUsersPage />} />
              </Route>
            </Route>
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
  const permissions = useAuthStore((s) => s.permissions);
  const preferredLanding = usePreferencesStore(
    (s) => s.preferences.defaultLandingPage,
  );

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const target = user ? getDefaultRoute(permissions, preferredLanding) : '/login';
  return <Navigate to={target} replace />;
}

export default App;
