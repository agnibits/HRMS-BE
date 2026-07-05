import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { redis } from '../config/redis.js';
import { getContext } from '../utils/requestContext.js';

/**
 * Authentication middleware. Extracts and verifies the Bearer access token,
 * checks it has not been revoked (token blacklist keyed by jti), and attaches
 * the identity to `req.user` and the request-scoped context.
 */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header', { code: 'NO_TOKEN' }));
  }

  Promise.resolve()
    .then(async () => {
      const payload = verifyAccessToken(token);

      // Reject tokens explicitly revoked (logout / password change / session kill).
      // If Redis is momentarily unavailable, fail open on the blacklist check
      // (the token is still cryptographically valid) rather than 500 the request.
      if (payload.jti) {
        let revoked = null;
        try {
          revoked = await redis.get(`bl:access:${payload.jti}`);
        } catch {
          /* Redis down — skip blacklist check */
        }
        if (revoked) throw ApiError.unauthorized('Token has been revoked', { code: 'TOKEN_REVOKED' });
      }

      // Instant tenant-suspension enforcement for still-valid access tokens.
      // SUPER_ADMIN bypasses so the platform owner can never self-lock.
      const roles = payload.roles ?? [];
      if (payload.companyId && !roles.includes('SUPER_ADMIN')) {
        let suspended = null;
        try {
          suspended = await redis.get(`company:suspended:${payload.companyId}`);
        } catch {
          /* redis down — login/refresh still enforce via DB */
        }
        if (suspended) {
          throw ApiError.forbidden('Your workspace is suspended. Contact Agnibits.', { code: 'COMPANY_SUSPENDED' });
        }
      }

      const user = {
        id: payload.sub,
        email: payload.email,
        companyId: payload.companyId ?? null,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        sessionId: payload.sid ?? null,
        jti: payload.jti ?? null,
      };

      req.user = user;
      req.token = token;
      const store = getContext();
      if (store) store.user = user;
      next();
    })
    .catch(next);
}

/**
 * Optional authentication — attaches req.user when a valid token is present but
 * never rejects. Useful for endpoints with mixed public/authenticated behavior.
 */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next();
  return authenticate(req, _res, (err) => (err ? next() : next()));
}

export default authenticate;
