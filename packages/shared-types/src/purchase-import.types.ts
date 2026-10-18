/**
 * Bulk purchase import (e.g. a Tally purchase register exported to Excel).
 *
 * The browser reads the sheet and maps its columns to these fields; the
 * server matches suppliers and product types, groups lines into invoices,
 * and reports problems before anything is saved.
 */

/** One line of the sheet, after column mapping. Amounts are in rupees. */
export interface PurchaseImportRow {
  /** Row number in the Excel sheet, for messages ("row 14"). */
  rowNumber: number;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  distributorName: string;
  distributorGst?: string;
  distributorPhone?: string;
  distributorAddress?: string;
  distributorCity?: string;
  distributorState?: string;
  distributorPincode?: string;
  distributorPan?: string;
  /** Product type, matched to a category by name. */
  categoryName?: string;
  /**
   * A category settled outright — by the item classifier, or by hand in the
   * preview. Takes precedence over matching `categoryName`.
   */
  categoryId?: string | null;
  brand?: string;
  /** Item / model name. */
  modelNumber: string;
  serialNumber?: string;
  quantity: number;
  /** Price per unit before GST. Worked out from `amount` when not given. */
  rate?: number;
  /** Line amount before GST (quantity × rate). */
  amount?: number;
  mrp?: number;
  sellingPrice?: number;
  discount?: number;
  /** Line GST in rupees — CGST + SGST + IGST if the sheet splits them. */
  gstAmount?: number;
  gstRate?: number;
  /**
   * Rounding the supplier applied to the invoice total, debit positive.
   * Indian invoices are rounded to the rupee, so without this the stored
   * total differs from the printed one by a few paise per invoice.
   */
  roundOff?: number;
  /** Invoice total as printed, used only to cross-check. */
  invoiceTotal?: number;
  hsnCode?: string;
  color?: string;
  warrantyMonths?: number;
  /** Category attributes to store on each unit (RAM, storage, size). */
  attributes?: Record<string, string>;
  /**
   * IMEI numbers for each unit of this line, in order: one entry per unit,
   * each holding that handset’s number or numbers. A dual-SIM handset has
   * two, so this is a list of lists rather than a flat list.
   */
  unitImeis?: string[][];
/**
   * False when no real model number could be worked out and the item name
   * is standing in for one. The unit is still imported — it was bought and
   * it exists — but it is marked so the gap can be filled from the product
   * list rather than holding up the whole sheet.
   */
  modelKnown?: boolean;
  /** A display or demo piece: bought, but not sellable as new. */
  isDemoUnit?: boolean;
  /** The buyer named on the voucher, used to check the sheet matches the shop. */
  consigneeName?: string;
  /** Tally's own voucher number, kept alongside the supplier invoice number. */
  voucherNumber?: string;
}

export interface PurchaseImportRequest {
  rows: PurchaseImportRow[];
  /** Sheet product-type name (lower-cased) → category id. Key `""` = rows with no type. */
  categoryMap?: Record<string, string>;
  /** Record the imported invoices as already paid, with this payment mode. */
  markPaid?: { paymentMode: 'cash' | 'upi' | 'bank_transfer' | 'cheque' } | null;
  /** The file these rows came from, recorded against the import. */
  fileName?: string;
  /** How the sheet was read. */
  sourceFormat?: 'tally_purchase_register' | 'mapped_columns';
  /** Period the register covered, as printed on it ("1-Sep-26 to 30-Sep-26"). */
  period?: string;
  /** The entity named in the sheet header, kept so a mis-filed import can be traced. */
  sheetOwnerName?: string;
  /**
   * Fill blank details (address, state, PIN code, PAN, phone) on suppliers
   * already on file from what the sheet says. Existing values are never
   * overwritten.
   */
  updateDistributors?: boolean;
}

