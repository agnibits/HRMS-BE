import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from './env.js';
import { logger } from './logger.js';

/**
 * Shared Redis connections.
 *  - `redis`      : general-purpose client (caching, sessions, rate-limit store).
 *  - `bullConnection`: options object BullMQ uses to create its own clients
 *    (BullMQ requires `maxRetriesPerRequest: null`).
 *
 * When `config.redis.inMemory` is set (REDIS_DRIVER=memory or NODE_ENV=test) an
 * in-process ioredis-mock is used, so no external Redis server is required.
 * Otherwise a resilient real client is used that logs and degrades — it never
 * throws an uncaught error that would crash the process when Redis is down.
 */
export const usingMemoryRedis = config.redis.inMemory;

function createClient() {
  if (usingMemoryRedis) {
    const require = createRequire(import.meta.url);
    const RedisMock = require('ioredis-mock');
    return new RedisMock();
  }
  return new Redis(config.redis.url, {
    lazyConnect: true,
    enableReadyCheck: true,
    // Do NOT throw MaxRetriesPerRequestError (which crashes the process); keep
    // commands queued/failing softly and back off reconnection attempts.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
    reconnectOnError: () => true,
  });
}

export const redis = createClient();

let loggedError = false;
redis.on('connect', () => {
  loggedError = false;
  logger.info('✅ Redis connected');
});
// Log the first error, then stay quiet to avoid flooding logs while Redis is down.
redis.on('error', (err) => {
  if (!loggedError) {
    logger.warn({ code: err?.code }, 'Redis unavailable — features depending on it will degrade');
    loggedError = true;
  }
});

export const bullConnection = { url: config.redis.url, maxRetriesPerRequest: null };

export async function connectRedis() {
  if (usingMemoryRedis) return; // mock is ready immediately
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

export async function disconnectRedis() {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  logger.info('Redis disconnected');
}

export default redis;
