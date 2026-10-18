import {
  PURCHASE_SHEET_COLUMNS,
  imeisPerUnit,
  lineKey,
  parseImeiSheet,
  parsePurchaseSheet,
  parseSupplierSheet,
  parseVoucherSheet,
  supplierKey,
  type ImeiSheetParse,
  type PurchaseSheetParse,
  type SupplierSheetParse,
  type VoucherSheetParse,
} from '@retailerp/shared-utils';
import type { PurchaseImportRow, SheetColumnReport } from '@retailerp/shared-types';
import type { ParsedWorkbook } from './purchase-import';

/**
 * Turning the shop's own purchase sheet into import rows.
 *
 * The workbook holds the purchases on one sheet and, when there are phones,
 * their IMEI numbers on another. Which is which is settled by reading them,
 * not by their names, so a renamed tab still works.
 */

export interface PurchaseSheetRead {
  parse: PurchaseSheetParse;
  imeiSheet: ImeiSheetParse | null;
  /** Per-invoice totals, when the workbook carries them. */
  voucherSheet: VoucherSheetParse | null;
  /** The supplier master, when the workbook carries one. */
  supplierSheet: SupplierSheetParse | null;
  /** Invoices whose totals disagree with the lines beneath them. */
  totalProblems: Array<{ invoiceNumber: string; issue: string }>;
  rows: PurchaseImportRow[];
  /** Distinct item names, in sheet order, to be identified. */
  itemNames: string[];
  /** How the columns lined up, for the person uploading. */
  columns: SheetColumnReport;
  /** Lines whose IMEI numbers could not be divided among their units. */
  imeiProblems: Array<{ rowNumber: number; item: string; issue: string }>;
}

/** True when this workbook looks like the shop's purchase sheet. */
export function looksLikePurchaseSheet(workbook: ParsedWorkbook): boolean {
  return workbook.sheets.some((sheet) => parsePurchaseSheet(sheet.name, sheet.formatted).detected);
}

function columnReport(parse: PurchaseSheetParse, headings: unknown[]): SheetColumnReport {
  const byField = new Map(PURCHASE_SHEET_COLUMNS.map((column) => [column.field, column]));
  return {
    recognised: Object.entries(parse.columns.found).map(([field, index]) => ({
      // The heading as the sheet actually spells it, so the person can see
      // which of their columns was taken for what.
      heading: String(headings[index] ?? '').trim(),
      field,
      label: byField.get(field)?.label ?? field,
    })),
    unknown: parse.columns.unknown.map((column) => ({ heading: column.heading, samples: column.samples })),
    missingRequired: parse.columns.missingRequired.map((column) => ({ label: column.label, purpose: column.purpose })),
    missingOptional: parse.columns.missingOptional,
  };
}

/**
 * Read the workbook into import rows.
 *
 * Each unit of a line keeps its own IMEI numbers, so a phone can be traced
 * from this invoice to the customer who buys it.
 */
