import { z } from 'zod';

export const updateShopSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).optional(),
  gstNumber: z.string().max(15).optional(),
  panNumber: z.string().max(10).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(6).optional(),
  phone: z.string().max(15).optional(),
  email: z.string().email('Invalid email format').max(255).nullable().optional(),
  bankName: z.string().max(200).nullable().optional(),
  bankAccountNumber: z.string().max(20).nullable().optional(),
  bankIfsc: z.string().max(11).nullable().optional(),
  bankBranch: z.string().max(200).nullable().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const shopIdParamSchema = z.object({
  id: z.string().uuid('Shop ID must be a valid UUID'),
});
