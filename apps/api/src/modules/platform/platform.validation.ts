import { z } from 'zod';

/** Tenant slugs: 2-63 chars, lower-case alphanumeric + hyphens, must start with a letter. */
const slugRegex = /^[a-z][a-z0-9-]{1,62}$/;

// ─── Platform admin auth ────────────────────────────────────────────────────
export const platformLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
});

export const platformRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Tenants ────────────────────────────────────────────────────────────────
export const createTenantSchema = z.object({
  slug: z
    .string()
    .regex(slugRegex, 'Slug must be lowercase alphanumeric with hyphens, starting with a letter'),
  name: z.string().min(1).max(200),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(15).nullable().optional(),
  gstNumber: z.string().length(15).nullable().optional(),
  planCode: z.string().min(1).max(50),
  trialEndsAt: z.string().datetime().nullable().optional(),
  /** Initial owner user created together with the tenant. */
  owner: z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(8).max(500),
    fullName: z.string().min(1).max(200),
    email: z.string().email().nullable().optional(),
    phone: z.string().min(1).max(15),
  }),
  /** Optional pre-created shop. Many tenants will create shops later via the tenant UI. */
  initialShop: z
    .object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(200),
      gstNumber: z.string().length(15),
      panNumber: z.string().length(10),
      addressLine1: z.string().min(1).max(255),
      city: z.string().min(1).max(100),
      state: z.string().min(1).max(100),
      pincode: z.string().length(6),
      phone: z.string().min(1).max(200),
    })
    .optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(15).nullable().optional(),
  gstNumber: z.string().length(15).nullable().optional(),
  status: z.enum(['active', 'trial', 'suspended', 'cancelled']).optional(),
  planCode: z.string().min(1).max(50).optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  customDomain: z.string().max(255).nullable().optional(),
});

export const upsertTenantFeatureSchema = z.object({
  featureKey: z.string().min(1).max(100),
  enabled: z.boolean(),
  valueJson: z.record(z.unknown()).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});

// ─── Plans ──────────────────────────────────────────────────────────────────
export const createPlanSchema = z.object({
  code: z.string().regex(slugRegex, 'Plan code must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  priceMonthly: z.number().nonnegative().default(0),
  priceYearly: z.number().nonnegative().default(0),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const updatePlanSchema = createPlanSchema.partial();

export const setPlanFeatureSchema = z.object({
  featureKey: z.string().min(1).max(100),
  enabled: z.boolean(),
  valueJson: z.record(z.unknown()).nullable().optional(),
});
