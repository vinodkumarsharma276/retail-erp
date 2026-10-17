import * as XLSX from 'xlsx';
import type { PurchaseImportRow } from '@retailerp/shared-types';

/**
 * Reading a purchase sheet (Tally export or any Excel/CSV) and turning its
 * columns into PurchaseImportRow fields. Everything here runs in the
 * browser; the server only ever sees mapped rows.
 */

export type ImportFieldKey =
  | 'invoiceDate' | 'invoiceNumber' | 'invoiceTotal'
  | 'distributorName' | 'distributorGst' | 'distributorPhone' | 'distributorAddress'
  | 'distributorCity' | 'distributorState' | 'distributorPincode'
  | 'categoryName' | 'brand' | 'modelNumber' | 'serialNumber' | 'color' | 'hsnCode' | 'warrantyMonths'
  | 'quantity' | 'rate' | 'amount' | 'mrp' | 'sellingPrice' | 'discount'
  | 'gstAmount' | 'cgst' | 'sgst' | 'igst' | 'gstRate';

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  group: 'Invoice' | 'Supplier' | 'Product' | 'Amounts';
  required?: boolean;
  /** Filled from the row above when blank (Tally prints these once per voucher). */
  invoiceLevel?: boolean;
  hint?: string;
  /** Column headings that mean this field, most specific first. */
  synonyms: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'invoiceDate', label: 'Invoice date', group: 'Invoice', required: true, invoiceLevel: true,
    synonyms: ['supplier invoice date', 'invoice date', 'bill date', 'inv date', 'voucher date', 'date'] },
  { key: 'invoiceNumber', label: 'Invoice number', group: 'Invoice', required: true, invoiceLevel: true,
    hint: "The supplier's bill number. Use Tally's voucher number only if there is none.",
    synonyms: ['supplier invoice no', 'supplier invoice number', 'invoice no', 'invoice number', 'bill no', 'bill number', 'inv no', 'reference no', 'ref no', 'voucher no', 'vch no', 'voucher number'] },
  { key: 'invoiceTotal', label: 'Invoice total (to cross-check)', group: 'Invoice', invoiceLevel: true,
    synonyms: ['invoice total', 'invoice value', 'invoice amount', 'bill amount', 'gross total', 'grand total'] },

  { key: 'distributorName', label: 'Supplier name', group: 'Supplier', required: true, invoiceLevel: true,
    synonyms: ['party name', 'supplier name', 'supplier', 'distributor name', 'distributor', 'vendor name', 'vendor', 'party', 'particulars', 'ledger name', 'party a c name'] },
  { key: 'distributorGst', label: 'Supplier GSTIN', group: 'Supplier', invoiceLevel: true,
    synonyms: ['gstin uin', 'party gstin', 'supplier gstin', 'gstin', 'gst no', 'gst number', 'gstin no'] },
  { key: 'distributorPhone', label: 'Supplier phone', group: 'Supplier', invoiceLevel: true,
    synonyms: ['phone', 'mobile', 'phone no', 'mobile no', 'contact no'] },
  { key: 'distributorAddress', label: 'Supplier address', group: 'Supplier', invoiceLevel: true, synonyms: ['address', 'party address'] },
  { key: 'distributorCity', label: 'Supplier city', group: 'Supplier', invoiceLevel: true, synonyms: ['city'] },
  { key: 'distributorState', label: 'Supplier state', group: 'Supplier', invoiceLevel: true, synonyms: ['state', 'party state'] },
  { key: 'distributorPincode', label: 'Supplier PIN code', group: 'Supplier', invoiceLevel: true, synonyms: ['pincode', 'pin code', 'pin'] },

  { key: 'categoryName', label: 'Product type', group: 'Product',
    hint: 'Matched to your categories by name. Unknown types can be mapped on the next step.',
    synonyms: ['product type', 'stock group', 'stock category', 'item group', 'category', 'group', 'type'] },
  { key: 'brand', label: 'Brand', group: 'Product', synonyms: ['brand', 'make', 'manufacturer', 'company'] },
  { key: 'modelNumber', label: 'Item / model name', group: 'Product', required: true,
    synonyms: ['stock item', 'name of item', 'item name', 'item description', 'product name', 'model no', 'model number', 'model', 'item', 'product', 'description'] },
  { key: 'serialNumber', label: 'Serial / IMEI', group: 'Product', synonyms: ['serial no', 'serial number', 'imei no', 'imei', 'batch no'] },
  { key: 'color', label: 'Colour', group: 'Product', synonyms: ['colour', 'color'] },
  { key: 'hsnCode', label: 'HSN code', group: 'Product', synonyms: ['hsn sac', 'hsn code', 'hsn'] },
  { key: 'warrantyMonths', label: 'Warranty (months)', group: 'Product', synonyms: ['warranty months', 'warranty'] },

  { key: 'quantity', label: 'Quantity', group: 'Amounts', required: true,
    synonyms: ['billed qty', 'billed quantity', 'actual qty', 'actual quantity', 'quantity', 'qty'] },
  { key: 'rate', label: 'Rate (per unit, before GST)', group: 'Amounts',
    synonyms: ['rate per unit', 'unit price', 'rate', 'price'] },
  { key: 'amount', label: 'Line amount (before GST)', group: 'Amounts',
    hint: 'Used to work out the rate when there is no rate column.',
    synonyms: ['taxable value', 'taxable amount', 'item amount', 'gross amount', 'amount', 'value'] },
  { key: 'mrp', label: 'MRP', group: 'Amounts', synonyms: ['mrp', 'm r p'] },
  { key: 'sellingPrice', label: 'Selling price', group: 'Amounts', synonyms: ['selling price', 'sale price', 'sales price'] },
  { key: 'discount', label: 'Discount (₹ on the line)', group: 'Amounts', synonyms: ['discount amount', 'disc amt', 'discount', 'disc'] },
  { key: 'gstAmount', label: 'GST amount (total)', group: 'Amounts', synonyms: ['total tax', 'tax amount', 'gst amount', 'gst'] },
  { key: 'cgst', label: 'CGST amount', group: 'Amounts', synonyms: ['cgst amount', 'central tax', 'cgst'] },
  { key: 'sgst', label: 'SGST / UTGST amount', group: 'Amounts', synonyms: ['sgst amount', 'state tax', 'sgst', 'utgst'] },
  { key: 'igst', label: 'IGST amount', group: 'Amounts', synonyms: ['igst amount', 'integrated tax', 'igst'] },
  { key: 'gstRate', label: 'GST rate %', group: 'Amounts', synonyms: ['gst rate', 'tax rate', 'gst', 'rate of tax'] },
];

