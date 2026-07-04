import { record, AuditAction } from '../modules/audit/audit.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Lightweight request-level audit trail for mutating API calls. Detailed,
 * field-level change auditing is done inside services via `recordChange`; this
 * middleware guarantees a coarse "who called what" record for every mutation.
 *
 * @param {string} entity  Logical entity/module name for the mounted router.
 */
export function auditRequest(entity) {
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();

    res.on('finish', () => {
      // Skip auth endpoints (they emit their own richer audit events) and failures
      // already captured as errors.
      const success = res.statusCode < 400;
      record({
        action: methodToAction(req.method),
        entity,
        entityId: req.params?.id ?? null,
        status: success ? 'SUCCESS' : 'FAILURE',
        metadata: { method: req.method, path: req.originalUrl, statusCode: res.statusCode },
      });
    });

    next();
  };
}

function methodToAction(method) {
  if (method === 'POST') return AuditAction.CREATE;
  if (method === 'DELETE') return AuditAction.DELETE;
  return AuditAction.UPDATE;
}

export default auditRequest;
