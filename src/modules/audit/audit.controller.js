import { z } from 'zod';
import { auditRepository } from './audit.repository.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const idParam = z.object({ id: z.string().min(1) });

export const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery ?? req.query;
  const where = {};
  if (q.action) where.action = q.action;
  if (q.entity) where.entity = q.entity;
  if (q.entityId) where.entityId = q.entityId;
  if (q.actorId) where.actorId = q.actorId;
  if (req.user.companyId) where.companyId = req.user.companyId;
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = q.from;
    if (q.to) where.createdAt.lte = q.to;
  }

  const { items, pagination } = await auditRepository.paginate(q, where, {
    include: { actor: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  return paginated(res, items, pagination, 'Audit logs retrieved');
});

export const getOne = asyncHandler(async (req, res) => {
  const log = await auditRepository.findById(req.params.id, {
    include: { actor: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });
  if (!log) throw ApiError.notFound('Audit log not found');
  return ok(res, log, 'Audit log retrieved');
});

export default { list, getOne, listQuerySchema, idParam };
