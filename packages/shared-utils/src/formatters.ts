/**
 * Module-level format configuration. Web app calls `setFormatPreferences()`
 * after the user logs in (or whenever preferences change) so every existing
 * `formatINR` / `formatDateIN` call site instantly honours user preferences
 * without having to refactor every caller.
 */
type DateFormatToken =
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'YYYY-MM-DD'
  | 'DD-MMM-YYYY'
  | 'DD MMM YYYY';

type NumberFormatPref = 'indian' | 'international';

interface FormatPreferences {
  currencySymbol: string;
  dateFormat: DateFormatToken;
  numberFormat: NumberFormatPref;
}

const formatPreferences: FormatPreferences = {
  currencySymbol: '₹',
  dateFormat: 'DD/MM/YYYY',
  numberFormat: 'indian',
};

export function setFormatPreferences(prefs: Partial<FormatPreferences>): void {
  if (prefs.currencySymbol !== undefined && prefs.currencySymbol.length > 0) {
    formatPreferences.currencySymbol = prefs.currencySymbol;
  }
  if (prefs.dateFormat) {
    formatPreferences.dateFormat = prefs.dateFormat;
  }
  if (prefs.numberFormat) {
    formatPreferences.numberFormat = prefs.numberFormat;
  }
}

export function getFormatPreferences(): Readonly<FormatPreferences> {
  return formatPreferences;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Format number as Indian Rupees: ₹12,34,567.00 (currency symbol/grouping configurable). */
export function formatINR(amount: number): string {
  const locale = formatPreferences.numberFormat === 'international' ? 'en-US' : 'en-IN';
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatPreferences.currencySymbol}${formatted}`;
}

/** Format date according to user-preferred date format (default DD/MM/YYYY). */
export function formatDateIN(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mmm = MONTHS_SHORT[date.getMonth()];
  switch (formatPreferences.dateFormat) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD-MMM-YYYY':
      return `${dd}-${mmm}-${yyyy}`;
    case 'DD MMM YYYY':
      return `${dd} ${mmm} ${yyyy}`;
    case 'DD/MM/YYYY':
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** Format Aadhaar as XXXX-XXXX-XXXX */
export function formatAadhaar(aadhaar: string): string {
  const clean = aadhaar.replace(/\s|-/g, '');
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

/** Format phone as +91 XXXXX XXXXX */
export function formatPhone(phone: string): string {
  const clean = phone.replace(/\s|-/g, '');
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return phone;
}

function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Current Indian financial year date range (April 1 to March 31). */
export function getCurrentFinancialYearRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    dateFrom: toLocalDateInputValue(new Date(startYear, 3, 1)),
    dateTo: toLocalDateInputValue(new Date(startYear + 1, 2, 31)),
  };
}

/** Previous Indian financial year date range (April 1 to March 31). */
export function getLastFinancialYearRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const currentStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const startYear = currentStartYear - 1;
  return {
    dateFrom: toLocalDateInputValue(new Date(startYear, 3, 1)),
    dateTo: toLocalDateInputValue(new Date(startYear + 1, 2, 31)),
  };
}

/**
 * Indian financial year for a given date. Returns the start calendar year
 * — e.g. 2025-04-01..2026-03-31 → 2025. Accepts a Date, ISO string, or
 * `YYYY-MM-DD` input value. Returns `null` for invalid inputs.
 */
export function getFinancialYearForDate(input: Date | string | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

/** Human-readable FY label, e.g. `FY 2025-26`. */
export function formatFinancialYearLabel(startYear: number): string {
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `FY ${startYear}-${end}`;
}
