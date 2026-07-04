/**
 * Operational (expected) application error. Anything thrown as an `ApiError`
 * is considered safe to surface to clients. Unexpected errors are masked by the
 * global error handler.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status code
   * @param {string} message     Human-readable message
   * @param {object} [options]
   * @param {string} [options.code]     Machine-readable error code (e.g. AUTH_INVALID_CREDENTIALS)
   * @param {Array}  [options.details]  Field-level validation details
   * @param {boolean}[options.isOperational=true]
   */
  constructor(statusCode, message, { code, details, isOperational = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeFor(statusCode);
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', opts) {
    return new ApiError(400, msg, opts);
  }
  static unauthorized(msg = 'Unauthorized', opts) {
    return new ApiError(401, msg, opts);
  }
  static forbidden(msg = 'Forbidden', opts) {
    return new ApiError(403, msg, opts);
  }
  static notFound(msg = 'Resource not found', opts) {
    return new ApiError(404, msg, opts);
  }
  static conflict(msg = 'Conflict', opts) {
    return new ApiError(409, msg, opts);
  }
  static unprocessable(msg = 'Unprocessable entity', opts) {
    return new ApiError(422, msg, opts);
  }
  static tooManyRequests(msg = 'Too many requests', opts) {
    return new ApiError(429, msg, opts);
  }
  static internal(msg = 'Internal server error', opts) {
    return new ApiError(500, msg, { ...opts, isOperational: false });
  }
}

function defaultCodeFor(statusCode) {
  const map = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
  };
  return map[statusCode] ?? 'ERROR';
}

export default ApiError;
