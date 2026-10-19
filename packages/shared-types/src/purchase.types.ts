import { PaymentMode } from './enums';

export enum PurchasePaymentStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
}

export interface Purchase {
  id: string;
  shopId: string;
  distributorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  gstAmount: number;
  discountAmount: number;
  netAmount: number;
  amountPaid: number;
  pendingAmount: number;
  paymentStatus: PurchasePaymentStatus;
  notes?: string;
  /**
   * False for goods bought without a supplier bill. They carry no tax, and
   * their invoice number is one the shop issued itself.
   */
  billed?: boolean;
  /**
   * How the purchase was recorded: "manual" when typed in, "excel_import"
   * when it came from an uploaded sheet.
   */
  source?: 'manual' | 'excel_import';
  /** The import run it came from, when it was imported. */
  importBatchId?: string | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  distributor?: {
    id: string;
    companyName: string;
    contactPerson: string;
    phone: string;
  };
  shop?: {
    id: string;
    name: string;
    code: string;
  };
  products?: PurchaseProduct[];
  payments?: PurchasePayment[];
}

export interface PurchaseProduct {
  id: string;
  purchaseId: string;
  productId: string;
  categoryId: string;
  brand: string;
  modelNumber: string;
  serialNumber?: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  dynamicAttributes?: Record<string, unknown>;
}

export interface PurchasePayment {
  id: string;
  purchaseId: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNumber?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export interface CreatePurchaseRequest {
  distributorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  gstAmount?: number;
  discountAmount?: number;
  notes?: string;
  items: CreatePurchaseItemRequest[];
  amountPaid?: number;
  paymentMode?: PaymentMode;
  paymentReference?: string;
}

export interface CreatePurchaseItemRequest {
  categoryId: string;
  brand: string;
  modelNumber: string;
  serialNumber?: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  color?: string;
  warrantyMonths?: number;
  barcode?: string;
  dynamicAttributes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Purchases made without a bill
//
// Furniture and almirahs are often bought with no supplier invoice at all.
// The shop numbers those itself, in a running series per product type —
// FURN1, FURN2… and ALMR41, ALMR42… — and they carry no tax.
// ---------------------------------------------------------------------------

/** Where a product type's own invoice numbering has reached. */
export interface UnbilledSeriesState {
  categoryId: string;
  categoryName: string;
  /** False until somebody sets the first number. */
  started: boolean;
  /** Letters in front of the number, e.g. FURN. */
  prefix: string;
  nextNumber: number;
  /** What the next invoice would be called, e.g. "FURN12". */
  nextInvoiceNumber: string;
}

/** One kind of goods that can be filed against a series, e.g. Wardrobe. */
export interface UnbilledTypeChoice {
  categoryId: string;
  categoryName: string;
  /** Read down from the non-billed type, e.g. "Furniture › Wardrobe". */
  label: string;
}

/** A type bought without a bill, with the kinds of goods filed under it. */
export interface UnbilledType {
  series: UnbilledSeriesState;
  choices: UnbilledTypeChoice[];
}

/** Starting, or correcting, a type's numbering. */
export interface StartUnbilledSeriesRequest {
  categoryId: string;
  prefix: string;
  startNumber: number;
}

/**
 * No invoice number is sent: it is issued from the type's own series as the
 * purchase saves, so two people entering one at the same time cannot be
 * given the same number. The saved purchase says what it became.
 */
export interface CreateUnbilledPurchaseRequest {
  distributorId: string;
  /** The non-billed type whose numbering this purchase takes. */
  seriesCategoryId: string;
  invoiceDate: string;
  notes?: string;
  items: CreateUnbilledPurchaseItemRequest[];
}

/** Looser than a billed item: no serial, and no price set for the floor yet. */
export interface CreateUnbilledPurchaseItemRequest {
  categoryId: string;
  brand?: string;
  modelNumber: string;
  serialNumber?: string;
  mrp?: number;
  sellingPrice?: number;
  purchasePrice: number;
  color?: string;
  warrantyMonths?: number;
  barcode?: string;
  dynamicAttributes?: Record<string, unknown>;
}

export interface RecordPurchasePaymentRequest {
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNumber?: string;
  notes?: string;
}

export interface DistributorProduct {
  id: string;
  brand: string;
  modelNumber: string;
  serialNumber?: string;
  categoryId: string;
  categoryName?: string;
  purchasePrice: number;
  purchaseDate?: string;
  invoiceNumber?: string;
  category?: {
    id: string;
    name: string;
    slug: string;
    path?: string;
  };
  purchase?: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
  };
}

export interface DistributorPayment {
  id: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNumber?: string;
  invoiceNumber?: string;
  createdAt: string;
  purchase?: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    netAmount: number;
    shop?: { id: string; name: string; code: string };
  };
}

export interface PendingInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  amountPaid: number;
  pendingAmount: number;
  paymentStatus: PurchasePaymentStatus;
}
