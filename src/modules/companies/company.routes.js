import { Router } from 'express';
import { z } from 'zod';
import { companyService } from './company.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { auditRequest } from '../../middlewares/audit.middleware.js';
import { buildPaginationMeta } from '../../utils/pagination.js';
import { passwordPolicy } from '../auth/auth.validators.js';

/**
 * Company module — dual purpose:
 *  • Agnibits platform SUPER_ADMIN: provision & manage ALL tenants (platform:manage).
 *  • HRMS tenant ADMIN: read/update ONLY their own company's settings (scoped).
 * The same paths serve both; behavior branches on whether the caller is a
 * platform admin.
 */
const router = Router();
router.use(authenticate);
router.use(auditRequest('company'));

const isPlatformAdmin = (user) =>
  !!user &&
  ((user.roles ?? []).includes('SUPER_ADMIN') ||
    (user.permissions ?? []).includes('platform:manage') ||
    (user.permissions ?? []).includes('*'));

// ── Schemas ─────────────────────────────────────────────────────────────
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  plan: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
});

const provisionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  plan: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
  admin: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email(),
    password: passwordPolicy,
  }),
});

const platformUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    plan: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

const ownUpdateSchema = z.object({
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

// ── Routes ──────────────────────────────────────────────────────────────
/**
 * @openapi
 * /companies:
 *   get:
 *     tags: [Agnibits superAdmin]
 *     summary: List companies — ALL tenants for platform SUPER_ADMIN; own company for tenant admins
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, SUSPENDED] } }
 *       - { in: query, name: plan, schema: { type: string, enum: [FREE, STARTER, PRO, ENTERPRISE] } }
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/SearchParam' }
 *   post:
 *     tags: [Agnibits superAdmin]
 *     summary: Provision a new company + its first admin (platform SUPER_ADMIN only)
 *     responses:
 *       201: { description: "{ company, admin }" }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 *       409: { $ref: '#/components/responses/ConflictError' }
 */
router
  .route('/')
  .get(
    authorize('company:read'),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      if (isPlatformAdmin(req.user)) {
        const { items, pagination } = await companyService.listAll(req.validatedQuery ?? req.query);
        return paginated(res, items, pagination, 'Companies');
      }
      const own = await companyService.getOwn(req.user.companyId);
      return paginated(res, [own], buildPaginationMeta({ page: 1, limit: 1 }, 1), 'Company');
    })
  )
  .post(
    authorize('platform:manage'),
    validate({ body: provisionSchema }),
    asyncHandler(async (req, res) => created(res, await companyService.provision(req.body, req.user.id), 'Company provisioned'))
  );

/**
 * @openapi
 * /companies/{id}:
 *   get: { tags: [Agnibits superAdmin], summary: Company detail }
 *   put: { tags: [Agnibits superAdmin], summary: Update company (platform - name/plan/status; tenant - own settings) }
 *   delete: { tags: [Agnibits superAdmin], summary: Archive (soft-delete) a company - platform only }
 */
router
  .route('/:id')
  .get(
    authorize('company:read'),
    asyncHandler(async (req, res) => {
      if (isPlatformAdmin(req.user)) return ok(res, await companyService.getById(req.params.id));
      if (req.params.id !== req.user.companyId) throw ApiError.forbidden('Cannot access another company');
      return ok(res, await companyService.getOwn(req.user.companyId));
    })
  )
  .put(
    authorize('company:update'),
    asyncHandler(async (req, res) => {
      if (isPlatformAdmin(req.user)) {
        const data = platformUpdateSchema.parse(req.body);
        return ok(res, await companyService.platformUpdate(req.params.id, data, req.user.id), 'Company updated');
      }
      if (req.params.id !== req.user.companyId) throw ApiError.forbidden('Cannot modify another company');
      const data = ownUpdateSchema.parse(req.body);
      return ok(res, await companyService.updateOwn(req.user.companyId, data, req.user.id), 'Company updated');
    })
  )
  .delete(
    authorize('platform:manage'),
    asyncHandler(async (req, res) => {
      await companyService.archive(req.params.id, req.user.id);
      return noContent(res);
    })
  );

/**
 * @openapi
 * /companies/{id}/reset-admin:
 *   post:
 *     tags: [Agnibits superAdmin]
 *     summary: Generate a new temporary password for the company's admin (platform only)
 *     responses: { 200: { description: "{ email, tempPassword }" } }
 */
router.post(
  '/:id/reset-admin',
  authorize('platform:manage'),
  asyncHandler(async (req, res) => ok(res, await companyService.resetAdmin(req.params.id, req.user.id), 'Admin password reset'))
);

export default router;
