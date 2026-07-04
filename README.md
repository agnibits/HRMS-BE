# HRMS Backend

Enterprise Human Resource Management System backend built with **Node.js (ESM) · Express · PostgreSQL · Prisma · Redis**, following **Clean Architecture** and **SOLID** principles.

> Status: **Foundation + core modules complete and verified runnable.** Auth, User, RBAC/Roles, and Audit modules are fully implemented and pass a 19-check end-to-end boot smoke-test. Remaining HR modules (Employee, Org, Attendance, Leave, Payroll, …) are scaffolded to be added incrementally on this foundation — see the [roadmap](#module-roadmap).

---

## Architecture

Layered clean architecture — each request flows **Route → Middleware → Controller → Service → Repository → Prisma**:

```
Route         HTTP surface, Swagger docs, guards (auth, rbac, validate, rate-limit, audit)
  │
Controller    Thin HTTP adapter — parse req, call service, shape response (never business logic)
  │
Service       Business rules, orchestration, transactions, events, audit (the heart of a module)
  │
Repository    Data access over Prisma; extends BaseRepository (pagination/sort/search/soft-delete)
  │
Prisma        Type-safe DB client → PostgreSQL
```

Cross-cutting concerns live once and are reused everywhere:

| Concern            | Implementation |
|--------------------|----------------|
| Config             | `src/config/env.js` — Zod-validated env, fails fast on boot |
| Errors             | `ApiError` + central `error.middleware.js` (maps Zod & Prisma errors) |
| Responses          | Uniform envelope via `ApiResponse.js` (`ok`/`created`/`paginated`) |
| Request context    | `AsyncLocalStorage` — requestId + user available to every layer |
| Logging            | Pino (pretty in dev, JSON in prod) with secret redaction |
| Validation         | Zod schemas + `validate` middleware |
| AuthN              | JWT access/refresh with rotation + reuse detection, Redis blacklist |
| AuthZ              | Permission-based RBAC (`resource:action`) + role guards |
| Rate limiting      | Redis-backed (`express-rate-limit` + `rate-limit-redis`) |
| Audit              | `audit.service` + `audit` middleware → immutable `audit_logs` |
| Background jobs    | BullMQ queues + separate worker process |
| Realtime           | Socket.io (JWT-authed, per-user & per-company rooms) |
| Files              | Multer (memory) + local/S3 storage adapter; Excel import/export |

### Project structure

```
src/
├── config/          env, logger, prisma, redis, swagger
├── constants/       permissions catalog (RBAC source of truth)
├── core/            BaseRepository (reusable CRUD/pagination/search/soft-delete)
├── middlewares/     auth, rbac, validate, rateLimit, audit, error, upload, requestContext
├── modules/         one folder per domain module
│   ├── auth/        controller · service · routes · validators · tokens · mfa
│   ├── users/       controller · service · repository · routes · validators
│   ├── roles/       controller · service · repository · routes · validators
│   └── audit/       controller · service · repository · routes
├── notifications/   mail.service (Nodemailer + templates)
├── queues/          BullMQ queue registry + producers
├── realtime/        socket.io server
├── routes/          root API router (mounts modules)
├── utils/           ApiError, ApiResponse, asyncHandler, pagination, password, jwt, excel, …
├── app.js           Express app assembly (transport-agnostic)
├── server.js        HTTP + Socket.io bootstrap + graceful shutdown
└── worker.js        BullMQ worker process
prisma/
├── schema.prisma    data model (grows one module at a time)
├── seed.js          system roles + demo company + super admin
└── sql/init.sql      generated raw SQL schema
scripts/
└── smoke.mjs         end-to-end boot test (embedded Postgres, no Docker needed)
```

---

## Quick start

### Option A — with Docker (recommended)

```bash
cp .env.example .env
npm install
npm run docker:up            # Postgres + Redis + MinIO + MailHog
npm run prisma:migrate       # create & apply migrations
npm run prisma:seed          # seed roles + super admin
npm run dev                  # API on http://localhost:4000
npm run worker               # (separate terminal) background jobs
```

### Option B — no Docker (embedded Postgres smoke-test)

Verifies the whole stack boots and the API works, with zero external services:

```bash
npm install
node scripts/smoke.mjs
```

### Endpoints

- API base: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api/v1/docs`
- Health: `GET /health` · Readiness: `GET /health/ready`

### Default credentials (seed, dev only)

```
email:    admin@hrms.local
password: Admin@12345
```

---

## API conventions

**Success**
```json
{ "success": true, "message": "...", "data": {}, "meta": { "pagination": {} }, "requestId": "...", "timestamp": "..." }
```

**Error**
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }, "requestId": "...", "timestamp": "..." }
```

**List queries** (every list endpoint): `?page=1&limit=20&sort=-createdAt,name&search=term` plus per-module filters.

---

## Implemented endpoints (core)

<details>
<summary><b>Auth</b> — <code>/api/v1/auth</code></summary>

| Method | Path | Description |
|---|---|---|
| POST | `/login` | Email + password (returns tokens or MFA challenge) |
| POST | `/mfa/verify` | Complete MFA login (TOTP) |
| POST | `/refresh` | Rotate access/refresh (reuse detection) |
| POST | `/logout` · `/logout-all` | Revoke session(s) |
| POST | `/forgot-password` · `/reset-password` | Password reset flow |
| POST | `/change-password` | Change password (signs out other sessions) |
| POST | `/send-verification` · `/verify-email` | Email verification |
| GET | `/me` | Current user |
| POST | `/mfa/setup` · `/mfa/enable` · `/mfa/disable` | TOTP MFA management |
| GET/DELETE | `/sessions`, `/sessions/:id` | Session management |
| GET/PATCH/DELETE | `/devices`, `/devices/:id/trust`, `/devices/:id` | Device management |
</details>

<details>
<summary><b>Users</b> — <code>/api/v1/users</code></summary>

`GET /` (list) · `POST /` (create) · `GET/PUT/DELETE /:id` · `POST /:id/restore` · `PUT /:id/roles` · `PATCH /me/profile` · `GET /export` (Excel) · `POST /import` (Excel/CSV)
</details>

<details>
<summary><b>Roles / RBAC</b> — <code>/api/v1/roles</code></summary>

`GET /permissions` (catalog) · `GET /` · `POST /` · `GET/PUT/DELETE /:id`
</details>

<details>
<summary><b>Audit</b> — <code>/api/v1/audit-logs</code></summary>

`GET /` (filter by action/entity/actor/date range) · `GET /:id`
</details>

---

## Module roadmap

Core (done): **Auth · Users · RBAC · Audit · Organization schema**.

Remaining modules are added one complete vertical slice at a time (schema → repository → service → controller → routes → validators → Swagger), reusing `BaseRepository`, the RBAC/audit/validation middleware, and the response/error envelopes:

3. Employee (profile, documents, bank, assets, exit) · 4. Organization (company/branch/dept/designation CRUD) · 5. Recruitment (ATS) · 6. Onboarding · 7. Attendance · 8. Leave · 9. Payroll · 10. Performance · 11. Learning · 12. Engagement · 13. Assets · 14. Expenses · 15. Help Desk · 16. Documents · 17. Notifications · 18. Workflow engine · 19. Reports · 20. Audit (✓ core) · 21. Calendar · 22. Exit · 23. Multi-company (✓ schema) · 24. Security (✓ core) · 25. Settings.

---

## Security

JWT (access + rotating refresh) · Argon2id password hashing · Redis token blacklist · account lockout · MFA (TOTP, encrypted secret) · Helmet · CORS allow-list · HPP · rate limiting · Zod input validation · Prisma (parameterized queries) · soft delete + immutable audit trail · secret redaction in logs.

## Tech stack

Node.js 20+ · Express · Prisma · PostgreSQL · Redis (ioredis) · BullMQ · Socket.io · Zod · Pino · Argon2 · JWT · Nodemailer · Multer · ExcelJS · PDFKit · Swagger/OpenAPI · Docker.
