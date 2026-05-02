import { create } from 'zustand';
import { setFormatPreferences } from '@retailerp/shared-utils';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from '@retailerp/shared-types';

interface PreferencesState {
  preferences: UserPreferences;
  setPreferences: (prefs: UserPreferences | null | undefined) => void;
  patch: (partial: Partial<UserPreferences>) => void;
}

function applyToFormatters(prefs: UserPreferences): void {
  setFormatPreferences({
    currencySymbol: prefs.currencySymbol ?? DEFAULT_USER_PREFERENCES.currencySymbol,
    dateFormat: prefs.dateFormat ?? DEFAULT_USER_PREFERENCES.dateFormat,
    numberFormat: prefs.numberFormat ?? DEFAULT_USER_PREFERENCES.numberFormat,
  });
}

function applyTheme(theme: UserPreferences['theme']): void {
  const resolved =
    theme === 'system' || !theme
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
}

function withDefaults(prefs: UserPreferences | null | undefined): UserPreferences {
  return { ...DEFAULT_USER_PREFERENCES, ...(prefs ?? {}) };
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: { ...DEFAULT_USER_PREFERENCES },
  setPreferences: (prefs) => {
    const next = withDefaults(prefs);
    applyToFormatters(next);
    applyTheme(next.theme);
    set({ preferences: next });
  },
  patch: (partial) => {
    const next = { ...get().preferences, ...partial };
    applyToFormatters(next);
    if (partial.theme !== undefined) applyTheme(next.theme);
    set({ preferences: next });
  },
}));
