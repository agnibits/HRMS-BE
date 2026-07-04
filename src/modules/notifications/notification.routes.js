import { Router } from 'express';
import { z } from 'zod';
import { BaseRepository } from '../../core/BaseRepository.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { listQuery, nstr, ostr } from '../hr/helpers.js';
import { emitToUser } from '../../realtime/socket.js';

/**
 * Notifications — scoped to the current user. Records are usually system
 * generated; the module also exposes read / read-all state transitions and
 * pushes new notifications over Socket.io in real time.
 */
const repo = new BaseRepository('notification', {
  searchFields: ['title', 'message'],
  sortFields: ['createdAt', 'read', 'type'],
  softDelete: false,
});

const router = Router();
router.use(authenticate);

const scope = (req) => ({ companyId: req.user.companyId ?? undefined, userId: req.user.id });

// List current user's notifications
router.get(
  '/',
  authorize('notification:read'),
  validate({ query: listQuery({ read: z.coerce.boolean().optional(), type: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery ?? req.query;
    const where = scope(req);
    if (q.read !== undefined) where.read = q.read;
    if (q.type) where.type = q.type;
    const { items, pagination } = await repo.paginate(q, where);
    const unread = await repo.count({ ...scope(req), read: false });
    return paginated(res, items, { ...pagination, unread }, 'notifications');
  })
);

// Create a notification (usually system-generated; admins may create).
router.post(
  '/',
  authorize('notification:create'),
  validate({
    body: z.object({
      title: nstr,
      message: ostr,
      type: z.enum(['INFO', 'SUCCESS', 'WARNING']).optional(),
      userId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const targetUserId = req.body.userId ?? req.user.id;
    const n = await repo.create({
      title: req.body.title,
      message: req.body.message,
      type: req.body.type ?? 'INFO',
      userId: targetUserId,
      companyId: req.user.companyId,
    });
    emitToUser(targetUserId, 'notification:new', n);
    return created(res, n, 'Notification created');
  })
);

// Mark all as read (must be before /:id routes)
router.post(
  '/read-all',
  authorize('notification:update'),
  asyncHandler(async (req, res) => {
    const result = await repo.updateMany({ ...scope(req), read: false }, { read: true });
    return ok(res, { updated: result.count }, 'All notifications marked read');
  })
);

// Mark one as read
router.patch(
  '/:id/read',
  authorize('notification:update'),
  asyncHandler(async (req, res) => {
    const n = await repo.findOne({ id: req.params.id, userId: req.user.id });
    if (!n) throw ApiError.notFound('Notification not found');
    const updated = await repo.update(req.params.id, { read: true });
    return ok(res, updated, 'Marked read');
  })
);

router.delete(
  '/:id',
  authorize('notification:delete'),
  asyncHandler(async (req, res) => {
    const n = await repo.findOne({ id: req.params.id, userId: req.user.id });
    if (!n) throw ApiError.notFound('Notification not found');
    await repo.hardDelete(req.params.id);
    return noContent(res);
  })
);

export default router;
