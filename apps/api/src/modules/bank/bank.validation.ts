import { z } from 'zod';

export const createAccountSchema = z.object({
  bankName: z.string().min(1, 'Bank name is required').max(200),
  accountNumber: z.string().min(1, 'Account number is required').max(20),
  ifscCode: z.string().min(1, 'IFSC code is required').max(11),
  accountType: z
    .enum(['current', 'savings'], {
      errorMap: () => ({ message: 'Account type must be "current" or "savings"' }),
    })
    .optional()
    .default('current'),
  openingBalance: z.number().min(0).optional().default(0),
});

export const addTransactionSchema = z.object({
  transactionDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'transactionDate must be a valid date string',
  }),
  valueDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'valueDate must be a valid date string',
    })
    .nullable()
    .optional(),
  description: z.string().max(500).nullable().optional(),
  referenceNumber: z.string().max(100).nullable().optional(),
  txnType: z.enum(['credit', 'debit'], {
    errorMap: () => ({ message: 'txnType must be "credit" or "debit"' }),
  }),
  amount: z.number().positive('Amount must be positive'),
  balance: z.number().nullable().optional(),
});

export const bulkImportSchema = z.object({
  transactions: z.array(
    z.object({
      transactionDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: 'transactionDate must be a valid date string',
      }),
      valueDate: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
          message: 'valueDate must be a valid date string',
        })
        .nullable()
        .optional(),
      description: z.string().max(500).nullable().optional(),
      referenceNumber: z.string().max(100).nullable().optional(),
      txnType: z.enum(['credit', 'debit'], {
        errorMap: () => ({ message: 'txnType must be "credit" or "debit"' }),
      }),
      amount: z.number().positive('Amount must be positive'),
      balance: z.number().nullable().optional(),
    }),
  ).min(1, 'At least one transaction is required'),
});

export const transactionListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  reconciliationStatus: z
    .enum(['unmatched', 'matched', 'manual_match', 'disputed'])
    .optional(),
});

export const reconcileSchema = z.object({
  reconciledWithType: z.enum(
    ['sale', 'purchase_payment', 'expense', 'installment_payment'],
    { errorMap: () => ({ message: 'Invalid reconciliation type' }) },
  ),
  reconciledWithId: z.string().uuid('reconciledWithId must be a valid UUID'),
});

export const manualReconcileSchema = z.object({
  notes: z.string().min(1, 'Notes are required for manual reconciliation').max(500),
});
