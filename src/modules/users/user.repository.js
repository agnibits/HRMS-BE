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

  /**
   * Find a user by email. Email is unique per company, so when `companyId` is
   * given the lookup is exact; without it, returns the first match (use
   * findAllByEmail for the multi-tenant login flow).
   */
  findByEmail(email, companyId, opts = {}) {
    const where = { email: email.toLowerCase(), deletedAt: null };
    if (companyId !== undefined) where.companyId = companyId;
    return this.delegate.findFirst({ where, ...opts });
  }

  /** All (non-deleted) users sharing this email across companies. */
  findAllByEmail(email) {
    return this.delegate.findMany({ where: { email: email.toLowerCase(), deletedAt: null } });
  }

  #withPermissions(user) {
    if (!user) return null;
    const roleNames = user.roles.map((ur) => ur.role.name);
    const permissions = new Set(user.extraPermissions ?? []);
    for (const ur of user.roles) for (const p of ur.role.permissions) permissions.add(p);
    // Expand the wildcard (SUPER_ADMIN) into explicit permission strings.
    return { ...user, roleNames, permissionList: expandPermissions(permissions) };
  }

  #permInclude = {
    roles: { include: { role: true } },
    company: { select: { id: true, name: true, status: true, logoUrl: true } },
  };

  /** User with roles + flattened permission set (roles + per-user overrides). */
  async findWithPermissions(where) {
    const user = await this.delegate.findFirst({ where: { ...where, deletedAt: null }, include: this.#permInclude });
    return this.#withPermissions(user);
  }

  findByIdWithPermissions(id) {
    return this.findWithPermissions({ id });
  }

  findByEmailWithPermissions(email, companyId) {
    const where = { email: email.toLowerCase() };
    if (companyId !== undefined) where.companyId = companyId;
    return this.findWithPermissions(where);
  }

  /** All users (with permissions) sharing an email — for multi-tenant login. */
  async findAllByEmailWithPermissions(email) {
    const users = await this.delegate.findMany({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: this.#permInclude,
    });
    return users.map((u) => this.#withPermissions(u));
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
