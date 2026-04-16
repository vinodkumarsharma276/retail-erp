import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Truck,
  Receipt,
  Users,
  ShoppingCart,
  CalendarClock,
  ArrowRightLeft,
  Wallet,
  Building2,
  UserCheck,
  Settings,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { useSidebarStore } from '../../stores/sidebar-store';
import { cn } from '../../lib/utils';
import { UserRole } from '@retailerp/shared-types';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [UserRole.ADMIN] },
  { to: '/products', label: 'Products', icon: Package, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS] },
  { to: '/distributors', label: 'Distributors', icon: Truck, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT] },
  { to: '/purchases', label: 'Purchases', icon: Receipt, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT] },
  { to: '/customers', label: 'Customers', icon: Users, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS] },
  { to: '/sales', label: 'Sales', icon: ShoppingCart, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS] },
  { to: '/installments', label: 'Installments', icon: CalendarClock, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT] },
  { to: '/transfers', label: 'Transfers', icon: ArrowRightLeft, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OTHERS] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT] },
  { to: '/bank', label: 'Bank Statements', icon: Building2, roles: [UserRole.ADMIN, UserRole.ACCOUNTANT] },
  { to: '/employees', label: 'Employees', icon: UserCheck, roles: [UserRole.ADMIN] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: [UserRole.ADMIN] },
];

export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const userRole = user?.role;
  const isOpen = useSidebarStore((s) => s.isOpen);
  const close = useSidebarStore((s) => s.close);
  const location = useLocation();

  const visibleItems = navItems.filter(
    (item) => userRole && item.roles.includes(userRole),
  );

  // Close sidebar on route change (mobile)
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          // Base styles
          'flex w-64 flex-col border-r bg-card',
          // Mobile: fixed overlay, off-screen by default
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-6">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            <span className="text-lg font-semibold">RetailERP</span>
          </div>
          {/* Close button on mobile */}
          <button
            onClick={close}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {visibleItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
