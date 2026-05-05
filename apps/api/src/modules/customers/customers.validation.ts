import { z } from 'zod';

const ZONE_VALUES = ['East', 'West', 'North', 'South', 'Delhi', 'Ghaziabad', 'Noida'] as const;

const zoneSchema = z
  .preprocess((v) => (v === '' ? null : v), z.enum(ZONE_VALUES).nullable())
  .optional();

const gstNumberSchema = z
  .preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z
      .string()
      .regex(
        /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/,
        'Enter a valid 15-character GSTIN',
      )
      .nullable(),
  )
  .optional();

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone: z.string().min(10, 'Phone must be at least 10 digits').max(15),
  altPhone: z.string().max(15).nullable().optional(),
  aadhaarNumber: z.string().max(12).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(6).nullable().optional(),
  zone: zoneSchema,
  customerType: z.enum(['individual', 'business']).optional(),
  businessName: z.string().max(200).nullable().optional(),
  gstNumber: gstNumberSchema,
  isGuarantor: z.boolean().optional(),
  guarantorId: z.string().uuid('Guarantor ID must be a valid UUID').nullable().optional(),
  dynamicAttributes: z.record(z.unknown()).optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(10).max(15).optional(),
  altPhone: z.string().max(15).nullable().optional(),
  aadhaarNumber: z.string().max(12).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  pincode: z.string().max(6).nullable().optional(),
  zone: zoneSchema,
  customerType: z.enum(['individual', 'business']).optional(),
  businessName: z.string().max(200).nullable().optional(),
  gstNumber: gstNumberSchema,
  isGuarantor: z.boolean().optional(),
  guarantorId: z.string().uuid('Guarantor ID must be a valid UUID').nullable().optional(),
  dynamicAttributes: z.record(z.unknown()).optional(),
});

export const customerListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  zone: z.string().optional(),
});

export const customerSearchSchema = z.object({
  query: z.string().min(2, 'Search query must be at least 2 characters'),
});
