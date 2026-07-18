import { Router } from 'express';
import { BaseRepository } from './BaseRepository.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { auditRequest } from '../middlewares/audit.middleware.js';
import { record, recordChange, AuditAction } from '../modules/audit/audit.service.js';
import { buildWorkbookBuffer } from '../utils/excel.js';

/**
 * Factory that produces a complete, consistent CRUD module (service behavior +
 * controller + Express router) from a declarative config. Every module built
 * this way exposes the same five endpoints, the same response envelope, RBAC,
 * audit logging, pagination/sort/search and declarative filters — keeping the
 * 19 HR modules DRY and behaviourally identical to the hand-written users/roles
 * modules the frontend already targets.
 *
 * @param {object} cfg
 * @param {string}   cfg.resource         URL segment, e.g. 'departments'
 * @param {string}   cfg.model            Prisma delegate, e.g. 'department'
 * @param {string}   [cfg.entity]         Audit/label name (defaults to model)
 * @param {string}   cfg.permissionPrefix RBAC prefix, e.g. 'department' → department:read
 * @param {string[]} [cfg.searchFields]   Columns for ?search=
 * @param {string[]} [cfg.sortFields]     Whitelisted ?sort= columns
 * @param {boolean}  [cfg.companyScoped]  Auto scope + stamp companyId (default true)
 * @param {object}   [cfg.filters]        { queryParam: whereField | (val,query)=>wherePartial }
 * @param {object}   [cfg.include]        Prisma include for reads
 * @param {Function} [cfg.transform]      (row) => shaped response object
 * @param {Function} [cfg.mapInput]       (body, ctx) => prisma data (relations, computed)
 * @param {object}   cfg.schemas          { create, update, list } Zod schemas
 * @param {Function} [cfg.beforeCreate]   async (data, ctx) => data
 * @param {Function} [cfg.beforeUpdate]   async (data, ctx, current) => data
 * @param {object}   [cfg.defaultSort]    Prisma orderBy default
 * @param {boolean}  [cfg.exportable]     Adds GET /export (xlsx)
 * @param {Function} [cfg.extendRouter]   (router, helpers) => void for extra endpoints
 */
