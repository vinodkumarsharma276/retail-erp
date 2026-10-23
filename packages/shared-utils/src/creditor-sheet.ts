/**
 * Reading a Tally "Sundry Creditors" export into supplier records.
 *
 * The export is a ledger listing, not a supplier master: it carries the
 * name, the address, the GSTIN and the balance, and little else. Phone turns
 * up on about one row in ten (buried in the address, sometimes two numbers
 * in one cell), email and bank details on none, and there is no city column
 * at all.
 *
 * So the job here is to get what is there, say what could not be read, and
 * leave the rest blank for `distributorCompleteness` to ask for. Nothing is
 * invented: a guessed city is worse than an empty one.
 *
 * One implementation, used by both the upload screen and the command-line
 * importer, because these rules are decisions rather than plumbing.
 */
import { describeGstin, normalizeGstin } from './gstin';
import { parseAmount } from './purchase-sheet';

/** Column headings as Tally writes them. */
export const CREDITOR_COLUMNS = {
  name: 'Name',
  address: 'Address',
  state: 'State',
  pin: 'PIN',
  country: 'Country',
  gstin: 'GSTIN',
  gstRegType: 'GST Reg. Type',
  pan: 'PAN',
  phone: 'Phone (from address)',
  email: 'Email',
  contact: 'Contact',
  bank: 'Bank Details',
  closingCr: 'Closing Cr (Payable)',
  closingDr: 'Closing Dr (Advance/Receivable)',
  netBalance: 'Net Balance (+Cr / -Dr)',
  drCr: 'Dr/Cr',
  alias: 'Alias',
  group: 'Group',
} as const;

/** Without these three there is nothing worth importing. */
export const REQUIRED_CREDITOR_COLUMNS: string[] = [
  CREDITOR_COLUMNS.name,
  CREDITOR_COLUMNS.address,
  CREDITOR_COLUMNS.gstin,
];

export const clean = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ');

