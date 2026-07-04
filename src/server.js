import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { initSocket } from './realtime/socket.js';
import { closeQueues } from './queues/index.js';

/**
 * Server bootstrap: connect infrastructure, start the HTTP + Socket.io server,
 * and wire graceful shutdown so in-flight requests drain and connections close
 * cleanly on SIGTERM/SIGINT (important for zero-downtime deploys).
 */
async function start() {
  await connectDatabase();
  await connectRedis().catch((err) =>
    logger.warn({ err }, 'Redis not reachable at boot; features depending on it will retry')
  );

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(config.port, () => {
    logger.info(`🚀 ${config.appName} API listening on http://localhost:${config.port}`);
    logger.info(`📚 Docs: http://localhost:${config.port}${config.apiPrefix}/docs`);
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    server.close(async () => {
      await Promise.allSettled([closeQueues(), disconnectRedis(), disconnectDatabase()]);
      logger.info('Shutdown complete');
      process.exit(0);
    });
    // Force-exit if drain takes too long.
    setTimeout(() => process.exit(1), 15000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException — exiting');
    process.exit(1);
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
