import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShopsQuery, useLoginMutation } from '../../hooks/useAuth';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore } from '../../stores/shop-store';
import { UserRole } from '@retailerp/shared-types';
// Note: login/setShop called via getState() to avoid re-render loops
import type { ShopListItem } from '@retailerp/shared-types';
import {
  ChevronDown,
  Loader2,
  Store,
  AlertCircle,
  Eye,
  EyeOff,
  ShoppingCart,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getDefaultRoute } from '../../routes/ProtectedRoute';

export function LoginPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  // Redirect if already authenticated (user object must exist, not just token)
  useEffect(() => {
    if (isAuthenticated && user) {
      navigate(getDefaultRoute(user.role), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  // --- Step state ---
  const [selectedShop, setSelectedShop] = useState<ShopListItem | null>(null);
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false);

  // --- Form state ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // --- API ---
  const shopsQuery = useShopsQuery();
  const loginMutation = useLoginMutation();

  // Whether to show the credentials step (after shop selection)
  const showCredentials = !!selectedShop;

  const handleShopSelect = (shop: ShopListItem) => {
    setSelectedShop(shop);
    setShopDropdownOpen(false);
    // Reset form when switching shops
    setUsername('');
    setPassword('');
    loginMutation.reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShop) return;

    loginMutation.mutate(
      {
        username: username.trim(),
        password,
        shopId: selectedShop.id,
      },
      {
        onSuccess: (data) => {
          // Check if user is mobile-only
          if (data.user.isMobileOnly || data.user.role === UserRole.EMPLOYEE) {
            loginMutation.reset();
            // We set a special error to show the mobile-only message
            setMobileOnlyError(true);
            return;
          }

          // Store tokens and user
          useAuthStore.getState().login(
            {
              id: data.user.id,
              username: data.user.username,
              fullName: data.user.fullName,
              role: data.user.role,
              isMobileOnly: data.user.isMobileOnly,
            },
            data.accessToken,
            data.refreshToken,
          );

          // Store shop
          useShopStore.getState().setShop(data.shop.id, data.shop.name, data.shop.code);

          // Redirect
          navigate(getDefaultRoute(data.user.role), { replace: true });
        },
      },
    );
  };

  const [mobileOnlyError, setMobileOnlyError] = useState(false);

  // Extract error message from mutation
  const errorMessage = mobileOnlyError
    ? 'Please use the mobile app'
    : loginMutation.error
      ? (loginMutation.error as any)?.response?.data?.error ??
        (loginMutation.error as any)?.response?.data?.message ??
        'Invalid credentials. Please try again.'
      : null;

  return (
    <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
      {/* Logo / Title */}
      <div className="flex flex-col items-center mb-8">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingCart className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold">RetailERP</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your shop
        </p>
      </div>

      {/* Step 1: Shop Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-1.5">
          Select Shop
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShopDropdownOpen(!shopDropdownOpen)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border bg-background px-3 py-2.5 text-sm transition-colors',
              'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              shopDropdownOpen && 'border-primary ring-2 ring-ring ring-offset-2',
            )}
          >
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              {selectedShop ? (
                <span>
                  {selectedShop.name}{' '}
                  <span className="text-muted-foreground">
                    ({selectedShop.code})
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">Choose a shop...</span>
              )}
            </div>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                shopDropdownOpen && 'rotate-180',
              )}
            />
          </button>

          {/* Dropdown */}
          {shopDropdownOpen && (
            <div className="absolute z-10 mt-1 w-full rounded-md border bg-card shadow-lg">
              {shopsQuery.isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading shops...
                  </span>
                </div>
              ) : shopsQuery.isError ? (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Failed to load shops
                </div>
              ) : shopsQuery.data?.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  No shops available
                </div>
              ) : (
                <ul className="max-h-48 overflow-y-auto py-1">
                  {shopsQuery.data?.map((shop) => (
                    <li key={shop.id}>
                      <button
                        type="button"
                        onClick={() => handleShopSelect(shop)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                          'hover:bg-muted',
                          selectedShop?.id === shop.id && 'bg-primary/10 text-primary',
                        )}
                      >
                        <Store className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{shop.name}</span>
                        <span className="text-muted-foreground">
                          ({shop.code})
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Username + Password (slides in after shop selection) */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          showCredentials
            ? 'max-h-[500px] opacity-100'
            : 'max-h-0 opacity-0',
        )}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-1.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setMobileOnlyError(false);
              }}
              placeholder="Enter your username"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setMobileOnlyError(false);
                }}
                placeholder="Enter your password"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 pr-10 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={
              loginMutation.isPending ||
              !username.trim() ||
              !password
            }
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
