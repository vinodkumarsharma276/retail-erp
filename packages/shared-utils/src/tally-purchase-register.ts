import { describeGstin, normalizeGstin } from './gstin';

/**
 * Reading a Tally "Purchase Register" / Day Book export.
 *
 * Tally prints one voucher as a block of rows: a first row carrying the date
 * and every invoice-level detail (supplier, consignee, invoice number, GSTIN,
 * taxable value, CGST/SGST/IGST, gross total), followed by one row per stock
 * item carrying only a name, quantity, rate and value. A new date starts the
 * next block, and the sheet ends with a Grand Total row.
 *
 * The layout is rigid, so this is parsed outright rather than guessed at with
 * column mapping — the generic mapper cannot cope with Tally's "Particulars"
 * column, which holds the supplier name on a voucher row and the item name on
 * the rows beneath it.
 *
 * Everything here is pure: callers hand over rows already read out of the
 * workbook, which keeps the format testable without a spreadsheet library.
 */

// --- Cell readers ---------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Collapse whitespace; Tally pads cells and wraps addresses over lines. */
export function cleanCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Tally writes dates as "1-Sep-26". A two-digit year is read as 20xx, which is
 * right for every register anyone will import — Tally has no nineteen-hundreds
 * purchase data to export.
 */
export function parseTallyDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  // An Excel serial, in case the sheet is read with raw values rather than the
  // text Tally wrote. 25569 is the number of days from Excel's day zero
  // (1899-12-30, which absorbs the Lotus 1900 leap-year bug) to 1970-01-01.
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }
  const text = cleanCell(value);
  if (!text) return '';

  let match = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/, ]+(\d{2,4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month) {
      const year = match[3].length <= 2 ? 2000 + Number(match[3]) : Number(match[3]);
      return `${year}-${pad2(month)}-${pad2(Number(match[1]))}`;
    }
  }
  // ISO, in case the sheet was re-saved by Excel or another tool.
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  return '';
}

/**
 * A ledger amount as Tally prints it: "91422.00 Cr", "6972.86 Dr", "1,234.50".
 * Returned signed, debit positive and credit negative, so a round-off of
 * "0.17 Cr" subtracts the way it does on the invoice. Blank gives null.
 */
export function parseLedgerAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanCell(value);
  if (!text) return null;
  const match = /^(-?[\d,]+(?:\.\d+)?)\s*(Dr|Cr)?\.?$/i.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return match[2]?.toLowerCase() === 'cr' ? -amount : amount;
}

/** "4.00 Pcs." gives { quantity: 4, unit: 'Pcs' }. Blank gives a null quantity. */
export function parseTallyQuantity(value: unknown): { quantity: number | null; unit: string } {
  const text = cleanCell(value);
  if (!text) return { quantity: null, unit: '' };
  const match = /^(-?[\d,]+(?:\.\d+)?)\s*(.*)$/.exec(text);
  if (!match) return { quantity: null, unit: '' };
  const quantity = Number(match[1].replace(/,/g, ''));
  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit: match[2].replace(/\.$/, '').trim(),
  };
}

