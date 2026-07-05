import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import roleRoutes from '../modules/roles/role.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import { hrModules } from '../modules/hr/index.js';
import documentRoutes from '../modules/documents/document.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import companyRoutes from '../modules/companies/company.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';

/**
 * Root API router. Core modules are mounted explicitly; the generated HR CRUD
 * modules are mounted from their declarative registry.
 */
const router = Router();

router.get('/', (_req, res) => res.json({ success: true, message: 'HRMS API', version: '1.0.0' }));

// Core
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/audit-logs', auditRoutes);

// Generated HR CRUD modules (departments, designations, attendance, leaves, …)
for (const module of hrModules) {
  router.use(`/${module.resource}`, module.router);
}

// Special-case modules
router.use('/documents', documentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/companies', companyRoutes);
router.use('/ai', aiRoutes);

export default router;
