import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { swaggerSpec } from './config/swagger.js';
import { requestContext } from './middlewares/requestContext.middleware.js';
import { globalRateLimiter } from './middlewares/rateLimit.middleware.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import apiRoutes from './routes/index.js';

/**
 * Builds and configures the Express application. Server bootstrap (HTTP listen,
 * Socket.io, graceful shutdown) lives in server.js — this module is transport
 * agnostic and therefore easy to test.
 */
export function createApp() {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Security & parsing ────────────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(hpp());

  // ── Observability & context ───────────────────────────────────────────
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/health/ready' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    })
  );

  // ── Health checks ─────────────────────────────────────────────────────
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
  );
  app.get('/health/ready', async (_req, res) => {
    const { prisma } = await import('./config/prisma.js');
    const { redis } = await import('./config/redis.js');
    const checks = { db: 'down', redis: 'down' };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = 'up';
    } catch { /* noop */ }
    try {
      if (redis.status === 'ready') checks.redis = 'up';
    } catch { /* noop */ }
    const healthy = checks.db === 'up';
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', checks });
  });

  // Friendly root: send visitors to the API docs (or the API base).
  app.get('/', (_req, res) =>
    res.redirect(config.swagger.enabled ? `${config.apiPrefix}/docs` : config.apiPrefix)
  );

  // ── Uploaded files (local storage driver) ─────────────────────────────
  app.use('/uploads', express.static(config.storage.localDir));

  // ── API docs ──────────────────────────────────────────────────────────
  if (config.swagger.enabled) {
    app.use(`${config.apiPrefix}/docs`, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get(`${config.apiPrefix}/docs.json`, (_req, res) => res.json(swaggerSpec));
  }

  // ── Rate limiting + routes ────────────────────────────────────────────
  app.use(config.apiPrefix, globalRateLimiter, apiRoutes);

  // ── 404 + error handling (must be last) ───────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
