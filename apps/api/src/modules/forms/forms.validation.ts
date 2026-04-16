import { z } from 'zod';

const formFieldTypeValues = [
  'text', 'number', 'select', 'multi_select', 'date', 'tel',
  'email', 'textarea', 'checkbox', 'radio', 'file', 'hidden',
] as const;

export const createDefinitionSchema = z.object({
  formName: z
    .string()
    .min(1, 'Form name is required')
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Form name must be lowercase alphanumeric with underscores'),
  shopId: z.string().uuid('Shop ID must be a valid UUID').nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const updateDefinitionSchema = z.object({
  formName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'Form name must be lowercase alphanumeric with underscores')
    .optional(),
  description: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createFieldSchema = z.object({
  fieldName: z
    .string()
    .min(1, 'Field name is required')
    .max(100)
    .regex(/^[a-zA-Z0-9_]+$/, 'Field name must be alphanumeric with underscores'),
  fieldLabel: z.string().min(1, 'Field label is required').max(200),
  fieldType: z.enum(formFieldTypeValues, {
    errorMap: () => ({ message: 'Invalid field type' }),
  }),
  placeholder: z.string().max(200).nullable().optional(),
  defaultValue: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional().default(false),
  validationRules: z.any().optional(),
  options: z.any().optional(),
  sectionName: z.string().max(100).nullable().optional(),
  isVisible: z.boolean().optional().default(true),
  cssClass: z.string().max(200).nullable().optional(),
  dependsOn: z.any().optional(),
});

export const updateFieldSchema = z.object({
  fieldName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_]+$/, 'Field name must be alphanumeric with underscores')
    .optional(),
  fieldLabel: z.string().min(1).max(200).optional(),
  fieldType: z
    .enum(formFieldTypeValues, {
      errorMap: () => ({ message: 'Invalid field type' }),
    })
    .optional(),
  placeholder: z.string().max(200).nullable().optional(),
  defaultValue: z.string().max(500).nullable().optional(),
  isRequired: z.boolean().optional(),
  validationRules: z.any().optional(),
  options: z.any().optional(),
  sectionName: z.string().max(100).nullable().optional(),
  isVisible: z.boolean().optional(),
  cssClass: z.string().max(200).nullable().optional(),
  dependsOn: z.any().optional(),
});

export const reorderFieldsSchema = z.object({
  fieldIds: z
    .array(z.string().uuid('Each field ID must be a valid UUID'))
    .min(1, 'At least one field ID is required'),
});
