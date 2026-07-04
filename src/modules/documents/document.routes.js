import { Router } from 'express';
import { z } from 'zod';
import { BaseRepository } from '../../core/BaseRepository.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { auditRequest } from '../../middlewares/audit.middleware.js';
import { upload, DOC_MIME } from '../../middlewares/upload.middleware.js';
import { saveFile } from '../../storage/storage.service.js';
import { record, AuditAction } from '../audit/audit.service.js';
import { listQuery, ostr, nstr } from '../hr/helpers.js';

/**
 * Documents module — like the standard CRUD modules but the create endpoint
 * accepts a multipart file upload; the response exposes the stored file's name,
 * size and a downloadable url.
 */
const repo = new BaseRepository('document', {
  searchFields: ['name', 'category', 'owner'],
  sortFields: ['createdAt', 'name', 'category'],
});

const perms = { read: 'document:read', create: 'document:create', update: 'document:update', delete: 'document:delete' };
const shape = (d) => ({
  id: d.id,
  name: d.name,
  category: d.category,
  owner: d.owner,
  notes: d.notes,
  fileName: d.fileName,
  size: d.fileSize,
  url: d.fileUrl,
  mimeType: d.mimeType,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const router = Router();
router.use(authenticate);
router.use(auditRequest('document'));

router.get(
  '/',
  authorize(perms.read),
  validate({ query: listQuery({ category: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery ?? req.query;
    const where = { companyId: req.user.companyId ?? undefined };
    if (q.category) where.category = q.category;
    const { items, pagination } = await repo.paginate(q, where);
    return paginated(res, items.map(shape), pagination, 'documents list');
  })
);

router.post(
  '/',
  authorize(perms.create),
  upload({ field: 'file', allowed: DOC_MIME }),
  validate({ body: z.object({ name: nstr, category: ostr, owner: ostr, notes: ostr }) }),
  asyncHandler(async (req, res) => {
    let fileMeta = {};
    if (req.file) {
      const saved = await saveFile(req.file);
      fileMeta = { fileName: saved.originalName, fileUrl: saved.url, fileSize: saved.size, mimeType: saved.mimeType };
    }
    const doc = await repo.create({
      name: req.body.name,
      category: req.body.category,
      owner: req.body.owner,
      notes: req.body.notes,
      ...fileMeta,
      companyId: req.user.companyId,
      createdById: req.user.id,
    });
    await record({ action: AuditAction.CREATE, entity: 'document', entityId: doc.id, actorId: req.user.id });
    return created(res, shape(doc), 'Document uploaded');
  })
);

router.get(
  '/:id',
  authorize(perms.read),
  asyncHandler(async (req, res) => {
    const doc = await repo.findOne({ id: req.params.id, companyId: req.user.companyId ?? undefined });
    if (!doc) throw ApiError.notFound('Document not found');
    return ok(res, shape(doc));
  })
);

router.put(
  '/:id',
  authorize(perms.update),
  upload({ field: 'file', allowed: DOC_MIME }),
  validate({ body: z.object({ name: nstr.optional(), category: ostr, owner: ostr, notes: ostr }) }),
  asyncHandler(async (req, res) => {
    const existing = await repo.findOne({ id: req.params.id, companyId: req.user.companyId ?? undefined });
    if (!existing) throw ApiError.notFound('Document not found');
    const data = { ...req.body, updatedById: req.user.id };
    if (req.file) {
      const saved = await saveFile(req.file);
      Object.assign(data, { fileName: saved.originalName, fileUrl: saved.url, fileSize: saved.size, mimeType: saved.mimeType });
    }
    const doc = await repo.update(req.params.id, data);
    return ok(res, shape(doc), 'Document updated');
  })
);

router.delete(
  '/:id',
  authorize(perms.delete),
  asyncHandler(async (req, res) => {
    const existing = await repo.findOne({ id: req.params.id, companyId: req.user.companyId ?? undefined });
    if (!existing) throw ApiError.notFound('Document not found');
    await repo.remove(req.params.id, { actorId: req.user.id });
    await record({ action: AuditAction.DELETE, entity: 'document', entityId: req.params.id, actorId: req.user.id });
    return noContent(res);
  })
);

export default router;
