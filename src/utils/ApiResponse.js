import { getRequestId } from './requestContext.js';

/**
 * Uniform success envelope for every endpoint. Keeping a single shape makes
 * client integration and API documentation predictable.
 *
 * {
 *   success: true,
 *   message: "...",
 *   data: <payload>,
 *   meta: { pagination?, ...},
 *   requestId: "...",
 *   timestamp: "..."
 * }
 */
export function ok(res, data = null, message = 'Success', meta = undefined, status = 200) {
  const body = {
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
    requestId: getRequestId(),
    timestamp: new Date().toISOString(),
  };
  return res.status(status).json(body);
}

export function created(res, data, message = 'Created') {
  return ok(res, data, message, undefined, 201);
}

export function noContent(res) {
  return res.status(204).send();
}

/**
 * Paginated list envelope. `pagination` is produced by utils/pagination.js.
 */
export function paginated(res, items, pagination, message = 'Success') {
  return ok(res, items, message, { pagination });
}

export default { ok, created, noContent, paginated };
