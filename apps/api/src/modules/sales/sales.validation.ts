import { z } from 'zod';

export const createSaleSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  customerId: z.string().uuid('Customer ID must be a valid UUID'),
  ledgerNumber: z.string().min(1, 'Ledger number is required').max(50),
  saleDate: z.string().optional(), // defaults to today if not provided
  saleType: z.enum(['full_payment', 'partial_with_promise', 'self_finance', 'company_finance'], {
    errorMap: () => ({ message: 'Invalid sale type' }),
  }),
  sellingPrice: z.number().positive('Selling price must be positive'),
  discountAmount: z.number().min(0, 'Discount amount must be non-negative').optional(),
  gstRate: z.number().min(0, 'GST rate must be non-negative').optional(),
  downPayment: z.number().min(0, 'Down payment must be non-negative').optional(),
  paymentMode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque'], {
    errorMap: () => ({ message: 'Invalid payment mode' }),
  }),
  paymentBreakdown: z.array(z.object({
    mode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque']),
    amount: z.number().min(0),
  })).max(3).optional(),
  // Partial with promise
  promiseDate: z.string().nullable().optional(),
  // Self finance
  interestRate: z.number().min(0).max(100).nullable().optional(),
  fileCharge: z.number().min(0).nullable().optional(),
  numInstallments: z.number().int().min(1).max(60).nullable().optional(),
  guarantorId: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().uuid('Guarantor ID must be a valid UUID').optional(),
  ),
  // Company finance
  financeCompanyId: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().uuid('Finance company ID must be a valid UUID').optional(),
  ),
  financedAmount: z.number().min(0).nullable().optional(),
  expectedPaymentDate: z.string().nullable().optional(),
  // Notes
  notes: z.string().nullable().optional(),
});

export const saleListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  saleType: z.enum(['full_payment', 'partial_with_promise', 'self_finance', 'company_finance']).optional(),
  customerSearch: z.string().optional(),
});

export const recordFinancePaymentSchema = z.object({
  financePaymentStatus: z.enum(['pending', 'received', 'overdue', 'partial'], {
    errorMap: () => ({ message: 'Invalid finance payment status' }),
  }),
  financePaymentReceivedDate: z.string().nullable().optional(),
  financeReferenceNumber: z.string().max(100).nullable().optional(),
});

export const recordPendingPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  paymentMode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque'], {
    errorMap: () => ({ message: 'Invalid payment mode' }),
  }),
  paymentBreakdown: z.array(z.object({
    mode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque']),
    amount: z.number().min(0),
  })).max(3).optional(),
  notes: z.string().nullable().optional(),
});
