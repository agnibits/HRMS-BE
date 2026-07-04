import { z } from 'zod';
import { ALL_PERMISSIONS, WILDCARD } from '../../constants/permissions.js';

const permissionEnum = z.enum([WILDCARD, ...ALL_PERMISSIONS]);

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  companyId: z.string().optional(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(255).optional(),
  companyId: z.string().optional(),
  permissions: z.array(permissionEnum).min(1, 'At least one permission is required'),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(255).nullable().optional(),
    permissions: z.array(permissionEnum).min(1).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

export const idParam = z.object({ id: z.string().min(1) });

export default { listQuerySchema, createRoleSchema, updateRoleSchema, idParam };
