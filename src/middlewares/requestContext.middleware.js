import { randomUUID } from 'node:crypto';
import { runWithContext } from '../utils/requestContext.js';

/**
 * Assigns a request id (honoring an inbound `x-request-id`) and opens an
 * AsyncLocalStorage scope so downstream code can access request-scoped data.
 * Must be registered before routes and before the logger middleware.
 */
export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);

  const store = {
    requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    user: null, // populated later by the auth middleware
  };

  runWithContext(store, () => next());
}

export default requestContext;
