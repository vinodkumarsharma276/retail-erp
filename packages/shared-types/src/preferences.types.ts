/**
 * Per-user preferences. Stored as JSONB on the `users` table. Fully optional
 * — when unset the app falls back to Indian-locale defaults.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export type DateFormatPreference =
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY-MM-DD'
  | 'DD-MMM-YYYY'
  | 'DD MMM YYYY';

export type TimeFormatPreference = '12h' | '24h';

export type NumberFormatPreference = 'indian' | 'international';

export type DensityPreference = 'comfortable' | 'compact';

export interface UserPreferences {
  theme?: ThemePreference;
  dateFormat?: DateFormatPreference;
  timeFormat?: TimeFormatPreference;
  currencySymbol?: string;
  numberFormat?: NumberFormatPreference;
  itemsPerPage?: 10 | 20 | 50 | 100;
  defaultLandingPage?: string;
  density?: DensityPreference;
  language?: 'en' | 'hi';
  notificationSound?: boolean;
  desktopNotifications?: boolean;
}

export const DEFAULT_USER_PREFERENCES: Required<
  Pick<
    UserPreferences,
    | 'theme'
    | 'dateFormat'
    | 'timeFormat'
    | 'currencySymbol'
    | 'numberFormat'
    | 'itemsPerPage'
    | 'density'
    | 'language'
    | 'notificationSound'
    | 'desktopNotifications'
  >
> = {
  theme: 'system',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12h',
  currencySymbol: '₹',
  numberFormat: 'indian',
  itemsPerPage: 20,
  density: 'comfortable',
  language: 'en',
  notificationSound: true,
  desktopNotifications: false,
};
