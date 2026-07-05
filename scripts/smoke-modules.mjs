/**
 * Boot smoke-test for the generated HR modules — embedded Postgres + in-process
 * Redis, real HTTP through the factory-built CRUD endpoints.
 *   node scripts/smoke-modules.mjs
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PG_PORT = 5457;
const APP_PORT = 4067;
const DB_URL = `postgresql://postgres:postgres@localhost:${PG_PORT}/hrms?schema=public`;
const dataDir = mkdtempSync(join(tmpdir(), 'hrms-mod-'));
let pg, server;
const results = [];
const rec = (name, passed, info = '') => {
  results.push(passed);
  console.log(`${passed ? '✅' : '❌'} ${name}${info ? ` — ${info}` : ''}`);
};

async function main() {
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('hrms');

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: DB_URL,
    REDIS_URL: 'redis://localhost:6379',
    PORT: String(APP_PORT),
    JWT_ACCESS_SECRET: 'test_access_secret_key_1234567890',
    JWT_REFRESH_SECRET: 'test_refresh_secret_key_1234567890',
    LOG_LEVEL: 'silent',
  };
  execSync('npx prisma db push --skip-generate --accept-data-loss', { env, stdio: 'ignore' });
  execSync('node prisma/seed.js', { env, stdio: 'ignore' });
  rec('embedded PG + schema + seed', true);

  Object.assign(process.env, env);
  const { createApp } = await import('../src/app.js');
  const { connectDatabase } = await import('../src/config/prisma.js');
  const { connectRedis } = await import('../src/config/redis.js');
  await connectDatabase();
  await connectRedis();
  const app = createApp();
  await new Promise((r) => (server = app.listen(APP_PORT, r)));
  rec('app booted with all module routes', true);

  const api = `http://localhost:${APP_PORT}/api/v1`;
  const login = await (
    await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@hrms.local', password: 'Admin@12345' }) })
  ).json();
  const token = login.data.accessToken;
  const userId = login.data.user.id;
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  rec('login + permissions expanded', login.data.user.permissions.includes('department:read'), `${login.data.user.permissions.length} perms`);

  const post = (path, body) => fetch(`${api}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const get = (path) => fetch(`${api}${path}`, { headers: H }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const put = (path, body) => fetch(`${api}${path}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, j })));

  // Departments
  const dep = await post('/departments', { name: 'Engineering', code: 'ENG', head: 'Alice', status: 'ACTIVE' });
  rec('POST /departments', dep.status === 201 && dep.j.data.employeeCount === 0, `id=${dep.j.data?.id}`);
  const depList = await get('/departments?page=1&limit=10&status=ACTIVE&search=eng');
  rec('GET /departments (filter+search+employeeCount)', depList.j.data?.[0]?.employeeCount === 0 && depList.j.meta.pagination.total >= 1);

  // Designations (auto code + level)
  const desig = await post('/designations', { title: 'Senior Engineer', level: 5, department: 'Engineering' });
  rec('POST /designations (auto-code, dept resolve)', desig.status === 201, `code=${desig.j.data?.code}`);

  // Attendance → HH:MM times + workHours
  const att = await post('/attendance', { employee: userId, date: '2026-07-01', checkIn: '09:00', checkOut: '17:30', status: 'PRESENT' });
  rec('POST /attendance ("HH:MM" times, workHours=8.5)', att.status === 201 && att.j.data.workHours === 8.5 && att.j.data.checkIn === '09:00', `wh=${att.j.data?.workHours} in=${att.j.data?.checkIn}`);
  // Finding 2: employee sent as EMAIL should still resolve the name
  const attEmail = await post('/attendance', { employee: 'admin@hrms.local', date: '2026-07-02', checkIn: '10:00', checkOut: '18:00' });
  rec('POST /attendance (employee=email → name resolved)', attEmail.status === 201 && attEmail.j.data.employeeName === 'Super Admin', `name=${attEmail.j.data?.employeeName}`);
  // overnight/night shift
  const night = await post('/attendance', { employee: userId, date: '2026-07-03', checkIn: '22:00', checkOut: '06:00' });
  rec('POST /attendance (overnight shift = 8h)', night.j.data?.workHours === 8, `wh=${night.j.data?.workHours}`);

  // Leave → days
  const lv = await post('/leaves', { employee: userId, type: 'ANNUAL', startDate: '2026-07-10', endDate: '2026-07-12', reason: 'Trip' });
  rec('POST /leaves (days computed)', lv.status === 201 && lv.j.data.days === 3, `days=${lv.j.data?.days}`);

  // Leave types (policy) — code auto-uppercased
  const lt = await post('/leave-types', { name: 'Annual Leave', code: 'annual', daysPerYear: 20, paid: true, carryForward: true, maxCarryForward: 5, color: '#22c55e' });
  rec('POST /leave-types (code uppercased, defaults)', lt.status === 201 && lt.j.data.code === 'ANNUAL' && lt.j.data.status === 'ACTIVE', `code=${lt.j.data?.code}`);
  const ltList = await get('/leave-types?status=ACTIVE&search=annual');
  rec('GET /leave-types (filter+search)', ltList.j.meta.pagination.total >= 1);
  const ltDup = await post('/leave-types', { name: 'Annual', code: 'ANNUAL', daysPerYear: 10 });
  rec('POST /leave-types (duplicate code → 409)', ltDup.status === 409);

  // Leave balance (ANNUAL policy=20 exists; one 3-day PENDING ANNUAL leave from above)
  const bal = await get(`/leaves/balance?employee=${userId}`);
  const annual = (bal.j.data || []).find((b) => b.code === 'ANNUAL');
  rec('GET /leaves/balance', !!annual && annual.allocated === 20 && annual.pending === 3, `alloc=${annual?.allocated} pending=${annual?.pending} avail=${annual?.available}`);
  const over = await post('/leaves', { employee: userId, type: 'ANNUAL', startDate: '2026-08-01', endDate: '2026-08-25', reason: 'long' }); // 25d > 17 avail
  rec('POST /leaves (over balance → 422)', over.status === 422 && over.j.error?.code === 'INSUFFICIENT_LEAVE_BALANCE');
  const within = await post('/leaves', { employee: userId, type: 'ANNUAL', startDate: '2026-08-01', endDate: '2026-08-05', reason: 'ok' }); // 5d <= 17
  rec('POST /leaves (within balance → 201)', within.status === 201);

  // Payroll → net
  const pay = await post('/payroll', { employee: userId, period: '2026-07', gross: 5000, deductions: 500, bonus: 200 });
  rec('POST /payroll (net = gross-ded+bonus)', pay.status === 201 && pay.j.data.net === 4700, `net=${pay.j.data?.net}`);

  // Recruitment chain
  const job = await post('/jobs', { title: 'Backend Dev', type: 'FULL_TIME', openings: 2, status: 'OPEN' });
  rec('POST /jobs', job.status === 201);
  const cand = await post('/candidates', { firstName: 'John', lastName: 'Seeker', email: 'john@x.com', jobTitle: 'Backend Dev', stage: 'APPLIED' });
  rec('POST /candidates', cand.status === 201);
  const iv = await post('/interviews', { candidate: cand.j.data.id, interviewer: 'Alice', scheduledAt: '2026-07-15T10:00:00Z', mode: 'REMOTE' });
  rec('POST /interviews (candidateName resolved)', iv.status === 201 && iv.j.data.candidateName === 'John Seeker', `name=${iv.j.data?.candidateName}`);
  const ivFilter = await get(`/interviews?candidateId=${cand.j.data.id}`);
  rec('GET /interviews?candidateId filter', ivFilter.j.meta.pagination.total === 1);

  // Goals, courses, assets, expenses, tickets, onboarding, performance
  const goal = await post('/goals', { title: 'Ship v1', owner: 'Alice', dueDate: '2026-09-01', progress: 30, keyResults: ['a', 'b'] });
  rec('POST /goals (keyResults json)', goal.status === 201);
  const course = await post('/courses', { title: 'Node 101', durationHours: 8, status: 'PUBLISHED' });
  rec('POST /courses', course.status === 201);
  const asset = await post('/assets', { name: 'MacBook', tag: 'MB-001', status: 'ASSIGNED' });
  rec('POST /assets', asset.status === 201);
  const exp = await post('/expenses', { title: 'Taxi', employee: userId, amount: 25.5, date: '2026-07-02' });
  rec('POST /expenses (employeeName)', exp.status === 201 && !!exp.j.data.employeeName);
  const tkt = await post('/tickets', { subject: 'Laptop slow', requester: userId, priority: 'HIGH' });
  rec('POST /tickets (requesterName)', tkt.status === 201 && !!tkt.j.data.requesterName);
  const onb = await post('/onboarding', { employee: userId, startDate: '2026-07-01', progress: 50 });
  rec('POST /onboarding', onb.status === 201 && onb.j.data.progress === 50);
  const perf = await post('/performance-reviews', { employee: userId, reviewer: 'Alice', cycle: 'Q3', score: 4.5 });
  rec('POST /performance-reviews', perf.status === 201);

  // Notifications
  const notif = await post('/notifications', { title: 'Welcome', type: 'SUCCESS' });
  rec('POST /notifications', notif.status === 201);
  const readAll = await post('/notifications/read-all', {});
  rec('POST /notifications/read-all', readAll.status === 200);
  const notifList = await get('/notifications');
  rec('GET /notifications (unread meta)', notifList.j.meta.pagination.unread === 0);

  // Company settings
  const comp = await get('/companies?limit=1');
  rec('GET /companies?limit=1', comp.j.data?.length === 1, comp.j.data?.[0]?.name);
  const compUpd = await put(`/companies/${comp.j.data[0].id}`, { weekStart: 'SUNDAY', currency: 'INR' });
  rec('PUT /companies/:id', compUpd.status === 200 && compUpd.j.data.currency === 'INR');

  // AI (no GROQ key in test → graceful degrade)
  const aiStatus = await get('/ai/status');
  rec('GET /ai/status (configured:false w/o key)', aiStatus.j.data?.configured === false);
  const aiChat = await post('/ai/chat', { messages: [{ role: 'user', content: 'hi' }] });
  rec('POST /ai/chat (no key → 503 AI_NOT_CONFIGURED)', aiChat.status === 503 && aiChat.j.error?.code === 'AI_NOT_CONFIGURED');
  const aiVal = await post('/ai/chat', { messages: [] });
  rec('POST /ai/chat (empty messages → 422)', aiVal.status === 422);

  // Validation + RBAC
  const bad = await post('/departments', { code: 'X' }); // missing name
  rec('POST /departments (missing name → 422)', bad.status === 422);
  const noauth = await fetch(`${api}/departments`);
  rec('GET /departments (no token → 401)', noauth.status === 401);

  // Delete + audit
  const del = await fetch(`${api}/departments/${dep.j.data.id}`, { method: 'DELETE', headers: H });
  rec('DELETE /departments/:id (204)', del.status === 204);
  const gone = await get(`/departments/${dep.j.data.id}`);
  rec('GET deleted department → 404', gone.status === 404);

  const passed = results.filter(Boolean).length;
  console.log(`\n──────────────────────────────\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main()
  .catch((e) => { console.error('❌ crashed:', e); process.exitCode = 1; })
  .finally(async () => {
    try { server?.close(); } catch {}
    try { await pg?.stop(); } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    setTimeout(() => process.exit(process.exitCode ?? 0), 400).unref();
  });
