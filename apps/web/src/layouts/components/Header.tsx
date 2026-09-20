import { useState, useRef, useEffect } from 'react';
import {
  LogOut,
  User,
  Bell,
  ChevronDown,
  Store,
  Globe,
  Loader2,
  Check,
  Menu,
  Sun,
  Moon,
  Settings,
  Sliders,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore, ALL_SHOPS_SENTINEL, isAllShops } from '../../stores/shop-store';
import { useSidebarStore } from '../../stores/sidebar-store';
import { useToastStore } from '../../stores/toast-store';
import { useNavigate } from 'react-router-dom';
import { useMeQuery, useLogoutMutation, useSwitchShopMutation } from '../../hooks/useAuth';
import { useUpdatePreferencesMutation } from '../../hooks/usePreferences';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useCanCheck } from '../../hooks/usePermission';
import { queryClient } from '../../lib/query-client';
import { cn } from '../../lib/utils';
import { UserRole } from '@retailerp/shared-types';
import { GlobalSearch } from './GlobalSearch';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const shopName = useShopStore((s) => s.currentShopName);
  const shopCode = useShopStore((s) => s.currentShopCode);
  const currentShopId = useShopStore((s) => s.currentShopId);
  const setShop = useShopStore((s) => s.setShop);
  const loginStore = useAuthStore((s) => s.login);
  const addToast = useToastStore((s) => s.addToast);
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

    const targetShop = availableShops.find((s) => s.id === shopId);

    switchShopMutation.mutate(shopId, {      onSuccess: (data) => {
        // Update token — the switch-shop endpoint returns a new accessToken.
        // We update localStorage directly so the api-client interceptor
        // picks it up on the very next request, and call loginStore so the
        // in-memory auth state stays in sync. We pass the existing
        // permissions Set as an array so they aren't wiped — the
        // background /auth/me refetch (triggered by invalidateQueries
        // below) will refresh them, but in the meantime guards/sidebar
        // keep working.
        const refreshToken = localStorage.getItem('refreshToken') ?? '';
        if (user) {
          const currentPerms = Array.from(useAuthStore.getState().permissions);
          loginStore(user, data.accessToken, refreshToken, currentPerms);
        }
        localStorage.setItem('accessToken', data.accessToken);

        // Update shop in store + localStorage (the api-client interceptor
        // reads X-Shop-Id from localStorage on every request).
        setShop(data.shop.id, data.shop.name, data.shop.code);

        // Reset every query in the cache. resetQueries() is the right tool
        // here (vs. invalidateQueries / removeQueries):
        //   - removeQueries  → drops cached data but does NOT refetch
        //                      active observers, so pages with
        //                      placeholderData / keepPreviousData just
        //                      keep showing stale data until a manual
        //                      refresh.
        //   - invalidateQueries → marks stale; observers refetch but
        //                      cached data is shown in the meantime,
        //                      causing a flash of the previous shop's
        //                      data on Products / Sales / Installments.
        //   - resetQueries  → cancels in-flight fetches, drops cached
        //                      data, AND immediately refetches every
        //                      active observer with the new X-Shop-Id
        //                      header. This is the "switch shops, see
        //                      new data instantly" behaviour we want.
        queryClient.resetQueries();

        addToast({
          type: 'success',
          message: `Switched to ${data.shop.name}`,
        });

        setShopDropdownOpen(false);
      },
      onError: (err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const apiMsg =
          (err as { response?: { data?: { error?: string; message?: string } } })
            ?.response?.data?.error ??
          (err as { response?: { data?: { error?: string; message?: string } } })
            ?.response?.data?.message;
        const message =
          status === 403
            ? `You don't have access to ${targetShop?.name ?? 'that shop'}.`
            : apiMsg ?? 'Failed to switch shop. Please try again.';
        addToast({ type: 'error', message });
        setShopDropdownOpen(false);
      },
    });
  };

  /**
   * Switch to "All Shops" mode. Unlike single-shop switching this is a
   * purely client-side change — no token rotation needed because:
   *
   *   - Every read endpoint already authenticates via JWT, and the
   *     `shopScope` middleware reads the `X-Shop-Id` header (which we
   *     send as the sentinel `'all'` from the api-client when
   *     currentShopId === 'all'). The middleware itself enforces the
   *     `shops.view_all` permission server-side, so a malicious client
   *     can't escalate just by setting the header.
   *   - Write endpoints in All-Shops mode are gated by the UI (see
   *     ProductListPage / sale-creation flows). They aren't disabled
   *     server-side because they continue to use the JWT's bound
   *     shopId; sending writes while in All Shops mode would still
   *     write to the user's primary shop, which is confusing UX —
   *     hence the UI-level guard.
   */
  const handleAllShopsSelect = () => {
    if (isAllShops(currentShopId)) {
      setShopDropdownOpen(false);
      return;
    }
    setShop(ALL_SHOPS_SENTINEL, 'All Shops', 'ALL');
    queryClient.resetQueries();
    addToast({ type: 'success', message: 'Switched to All Shops view' });
    setShopDropdownOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 flex h-header shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {/* Mobile menu toggle */}
        <button
          onClick={openSidebar}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* The tenant name used to be repeated here as an "ORG …" label; it
            now lives under the logo in the sidebar, so the header carries
            only the thing the user actually switches: the active shop. */}

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
                {isAllShops(currentShopId) ? (
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Store className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="whitespace-nowrap">{shopName}</span>
                {shopCode && !isAllShops(currentShopId) && (
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
                    {/* All Shops — read-only aggregated view, gated by
                        the `shops.view_all` permission. Shown above
                        individual shops so it's easy to find. */}
                    {can('shops.view_all') && (
                      <li>
                        <button
                          onClick={handleAllShopsSelect}
                          className={cn(
                            'flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors border-b',
                            'hover:bg-muted',
                            isAllShops(currentShopId) && 'bg-primary/5',
                          )}
                        >
                          {isAllShops(currentShopId) ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                          ) : (
                            <div className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="whitespace-nowrap font-medium">All Shops</span>
                          <span className="whitespace-nowrap text-muted-foreground text-xs">
                            (read-only)
                          </span>
                        </button>
                      </li>
                    )}
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

      <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Global search — hidden for now, enable when needed */}
          {/* <GlobalSearch /> */}

          {/* Notification bell placeholder */}
          <button
            className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={toggleTheme}
            className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Separator */}
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

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
  );
}
