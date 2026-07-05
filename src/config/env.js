import { z } from 'zod';

/**
 * Centralized, validated environment configuration.
 * The process fails fast on boot if required variables are missing/invalid.
 */
const boolean = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('HRMS'),
  APP_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // 'redis' = connect to a real server; 'memory' = in-process ioredis-mock
  // (no external Redis needed — used by the standalone dev runner & tests).
  REDIS_DRIVER: z.enum(['redis', 'memory']).default('redis'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be >= 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be >= 16 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  PASSWORD_RESET_EXPIRES_MIN: z.coerce.number().default(30),
  EMAIL_VERIFY_EXPIRES_HOURS: z.coerce.number().default(24),
  OTP_EXPIRES_MIN: z.coerce.number().default(5),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  MAIL_HOST: z.string().default('localhost'),
  MAIL_PORT: z.coerce.number().default(1025),
  MAIL_USER: z.string().optional().default(''),
  MAIL_PASS: z.string().optional().default(''),
  MAIL_SECURE: boolean(false),
  MAIL_FROM: z.string().default('HRMS <no-reply@hrms.local>'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional().default('hrms'),
  S3_ACCESS_KEY: z.string().optional().default(''),
  S3_SECRET_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: boolean(true),
  LOCAL_UPLOAD_DIR: z.string().default('./storage/uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(15),

  ENABLE_SWAGGER: boolean(true),
  ENABLE_MFA: boolean(true),
  TRUST_PROXY: boolean(false),

  // AI (Groq — free, OpenAI-compatible). Optional: AI routes return 503 if unset.
  GROQ_API_KEY: z.string().optional().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  apiPrefix: env.API_PREFIX,
  appName: env.APP_NAME,
  appUrl: env.APP_URL,
  frontendUrl: env.FRONTEND_URL,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,

  db: { url: env.DATABASE_URL },
  redis: {
    url: env.REDIS_URL,
    // Use the in-process mock when explicitly requested or under automated tests.
    inMemory: env.REDIS_DRIVER === 'memory' || env.NODE_ENV === 'test',
  },

  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
  security: {
    passwordResetExpiresMin: env.PASSWORD_RESET_EXPIRES_MIN,
    emailVerifyExpiresHours: env.EMAIL_VERIFY_EXPIRES_HOURS,
    otpExpiresMin: env.OTP_EXPIRES_MIN,
    enableMfa: env.ENABLE_MFA,
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
  },
  cors: {
    origins:
      env.CORS_ORIGINS === '*'
        ? '*'
        : env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  },
  mail: {
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
    secure: env.MAIL_SECURE,
    from: env.MAIL_FROM,
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    localDir: env.LOCAL_UPLOAD_DIR,
    maxUploadBytes: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  },
  swagger: { enabled: env.ENABLE_SWAGGER },
  ai: {
    groqApiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
    enabled: !!env.GROQ_API_KEY,
  },
};

export default config;
