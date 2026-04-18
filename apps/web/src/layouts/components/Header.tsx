import { useState, useRef, useEffect } from 'react';
import {
  LogOut,
  User,
  Bell,
  ChevronDown,
  Store,
  Loader2,
  Check,
  Menu,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore } from '../../stores/shop-store';
import { useSidebarStore } from '../../stores/sidebar-store';
import { useNavigate } from 'react-router-dom';
import { useMeQuery, useLogoutMutation, useSwitchShopMutation } from '../../hooks/useAuth';
import { queryClient } from '../../lib/query-client';
import { cn } from '../../lib/utils';
import { UserRole } from '@retailerp/shared-types';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalSearch } from './GlobalSearch';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const shopName = useShopStore((s) => s.currentShopName);
  const shopCode = useShopStore((s) => s.currentShopCode);
  const currentShopId = useShopStore((s) => s.currentShopId);
  const setShop = useShopStore((s) => s.setShop);
  const loginStore = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const openSidebar = useSidebarStore((s) => s.open);
  const logoutMutation = useLogoutMutation();
  const switchShopMutation = useSwitchShopMutation();

  // --- Dark mode toggle ---
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // Fetch available shops for the current user (owner/admin/accountant can switch)
  const canSwitchShop =
    user?.role === UserRole.OWNER ||
    user?.role === UserRole.ADMIN ||
    user?.role === UserRole.ACCOUNTANT;
  const meQuery = useMeQuery(canSwitchShop);
  const availableShops = meQuery.data?.shops ?? [];

  // Shop switcher dropdown
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false);
  const shopDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        shopDropdownRef.current &&
        !shopDropdownRef.current.contains(e.target as Node)
      ) {
        setShopDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
        logout();
        navigate('/login');
      },
    });
  };

  const handleShopSwitch = (shopId: string) => {
    if (shopId === currentShopId) {
      setShopDropdownOpen(false);
      return;
    }

    switchShopMutation.mutate(shopId, {
      onSuccess: (data) => {
        // Update token — the switch-shop endpoint returns a new accessToken
        const refreshToken = localStorage.getItem('refreshToken') ?? '';
        if (user) {
          loginStore(user, data.accessToken, refreshToken);
        }
        localStorage.setItem('accessToken', data.accessToken);

        // Update shop
        setShop(data.shop.id, data.shop.name, data.shop.code);

        // Clear query cache so data re-fetches for the new shop
        queryClient.invalidateQueries();

        setShopDropdownOpen(false);
      },
    });
  };

  return (
    <div className="border-b bg-card">
      {/* Top bar */}
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Mobile menu toggle */}
          <button
            onClick={openSidebar}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Shop badge / switcher */}
          {canSwitchShop && availableShops.length > 1 ? (
            <div className="relative" ref={shopDropdownRef}>
              <button
                onClick={() => setShopDropdownOpen(!shopDropdownOpen)}
                className={cn(
                  'flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors',
                  'hover:bg-primary/15',
                )}
              >
                <Store className="h-3.5 w-3.5" />
                {shopName}
                {shopCode && (
                  <span className="text-primary/70">({shopCode})</span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    shopDropdownOpen && 'rotate-180',
                  )}
                />
              </button>

              {shopDropdownOpen && (
                <div className="absolute left-0 z-50 mt-1 min-w-[220px] rounded-md border bg-card shadow-lg">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
                    Switch Shop
                  </div>
                  <ul className="py-1">
                    {availableShops.map((shop) => (
                      <li key={shop.id}>
                        <button
                          onClick={() => handleShopSwitch(shop.id)}
                          disabled={switchShopMutation.isPending}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                            'hover:bg-muted',
                            shop.id === currentShopId && 'bg-primary/5',
                          )}
                        >
                          {shop.id === currentShopId ? (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <div className="h-3.5 w-3.5" />
                          )}
                          <span>{shop.name}</span>
                          <span className="text-muted-foreground text-xs">
                            ({shop.code})
                          </span>
                          {switchShopMutation.isPending &&
                            switchShopMutation.variables === shop.id && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-primary" />
                            )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : shopName ? (
            <span className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
              <Store className="h-3.5 w-3.5" />
              {shopName}
              {shopCode && (
                <span className="text-primary/70">({shopCode})</span>
              )}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Global search — hidden for now, enable when needed */}
          {/* <GlobalSearch /> */}

          {/* Notification bell placeholder */}
          <button
            className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={() => setIsDark(!isDark)}
            className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Separator */}
          <div className="hidden sm:block h-6 w-px bg-border" />

          {/* User info */}
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span>{user?.fullName}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase font-medium">
              {user?.role}
            </span>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {logoutMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Breadcrumbs row */}
      <div className="px-6 pb-2">
        <Breadcrumbs />
      </div>
    </div>
  );
}
