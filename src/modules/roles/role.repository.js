import { BaseRepository } from '../../core/BaseRepository.js';

/** Data access for roles. */
class RoleRepository extends BaseRepository {
  constructor() {
    super('role', {
      searchFields: ['name', 'description'],
      sortFields: ['createdAt', 'updatedAt', 'name'],
      softDelete: true,
    });
  }
}

export const roleRepository = new RoleRepository();
export default roleRepository;
