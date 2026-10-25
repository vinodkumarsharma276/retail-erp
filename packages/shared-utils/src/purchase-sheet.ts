/**
 * Reading the shop's own purchase sheet.
 *
 * This is the format the shops export from Tally deliberately, rather than
 * Tally's raw Purchase Register: one flat row per item line, with the invoice
 * details repeated on each row so the sheet stays readable, and a second
 * sheet listing IMEI numbers one per line. Everything is a plain column, so
 * it is read outright — no blocks, no fill-down, no guesswork.
 *
 * The columns are declared below rather than matched by synonym. A sheet that
 * gains or loses one is not quietly coerced: the reader reports exactly what
 * it did not recognise and what it expected but could not find, so the person
 * uploading decides what a new column means. See `PurchaseSheetColumns`.
 */

// --- The column contract ---------------------------------------------------

/** A field the importer understands, and the headings that carry it. */
export interface SheetColumn {
  field: string;
  /** Headings seen in the wild for this field, lower-cased and squashed. */
  headings: string[];
  label: string;
  required: boolean;
  /** What it is for, shown when a sheet is missing it. */
  purpose: string;
}

/** "Amount (before tax)" becomes "amount before tax". */
export function headingKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

export const PURCHASE_SHEET_COLUMNS: SheetColumn[] = [
  { field: 'date', label: 'Date', required: true, purpose: 'The invoice date.', headings: ['date', 'invoice date', 'bill date'] },
  { field: 'voucherNumber', label: 'Voucher No.', required: false, purpose: "Tally's own number, kept alongside the supplier's.", headings: ['voucher no', 'voucher number', 'vch no'] },
  { field: 'invoiceNumber', label: 'Supplier Invoice No.', required: true, purpose: 'The number on the paper bill. Re-importing the same bill is skipped on this.', headings: ['supplier invoice no', 'supplier invoice number', 'invoice no', 'bill no'] },
  { field: 'party', label: 'Party', required: true, purpose: 'The supplier.', headings: ['party', 'party name', 'supplier', 'supplier name', 'distributor'] },
  { field: 'item', label: 'Item', required: true, purpose: 'The product description. Its category, brand, model and colour are read from this.', headings: ['item', 'item name', 'particulars', 'description', 'product'] },
  { field: 'quantity', label: 'Qty', required: true, purpose: 'How many units. One product record is created per unit.', headings: ['qty', 'quantity', 'units'] },
  { field: 'rate', label: 'Rate', required: true, purpose: 'Cost per unit, before tax.', headings: ['rate', 'rate per unit', 'unit rate', 'price'] },
  { field: 'amount', label: 'Amount (before tax)', required: false, purpose: 'Line total before tax. Used to cross-check quantity times rate.', headings: ['amount before tax', 'amount', 'taxable value', 'taxable amount', 'value'] },
  { field: 'imeiCount', label: 'IMEI Count', required: false, purpose: 'How many IMEI numbers the line should carry. Used to cross-check.', headings: ['imei count', 'imei qty'] },
  { field: 'imeis', label: 'IMEI / Description', required: false, purpose: 'IMEI numbers for the line, separated by commas.', headings: ['imei description', 'imei', 'imei numbers', 'imei no'] },
  // Declared ahead of arriving: the shops will add tax columns to the export.
  { field: 'gstRate', label: 'GST Rate %', required: false, purpose: 'Tax rate on the line, as a percentage.', headings: ['gst rate', 'gst rate %', 'tax rate', 'rate of tax', 'gst %'] },
  { field: 'gstAmount', label: 'GST Amount', required: false, purpose: 'Tax charged on the line, in rupees.', headings: ['gst amount', 'gst', 'tax amount', 'total tax'] },
  { field: 'cgst', label: 'CGST', required: false, purpose: 'Central tax on the line.', headings: ['cgst', 'cgst amount', 'central tax'] },
  { field: 'sgst', label: 'SGST', required: false, purpose: 'State tax on the line.', headings: ['sgst', 'sgst amount', 'state tax', 'utgst'] },
  { field: 'igst', label: 'IGST', required: false, purpose: 'Integrated tax on the line.', headings: ['igst', 'igst amount', 'integrated tax'] },
  { field: 'gstin', label: 'GSTIN', required: false, purpose: "The supplier's GST number, which also gives their PAN and state.", headings: ['supplier gstin', 'party gstin', 'gstin', 'gstin uin', 'gst no', 'gst number'] },
  { field: 'hsnCode', label: 'HSN', required: false, purpose: 'HSN code for the line.', headings: ['hsn', 'hsn code', 'hsn sac'] },
  { field: 'mrp', label: 'MRP', required: false, purpose: 'Printed retail price.', headings: ['mrp', 'm r p'] },
  { field: 'colour', label: 'Colour', required: false, purpose: 'Colour, when the sheet states it separately.', headings: ['colour', 'color'] },
  { field: 'serialNumber', label: 'Serial No.', required: false, purpose: 'Serial number for a single unit.', headings: ['serial no', 'serial number', 'sr no'] },

  // Supplier details repeated on the line. The system has a field for each of
  // these already, so a sheet carrying them fills a supplier record in
  // properly instead of leaving it a bare name.
  { field: 'supplierPhone', label: 'Phone', required: false, purpose: "The supplier's phone number.", headings: ['phone', 'supplier phone', 'mobile', 'contact no'] },
  { field: 'supplierAddress', label: 'Address', required: false, purpose: "The supplier's address.", headings: ['address', 'supplier address', 'party address'] },
  { field: 'supplierState', label: 'State', required: false, purpose: "The supplier's state, which decides whether tax is CGST/SGST or IGST.", headings: ['state', 'supplier state'] },
  { field: 'supplierPincode', label: 'PIN code', required: false, purpose: "The supplier's PIN code.", headings: ['pin', 'pincode', 'pin code'] },
  { field: 'supplierPan', label: 'PAN', required: false, purpose: "The supplier's PAN, when not derivable from a GSTIN.", headings: ['pan', 'pan no', 'pan number'] },
  { field: 'bankDetails', label: 'Bank details', required: false, purpose: 'Bank account the supplier is paid into.', headings: ['bank details', 'bank', 'bank account'] },

  { field: 'unit', label: 'Unit', required: false, purpose: 'Unit of measure for the quantity, e.g. Pcs.', headings: ['unit', 'uom', 'units of measure'] },
  { field: 'amountInclTax', label: 'Amount incl. GST', required: false, purpose: 'Line total including tax, used to cross-check the other amounts.', headings: ['amount incl gst', 'amount including gst', 'amount incl tax', 'gross amount'] },
];

