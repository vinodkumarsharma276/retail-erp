import { z } from 'zod';

export const createExpenseSchema = z.object({
  expenseDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'expenseDate must be a valid date string',
  }),
  category: z.enum(
    ['rent', 'electricity', 'salary', 'transport', 'maintenance', 'marketing', 'purchase', 'misc'],
    { errorMap: () => ({ message: 'Invalid expense category' }) },
  ),
  vendorName: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
  amount: z.number().positive('Amount must be positive'),
  gstAmount: z.number().min(0, 'GST amount cannot be negative').nullable().optional(),
  invoiceNumber: z.string().max(100).nullable().optional(),
  invoiceUrl: z.string().max(500).nullable().optional(),
  isGstClaimable: z.boolean().optional(),
});

export const updateExpenseSchema = z.object({
  expenseDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'expenseDate must be a valid date string',
    })
    .optional(),
  category: z
    .enum(
      ['rent', 'electricity', 'salary', 'transport', 'maintenance', 'marketing', 'purchase', 'misc'],
      { errorMap: () => ({ message: 'Invalid expense category' }) },
    )
    .optional(),
  vendorName: z.string().max(200).nullable().optional(),
  description: z.string().nullable().optional(),
  amount: z.number().positive('Amount must be positive').optional(),
  gstAmount: z.number().min(0, 'GST amount cannot be negative').nullable().optional(),
  invoiceNumber: z.string().max(100).nullable().optional(),
  invoiceUrl: z.string().max(500).nullable().optional(),
  isGstClaimable: z.boolean().optional(),
});

export const expenseListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  category: z
    .enum(['rent', 'electricity', 'salary', 'transport', 'maintenance', 'marketing', 'purchase', 'misc'])
    .optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

export const expenseSummaryQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
