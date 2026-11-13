import { z } from 'zod';
import { isIsoDate } from '@retailerp/shared-utils';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const isoDate = z.string().refine(isIsoDate, 'Purchase date must be a real date (yyyy-mm-dd)');
export const MAX_ITEM_QUANTITY = 100;
/** Addresses besides the main one, per person (owner decision: 3 in all). */
export const MAX_MORE_ADDRESSES = 2;

export const entrySchema = z.object({
  accountNumber: z.string().trim().min(1, 'Account Number is required').max(30),
  customerName: text(200).min(1, 'Customer name is required'),
  /** Optional: an entry without a mobile is saved and listed under "Needs review". */
  mobile: z.string().trim().max(20).nullable().optional(),
  /** A second mobile (optional; searchable, never used to match the customer). */
  altMobile: optionalText(20),
  address: optionalText(500),
  /** Other addresses (main one is `address`); blanks are dropped. */
  moreAddresses: z.array(text(500)).max(MAX_MORE_ADDRESSES, `At most ${MAX_MORE_ADDRESSES + 1} addresses`).optional(),
  area: optionalText(100),
  coName: optionalText(200),
  coMobile: optionalText(20),
  coAltMobile: optionalText(20),
  coAddress: optionalText(500),
  coMoreAddresses: z.array(text(500)).max(MAX_MORE_ADDRESSES, `At most ${MAX_MORE_ADDRESSES + 1} addresses`).optional(),
  purchaseDate: isoDate,
  /** Product type: any active type of the tenant's tree (a sub-type is optional). */
  categoryId: z.string().uuid('Choose the product type'),
  product: optionalText(200),
  brand: optionalText(100),
  model: optionalText(200),
  /** An existing customer picked on the form; otherwise name + mobile decide. */
  customerId: z.string().uuid().nullable().optional(),
  coCustomerId: z.string().uuid().nullable().optional(),
  /** The shop the entry (and a new customer) belongs to; defaults to the current shop. */
  shopId: z.string().uuid().optional(),
  /** Save even though the account number is already used (it gets flagged for review). */
  allowDuplicate: z.boolean().optional(),
});

/**
 * Another product bought under the same account number on the same day: it
 * becomes its own entry (one per unit of `quantity`) with the same customer,
 * co-applicant, date and shop — one purchase, so not a reused number.
 */
export const itemSchema = z.object({
  categoryId: z.string().uuid('Choose the product type'),
  product: optionalText(200),
  brand: optionalText(100),
  model: optionalText(200),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY).default(1),
});
export const MAX_ITEMS_PER_SAVE = 200;

const withinItemLimit = (v: { quantity?: number; moreItems?: Array<{ quantity: number }> }) =>
  (v.quantity ?? 1) + (v.moreItems ?? []).reduce((n, i) => n + i.quantity, 0) <= MAX_ITEMS_PER_SAVE;
const itemLimitMessage = { message: `At most ${MAX_ITEMS_PER_SAVE} items in one save`, path: ['moreItems'] };

export const createEntrySchema = entrySchema
  .extend({
    /** Client-generated id of this save; repeating it returns the entry already made. */
    clientRequestId: z.string().uuid().optional(),
    /** How many of this (first) item: that many entries. */
    quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY).optional(),
    moreItems: z.array(itemSchema).max(50).optional(),
  })
  .refine(withinItemLimit, itemLimitMessage);
export const updateEntrySchema = entrySchema
  .partial()
  .extend({
    purchaseDate: isoDate.nullable().optional(),
    categoryId: z.string().uuid().optional(),
    /** The entry's `updatedAt` the editor started from; a newer one is refused (409 `stale`). */
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
    /** Items to add to this account (new entries, same customer, date and shop as the saved entry). */
    moreItems: z.array(itemSchema).max(50).optional(),
  })
  .refine(withinItemLimit, itemLimitMessage);

export type EntryInput = z.infer<typeof createEntrySchema>;
export type EntryUpdateInput = z.infer<typeof updateEntrySchema>;
export type ItemInput = z.infer<typeof itemSchema>;

/** One row of the sheet as the browser read it (and the person may have fixed it). */
export const importRowSchema = z.object({
  sheetRow: z.number().int().positive(),
  recordNo: z.number().int().positive(),
  accountNumber: text(60).default(''),
  customerName: text(300).default(''),
  address: text(1000).default(''),
  mobile: text(60).default(''),
  coName: text(300).default(''),
  coMobile: text(60).default(''),
  area: text(200).default(''),
  purchaseDate: text(60).default(''),
  product: text(300).default(''),
  brand: text(200).default(''),
  model: text(300).default(''),
  shop: text(200).default(''),
});

export const MAX_IMPORT_ROWS = 20_000;

const importBase = z.object({
  fileName: z.string().trim().min(1).max(255),
  /** Shop for rows whose Shop column is blank (or a sheet with no Shop column). */
  shopId: z.string().uuid('Pick the shop for rows with no Shop'),
  rowFrom: z.number().int().positive(),
  rowTo: z.number().int().positive(),
  rows: z.array(importRowSchema).min(1, 'No rows in that range').max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows at a time`),
});

export const importPreviewSchema = importBase;

const productTypeDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('existing'), categoryId: z.string().uuid() }),
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(200), parentId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal('blank') }),
]);

export const importCommitSchema = importBase.extend({
  /** Per mobile: variant key → key of the variant whose name is kept. */
  resolutions: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  /** Per Product text key: which type it means, a type to create, or none. */
  productTypes: z.record(z.string(), productTypeDecision).default({}),
});

export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportPreviewInput = z.infer<typeof importPreviewSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