/** Supplier name for matching: lower-case, no punctuation or "M/s". */
export function creditorNameKey(name: string): string {
  return clean(name)
    .toLowerCase()
    .replace(/^m\/?s\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizePan(value: unknown): string | null {
  const pan = clean(value).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null;
}

/**
 * Tally puts whatever phone numbers it has into the address line, so one
 * cell can hold two. The first becomes the phone, the second the alternate.
 */
export function splitPhones(value: unknown): { phone: string; altPhone: string | null } {
  const found = clean(value)
    .split(/[,/;]+/)
    .map((part) => part.replace(/\D/g, ''))
    .filter((part) => part.length >= 10)
    .map((part) => part.slice(-10));
  return { phone: found[0] ?? '', altPhone: found[1] ?? null };
}

/** A PIN is six digits or it is nothing; real exports hold "09" and "20301". */
export function normalizePincode(value: unknown): string {
  const pin = clean(value).replace(/\D/g, '');
  return /^\d{6}$/.test(pin) ? pin : '';
}

/** Money as Tally writes it ("11,502.00"); a blank or a dash reads as zero. */
function parseBalance(value: unknown): number {
  return parseAmount(value) ?? 0;
}

/** Places that appear in these books; longest wins, so a suburb beats its city. */
const CITIES = [
  'Greater Noida', 'New Delhi', 'Noida', 'Ghaziabad', 'Delhi', 'Gurugram', 'Gurgaon',
  'Faridabad', 'Meerut', 'Baghpat', 'Modinagar', 'Hapur', 'Bulandshahr', 'Sonipat',
  'Panipat', 'Mumbai', 'Pune', 'Bengaluru', 'Bangalore', 'Chennai', 'Kolkata',
  'Hyderabad', 'Ahmedabad', 'Surat', 'Indore', 'Bhopal', 'Jaipur', 'Lucknow',
  'Kanpur', 'Agra', 'Ludhiana', 'Chandigarh', 'Rajkot',
];

/** Localities people write instead of the city they belong to. */
const LOCALITY_CITY: Record<string, string> = {
  Indirapuram: 'Ghaziabad',
  Sahibabad: 'Ghaziabad',
  Vaishali: 'Ghaziabad',
  Kaushambi: 'Ghaziabad',
};

/**
 * The city, read out of the address — but only when one known place name is
 * in there as a whole word. Anything less certain stays blank.
 */
export function cityFromAddress(address: string): string {
  const haystack = ` ${address} `;
  const hit = (place: string) =>
    new RegExp(`(^|[^A-Za-z])${place.replace(/ /g, '\\s+')}([^A-Za-z]|$)`, 'i').test(haystack);

  for (const [locality, city] of Object.entries(LOCALITY_CITY)) {
    if (hit(locality)) return city;
  }
  const matches = CITIES.filter(hit).sort((a, b) => b.length - a.length);
  return matches[0] ?? '';
}

/** A value the sheet held that was too malformed to store. */
export interface RejectedValue {
  field: string;
  value: string;
}

/** One creditor row, mapped onto the supplier record. */
export interface ParsedCreditor {
  /** Row number as the spreadsheet shows it, for pointing at a bad cell. */
  rowNumber: number;
  companyName: string;
  contactPerson: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  /** Tally's own figures: kept on the record, never acted on. */
  balances: { closingCr: number; closingDr: number; net: number; group: string };
  rejected: RejectedValue[];
}

export interface CreditorSheetResult {
  rows: ParsedCreditor[];
  skipped: Array<{ rowNumber: number; reason: string }>;
  /** Two rows under one GSTIN: one business, two ledgers. */
  gstCollisions: Array<{ gstin: string; names: string[] }>;
  /** Expected headings the sheet did not have. */
  missingColumns: string[];
}

function mapRow(raw: Record<string, unknown>, rowNumber: number): ParsedCreditor | null {
  const companyName = clean(raw[CREDITOR_COLUMNS.name]);
  if (!companyName) return null;

  const address = clean(raw[CREDITOR_COLUMNS.address]);
  const rawGstin = clean(raw[CREDITOR_COLUMNS.gstin]);
  const described = describeGstin(rawGstin);
  const gstNumber = described?.gstin ?? null;
  const { phone, altPhone } = splitPhones(raw[CREDITOR_COLUMNS.phone]);
  const pincode = normalizePincode(raw[CREDITOR_COLUMNS.pin]);
  const rawPan = clean(raw[CREDITOR_COLUMNS.pan]);
  // Characters 3–12 of a GSTIN are the holder's PAN, so a missing PAN column
  // is not a missing PAN.
  const panNumber = normalizePan(rawPan) ?? described?.pan ?? null;
  const rawPin = clean(raw[CREDITOR_COLUMNS.pin]);

  // A value the sheet had but that will not be stored is worth naming: it is
  // a typo in Tally, and only there can it be fixed.
  const rejected: RejectedValue[] = [];
  if (rawGstin && !gstNumber) rejected.push({ field: 'GSTIN', value: rawGstin });
  if (rawPan && !normalizePan(rawPan)) rejected.push({ field: 'PAN', value: rawPan });
  if (rawPin && !pincode) rejected.push({ field: 'PIN', value: rawPin });

  return {
    rowNumber,
    companyName: companyName.slice(0, 300),
    // The Contact column is empty throughout a creditors export; the
    // supplier's own name reads better than a blank on every screen.
    contactPerson: (clean(raw[CREDITOR_COLUMNS.contact]) || companyName).slice(0, 200),
    phone,
    altPhone,
    email: clean(raw[CREDITOR_COLUMNS.email]).slice(0, 255) || null,
    gstNumber,
    panNumber,
    addressLine1: address.slice(0, 255),
    city: cityFromAddress(address).slice(0, 100),
    // The GSTIN names the state too; fall back to it when the column is empty.
    state: (clean(raw[CREDITOR_COLUMNS.state]) || described?.state || '').slice(0, 100),
    pincode,
    balances: {
      closingCr: parseBalance(raw[CREDITOR_COLUMNS.closingCr]),
      closingDr: parseBalance(raw[CREDITOR_COLUMNS.closingDr]),
      net: parseBalance(raw[CREDITOR_COLUMNS.netBalance]),
      group: clean(raw[CREDITOR_COLUMNS.group]),
    },
    rejected,
  };
}

/**
 * Turn sheet records — objects keyed by the header row — into suppliers.
 *
 * `firstRowNumber` is the spreadsheet row the first record came from, so
 * that anything reported points at the row the user can actually see.
 */
export function parseCreditorSheet(
  records: Record<string, unknown>[],
  firstRowNumber = 2,
): CreditorSheetResult {
  const headers = Object.keys(records[0] ?? {});
  const missingColumns = REQUIRED_CREDITOR_COLUMNS.filter((c) => !headers.includes(c));

  const rows: ParsedCreditor[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  records.forEach((record, index) => {
    const rowNumber = firstRowNumber + index;
    const mapped = mapRow(record, rowNumber);
    if (mapped) rows.push(mapped);
    else skipped.push({ rowNumber, reason: 'No supplier name' });
  });

  // Two ledgers under one GSTIN are reported, not folded together: both come
  // in, and a human decides on the Distributors screen which name is real.
  const byGstin = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.gstNumber) continue;
    byGstin.set(row.gstNumber, [...(byGstin.get(row.gstNumber) ?? []), row.companyName]);
  }
  const gstCollisions = [...byGstin.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([gstin, names]) => ({ gstin, names }));

  return { rows, skipped, gstCollisions, missingColumns };
}

/** How much of each field the sheet could actually supply. */
export function creditorSheetCoverage(rows: ParsedCreditor[]): Array<{
  label: string;
  filled: number;
  total: number;
}> {
  const count = (get: (r: ParsedCreditor) => unknown) =>
    rows.filter((r) => clean(get(r)) !== '').length;

  return [
    { label: 'GSTIN', filled: count((r) => r.gstNumber), total: rows.length },
    { label: 'PAN', filled: count((r) => r.panNumber), total: rows.length },
    { label: 'Address', filled: count((r) => r.addressLine1), total: rows.length },
    { label: 'City', filled: count((r) => r.city), total: rows.length },
    { label: 'State', filled: count((r) => r.state), total: rows.length },
    { label: 'PIN code', filled: count((r) => r.pincode), total: rows.length },
    { label: 'Phone', filled: count((r) => r.phone), total: rows.length },
    { label: 'Email', filled: count((r) => r.email), total: rows.length },
  ];
}

export { normalizeGstin };
