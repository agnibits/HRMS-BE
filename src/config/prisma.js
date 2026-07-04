import { PrismaClient } from '@prisma/client';
import { config } from './env.js';
import { logger } from './logger.js';

/**
 * Single, shared PrismaClient instance (connection pooling handled by Prisma).
 * A global cache prevents exhausting DB connections on hot-reload in dev.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: config.isDev
      ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
      : [{ level: 'error', emit: 'event' }],
  });

prisma.$on?.('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on?.('error', (e) => logger.error({ prisma: e }, 'prisma error'));

if (!config.isProd) globalForPrisma.__prisma = prisma;

export async function connectDatabase() {
  await prisma.$connect();
  logger.info('✅ PostgreSQL connected');
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

export default prisma;
