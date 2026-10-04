import { z } from 'zod';
import { CATEGORY_NAMES } from './engine/categorize/categories.js';

const strList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v == null ? [] : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal('').transform(() => undefined));
const emptyToUndef = z.literal('').transform(() => undefined);

/** Shared query filters for transactions, analytics and export. */
export const filterSchema = z.object({
  shopIds: strList,
  statementIds: strList,
  banks: strList,
  categories: strList,
  channels: strList,
  from: isoDate,
  to: isoDate,
  direction: z.enum(['debit', 'credit']).optional().or(emptyToUndef),
  flagged: z.enum(['true', 'false']).optional().or(emptyToUndef),
  review: z.enum(['pending', 'verified', 'suspicious', 'none']).optional().or(emptyToUndef),
  reason: z.string().trim().max(40).optional().or(emptyToUndef),
  q: z.string().trim().max(200).optional(),
});
export type Filters = z.infer<typeof filterSchema>;

export const listSchema = filterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(500).default(50),
  sort: z.string().default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const exportSchema = filterSchema.extend({
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});

export const uploadFieldsSchema = z.object({
  shopId: z.string().uuid(),
  bank: z.string().trim().max(80).optional(),
  password: z.string().max(200).optional(),
});

export const statementPatchSchema = z.object({
  bank: z.string().trim().min(1).max(80).optional(),
  shopId: z.string().uuid().optional(),
});

export const txPatchSchema = z.object({
  category: z.enum(CATEGORY_NAMES as [string, ...string[]]).optional(),
  review_status: z.enum(['pending', 'verified', 'suspicious']).nullable().optional(),
  reviewer_note: z.string().max(1000).nullable().optional(),
});
export type TxPatch = z.infer<typeof txPatchSchema>;

export const bulkPatchSchema = txPatchSchema.extend({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

export const ruleSchema = z.object({
  pattern: z.string().trim().min(2).max(200),
  match_type: z.enum(['contains', 'regex']).default('contains'),
  category: z.enum(CATEGORY_NAMES as [string, ...string[]]),
  shop_id: z.string().uuid().nullable().default(null),
  applyToExisting: z.boolean().default(true),
});

export const settingsSchema = z.object({
  largeAmount: z.number().positive().optional(),
  cashAlertAmount: z.number().positive().optional(),
  unknownPayeeAmount: z.number().positive().optional(),
  minAiConfidence: z.number().min(0).max(1).optional(),
  baseCurrency: z.string().length(3).optional(),
});
