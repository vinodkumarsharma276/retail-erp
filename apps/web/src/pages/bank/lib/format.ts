const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, make: () => Intl.NumberFormat) {
  let f = cache.get(key);
  if (!f) cache.set(key, (f = make()));
  return f;
}
const localeFor = (currency: string) => (currency === 'INR' ? 'en-IN' : 'en-US');

/** ₹1,23,456.78 */
export function money(n: number, currency = 'INR', decimals = 2) {
  return nf(`m${currency}${decimals}`, () =>
    new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  ).format(n);
}

/** ₹1.2L / ₹3.4Cr for INR, $1.2M otherwise. */
export function compactMoney(n: number, currency = 'INR') {
  return nf(`c${currency}`, () =>
    new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }),
  ).format(n);
}

export function compactNumber(n: number, currency = 'INR') {
  return nf(`n${currency}`, () => new Intl.NumberFormat(localeFor(currency), { notation: 'compact', maximumFractionDigits: 1 })).format(n);
}

export function count(n: number) {
  return nf('count', () => new Intl.NumberFormat('en-IN')).format(n);
}

export function pct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-06-01 -> 1 Jun 2026 (no timezone shifting). */
export function date(iso: string | null | undefined, withYear = true) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/** 2026-06 -> Jun '26 */
export function month(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
