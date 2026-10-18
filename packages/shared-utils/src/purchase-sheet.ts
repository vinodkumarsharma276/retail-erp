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
  { field: 'gstin', label: 'GSTIN', required: false, purpose: "The supplier's GST number, which also gives their PAN and state.", headings: ['gstin', 'gstin uin', 'gst no', 'gst number', 'party gstin'] },
  { field: 'hsnCode', label: 'HSN', required: false, purpose: 'HSN code for the line.', headings: ['hsn', 'hsn code', 'hsn sac'] },
  { field: 'mrp', label: 'MRP', required: false, purpose: 'Printed retail price.', headings: ['mrp', 'm r p'] },
  { field: 'colour', label: 'Colour', required: false, purpose: 'Colour, when the sheet states it separately.', headings: ['colour', 'color'] },
  { field: 'serialNumber', label: 'Serial No.', required: false, purpose: 'Serial number for a single unit.', headings: ['serial no', 'serial number', 'sr no'] },
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

/** IMEIs as written in one cell, separated by commas, spaces or newlines. */
export function splitImeis(value: unknown): string[] {
  return cleanCell(value)
    .split(/[,;/\n]+/)
    .map((part) => part.replace(/\D/g, ''))
    .filter(Boolean);
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
    const imei = at(row, 'imei').replace(/\D/g, '');
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
  // The dedicated sheet is the fuller record; the inline column cross-checks it.
  const listed = fromImeiSheet.length > 0 ? fromImeiSheet : line.imeis;
  if (quantity <= 0 || listed.length === 0) return { perUnit: [], issue: null };

  if (fromImeiSheet.length > 0 && line.imeis.length > 0) {
    const a = [...fromImeiSheet].sort().join(',');
    const b = [...line.imeis].sort().join(',');
    if (a !== b) {
      return {
        perUnit: [],
        issue: `The IMEI sheet and the IMEI column disagree for this line (${fromImeiSheet.length} against ${line.imeis.length}).`,
      };
    }
  }
  if (line.imeiCount != null && line.imeiCount !== listed.length) {
    return {
      perUnit: [],
      issue: `The line says ${line.imeiCount} IMEI numbers but ${listed.length} were found.`,
    };
  }

  const each = listed.length / quantity;
  if (each !== 1 && each !== 2) {
    return {
      perUnit: [],
      issue: `${listed.length} IMEI numbers do not divide evenly among ${quantity} units.`,
    };
  }

  const perUnit: string[][] = [];
  for (let unit = 0; unit < quantity; unit += 1) {
    perUnit.push(listed.slice(unit * each, unit * each + each));
  }
  return { perUnit, issue: null };
}
