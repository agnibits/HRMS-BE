import { Router } from 'express';
import * as ctrl from './audit.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '../../constants/permissions.js';

const router = Router();

router.use(authenticate, authorize(PERMISSIONS.AUDIT_READ));

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     tags: [Audit]
 *     summary: List audit logs (filter by action, entity, actor, date range)
 *     parameters:
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/LimitParam' }
 *       - { $ref: '#/components/parameters/SortParam' }
 *       - { $ref: '#/components/parameters/SearchParam' }
 *       - { in: query, name: action, schema: { type: string, example: UPDATE } }
 *       - { in: query, name: entity, schema: { type: string, example: user } }
 *       - { in: query, name: entityId, schema: { type: string } }
 *       - { in: query, name: actorId, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200:
 *         description: Paginated audit logs
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/AuditLog' } }
 *                     meta: { type: object, properties: { pagination: { $ref: '#/components/schemas/Pagination' } } }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 */
router.get('/', validate({ query: ctrl.listQuerySchema }), ctrl.list);

/**
 * @openapi
 * /audit-logs/{id}:
 *   get:
 *     tags: [Audit]
 *     summary: Get a single audit log entry
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: Audit log, content: { application/json: { schema: { $ref: '#/components/schemas/AuditLog' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.get('/:id', validate({ params: ctrl.idParam }), ctrl.getOne);

export default router;
