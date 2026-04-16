import { z } from 'zod';

export const createProductSchema = z.object({
  categoryId: z.string().uuid('Category ID must be a valid UUID'),
  brand: z.string().min(1, 'Brand is required').max(200),
  modelNumber: z.string().min(1, 'Model number is required').max(200),
  serialNumber: z.string().max(200).nullable().optional(),
  mrp: z.number().positive('MRP must be positive'),
  sellingPrice: z.number().positive('Selling price must be positive'),
  purchasePrice: z.number().positive('Purchase price must be positive'),
  color: z.string().max(50).nullable().optional(),
  weightKg: z.number().positive('Weight must be positive').nullable().optional(),
  distributorId: z.string().uuid('Distributor ID must be a valid UUID').nullable().optional(),
  warrantyMonths: z.number().int().min(0).nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  dynamicAttributes: z.record(z.unknown()).optional(),
});

export const updateProductSchema = z.object({
  categoryId: z.string().uuid('Category ID must be a valid UUID').optional(),
  brand: z.string().min(1).max(200).optional(),
  modelNumber: z.string().min(1).max(200).optional(),
  serialNumber: z.string().max(200).nullable().optional(),
  mrp: z.number().positive('MRP must be positive').optional(),
  sellingPrice: z.number().positive('Selling price must be positive').optional(),
  purchasePrice: z.number().positive('Purchase price must be positive').optional(),
  color: z.string().max(50).nullable().optional(),
  weightKg: z.number().positive('Weight must be positive').nullable().optional(),
  distributorId: z.string().uuid('Distributor ID must be a valid UUID').nullable().optional(),
  warrantyMonths: z.number().int().min(0).nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  dynamicAttributes: z.record(z.unknown()).optional(),
  status: z
    .enum(['in_stock', 'sold', 'transferred', 'returned', 'damaged'], {
      errorMap: () => ({ message: 'Invalid product status' }),
    })
    .optional(),
});

export const productListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  status: z
    .enum(['in_stock', 'sold', 'transferred', 'returned', 'damaged'])
    .optional(),
  brand: z.string().optional(),
  search: z.string().optional(),
});

export const globalSearchSchema = z.object({
  query: z.string().min(3, 'Search query must be at least 3 characters'),
});
