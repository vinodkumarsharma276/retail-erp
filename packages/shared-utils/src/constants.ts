export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const PAGINATION_MAX_PAGE_SIZE = 100;

export const INTEREST_RATES = [0, 1, 1.5, 2, 2.5, 3] as const;
export const INSTALLMENT_MONTHS = [3, 6, 9, 12, 15, 18, 24] as const;

export const SEARCH_MIN_CHARS = 3;
export const DEBOUNCE_MS = 300;

export const JWT_ACCESS_EXPIRY = '15m';
export const JWT_REFRESH_EXPIRY = '7d';

export const SHOP_CODES = {
  VINOD_ELECTRONICS: 'VE',
  NAVEEN_ELECTRONICS: 'NE',
  VINOD_HOME_APPLIANCES: 'VHA',
  NEW_HARSHITA_ELECTRONICS: 'NHE',
} as const;
