import { z } from 'zod';

export const initiateTransferSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  toShopId: z.string().uuid('Destination shop ID must be a valid UUID'),
  transferPrice: z.number().positive('Transfer price must be positive').optional(),
  gstAmount: z.number().min(0, 'GST amount must be non-negative').optional(),
  invoiceNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
});

export const transferListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  fromShopId: z.string().uuid().optional(),
  toShopId: z.string().uuid().optional(),
  status: z.enum(['initiated', 'in_transit', 'received', 'cancelled']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});
