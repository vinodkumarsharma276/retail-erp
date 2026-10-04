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
  hsnCode: optText,
  color: optText,
  warrantyMonths: optNum,
});

export const purchaseImportSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'The sheet has no rows to import').max(20000, 'At most 20,000 rows per import'),
  categoryMap: z.record(z.string().uuid()).optional(),
  markPaid: z
    .object({ paymentMode: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']) })
    .nullable()
    .optional(),
});