/** Headings on the IMEI sheet. Its job is only to tie an IMEI to a line. */
export const IMEI_SHEET_COLUMNS: SheetColumn[] = [
  { field: 'invoiceNumber', label: 'Supplier Invoice No.', required: true, purpose: 'Ties the IMEI to an invoice.', headings: ['supplier invoice no', 'supplier invoice number', 'invoice no', 'bill no'] },
  { field: 'voucherNumber', label: 'Voucher No.', required: false, purpose: "Tally's own number.", headings: ['voucher no', 'voucher number', 'vch no'] },
  { field: 'party', label: 'Party', required: false, purpose: 'The supplier.', headings: ['party', 'party name', 'supplier', 'supplier name'] },
  { field: 'item', label: 'Item', required: true, purpose: 'Ties the IMEI to a line of that invoice.', headings: ['item', 'item name', 'particulars', 'description', 'product'] },
  { field: 'imei', label: 'IMEI', required: true, purpose: 'The IMEI number itself.', headings: ['imei', 'imei no', 'imei number'] },
];

// --- Cell readers -----------------------------------------------------------

/** Local to this reader; the register reader exports its own of the same name. */
function cleanCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The sheet writes dates day-first ("01-10-2026"), as Indian accounting does.
 * An ambiguous value is read day-first for that reason, and a four-digit
 * leading part is taken as an ISO date instead.
 */
export function parseSheetDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Math.round((value - 25569) * 86_400_000));
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }
  const text = cleanCell(value);
  if (!text) return '';

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;

  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (match) {
    const year = match[3].length <= 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return `${year}-${pad2(Number(match[2]))}-${pad2(Number(match[1]))}`;
  }

  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  match = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/, ]+(\d{2,4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (month) {
      const year = match[3].length <= 2 ? 2000 + Number(match[3]) : Number(match[3]);
      return `${year}-${pad2(month)}-${pad2(Number(match[1]))}`;
    }
  }
  return '';
}

/** "1,23,456.78" or a plain number. Blank gives null. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanCell(value).replace(/[₹,\s]/g, '');
  if (!text) return null;
  const match = /^-?\d+(\.\d+)?/.exec(text);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

/** An IMEI is all digits, fifteen of them but allow a little either way. */
const IMEI_PATTERN = /^\d{14,16}$/;

/**
 * One identifier as it should be stored.
 *
 * An IMEI is reduced to its digits, so "IMEI: 867…" and "867…" are the same
 * number. Anything else is kept exactly as written: a tablet serial like
 * "72666/X5ZS01828" is not a number with punctuation in it, and stripping
 * the letters leaves something that matches nothing.
 */
export function normaliseIdentifier(value: unknown): string {
  const text = cleanCell(value);
  const digits = text.replace(/\D/g, '');
  return IMEI_PATTERN.test(digits) ? digits : text;
}

/**
 * IMEIs as written in one cell, separated by commas, semicolons or newlines.
 *
 * A slash separates two of them only when both sides are themselves IMEIs.
 * Serial numbers contain slashes of their own, and splitting those produced
 * two identifiers where the shop wrote one.
 */
export function splitImeis(value: unknown): string[] {
  const parts = cleanCell(value)
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const part of parts) {
    const pieces = part.split('/').map((piece) => piece.trim()).filter(Boolean);
    const everyPieceIsAnImei =
      pieces.length > 1 && pieces.every((piece) => IMEI_PATTERN.test(piece.replace(/\D/g, '')));
    for (const piece of everyPieceIsAnImei ? pieces : [part]) {
      const identifier = normaliseIdentifier(piece);
      if (identifier) out.push(identifier);
    }
  }
  return out;
}

// --- Result shape ------------------------------------------------------------

/** What the reader made of the sheet's columns. */
export interface PurchaseSheetColumns {
  /** Field name to column index, for everything recognised. */
  found: Record<string, number>;
  /** Headings present in the sheet that mean nothing to the importer yet. */
  unknown: Array<{ heading: string; column: number; samples: string[] }>;
  /** Required fields the sheet does not carry. */
  missingRequired: Array<{ field: string; label: string; purpose: string }>;
  /** Optional fields absent — worth knowing, never a problem. */
  missingOptional: string[];
}

