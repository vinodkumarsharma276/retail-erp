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

/**
 * Native `<input type="date">` renders the date in the browser's UI locale,
 * but Chromium-based browsers respect the `lang` attribute on `<html>`. By
 * mapping the user's date-format preference to a sensible BCP-47 locale we
 * get the input to display in the user's preferred order without rolling
 * our own date picker. Firefox/Safari may still ignore this — but the
 * underlying value (always YYYY-MM-DD) is unaffected, so submission works.
 */
function applyDocumentLang(dateFormat: UserPreferences['dateFormat']): void {
  const fmt = dateFormat ?? DEFAULT_USER_PREFERENCES.dateFormat;
  const lang =
    fmt === 'MM/DD/YYYY'
      ? 'en-US'
      : fmt === 'YYYY-MM-DD'
        ? 'en-CA'
        : 'en-IN'; // DD/MM/YYYY, DD-MMM-YYYY, DD MMM YYYY all use day-first
  document.documentElement.setAttribute('lang', lang);
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
    applyDocumentLang(next.dateFormat);
    set({ preferences: next });
  },
  patch: (partial) => {
    const next = { ...get().preferences, ...partial };
    applyToFormatters(next);
    if (partial.theme !== undefined) applyTheme(next.theme);
    if (partial.dateFormat !== undefined) applyDocumentLang(next.dateFormat);
    set({ preferences: next });
  },
}));
