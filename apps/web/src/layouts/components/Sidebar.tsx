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
import { useSidebarStore } from '../../stores/sidebar-store';
import { cn } from '../../lib/utils';
import { useCanCheck } from '../../hooks/usePermission';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'nav.dashboard' },
  { to: '/products', label: 'Products', icon: Package, perm: 'nav.products' },
  { to: '/distributors', label: 'Distributors', icon: Truck, perm: 'nav.distributors' },
  { to: '/purchases', label: 'Purchases', icon: Receipt, perm: 'nav.purchases' },
  { to: '/customers', label: 'Customers', icon: Users, perm: 'nav.customers' },
  { to: '/sales', label: 'Sales', icon: ShoppingCart, perm: 'nav.sales' },
  { to: '/installments', label: 'Installments', icon: CalendarClock, perm: 'nav.installments' },
  { to: '/transfers', label: 'Transfers', icon: ArrowRightLeft, perm: 'nav.transfers' },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'nav.expenses' },
  { to: '/bank', label: 'Bank Statements', icon: Building2, perm: 'nav.bank' },
  { to: '/employees', label: 'Employees', icon: UserCheck, perm: 'nav.employees' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'nav.settings' },
];

export function Sidebar() {
  const can = useCanCheck();
  const isOpen = useSidebarStore((s) => s.isOpen);
  const close = useSidebarStore((s) => s.close);
  const location = useLocation();

  const visibleItems = navItems.filter((item) => can(item.perm));

  // Close sidebar on route change (mobile)
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          // Base styles — uses sidebar-specific tokens
          'flex w-64 flex-col border-r border-sidebar-border bg-sidebar',
          // Mobile: fixed overlay, off-screen by default
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo area */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <ShoppingCart className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
              RetailERP
            </span>
          </div>
          {/* Close button on mobile */}
          <button
            onClick={close}
            className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin p-3">
          <ul className="space-y-0.5">
            {visibleItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-sidebar-hover hover:text-sidebar-foreground',
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom section — version or branding */}
        <div className="border-t border-sidebar-border px-6 py-3">
          <p className="text-xs text-muted-foreground">
            RetailERP v1.0
          </p>
        </div>
      </aside>
    </>
  );
}
