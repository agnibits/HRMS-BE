import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { getContext } from '../../utils/requestContext.js';

/**
 * Audit service — the single entry point for writing immutable audit records.
 * Writes are best-effort and never block or fail the originating request
 * (audit failures are logged, not surfaced to the client).
 */
export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  RESTORE: 'RESTORE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  ACCESS: 'ACCESS',
  // User lifecycle events surfaced in the app's Activity tab
  ROLE_CHANGED: 'ROLE_CHANGED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  INVITE_RESENT: 'INVITE_RESENT',
};

export async function record({
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  metadata = null,
  status = 'SUCCESS',
  actorId,
  companyId,
} = {}) {
  const ctx = getContext();
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        before: before ?? undefined,
        after: after ?? undefined,
        metadata: metadata ?? undefined,
        status,
        actorId: actorId ?? ctx.user?.id ?? null,
        companyId: companyId ?? ctx.user?.companyId ?? null,
        ipAddress: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write audit log');
  }
}

/**
 * Convenience wrapper for change auditing that diffs before/after into a
 * compact field-level changeset.
 */
export async function recordChange({ action, entity, entityId, before, after, ...rest }) {
  return record({ action, entity, entityId, before, after, metadata: { changes: diff(before, after) }, ...rest });
}

function diff(before, after) {
  if (!before || !after) return undefined;
  const changes = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

export default { record, recordChange, AuditAction };
