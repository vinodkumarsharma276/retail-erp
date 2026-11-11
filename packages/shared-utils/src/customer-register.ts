/**
 * The shops' account register, as kept on a Google Sheet before it moved into
 * Customer Searching:
 *
 *   Account Number | CUSTOMER_NAME | Address | Mobile | CO | CO_Mobile | AREA |
 *   Purchase_Date | Product | Brand | Model | Shop
 *
 * Shared by the import screen (reads the file in the browser) and the API
 * (checks and saves it), so both sides read a row the same way.
 */
import { headingKey, parseSheetDate } from './purchase-sheet';
import { isValidPhone } from './validators';

// --- Account numbers --------------------------------------------------------

/** Upper-case, no spaces: " bd- 33 " → "BD-33". */
export function normalizeAccountNumber(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '');
}

export interface ParsedAccountNumber {
  accountNumber: string;
  /** The series letters, with a sub-series digit when there is one ("BD", "CI2"); '' when none. */
  prefix: string;
  /** What sits between the series and its number in this account number: "-", "." or "". */
  separator: string;
  /** The number within the series; null when the account number isn't a series shape. */
  seriesNo: number | null;
}

/**
 * The shapes the register uses: BD-1, CI2-421 (sub-series 2 of CI), BN.596,
 * BD-406A / DF-738(A) (a second sale under one number), and MJ12.
 * A digit right after the letters only belongs to the series when a
 * separator follows it, so "MJ12" is MJ + 12, not MJ1 + 2.
 */
const SERIES = /^(?:([A-Z]{1,3}\d?)([-.])|([A-Z]{1,3}))(\d{1,9})(?:[A-Z]|\([A-Z]\))?$/;

export function parseAccountNumber(value: unknown): ParsedAccountNumber {
  const accountNumber = normalizeAccountNumber(value);
  const match = SERIES.exec(accountNumber);
  if (match) {
    return {
      accountNumber,
      prefix: match[1] ?? match[3],
      separator: match[2] ?? '',
      seriesNo: Number(match[4]),
    };
  }
  const letters = /^[A-Z]+/.exec(accountNumber)?.[0] ?? '';
  return { accountNumber, prefix: letters.slice(0, 10), separator: '', seriesNo: null };
}

/** A prefix someone types for a new series: 1-3 letters, optionally one digit (CI2). */
export function isValidAccountPrefix(prefix: string): boolean {
  return /^[A-Z]{1,3}\d?$/.test(normalizeAccountNumber(prefix));
}

/** New series are written like the register's own: letters, hyphen, number (BD-1). */
export const DEFAULT_ACCOUNT_SEPARATOR = '-';

/**
 * The number after the highest one in a series, written the way that series
 * already writes its numbers: same separator (BD-12 → BD-13, MJ12 → MJ13) and
 * same zero-padding (MJ009 → MJ010).
 */
export function nextAccountNumber(
  prefix: string,
  last: { accountNumber: string; seriesNo: number | null } | null,
): string {
  const p = normalizeAccountNumber(prefix);
  if (!last || last.seriesNo == null) return `${p}${DEFAULT_ACCOUNT_SEPARATOR}1`;
  const parsed = parseAccountNumber(last.accountNumber);
  const digits = /\d+/.exec(last.accountNumber.slice(p.length + parsed.separator.length))?.[0] ?? '';
  const next = String(last.seriesNo + 1);
  const number = digits.startsWith('0') ? next.padStart(digits.length, '0') : next;
  return `${p}${parsed.separator}${number}`;
}

// --- Mobiles ----------------------------------------------------------------