export interface PurchaseSheetLine {
  /** 1-based row number as Excel shows it. */
  rowNumber: number;
  date: string;
  voucherNumber: string;
  invoiceNumber: string;
  party: string;
  item: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  /** IMEIs written on the line itself. */
  imeis: string[];
  /** The count the sheet declares, when it has that column. */
  imeiCount: number | null;
  gstAmount: number | null;
  gstRate: number | null;
  gstin: string;
  hsnCode: string;
  mrp: number | null;
  colour: string;
  serialNumber: string;
  /** Supplier details the line repeats, when the sheet carries them. */
  supplier: {
    phone: string;
    address: string;
    state: string;
    pincode: string;
    pan: string;
    bankDetails: string;
  };
  unit: string;
  /** Line total including tax, when the sheet states it. */
  amountInclTax: number | null;
  /** Values of columns the importer does not understand, by heading. */
  extras: Record<string, string>;
  issues: string[];
}

export interface PurchaseSheetInvoice {
  key: string;
  invoiceNumber: string;
  voucherNumber: string;
  party: string;
  date: string;
  gstin: string;
  lines: PurchaseSheetLine[];
  units: number;
  taxableValue: number;
  gstAmount: number;
  issues: string[];
}

export interface PurchaseSheetParse {
  detected: boolean;
  reason?: string;
  sheetName: string;
  /** 1-based Excel row of the heading row. */
  headerRow: number;
  columns: PurchaseSheetColumns;
  invoices: PurchaseSheetInvoice[];
  lines: PurchaseSheetLine[];
  /** IMEIs read from the companion sheet, and how they tied up. */
  imeiSheet: ImeiSheetParse | null;
  skipped: Array<{ rowNumber: number; reason: string }>;
}

export interface ImeiSheetParse {
  sheetName: string;
  columns: PurchaseSheetColumns;
  /** Line key to the IMEIs listed for it. */
  byLine: Map<string, string[]>;
  total: number;
  /** IMEI rows that match no line of the purchase sheet. */
  orphans: Array<{ rowNumber: number; invoiceNumber: string; item: string; imei: string }>;
}

