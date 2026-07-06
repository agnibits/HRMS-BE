import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { roleRepository } from './role.repository.js';
import { record, recordChange, AuditAction } from '../audit/audit.service.js';
import { PERMISSIONS, ALL_PERMISSIONS, WILDCARD, PLATFORM_PERMISSIONS } from '../../constants/permissions.js';

/**
 * Role & permission management. Roles are company-scoped (or global system
 * roles, companyId=null). Multi-tenant + privilege-escalation safe:
 *  - a tenant admin only sees/manages its own company's roles (plus read-only
 *    non-privileged global system roles);
 *  - NO tenant may create, grant, or assign a role carrying platform-level
 *    permissions (`*` or platform:manage) — e.g. SUPER_ADMIN — so a company
 *    admin can never escalate to platform owner via the API.
 * Only the platform SUPER_ADMIN spans companies and wields these.
 */
const PRIVILEGED = new Set([WILDCARD, ...PLATFORM_PERMISSIONS]);
const isPrivilegedRole = (role) => (role?.permissions ?? []).some((p) => PRIVILEGED.has(p));

class RoleService {
  /** The full permission catalog, grouped by resource, for admin UIs. */
  catalog() {
    const grouped = {};
    for (const [key, value] of Object.entries(PERMISSIONS)) {
      const [resource, action] = value.split(':');
      (grouped[resource] ??= []).push({ key, permission: value, action });
    }
    return { wildcard: WILDCARD, total: ALL_PERMISSIONS.length, groups: grouped };
  }

  async list(query, ctx) {
    let where;
    if (ctx.isSuperAdmin) {
      where = query.companyId ? { companyId: query.companyId } : {};
    } else {
      // Own company roles + global system roles, but NEVER platform-privileged
      // roles (SUPER_ADMIN) — hidden from tenants at the API level.
      where = {
        OR: [{ companyId: ctx.companyId ?? undefined }, { companyId: null }],
        NOT: { permissions: { hasSome: [...PRIVILEGED] } },
      };
    }
    const { items, pagination } = await roleRepository.paginate(query, where);
    return { items, pagination };
  }

  async getById(id, ctx) {
    const role = await roleRepository.findById(id, { include: { _count: { select: { users: true } } } });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    if (!ctx.isSuperAdmin) {
      // Tenants may read own roles + non-privileged global roles only.
      const outOfScope = role.companyId !== ctx.companyId && role.companyId !== null;
      if (outOfScope || isPrivilegedRole(role)) {
        throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
      }
    }
    return role;
  }

  async create(data, ctx) {
    this.#assertGrantable(data.permissions, ctx);
    const targetCompany = ctx.isSuperAdmin ? (data.companyId ?? ctx.companyId ?? null) : ctx.companyId;
    const dup = await prisma.role.findFirst({
      where: { name: data.name, companyId: targetCompany, deletedAt: null },
    });
    if (dup) throw ApiError.conflict('A role with this name already exists', { code: 'ROLE_NAME_TAKEN' });

    const role = await roleRepository.create({
      name: data.name,
      description: data.description,
      companyId: targetCompany,
      permissions: [...new Set(data.permissions)],
      isSystem: false,
      createdById: ctx.actorId,
    });
    await record({ action: AuditAction.CREATE, entity: 'role', entityId: role.id, after: role, actorId: ctx.actorId });
    return role;
  }

  async update(id, data, ctx) {
    const before = await roleRepository.findById(id);
    if (!before) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    this.#assertWritable(before, ctx);
    if (before.isSystem) throw ApiError.forbidden('System roles cannot be modified', { code: 'SYSTEM_ROLE' });
    if (data.permissions) this.#assertGrantable(data.permissions, ctx);

    const patch = { ...data, updatedById: ctx.actorId };
    if (data.permissions) patch.permissions = [...new Set(data.permissions)];
    if (!ctx.isSuperAdmin) delete patch.companyId; // never reassign a role's tenant

    const after = await roleRepository.update(id, patch);
    await recordChange({ action: AuditAction.UPDATE, entity: 'role', entityId: id, before, after, actorId: ctx.actorId });
    return after;
  }

  async remove(id, ctx) {
    const role = await prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    this.#assertWritable(role, ctx);
    if (role.isSystem) throw ApiError.forbidden('System roles cannot be deleted', { code: 'SYSTEM_ROLE' });
    if (role._count.users > 0) {
      throw ApiError.conflict('Role is assigned to users and cannot be deleted', {
        code: 'ROLE_IN_USE',
        details: { assignedUsers: role._count.users },
      });
    }
    await roleRepository.remove(id, { actorId: ctx.actorId });
    await record({ action: AuditAction.DELETE, entity: 'role', entityId: id, actorId: ctx.actorId });
  }

  /**
   * Guard used before assigning roles to a user (called by the user module):
   * a non-super-admin may never assign a platform-privileged role (SUPER_ADMIN).
   */
  async assertAssignable(roleIds, ctx) {
    if (ctx.isSuperAdmin || !roleIds?.length) return;
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true, permissions: true },
    });
    const privileged = roles.filter(isPrivilegedRole);
    if (privileged.length) {
      throw ApiError.forbidden('You cannot assign platform-level roles such as SUPER_ADMIN', {
        code: 'FORBIDDEN_ROLE_ASSIGNMENT',
        details: { roles: privileged.map((r) => r.name) },
      });
    }
  }

  // ── Private ─────────────────────────────────────────────────────────
  /** A tenant may only grant permissions it is allowed to — never `*`/platform. */
  #assertGrantable(permissions, ctx) {
    if (ctx.isSuperAdmin) return;
    const bad = [...new Set(permissions ?? [])].filter((p) => PRIVILEGED.has(p));
    if (bad.length) {
      throw ApiError.forbidden(`You cannot grant platform-level permissions: ${bad.join(', ')}`, {
        code: 'FORBIDDEN_PERMISSION',
        details: { forbidden: bad },
      });
    }
  }

  /** A tenant may only mutate roles belonging to its own company. */
  #assertWritable(role, ctx) {
    if (ctx.isSuperAdmin) return;
    if (role.companyId !== ctx.companyId || isPrivilegedRole(role)) {
      throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    }
  }
}

export const roleService = new RoleService();
export default roleService;
