import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, SunMoon, Moon } from 'lucide-react';
import { THEME_LABEL, applyResolvedTheme, nextTheme, resolveTheme, type ResolvedTheme } from '../lib/theme';

export function AuthLayout() {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(localStorage.getItem('theme')));

  useEffect(() => {
    applyResolvedTheme(theme);
  }, [theme]);

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dim' ? SunMoon : Moon;
  const themeTitle = `Theme: ${THEME_LABEL[theme]} — switch to ${THEME_LABEL[nextTheme(theme)]}`;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Theme toggle in top-right corner */}
      <button
        onClick={() => setTheme(nextTheme(theme))}
        className="absolute top-4 right-4 z-10 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={themeTitle}
        aria-label={themeTitle}
      >
        <ThemeIcon className="h-4 w-4" />
      </button>

      {/* Content */}
      <div className="relative z-10">
        <Outlet />
      </div>
    </div>
  );
}
