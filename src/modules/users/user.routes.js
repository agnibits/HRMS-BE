import { Router } from 'express';
import * as ctrl from './user.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorize } from '../../middlewares/rbac.middleware.js';
import { auditRequest } from '../../middlewares/audit.middleware.js';
import { upload, SPREADSHEET_MIME } from '../../middlewares/upload.middleware.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import * as v from './user.validators.js';

const router = Router();

router.use(authenticate);
router.use(auditRequest('user'));

/**
 * @openapi
 * /users/me/profile:
 *   patch:
 *     tags: [Users]
 *     summary: Update your own profile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string, nullable: true }
 *               avatarUrl: { type: string, nullable: true }
 *     responses:
 *       200: { description: Updated profile, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 */
router.patch('/me/profile', validate({ body: v.updateProfileSchema }), ctrl.updateProfile);

/**
 * @openapi
 * /users/export:
 *   get:
 *     tags: [Users]
 *     summary: Export users to an Excel (.xlsx) file
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, ACTIVE, SUSPENDED, DISABLED] } }
 *       - { in: query, name: companyId, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Excel file stream
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 */
router.get('/export', authorize(PERMISSIONS.USER_EXPORT), validate({ query: v.listQuerySchema }), ctrl.exportUsers);

/**
 * @openapi
 * /users/import:
 *   post:
 *     tags: [Users]
 *     summary: Bulk-import users from an Excel/CSV file
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary, description: ".xlsx or .csv with columns Email, First Name, Last Name, Phone" }
 *               companyId: { type: string }
 *     responses:
 *       200: { description: Import summary, content: { application/json: { schema: { $ref: '#/components/schemas/ImportResult' } } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 */
router.post(
  '/import',
  authorize(PERMISSIONS.USER_IMPORT),
  upload({ field: 'file', allowed: SPREADSHEET_MIME }),
  ctrl.importUsers
);

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (paginated, filterable, searchable, sortable)
 *     parameters:
 *       - { $ref: '#/components/parameters/PageParam' }
 *       - { $ref: '#/components/parameters/LimitParam' }
 *       - { $ref: '#/components/parameters/SortParam' }
 *       - { $ref: '#/components/parameters/SearchParam' }
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, ACTIVE, SUSPENDED, DISABLED] } }
 *       - { in: query, name: companyId, schema: { type: string } }
 *       - { in: query, name: roleId, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Success'
 *                 - type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/User' } }
 *                     meta: { type: object, properties: { pagination: { $ref: '#/components/schemas/Pagination' } } }
 *       401: { $ref: '#/components/responses/UnauthorizedError' }
 *       403: { $ref: '#/components/responses/ForbiddenError' }
 *   post:
 *     tags: [Users]
 *     summary: Create a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, firstName, lastName]
 *             properties:
 *               email: { type: string, format: email, example: jane.doe@hrms.local }
 *               firstName: { type: string, example: Jane }
 *               lastName: { type: string, example: Doe }
 *               phone: { type: string }
 *               password: { type: string, description: Optional; a temp password is generated & emailed if omitted }
 *               companyId: { type: string }
 *               roleIds: { type: array, items: { type: string } }
 *               status: { type: string, enum: [PENDING, ACTIVE, SUSPENDED, DISABLED] }
 *               sendWelcomeEmail: { type: boolean, default: true }
 *     responses:
 *       201: { description: User created, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       409: { $ref: '#/components/responses/ConflictError' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router
  .route('/')
  .get(authorize(PERMISSIONS.USER_READ), validate({ query: v.listQuerySchema }), ctrl.list)
  .post(authorize(PERMISSIONS.USER_CREATE), validate({ body: v.createUserSchema }), ctrl.create);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by id
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: User, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 *   put:
 *     tags: [Users]
 *     summary: Update a user
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string, nullable: true }
 *               avatarUrl: { type: string, nullable: true }
 *               status: { type: string, enum: [PENDING, ACTIVE, SUSPENDED, DISABLED] }
 *               companyId: { type: string, nullable: true }
 *     responses:
 *       200: { description: Updated user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 *   delete:
 *     tags: [Users]
 *     summary: Soft-delete a user
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       204: { description: Deleted (no content) }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router
  .route('/:id')
  .get(authorize(PERMISSIONS.USER_READ), validate({ params: v.idParam }), ctrl.getOne)
  .put(authorize(PERMISSIONS.USER_UPDATE), validate({ params: v.idParam, body: v.updateUserSchema }), ctrl.update)
  .delete(authorize(PERMISSIONS.USER_DELETE), validate({ params: v.idParam }), ctrl.remove);

/**
 * @openapi
 * /users/{id}/restore:
 *   post:
 *     tags: [Users]
 *     summary: Restore a soft-deleted user
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: Restored user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.post('/:id/restore', authorize(PERMISSIONS.USER_UPDATE), validate({ params: v.idParam }), ctrl.restore);

/**
 * @openapi
 * /users/{id}/resend-invite:
 *   post:
 *     tags: [Users]
 *     summary: Re-send the invitation (new temp password, revokes old sessions)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: "{ email, tempPassword, emailQueued }" }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.post('/:id/resend-invite', authorize(PERMISSIONS.USER_UPDATE), validate({ params: v.idParam }), ctrl.resendInvite);

/**
 * @openapi
 * /users/{id}/roles:
 *   put:
 *     tags: [Users]
 *     summary: Replace a user's role assignments
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [roleIds], properties: { roleIds: { type: array, items: { type: string } } } }
 *     responses:
 *       200: { description: Updated user with roles, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.put(
  '/:id/roles',
  authorize(PERMISSIONS.ROLE_ASSIGN),
  validate({ params: v.idParam, body: v.assignRolesSchema }),
  ctrl.assignRoles
);

export default router;