export function readPurchaseSheet(workbook: ParsedWorkbook): PurchaseSheetRead | null {
  // The purchase sheet is found first, and it is the one that carries every
  // field the importer needs. Looking for the companions first was a mistake:
  // the purchase sheet names a supplier on every line, so it answered to the
  // supplier master, and the real supplier list — which now shares several
  // columns with it — answered to being the purchase sheet.
  let parse: PurchaseSheetParse | null = null;
  let headings: unknown[] = [];
  let purchaseSheetName = '';
  for (const sheet of workbook.sheets) {
    const read = parsePurchaseSheet(sheet.name, sheet.formatted);
    if (read.detected && read.columns.missingRequired.length === 0) {
      parse = read;
      headings = sheet.formatted[read.headerRow - 1] ?? [];
      purchaseSheetName = sheet.name;
      break;
    }
  }
  // Nothing fully qualified: take the closest match so the missing columns
  // can be named, rather than refusing the workbook with no explanation.
  if (!parse) {
    for (const sheet of workbook.sheets) {
      const read = parsePurchaseSheet(sheet.name, sheet.formatted);
      if (read.detected) {
        parse = read;
        headings = sheet.formatted[read.headerRow - 1] ?? [];
        purchaseSheetName = sheet.name;
        break;
      }
    }
  }
  if (!parse) return null;

  // Then the companions, from whatever is left.
  let imeiSheet: ImeiSheetParse | null = null;
  let voucherSheet: VoucherSheetParse | null = null;
  let supplierSheet: SupplierSheetParse | null = null;
  for (const sheet of workbook.sheets) {
    if (sheet.name === purchaseSheetName) continue;
    if (!imeiSheet) {
      const read = parseImeiSheet(sheet.name, sheet.formatted);
      if (read && read.total > 0) {
        imeiSheet = read;
        continue;
      }
    }
    if (!voucherSheet) {
      const read = parseVoucherSheet(sheet.name, sheet.formatted);
      if (read && read.byInvoice.size > 0) {
        voucherSheet = read;
        continue;
      }
    }
    if (!supplierSheet) {
      const read = parseSupplierSheet(sheet.name, sheet.formatted);
      if (read && read.count > 0) supplierSheet = read;
    }
  }

  // The purchase sheet is re-read now the IMEI sheet is known, so its lines
  // can be checked against it.
  const withImeis = workbook.sheets.find((sheet) => sheet.name === purchaseSheetName);
  if (withImeis) parse = parsePurchaseSheet(purchaseSheetName, withImeis.formatted, imeiSheet);

  const rows: PurchaseImportRow[] = [];
  const imeiProblems: PurchaseSheetRead['imeiProblems'] = [];

  for (const invoice of parse.invoices) {
    for (const line of invoice.lines) {
      const listed = imeiSheet?.byLine.get(lineKey(line.invoiceNumber, line.party, line.item)) ?? [];
      const master = supplierSheet?.byName.get(supplierKey(line.party));
      const totals = voucherSheet?.byInvoice.get(line.invoiceNumber.toLowerCase());
      const { perUnit, issue } = imeisPerUnit(line, listed);
      if (issue) imeiProblems.push({ rowNumber: line.rowNumber, item: line.item, issue });

      rows.push({
        rowNumber: line.rowNumber,
        invoiceNumber: line.invoiceNumber,
        invoiceDate: line.date,
        distributorName: line.party,
        // The supplier master is the fuller record; the line fills any gap it
        // leaves, so a workbook without that sheet still carries what it can.
        distributorGst: master?.gstin || line.gstin || undefined,
        distributorPan: master?.pan || line.supplier.pan || undefined,
        distributorPhone: master?.mobile || master?.phone || line.supplier.phone || undefined,
        distributorAddress: master?.address || line.supplier.address || undefined,
        distributorState: master?.state || line.supplier.state || undefined,
        distributorPincode: master?.pincode || line.supplier.pincode || undefined,
        voucherNumber: line.voucherNumber || undefined,
        // The item name is all the sheet says about the product; the
        // classifier splits it into brand, model, colour and category.
        modelNumber: line.item,
        quantity: line.quantity ?? 0,
        rate: line.rate ?? undefined,
        amount: line.amount ?? undefined,
        gstAmount: line.gstAmount ?? undefined,
        gstRate: line.gstRate ?? undefined,
        // What the bill itself says it comes to, and the rounding that gets
        // it there. Summing lines cannot reproduce a supplier's rounding.
        invoiceTotal: totals?.total ?? undefined,
        roundOff: totals?.roundOff ?? undefined,
        hsnCode: line.hsnCode || undefined,
        mrp: line.mrp ?? undefined,
        color: line.colour || undefined,
        serialNumber: line.serialNumber || undefined,
        unitImeis: perUnit.length > 0 ? perUnit : undefined,
      });
    }
  }

  const seen = new Set<string>();
  const itemNames: string[] = [];
  for (const row of rows) {
    const key = row.modelNumber.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    itemNames.push(row.modelNumber);
  }

  // The voucher sheet is the authority on what is owed, so where it and the
  // lines disagree that is worth saying before anything is saved.
  const totalProblems: PurchaseSheetRead['totalProblems'] = [];
  for (const invoice of parse.invoices) {
    const totals = voucherSheet?.byInvoice.get(invoice.invoiceNumber.toLowerCase());
    if (!totals) continue;
    for (const issue of totals.issues) totalProblems.push({ invoiceNumber: invoice.invoiceNumber, issue });
    if (Math.abs(totals.taxableValue - invoice.taxableValue) > 1) {
      totalProblems.push({
        invoiceNumber: invoice.invoiceNumber,
        issue: `The voucher says ₹${totals.taxableValue} before tax, but its lines add up to ₹${invoice.taxableValue}.`,
      });
    }
  }

  return {
    parse,
    imeiSheet,
    voucherSheet,
    supplierSheet,
    rows,
    itemNames,
    columns: columnReport(parse, headings),
    imeiProblems,
    totalProblems,
  };
}

/** A short line describing what was read, for the upload step. */
export function describePurchaseSheet(read: PurchaseSheetRead): string {
  const units = read.parse.invoices.reduce((sum, invoice) => sum + invoice.units, 0);
  const imeis = read.rows.reduce((sum, row) => sum + (row.unitImeis?.flat().length ?? 0), 0);
  const parts = [
    `${read.parse.invoices.length} invoice${read.parse.invoices.length === 1 ? '' : 's'}`,
    `${read.rows.length} item line${read.rows.length === 1 ? '' : 's'}`,
    `${units} unit${units === 1 ? '' : 's'}`,
  ];
  if (imeis > 0) parts.push(`${imeis} IMEI number${imeis === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
