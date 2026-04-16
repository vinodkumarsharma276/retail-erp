import { z } from 'zod';

export const createUserSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(100),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().min(1, 'Full name is required').max(200),
  email: z.string().email('Invalid email format').max(255).nullable().optional(),
  phone: z.string().min(1, 'Phone is required').max(15),
  role: z.enum(['admin', 'accountant', 'others', 'employee'], {
    errorMap: () => ({ message: 'Role must be one of: admin, accountant, others, employee' }),
  }),
  isMobileOnly: z.boolean().optional().default(false),
  shopIds: z
    .array(z.string().uuid('Each shop ID must be a valid UUID'))
    .min(1, 'At least one shop must be assigned'),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email('Invalid email format').max(255).nullable().optional(),
  phone: z.string().max(15).optional(),
  role: z
    .enum(['admin', 'accountant', 'others', 'employee'], {
      errorMap: () => ({ message: 'Role must be one of: admin, accountant, others, employee' }),
    })
    .optional(),
  isMobileOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const assignShopsSchema = z.object({
  shopIds: z
    .array(z.string().uuid('Each shop ID must be a valid UUID'))
    .min(1, 'At least one shop must be assigned'),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID'),
});
