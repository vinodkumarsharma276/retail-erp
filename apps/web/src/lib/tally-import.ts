import {
  allocateVoucherTax,
  isTallyPurchaseRegister,
  parseTallyPurchaseRegister,
  type TallyRegisterParse,
  type TallyRegisterVoucher,
} from '@retailerp/shared-utils';
import type { ItemClassification, PurchaseImportRow } from '@retailerp/shared-types';
import type { ParsedSheet } from './purchase-import';

/**
 * Turning a Tally purchase register into import rows.
 *
 * The register is recognised and read outright — no column mapping and no
 * guesswork, because the layout never varies. What it does not contain is
 * what each product *is*: there is no category, brand or colour column, so
 * the item names go to the server to be identified before the preview is
 * built. See `item-classifier.ts` on the API side.
 */

export interface TallyRead {
  parse: TallyRegisterParse;
  rows: PurchaseImportRow[];
  /** Distinct item names, in sheet order, to be identified. */
  itemNames: string[];
}

/** True when this sheet is a Tally purchase register. */
export function looksLikeTallyRegister(sheet: ParsedSheet): boolean {
  return isTallyPurchaseRegister(sheet.formatted);
}

/**
 * One import row per item line, with the invoice details repeated on each and
 * the voucher's tax shared out across its lines.
 */
export function readTallyRegister(sheet: ParsedSheet): TallyRead {
  const parse = parseTallyPurchaseRegister(sheet.formatted);
  const rows: PurchaseImportRow[] = [];

  for (const voucher of parse.vouchers) {
    const taxShares = allocateVoucherTax(voucher);
    voucher.items.forEach((item, index) => {
      rows.push({
        rowNumber: item.rowNumber,
        invoiceNumber: voucher.invoiceNumber,
        invoiceDate: voucher.invoiceDate,
        distributorName: voucher.supplierName,
        distributorGst: voucher.gstin || undefined,
        distributorPan: voucher.pan || undefined,
        distributorPhone: voucher.supplierPhone || undefined,
        distributorAddress: voucher.supplierAddress || undefined,
        distributorState: voucher.supplierState || undefined,
        distributorPincode: voucher.supplierPincode || undefined,
        consigneeName: voucher.consigneeName || undefined,
        voucherNumber: voucher.voucherNumber || undefined,
        // The item name is all the sheet says about the product; the
        // classifier splits it into brand, model, colour and category.
        modelNumber: item.name,
        quantity: item.quantity ?? 0,
        rate: item.rate ?? undefined,
        amount: item.value ?? undefined,
        gstAmount: taxShares[index] ?? 0,
        invoiceTotal: voucher.grossTotal ?? undefined,
        // Repeated on each line; the server takes it once per invoice.
        roundOff: voucher.roundOff || undefined,
      });
    });
  }

  const seen = new Set<string>();
  const itemNames: string[] = [];
  for (const row of rows) {
    const key = row.modelNumber.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    itemNames.push(row.modelNumber);
  }

  return { parse, rows, itemNames };
}

/** The lookup key the server uses for an item name. Must match `itemNameKey`. */
export function itemNameKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:\-]+$/, '')
    .trim()
    .slice(0, 300);
}

/**
 * Fill in what the classifier worked out. Rows whose name was not resolved
 * keep an empty category, and the preview reports them as needing a choice.
 */
export function applyClassifications(
  rows: PurchaseImportRow[],
  classifications: ItemClassification[],
): PurchaseImportRow[] {
  const byKey = new Map(classifications.map((item) => [item.nameKey, item]));
  return rows.map((row) => {
    const match = byKey.get(itemNameKey(row.modelNumber));
    if (!match) return row;
    return {
      ...row,
      categoryId: match.categoryId,
      categoryName: match.categoryLabel ?? row.categoryName,
      brand: match.brand || row.brand,
      // Keep the sheet's own wording as the model when nothing better was found.
      modelNumber: match.modelNumber || row.modelNumber,
      // Whether a real model was ever established, so a unit without one can
      // be flagged on the product list rather than holding up the sheet.
      modelKnown:
        Boolean(match.modelNumber) &&
        match.modelNumber.trim().toLowerCase() !== match.rawName.trim().toLowerCase(),
      color: match.color ?? row.color,
      attributes: match.attributes,
      isDemoUnit: match.isDemoUnit,
    };
  });
}

/** A short line describing what was read, for the upload step. */
export function describeTallyRead(read: TallyRead): string {
  const { parse } = read;
  const units = parse.vouchers.reduce(
    (sum, voucher) => sum + voucher.items.reduce((n, item) => n + (item.quantity ?? 0), 0),
    0,
  );
  const parts = [
    `${parse.vouchers.length} invoice${parse.vouchers.length === 1 ? '' : 's'}`,
    `${read.rows.length} item line${read.rows.length === 1 ? '' : 's'}`,
    `${units} unit${units === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

/** Sheet totals against Tally's own Grand Total row — proof the read was clean. */
export function checkAgainstGrandTotal(read: TallyRead): { label: string; ok: boolean }[] {
  const { parse } = read;
  if (!parse.grandTotal) return [];
  const units = parse.vouchers.reduce(
    (sum, voucher) => sum + voucher.items.reduce((n, item) => n + (item.quantity ?? 0), 0),
    0,
  );
  const taxable = parse.vouchers.reduce((sum, voucher) => sum + (voucher.taxableValue ?? 0), 0);
  const gross = parse.vouchers.reduce((sum, voucher) => sum + (voucher.grossTotal ?? 0), 0);
  const checks: { label: string; ok: boolean }[] = [];

  if (parse.grandTotal.quantity != null) {
    checks.push({ label: `Units: ${units} of ${parse.grandTotal.quantity}`, ok: units === parse.grandTotal.quantity });
  }
  if (parse.grandTotal.taxableValue != null) {
    checks.push({
      label: 'Taxable value',
      ok: Math.abs(taxable - parse.grandTotal.taxableValue) < 1,
    });
  }
  if (parse.grandTotal.grossTotal != null) {
    checks.push({ label: 'Invoice total', ok: Math.abs(gross - parse.grandTotal.grossTotal) < 1 });
  }
  return checks;
}

export type { TallyRegisterParse, TallyRegisterVoucher };