export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

export interface ParsedSheet {
  name: string;
  /** Raw cell values, row by row (blank rows kept). Dates stay Excel serial numbers. */
  rows: unknown[][];
  /**
   * The same cells as Excel displays them. A Tally register has to be read
   * this way: raw values drop the "Dr"/"Cr" markers that give an amount its
   * sign, and turn "4.00 Pcs." into a bare 4.
   */
  formatted: unknown[][];
  /** Excel row index (0-based) of rows[0] — sheets don't always start at A1. */
  rowOffset: number;
  /** Excel column index (0-based) of each row's first cell. */
  colOffset: number;
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
}

export async function readWorkbook(file: File): Promise<ParsedWorkbook> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array', cellDates: false, raw: false });
  return {
    fileName: file.name,
    sheets: wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 } };
      return {
        name,
        // Keep blank rows so row numbers match what Excel shows.
        rows: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: true }),
        formatted: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true }),
        rowOffset: range.s.r,
        colOffset: range.s.c,
      };
    }),
  };
}

/** "Supplier Invoice No." → "supplier invoice no" */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** The row that looks most like a heading row, within the first 30. */
export function detectHeaderRow(rows: unknown[][]): number {
  const all = new Set(IMPORT_FIELDS.flatMap((f) => f.synonyms));
  let best = 0;
  let bestScore = 0;
  rows.slice(0, 30).forEach((row, index) => {
    const score = row.filter((cell) => all.has(normalizeHeader(cell))).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** Match headings to fields: exact synonym first, in field order. */
export function autoMap(headers: unknown[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    for (const synonym of field.synonyms) {
      const col = normalized.findIndex((h, i) => !used.has(i) && h === synonym);
      if (col !== -1) {
        mapping[field.key] = col;
        used.add(col);
        break;
      }
    }
  }
  // GST rate and GST amount share the word "gst"; a "%" heading is the rate.
  const pct = normalized.findIndex((h, i) => !used.has(i) && /gst.*%|%.*gst|tax %/.test(h));
  if (pct !== -1 && mapping.gstRate == null) mapping.gstRate = pct;
  return mapping;
}

// --- Cell parsing --------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

/** Excel serial, "1-Apr-25", "01/04/2025" (day first), "2025-04-01" → YYYY-MM-DD. */
export function parseDateCell(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})$/.exec(s);
  if (m) {
    const name = m[2].toLowerCase();
    const month = MONTHS[name.slice(0, 4)] ?? MONTHS[name.slice(0, 3)];
    if (month) {
      const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return `${year}-${pad(month)}-${pad(+m[1])}`;
    }
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${year}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return s; // the server reports it as invalid
}

/** "12,500.00", "₹ 1,200 Dr", "2 Nos", "(150.00)" → number; blank → undefined. */
export function parseNumberCell(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  let s = String(value).trim();
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[(),₹\s]|rs\.?|inr/gi, '');
  const m = /-?\d+(\.\d+)?/.exec(s);
  if (!m) return undefined;
  const n = Math.abs(parseFloat(m[0]));
  return negative ? -n : n;
}

function textCell(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  const s = String(value).trim();
  return s || undefined;
}

export interface MapOptions {
  headerRow: number;
  mapping: ColumnMapping;
  /** Fill blank invoice-level cells from the row above. */
  fillDown: boolean;
}

export interface MappedRows {
  rows: PurchaseImportRow[];
  /** Lines skipped as blank or totals, by sheet row number. */
  skipped: number[];
}

/** Turn sheet rows into import rows using the column mapping. */
export function mapRows(sheet: ParsedSheet, options: MapOptions): MappedRows {
  const { mapping, headerRow, fillDown } = options;
  const cell = (row: unknown[], key: ImportFieldKey) => (mapping[key] != null ? row[mapping[key]!] : undefined);
  const carry: Partial<Record<ImportFieldKey, unknown>> = {};
  const out: PurchaseImportRow[] = [];
  const skipped: number[] = [];

  sheet.rows.slice(headerRow + 1).forEach((row, index) => {
    const rowNumber = sheet.rowOffset + headerRow + 2 + index; // 1-based, as Excel shows it
    // A date, invoice number or supplier on this row starts a new invoice:
    // nothing from the previous invoice may carry into it (a blank GSTIN on
    // a new supplier must stay blank, not inherit the last supplier's).
    const startsInvoice = (['invoiceDate', 'invoiceNumber', 'distributorName'] as const).some((k) => {
      const v = cell(row, k);
      return v != null && v !== '';
    });
    if (startsInvoice) for (const k of Object.keys(carry)) delete carry[k as ImportFieldKey];
    const get = (key: ImportFieldKey) => {
      let v = cell(row, key);
      const field = IMPORT_FIELDS.find((f) => f.key === key)!;
      if (field.invoiceLevel && fillDown) {
        if (v == null || v === '') v = carry[key];
        else carry[key] = v;
      }
      return v;
    };

    const model = textCell(cell(row, 'modelNumber'));
    const firstCell = normalizeHeader(row.find((c) => c !== '' && c != null));
    // Blank lines, and Tally's "Total" / "Grand Total" lines.
    if (!model && (firstCell === '' || /^(grand )?total|^opening|^closing/.test(firstCell))) {
      if (row.some((c) => c !== '' && c != null)) skipped.push(rowNumber);
      // Invoice-level cells on a header-only line still carry down.
      IMPORT_FIELDS.filter((f) => f.invoiceLevel).forEach((f) => void get(f.key));
      return;
    }

    const cgst = parseNumberCell(cell(row, 'cgst')) ?? 0;
    const sgst = parseNumberCell(cell(row, 'sgst')) ?? 0;
    const igst = parseNumberCell(cell(row, 'igst')) ?? 0;
    const gstTotal = parseNumberCell(cell(row, 'gstAmount'));
    const split = cgst + sgst + igst;
    const qty = parseNumberCell(cell(row, 'quantity'));

    out.push({
      rowNumber,
      invoiceDate: parseDateCell(get('invoiceDate')),
      invoiceNumber: textCell(get('invoiceNumber')) ?? '',
      invoiceTotal: parseNumberCell(get('invoiceTotal')),
      distributorName: textCell(get('distributorName')) ?? '',
      distributorGst: textCell(get('distributorGst')),
      distributorPhone: textCell(get('distributorPhone')),
      distributorAddress: textCell(get('distributorAddress')),
      distributorCity: textCell(get('distributorCity')),
      distributorState: textCell(get('distributorState')),
      distributorPincode: textCell(get('distributorPincode')),
      categoryName: textCell(cell(row, 'categoryName')),
      brand: textCell(cell(row, 'brand')),
      modelNumber: model ?? '',
      serialNumber: textCell(cell(row, 'serialNumber')),
      color: textCell(cell(row, 'color')),
      hsnCode: textCell(cell(row, 'hsnCode')),
      warrantyMonths: parseNumberCell(cell(row, 'warrantyMonths')),
      quantity: qty == null ? (mapping.quantity == null ? 1 : 0) : Math.abs(qty),
      rate: parseNumberCell(cell(row, 'rate')),
      amount: (() => { const a = parseNumberCell(cell(row, 'amount')); return a == null ? undefined : Math.abs(a); })(),
      mrp: parseNumberCell(cell(row, 'mrp')),
      sellingPrice: parseNumberCell(cell(row, 'sellingPrice')),
      discount: parseNumberCell(cell(row, 'discount')),
      gstAmount: split > 0 ? split : gstTotal,
      gstRate: parseNumberCell(cell(row, 'gstRate')),
    });
  });

  return { rows: out, skipped };
}

/** Sample value for a column, for the mapping screen. */
export function sampleValue(sheet: ParsedSheet, headerRow: number, col: number | undefined): string {
  if (col == null) return '';
  for (const row of sheet.rows.slice(headerRow + 1, headerRow + 12)) {
    const v = row[col];
    if (v !== '' && v != null) return String(v);
  }
  return '';
}