export interface PurchaseImportPreviewItem {
  rowNumber: number;
  categoryName: string;
  categoryId: string | null;
  categoryLabel: string | null;
  brand: string;
  modelNumber: string;
  serialNumber: string | null;
  quantity: number;
  rate: number;
  discount: number;
  gstAmount: number;
  mrp: number;
  /** Category attributes that will be stored on each unit. */
  attributes: Record<string, string>;
  /** A display or demo piece, flagged so it is not sold as new. */
  isDemoUnit: boolean;
  /** IMEI numbers for each unit of this line, in order. */
  unitImeis: string[][];
}

export interface PurchaseImportPreviewInvoice {
  /** Stable grouping key: supplier + invoice number + date. */
  key: string;
  invoiceNumber: string;
  /** The shop's own bill/voucher number, printed beside the supplier's. */
  voucherNumber: string | null;
  invoiceDate: string;
  rowNumbers: number[];
  distributor: {
    name: string;
    gstNumber: string | null;
    matchedId: string | null;
    matchedName: string | null;
    matchedBy: 'gst' | 'name' | null;
    /** Blank fields on the matched supplier that the sheet can fill in. */
    fieldsToFill: Array<{ field: string; label: string; value: string }>;
  };
  items: PurchaseImportPreviewItem[];
  unitCount: number;
  totalAmount: number;
  discountAmount: number;
  gstAmount: number;
  netAmount: number;
  /** Already recorded for this supplier — will be skipped. */
  duplicateOf: { purchaseId: string } | null;
  /** Problems that stop this invoice from being imported. */
  errors: string[];
  /** Worth a look, but the invoice can still be imported. */
  warnings: string[];
}

export interface PurchaseImportPreview {
  shop: { id: string; name: string; code: string };
  /**
   * Whether the sheet's consignee looks like the shop being imported into.
   * A Tally register is exported per entity, so importing one into the wrong
   * shop is the easiest mistake to make and the hardest to undo.
   */
  shopCheck: {
    sheetOwnerName: string | null;
    consigneeNames: string[];
    matches: boolean;
  } | null;
  invoices: PurchaseImportPreviewInvoice[];
  /** Product types in the sheet that match no category. `""` = blank. */
  unknownCategories: Array<{ name: string; rows: number }>;
  /** Suppliers on file whose blank details this sheet would fill in. */
  distributorUpdates: Array<{
    distributorId: string;
    name: string;
    fields: Array<{ field: string; label: string; value: string }>;
  }>;
  summary: {
    invoices: number;
    ready: number;
    units: number;
    newDistributors: number;
    updatedDistributors: number;
    duplicates: number;
    withErrors: number;
    demoUnits: number;
  };
}

export interface PurchaseImportResult {
  results: Array<{
    key: string;
    invoiceNumber: string;
    distributorName: string;
    status: 'created' | 'skipped' | 'failed';
    purchaseId?: string;
    message?: string;
  }>;
  created: number;
  skipped: number;
  failed: number;
  distributorsCreated: number;
  distributorsUpdated: number;
  /** The import run these invoices belong to, for the purchase list. */
  batchId: string | null;
}

/** One past import run, for the imports history. */
export interface PurchaseImportBatchSummary {
  id: string;
  fileName: string;
  sourceFormat: string;
  period: string | null;
  sheetOwnerName: string | null;
  shop: { id: string; name: string; code: string } | null;
  invoiceCount: number;
  unitCount: number;
  netAmount: number;
  skippedCount: number;
  failedCount: number;
  distributorsCreated: number;
  distributorsUpdated: number;
  createdByName: string | null;
  createdAt: string;
}

/**
 * What the reader made of a sheet’s columns.
 *
 * The shops change their export over time, so a sheet is never coerced into
 * the shape the importer expects. What it did not recognise, and what it
 * expected but could not find, are both put in front of the person
 * uploading before anything is read.
 */
export interface SheetColumnReport {
  /** Columns understood, by their heading in the sheet. */
  recognised: Array<{ heading: string; field: string; label: string }>;
  /** Headings that mean nothing to the importer yet, with sample values. */
  unknown: Array<{ heading: string; samples: string[] }>;
  /** Required columns the sheet does not carry, and what each was for. */
  missingRequired: Array<{ label: string; purpose: string }>;
  /** Optional columns absent. Worth knowing, never a problem. */
  missingOptional: string[];
}
