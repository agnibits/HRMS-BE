/**
 * Standalone dev runner — boots the full API with ZERO external services:
 *   • Embedded PostgreSQL (real binary, persisted under ./.dev/pgdata)
 *   • In-process Redis (ioredis-mock, via REDIS_DRIVER=memory)
 * Schema is auto-pushed and the DB seeded on first run.
 *
 *   npm run dev:standalone
 *
 * Data persists between runs. Delete ./.dev to reset. For production-like local
 * dev with real Postgres/Redis, use Docker: `npm run docker:up && npm run dev`.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';

const PG_PORT = 5432;
const DATA_DIR = join(process.cwd(), '.dev', 'pgdata');
const DB_URL = `postgresql://postgres:postgres@localhost:${PG_PORT}/hrms?schema=public`;

mkdirSync(join(process.cwd(), '.dev'), { recursive: true });
const initialised = existsSync(join(DATA_DIR, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PG_PORT,
  persistent: true,
});

let server;

async function main() {
  console.log('▶ Starting embedded PostgreSQL…');
  if (!initialised) await pg.initialise();
  await pg.start();
  if (!initialised) {
    await pg.createDatabase('hrms');
    console.log('  created database "hrms"');
  }
  console.log(`✅ PostgreSQL ready on :${PG_PORT}`);

  // Environment for this process (real secrets still come from .env via loadEnv).
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: DB_URL,
    REDIS_DRIVER: 'memory',
    // Not used in memory mode, but the config schema requires a value.
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_key_change_me_1234567890',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_change_me_1234567890',
  };

  console.log('▶ Syncing schema (prisma db push)…');
  execSync('npx prisma db push --skip-generate', { env, stdio: 'inherit' });

  console.log('▶ Seeding…');
  execSync('node prisma/seed.js', { env, stdio: 'inherit' });

  // Apply env, then import the app (config reads process.env at import time).
  Object.assign(process.env, env);
  const { createApp } = await import('../src/app.js');
  const { connectDatabase } = await import('../src/config/prisma.js');
  const { connectRedis } = await import('../src/config/redis.js');
  const { initSocket } = await import('../src/realtime/socket.js');
  const { config } = await import('../src/config/env.js');

  await connectDatabase();
  await connectRedis();

  const app = createApp();
  server = http.createServer(app);
  initSocket(server);
  server.listen(config.port, () => {
    console.log(`\n🚀 API      http://localhost:${config.port}${config.apiPrefix}`);
    console.log(`📚 Docs     http://localhost:${config.port}${config.apiPrefix}/docs`);
    console.log(`❤️  Health   http://localhost:${config.port}/health`);
    console.log(`\n   Login:   admin@hrms.local / Admin@12345`);
    console.log(`   (in-process Redis; queues/rate-limit run in-memory)\n`);
  });
}

async function shutdown() {
  console.log('\n▶ Shutting down…');
  try { server?.close(); } catch { /* noop */ }
  try { await pg.stop(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (err) => {
  console.error('❌ Standalone dev failed:', err);
  try { await pg.stop(); } catch { /* noop */ }
  process.exit(1);
});
