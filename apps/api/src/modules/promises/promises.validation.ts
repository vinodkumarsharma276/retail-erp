import { z } from 'zod';

export const createPromiseSchema = z.object({
  scheduleId: z.string().uuid('Schedule ID must be a valid UUID'),
  customerId: z.string().uuid('Customer ID must be a valid UUID'),
  coveredInstallmentIds: z.array(z.string().uuid()).min(1, 'At least one EMI must be covered'),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  promisedAmount: z.number().positive('Promised amount must be positive'),
  notes: z.string().max(500).optional(),
});

export const listPromisesQuerySchema = z.object({
  scheduleId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(['pending', 'kept', 'partially_kept', 'broken']).optional(),
});