export function defineCrudModule(cfg) {
  const {
    resource,
    model,
    entity = model,
    permissionPrefix,
    searchFields = [],
    sortFields = ['createdAt'],
    softDelete = true,
    companyScoped = true,
    filters = {},
    include,
    transform = (x) => x,
    mapInput = (body) => body,
    schemas = {},
    beforeCreate,
    beforeUpdate,
    afterWrite, // async (row, ctx, { action }) => void — side effects after create/update
    defaultSort,
    exportable = false,
    exportColumns,
    extendRouter,
  } = cfg;

  const perms = {
    read: `${permissionPrefix}:read`,
    create: `${permissionPrefix}:create`,
    update: `${permissionPrefix}:update`,
    delete: `${permissionPrefix}:delete`,
  };

  const repo = new BaseRepository(model, { searchFields, sortFields, softDelete, defaultSort });

  const ctxOf = (req) => ({ userId: req.user?.id, companyId: req.user?.companyId ?? null });

  function buildWhere(query, ctx) {
    const where = {};
    if (companyScoped && ctx.companyId) where.companyId = ctx.companyId;
    for (const [param, target] of Object.entries(filters)) {
      const val = query?.[param];
      if (val === undefined || val === null || val === '') continue;
      if (typeof target === 'function') Object.assign(where, target(val, query, ctx));
      else where[target] = val;
    }
    return where;
  }

  async function fetchShaped(id, ctx) {
    const where = companyScoped && ctx.companyId ? { id, companyId: ctx.companyId } : { id };
    const row = await repo.findOne(where, { include });
    if (!row) throw ApiError.notFound(`${entity} not found`, { code: `${permissionPrefix.toUpperCase()}_NOT_FOUND` });
    return transform(row);
  }

  // ── Service-level operations (reusable/testable) ──────────────────────
  const service = {
    async list(query, ctx) {
      const where = buildWhere(query, ctx);
      const { items, pagination } = await repo.paginate(query, where, { include });
      return { items: items.map(transform), pagination };
    },
    get: (id, ctx) => fetchShaped(id, ctx),
    async create(body, ctx) {
      let data = await mapInput(body, ctx);
      if (companyScoped && ctx.companyId) data.companyId = ctx.companyId;
      if (ctx.userId) data.createdById = ctx.userId;
      if (beforeCreate) data = await beforeCreate(data, ctx);
      const row = await repo.create(data, { include });
      if (afterWrite) await afterWrite(row, ctx, { action: 'create' });
      await record({ action: AuditAction.CREATE, entity, entityId: row.id, actorId: ctx.userId });
      return transform(row);
    },
    async update(id, body, ctx) {
      const before = await repo.findOne(
        companyScoped && ctx.companyId ? { id, companyId: ctx.companyId } : { id }
      );
      if (!before) throw ApiError.notFound(`${entity} not found`, { code: `${permissionPrefix.toUpperCase()}_NOT_FOUND` });
      let data = await mapInput(body, ctx, before);
      if (ctx.userId) data.updatedById = ctx.userId;
      if (beforeUpdate) data = await beforeUpdate(data, ctx, before);
      const row = await repo.update(id, data, { include });
      if (afterWrite) await afterWrite(row, ctx, { action: 'update' });
      await recordChange({ action: AuditAction.UPDATE, entity, entityId: id, before, after: row, actorId: ctx.userId });
      return transform(row);
    },
    async remove(id, ctx) {
      const existing = await repo.findOne(
        companyScoped && ctx.companyId ? { id, companyId: ctx.companyId } : { id }
      );
      if (!existing) throw ApiError.notFound(`${entity} not found`, { code: `${permissionPrefix.toUpperCase()}_NOT_FOUND` });
      await repo.remove(id, { actorId: ctx.userId });
      await record({ action: AuditAction.DELETE, entity, entityId: id, actorId: ctx.userId });
    },
  };

  // ── Controllers ───────────────────────────────────────────────────────
  const list = asyncHandler(async (req, res) => {
    const { items, pagination } = await service.list(req.validatedQuery ?? req.query, ctxOf(req));
    return paginated(res, items, pagination, `${entity} list`);
  });
  const getOne = asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, ctxOf(req))));
  const create = asyncHandler(async (req, res) => created(res, await service.create(req.body, ctxOf(req))));
  const update = asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, ctxOf(req)), 'Updated'));
  const remove = asyncHandler(async (req, res) => {
    await service.remove(req.params.id, ctxOf(req));
    return noContent(res);
  });
  const exportXlsx = asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const where = buildWhere(req.validatedQuery ?? req.query, ctx);
    const rows = (await repo.findMany(where, { include, take: 10000, orderBy: defaultSort ?? { createdAt: 'desc' } })).map(transform);
    const columns = exportColumns ?? Object.keys(rows[0] ?? { id: null }).map((k) => ({ header: k, key: k, width: 20 }));
    const buffer = await buildWorkbookBuffer({ sheetName: resource, columns, rows });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${resource}-${Date.now()}.xlsx"`);
    return res.send(Buffer.from(buffer));
  });

  // ── Router ──────────────────────────────────────────────────────────
  const router = Router();
  router.use(authenticate);
  router.use(auditRequest(entity));

  if (exportable) {
    router.get('/export', authorize(perms.read), exportXlsx);
  }

  if (extendRouter) {
    extendRouter(router, { service, ctxOf, repo, perms, transform, include, ok, created, noContent, asyncHandler, authorize, validate });
  }

  router
    .route('/')
    .get(authorize(perms.read), schemas.list ? validate({ query: schemas.list }) : (req, _res, next) => next(), list)
    .post(authorize(perms.create), validate({ body: schemas.create }), create);

  router
    .route('/:id')
    .get(authorize(perms.read), getOne)
    .put(authorize(perms.update), validate({ body: schemas.update }), update)
    .delete(authorize(perms.delete), remove);

  return { resource, router, service, perms, repo };
}

export default defineCrudModule;
