import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, randomToken } from '../../utils/password.js';
import { userRepository } from './user.repository.js';
import { enqueueEmail } from '../../queues/index.js';
import { templates } from '../../notifications/mail.service.js';
import { recordChange, record, AuditAction } from '../audit/audit.service.js';
import { buildWorkbookBuffer, parseSheet } from '../../utils/excel.js';
import { createUserSchema } from './user.validators.js';
import { tenantWhere } from '../../utils/tenant.js';
import { roleService } from '../roles/role.service.js';
import { resolveUser } from '../hr/helpers.js';

const PUBLIC_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  status: true,
  companyId: true,
  // HR profile
  employeeId: true,
  department: true,
  designation: true,
  managerId: true,
  managerName: true,
  joiningDate: true,
  employmentType: true,
  emailVerifiedAt: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: { include: { role: { select: { id: true, name: true } } } },
};

/**
 * User management business logic (admin-facing). Multi-tenant: every operation
 * is confined to the caller's company (`ctx.companyId`); only the platform
 * SUPER_ADMIN (`ctx.isSuperAdmin`) may span companies. `ctx` is built from the
 * authenticated user via utils/tenant.js.
 */
class UserService {
  #shape(user) {
    if (!user) return user;
    const { roles, ...rest } = user;
    return { ...rest, roles: (roles ?? []).map((ur) => ur.role) };
  }

  /** Resolve the company a write should target (tenant users are forced to own). */
  #targetCompany(ctx, requested) {
    return ctx.isSuperAdmin ? (requested ?? ctx.companyId ?? null) : ctx.companyId;
  }

  /**
   * Translate the HR profile fields from a request body into DB columns.
   * `manager` (id or email) is denormalized into managerId + managerName; only
   * keys present in the body are touched, so PATCH-style updates stay partial.
   */
  async #hrPatch(data, companyId, { generateEmployeeId = false } = {}) {
    const patch = {};
    for (const key of ['department', 'designation', 'joiningDate', 'employmentType']) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.manager !== undefined) {
      if (!data.manager) {
        patch.managerId = null;
        patch.managerName = null;
      } else {
        const m = await resolveUser(data.manager);
        patch.managerId = m.id;
        patch.managerName = m.name;
      }
    }
    if (data.employeeId) patch.employeeId = data.employeeId;
    else if (generateEmployeeId) patch.employeeId = await this.#nextEmployeeId(companyId);
    else if (data.employeeId === null) patch.employeeId = null;
    return patch;
  }

  /** Next human-readable employee code for a company, e.g. EMP-001. */
  async #nextEmployeeId(companyId) {
    if (!companyId) return null;
    const rows = await prisma.user.findMany({
      where: { companyId, employeeId: { not: null } },
      select: { employeeId: true },
    });
    const max = rows.reduce((acc, r) => {
      const n = parseInt(String(r.employeeId).replace(/\D/g, ''), 10);
      return Number.isFinite(n) && n > acc ? n : acc;
    }, 0);
    return `EMP-${String(max + 1).padStart(3, '0')}`;
  }

  async list(query, ctx) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.roleId) where.roles = { some: { roleId: query.roleId } };
    // Super admin may optionally filter by company; tenants are locked to theirs.
    if (ctx.isSuperAdmin) {
      if (query.companyId) where.companyId = query.companyId;
    } else {
      where.companyId = ctx.companyId;
    }
    const { items, pagination } = await userRepository.paginate(query, where, { select: PUBLIC_SELECT });
    return { items: items.map((u) => this.#shape(u)), pagination };
  }

  async getById(id, ctx) {
    const user = await prisma.user.findFirst({
      where: tenantWhere(ctx, { id, deletedAt: null }),
      select: PUBLIC_SELECT,
    });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    return this.#shape(user);
  }

  async create(data, ctx) {
    const existing = await userRepository.findByEmail(data.email);
    if (existing) throw ApiError.conflict('A user with this email already exists', { code: 'EMAIL_TAKEN' });

    const companyId = this.#targetCompany(ctx, data.companyId);
    if (data.roleIds?.length) {
      await this.#assertRolesExist(data.roleIds, companyId);
      await roleService.assertAssignable(data.roleIds, ctx); // block SUPER_ADMIN/platform roles for tenants
    }

    const tempPassword = data.password ?? this.#generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const hr = await this.#hrPatch(data, companyId, { generateEmployeeId: true });

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          companyId,
          status: data.status ?? 'PENDING',
          passwordHash,
          extraPermissions: [],
          createdById: ctx.actorId,
          ...hr,
        },
      });
      if (data.roleIds?.length) {
        await tx.userRole.createMany({
          data: data.roleIds.map((roleId) => ({ userId: created.id, roleId, assignedById: ctx.actorId })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await record({ action: AuditAction.CREATE, entity: 'user', entityId: user.id, after: { email: user.email }, actorId: ctx.actorId });

    if (data.sendWelcomeEmail) {
      const tpl = templates.welcome({ name: user.firstName, email: user.email, tempPassword });
      await enqueueEmail({ to: user.email, ...tpl });
    }
    return this.getById(user.id, ctx);
  }

  async update(id, data, ctx) {
    const before = await prisma.user.findFirst({ where: tenantWhere(ctx, { id, deletedAt: null }) });
    if (!before) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });

    // Strip the request-only HR aliases; #hrPatch maps them to real columns.
    const { manager, employeeId, department, designation, joiningDate, employmentType, ...rest } = data;
    const patch = {
      ...rest,
      ...(await this.#hrPatch(data, before.companyId)),
      updatedById: ctx.actorId,
    };
    // Tenant admins can never move a user to another company.
    if (!ctx.isSuperAdmin) delete patch.companyId;

    const after = await prisma.user.update({ where: { id }, data: patch });
    await recordChange({ action: AuditAction.UPDATE, entity: 'user', entityId: id, before, after, actorId: ctx.actorId });
    return this.getById(id, ctx);
  }

  /** Self-service profile update (audited so it shows in the Activity tab). */
  async updateProfile(id, data) {
    const before = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    const after = await prisma.user.update({ where: { id }, data });
    await recordChange({
      action: AuditAction.PROFILE_UPDATED,
      entity: 'user',
      entityId: id,
      before,
      after,
      actorId: id,
    });
    return prisma.user.findFirst({ where: { id }, select: PUBLIC_SELECT }).then((u) => this.#shape(u));
  }

  async remove(id, ctx) {
    const user = await prisma.user.findFirst({ where: tenantWhere(ctx, { id, deletedAt: null }) });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    if (id === ctx.actorId) throw ApiError.badRequest('You cannot delete your own account', { code: 'SELF_DELETE' });

    await userRepository.remove(id, { actorId: ctx.actorId });
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'user_deleted' },
    });
    await record({ action: AuditAction.DELETE, entity: 'user', entityId: id, actorId: ctx.actorId });
  }

  async restore(id, ctx) {
    const user = await prisma.user.findFirst({ where: tenantWhere(ctx, { id, deletedAt: { not: null } }) });
    if (!user) throw ApiError.notFound('Deleted user not found', { code: 'USER_NOT_FOUND' });
    await userRepository.restore(id);
    await record({ action: AuditAction.RESTORE, entity: 'user', entityId: id, actorId: ctx.actorId });
    return this.getById(id, ctx);
  }

  async assignRoles(id, roleIds, ctx) {
    const user = await prisma.user.findFirst({ where: tenantWhere(ctx, { id, deletedAt: null }) });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    await this.#assertRolesExist(roleIds, user.companyId);
    await roleService.assertAssignable(roleIds, ctx); // block SUPER_ADMIN/platform roles for tenants

    const [prevRoles, nextRoles] = await Promise.all([
      prisma.userRole.findMany({ where: { userId: id }, select: { role: { select: { name: true } } } }),
      prisma.role.findMany({ where: { id: { in: roleIds } }, select: { name: true } }),
    ]);
    await userRepository.setRoles(id, roleIds, ctx.actorId);
    await record({
      action: AuditAction.ROLE_CHANGED,
      entity: 'user',
      entityId: id,
      metadata: {
        roleIds,
        from: prevRoles.map((r) => r.role.name),
        to: nextRoles.map((r) => r.name),
      },
      actorId: ctx.actorId,
    });
    return this.getById(id, ctx);
  }

  /**
   * Re-invite a user: issues a fresh temporary password, revokes existing
   * sessions and re-sends the welcome email. Returns the password so an admin
   * can relay it directly (useful when SMTP delivery is unavailable).
   */
  async resendInvite(id, ctx) {
    const user = await prisma.user.findFirst({ where: tenantWhere(ctx, { id, deletedAt: null }) });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });

    const tempPassword = this.#generateTempPassword();
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(tempPassword), passwordChangedAt: new Date() },
    });
    // Old credentials must stop working immediately.
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'invite_resent' },
    });

    const tpl = templates.welcome({ name: user.firstName, email: user.email, tempPassword });
    await enqueueEmail({ to: user.email, ...tpl });

    await record({ action: AuditAction.INVITE_RESENT, entity: 'user', entityId: id, actorId: ctx.actorId });
    return { email: user.email, tempPassword, emailQueued: true };
  }

  // ── Bulk export ────────────────────────────────────────────────────
  async exportToExcel(query, ctx) {
    const where = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (ctx.isSuperAdmin) {
      if (query.companyId) where.companyId = query.companyId;
    } else {
      where.companyId = ctx.companyId;
    }

    const users = await prisma.user.findMany({
      where,
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const columns = [
      { header: 'Employee ID', key: 'employeeId', width: 14 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'First Name', key: 'firstName', width: 18 },
      { header: 'Last Name', key: 'lastName', width: 18 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Designation', key: 'designation', width: 20 },
      { header: 'Manager', key: 'managerName', width: 20 },
      { header: 'Employment Type', key: 'employmentType', width: 16 },
      { header: 'Joining Date', key: 'joiningDate', width: 14 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Roles', key: 'roles', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    const rows = users.map((u) => ({
      employeeId: u.employeeId ?? '',
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone ?? '',
      department: u.department ?? '',
      designation: u.designation ?? '',
      managerName: u.managerName ?? '',
      employmentType: u.employmentType ?? '',
      joiningDate: u.joiningDate ? u.joiningDate.toISOString().slice(0, 10) : '',
      status: u.status,
      roles: u.roles.map((r) => r.role.name).join(', '),
      createdAt: u.createdAt.toISOString(),
    }));
    return buildWorkbookBuffer({ sheetName: 'Users', columns, rows });
  }

  // ── Bulk import (always scoped to the caller's company) ─────────────
  async importFromFile(file, ctx) {
    if (!file) throw ApiError.badRequest('No file uploaded', { code: 'NO_FILE' });
    const rows = await parseSheet(file.buffer, { mimetype: file.mimetype });
    if (!rows.length) throw ApiError.badRequest('The uploaded file has no data rows', { code: 'EMPTY_FILE' });

    const companyId = ctx.companyId;
    const results = { total: rows.length, created: 0, skipped: 0, errors: [] };

    for (const raw of rows) {
      try {
        const candidate = {
          email: String(raw.Email ?? raw.email ?? '').trim().toLowerCase(),
          firstName: String(raw['First Name'] ?? raw.firstName ?? '').trim(),
          lastName: String(raw['Last Name'] ?? raw.lastName ?? '').trim(),
          phone: raw.Phone ?? raw.phone ?? undefined,
          companyId,
          roleIds: [],
          sendWelcomeEmail: false,
        };
        const parsed = createUserSchema.parse(candidate);
        const exists = await userRepository.findByEmail(parsed.email);
        if (exists) {
          results.skipped += 1;
          continue;
        }
        await this.create(parsed, ctx);
        results.created += 1;
      } catch (err) {
        results.errors.push({ row: raw.__row, message: err.message?.slice(0, 300) });
      }
    }
    await record({ action: 'IMPORT', entity: 'user', metadata: results, actorId: ctx.actorId });
    return results;
  }

  // ── Private ─────────────────────────────────────────────────────────
  async #assertRolesExist(roleIds, companyId) {
    const count = await prisma.role.count({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ companyId: null }, { companyId: companyId ?? undefined }],
      },
    });
    if (count !== new Set(roleIds).size) {
      throw ApiError.badRequest('One or more roles are invalid for this company', { code: 'INVALID_ROLE' });
    }
  }

  #generateTempPassword() {
    return `Hr!${randomToken(6)}9A`;
  }
}

export const userService = new UserService();
export default userService;
