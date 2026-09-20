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
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Store,
} from 'lucide-react';
import { useSidebarStore } from '../../stores/sidebar-store';
import { useAuthStore } from '../../stores/auth-store';
import { cn } from '../../lib/utils';
import { useCanCheck } from '../../hooks/usePermission';
import { useTenantStore } from '../../stores/tenant-store';
import { FeatureKey } from '@retailerp/shared-types';

/**
 * Navigation is grouped by workflow rather than listed flat. A shopkeeper
 * thinks in terms of "stock coming in" vs "money going out", so Products,
 * Purchases, Distributors and Transfers belong together, and Sales,
 * Installments and Customers form the revenue side.
 *
 * Each item gates on two independent things:
 *   - `perm`    — RBAC permission key (per-user, see permissions.ts)
 *   - `feature` — tenant feature flag (per-plan + per-tenant override).
 * Items without a `feature` are always visible, subject to `perm`.
 *
 * A section renders only when at least one of its items survives both gates,
 * so a tenant on a plan without Installments never sees an empty "Revenue"
 * heading.
 */
interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  perm: string;
  feature?: string;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'nav.dashboard', feature: FeatureKey.DASHBOARD_ANALYTICS },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { to: '/products', label: 'Products', icon: Package, perm: 'nav.products', feature: FeatureKey.PRODUCTS },
      { to: '/purchases', label: 'Purchases', icon: Receipt, perm: 'nav.purchases', feature: FeatureKey.PURCHASES },
      { to: '/distributors', label: 'Distributors', icon: Truck, perm: 'nav.distributors', feature: FeatureKey.DISTRIBUTORS },
      { to: '/transfers', label: 'Transfers', icon: ArrowRightLeft, perm: 'nav.transfers', feature: FeatureKey.TRANSFERS },
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    items: [
      { to: '/sales', label: 'Sales', icon: ShoppingCart, perm: 'nav.sales', feature: FeatureKey.SALES },
      { to: '/installments', label: 'Installments', icon: CalendarClock, perm: 'nav.installments', feature: FeatureKey.INSTALLMENTS },
      { to: '/customers', label: 'Customers', icon: Users, perm: 'nav.customers', feature: FeatureKey.CUSTOMERS },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'nav.expenses', feature: FeatureKey.EXPENSES },
      { to: '/bank', label: 'Bank Statements', icon: Building2, perm: 'nav.bank', feature: FeatureKey.BANK_RECONCILIATION },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { to: '/employees', label: 'Employees', icon: UserCheck, perm: 'nav.employees' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'nav.settings' },
    ],
  },
];

export function Sidebar() {
  const can = useCanCheck();
  const featureFlags = useTenantStore((s) => s.features.flags);
  const tenantName = useTenantStore((s) => s.tenantName);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const isOpen = useSidebarStore((s) => s.isOpen);
  const close = useSidebarStore((s) => s.close);
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const collapsedSections = useSidebarStore((s) => s.collapsedSections);
  const toggleSection = useSidebarStore((s) => s.toggleSection);
  const hydrateForUser = useSidebarStore((s) => s.hydrateForUser);

  const location = useLocation();

  // Load this user's persisted rail/section state once we know who they are.
  useEffect(() => {
    hydrateForUser(userId);
  }, [userId, hydrateForUser]);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    close();
  }, [location.pathname, close]);

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!can(item.perm)) return false;
        if (item.feature && !featureFlags[item.feature]) return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  // In rail mode the group headings have nowhere to go, so sections always
  // render expanded as icon runs separated by a divider.
  const railMode = isCollapsed;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-backdrop bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'no-theme-transition flex flex-col border-r border-sidebar-border bg-sidebar',
          'fixed inset-y-0 left-0 z-sidebar transition-[width,transform] duration-200 ease-out lg:static lg:translate-x-0',
          railMode ? 'w-sidebar-rail' : 'w-sidebar max-w-[85vw]',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-header shrink-0 items-center border-b border-sidebar-border',
            railMode ? 'justify-center px-2' : 'justify-between pl-4 pr-2',
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Store className="h-4 w-4" />
            </div>
            {!railMode && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
                  RetailERP
                </p>
                {tenantName && (
                  <p className="truncate text-[0.6875rem] leading-tight text-sidebar-muted">
                    {tenantName}
                  </p>
                )}
              </div>
            )}
          </div>

          {!railMode && (
            <button
              onClick={close}
              className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="scrollbar-auto flex-1 overflow-y-auto px-2 py-3">
          {visibleSections.map((section, index) => {
            const sectionCollapsed = !railMode && collapsedSections.includes(section.id);

            return (
              <div
                key={section.id}
                className={cn(
                  railMode && index > 0 && 'mt-2 border-t border-sidebar-border pt-2',
                  !railMode && index > 0 && 'mt-4',
                )}
              >
                {!railMode && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!sectionCollapsed}
                    className="group mb-1 flex w-full items-center justify-between rounded px-2 py-1 text-overline transition-colors hover:text-foreground"
                  >
                    <span>{section.label}</span>
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 shrink-0 opacity-0 transition-all group-hover:opacity-100',
                        sectionCollapsed && '-rotate-90 opacity-100',
                      )}
                    />
                  </button>
                )}

                {!sectionCollapsed && (
                  <ul className="stagger space-y-0.5">
                    {section.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          title={railMode ? item.label : undefined}
                          className={({ isActive }) =>
                            cn(
                              'group relative flex items-center rounded-md text-sm font-medium transition-colors',
                              railMode
                                ? 'h-9 w-full justify-center'
                                : 'gap-3 px-2 py-1.5',
                              isActive
                                ? 'bg-primary-muted text-primary'
                                : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {/* Active rail marker — reads instantly when
                                  scanning, and survives rail mode where the
                                  label is hidden. */}
                              {isActive && (
                                <span
                                  aria-hidden
                                  className={cn(
                                    'animate-fade-in absolute left-0 h-4 w-0.5 rounded-r bg-primary',
                                    railMode && '-left-2',
                                  )}
                                />
                              )}
                              <item.icon
                                className={cn(
                                  'h-4 w-4 shrink-0 transition-transform duration-150',
                                  !isActive && 'group-hover:scale-110',
                                )}
                              />
                              {!railMode && <span className="truncate">{item.label}</span>}
                            </>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Rail toggle — desktop only; on mobile the drawer handles this. */}
        <div className="hidden shrink-0 border-t border-sidebar-border p-2 lg:block">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={railMode ? 'Expand sidebar' : 'Collapse sidebar'}
            title={railMode ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-md text-xs font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground',
              railMode ? 'w-full justify-center' : 'w-full px-2',
            )}
          >
            {railMode ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
