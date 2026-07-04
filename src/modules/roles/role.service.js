import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { roleRepository } from './role.repository.js';
import { record, recordChange, AuditAction } from '../audit/audit.service.js';
import { PERMISSIONS, ALL_PERMISSIONS, WILDCARD } from '../../constants/permissions.js';

/**
 * Role & permission management. Roles are company-scoped (or global system
 * roles). System roles are read-only to protect the built-in access model.
 */
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

  async list(query, companyId) {
    // Return company roles plus global system roles.
    const where = {
      OR: [{ companyId: query.companyId ?? companyId ?? undefined }, { companyId: null }],
    };
    const { items, pagination } = await roleRepository.paginate(query, where);
    return { items, pagination };
  }

  async getById(id) {
    const role = await roleRepository.findById(id, { include: { _count: { select: { users: true } } } });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    return role;
  }

  async create(data, { actorId, companyId }) {
    const targetCompany = data.companyId ?? companyId ?? null;
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
      createdById: actorId,
    });
    await record({ action: AuditAction.CREATE, entity: 'role', entityId: role.id, after: role, actorId });
    return role;
  }

  async update(id, data, actorId) {
    const before = await roleRepository.findById(id);
    if (!before) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    if (before.isSystem) throw ApiError.forbidden('System roles cannot be modified', { code: 'SYSTEM_ROLE' });

    const patch = { ...data, updatedById: actorId };
    if (data.permissions) patch.permissions = [...new Set(data.permissions)];

    const after = await roleRepository.update(id, patch);
    await recordChange({ action: AuditAction.UPDATE, entity: 'role', entityId: id, before, after, actorId });
    return after;
  }

  async remove(id, actorId) {
    const role = await prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw ApiError.notFound('Role not found', { code: 'ROLE_NOT_FOUND' });
    if (role.isSystem) throw ApiError.forbidden('System roles cannot be deleted', { code: 'SYSTEM_ROLE' });
    if (role._count.users > 0) {
      throw ApiError.conflict('Role is assigned to users and cannot be deleted', {
        code: 'ROLE_IN_USE',
        details: { assignedUsers: role._count.users },
      });
    }
    await roleRepository.remove(id, { actorId });
    await record({ action: AuditAction.DELETE, entity: 'role', entityId: id, actorId });
  }
}

export const roleService = new RoleService();
export default roleService;
