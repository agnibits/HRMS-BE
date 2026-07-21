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
    await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@hrms.local', password: 'Admin@12345', portal: 'platform' }) })
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

  // Department head = employee reference (headId → resolved headName)
  const headDept = await post('/departments', { name: 'Ops', code: 'OPS', headId: userId, status: 'ACTIVE' });
  rec('Dept head as employee ref (headId → headName)', headDept.status === 201 && headDept.j.data?.headId === userId && headDept.j.data?.headName === 'Super Admin', `head=${headDept.j.data?.headName}`);
  const headMember = await get(`/users/${userId}`);
  rec('Dept head auto-assigned as department member', headMember.j.data?.departmentId === headDept.j.data.id && headMember.j.data?.departmentName === 'Ops', `dept=${headMember.j.data?.departmentName}`);
  const headClear = await put(`/departments/${headDept.j.data.id}`, { headId: null });
  rec('Dept head cleared', headClear.status === 200 && headClear.j.data?.headId === null && headClear.j.data?.headName === null);
  const headText = await post('/departments', { name: 'Legacy', code: 'LEG', head: 'Some Name' });
  rec('Dept head legacy free-text still works', headText.status === 201 && headText.j.data?.headName === 'Some Name');

  // Designations (auto code + level)
  const desig = await post('/designations', { title: 'Senior Engineer', level: 5, department: 'Engineering' });
  rec('POST /designations (auto-code, dept resolve)', desig.status === 201, `code=${desig.j.data?.code}`);
  // Designation.department is a REFERENCE: send departmentId, get departmentName back
  const desigRef = await post('/designations', { title: 'Staff Engineer', level: 6, departmentId: dep.j.data.id });
  rec('POST /designations (departmentId → departmentName resolved)',
    desigRef.status === 201 && desigRef.j.data?.departmentId === dep.j.data.id && desigRef.j.data?.departmentName === 'Engineering',
    `deptId=${desigRef.j.data?.departmentId} deptName=${desigRef.j.data?.departmentName}`);
  // Level is OPTIONAL — a title with no leveling framework must still create
  const desigNoLvl = await post('/designations', { title: 'Office Coordinator' });
  rec('POST /designations (level optional)', desigNoLvl.status === 201 && (desigNoLvl.j.data?.level ?? null) === null, `level=${desigNoLvl.j.data?.level}`);

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

  // ── P2 Leave approval workflow ──
  const rolesForWf = await get('/roles?limit=20');
  const employeeRole = rolesForWf.j.data.find((r) => r.name === 'EMPLOYEE');
  const wfMgr = await post('/users', { email: 'wf.mgr@hrms.local', firstName: 'Wf', lastName: 'Mgr', password: 'Passw0rd!23', sendWelcomeEmail: false, roleIds: [employeeRole.id] });
  const wfMgrId = wfMgr.j.data.id;
  const wfEmp = await post('/users', { email: 'wf.emp@hrms.local', firstName: 'Wf', lastName: 'Emp', password: 'Passw0rd!23', sendWelcomeEmail: false, roleIds: [employeeRole.id], managerId: wfMgrId });
  const wfEmpId = wfEmp.j.data.id;
  rec('P2 setup: employee.managerName resolved', wfEmp.j.data.managerName === 'Wf Mgr');
  const apply = await post('/leaves', { employee: wfEmpId, type: 'ANNUAL', startDate: '2026-09-01', endDate: '2026-09-03', reason: 'Vacation' });
  const leaveId = apply.j.data?.id;
  rec('P2 apply → PENDING', apply.status === 201 && apply.j.data?.status === 'PENDING');
  const mgrTok = (await post('/auth/login', { email: 'wf.mgr@hrms.local', password: 'Passw0rd!23' })).j.data.accessToken;
  const mh = { authorization: `Bearer ${mgrTok}`, 'content-type': 'application/json' };
  const mf = (m, p, b) => fetch(`${api}${p}`, { method: m, headers: mh, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const queue = await mf('GET', '/leaves?pendingApproval=me');
  rec('P2 manager queue (?pendingApproval=me)', queue.j.data?.some((l) => l.id === leaveId));
  const mnotif = await mf('GET', '/notifications');
  rec('P2 manager notified on apply', mnotif.j.data?.some((n) => /leave request/i.test(n.title)));
  const badReject = await mf('POST', `/leaves/${leaveId}/reject`, {});
  rec('P2 reject without reason → 422', badReject.status === 422);
  const approved = await mf('POST', `/leaves/${leaveId}/approve`);
  rec('P2 manager approve → APPROVED', approved.status === 200 && approved.j.data?.status === 'APPROVED');
  const empTok = (await post('/auth/login', { email: 'wf.emp@hrms.local', password: 'Passw0rd!23' })).j.data.accessToken;
  const enotif = await fetch(`${api}/notifications`, { headers: { authorization: `Bearer ${empTok}` } }).then((r) => r.json());
  rec('P2 employee notified on decision', enotif.data?.some((n) => /approved/i.test(n.title)));
  const balA = await get(`/leaves/balance?employee=${wfEmpId}`);
  rec('P2 balance counts approved leave (used=3)', (balA.j.data || []).find((b) => b.code === 'ANNUAL')?.used === 3);
  const cancel = await post(`/leaves/${leaveId}/cancel`, {});
  rec('P2 cancel → CANCELLED', cancel.status === 200 && cancel.j.data?.status === 'CANCELLED');
  const balB = await get(`/leaves/balance?employee=${wfEmpId}`);
  rec('P2 cancel restores balance (used=0)', ((balB.j.data || []).find((b) => b.code === 'ANNUAL')?.used ?? -1) === 0);
  const mgrLeave = await post('/leaves', { employee: wfMgrId, type: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', reason: 'Self' });
  const selfApprove = await mf('POST', `/leaves/${mgrLeave.j.data.id}/approve`);
  rec('P2 self-approval blocked → 403', selfApprove.status === 403 && selfApprove.j.error?.code === 'SELF_APPROVAL');

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
  const tkt = await post('/tickets', { subject: 'Laptop slow', requester: userId, assignee: 'admin@hrms.local', priority: 'HIGH' });
  rec('POST /tickets (requesterName + assigneeName)', tkt.status === 201 && !!tkt.j.data.requesterName && tkt.j.data.assigneeName === 'Super Admin');
  const onb = await post('/onboarding', { employee: userId, startDate: '2026-07-01', progress: 50, buddy: userId, manager: 'admin@hrms.local' });
  rec('POST /onboarding (buddy/manager names resolved)', onb.status === 201 && onb.j.data.progress === 50 && onb.j.data.buddyName === 'Super Admin' && onb.j.data.managerName === 'Super Admin', `buddy=${onb.j.data?.buddyName} mgr=${onb.j.data?.managerName}`);
  const perf = await post('/performance-reviews', { employee: userId, reviewer: 'admin@hrms.local', cycle: 'Q3', score: 4.5 });
  rec('POST /performance-reviews (reviewerName resolved)', perf.status === 201 && perf.j.data.reviewerName === 'Super Admin');

  // Notifications
  const notif = await post('/notifications', { title: 'Welcome', type: 'SUCCESS' });
  rec('POST /notifications', notif.status === 201);
  const readAll = await post('/notifications/read-all', {});
  rec('POST /notifications/read-all', readAll.status === 200);
  const notifList = await get('/notifications');
  rec('GET /notifications (unread meta)', notifList.j.meta.pagination.unread === 0);

  // Company settings (tenant self-service — super admin also sees own via ?limit=1... but super lists all)
  const comp = await get('/companies?limit=1');
  rec('GET /companies (super admin lists all)', Array.isArray(comp.j.data) && comp.j.data.length >= 1);
  const ownId = login.data.user.companyId;
  const compUpd = await put(`/companies/${ownId}`, { plan: 'PRO' });
  rec('PUT /companies/:id (platform: plan)', compUpd.status === 200 && compUpd.j.data.plan === 'PRO');

  // ── Agnibits superAdmin: provisioning + suspend flow ──
  const prov = await post('/companies', { name: 'Acme Inc', plan: 'PRO', admin: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.test', password: 'Temp@1234' } });
  rec('POST /companies (provision company+admin)', prov.status === 201 && prov.j.data.company.name === 'Acme Inc' && prov.j.data.admin.role === 'ADMIN', `co=${prov.j.data?.company?.id}`);
  const newCoId = prov.j.data?.company?.id;
  const provDup = await post('/companies', { name: 'Acme Inc', admin: { firstName: 'X', lastName: 'Y', email: 'x@acme.test', password: 'Temp@1234' } });
  rec('POST /companies (duplicate name → 409)', provDup.status === 409);
  const listAll = await get('/companies?plan=PRO&search=acme');
  rec('GET /companies (filter plan+search)', listAll.j.data?.some((c) => c.name === 'Acme Inc' && typeof c.employeeCount === 'number'));

  // new tenant admin can log in immediately (email pre-verified)
  const acmeLogin = await post('/auth/login', { email: 'jane@acme.test', password: 'Temp@1234' });
  rec('Acme admin can log in (verified)', acmeLogin.status === 200 && !!acmeLogin.j.data?.accessToken);
  const acmeH = { authorization: `Bearer ${acmeLogin.j.data.accessToken}`, 'content-type': 'application/json' };
  // tenant admin sees ONLY own company, cannot provision
  const acmeList = await fetch(`${api}/companies`, { headers: acmeH }).then((r) => r.json());
  rec('Tenant admin GET /companies → only own', acmeList.data?.length === 1 && acmeList.data[0].id === newCoId);
  const acmeProvTry = await fetch(`${api}/companies`, { method: 'POST', headers: acmeH, body: JSON.stringify({ name: 'Hack Co', admin: { firstName: 'a', lastName: 'b', email: 'z@z.test', password: 'Temp@1234' } }) });
  rec('Tenant admin POST /companies → 403', acmeProvTry.status === 403);

  // suspend Acme → its admin login blocked
  const susp = await put(`/companies/${newCoId}`, { status: 'SUSPENDED' });
  rec('PUT /companies/:id (suspend)', susp.status === 200 && susp.j.data.status === 'SUSPENDED');
  const blockedLogin = await post('/auth/login', { email: 'jane@acme.test', password: 'Temp@1234' });
  rec('Suspended company → login 403 COMPANY_SUSPENDED', blockedLogin.status === 403 && blockedLogin.j.error?.code === 'COMPANY_SUSPENDED');
  // existing token also blocked (redis flag)
  const blockedReq = await fetch(`${api}/departments`, { headers: acmeH });
  rec('Suspended company → existing token 403', blockedReq.status === 403);
  // reactivate → login works again
  await put(`/companies/${newCoId}`, { status: 'ACTIVE' });
  const reLogin = await post('/auth/login', { email: 'jane@acme.test', password: 'Temp@1234' });
  rec('Reactivated → login works', reLogin.status === 200);

  // ── PORTAL SEPARATION (SUPER_ADMIN ↔ HRMS product) ──
  const rawLogin = (body) => fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const suHrms = await rawLogin({ email: 'admin@hrms.local', password: 'Admin@12345', portal: 'hrms' });
  rec('Portal: SUPER_ADMIN on HRMS portal → 403', suHrms.status === 403 && suHrms.j.error?.code === 'USE_PLATFORM_PORTAL');
  const suDefault = await rawLogin({ email: 'admin@hrms.local', password: 'Admin@12345' });
  rec('Portal: SUPER_ADMIN default(hrms) blocked', suDefault.status === 403);
  const tenantPlatform = await rawLogin({ email: 'jane@acme.test', password: 'Temp@1234', portal: 'platform' });
  rec('Portal: tenant admin on platform portal → 403', tenantPlatform.status === 403 && tenantPlatform.j.error?.code === 'USE_HRMS_PORTAL');
  const tenantHrms = await rawLogin({ email: 'jane@acme.test', password: 'Temp@1234', portal: 'hrms' });
  rec('Portal: tenant admin on HRMS portal → 200', tenantHrms.status === 200);

  // ── TENANT ISOLATION (Acme admin must NOT see/touch Demo tenant) ──
  const acme2H = { authorization: `Bearer ${reLogin.j.data.accessToken}`, 'content-type': 'application/json' };
  const jget = (p) => fetch(`${api}${p}`, { headers: acme2H }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const jpost = (p, b) => fetch(`${api}${p}`, { method: 'POST', headers: acme2H, body: JSON.stringify(b) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  // super admin creates a user + custom role in Demo (own company)
  const demoUser = await post('/users', { email: 'demo.user@hrms.local', firstName: 'Demo', lastName: 'User', password: 'Passw0rd!23', sendWelcomeEmail: false });
  const demoUserId = demoUser.j.data.id;
  const demoRole = await post('/roles', { name: 'DemoOnlyRole', permissions: ['user:read'] });
  const demoRoleId = demoRole.j.data.id;
  // Acme admin: list users → only own tenant
  const acmeUsers = await jget('/users?limit=100');
  rec('ISOLATION: /users excludes other tenant', !acmeUsers.j.data.some((u) => u.id === demoUserId) && acmeUsers.j.data.every((u) => u.companyId === newCoId));
  // Acme admin: GET Demo user by id → 404
  const crossUser = await jget(`/users/${demoUserId}`);
  rec('ISOLATION: GET other-tenant user → 404', crossUser.status === 404);
  // Acme admin: even if payload says companyId=Demo, user lands in Acme
  const forced = await jpost('/users', { email: 'newbie@acme.test', firstName: 'New', lastName: 'Bie', password: 'Passw0rd!23', companyId: ownId, sendWelcomeEmail: false });
  rec('ISOLATION: create forced to own company', forced.j.data?.companyId === newCoId);
  // Acme admin: GET Demo role by id → 404; list excludes it
  const crossRole = await jget(`/roles/${demoRoleId}`);
  rec('ISOLATION: GET other-tenant role → 404', crossRole.status === 404);
  const acmeRoles = await jget('/roles?limit=100');
  rec('ISOLATION: /roles excludes other tenant', !acmeRoles.j.data.some((r) => r.id === demoRoleId));
  // Super admin still sees across tenants
  const superUsers = await get('/users?limit=100');
  rec('Super admin sees all tenants', superUsers.j.data.some((u) => u.id === demoUserId) && superUsers.j.data.some((u) => u.companyId === newCoId));

  // ── EMAIL UNIQUE PER COMPANY (same person can exist in multiple companies) ──
  const jpostH = (p, b, h) => fetch(`${api}${p}`, { method: 'POST', headers: h, body: JSON.stringify(b) }).then((r) => r.json().then((j) => ({ status: r.status, j })));
  const dA = await post('/users', { email: 'dup@test.com', firstName: 'Dup', lastName: 'A', password: 'Passw0rd!11', sendWelcomeEmail: false });
  rec('Email/company: create dup@test in company A → 201', dA.status === 201);
  const dAdup = await post('/users', { email: 'dup@test.com', firstName: 'X', lastName: 'Y', password: 'Passw0rd!11', sendWelcomeEmail: false });
  rec('Email/company: same email SAME company → 409', dAdup.status === 409 && dAdup.j.error?.code === 'EMAIL_TAKEN');
  const dB = await jpostH('/users', { email: 'dup@test.com', firstName: 'Dup', lastName: 'B', password: 'Passw0rd!22', sendWelcomeEmail: false }, acme2H);
  rec('Email/company: same email OTHER company → 201', dB.status === 201);
  const loginA = await rawLogin({ email: 'dup@test.com', password: 'Passw0rd!11' });
  rec('Email/company: login resolves company A by password', loginA.status === 200 && loginA.j.data?.user?.companyId === ownId);
  const loginB = await rawLogin({ email: 'dup@test.com', password: 'Passw0rd!22' });
  rec('Email/company: login resolves company B by password', loginB.status === 200 && loginB.j.data?.user?.companyId === newCoId);
  // same email + same password in two companies → disambiguation flow
  await post('/users', { email: 'multi@test.com', firstName: 'M', lastName: 'A', password: 'Same@1234', sendWelcomeEmail: false });
  await jpostH('/users', { email: 'multi@test.com', firstName: 'M', lastName: 'B', password: 'Same@1234', sendWelcomeEmail: false }, acme2H);
  const multiLogin = await rawLogin({ email: 'multi@test.com', password: 'Same@1234' });
  rec('Email/company: same email+pw in 2 companies → multipleCompanies', multiLogin.status === 200 && multiLogin.j.data?.multipleCompanies === true && multiLogin.j.data?.companies?.length === 2);
  const pickLogin = await rawLogin({ email: 'multi@test.com', password: 'Same@1234', companyId: newCoId });
  rec('Email/company: disambiguate with companyId → 200', pickLogin.status === 200 && pickLogin.j.data?.user?.companyId === newCoId);

  // ── PRIVILEGE-ESCALATION PROTECTION (tenant can never become SUPER_ADMIN) ──
  const superRoles = await get('/roles?limit=100');
  const superRoleId = superRoles.j.data.find((r) => r.name === 'SUPER_ADMIN')?.id;
  // tenant tries to create a wildcard role
  const makeSuper = await jpost('/roles', { name: 'Hacker', permissions: ['*'] });
  rec('ESCALATION: tenant create *-role → 403', makeSuper.status === 403 && makeSuper.j.error?.code === 'FORBIDDEN_PERMISSION');
  const makePlatform = await jpost('/roles', { name: 'Hacker2', permissions: ['platform:manage'] });
  rec('ESCALATION: tenant create platform-role → blocked (403/422)', [403, 422].includes(makePlatform.status));
  // SUPER_ADMIN hidden from tenant /roles
  const acmeRoleList = await jget('/roles?limit=100');
  rec('ESCALATION: SUPER_ADMIN hidden from tenant /roles', !acmeRoleList.j.data.some((r) => r.name === 'SUPER_ADMIN'));
  // tenant GET SUPER_ADMIN by id → 404
  const acmeGetSuper = await jget(`/roles/${superRoleId}`);
  rec('ESCALATION: tenant GET SUPER_ADMIN role → 404', acmeGetSuper.status === 404);
  // tenant tries to assign SUPER_ADMIN to a user → 403
  const janeId = reLogin.j.data.user.id;
  const assignSuper = await fetch(`${api}/users/${janeId}/roles`, { method: 'PUT', headers: acme2H, body: JSON.stringify({ roleIds: [superRoleId] }) });
  const assignSuperJson = await assignSuper.json();
  rec('ESCALATION: tenant assign SUPER_ADMIN → 403', assignSuper.status === 403 && assignSuperJson.error?.code === 'FORBIDDEN_ROLE_ASSIGNMENT');
  // reset-admin
  const reset = await post(`/companies/${newCoId}/reset-admin`, {});
  rec('POST /companies/:id/reset-admin', reset.status === 200 && !!reset.j.data?.tempPassword && reset.j.data.email === 'jane@acme.test');

  // Company logo upload (local storage in test) + logoUrl in auth responses
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('logo', new Blob([png], { type: 'image/png' }), 'logo.png');
  const logoRes = await fetch(`${api}/companies/${ownId}/logo`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  const logoJson = await logoRes.json();
  rec('POST /companies/:id/logo', logoRes.status === 200 && !!logoJson.data?.logoUrl, `url=${logoJson.data?.logoUrl}`);
  const relog = await post('/auth/login', { email: 'admin@hrms.local', password: 'Admin@12345', portal: 'platform' });
  rec('login → user.company.logoUrl present', !!relog.j.data?.user?.company?.logoUrl);
  const me2 = await get('/auth/me');
  rec('/auth/me → user.company (name+logoUrl)', !!me2.j.data?.company?.name && !!me2.j.data?.company?.logoUrl);
  // reject non-image
  const badLogo = new FormData();
  badLogo.append('logo', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'x.txt');
  const badRes = await fetch(`${api}/companies/${ownId}/logo`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: badLogo });
  rec('POST /companies/:id/logo (non-image → 400)', badRes.status === 400);

  // ── #4 User HR fields (FK-based: departmentId/designationId/managerId → names) ──
  const deptId = dep.j.data.id, desigId = desig.j.data.id;
  const hrUser = await post('/users', {
    email: 'hr.fields@hrms.local', firstName: 'Hr', lastName: 'Fields',
    password: 'Passw0rd!23', sendWelcomeEmail: false,
    departmentId: deptId, designationId: desigId,
    managerId: userId, joiningDate: '2026-01-15', employmentType: 'FULL_TIME',
  });
  const hrUserId = hrUser.j.data?.id;
  rec('#4 POST /users (HR FK fields + employeeId + resolved names)',
    hrUser.status === 201 && /^EMP-\d{3}$/.test(hrUser.j.data?.employeeId || '') &&
    hrUser.j.data?.departmentName === 'Engineering' && hrUser.j.data?.designationName === 'Senior Engineer' &&
    hrUser.j.data?.managerName === 'Super Admin' && hrUser.j.data?.employmentType === 'FULL_TIME' && !!hrUser.j.data?.joiningDate,
    `empId=${hrUser.j.data?.employeeId} dept=${hrUser.j.data?.departmentName} desig=${hrUser.j.data?.designationName}`);
  // employeeCount must count USERS assigned to the dept/designation, NOT the legacy Employee table
  const depCount = await get(`/departments/${deptId}`);
  rec('Dept employeeCount reflects assigned users', (depCount.j.data?.employeeCount ?? 0) >= 1, `count=${depCount.j.data?.employeeCount}`);
  const desigCount = await get(`/designations/${desigId}`);
  rec('Designation employeeCount reflects assigned users', (desigCount.j.data?.employeeCount ?? 0) >= 1, `count=${desigCount.j.data?.employeeCount}`);
  const hrUser2 = await post('/users', { email: 'hr.fields2@hrms.local', firstName: 'A', lastName: 'B', password: 'Passw0rd!23', sendWelcomeEmail: false });
  rec('#4 employeeId sequential per company', /^EMP-\d{3}$/.test(hrUser2.j.data?.employeeId || '') && hrUser2.j.data?.employeeId !== hrUser.j.data?.employeeId,
    `${hrUser.j.data?.employeeId} → ${hrUser2.j.data?.employeeId}`);
  const hrUpd = await put(`/users/${hrUserId}`, { designationId: null, managerId: null });
  rec('#4 PUT /users (HR update, refs cleared)', hrUpd.status === 200 && hrUpd.j.data?.designationName === null && hrUpd.j.data?.managerName === null);
  const hrFilter = await get(`/users?departmentId=${deptId}&employmentType=FULL_TIME`);
  rec('#4 filters ?departmentId & ?employmentType', hrFilter.j.data?.some((u) => u.id === hrUserId));

  // Re-adding a previously DELETED employee must reactivate (soft-delete must not block create)
  const reU = await post('/users', { email: 'rehire@test.com', firstName: 'Re', lastName: 'One', password: 'Passw0rd!23', sendWelcomeEmail: false });
  const reUId = reU.j.data.id;
  await fetch(`${api}/users/${reUId}`, { method: 'DELETE', headers: H });
  const reAdd = await post('/users', { email: 'rehire@test.com', firstName: 'Re', lastName: 'Two', password: 'Passw0rd!23', sendWelcomeEmail: false });
  rec('Re-add deleted employee → reactivated (same record, updated)', reAdd.status === 201 && reAdd.j.data?.id === reUId && reAdd.j.data?.lastName === 'Two' && reAdd.j.data?.status !== undefined);
  const reLogin2 = await post('/auth/login', { email: 'rehire@test.com', password: 'Passw0rd!23' });
  rec('Reactivated employee can log in', reLogin2.status === 200);

  // ── #6 resend-invite ──
  const invite = await post(`/users/${hrUserId}/resend-invite`, {});
  rec('#6 POST /users/:id/resend-invite', invite.status === 200 && !!invite.j.data?.tempPassword && invite.j.data?.email === 'hr.fields@hrms.local');
  const inviteLogin = await post('/auth/login', { email: 'hr.fields@hrms.local', password: invite.j.data?.tempPassword });
  rec('#6 resend-invite temp password works', inviteLogin.status === 200);

  // ── #8 audit events ──
  const roleList = await get('/roles?limit=20');
  const empRole = (roleList.j.data || []).find((r) => r.name === 'EMPLOYEE');
  const assign = await put(`/users/${hrUserId}/roles`, { roleIds: [empRole.id] });
  rec('#8 PUT /users/:id/roles', assign.status === 200);
  const acts = await get(`/audit-logs?entityId=${hrUserId}&limit=50`);
  const actions = (acts.j.data || []).map((a) => a.action);
  rec('#8 audit: CREATE + UPDATE logged', actions.includes('CREATE') && actions.includes('UPDATE'));
  rec('#8 audit: ROLE_CHANGED logged', actions.includes('ROLE_CHANGED'));
  rec('#8 audit: INVITE_RESENT logged', actions.includes('INVITE_RESENT'));
  await fetch(`${api}/users/me/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ phone: '+911234567890' }) });
  const myActs = await get(`/audit-logs?entityId=${userId}&limit=50`);
  const myActions = (myActs.j.data || []).map((a) => a.action);
  rec('#8 audit: PROFILE_UPDATED logged', myActions.includes('PROFILE_UPDATED'));
  rec('#8 audit: LOGIN logged', myActions.includes('LOGIN'));

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
