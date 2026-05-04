import { SaleType, PaymentMode, FinancePaymentStatus } from './enums';

export interface SaleRecord {
  id: string;
  saleNumber: string;
  ledgerNumber: string;
  shopId: string;
  productId: string;
  customerId: string;
  saleDate: string;
  saleType: SaleType;
  mrp: number;
  sellingPrice: number;
  discountAmount: number;
  netAmount: number;
  gstRate: number;
  gstAmount: number;
  purchasePrice: number;
  purchaseGstAmount: number;
  totalAmount: number;
  downPayment: number;
  paymentMode: PaymentMode;
  paymentBreakdown?: Array<{mode: string; amount: number}> | null;
  // Partial with promise
  promiseDate?: string;
  pendingAmount: number;
  // Self finance
  interestRate?: number;
  fileCharge: number;
  effectiveMonthlyRate?: number | null;
  totalFinancedAmount?: number;
  numInstallments?: number;
  emiAmount?: number;
  guarantorId?: string;
  // Company finance
  financeCompanyId?: string;
  financedAmount?: number;
  expectedPaymentDate?: string;
  financePaymentStatus?: FinancePaymentStatus;
  financePaymentReceivedDate?: string;
  financeReferenceNumber?: string;
  // Completion
  completedAt?: string | null;
  // Approval workflow
  approvalStatus?: 'pending' | 'approved';
  approvedById?: string | null;
  approvedAt?: string | null;
  // Metadata
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleRecordSanitized {
  id: string;
  saleNumber: string;
  ledgerNumber: string;
  shopId: string;
  productId: string;
  customerId: string;
  saleDate: string;
  saleType: 'full_payment';
  sellingPrice: number;
  totalAmount: number;
  paymentMode: 'cash';
  createdBy: string;
  createdAt: string;
}

export interface CreateSaleRequest {
  productId: string;
  customerId: string;
  ledgerNumber: string;
  saleType: SaleType;
  sellingPrice: number;
  discountAmount?: number;
  gstRate?: number;
  downPayment?: number;
  paymentMode: PaymentMode;
  paymentBreakdown?: Array<{mode: string; amount: number}> | null;
  // Partial with promise
  promiseDate?: string;
  // Self finance
  interestRate?: number;
  fileCharge?: number;
  numInstallments?: number;
  guarantorId?: string;
  // Company finance
  financeCompanyId?: string;
  financedAmount?: number;
  expectedPaymentDate?: string;
  notes?: string;
}