// --- Reading -----------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ties an IMEI row to a purchase line. */
export function lineKey(invoiceNumber: string, party: string, item: string): string {
  return [invoiceNumber, party, item]
    .map((p) => String(p ?? '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join(' | ');
}

function matchColumns(headings: unknown[], contract: SheetColumn[]): PurchaseSheetColumns {
  const keys = headings.map(headingKey);
  const found: Record<string, number> = {};
  const claimed = new Set<number>();

  for (const column of contract) {
    for (const heading of column.headings) {
      const index = keys.findIndex((key, i) => key === heading && !claimed.has(i));
      if (index !== -1) {
        found[column.field] = index;
        claimed.add(index);
        break;
      }
    }
  }

  const unknown = keys
    .map((key, column) => ({ key, column }))
    .filter((entry) => entry.key !== '' && !claimed.has(entry.column))
    .map((entry) => ({ heading: cleanCell(headings[entry.column]), column: entry.column, samples: [] as string[] }));

  return {
    found,
    unknown,
    missingRequired: contract
      .filter((column) => column.required && found[column.field] == null)
      .map((column) => ({ field: column.field, label: column.label, purpose: column.purpose })),
    missingOptional: contract
      .filter((column) => !column.required && found[column.field] == null)
      .map((column) => column.label),
  };
}

/** The row that looks like the headings: the one matching most known fields. */
function locateHeaderRow(rows: unknown[][], contract: SheetColumn[]): number {
  const known = new Set(contract.flatMap((column) => column.headings));
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const score = (rows[index] ?? []).filter((cell) => known.has(headingKey(cell))).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  // Three recognised headings is enough to be sure, and little else looks like that.
  return bestScore >= 3 ? best : -1;
}

/** Read the companion IMEI sheet, if the workbook has one. */
export function parseImeiSheet(sheetName: string, rows: unknown[][]): ImeiSheetParse | null {
  const headerIndex = locateHeaderRow(rows, IMEI_SHEET_COLUMNS);
  if (headerIndex === -1) return null;
  const columns = matchColumns(rows[headerIndex] ?? [], IMEI_SHEET_COLUMNS);
  if (columns.missingRequired.length > 0) return null;

  const at = (row: unknown[], field: string) =>
    columns.found[field] != null ? cleanCell(row[columns.found[field]!]) : '';

  const byLine = new Map<string, string[]>();
  const orphans: ImeiSheetParse['orphans'] = [];
  let total = 0;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    // Normalised the same way as the inline column, so the two sides of the
    // same identifier compare equal rather than differing by punctuation.
    const imei = normaliseIdentifier(at(row, 'imei'));
    const item = at(row, 'item');
    const invoiceNumber = at(row, 'invoiceNumber');
    if (!imei || !item) continue;
    total += 1;
    const key = lineKey(invoiceNumber, at(row, 'party'), item);
    byLine.set(key, [...(byLine.get(key) ?? []), imei]);
    orphans.push({ rowNumber: index + 1, invoiceNumber, item, imei });
  }

  return { sheetName, columns, byLine, total, orphans };
}

/**
 * Read a purchase sheet into invoices and their lines.
 *
 * `rows` is the sheet as a grid, row 0 being Excel row 1. `imeiSheet` is the
 * companion sheet when the workbook carries one.
 */
export function parsePurchaseSheet(
  sheetName: string,
  rows: unknown[][],
  imeiSheet: ImeiSheetParse | null = null,
): PurchaseSheetParse {
  const blank: PurchaseSheetParse = {
    detected: false,
    sheetName,
    headerRow: 0,
    columns: { found: {}, unknown: [], missingRequired: [], missingOptional: [] },
    invoices: [],
    lines: [],
    imeiSheet: null,
    skipped: [],
  };

  const headerIndex = locateHeaderRow(rows, PURCHASE_SHEET_COLUMNS);
  if (headerIndex === -1) {
    return {
      ...blank,
      reason:
        'No heading row was found. The sheet needs a row of column names including at least a date, an invoice number, the item and its quantity.',
    };
  }

  const headings = rows[headerIndex] ?? [];
  const columns = matchColumns(headings, PURCHASE_SHEET_COLUMNS);
  const at = (row: unknown[], field: string): unknown =>
    columns.found[field] != null ? row[columns.found[field]!] : undefined;
  const text = (row: unknown[], field: string) => cleanCell(at(row, field));

  const lines: PurchaseSheetLine[] = [];
  const skipped: PurchaseSheetParse['skipped'] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (!row.some((cell) => cleanCell(cell) !== '')) continue;

    const item = text(row, 'item');
    const invoiceNumber = text(row, 'invoiceNumber');
    // Tally-style total rows carry a label and no invoice number.
    if (!item || /^(grand )?total$/i.test(item)) {
      skipped.push({ rowNumber, reason: item ? `"${item}" is a total, not an item.` : 'No item name.' });
      continue;
    }
    if (!invoiceNumber) {
      skipped.push({ rowNumber, reason: `"${item}" has no invoice number.` });
      continue;
    }

    const quantity = parseAmount(at(row, 'quantity'));
    const rate = parseAmount(at(row, 'rate'));
    const amount = parseAmount(at(row, 'amount'));
    const issues: string[] = [];

    if (quantity == null || quantity <= 0) issues.push(`Quantity "${text(row, 'quantity')}" is not a number above zero.`);
    if (rate == null || rate <= 0) issues.push(`Rate "${text(row, 'rate')}" is not a number above zero.`);
    if (quantity != null && rate != null && amount != null && Math.abs(quantity * rate - amount) > 1) {
      issues.push(`Quantity times rate is ₹${round2(quantity * rate)}, but the amount says ₹${round2(amount)}.`);
    }

    const extras: Record<string, string> = {};
    for (const column of columns.unknown) {
      const value = cleanCell(row[column.column]);
      if (value) extras[column.heading] = value;
      if (value && column.samples.length < 3 && !column.samples.includes(value)) column.samples.push(value);
    }

    const cgst = parseAmount(at(row, 'cgst')) ?? 0;
    const sgst = parseAmount(at(row, 'sgst')) ?? 0;
    const igst = parseAmount(at(row, 'igst')) ?? 0;
    const split = round2(cgst + sgst + igst);

    lines.push({
      rowNumber,
      date: parseSheetDate(at(row, 'date')),
      voucherNumber: text(row, 'voucherNumber'),
      invoiceNumber,
      party: text(row, 'party'),
      item,
      quantity,
      rate,
      amount,
      imeis: splitImeis(at(row, 'imeis')),
      imeiCount: parseAmount(at(row, 'imeiCount')),
      gstAmount: split > 0 ? split : parseAmount(at(row, 'gstAmount')),
      gstRate: parseAmount(at(row, 'gstRate')),
      gstin: text(row, 'gstin').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      hsnCode: text(row, 'hsnCode'),
      mrp: parseAmount(at(row, 'mrp')),
      colour: text(row, 'colour'),
      serialNumber: text(row, 'serialNumber'),
      supplier: {
        // A sheet may list two numbers in one cell; the first is enough to
        // reach somebody, and the rest stays on the supplier's own record.
        phone: text(row, 'supplierPhone'),
        address: text(row, 'supplierAddress'),
        state: text(row, 'supplierState'),
        pincode: text(row, 'supplierPincode').replace(/\D/g, ''),
        pan: text(row, 'supplierPan').toUpperCase().replace(/[^A-Z0-9]/g, ''),
        bankDetails: text(row, 'bankDetails'),
      },
      unit: text(row, 'unit'),
      amountInclTax: parseAmount(at(row, 'amountInclTax')),
      extras,
      issues,
    });
  }

  // --- Group into invoices -------------------------------------------------
  const byKey = new Map<string, PurchaseSheetInvoice>();
  for (const line of lines) {
    const key = lineKey(line.invoiceNumber, line.party, '');
    let invoice = byKey.get(key);
    if (!invoice) {
      invoice = {
        key,
        invoiceNumber: line.invoiceNumber,
        voucherNumber: line.voucherNumber,
        party: line.party,
        date: line.date,
        gstin: line.gstin,
        lines: [],
        units: 0,
        taxableValue: 0,
        gstAmount: 0,
        issues: [],
      };
      byKey.set(key, invoice);
    }
    // The invoice details repeat on every row, so they must agree.
    if (line.date && invoice.date && line.date !== invoice.date) {
      invoice.issues.push(`Rows of this invoice give different dates (${invoice.date} and ${line.date}).`);
    }
    if (!invoice.gstin && line.gstin) invoice.gstin = line.gstin;
    invoice.lines.push(line);
    invoice.units += line.quantity ?? 0;
    invoice.taxableValue = round2(invoice.taxableValue + (line.amount ?? (line.quantity ?? 0) * (line.rate ?? 0)));
    invoice.gstAmount = round2(invoice.gstAmount + (line.gstAmount ?? 0));
  }

  const invoices = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber),
  );
  for (const invoice of invoices) {
    if (!invoice.date) invoice.issues.push('No usable date on any row of this invoice.');
    if (!invoice.party) invoice.issues.push('No supplier named.');
  }

  return {
    detected: true,
    sheetName,
    headerRow: headerIndex + 1,
    columns,
    invoices,
    lines,
    imeiSheet,
    skipped,
  };
}

