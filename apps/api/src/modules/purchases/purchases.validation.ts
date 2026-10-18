import { z } from 'zod';

const purchaseItemSchema = z.object({
  categoryId: z.string().uuid('Category ID must be a valid UUID'),
  brand: z.string().min(1, 'Brand is required').max(200),
  modelNumber: z.string().min(1, 'Model number is required').max(200),
  serialNumber: z.string().max(200).nullable().optional(),
  mrp: z.number().positive('MRP must be positive'),
  sellingPrice: z.number().min(0, 'Selling price must be non-negative').optional(),
  purchasePrice: z.number().positive('Purchase price must be positive'),
  color: z.string().max(50).nullable().optional(),
  weightKg: z.number().positive('Weight must be positive').nullable().optional(),
  warrantyMonths: z.number().int().min(0).nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  dynamicAttributes: z.record(z.unknown()).optional(),
});

export const createPurchaseSchema = z.object({
  distributorId: z.string().uuid('Distributor ID must be a valid UUID'),
  invoiceNumber: z.string().min(1, 'Invoice number is required').max(100),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  totalAmount: z.number().positive('Total amount must be positive'),
  gstAmount: z.number().min(0, 'GST amount must be non-negative').optional(),
  discountAmount: z.number().min(0, 'Discount amount must be non-negative').optional(),
  notes: z.string().nullable().optional(),
  items: z.array(purchaseItemSchema).min(1, 'At least one item is required'),
});

export const updatePurchaseSchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  invoiceDate: z.string().optional(),
  totalAmount: z.number().positive('Total amount must be positive').optional(),
  gstAmount: z.number().min(0).optional(),
  discountAmount: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  paymentMode: z.enum(['cash', 'credit_card', 'debit_card', 'upi', 'bank_transfer', 'cheque'], {
    errorMap: () => ({ message: 'Invalid payment mode' }),
  }),
  paymentDate: z.string().min(1, 'Payment date is required'),
  referenceNumber: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const purchaseListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  distributorId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  paymentStatus: z.enum(['pending', 'partial', 'paid']).optional(),
  search: z.string().optional(),
});

// --- Bulk import (spreadsheet) ----------------------------------------------
const optText = z.string().max(500).optional();
const optNum = z.number().finite().optional();

const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  invoiceNumber: z.string().max(100),
  invoiceDate: z.string().max(20),
  distributorName: z.string().max(300),
  distributorGst: optText,
  distributorPhone: optText,
  distributorAddress: optText,
  distributorCity: optText,
  distributorState: optText,
  distributorPincode: optText,
  categoryName: optText,
  brand: optText,
  modelNumber: z.string().max(300),
  serialNumber: optText,
  quantity: z.number().finite(),
  rate: optNum,
  amount: optNum,
  mrp: optNum,
  sellingPrice: optNum,
  discount: optNum,
  gstAmount: optNum,
  gstRate: optNum,
  invoiceTotal: optNum,
  roundOff: optNum,
  hsnCode: optText,
  color: optText,
  warrantyMonths: optNum,
  categoryId: z.string().uuid().nullable().optional(),
  distributorPan: optText,
  consigneeName: optText,
  voucherNumber: optText,
  attributes: z.record(z.string().max(200)).optional(),
  isDemoUnit: z.boolean().optional(),
  unitImeis: z.array(z.array(z.string().max(20))).max(500).optional(),
});

export const purchaseImportSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'The sheet has no rows to import').max(20000, 'At most 20,000 rows per import'),
  categoryMap: z.record(z.string().uuid()).optional(),
  markPaid: z
    .object({ paymentMode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']) })
    .nullable()
    .optional(),
  fileName: z.string().max(255).optional(),
  sourceFormat: z.enum(['tally_purchase_register', 'mapped_columns']).optional(),
  period: z.string().max(100).optional(),
  sheetOwnerName: z.string().max(300).optional(),
  updateDistributors: z.boolean().optional(),
});

/** Item names from the sheet, to be identified before the preview. */
export const classifyItemsSchema = z.object({
  names: z
    .array(z.string().min(1).max(300))
    .min(1, 'There are no item names to identify')
    .max(2000, 'At most 2,000 item names at a time'),
  refresh: z.boolean().optional(),
});

/** Stored answers to forget, so they are worked out again. */
export const forgetClassificationsSchema = z.object({
  nameKeys: z.array(z.string().min(1).max(300)).min(1).max(2000),
});

/** One item to look up on the web from the identify screen. */
export const lookupItemSchema = z.object({
  nameKey: z.string().max(300),
  rawName: z.string().min(1).max(300),
  brand: z.string().max(200).default(''),
  modelNumber: z.string().min(1, 'Enter the model number first').max(200),
  categoryId: z.string().uuid(),
});

/** Corrections made in the preview, saved so they hold for later imports. */
export const saveClassificationsSchema = z.object({
  classifications: z
    .array(
      z.object({
        nameKey: z.string().max(300),
        rawName: z.string().min(1).max(300),
        categoryId: z.string().uuid().nullable(),
        brand: z.string().max(200).optional(),
        modelNumber: z.string().max(200).optional(),
        color: z.string().max(50).nullable().optional(),
        attributes: z.record(z.string().max(200)).optional(),
        isDemoUnit: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(2000),
});
