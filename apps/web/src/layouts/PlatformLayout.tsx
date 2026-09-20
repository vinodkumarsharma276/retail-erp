import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  LogOut,
  Sun,
  Moon,
  ShieldCheck,
  Loader2,
  CreditCard,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { usePlatformAuthStore } from '../stores/platform-auth-store';
import { usePlatformLogoutMutation } from '../hooks/usePlatform';

/**
 * Layout shell for the platform-admin app (`admin.retailerp.com`).
 * Deliberately separate from the tenant `DashboardLayout` so the two
 * UIs can't get confused — different color accent, different sidebar
 * items, distinct identity.
 */
export function PlatformLayout() {
  const navigate = useNavigate();
  const user = usePlatformAuthStore((s) => s.user);
  const logout = usePlatformAuthStore((s) => s.logout);
  const logoutMutation = usePlatformLogoutMutation();

  // Dark mode toggle — local-only state (platform admins don't have
  // tenant user preferences). Mirrors AuthLayout pattern.
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('platformTheme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('platformTheme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        logout();
        navigate('/login', { replace: true });
      },
    });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">RetailERP</span>
            <span className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Platform Admin
            </span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-0.5 px-2">
            <NavItem to="/tenants" icon={Building2} label="Tenants" />
            <NavItem to="/plans" icon={CreditCard} label="Plans" />
          </ul>
        </nav>
        <div className="border-t p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.fullName ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.username ?? '—'}</p>
            </div>
            <button
              onClick={() => setIsDark((v) => !v)}
              title={isDark ? 'Light mode' : 'Dark mode'}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              title="Log out"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-red-100 dark:hover:bg-red-950/30 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              {logoutMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Building2;
  label: string;
}) {
  return (
    <li>
      <NavLink
        to={to}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            isActive
              ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )
        }
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </NavLink>
    </li>
  );
}