/**
 * The IMEIs belonging to each unit of a line.
 *
 * A line may carry one IMEI per unit, or two per unit for dual-SIM handsets.
 * Which it is follows from how many numbers there are against the quantity;
 * anything that divides neither way is reported rather than split on a guess,
 * because an IMEI against the wrong handset is worse than none at all.
 */
export function imeisPerUnit(
  line: PurchaseSheetLine,
  fromImeiSheet: string[] = [],
): { perUnit: string[][]; issue: string | null } {
  const quantity = line.quantity ?? 0;
  if (quantity <= 0 || (fromImeiSheet.length === 0 && line.imeis.length === 0)) {
    return { perUnit: [], issue: null };
  }

  /** Whether a list can be shared out over this line's units at all. */
  const fits = (list: string[]) => {
    if (list.length === 0) return false;
    if (line.imeiCount != null && line.imeiCount !== list.length) return false;
    const each = list.length / quantity;
    return each === 1 || each === 2;
  };

  // The dedicated sheet is the fuller record, so it is believed first. But it
  // is keyed by invoice, supplier and item, so when one bill lists the same
  // item on two lines every number pools under a single key and fits neither
  // line. The line's own column keeps them apart, and is believed when it
  // fits and the sheet does not — which is the only way those units can be
  // told from one another.
  const listed = fits(fromImeiSheet)
    ? fromImeiSheet
    : fits(line.imeis)
      ? line.imeis
      : null;

  if (listed === null) {
    const best = fromImeiSheet.length > 0 ? fromImeiSheet : line.imeis;
    if (line.imeiCount != null && line.imeiCount !== best.length) {
      return {
        perUnit: [],
        issue: `The line says ${line.imeiCount} IMEI numbers but ${best.length} were found.`,
      };
    }
    return {
      perUnit: [],
      issue: `${best.length} IMEI numbers do not divide evenly among ${quantity} units.`,
    };
  }

  // Both sources usable but naming different numbers is a contradiction
  // nobody can resolve from the sheet alone.
  if (fits(fromImeiSheet) && fits(line.imeis)) {
    const a = [...fromImeiSheet].sort().join(',');
    const b = [...line.imeis].sort().join(',');
    if (a !== b) {
      return {
        perUnit: [],
        issue: `The IMEI sheet and the IMEI column disagree for this line (${fromImeiSheet.length} against ${line.imeis.length}).`,
      };
    }
  }

  const each = listed.length / quantity;

  const perUnit: string[][] = [];
  for (let unit = 0; unit < quantity; unit += 1) {
    perUnit.push(listed.slice(unit * each, unit * each + each));
  }
  return { perUnit, issue: null };
}

// --- The voucher totals sheet -------------------------------------------------

/**
 * Headings on the voucher sheet: one row per invoice, carrying what the bill
 * itself says it comes to.
 */
export const VOUCHER_SHEET_COLUMNS: SheetColumn[] = [
  { field: 'invoiceNumber', label: 'Supplier Invoice No.', required: true, purpose: 'Ties the totals to an invoice.', headings: ['supplier invoice no', 'supplier invoice number', 'invoice no', 'bill no'] },
  { field: 'voucherNumber', label: 'Voucher No.', required: false, purpose: "The shop's own bill number.", headings: ['voucher no', 'voucher number', 'vch no'] },
  { field: 'party', label: 'Supplier', required: false, purpose: 'The supplier.', headings: ['supplier', 'party', 'party name', 'supplier name'] },
  { field: 'gstin', label: 'GSTIN', required: false, purpose: "The supplier's GST number.", headings: ['supplier gstin', 'gstin', 'gst no'] },
  { field: 'taxableValue', label: 'Taxable Value', required: true, purpose: 'The invoice total before tax.', headings: ['taxable value', 'taxable amount', 'amount before tax'] },
  { field: 'cgst', label: 'CGST', required: false, purpose: 'Central tax on the invoice.', headings: ['cgst', 'central tax'] },
  { field: 'sgst', label: 'SGST', required: false, purpose: 'State tax on the invoice.', headings: ['sgst', 'state tax', 'utgst'] },
  { field: 'igst', label: 'IGST', required: false, purpose: 'Integrated tax on the invoice.', headings: ['igst', 'integrated tax'] },
  { field: 'roundOff', label: 'Round Off', required: false, purpose: 'Rounding the supplier applied to reach a whole-rupee total.', headings: ['round off other', 'round off', 'rounding'] },
  { field: 'total', label: 'Voucher Total', required: true, purpose: 'What the invoice actually comes to, and so what is owed.', headings: ['voucher total', 'invoice total', 'grand total', 'bill total'] },
  { field: 'narration', label: 'Narration', required: false, purpose: 'Any note written against the voucher.', headings: ['narration', 'notes', 'remarks'] },
];

