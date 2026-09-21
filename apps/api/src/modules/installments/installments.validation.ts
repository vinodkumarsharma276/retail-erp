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

export const recordPaymentSchema = z.object({
  scenario: z.enum(['full_payment', 'reschedule', 'partial_reschedule']).optional(),
  amount: z.number().positive('Amount must be positive').optional(),
  amountPaid: z.number().positive('Amount must be positive').optional(),
  paymentMode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque']),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  explicitInstallmentId: z.string().uuid().optional(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
  // Declared explicitly: Zod strips unknown keys, so an undeclared flag would
  // silently disappear before reaching the controller.
  applyPenalty: z.boolean().optional(),
  applyEarlyPaymentDeduction: z.boolean().optional(),
  applyInterest: z
    .object({
      installmentId: z.string().uuid().optional(),
      amount: z.number().positive('Interest amount must be positive').optional(),
      appliedAmount: z.number().positive('Interest amount must be positive').optional(),
      daysOverdue: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
    })
    .optional(),
}).superRefine((data, ctx) => {
  if (data.amount === undefined && data.amountPaid === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount or amountPaid is required', path: ['amount'] });
  }
  if (data.scenario === 'reschedule') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reschedule is replaced by creating a promise', path: ['scenario'] });
  }
});

export const rescheduleSchema = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  notes: z.string().optional(),
});

/** Body for `POST /installments/:installmentId/undo-reschedule`. */
export const undoRescheduleSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500),
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

/** Body for `PATCH /installments/schedules/:scheduleId/penalty-per-day`. */
export const penaltyPerDaySchema = z.object({
  penaltyPerDay: z
    .number({ invalid_type_error: 'Penalty must be a number' })
    .min(0, 'Penalty cannot be negative')
    .max(10000, 'Penalty per day looks too high'),
});

/** Body for `POST /installments/interest-applications/:appId/rollback`. */
export const rollbackInterestSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

/**
 * Body for `POST /installments/payments/:paymentId/correct`.
 * Corrects a payment that was recorded with the wrong amount (usually higher
 * than what the customer actually paid). The shortfall is distributed equally
 * across upcoming installments; a new installment is created if none remain.
 */
export const correctPaymentSchema = z.object({
  /** The amount the customer actually paid (must be > 0 and < recorded amount). */
  correctAmount: z.number().positive('Correct amount must be positive'),
  /** Human-readable reason for the correction. */
  reason: z.string().min(1, 'Reason is required'),
  /** Optional overdue interest on the shortfall to distribute alongside the correction. */
  applyInterest: z
    .object({
      amount: z.number().positive('Interest amount must be positive'),
      notes: z.string().optional(),
    })
    .optional(),
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
