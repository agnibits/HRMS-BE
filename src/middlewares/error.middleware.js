import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';
import { getRequestId } from '../utils/requestContext.js';

/** 404 handler for unmatched routes. */
export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, { code: 'ROUTE_NOT_FOUND' }));
}

/**
 * Central error handler. Normalizes Zod, Prisma, and unexpected errors into the
 * uniform error envelope, logs server-side faults, and never leaks internals in
 * production.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let normalized = err;

  if (err instanceof ZodError) {
    normalized = ApiError.unprocessable('Validation failed', {
      code: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    normalized = mapPrismaError(err);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    normalized = ApiError.badRequest('Invalid database query', { code: 'DB_VALIDATION_ERROR' });
  } else if (!(err instanceof ApiError)) {
    normalized = new ApiError(500, err.message || 'Internal server error', {
      code: 'INTERNAL_ERROR',
      isOperational: false,
    });
  }

  const status = normalized.statusCode || 500;

  if (status >= 500 || !normalized.isOperational) {
    logger.error({ err, requestId: getRequestId(), path: req.originalUrl }, 'Unhandled error');
  } else {
    logger.warn({ code: normalized.code, msg: normalized.message, path: req.originalUrl }, 'Request error');
  }

  res.status(status).json({
    success: false,
    error: {
      code: normalized.code,
      message: status >= 500 && config.isProd ? 'Internal server error' : normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
    requestId: getRequestId(),
    timestamp: new Date().toISOString(),
    ...(config.isProd ? {} : { stack: status >= 500 ? err.stack : undefined }),
  });
}

function mapPrismaError(err) {
  switch (err.code) {
    case 'P2002': {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : err.meta?.target;
      return ApiError.conflict(`Duplicate value for unique field(s): ${target}`, {
        code: 'DUPLICATE_ENTRY',
      });
    }
    case 'P2025':
      return ApiError.notFound(err.meta?.cause || 'Record not found', { code: 'NOT_FOUND' });
    case 'P2003':
      return ApiError.badRequest('Related record constraint failed', { code: 'FK_CONSTRAINT' });
    case 'P2014':
      return ApiError.badRequest('Invalid relation reference', { code: 'RELATION_VIOLATION' });
    default:
      return new ApiError(500, 'Database error', { code: `PRISMA_${err.code}`, isOperational: false });
  }
}

export default { notFoundHandler, errorHandler };