export interface VoucherTotals {
  invoiceNumber: string;
  voucherNumber: string;
  party: string;
  gstin: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Debit positive, credit negative, as applied to reach the total. */
  roundOff: number;
  /** The authoritative figure: what the shop owes for this bill. */
  total: number;
  narration: string;
  issues: string[];
}

export interface VoucherSheetParse {
  sheetName: string;
  columns: PurchaseSheetColumns;
  /** By invoice number, lower-cased. */
  byInvoice: Map<string, VoucherTotals>;
  total: number;
}

/**
 * Read a sheet of per-invoice totals, if the workbook has one.
 *
 * This is the better source for what an invoice comes to: it carries the
 * supplier's own rounding, which summing the lines cannot reproduce — on this
 * shop's October book, 18 of 26 invoices have one.
 */
export function parseVoucherSheet(sheetName: string, rows: unknown[][]): VoucherSheetParse | null {
  const headerIndex = locateHeaderRow(rows, VOUCHER_SHEET_COLUMNS);
  if (headerIndex === -1) return null;
  const columns = matchColumns(rows[headerIndex] ?? [], VOUCHER_SHEET_COLUMNS);
  if (columns.missingRequired.length > 0) return null;

  const at = (row: unknown[], field: string): unknown =>
    columns.found[field] != null ? row[columns.found[field]!] : undefined;
  const text = (row: unknown[], field: string) => cleanCell(at(row, field));

  const byInvoice = new Map<string, VoucherTotals>();
  let total = 0;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const invoiceNumber = text(row, 'invoiceNumber');
    if (!invoiceNumber || /^(grand )?total$/i.test(invoiceNumber)) continue;

    const taxableValue = parseAmount(at(row, 'taxableValue')) ?? 0;
    const cgst = parseAmount(at(row, 'cgst')) ?? 0;
    const sgst = parseAmount(at(row, 'sgst')) ?? 0;
    const igst = parseAmount(at(row, 'igst')) ?? 0;
    const roundOff = parseAmount(at(row, 'roundOff')) ?? 0;
    const stated = parseAmount(at(row, 'total')) ?? 0;
    const issues: string[] = [];

    const computed = round2(taxableValue + cgst + sgst + igst + roundOff);
    if (Math.abs(computed - stated) > 1) {
      issues.push(
        `Taxable value plus tax and rounding comes to ₹${computed}, but the voucher total says ₹${round2(stated)}.`,
      );
    }

    byInvoice.set(invoiceNumber.toLowerCase(), {
      invoiceNumber,
      voucherNumber: text(row, 'voucherNumber'),
      party: text(row, 'party'),
      gstin: text(row, 'gstin').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      taxableValue,
      cgst,
      sgst,
      igst,
      roundOff,
      total: stated,
      narration: text(row, 'narration'),
      issues,
    });
    total += stated;
  }

  return { sheetName, columns, byInvoice, total: round2(total) };
}

// --- The supplier master sheet -------------------------------------------------

export const SUPPLIER_SHEET_COLUMNS: SheetColumn[] = [
  { field: 'name', label: 'Supplier', required: true, purpose: 'The supplier this row describes.', headings: ['supplier', 'party', 'supplier name', 'party name', 'distributor'] },
  { field: 'gstin', label: 'GSTIN', required: false, purpose: 'GST number, which also gives the PAN and state.', headings: ['gstin', 'supplier gstin', 'gst no'] },
  { field: 'pan', label: 'PAN', required: false, purpose: 'PAN, when not derivable from the GSTIN.', headings: ['pan', 'pan no'] },
  { field: 'phone', label: 'Phone', required: false, purpose: 'Landline or main number.', headings: ['phone', 'phone no', 'landline'] },
  { field: 'mobile', label: 'Mobile', required: false, purpose: 'Mobile number.', headings: ['mobile', 'mobile no', 'cell'] },
  { field: 'email', label: 'Email', required: false, purpose: 'Email address.', headings: ['email', 'e mail', 'email id'] },
  { field: 'contact', label: 'Contact', required: false, purpose: 'Person to ask for.', headings: ['contact', 'contact person', 'contact name'] },
  { field: 'address', label: 'Address', required: false, purpose: 'Street address.', headings: ['address', 'supplier address'] },
  { field: 'state', label: 'State', required: false, purpose: 'State, which decides CGST/SGST against IGST.', headings: ['state'] },
  { field: 'pincode', label: 'PIN', required: false, purpose: 'PIN code.', headings: ['pin', 'pincode', 'pin code'] },
  { field: 'bankDetails', label: 'Bank Details', required: false, purpose: 'Bank account the supplier is paid into.', headings: ['bank details', 'bank', 'bank account'] },
];

export interface SupplierRecord {
  name: string;
  gstin: string;
  pan: string;
  phone: string;
  mobile: string;
  email: string;
  contact: string;
  address: string;
  state: string;
  pincode: string;
  bankDetails: string;
}

