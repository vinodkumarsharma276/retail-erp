import { z } from 'zod';

export const createDistributorSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(300),
  contactPerson: z.string().min(1, 'Contact person is required').max(200),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(15),
  altPhone: z.string().max(15).nullable().optional(),
  email: z.string().email('Invalid email').max(255).nullable().optional(),
  gstNumber: z.string().max(15).nullable().optional(),
  panNumber: z.string().max(10).nullable().optional(),
  addressLine1: z.string().min(1, 'Address line 1 is required').max(255),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  pincode: z.string().min(6, 'Pincode must be 6 digits').max(6),
  bankName: z.string().max(200).nullable().optional(),
  bankAccountNumber: z.string().max(20).nullable().optional(),
  bankIfsc: z.string().max(11).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
  paymentTerms: z.string().max(500).nullable().optional(),
  creditLimit: z.number().min(0, 'Credit limit must be non-negative').optional(),
  categoryIds: z.array(z.string().uuid('Each category ID must be a valid UUID')).optional(),
});

export const updateDistributorSchema = z.object({
  companyName: z.string().min(1).max(300).optional(),
  contactPerson: z.string().min(1).max(200).optional(),
  phone: z.string().min(10).max(15).optional(),
  altPhone: z.string().max(15).nullable().optional(),
  email: z.string().email('Invalid email').max(255).nullable().optional(),
  gstNumber: z.string().max(15).nullable().optional(),
  panNumber: z.string().max(10).nullable().optional(),
  addressLine1: z.string().min(1).max(255).optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  pincode: z.string().min(6).max(6).optional(),
  bankName: z.string().max(200).nullable().optional(),
  bankAccountNumber: z.string().max(20).nullable().optional(),
  bankIfsc: z.string().max(11).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
  paymentTerms: z.string().max(500).nullable().optional(),
  creditLimit: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid('Each category ID must be a valid UUID')).optional(),
});

export const distributorListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
});

export const distributorProductsQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

/** One part of a payment: what was handed over, and how. */
const tenderSchema = z.object({
  amount: z.number().positive('Each amount must be a positive number'),
  paymentMode: z.string().min(1, 'Payment mode is required'),
  referenceNumber: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

/**
 * A payment to a supplier, in one or more tenders.
 *
 * The single-amount shape is still accepted and folded into a one-tender
 * payment, so anything already calling this — the mobile app, a script —
 * keeps working.
 */
export const lumpsumPaymentSchema = z
  .object({
    tenders: z.array(tenderSchema).min(1).max(10, 'At most 10 parts to one payment').optional(),
    amount: z.number().positive('Amount must be a positive number').optional(),
    paymentMode: z.string().min(1).optional(),
    paymentDate: z.string().min(1, 'Payment date is required'),
    referenceNumber: z.string().max(100).optional(),
    notes: z.string().optional(),
  })
  .transform((value) => ({
    paymentDate: value.paymentDate,
    notes: value.notes,
    tenders:
      value.tenders ??
      (value.amount != null && value.paymentMode
        ? [
            {
              amount: value.amount,
              paymentMode: value.paymentMode,
              referenceNumber: value.referenceNumber ?? null,
              notes: null,
            },
          ]
        : []),
  }))
  .refine((value) => value.tenders.length > 0, {
    message: 'Say how much was paid, and how',
    path: ['tenders'],
  });

export const deleteDistributorsSchema = z.object({
  ids: z
    .array(z.string().uuid('Distributor ID must be a valid UUID'))
    .min(1, 'Choose at least one distributor')
    .max(1000, 'Delete at most 1000 distributors at a time — narrow the search first'),
  /**
   * Take the supplier's invoices and the stock they brought in as well.
   * Off by default: a caller that has not said so gets the safe refusal
   * rather than a silent cascade.
   */
  cascade: z.boolean().optional(),
});

export const distributorImpactSchema = z.object({
  ids: z
    .array(z.string().uuid('Distributor ID must be a valid UUID'))
    .min(1, 'Choose at least one distributor')
    .max(1000, 'Ask about at most 1000 distributors at a time'),
});

export const mergeDistributorsSchema = z.object({
  sourceIds: z
    .array(z.string().uuid('Distributor ID must be a valid UUID'))
    .min(1, 'Choose at least one duplicate to merge')
    .max(50, 'Merge at most 50 duplicates at a time'),
  targetId: z.string().uuid('Choose which distributor to keep'),
});

/**
 * A creditor row as the browser mapped it. The sheet is parsed client-side
 * by `parseCreditorSheet`, so what arrives is already shaped; this only
 * guards the boundary.
 */
const creditorRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  companyName: z.string().min(1, 'Supplier name is required').max(300),
  contactPerson: z.string().max(200),
  phone: z.string().max(15),
  altPhone: z.string().max(15).nullable(),
  email: z.string().max(255).nullable(),
  gstNumber: z.string().max(15).nullable(),
  panNumber: z.string().max(10).nullable(),
  addressLine1: z.string().max(255),
  city: z.string().max(100),
  state: z.string().max(100),
  pincode: z.string().max(6),
  balances: z.object({
    closingCr: z.number(),
    closingDr: z.number(),
    net: z.number(),
    group: z.string().max(200),
  }),
  rejected: z
    .array(z.object({ field: z.string().max(40), value: z.string().max(200) }))
    .default([]),
});

export const distributorImportSchema = z.object({
  rows: z
    .array(creditorRowSchema)
    .min(1, 'The sheet has no suppliers in it')
    .max(5000, 'Import at most 5000 suppliers at a time'),
});

export const checkDuplicatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1).optional(),
        companyName: z.string().min(1).max(300),
        phone: z.string().max(20).nullable().optional(),
        gstNumber: z.string().max(20).nullable().optional(),
        panNumber: z.string().max(20).nullable().optional(),
        excludeId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(5000, 'Check at most 5000 at a time'),
});
