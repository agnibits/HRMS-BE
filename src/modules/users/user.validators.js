import { z } from 'zod';
import { passwordPolicy } from '../auth/auth.validators.js';

/** Shared list-query schema (pagination + sort + search + filters). */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
  companyId: z.string().optional(),
  roleId: z.string().optional(),
});

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];

/** HR profile fields shared by create/update. */
const hrFields = {
  // Human-readable code (e.g. EMP-001). Auto-generated per company if omitted.
  employeeId: z.string().trim().max(30).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  designation: z.string().trim().max(120).nullable().optional(),
  // Manager reference: user id or email — resolved to managerId + managerName.
  manager: z.string().trim().nullable().optional(),
  joiningDate: z.coerce.date().nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
};

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
  // Optional — if omitted, a temporary password is generated and emailed.
  password: passwordPolicy.optional(),
  companyId: z.string().optional(),
  roleIds: z.array(z.string()).default([]),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
  sendWelcomeEmail: z.boolean().default(true),
  ...hrFields,
});

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED']).optional(),
    companyId: z.string().nullable().optional(),
    ...hrFields,
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const assignRolesSchema = z.object({
  roleIds: z.array(z.string()).min(0),
});

export const idParam = z.object({ id: z.string().min(1) });

export default {
  listQuerySchema,
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  assignRolesSchema,
  idParam,
};
