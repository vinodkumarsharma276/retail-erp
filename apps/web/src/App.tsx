import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthLayout } from './layouts/AuthLayout';
import { DashboardLayout } from './layouts/DashboardLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductListPage } from './pages/products/ProductListPage';

function App() {
  return (
    <Routes>
      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Protected routes */}
      <Route element={<DashboardLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/products" element={<ProductListPage />} />
        {/* Placeholder routes — pages will be added per phase */}
        <Route path="/distributors" element={<Placeholder title="Distributors" />} />
        <Route path="/purchases" element={<Placeholder title="Purchases" />} />
        <Route path="/customers" element={<Placeholder title="Customers" />} />
        <Route path="/sales" element={<Placeholder title="Sales" />} />
        <Route path="/installments" element={<Placeholder title="Installments" />} />
        <Route path="/transfers" element={<Placeholder title="Transfers" />} />
        <Route path="/expenses" element={<Placeholder title="Expenses" />} />
        <Route path="/bank" element={<Placeholder title="Bank Statements" />} />
        <Route path="/employees" element={<Placeholder title="Employees" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
      </Route>

      {/* Default redirect */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">{title}</h1>
      <p className="text-muted-foreground">This section will be built in upcoming phases.</p>
    </div>
  );
}

export default App;
