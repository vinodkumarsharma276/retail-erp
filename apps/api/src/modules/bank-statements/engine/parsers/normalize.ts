/** Low-level helpers for turning statement strings into numbers and ISO dates. */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type DateOrder = 'dmy' | 'mdy';

// Order matters: most specific first. Each captures the whole date token.
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, // 2024-03-31
  /\b(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})\b/, // 31-Mar-2024, 31 Mar 24, 31 March, 2024
  /\b([A-Za-z]{3,9})[ .-](\d{1,2}),?[ .-](\d{2,4})\b/, // Mar 31, 2024
  /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/, // 31/03/2024 or 03/31/2024
];

export const DATE_TOKEN = new RegExp(DATE_PATTERNS.map((r) => r.source).join('|'));

function fullYear(y: number) {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse a date string. `order` resolves ambiguous all-numeric dates like 03/04/2024. */
export function parseDate(input: unknown, order: DateOrder = 'dmy'): string | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return iso(input.getFullYear(), input.getMonth() + 1, input.getDate());
  }
  if (typeof input === 'number' && input > 20000 && input < 80000) {
    // Excel serial date
    const ms = Math.round((input - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = s.match(DATE_PATTERNS[0]);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(DATE_PATTERNS[1]);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(fullYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(DATE_PATTERNS[2]);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(fullYear(+m[3]), MONTHS[m[1].toLowerCase()], +m[2]);
  m = s.match(DATE_PATTERNS[3]);
  if (m) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
    return order === 'dmy' ? iso(y, b, a) : iso(y, a, b);
  }
  return null;
}

/** Decide dd/mm vs mm/dd from a sample of raw date strings. */
export function detectDateOrder(samples: string[], fallback: DateOrder = 'dmy'): DateOrder {
  let dmy = 0, mdy = 0;
  for (const s of samples) {
    const m = String(s).match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  return fallback;
}

/** Matches a money token: 1,23,456.78 | 1234.5 | (500.00) | -12.00 | 500.00 Cr | ₹ 99.00 */
export const AMOUNT_TOKEN =
  /(?:^|\s)(\(?-?(?:[₹$€£]|Rs\.?|INR|USD)?\s?-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\)?|\(?-?(?:[₹$€£]|Rs\.?|INR|USD)?\s?-?\d+\.\d{1,2}\)?)(?:\s?(Cr|Dr|CR|DR|cr|dr)\.?)?(?=\s|$)/g;

export interface ParsedAmount {
  value: number; // always positive magnitude unless the source was explicitly negative
  negative: boolean;
  drcr: 'dr' | 'cr' | null;
}

export function parseAmount(input: unknown): ParsedAmount | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return { value: Math.abs(input), negative: input < 0, drcr: null };
  }
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s === '-' || s === '--') return null;
  let drcr: ParsedAmount['drcr'] = null;
  const suffix = s.match(/\s*\b(cr|dr)\.?$/i);
  if (suffix) {
    drcr = suffix[1].toLowerCase() as 'dr' | 'cr';
    s = s.slice(0, suffix.index).trim();
  }
  const paren = /^\(.*\)$/.test(s);
  s = s.replace(/[()₹$€£\s]|Rs\.?|INR|USD/gi, '');
  const negative = paren || s.startsWith('-') || s.endsWith('-');
  s = s.replace(/-/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return { value: Number(s), negative, drcr };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function detectCurrency(text: string): string | null {
  const t = text.slice(0, 20000);
  const score: Record<string, number> = {
    INR: (t.match(/₹|\bINR\b|\bRs\.?\s?\d|\bIFSC\b|\bUPI\b|\bNEFT\b|\bIMPS\b/g) ?? []).length,
    USD: (t.match(/\$\s?\d|\bUSD\b|\bACH\b|\bZelle\b|\brouting\b/gi) ?? []).length,
    EUR: (t.match(/€|\bEUR\b|\bIBAN\b|\bSEPA\b/g) ?? []).length,
    GBP: (t.match(/£|\bGBP\b|\bsort code\b/gi) ?? []).length,
  };
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

/** Share of rows whose balance equals previous balance + amount. */
export function reconciliationRate(rows: { amount: number; balance: number | null }[]): number | null {
  let checked = 0, ok = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].balance, cur = rows[i].balance;
    if (prev == null || cur == null) continue;
    checked++;
    if (Math.abs(round2(prev + rows[i].amount) - cur) < 0.011) ok++;
  }
  return checked >= 3 ? ok / checked : null;
}
