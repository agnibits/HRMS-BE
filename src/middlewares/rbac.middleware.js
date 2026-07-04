import { ApiError } from '../utils/ApiError.js';
import { WILDCARD } from '../constants/permissions.js';

/** True if the user's permission snapshot satisfies the required permission. */
function hasPermission(user, required) {
  if (!user) return false;
  const perms = user.permissions ?? [];
  if (perms.includes(WILDCARD)) return true;
  return perms.includes(required);
}

/**
 * Authorization guard — requires ALL listed permissions.
 *   router.delete('/:id', authenticate, authorize(PERMISSIONS.USER_DELETE), handler)
 */
export function authorize(...required) {
  const needed = required.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const ok = needed.every((p) => hasPermission(req.user, p));
    if (!ok) {
      return next(
        ApiError.forbidden('You do not have permission to perform this action', {
          code: 'INSUFFICIENT_PERMISSIONS',
          details: { required: needed },
        })
      );
    }
    next();
  };
}

/** Authorization guard — requires ANY ONE of the listed permissions. */
export function authorizeAny(...required) {
  const needed = required.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const ok = needed.some((p) => hasPermission(req.user, p));
    if (!ok) {
      return next(
        ApiError.forbidden('You do not have permission to perform this action', {
          code: 'INSUFFICIENT_PERMISSIONS',
          details: { requiredAnyOf: needed },
        })
      );
    }
    next();
  };
}

/** Role guard — requires the user to hold at least one of the given roles. */
export function requireRole(...roles) {
  const needed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const has = (req.user.roles ?? []).some((r) => needed.includes(r));
    if (!has) {
      return next(ApiError.forbidden('Requires role: ' + needed.join(' or '), { code: 'ROLE_REQUIRED' }));
    }
    next();
  };
}

export default authorize;
