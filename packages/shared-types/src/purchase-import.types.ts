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
  /** Product type, matched to a category by name. */
  categoryName?: string;
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
  /** Invoice total as printed, used only to cross-check. */
  invoiceTotal?: number;
  hsnCode?: string;
  color?: string;
  warrantyMonths?: number;
}

export interface PurchaseImportRequest {
  rows: PurchaseImportRow[];
  /** Sheet product-type name (lower-cased) → category id. Key `""` = rows with no type. */
  categoryMap?: Record<string, string>;
  /** Record the imported invoices as already paid, with this payment mode. */
  markPaid?: { paymentMode: 'cash' | 'upi' | 'bank_transfer' | 'cheque' } | null;
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
}

export interface PurchaseImportPreviewInvoice {
  /** Stable grouping key: supplier + invoice number + date. */
  key: string;
  invoiceNumber: string;
  invoiceDate: string;
  rowNumbers: number[];
  distributor: {
    name: string;
    gstNumber: string | null;
    matchedId: string | null;
    matchedName: string | null;
    matchedBy: 'gst' | 'name' | null;
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
  invoices: PurchaseImportPreviewInvoice[];
  /** Product types in the sheet that match no category. `""` = blank. */
  unknownCategories: Array<{ name: string; rows: number }>;
  summary: {
    invoices: number;
    ready: number;
    units: number;
    newDistributors: number;
    duplicates: number;
    withErrors: number;
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
}
