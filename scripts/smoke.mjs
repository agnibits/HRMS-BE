/**
 * Boot smoke-test: starts an embedded PostgreSQL, pushes the Prisma schema,
 * seeds it, boots the real Express app (with an in-process Redis), and exercises
 * the auth + user + rbac flow over HTTP. No Docker/Postgres/Redis required.
 *
 *   node scripts/smoke.mjs
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PG_PORT = 5433;
const APP_PORT = 4055;
const DB_URL = `postgresql://postgres:postgres@localhost:${PG_PORT}/hrms?schema=public`;
const dataDir = mkdtempSync(join(tmpdir(), 'hrms-pg-'));

let pg;
let server;
const results = [];
const record = (name, passed, info = '') => {
  results.push({ name, passed, info });
  console.log(`${passed ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`);
};

async function main() {
  // ── 1. Embedded Postgres ────────────────────────────────────────────
  console.log('▶ Starting embedded PostgreSQL…');
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('hrms');
  record('Embedded Postgres started', true, `port ${PG_PORT}`);

  // ── 2. Environment ──────────────────────────────────────────────────
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: DB_URL,
    REDIS_URL: 'redis://localhost:6379',
    PORT: String(APP_PORT),
    JWT_ACCESS_SECRET: 'test_access_secret_key_1234567890',
    JWT_REFRESH_SECRET: 'test_refresh_secret_key_1234567890',
    ENABLE_SWAGGER: 'true',
    LOG_LEVEL: 'warn',
  };

  // ── 3. Schema push + seed ───────────────────────────────────────────
  console.log('▶ Pushing Prisma schema…');
  execSync('npx prisma db push --skip-generate --accept-data-loss', { env, stdio: 'inherit' });
  record('Prisma schema pushed', true);

  console.log('▶ Seeding…');
  execSync('node prisma/seed.js', { env, stdio: 'inherit' });
  record('Seed executed', true);

  // ── 4. Boot the real app ────────────────────────────────────────────
  Object.assign(process.env, env);
  const { createApp } = await import('../src/app.js');
  const { connectDatabase } = await import('../src/config/prisma.js');
  const { connectRedis } = await import('../src/config/redis.js');
  await connectDatabase();
  await connectRedis();
  const app = createApp();
  await new Promise((res) => {
    server = app.listen(APP_PORT, res);
  });
  record('Express app booted', true, `http://localhost:${APP_PORT}`);

  const base = `http://localhost:${APP_PORT}`;
  const api = `${base}/api/v1`;

  // ── 5. Health ───────────────────────────────────────────────────────
  const health = await fetch(`${base}/health`).then((r) => r.json());
  record('GET /health', health.status === 'ok', JSON.stringify(health.status));

  const ready = await fetch(`${base}/health/ready`);
  const readyBody = await ready.json();
  record('GET /health/ready (db+redis up)', ready.status === 200, JSON.stringify(readyBody.checks));

  // ── 6. Auth: bad login rejected ─────────────────────────────────────
  const bad = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hrms.local', password: 'wrong' }),
  });
  record('POST /auth/login (wrong password → 401)', bad.status === 401);

  // ── 7. Auth: validation error shape ─────────────────────────────────
  const invalid = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  const invalidBody = await invalid.json();
  record(
    'POST /auth/login (invalid body → 422 VALIDATION_ERROR)',
    invalid.status === 422 && invalidBody.error?.code === 'VALIDATION_ERROR'
  );

  // ── 8. Auth: successful login ───────────────────────────────────────
  const login = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@hrms.local', password: 'Admin@12345' }),
  });
  const loginBody = await login.json();
  const token = loginBody.data?.accessToken;
  record('POST /auth/login (success → token)', login.status === 200 && !!token, `roles=${loginBody.data?.user?.roles}`);

  const authH = { authorization: `Bearer ${token}` };

  // ── 9. Protected: /auth/me ──────────────────────────────────────────
  const me = await fetch(`${api}/auth/me`, { headers: authH }).then((r) => r.json());
  record('GET /auth/me', me.data?.email === 'admin@hrms.local', me.data?.email);

  // ── 10. Unauthorized without token ──────────────────────────────────
  const noAuth = await fetch(`${api}/users`);
  record('GET /users (no token → 401)', noAuth.status === 401);

  // ── 11. RBAC: permission catalog ────────────────────────────────────
  const perms = await fetch(`${api}/roles/permissions`, { headers: authH }).then((r) => r.json());
  record('GET /roles/permissions', perms.data?.total > 0, `${perms.data?.total} permissions`);

  // ── 12. Users: list (paginated) ─────────────────────────────────────
  const users = await fetch(`${api}/users?page=1&limit=10`, { headers: authH }).then((r) => r.json());
  record(
    'GET /users (paginated)',
    Array.isArray(users.data) && users.meta?.pagination?.total >= 1,
    `total=${users.meta?.pagination?.total}`
  );

  // ── 13. Users: create + audit ───────────────────────────────────────
  const create = await fetch(`${api}/users`, {
    method: 'POST',
    headers: { ...authH, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'jane.doe@hrms.local',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'Passw0rd!23',
      sendWelcomeEmail: false,
    }),
  });
  const created = await create.json();
  record('POST /users (create)', create.status === 201 && created.data?.email === 'jane.doe@hrms.local');
  const newUserId = created.data?.id;

  // ── 14. Duplicate email conflict ────────────────────────────────────
  const dup = await fetch(`${api}/users`, {
    method: 'POST',
    headers: { ...authH, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'jane.doe@hrms.local', firstName: 'J', lastName: 'D', password: 'Passw0rd!23' }),
  });
  const dupBody = await dup.json();
  record('POST /users (duplicate → 409)', dup.status === 409 && dupBody.error?.code === 'EMAIL_TAKEN');

  // ── 15. Search ──────────────────────────────────────────────────────
  const search = await fetch(`${api}/users?search=jane`, { headers: authH }).then((r) => r.json());
  record('GET /users?search=jane', search.data?.some((u) => u.email === 'jane.doe@hrms.local'));

  // ── 16. Soft delete ─────────────────────────────────────────────────
  const del = await fetch(`${api}/users/${newUserId}`, { method: 'DELETE', headers: authH });
  record('DELETE /users/:id (soft → 204)', del.status === 204);
  const afterDel = await fetch(`${api}/users/${newUserId}`, { headers: authH });
  record('GET deleted user → 404', afterDel.status === 404);

  // ── 17. Audit log written ───────────────────────────────────────────
  const audit = await fetch(`${api}/audit-logs?entity=user`, { headers: authH }).then((r) => r.json());
  record('GET /audit-logs (records exist)', (audit.meta?.pagination?.total ?? 0) > 0, `total=${audit.meta?.pagination?.total}`);

  // ── Summary ─────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n──────────────────────────────\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

async function cleanup() {
  try { server?.close(); } catch { /* noop */ }
  try { await pg?.stop(); } catch { /* noop */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
}

main()
  .catch((err) => {
    console.error('\n❌ Smoke test crashed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    // Force exit — lingering redis/socket handles can keep the loop alive.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  });
