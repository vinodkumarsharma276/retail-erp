import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePlatformLoginMutation } from '../../hooks/usePlatform';
import { usePlatformAuthStore } from '../../stores/platform-auth-store';

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const isAuthenticated = usePlatformAuthStore((s) => s.isAuthenticated);
  const loginMutation = usePlatformLoginMutation();

  // Redirect away from /login if already authenticated.
  useEffect(() => {
    if (isAuthenticated) navigate('/tenants', { replace: true });
  }, [isAuthenticated, navigate]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (data) => {
          usePlatformAuthStore
            .getState()
            .login(data.platformUser, data.accessToken, data.refreshToken);
          navigate('/tenants', { replace: true });
        },
      },
    );
  };

  const errorMessage = loginMutation.error
    ? (loginMutation.error as any)?.response?.data?.error ??
      (loginMutation.error as any)?.response?.data?.message ??
      'Invalid credentials. Please try again.'
    : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-amber-500/5" />
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-xl shadow-black/5 dark:shadow-black/20">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-600 shadow-sm mb-4">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">RetailERP Platform</h1>
          <p className="text-sm text-muted-foreground mt-1">Operator console</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="platform_admin"
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-amber-500/50',
              )}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 pr-10 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-amber-500/50',
                )}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loginMutation.isPending || !username.trim() || !password}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-4 py-2.5 text-sm font-medium text-white',
              'hover:bg-amber-700 transition-colors',
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
