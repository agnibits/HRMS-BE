import { Router } from 'express';
import * as ctrl from './role.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { auditRequest } from '../../middlewares/audit.middleware.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import * as v from './role.validators.js';

const router = Router();

router.use(authenticate);
router.use(auditRequest('role'));

/**
 * @openapi
 * /roles/permissions:
 *   get:
 *     tags: [Roles]
 *     summary: Get the full permission catalog grouped by resource
 *     responses:
 *       200:
 *         description: Permission catalog
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wildcard: { type: string, example: "*" }
 *                 total: { type: integer, example: 19 }
 *                 groups:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         key: { type: string, example: USER_READ }
 *                         permission: { type: string, example: user:read }
 *                         action: { type: string, example: read }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 */
router.get('/permissions', authorize(PERMISSIONS.ROLE_READ), ctrl.catalog);

/**
 * @openapi
 * /roles:
 *   get:
 *     tags: [Roles]
 *     summary: List roles (company + global system roles)
 *     parameters:
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/LimitParam' }
 *       - { $ref: '#/components/parameters/SortParam' }
 *       - { $ref: '#/components/parameters/SearchParam' }
 *     responses:
 *       200:
 *         description: Paginated roles
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/Role' } }
 *                     meta: { type: object, properties: { pagination: { $ref: '#/components/schemas/Pagination' } } }
 *   post:
 *     tags: [Roles]
 *     summary: Create a role
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, permissions]
 *             properties:
 *               name: { type: string, example: "Recruiter" }
 *               description: { type: string }
 *               companyId: { type: string }
 *               permissions: { type: array, items: { type: string, example: user:read } }
 *     responses:
 *       201: { description: Role created, content: { application/json: { schema: { $ref: '#/components/schemas/Role' } } } }
 *       409: { $ref: '#/components/responses/ConflictError' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router
  .route('/')
  .get(authorize(PERMISSIONS.ROLE_READ), validate({ query: v.listQuerySchema }), ctrl.list)
  .post(authorize(PERMISSIONS.ROLE_CREATE), validate({ body: v.createRoleSchema }), ctrl.create);

/**
 * @openapi
 * /roles/{id}:
 *   get:
 *     tags: [Roles]
 *     summary: Get a role by id
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: Role, content: { application/json: { schema: { $ref: '#/components/schemas/Role' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 *   put:
 *     tags: [Roles]
 *     summary: Update a role (system roles are immutable)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string, nullable: true }
 *               permissions: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Updated role, content: { application/json: { schema: { $ref: '#/components/schemas/Role' } } } }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 *   delete:
 *     tags: [Roles]
 *     summary: Delete a role (blocked if assigned or system)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       204: { description: Deleted (no content) }
 *       409: { $ref: '#/components/responses/ConflictError' }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router
  .route('/:id')
  .get(authorize(PERMISSIONS.ROLE_READ), validate({ params: v.idParam }), ctrl.getOne)
  .put(authorize(PERMISSIONS.ROLE_UPDATE), validate({ params: v.idParam, body: v.updateRoleSchema }), ctrl.update)
  .delete(authorize(PERMISSIONS.ROLE_DELETE), validate({ params: v.idParam }), ctrl.remove);

export default router;
