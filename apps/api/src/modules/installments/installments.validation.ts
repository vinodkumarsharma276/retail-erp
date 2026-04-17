import { z } from 'zod';

export const scheduleListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  status: z.enum(['active', 'completed', 'defaulted']).optional(),
});

export const collectionsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  employeeId: z.string().uuid('Employee ID must be a valid UUID').optional(),
});

export const recordPaymentSchema = z
  .object({
    scenario: z.enum(['full_payment', 'reschedule', 'partial_reschedule'], {
      errorMap: () => ({ message: 'Scenario must be full_payment, reschedule, or partial_reschedule' }),
    }),
    amountPaid: z.number().positive('Amount must be positive').optional(),
    paymentMode: z
      .enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque'], {
        errorMap: () => ({ message: 'Invalid payment mode' }),
      })
      .optional(),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    referenceNumber: z.string().max(100).optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // full_payment requires amountPaid and paymentMode
    if (data.scenario === 'full_payment') {
      if (data.amountPaid === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'amountPaid is required for full_payment',
          path: ['amountPaid'],
        });
      }
      if (!data.paymentMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'paymentMode is required for full_payment',
          path: ['paymentMode'],
        });
      }
    }

    // reschedule requires newDate
    if (data.scenario === 'reschedule') {
      if (!data.newDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'newDate is required for reschedule',
          path: ['newDate'],
        });
      }
    }

    // partial_reschedule requires amountPaid, paymentMode, and newDate
    if (data.scenario === 'partial_reschedule') {
      if (data.amountPaid === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'amountPaid is required for partial_reschedule',
          path: ['amountPaid'],
        });
      }
      if (!data.paymentMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'paymentMode is required for partial_reschedule',
          path: ['paymentMode'],
        });
      }
      if (!data.newDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'newDate is required for partial_reschedule',
          path: ['newDate'],
        });
      }
    }
  });

export const rescheduleSchema = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().optional(),
});