/** Last ten digits, or '' when there aren't ten. "+91 98765-43210" → "9876543210". */
export function normalizeMobile(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function isValidMobile(value: unknown): boolean {
  const mobile = normalizeMobile(value);
  return mobile !== '' && isValidPhone(mobile);
}

// --- Person names -----------------------------------------------------------

const HONORIFICS = /\b(mr|mrs|ms|miss|smt|shri|shree|sri|sh|dr|late)\b/g;

/** Tidy for display: single spaces, trimmed. Keeps the spelling and case as written. */
export function tidyName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Lower-case letters only, honorifics dropped. Two names with the same key are the same name. */
export function personNameKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(HONORIFICS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a: string, b: string) => (a || b ? 1 - editDistance(a, b) / Math.max(a.length, b.length) : 1);

/**
 * How alike two people's names are, 0 to 1, for names already known to share
 * a mobile number.
 *
 * Letters, not meaning: "Jitender" / "Jitendra" score high, "Ramesh Kumar" /
 * "Suresh Kumar" score low because the first names differ — the first name
 * caps the score. A name that is the other with a word missing ("Jitender" /
 * "Jitender Kumar") counts as close.
 */
export function personNameScore(a: string, b: string): number {
  const left = personNameKey(a);
  const right = personNameKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const lt = left.split(' ');
  const rt = right.split(' ');
  const first = ratio(lt[0], rt[0]);
  let full = ratio(left, right);
  const [short, long] = lt.length <= rt.length ? [lt, rt] : [rt, lt];
  if (short.length < long.length && short.every((t, i) => t === long[i])) full = Math.max(full, 0.8);
  return Math.min(first, full);
}

/** At or above: the same person spelled twice, no need to ask. */
export const SAME_PERSON_SCORE = 0.85;
/** Between this and SAME_PERSON_SCORE: worth asking a model. */
export const MAYBE_SAME_PERSON_SCORE = 0.5;
/** Without a model, borderline pairs at or above this are suggested as one person. */
export const FALLBACK_SAME_PERSON_SCORE = 0.7;

// --- The sheet --------------------------------------------------------------

export type RegisterField =
  | 'accountNumber'
  | 'customerName'
  | 'address'
  | 'mobile'
  | 'coName'
  | 'coMobile'
  | 'area'
  | 'purchaseDate'
  | 'product'
  | 'brand'
  | 'model'
  | 'shop';

export interface RegisterColumn {
  field: RegisterField;
  label: string;
  required: boolean;
  /** Headings seen for this field, as `headingKey` writes them. */
  headings: string[];
}

export const REGISTER_COLUMNS: RegisterColumn[] = [
  { field: 'accountNumber', label: 'Account Number', required: true, headings: ['account number', 'account no', 'acc no', 'a c no', 'id'] },
  { field: 'customerName', label: 'Customer Name', required: true, headings: ['customer name', 'name', 'customer'] },
  { field: 'address', label: 'Address', required: false, headings: ['address', 'customer address'] },
  { field: 'mobile', label: 'Mobile', required: true, headings: ['mobile', 'mobile no', 'mobile number', 'phone', 'contact no'] },
  { field: 'coName', label: 'Co-applicant', required: false, headings: ['co', 'co name', 'co applicant', 'guarantor'] },
  { field: 'coMobile', label: 'Co-applicant Mobile', required: false, headings: ['co mobile', 'co mobile no', 'co applicant mobile', 'guarantor mobile'] },
  { field: 'area', label: 'Area', required: false, headings: ['area', 'locality', 'village'] },
  { field: 'purchaseDate', label: 'Purchase Date', required: false, headings: ['purchase date', 'date', 'sale date'] },
  { field: 'product', label: 'Product', required: false, headings: ['product', 'item', 'type level 1'] },
  { field: 'brand', label: 'Brand', required: false, headings: ['brand', 'company', 'make'] },
  { field: 'model', label: 'Model', required: false, headings: ['model', 'model no', 'model number'] },
  { field: 'shop', label: 'Shop', required: false, headings: ['shop', 'shop name', 'branch'] },
];

/** A row as read from the file, before any checking. Values are trimmed strings. */
export interface RegisterSheetRow {
  /** Row number in the spreadsheet (the heading row is 1 when it's first). */
  sheetRow: number;
  /** 1 for the first record under the heading row. Ranges are picked on this. */
  recordNo: number;
  accountNumber: string;
  customerName: string;
  address: string;
  mobile: string;
  coName: string;
  coMobile: string;
  area: string;
  /** ISO date when it could be read; the raw text otherwise (flagged for review). */
  purchaseDate: string;
  product: string;
  brand: string;
  model: string;
  /** Shop name or code as written; blank means the import's default shop. */
  shop: string;
}

export interface RegisterSheetParse {
  rows: RegisterSheetRow[];
  /** Required headings the sheet doesn't have. */
  missing: string[];
  /** Spreadsheet row of the heading row (1-based); 0 when none was found. */
  headerRow: number;
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return parseSheetDate(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

function readDate(value: unknown): string {
  if (value == null || value === '') return '';
  return parseSheetDate(value) || cell(value);
}

/**
 * Read the register out of a sheet's rows (as `XLSX.utils.sheet_to_json`
 * with `header: 1` gives them). The heading row is the first of the top ten
 * that names an account number; blank rows are dropped.
 */
export function parseRegisterSheet(rows: unknown[][]): RegisterSheetParse {
  let headerIndex = -1;
  let map: Partial<Record<RegisterField, number>> = {};
  let productFallback = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headings = (rows[i] ?? []).map(headingKey);
    const found: Partial<Record<RegisterField, number>> = {};
    for (const col of REGISTER_COLUMNS) {
      // Headings are tried in the order listed, so a preferred one wins
      // wherever it sits in the sheet.
      for (const name of col.headings) {
        const at = headings.indexOf(name);
        if (at >= 0) {
          found[col.field] = at;
          break;
        }
      }
    }
    if (found.accountNumber !== undefined) {
      headerIndex = i;
      map = found;
      // An exported register names its type "Product Type" (the whole path) beside
      // "Type Level 1"; the path stands in when the level is blank (an untyped row).
      productFallback = headings.indexOf('product type');
      break;
    }
  }
  if (headerIndex < 0) {
    return { rows: [], missing: REGISTER_COLUMNS.filter((c) => c.required).map((c) => c.label), headerRow: 0 };
  }

  const missing = REGISTER_COLUMNS.filter((c) => c.required && map[c.field] === undefined).map((c) => c.label);
  const get = (row: unknown[], field: RegisterField) => (map[field] === undefined ? undefined : row[map[field]!]);

  const out: RegisterSheetRow[] = [];
  let recordNo = 0;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    // A shop name alone (a column filled down past the data) is not a record.
    if (row.every((v, c) => c === map.shop || cell(v) === '')) continue;
    recordNo += 1;
    out.push({
      sheetRow: i + 1,
      recordNo,
      accountNumber: cell(get(row, 'accountNumber')),
      customerName: cell(get(row, 'customerName')),
      address: cell(get(row, 'address')),
      mobile: cell(get(row, 'mobile')),
      coName: cell(get(row, 'coName')),
      coMobile: cell(get(row, 'coMobile')),
      area: cell(get(row, 'area')),
      purchaseDate: readDate(get(row, 'purchaseDate')),
      product: cell(get(row, 'product')) || (productFallback >= 0 ? cell(row[productFallback]) : ''),
      brand: cell(get(row, 'brand')),
      model: cell(get(row, 'model')),
      shop: cell(get(row, 'shop')),
    });
  }
  return { rows: out, missing, headerRow: headerIndex + 1 };
}

// --- Review -----------------------------------------------------------------

/**
 * What can be wrong with a register entry. Entries are saved anyway (the
 * sheet is what it is) and listed under "Needs review" by problem.
 */
export const REGISTER_ISSUES = {
  duplicate_account: 'Account number used more than once',
  missing_account: 'No account number',
  odd_account: 'Account number in an unusual format',
  missing_name: 'No customer name',
  missing_mobile: 'No mobile number',
  invalid_mobile: 'Mobile number not valid',
  missing_date: 'No purchase date',
  invalid_date: 'Purchase date not readable',
  future_date: 'Purchase date is in the future',
  co_incomplete: 'Co-applicant details incomplete',
  no_product_type: 'No product type',
  items_unknown: 'Several items, details unknown',
} as const;

export type RegisterIssue = keyof typeof REGISTER_ISSUES;
export const REGISTER_ISSUE_CODES = Object.keys(REGISTER_ISSUES) as RegisterIssue[];

/**
 * A Product cell that gives a count instead of the goods ("2 ITEM", "3ITEM",
 * "2 ITEN", "ALL ITEM"): how many (or 'all'); null when it names goods or
 * counts fewer than two.
 */
export function countOnlyProduct(text: string | null | undefined): number | 'all' | null {
  const t = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const m = /^(\d{1,3}|ALL)\s*ITE[MN]S?$/.exec(t);
  if (!m) return null;
  if (m[1] === 'ALL') return 'all';
  const n = Number(m[1]);
  return n >= 2 ? n : null;
}

/** No digits at all ("XXXXX", "NO MOBILE", blank) is missing; digits that aren't a mobile are invalid. */
export function mobileProblem(value: unknown): 'missing' | 'invalid' | null {
  const text = String(value ?? '').trim();
  if (!/\d/.test(text)) return 'missing';
  return isValidMobile(text) ? null : 'invalid';
}

/** A real calendar date in ISO yyyy-mm-dd (rejects 2024-02-31). */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
