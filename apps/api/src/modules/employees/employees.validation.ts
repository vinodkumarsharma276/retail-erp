import { z } from 'zod';

export const createEmployeeSchema = z.object({
  userId: z.string().uuid('User ID must be a valid UUID'),
  designation: z.string().max(100).nullable().optional(),
  dateOfJoining: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .nullable()
    .optional(),
  salary: z.number().min(0, 'Salary must be non-negative').nullable().optional(),
  aadhaarNumber: z
    .string()
    .max(12)
    .regex(/^\d{12}$/, 'Aadhaar number must be exactly 12 digits')
    .nullable()
    .optional(),
  address: z.string().nullable().optional(),
  emergencyContact: z
    .string()
    .max(15)
    .nullable()
    .optional(),
});

export const updateEmployeeSchema = z.object({
  designation: z.string().max(100).nullable().optional(),
  dateOfJoining: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .nullable()
    .optional(),
  salary: z.number().min(0, 'Salary must be non-negative').nullable().optional(),
  aadhaarNumber: z
    .string()
    .max(12)
    .regex(/^\d{12}$/, 'Aadhaar number must be exactly 12 digits')
    .nullable()
    .optional(),
  address: z.string().nullable().optional(),
  emergencyContact: z
    .string()
    .max(15)
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});