export interface SupplierSheetParse {
  sheetName: string;
  columns: PurchaseSheetColumns;
  /** By supplier name, reduced for matching. */
  byName: Map<string, SupplierRecord>;
  count: number;
}

/** Supplier name reduced for matching: lower case, no punctuation or "M/s". */
export function supplierKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^m\/?s\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Read a sheet of supplier details, if the workbook has one.
 *
 * Without it a supplier created by an import is a name and nothing else, and
 * somebody has to look the rest up when the bill falls due. With it they
 * arrive complete.
 */
export function parseSupplierSheet(sheetName: string, rows: unknown[][]): SupplierSheetParse | null {
  const headerIndex = locateHeaderRow(rows, SUPPLIER_SHEET_COLUMNS);
  if (headerIndex === -1) return null;
  const columns = matchColumns(rows[headerIndex] ?? [], SUPPLIER_SHEET_COLUMNS);
  if (columns.missingRequired.length > 0) return null;
  if (columns.found.name == null || rows.length < 2) return null;

  // A purchase sheet names a supplier on every line, so having that column is
  // not enough to be the supplier master. What settles it is that this sheet
  // describes suppliers rather than things bought from them.
  const purchase = matchColumns(rows[headerIndex] ?? [], PURCHASE_SHEET_COLUMNS);
  if (purchase.found.item != null || purchase.found.quantity != null) return null;

  const at = (row: unknown[], field: string): unknown =>
    columns.found[field] != null ? row[columns.found[field]!] : undefined;
  const text = (row: unknown[], field: string) => cleanCell(at(row, field));

  const byName = new Map<string, SupplierRecord>();
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const name = text(row, 'name');
    if (!name) continue;
    byName.set(supplierKey(name), {
      name,
      gstin: text(row, 'gstin').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      pan: text(row, 'pan').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      phone: text(row, 'phone'),
      mobile: text(row, 'mobile'),
      email: text(row, 'email'),
      contact: text(row, 'contact'),
      address: text(row, 'address'),
      state: text(row, 'state'),
      pincode: text(row, 'pincode').replace(/\D/g, ''),
      bankDetails: text(row, 'bankDetails'),
    });
  }

  return { sheetName, columns, byName, count: byName.size };
}

// --- Purchases made without a bill ---------------------------------------------

/**
 * Headings on a sheet of goods bought without a bill.
 *
 * A different shape from the billed sheet, because a different thing is being
 * recorded: there is no supplier invoice, no tax and no quantity — one row is
 * one item, numbered by the shop itself. What it does carry is the product
 * type outright, so nothing has to be worked out from an item name.
 */
export const UNBILLED_SHEET_COLUMNS: SheetColumn[] = [
  { field: 'date', label: 'Date', required: true, purpose: 'When the item was bought.', headings: ['date', 'purchase date', 'bill date'] },
  { field: 'invoiceNumber', label: 'Invoice No', required: true, purpose: "The shop's own number for this purchase, such as FURN1.", headings: ['invoice no', 'invoice number', 'invoice', 'bill no'] },
  { field: 'itemType', label: 'Item Type', required: true, purpose: 'The product type, matched to a category of that name.', headings: ['item type', 'product type', 'type', 'category'] },
  { field: 'itemSubType', label: 'Item SubType', required: false, purpose: 'The sub-type within that product type, where it has one.', headings: ['item subtype', 'item sub type', 'subtype', 'sub type', 'sub category', 'subcategory'] },
  { field: 'modelNumber', label: 'Model Number', required: true, purpose: 'The model, which is all the sheet says about the product itself.', headings: ['model number', 'model no', 'model', 'item', 'item name'] },
  { field: 'party', label: 'Supplier Name', required: true, purpose: 'Who it was bought from.', headings: ['supplier name', 'supplier', 'party', 'party name', 'dealer', 'dealer name'] },
  { field: 'dealerPrice', label: 'Dealer Price', required: true, purpose: 'What was paid for the item.', headings: ['dealer price', 'price', 'rate', 'amount', 'purchase price', 'cost'] },
  { field: 'brand', label: 'Brand', required: false, purpose: 'The maker, when the sheet states it rather than leaving it in the model.', headings: ['brand', 'make', 'manufacturer'] },
];

export interface UnbilledLine {
  /** 1-based row number as Excel shows it. */
  rowNumber: number;
  date: string;
  invoiceNumber: string;
  itemType: string;
  itemSubType: string;
  modelNumber: string;
  party: string;
  brand: string;
  dealerPrice: number | null;
  extras: Record<string, string>;
  issues: string[];
}

export interface UnbilledInvoice {
  key: string;
  invoiceNumber: string;
  party: string;
  date: string;
  itemType: string;
  lines: UnbilledLine[];
  total: number;
  issues: string[];
}

export interface UnbilledSheetParse {
  detected: boolean;
  reason?: string;
  sheetName: string;
  headerRow: number;
  columns: PurchaseSheetColumns;
  invoices: UnbilledInvoice[];
  lines: UnbilledLine[];
  skipped: Array<{ rowNumber: number; reason: string }>;
}

/**
 * Read a sheet of purchases made without a bill.
 *
 * Told apart from the billed sheet by what it lacks: no quantity and no
 * separate item name, because one row is one item and the model is all there
 * is. A sheet carrying those belongs to the other reader.
 */
