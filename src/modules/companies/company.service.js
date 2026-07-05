import { nanoid } from 'nanoid';
import { prisma } from '../../config/prisma.js';
import { redis } from '../../config/redis.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, randomToken } from '../../utils/password.js';
import {
  parsePagination,
  parseSort,
  buildSearch,
  buildPaginationMeta,
} from '../../utils/pagination.js';
import { record, recordChange, AuditAction } from '../audit/audit.service.js';

/**
 * Company (tenant) provisioning + lifecycle — used by the Agnibits platform
 * SUPER_ADMIN. Also exposes the tenant-scoped "own company" settings used by
 * the HRMS product. Suspending a company sets a Redis flag (checked by the auth
 * middleware for instant enforcement) and revokes all its users' sessions.
 */
const SUSPEND_KEY = (companyId) => `company:suspended:${companyId}`;
const SORT_FIELDS = ['createdAt', 'name', 'plan', 'status'];
const SEARCH_FIELDS = ['name', 'adminEmail', 'code'];

const shapeCompany = (c) => ({
  id: c.id,
  name: c.name,
  plan: c.plan,
  status: c.status,
  adminEmail: c.adminEmail,
  employeeCount: c._count?.users ?? c.employeeCount ?? 0,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

async function setSuspendState(companyId, suspended) {
  try {
    if (suspended) await redis.set(SUSPEND_KEY(companyId), '1');
    else await redis.del(SUSPEND_KEY(companyId));
  } catch {
    /* redis optional — login/refresh still enforce via DB */
  }
}

async function revokeCompanySessions(companyId, reason) {
  await prisma.session.updateMany({
    where: { user: { companyId }, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

async function uniqueCompanyCode(name) {
  const base = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'CO';
  for (let i = 0; i < 5; i += 1) {
    const code = `${base}${nanoid(4).toUpperCase()}`;
    const exists = await prisma.company.findUnique({ where: { code } });
    if (!exists) return code;
  }
  return `CO${nanoid(8).toUpperCase()}`;
}

export const companyService = {
  // ── Platform (SUPER_ADMIN) ────────────────────────────────────────────
  async listAll(query) {
    const pagination = parsePagination(query);
    const orderBy = parseSort(query.sort, SORT_FIELDS, { createdAt: 'desc' });
    const search = buildSearch(query.search, SEARCH_FIELDS);
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.plan) where.plan = query.plan;
    if (search) Object.assign(where, search);

    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        include: { _count: { select: { users: { where: { deletedAt: null } } } } },
      }),
      prisma.company.count({ where }),
    ]);
    return { items: items.map(shapeCompany), pagination: buildPaginationMeta(pagination, total) };
  },

  async getById(id) {
    const c = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    if (!c) throw ApiError.notFound('Company not found', { code: 'COMPANY_NOT_FOUND' });
    return shapeCompany(c);
  },

  /** Provision a new tenant: company + its first ADMIN user (email pre-verified). */
  async provision({ name, plan = 'FREE', admin }, actorId) {
    const dupName = await prisma.company.findFirst({ where: { name, deletedAt: null } });
    if (dupName) throw ApiError.conflict('A company with this name already exists', { code: 'COMPANY_NAME_TAKEN' });

    const email = admin.email.toLowerCase();
    const dupEmail = await prisma.user.findFirst({ where: { email } });
    if (dupEmail) throw ApiError.conflict('A user with this admin email already exists', { code: 'EMAIL_TAKEN' });

    const adminRole = await prisma.role.findFirst({ where: { name: 'ADMIN', companyId: null } });
    if (!adminRole) throw ApiError.internal('ADMIN system role missing — run the seed', { code: 'ROLE_MISSING' });

    const code = await uniqueCompanyCode(name);
    const passwordHash = await hashPassword(admin.password);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name, code, plan, status: 'ACTIVE', adminEmail: email, createdById: actorId },
      });
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          extraPermissions: [],
          createdById: actorId,
        },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: adminRole.id, assignedById: actorId } });
      return { company, user };
    });

    await record({ action: AuditAction.CREATE, entity: 'company', entityId: result.company.id, after: { name, plan }, actorId });
    return {
      company: { id: result.company.id, name: result.company.name, plan: result.company.plan, status: result.company.status },
      admin: { id: result.user.id, email: result.user.email, role: 'ADMIN' },
    };
  },

  /** Update a company (platform: name/plan/status). Handles suspend/activate side effects. */
  async platformUpdate(id, data, actorId) {
    const before = await prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw ApiError.notFound('Company not found', { code: 'COMPANY_NOT_FOUND' });

    if (data.name && data.name !== before.name) {
      const dup = await prisma.company.findFirst({ where: { name: data.name, deletedAt: null, id: { not: id } } });
      if (dup) throw ApiError.conflict('A company with this name already exists', { code: 'COMPANY_NAME_TAKEN' });
    }

    const after = await prisma.company.update({ where: { id }, data: { ...data, updatedById: actorId } });

    // Suspend/activate side effects
    if (data.status && data.status !== before.status) {
      if (data.status === 'SUSPENDED') {
        await setSuspendState(id, true);
        await revokeCompanySessions(id, 'company_suspended');
      } else {
        await setSuspendState(id, false);
      }
    }
    await recordChange({ action: AuditAction.UPDATE, entity: 'company', entityId: id, before, after, actorId });
    return this.getById(id);
  },

  async archive(id, actorId) {
    const company = await prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw ApiError.notFound('Company not found', { code: 'COMPANY_NOT_FOUND' });
    await prisma.company.update({ where: { id }, data: { deletedAt: new Date(), status: 'SUSPENDED', deletedById: actorId } });
    await setSuspendState(id, true);
    await revokeCompanySessions(id, 'company_archived');
    await record({ action: AuditAction.DELETE, entity: 'company', entityId: id, actorId });
  },

  /** Generate a fresh temporary password for the company's admin. */
  async resetAdmin(id, actorId) {
    const company = await prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw ApiError.notFound('Company not found', { code: 'COMPANY_NOT_FOUND' });

    const adminUser = company.adminEmail
      ? await prisma.user.findFirst({ where: { email: company.adminEmail, companyId: id, deletedAt: null } })
      : await prisma.user.findFirst({
          where: { companyId: id, deletedAt: null, roles: { some: { role: { name: 'ADMIN' } } } },
          orderBy: { createdAt: 'asc' },
        });
    if (!adminUser) throw ApiError.notFound('No admin user found for this company', { code: 'ADMIN_NOT_FOUND' });

    const tempPassword = `Hr!${randomToken(6)}9A`;
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { passwordHash: await hashPassword(tempPassword), passwordChangedAt: new Date() },
    });
    await revokeCompanySessions(id, 'admin_password_reset');
    await record({ action: AuditAction.PASSWORD_CHANGE, entity: 'company', entityId: id, metadata: { adminId: adminUser.id }, actorId });
    return { email: adminUser.email, tempPassword };
  },

  // ── Tenant-scoped ("own company" settings for the HRMS product) ────────
  async getOwn(companyId) {
    if (!companyId) throw ApiError.notFound('No company associated with this account', { code: 'NO_COMPANY' });
    const c = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
    if (!c) throw ApiError.notFound('Company not found', { code: 'COMPANY_NOT_FOUND' });
    return c;
  },

  async updateOwn(companyId, data, actorId) {
    const before = await this.getOwn(companyId);
    const after = await prisma.company.update({ where: { id: companyId }, data: { ...data, updatedById: actorId } });
    await recordChange({ action: AuditAction.UPDATE, entity: 'company', entityId: companyId, before, after, actorId });
    return after;
  },

  isSuspended: async (companyId) => {
    if (!companyId) return false;
    try {
      return (await redis.get(SUSPEND_KEY(companyId))) === '1';
    } catch {
      return false;
    }
  },
};

export default companyService;
