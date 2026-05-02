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
  Settings,
  Sliders,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore } from '../../stores/shop-store';
import { useSidebarStore } from '../../stores/sidebar-store';
import { useNavigate } from 'react-router-dom';
import { useMeQuery, useLogoutMutation, useSwitchShopMutation } from '../../hooks/useAuth';
import { useUpdatePreferencesMutation } from '../../hooks/usePreferences';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useCanCheck } from '../../hooks/usePermission';
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
  const updatePrefs = useUpdatePreferencesMutation();
  const themePref = usePreferencesStore((s) => s.preferences.theme);
  const can = useCanCheck();
  const showSettingsLink =
    can('roles.list') || can('forms.view') || can('categories.list');

  // --- Dark mode toggle ---
  // The actual `dark` class is applied by the preferences store (via
  // ProtectedRoute hydration) and the standalone toggle below; this local
  // boolean is just used to pick which icon to render.
  const isDark =
    themePref === 'dark' ||
    (themePref === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches) ||
    (themePref === undefined &&
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'));

  // Fallback (pre-prefs hydration) — make sure the documentElement reflects
  // the value stored in localStorage so first paint isn't a flash.
  useEffect(() => {
    if (themePref) return;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [themePref]);

  const toggleTheme = () => {
    const next = isDark ? 'light' : 'dark';
    // Persist to user preferences (also updates store + DOM optimistically).
    updatePrefs.mutate({ theme: next });
  };

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

  // User dropdown
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        shopDropdownRef.current &&
        !shopDropdownRef.current.contains(e.target as Node)
      ) {
        setShopDropdownOpen(false);
      }
      if (
        userDropdownRef.current &&
        !userDropdownRef.current.contains(e.target as Node)
      ) {
        setUserDropdownOpen(false);
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
                  'flex items-center gap-2 whitespace-nowrap rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors',
                  'hover:bg-primary/15',
                )}
              >
                <Store className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{shopName}</span>
                {shopCode && (
                  <span className="whitespace-nowrap text-primary/70">({shopCode})</span>
                )}
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    shopDropdownOpen && 'rotate-180',
                  )}
                />
              </button>

              {shopDropdownOpen && (
                <div className="absolute left-0 z-50 mt-1 w-max min-w-[16rem] max-w-[24rem] rounded-md border bg-card shadow-lg">
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
                            'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors',
                            'hover:bg-muted',
                            shop.id === currentShopId && 'bg-primary/5',
                          )}
                        >
                          {shop.id === currentShopId ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : (
                            <div className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="whitespace-nowrap">{shop.name}</span>
                          <span className="whitespace-nowrap text-muted-foreground text-xs">
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
            <span className="flex items-center gap-2 whitespace-nowrap rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{shopName}</span>
              {shopCode && (
                <span className="whitespace-nowrap text-primary/70">({shopCode})</span>
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
            onClick={toggleTheme}
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

          {/* User dropdown — preferences, settings, logout */}
          <div className="relative" ref={userDropdownRef}>
            <button
              onClick={() => setUserDropdownOpen((open) => !open)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                userDropdownOpen && 'bg-muted',
              )}
              title={user?.fullName ?? 'Account'}
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="hidden sm:inline text-foreground max-w-[10rem] truncate">
                {user?.fullName}
              </span>
              <span className="hidden sm:inline rounded bg-muted px-1.5 py-0.5 text-xs uppercase font-medium text-muted-foreground">
                {user?.role}
              </span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  userDropdownOpen && 'rotate-180',
                )}
              />
            </button>

            {userDropdownOpen && (
              <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border bg-card shadow-lg">
                <div className="px-3 py-2 border-b">
                  <p className="text-sm font-medium truncate">{user?.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    @{user?.username}
                  </p>
                </div>
                <ul className="py-1">
                  <li>
                    <button
                      onClick={() => {
                        setUserDropdownOpen(false);
                        navigate('/preferences');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <Sliders className="h-4 w-4 text-muted-foreground" />
                      Preferences
                    </button>
                  </li>
                  {showSettingsLink && (
                    <li>
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          navigate('/settings');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        Settings
                      </button>
                    </li>
                  )}
                  <li className="border-t mt-1 pt-1">
                    <button
                      onClick={() => {
                        setUserDropdownOpen(false);
                        handleLogout();
                      }}
                      disabled={logoutMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-60"
                    >
                      {logoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4 text-muted-foreground" />
                      )}
                      Logout
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Breadcrumbs row */}
      <div className="px-6 pb-2">
        <Breadcrumbs />
      </div>
    </div>
  );
}
