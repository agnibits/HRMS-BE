import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis, usingMemoryRedis } from '../config/redis.js';
import { config } from '../config/env.js';

/**
 * Redis-backed rate limiting so limits are shared across horizontally-scaled
 * instances. Two presets: a generous global limiter and a strict limiter for
 * auth endpoints (login, forgot-password, OTP) to blunt brute-force attempts.
 */
function makeLimiter({ windowMs, max, prefix }) {
  // In memory-redis mode use the built-in in-memory store (no external Redis).
  const store = usingMemoryRedis
    ? undefined
    : new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: `rl:${prefix}:` });

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(store ? { store } : {}),
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
    },
  });
}

export const globalRateLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  prefix: 'global',
});

export const authRateLimiter = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  prefix: 'auth',
});

export default { globalRateLimiter, authRateLimiter };
