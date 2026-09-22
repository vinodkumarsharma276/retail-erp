import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLoginMutation } from '../../hooks/useAuth';
import { useAuthStore } from '../../stores/auth-store';
import { useShopStore } from '../../stores/shop-store';
import { useTenantStore } from '../../stores/tenant-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { UserRole } from '@retailerp/shared-types';
// Note: login/setShop called via getState() to avoid re-render loops
import {
  Loader2,
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
      const pref = usePreferencesStore.getState().preferences.defaultLandingPage;
      navigate(getDefaultRoute(user.role, pref), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  // --- Form state ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // --- API ---
  const loginMutation = useLoginMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    loginMutation.mutate(
      {
        username: username.trim(),
        password,
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
              roleId: (data.user as any).roleId ?? null,
              isMobileOnly: data.user.isMobileOnly,
            },
            data.accessToken,
            data.refreshToken,
            (data as any).permissions ?? [],
          );

          // Store tenant context + feature snapshot for header chrome
          // and useFeature() gates throughout the app.
          useTenantStore.getState().setTenant(data.tenant, data.features);

          // Store shop
          useShopStore.getState().setShop(data.shop.id, data.shop.name, data.shop.code);

          // Hydrate user preferences (theme, currency, default landing, etc.)
          const prefsFromLogin = (data.user as any).preferences ?? null;
          usePreferencesStore.getState().setPreferences(prefsFromLogin);

          // Redirect — preferred landing page wins over role default
          navigate(
            getDefaultRoute(
              data.user.role,
              prefsFromLogin?.defaultLandingPage ?? null,
            ),
            { replace: true },
          );
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
    <div className="w-full max-w-3xl rounded-2xl border bg-card p-8 sm:p-10 shadow-xl shadow-black/5 dark:shadow-black/20">
      {/* Logo / Title */}
      <div className="flex flex-col items-center mb-12">
        <div className="flex items-center gap-4 mb-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <ShoppingCart className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight">RetailERP</h1>
        </div>
        {/* Show the cached tenant name if we've logged in before on this
            subdomain — gives the user immediate "this is my org" feedback. */}
        {(() => {
          const tenantName = useTenantStore.getState().tenantName;
          return tenantName ? (
            <p className="text-lg text-muted-foreground">
              Sign in to <span className="font-medium text-foreground">{tenantName}</span>
            </p>
          ) : (
            <p className="text-lg text-muted-foreground">Sign in to manage your shop</p>
          );
        })()}
      </div>

      <div>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div>
            <label
              htmlFor="username"
              className="block text-base font-medium mb-2"
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
                'w-full rounded-lg border bg-field px-4 py-3.5 text-base',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              )}
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-base font-medium mb-2"
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
                  'w-full rounded-lg border bg-field px-4 py-3.5 pr-12 text-base',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-base text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
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
              'flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3.5 text-base font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
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
