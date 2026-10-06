import type { ThemePreference } from '@retailerp/shared-types';

/**
 * Three looks: Light, Dim (in between) and Dark. Dim is applied as
 * `<html class="dark dim">` so every `dark:` style still applies and the
 * `.dark.dim` tokens in index.css soften it. The resolved theme is kept in
 * localStorage so index.html can apply it before first paint.
 */
export type ResolvedTheme = 'light' | 'dim' | 'dark';

export const THEME_ORDER: ResolvedTheme[] = ['light', 'dim', 'dark'];

export const THEME_LABEL: Record<ResolvedTheme, string> = {
  light: 'Light',
  dim: 'Dim',
  dark: 'Dark',
};

export function resolveTheme(pref: ThemePreference | string | null | undefined): ResolvedTheme {
  if (pref === 'light' || pref === 'dim' || pref === 'dark') return pref;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme !== 'light');
  root.classList.toggle('dim', theme === 'dim');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // storage unavailable (private mode) — the class is still applied
  }
}

/** The theme currently on the page. */
export function currentTheme(): ResolvedTheme {
  const root = document.documentElement;
  if (root.classList.contains('dim')) return 'dim';
  return root.classList.contains('dark') ? 'dark' : 'light';
}

/** Light → Dim → Dark → Light. */
export function nextTheme(theme: ResolvedTheme): ResolvedTheme {
  return THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
}
