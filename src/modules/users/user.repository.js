import { BaseRepository } from '../../core/BaseRepository.js';
import { prisma } from '../../config/prisma.js';
import { expandPermissions } from '../../constants/permissions.js';

/**
 * Data access for users. Extends the generic repository and adds identity
 * lookups plus role-aware fetching used by both the Auth and User modules.
 */
class UserRepository extends BaseRepository {
  constructor() {
    super('user', {
      searchFields: ['email', 'firstName', 'lastName', 'phone'],
      sortFields: ['createdAt', 'updatedAt', 'email', 'firstName', 'lastName', 'status', 'lastLoginAt'],
      softDelete: true,
    });
  }

  findByEmail(email, opts = {}) {
    return this.delegate.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      ...opts,
    });
  }

  /** User with roles + flattened permission set (roles + per-user overrides). */
  async findWithPermissions(where) {
    const user = await this.delegate.findFirst({
      where: { ...where, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!user) return null;

    const roleNames = user.roles.map((ur) => ur.role.name);
    const permissions = new Set(user.extraPermissions ?? []);
    for (const ur of user.roles) for (const p of ur.role.permissions) permissions.add(p);

    // Expand the wildcard (SUPER_ADMIN) into explicit permission strings so
    // front-end guards checking concrete permissions also succeed.
    return { ...user, roleNames, permissionList: expandPermissions(permissions) };
  }

  findByIdWithPermissions(id) {
    return this.findWithPermissions({ id });
  }

  findByEmailWithPermissions(email) {
    return this.findWithPermissions({ email: email.toLowerCase() });
  }

  /** Replace a user's role assignments transactionally. */
  async setRoles(userId, roleIds, assignedById) {
    return prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (roleIds.length) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId, roleId, assignedById })),
          skipDuplicates: true,
        });
      }
      return tx.userRole.findMany({ where: { userId }, include: { role: true } });
    });
  }
}

export const userRepository = new UserRepository();
export default userRepository;