/** "23404.24/Pcs." gives 23404.24 */
export function parseTallyRate(value: unknown): number | null {
  const text = cleanCell(value);
  if (!text) return null;
  const match = /^(-?[\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const rate = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(rate) ? rate : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// --- Headings ------------------------------------------------------------------

/** "Supplier Invoice No." becomes "supplier invoice no" */
function headingKey(value: unknown): string {
  return cleanCell(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Heading to the field it fills. Tally's own column names, as exported. */
const HEADINGS: Record<string, string> = {
  'date': 'date',
  'particulars': 'particulars',
  'supplier': 'supplier',
  'supplier address': 'supplierAddress',
  'consignee': 'consignee',
  'consignee address': 'consigneeAddress',
  'voucher type': 'voucherType',
  'voucher no': 'voucherNumber',
  'supplier invoice no': 'supplierInvoiceNumber',
  'supplier invoice date': 'supplierInvoiceDate',
  'gstin uin': 'gstin',
  'pan no': 'pan',
  'narration': 'narration',
  'quantity': 'quantity',
  'rate': 'rate',
  'value': 'value',
  'addl cost': 'additionalCost',
  'gross total': 'grossTotal',
  'cgst': 'cgst',
  'sgst': 'sgst',
  'igst': 'igst',
  'round off': 'roundOff',
};

/** Columns that must be present for this to be a Tally purchase register. */
const REQUIRED_FIELDS = ['date', 'particulars', 'voucherType', 'quantity', 'value'] as const;

type ColumnIndex = Partial<Record<string, number>>;

// --- Result shape ----------------------------------------------------------------

export interface TallyRegisterItem {
  /** 1-based row number as Excel shows it, for error messages. */
  rowNumber: number;
  name: string;
  quantity: number | null;
  unit: string;
  /** Per-unit rate before tax. */
  rate: number | null;
  /** Line total before tax. */
  value: number | null;
}

export interface TallyRegisterVoucher {
  rowNumber: number;
  /** Voucher date, YYYY-MM-DD. */
  date: string;
  voucherType: string;
  voucherNumber: string;
  supplierName: string;
  supplierAddress: string;
  consigneeName: string;
  consigneeAddress: string;
  /** The supplier's own bill number, falling back to Tally's voucher number. */
  invoiceNumber: string;
  invoiceNumberSource: 'supplier' | 'voucher' | 'none';
  /** Supplier invoice date, falling back to the voucher date. */
  invoiceDate: string;
  gstin: string;
  /** From the sheet if present, otherwise read out of the GSTIN. */
  pan: string;
  /** State implied by the GSTIN state code. */
  supplierState: string;
  /** PIN code found in the supplier address, when there is one. */
  supplierPincode: string;
  /** Mobile number found in the supplier address, when there is one. */
  supplierPhone: string;
  narration: string;
  /** Total units as Tally printed them on the voucher row. */
  declaredQuantity: number | null;
  /** Taxable value of the voucher. */
  taxableValue: number | null;
  additionalCost: number | null;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  /** Invoice total including tax, as printed. */
  grossTotal: number | null;
  items: TallyRegisterItem[];
  /** Things that do not add up in the sheet itself. */
  issues: string[];
}

export interface TallyRegisterParse {
  detected: boolean;
  /** Why the sheet was not recognised, for the upload screen. */
  reason?: string;
  /** The entity the register belongs to, from the page header. */
  ownerName: string;
  title: string;
  period: string;
  /** 1-based Excel row of the heading row. */
  headerRow: number;
  vouchers: TallyRegisterVoucher[];
  grandTotal: { quantity: number | null; taxableValue: number | null; grossTotal: number | null } | null;
  skipped: Array<{ rowNumber: number; reason: string }>;
}

// --- Detection -------------------------------------------------------------------

function locateHeaderRow(rows: unknown[][]): { index: number; columns: ColumnIndex } | null {
  const limit = Math.min(rows.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const columns: ColumnIndex = {};
    (rows[index] ?? []).forEach((cell, column) => {
      const field = HEADINGS[headingKey(cell)];
      // First occurrence wins: Tally never repeats these headings.
      if (field && columns[field] == null) columns[field] = column;
    });
    if (REQUIRED_FIELDS.every((field) => columns[field] != null)) return { index, columns };
  }
  return null;
}

/** True when these rows look like a Tally purchase register export. */
export function isTallyPurchaseRegister(rows: unknown[][]): boolean {
  return locateHeaderRow(rows) != null;
}

// --- Address scraps ---------------------------------------------------------------

/**
 * Tally hands over the supplier address as one run-on string, so only the
 * parts that can be recognised without guessing are pulled out: a 6-digit PIN
 * code, and a 10-digit mobile number (often typed in as "MR. RAHUL-9999647564").
 * City is deliberately left alone — there is no reliable way to tell it from
 * the rest, and a wrong city is worse than a blank one.
 */
function scrapeAddress(address: string): { pincode: string; phone: string } {
  const pincodes = address.match(/(?<!\d)\d{6}(?!\d)/g);
  const phones = address.match(/(?<!\d)[6-9]\d{9}(?!\d)/g);
  return {
    pincode: pincodes ? pincodes[pincodes.length - 1] : '',
    phone: phones ? phones[0] : '',
  };
}

// --- Parse -------------------------------------------------------------------------

/**
 * Parse a Tally purchase register into vouchers with their item lines.
 *
 * `rows` is the sheet as a grid of cells, row 0 being Excel row 1 — what
 * `sheet_to_json(ws, { header: 1 })` returns.
 */
export function parseTallyPurchaseRegister(rows: unknown[][]): TallyRegisterParse {
  const header = locateHeaderRow(rows);
  const blank: TallyRegisterParse = {
    detected: false,
    ownerName: '',
    title: '',
    period: '',
    headerRow: 0,
    vouchers: [],
    grandTotal: null,
    skipped: [],
  };
  if (!header) {
    return {
      ...blank,
      reason:
        'This does not look like a Tally purchase register — no heading row with Date, Particulars, Voucher Type, Quantity and Value was found in the first 40 rows.',
    };
  }

  const { index: headerIndex, columns } = header;
  const at = (row: unknown[], field: string): unknown =>
    columns[field] != null ? row[columns[field]!] : undefined;
  const text = (row: unknown[], field: string) => cleanCell(at(row, field));

  // Rows above the headings: entity name, its address, then the report title
  // and the period it covers. Only the name and those last two are of use.
  const preamble = rows.slice(0, headerIndex).map((row) => cleanCell((row ?? [])[0])).filter(Boolean);
  const titleIndex = preamble.findIndex((line) => /register|day ?book|voucher/i.test(line));
  const title = titleIndex >= 0 ? preamble[titleIndex] : '';
  const period = titleIndex >= 0 ? preamble[titleIndex + 1] ?? '' : '';

  const vouchers: TallyRegisterVoucher[] = [];
  const skipped: TallyRegisterParse['skipped'] = [];
  let grandTotal: TallyRegisterParse['grandTotal'] = null;
  let current: TallyRegisterVoucher | null = null;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (!row.some((cell) => cleanCell(cell) !== '')) continue;

    const particulars = text(row, 'particulars');
    const date = parseTallyDate(at(row, 'date'));

    // The closing Grand Total row, and any sub-total Tally prints.
    if (!date && /^(grand )?total$/i.test(particulars)) {
      const gross = parseLedgerAmount(at(row, 'grossTotal'));
      grandTotal = {
        quantity: parseTallyQuantity(at(row, 'quantity')).quantity,
        taxableValue: parseLedgerAmount(at(row, 'value')),
        grossTotal: gross == null ? null : Math.abs(gross),
      };
      current = null;
      continue;
    }

    if (date) {
      // A date starts a new voucher. Nothing carries over from the last one:
      // a blank GSTIN on a new supplier must stay blank.
      const supplierAddress = text(row, 'supplierAddress');
      const rawGstin = normalizeGstin(text(row, 'gstin'));
      const described = describeGstin(rawGstin);
      const scraped = scrapeAddress(supplierAddress);
      const supplierInvoiceNumber = text(row, 'supplierInvoiceNumber');
      const voucherNumber = text(row, 'voucherNumber');
      const gross = parseLedgerAmount(at(row, 'grossTotal'));

      current = {
        rowNumber,
        date,
        voucherType: text(row, 'voucherType'),
        voucherNumber,
        // The Supplier column, falling back to Particulars, which repeats it.
        supplierName: text(row, 'supplier') || particulars,
        supplierAddress,
        consigneeName: text(row, 'consignee'),
        consigneeAddress: text(row, 'consigneeAddress'),
        // Tally's own voucher number ("BILL-1572") is a fallback only: the
        // supplier invoice number is what the paper bill carries.
        invoiceNumber: supplierInvoiceNumber || voucherNumber,
        invoiceNumberSource: supplierInvoiceNumber ? 'supplier' : voucherNumber ? 'voucher' : 'none',
        invoiceDate: parseTallyDate(at(row, 'supplierInvoiceDate')) || date,
        gstin: described ? described.gstin : '',
        pan: text(row, 'pan').toUpperCase() || described?.pan || '',
        supplierState: described?.state ?? '',
        supplierPincode: scraped.pincode,
        supplierPhone: scraped.phone,
        narration: text(row, 'narration'),
        declaredQuantity: parseTallyQuantity(at(row, 'quantity')).quantity,
        taxableValue: parseLedgerAmount(at(row, 'value')),
        additionalCost: parseLedgerAmount(at(row, 'additionalCost')),
        cgst: parseLedgerAmount(at(row, 'cgst')) ?? 0,
        sgst: parseLedgerAmount(at(row, 'sgst')) ?? 0,
        igst: parseLedgerAmount(at(row, 'igst')) ?? 0,
        roundOff: parseLedgerAmount(at(row, 'roundOff')) ?? 0,
        grossTotal: gross == null ? null : Math.abs(gross),
        items: [],
        issues: [],
      };
      if (rawGstin && !described) {
        current.issues.push(`GSTIN "${rawGstin}" is not a valid GST number; it will be left blank.`);
      }
      vouchers.push(current);
      continue;
    }

    // No date: an item line belonging to the voucher above.
    if (!particulars) {
      skipped.push({ rowNumber, reason: 'No date and no item name.' });
      continue;
    }
    if (!current) {
      skipped.push({ rowNumber, reason: `"${particulars}" appears before any voucher.` });
      continue;
    }
    const { quantity, unit } = parseTallyQuantity(at(row, 'quantity'));
    const value = parseLedgerAmount(at(row, 'value'));
    current.items.push({
      rowNumber,
      name: particulars,
      quantity,
      unit,
      rate: parseTallyRate(at(row, 'rate')),
      value: value == null ? null : Math.abs(value),
    });
  }

  for (const voucher of vouchers) checkVoucher(voucher);

  return {
    detected: true,
    ownerName: preamble[0] ?? '',
    title,
    period,
    headerRow: headerIndex + 1,
    vouchers,
    grandTotal,
    skipped,
  };
}

/**
 * Cross-check a voucher against itself. Tally's own totals are the best
 * available proof that the block was read correctly, so a mismatch here means
 * the sheet was misread or hand-edited — worth saying out loud either way.
 */
function checkVoucher(voucher: TallyRegisterVoucher): void {
  if (voucher.items.length === 0) {
    voucher.issues.push('No item lines were found under this voucher.');
  }

  const taxable = voucher.taxableValue;
  if (taxable != null && voucher.grossTotal != null) {
    const expected = round2(
      taxable + voucher.cgst + voucher.sgst + voucher.igst + voucher.roundOff + (voucher.additionalCost ?? 0),
    );
    if (Math.abs(expected - voucher.grossTotal) > 1) {
      voucher.issues.push(
        `Taxable value plus tax comes to ₹${expected}, but the printed invoice total is ₹${voucher.grossTotal}.`,
      );
    }
  }

  if (taxable != null && voucher.items.length > 0) {
    const lineSum = round2(voucher.items.reduce((sum, item) => sum + (item.value ?? 0), 0));
    if (Math.abs(lineSum - taxable) > 1) {
      voucher.issues.push(
        `Item lines add up to ₹${lineSum}, but the voucher taxable value is ₹${taxable}.`,
      );
    }
  }

  if (voucher.declaredQuantity != null && voucher.items.length > 0) {
    const unitSum = voucher.items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    if (Math.abs(unitSum - voucher.declaredQuantity) > 0.001) {
      voucher.issues.push(
        `Item lines total ${unitSum} units, but the voucher says ${voucher.declaredQuantity}.`,
      );
    }
  }
}

/**
 * Split a voucher's tax across its item lines in proportion to line value.
 *
 * Tally reports GST once per voucher, while a purchase is stored per item, so
 * the tax has to be apportioned. The last line absorbs the rounding remainder
 * so the parts always add back up to the voucher tax to the paisa.
 */
export function allocateVoucherTax(voucher: TallyRegisterVoucher): number[] {
  if (voucher.items.length === 0) return [];
  const total = round2(voucher.cgst + voucher.sgst + voucher.igst);
  const lineValues = voucher.items.map((item) => item.value ?? 0);
  const base = lineValues.reduce((sum, value) => sum + value, 0);
  if (total === 0 || base <= 0) return voucher.items.map(() => 0);

  const shares = lineValues.map((value) => round2((total * value) / base));
  const drift = round2(total - shares.reduce((sum, share) => sum + share, 0));
  shares[shares.length - 1] = round2(shares[shares.length - 1] + drift);
  return shares;
}
