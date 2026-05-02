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
    /**
     * Optional split payment breakdown — up to 3 modes whose amounts must
     * sum (within ₹0.50 tolerance) to `amountPaid`. When provided, the
     * server creates one InstallmentPayment row per split for full audit;
     * the top-level `paymentMode` is used as a fallback / display field.
     */
    paymentBreakdown: z
      .array(
        z.object({
          mode: z.enum([
            'cash',
            'credit_card',
            'debit_card',
            'upi',
            'bank_transfer',
            'cheque',
          ]),
          amount: z.number().positive('Split amount must be positive'),
        }),
      )
      .max(3, 'At most 3 payment modes are allowed')
      .optional(),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
    referenceNumber: z.string().max(100).optional(),
    notes: z.string().optional(),
    /**
     * When true, an excess payment (above the current installment's dues)
     * waives the baked-in future interest on each future installment it
     * fully clears. When false (default), the excess is just decremented
     * from future installments without any interest discount.
     */
    waiveExcessInterest: z.boolean().optional(),
    /**
     * Optional discretionary overdue interest that the collector wants to add
     * to this installment AS PART OF the payment. Server applies the
     * interest before recording the payment, all in one transaction. If the
     * payment fails (or the row is paid with insufficient cash), no interest
     * is applied.
     */
    applyInterest: z
      .object({
        amount: z.number().positive('Interest amount must be positive'),
        notes: z.string().optional(),
      })
      .optional(),
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

    // If a paymentBreakdown was supplied, the splits must sum to amountPaid
    // (within ₹0.50 tolerance for rounding).
    if (data.paymentBreakdown && data.paymentBreakdown.length > 0) {
      if (data.amountPaid !== undefined) {
        const sum = data.paymentBreakdown.reduce((s, b) => s + b.amount, 0);
        if (Math.abs(sum - data.amountPaid) > 0.5) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Payment breakdown total (${sum.toFixed(2)}) must equal amount paid (${data.amountPaid.toFixed(2)})`,
            path: ['paymentBreakdown'],
          });
        }
      }
    }
  });

export const rescheduleSchema = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().optional(),
});

/** Body for `POST /installments/schedules/:scheduleId/final-settlement`. */
export const finalSettlementSchema = z.object({
  paymentMode: z.enum(
    ['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque'],
    { errorMap: () => ({ message: 'Invalid payment mode' }) },
  ),
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
  /**
   * Snapshot of the quoted amount the user saw when confirming. The server
   * recomputes the quote and rejects the request if the live quote differs by
   * more than ₹1 to prevent stale-quote settlements.
   */
  expectedAmount: z.number().nonnegative().optional(),
});

/** Body for `POST /installments/:installmentId/apply-interest`. */
export const applyInterestSchema = z.object({
  /** Amount of overdue interest to apply. Employee may override the suggestion. */
  amount: z.number().positive('Amount must be positive'),
  notes: z.string().optional(),
});

/** Body for `POST /installments/interest-applications/:appId/rollback`. */
export const rollbackInterestSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

/**
 * Body for `POST /installments/payments/:paymentId/move`.
 * Moves a mis-recorded payment from one installment to the correct one,
 * atomically in a single transaction.
 */
export const movePaymentSchema = z.object({
  /** The installment this payment should actually belong to. */
  targetInstallmentId: z.string().uuid('Target installment ID must be a valid UUID'),
  /** Human-readable reason for the correction. */
  reason: z.string().min(1, 'Reason is required'),
  /**
   * Override the payment date (YYYY-MM-DD). Defaults to the original
   * payment's date. Useful when re-attributing late payments.
   */
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  /** Optional overdue interest to apply on the target installment alongside the move. */
  applyInterestOnTarget: z
    .object({
      amount: z.number().positive('Interest amount must be positive'),
      notes: z.string().optional(),
    })
    .optional(),
});
