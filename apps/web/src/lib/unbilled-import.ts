import {
  UNBILLED_SHEET_COLUMNS,
  highestSeriesNumbers,
  parseUnbilledSheet,
  type UnbilledSheetParse,
} from '@retailerp/shared-utils';
import type { PurchaseImportRow, SheetColumnReport } from '@retailerp/shared-types';
import type { ParsedWorkbook } from './purchase-import';

/**
 * Turning a sheet of purchases made without a bill into import rows.
 *
 * These are real goods from a real supplier, so they travel the same path as
 * any other purchase: the same preview, the same stock, the same product
 * records. Two things differ. There is no bill, so no tax and an invoice
 * number the shop wrote itself; and the sheet names the product type
 * outright, so the classifier is asked only for the brand and the model.
 */

/** A category of the tenant's, flattened for matching by name. */
export interface CategoryChoice {
  id: string;
  name: string;
  parentName: string | null;
}

export interface UnbilledRead {
  parse: UnbilledSheetParse;
  rows: PurchaseImportRow[];
  /** Distinct model numbers, for the classifier to name the brand. */
  itemNames: string[];
  columns: SheetColumnReport;
  /** Item types the sheet names that the shop has no category for. */
  unknownTypes: Array<{ type: string; subType: string; rows: number }>;
  /** Highest invoice number seen against each set of letters. */
  highestNumbers: Array<{ prefix: string; number: number }>;
}

/** True when this workbook is a sheet of purchases made without a bill. */
export function looksLikeUnbilledSheet(workbook: ParsedWorkbook): boolean {
  return workbook.sheets.some((sheet) => parseUnbilledSheet(sheet.name, sheet.formatted).detected);
}

function columnReport(parse: UnbilledSheetParse, headings: unknown[]): SheetColumnReport {
  const byField = new Map(UNBILLED_SHEET_COLUMNS.map((column) => [column.field, column]));
  return {
    recognised: Object.entries(parse.columns.found).map(([field, index]) => ({
      heading: String(headings[index] ?? '').trim(),
      field,
      label: byField.get(field)?.label ?? field,
    })),
    unknown: parse.columns.unknown.map((column) => ({ heading: column.heading, samples: column.samples })),
    missingRequired: parse.columns.missingRequired.map((column) => ({ label: column.label, purpose: column.purpose })),
    missingOptional: parse.columns.missingOptional,
  };
}

const key = (value: string) => String(value ?? '').trim().toLowerCase();

/**
 * Read the workbook into import rows.
 *
 * The sheet says the type and, where it has one, the sub-type. The sub-type
 * wins when both are given, because it is the more precise of the two — an
 * item filed under "Furniture" when the sheet says "Wardrobe" would lose
 * detail the shop took the trouble to record.
 */
export function readUnbilledSheet(
  workbook: ParsedWorkbook,
  categories: CategoryChoice[],
): UnbilledRead | null {
  let parse: UnbilledSheetParse | null = null;
  let headings: unknown[] = [];
  for (const sheet of workbook.sheets) {
    const read = parseUnbilledSheet(sheet.name, sheet.formatted);
    if (read.detected) {
      parse = read;
      headings = sheet.formatted[read.headerRow - 1] ?? [];
      break;
    }
  }
  if (!parse) return null;

  // By name, a child winning over a parent of the same name, so "Wardrobe"
  // finds the category under Furniture rather than any top-level namesake.
  const byName = new Map<string, CategoryChoice>();
  for (const category of [...categories].sort((a, b) => Number(Boolean(a.parentName)) - Number(Boolean(b.parentName)))) {
    byName.set(key(category.name), category);
  }

  const rows: PurchaseImportRow[] = [];
  const unknown = new Map<string, { type: string; subType: string; rows: number }>();

  for (const invoice of parse.invoices) {
    for (const line of invoice.lines) {
      const category = byName.get(key(line.itemSubType)) ?? byName.get(key(line.itemType)) ?? null;
      if (!category) {
        const k = `${key(line.itemType)}|${key(line.itemSubType)}`;
        const entry = unknown.get(k) ?? { type: line.itemType, subType: line.itemSubType, rows: 0 };
        entry.rows += 1;
        unknown.set(k, entry);
      }

      rows.push({
        rowNumber: line.rowNumber,
        invoiceNumber: line.invoiceNumber,
        invoiceDate: line.date,
        distributorName: line.party,
        // One row is one item; there is no quantity on this sheet.
        quantity: 1,
        modelNumber: line.modelNumber,
        // The sheet has a column for it, so it is known, not deduced.
        modelKnown: true,
        brand: line.brand || undefined,
        rate: line.dealerPrice ?? undefined,
        amount: line.dealerPrice ?? undefined,
        // Stated by the sheet, so it is not left to the classifier.
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? (line.itemSubType || line.itemType),
      });
    }
  }

  const seen = new Set<string>();
  const itemNames: string[] = [];
  for (const row of rows) {
    const k = row.modelNumber.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    itemNames.push(row.modelNumber);
  }

  return {
    parse,
    rows,
    itemNames,
    columns: columnReport(parse, headings),
    unknownTypes: [...unknown.values()].sort((a, b) => b.rows - a.rows),
    highestNumbers: [...highestSeriesNumbers(parse)].map(([prefix, number]) => ({ prefix, number })),
  };
}

/** A short line describing what was read, for the upload step. */
export function describeUnbilledSheet(read: UnbilledRead): string {
  const types = new Set(read.parse.invoices.map((invoice) => invoice.itemType).filter(Boolean));
  const total = read.parse.invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  return [
    `${read.parse.invoices.length} purchase${read.parse.invoices.length === 1 ? '' : 's'}`,
    `${read.rows.length} item${read.rows.length === 1 ? '' : 's'}`,
    `${types.size} product type${types.size === 1 ? '' : 's'}`,
    `₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ].join(' · ');
}
