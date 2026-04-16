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
  purchaseDate: string;
  invoiceNumber: string;
}

export interface DistributorPayment {
  id: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate: string;
  referenceNumber?: string;
  invoiceNumber: string;
  createdAt: string;
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
