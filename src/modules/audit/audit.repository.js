import { BaseRepository } from '../../core/BaseRepository.js';

/** Read model for audit logs (append-only; no soft delete). */
class AuditRepository extends BaseRepository {
  constructor() {
    super('auditLog', {
      searchFields: ['entity', 'action', 'entityId'],
      sortFields: ['createdAt', 'action', 'entity'],
      softDelete: false,
      defaultSort: { createdAt: 'desc' },
    });
  }
}

export const auditRepository = new AuditRepository();
export default auditRepository;
