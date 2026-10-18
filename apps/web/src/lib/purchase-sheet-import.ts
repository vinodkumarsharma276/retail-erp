import {
  PURCHASE_SHEET_COLUMNS,
  imeisPerUnit,
  lineKey,
  parseImeiSheet,
  parsePurchaseSheet,
  type ImeiSheetParse,
  type PurchaseSheetParse,
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
  // The IMEI sheet first: the purchase reader wants it alongside.
  let imeiSheet: ImeiSheetParse | null = null;
  for (const sheet of workbook.sheets) {
    const read = parseImeiSheet(sheet.name, sheet.formatted);
    if (read && read.total > 0) {
      imeiSheet = read;
      break;
    }
  }

  let parse: PurchaseSheetParse | null = null;
  let headings: unknown[] = [];
  for (const sheet of workbook.sheets) {
    if (imeiSheet && sheet.name === imeiSheet.sheetName) continue;
    const read = parsePurchaseSheet(sheet.name, sheet.formatted, imeiSheet);
    if (read.detected) {
      parse = read;
      headings = sheet.formatted[read.headerRow - 1] ?? [];
      break;
    }
  }
  if (!parse) return null;

  const rows: PurchaseImportRow[] = [];
  const imeiProblems: PurchaseSheetRead['imeiProblems'] = [];

  for (const invoice of parse.invoices) {
    for (const line of invoice.lines) {
      const listed = imeiSheet?.byLine.get(lineKey(line.invoiceNumber, line.party, line.item)) ?? [];
      const { perUnit, issue } = imeisPerUnit(line, listed);
      if (issue) imeiProblems.push({ rowNumber: line.rowNumber, item: line.item, issue });

      rows.push({
        rowNumber: line.rowNumber,
        invoiceNumber: line.invoiceNumber,
        invoiceDate: line.date,
        distributorName: line.party,
        distributorGst: line.gstin || undefined,
        voucherNumber: line.voucherNumber || undefined,
        // The item name is all the sheet says about the product; the
        // classifier splits it into brand, model, colour and category.
        modelNumber: line.item,
        quantity: line.quantity ?? 0,
        rate: line.rate ?? undefined,
        amount: line.amount ?? undefined,
        gstAmount: line.gstAmount ?? undefined,
        gstRate: line.gstRate ?? undefined,
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

  return { parse, imeiSheet, rows, itemNames, columns: columnReport(parse, headings), imeiProblems };
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