export function parseUnbilledSheet(sheetName: string, rows: unknown[][]): UnbilledSheetParse {
  const blank: UnbilledSheetParse = {
    detected: false,
    sheetName,
    headerRow: 0,
    columns: { found: {}, unknown: [], missingRequired: [], missingOptional: [] },
    invoices: [],
    lines: [],
    skipped: [],
  };

  const headerIndex = locateHeaderRow(rows, UNBILLED_SHEET_COLUMNS);
  if (headerIndex === -1) {
    return {
      ...blank,
      reason:
        'No heading row was found. A sheet of purchases without a bill needs columns for the date, invoice number, item type, model number, supplier and price.',
    };
  }

  const columns = matchColumns(rows[headerIndex] ?? [], UNBILLED_SHEET_COLUMNS);
  if (columns.missingRequired.length > 0) return { ...blank, headerRow: headerIndex + 1, columns };

  // A billed sheet also names a supplier and a price. What settles it is the
  // quantity column, which only a billed sheet has.
  const billed = matchColumns(rows[headerIndex] ?? [], PURCHASE_SHEET_COLUMNS);
  if (billed.found.quantity != null) {
    return {
      ...blank,
      headerRow: headerIndex + 1,
      reason: 'This sheet has a quantity column, so it is read as an ordinary purchase sheet instead.',
    };
  }

  const at = (row: unknown[], field: string): unknown =>
    columns.found[field] != null ? row[columns.found[field]!] : undefined;
  const text = (row: unknown[], field: string) => cleanCell(at(row, field));

  const lines: UnbilledLine[] = [];
  const skipped: UnbilledSheetParse['skipped'] = [];

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (!row.some((cell) => cleanCell(cell) !== '')) continue;

    const modelNumber = text(row, 'modelNumber');
    const invoiceNumber = text(row, 'invoiceNumber');
    if (!modelNumber || /^(grand )?total$/i.test(modelNumber)) {
      skipped.push({ rowNumber, reason: modelNumber ? `"${modelNumber}" is a total, not an item.` : 'No model number.' });
      continue;
    }
    if (!invoiceNumber) {
      skipped.push({ rowNumber, reason: `"${modelNumber}" has no invoice number.` });
      continue;
    }

    const dealerPrice = parseAmount(at(row, 'dealerPrice'));
    const issues: string[] = [];
    if (dealerPrice == null || dealerPrice <= 0) {
      issues.push(`Dealer price "${text(row, 'dealerPrice')}" is not an amount above zero.`);
    }
    if (!text(row, 'itemType')) issues.push('No item type, so there is nowhere to file this.');
    if (!text(row, 'party')) issues.push('No supplier named.');

    const extras: Record<string, string> = {};
    for (const column of columns.unknown) {
      const value = cleanCell(row[column.column]);
      if (value) extras[column.heading] = value;
      if (value && column.samples.length < 3 && !column.samples.includes(value)) column.samples.push(value);
    }

    lines.push({
      rowNumber,
      date: parseSheetDate(at(row, 'date')),
      invoiceNumber,
      itemType: text(row, 'itemType'),
      itemSubType: text(row, 'itemSubType'),
      modelNumber,
      party: text(row, 'party'),
      brand: text(row, 'brand'),
      dealerPrice,
      extras,
      issues,
    });
  }

  // One invoice number is one purchase, however many rows carry it.
  const byKey = new Map<string, UnbilledInvoice>();
  for (const line of lines) {
    const key = line.invoiceNumber.toLowerCase();
    let invoice = byKey.get(key);
    if (!invoice) {
      invoice = {
        key,
        invoiceNumber: line.invoiceNumber,
        party: line.party,
        date: line.date,
        itemType: line.itemType,
        lines: [],
        total: 0,
        issues: [],
      };
      byKey.set(key, invoice);
    }
    if (line.date && invoice.date && line.date !== invoice.date) {
      invoice.issues.push(`Rows of ${invoice.invoiceNumber} give different dates (${invoice.date} and ${line.date}).`);
    }
    if (line.party && invoice.party && line.party !== invoice.party) {
      invoice.issues.push(`${invoice.invoiceNumber} names two suppliers (${invoice.party} and ${line.party}).`);
    }
    invoice.lines.push(line);
    invoice.total = round2(invoice.total + (line.dealerPrice ?? 0));
  }

  const invoices = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber),
  );
  for (const invoice of invoices) {
    if (!invoice.date) invoice.issues.push('No usable date on any row of this purchase.');
  }

  return {
    detected: true,
    sheetName,
    headerRow: headerIndex + 1,
    columns,
    invoices,
    lines,
    skipped,
  };
}

/**
 * The highest number used against each set of letters, e.g. { ALMR: 45 }.
 *
 * A sheet carrying numbers the shop has already written down should move its
 * own numbering past them, or the next purchase added on screen would reuse
 * one and two different things would answer to the same invoice.
 */
export function highestSeriesNumbers(parse: UnbilledSheetParse): Map<string, number> {
  const highest = new Map<string, number>();
  for (const invoice of parse.invoices) {
    const match = /^([A-Za-z]+)\s*(\d+)$/.exec(invoice.invoiceNumber.trim());
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    const number = Number(match[2]);
    if (!Number.isFinite(number)) continue;
    highest.set(prefix, Math.max(highest.get(prefix) ?? 0, number));
  }
  return highest;
}
