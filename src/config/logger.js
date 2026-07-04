import pino from 'pino';
import { config } from './env.js';

/**
 * Application logger (Pino). In development it pretty-prints; in production it
 * emits structured JSON suitable for log shippers (Loki, ELK, CloudWatch).
 */
const transport = config.isDev
  ? {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    }
  : undefined;

export const logger = pino({
  level: config.logLevel,
  base: { service: config.appName.toLowerCase() },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'token',
      '*.token',
      'refreshToken',
    ],
    censor: '[REDACTED]',
  },
  transport,
});

export default logger;
