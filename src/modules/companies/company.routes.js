import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, paginated } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { auditRequest } from '../../middlewares/audit.middleware.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import { recordChange, AuditAction } from '../audit/audit.service.js';

/**
 * Company Settings — a single-tenant record. The frontend loads it via
 * `GET /companies?limit=1` and saves via `PUT /companies/{id}`. Create/delete
 * are intentionally not exposed.
 */
const router = Router();
router.use(authenticate);
router.use(auditRequest('company'));

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  legalName: z.string().trim().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  website: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  timezone: z.string().trim().optional(),
  currency: z.string().trim().optional(),
  weekStart: z.string().trim().optional(),
  logoUrl: z.string().trim().nullable().optional(),
});

async function currentCompany(req) {
  if (!req.user.companyId) throw ApiError.notFound('No company associated with this account');
  const company = await prisma.company.findFirst({ where: { id: req.user.companyId, deletedAt: null } });
  if (!company) throw ApiError.notFound('Company not found');
  return company;
}

// List → returns the current company (single-item, paginated envelope).
router.get(
  '/',
  authorize('company:read'),
  asyncHandler(async (req, res) => {
    const company = await currentCompany(req);
    return paginated(res, [company], buildPaginationMeta({ page: 1, limit: 1 }, 1), 'company');
  })
);

router.get(
  '/:id',
  authorize('company:read'),
  asyncHandler(async (req, res) => {
    const company = await currentCompany(req);
    if (company.id !== req.params.id) throw ApiError.forbidden('Cannot access another company');
    return ok(res, company);
  })
);

router.put(
  '/:id',
  authorize('company:update', 'settings:manage'),
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const before = await currentCompany(req);
    if (before.id !== req.params.id) throw ApiError.forbidden('Cannot modify another company');
    const after = await prisma.company.update({
      where: { id: before.id },
      data: { ...req.body, updatedById: req.user.id },
    });
    await recordChange({ action: AuditAction.UPDATE, entity: 'company', entityId: before.id, before, after, actorId: req.user.id });
    return ok(res, after, 'Company updated');
  })
);

export default router;
