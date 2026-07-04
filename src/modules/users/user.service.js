import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, randomToken } from '../../utils/password.js';
import { userRepository } from './user.repository.js';
import { enqueueEmail } from '../../queues/index.js';
import { templates } from '../../notifications/mail.service.js';
import { recordChange, record, AuditAction } from '../audit/audit.service.js';
import { buildWorkbookBuffer, parseSheet } from '../../utils/excel.js';
import { createUserSchema } from './user.validators.js';

const PUBLIC_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  status: true,
  companyId: true,
  emailVerifiedAt: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: { include: { role: { select: { id: true, name: true } } } },
};

/**
 * User management business logic (admin-facing). Enforces uniqueness, hashes
 * credentials, manages role assignment, writes audit trails, and powers bulk
 * import/export.
 */
class UserService {
  #shape(user) {
    if (!user) return user;
    const { roles, ...rest } = user;
    return { ...rest, roles: (roles ?? []).map((ur) => ur.role) };
  }

  async list(query) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;
    if (query.roleId) where.roles = { some: { roleId: query.roleId } };

    const { items, pagination } = await userRepository.paginate(query, where, { select: PUBLIC_SELECT });
    return { items: items.map((u) => this.#shape(u)), pagination };
  }

  async getById(id) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: PUBLIC_SELECT });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    return this.#shape(user);
  }

  async create(data, actorId) {
    const existing = await userRepository.findByEmail(data.email);
    if (existing) throw ApiError.conflict('A user with this email already exists', { code: 'EMAIL_TAKEN' });

    if (data.roleIds?.length) await this.#assertRolesExist(data.roleIds, data.companyId);

    const tempPassword = data.password ?? this.#generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          companyId: data.companyId ?? null,
          status: data.status ?? 'PENDING',
          passwordHash,
          extraPermissions: [],
          createdById: actorId,
        },
      });
      if (data.roleIds?.length) {
        await tx.userRole.createMany({
          data: data.roleIds.map((roleId) => ({ userId: created.id, roleId, assignedById: actorId })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await record({ action: AuditAction.CREATE, entity: 'user', entityId: user.id, after: { email: user.email }, actorId });

    if (data.sendWelcomeEmail) {
      const tpl = templates.welcome({ name: user.firstName, email: user.email, tempPassword });
      await enqueueEmail({ to: user.email, ...tpl });
    }
    return this.getById(user.id);
  }

  async update(id, data, actorId) {
    const before = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });

    const after = await prisma.user.update({
      where: { id },
      data: { ...data, updatedById: actorId },
    });
    await recordChange({ action: AuditAction.UPDATE, entity: 'user', entityId: id, before, after, actorId });
    return this.getById(id);
  }

  async updateProfile(id, data) {
    await prisma.user.update({ where: { id }, data });
    return this.getById(id);
  }

  async remove(id, actorId) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    if (id === actorId) throw ApiError.badRequest('You cannot delete your own account', { code: 'SELF_DELETE' });

    await userRepository.remove(id, { actorId });
    // Revoke all sessions of the deleted user.
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'user_deleted' },
    });
    await record({ action: AuditAction.DELETE, entity: 'user', entityId: id, actorId });
  }

  async restore(id, actorId) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!user) throw ApiError.notFound('Deleted user not found', { code: 'USER_NOT_FOUND' });
    await userRepository.restore(id);
    await record({ action: AuditAction.RESTORE, entity: 'user', entityId: id, actorId });
    return this.getById(id);
  }

  async assignRoles(id, roleIds, actorId) {
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
    await this.#assertRolesExist(roleIds, user.companyId);
    await userRepository.setRoles(id, roleIds, actorId);
    await record({ action: AuditAction.UPDATE, entity: 'user', entityId: id, metadata: { roleIds }, actorId });
    return this.getById(id);
  }

  // ── Bulk export ────────────────────────────────────────────────────
  async exportToExcel(query) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;

    const users = await prisma.user.findMany({
      where: { ...where, deletedAt: null },
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const columns = [
      { header: 'Email', key: 'email', width: 30 },
      { header: 'First Name', key: 'firstName', width: 18 },
      { header: 'Last Name', key: 'lastName', width: 18 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Roles', key: 'roles', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 22 },
    ];
    const rows = users.map((u) => ({
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone ?? '',
      status: u.status,
      roles: u.roles.map((r) => r.role.name).join(', '),
      createdAt: u.createdAt.toISOString(),
    }));
    return buildWorkbookBuffer({ sheetName: 'Users', columns, rows });
  }

  // ── Bulk import ────────────────────────────────────────────────────
  async importFromFile(file, { companyId, actorId }) {
    if (!file) throw ApiError.badRequest('No file uploaded', { code: 'NO_FILE' });
    const rows = await parseSheet(file.buffer, { mimetype: file.mimetype });
    if (!rows.length) throw ApiError.badRequest('The uploaded file has no data rows', { code: 'EMPTY_FILE' });

    const results = { total: rows.length, created: 0, skipped: 0, errors: [] };

    for (const raw of rows) {
      try {
        const candidate = {
          email: String(raw.Email ?? raw.email ?? '').trim().toLowerCase(),
          firstName: String(raw['First Name'] ?? raw.firstName ?? '').trim(),
          lastName: String(raw['Last Name'] ?? raw.lastName ?? '').trim(),
          phone: raw.Phone ?? raw.phone ?? undefined,
          companyId: companyId ?? raw.companyId ?? undefined,
          roleIds: [],
          sendWelcomeEmail: false,
        };
        const parsed = createUserSchema.parse(candidate);
        const exists = await userRepository.findByEmail(parsed.email);
        if (exists) {
          results.skipped += 1;
          continue;
        }
        await this.create(parsed, actorId);
        results.created += 1;
      } catch (err) {
        results.errors.push({ row: raw.__row, message: err.message?.slice(0, 300) });
      }
    }
    await record({ action: 'IMPORT', entity: 'user', metadata: results, actorId });
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
    // Meets the strong-password policy: upper, lower, number, symbol.
    return `Hr!${randomToken(6)}9A`;
  }
}

export const userService = new UserService();
export default userService;
