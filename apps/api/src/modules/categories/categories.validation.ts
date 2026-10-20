import { z } from 'zod';

/**
 * How goods of this type are bought. Until now only the seed could say, so
 * a type bought without a bill could not be created from the app at all.
 */
export const purchaseModesSchema = z.enum(['billed', 'unbilled', 'both']);

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  parentId: z.string().uuid('Parent ID must be a valid UUID').nullable().optional(),
  isLeaf: z.boolean().optional(),
  icon: z.string().max(100).nullable().optional(),
  hsnCode: z.string().max(8).optional(),
  displayOrder: z.number().int().min(0).optional(),
  purchaseModes: purchaseModesSchema.optional(),
});

export const updateCategorySchema = z.object({
  purchaseModes: purchaseModesSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  parentId: z.string().uuid('Parent ID must be a valid UUID').nullable().optional(),
  isLeaf: z.boolean().optional(),
  icon: z.string().max(100).nullable().optional(),
  hsnCode: z.string().max(8).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const createAttributeSchema = z.object({
  attributeName: z
    .string()
    .min(1, 'Attribute name is required')
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Attribute name must be lowercase alphanumeric with underscores'),
  attributeLabel: z.string().min(1, 'Attribute label is required').max(200),
  attributeType: z.enum(
    ['text', 'number', 'select', 'multi_select', 'date', 'tel', 'email', 'textarea', 'checkbox', 'radio', 'file', 'hidden'],
    { errorMap: () => ({ message: 'Invalid attribute type' }) },
  ),
  isRequired: z.boolean().optional().default(false),
  validationRules: z.any().optional(),
  options: z.any().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updateAttributeSchema = z.object({
  attributeName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Attribute name must be lowercase alphanumeric with underscores')
    .optional(),
  attributeLabel: z.string().min(1).max(200).optional(),
  attributeType: z
    .enum(
      ['text', 'number', 'select', 'multi_select', 'date', 'tel', 'email', 'textarea', 'checkbox', 'radio', 'file', 'hidden'],
      { errorMap: () => ({ message: 'Invalid attribute type' }) },
    )
    .optional(),
  isRequired: z.boolean().optional(),
  validationRules: z.any().optional(),
  options: z.any().optional(),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
