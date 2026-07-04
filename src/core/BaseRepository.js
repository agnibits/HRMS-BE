import { prisma } from '../config/prisma.js';
import {
  parsePagination,
  parseSort,
  buildPaginationMeta,
  buildSearch,
} from '../utils/pagination.js';

/**
 * Generic repository providing pagination, sorting, searching, filtering and
 * soft-delete-aware CRUD on top of any Prisma model. Concrete repositories
 * extend this and declare their searchable/sortable fields, keeping data-access
 * logic DRY and consistent across all 25 modules.
 *
 * @example
 *   class UserRepository extends BaseRepository {
 *     constructor() {
 *       super('user', { searchFields: ['email','firstName'], sortFields: ['createdAt','email'] });
 *     }
 *   }
 */
export class BaseRepository {
  /**
   * @param {string} model  Prisma model delegate name (e.g. 'user').
   * @param {object} opts
   * @param {string[]} [opts.searchFields]  Columns included in `?search=`.
   * @param {string[]} [opts.sortFields]    Whitelisted `?sort=` columns.
   * @param {boolean}  [opts.softDelete=true] Whether the model has `deletedAt`.
   * @param {object}   [opts.defaultSort]    Default orderBy.
   */
  constructor(model, { searchFields = [], sortFields = [], softDelete = true, defaultSort } = {}) {
    this.model = model;
    this.delegate = prisma[model];
    if (!this.delegate) throw new Error(`Unknown Prisma model: ${model}`);
    this.searchFields = searchFields;
    this.sortFields = sortFields.length ? sortFields : ['createdAt'];
    this.softDelete = softDelete;
    this.defaultSort = defaultSort ?? { createdAt: 'desc' };
  }

  /** Merges the soft-delete filter (exclude trashed rows unless asked). */
  _scope(where = {}, { withDeleted = false } = {}) {
    if (this.softDelete && !withDeleted) return { ...where, deletedAt: null };
    return where;
  }

  /** Allow callers to run inside a transaction by swapping the delegate. */
  _client(tx) {
    return tx ? tx[this.model] : this.delegate;
  }

  async create(data, { tx, ...opts } = {}) {
    return this._client(tx).create({ data, ...opts });
  }

  async createMany(data, { tx, skipDuplicates = false } = {}) {
    return this._client(tx).createMany({ data, skipDuplicates });
  }

  async findById(id, { withDeleted = false, tx, ...opts } = {}) {
    return this._client(tx).findFirst({ where: this._scope({ id }, { withDeleted }), ...opts });
  }

  async findOne(where, { withDeleted = false, tx, ...opts } = {}) {
    return this._client(tx).findFirst({ where: this._scope(where, { withDeleted }), ...opts });
  }

  async findMany(where = {}, { withDeleted = false, tx, ...opts } = {}) {
    return this._client(tx).findMany({ where: this._scope(where, { withDeleted }), ...opts });
  }

  async update(id, data, { tx, ...opts } = {}) {
    return this._client(tx).update({ where: { id }, data, ...opts });
  }

  async updateMany(where, data, { tx } = {}) {
    return this._client(tx).updateMany({ where: this._scope(where), data });
  }

  /** Soft delete when supported, otherwise a hard delete. */
  async remove(id, { tx, actorId } = {}) {
    if (this.softDelete) {
      return this._client(tx).update({
        where: { id },
        data: { deletedAt: new Date(), ...(actorId ? { deletedById: actorId } : {}) },
      });
    }
    return this._client(tx).delete({ where: { id } });
  }

  async restore(id, { tx } = {}) {
    if (!this.softDelete) throw new Error(`${this.model} does not support restore`);
    return this._client(tx).update({ where: { id }, data: { deletedAt: null, deletedById: null } });
  }

  async hardDelete(id, { tx } = {}) {
    return this._client(tx).delete({ where: { id } });
  }

  async count(where = {}, { withDeleted = false } = {}) {
    return this.delegate.count({ where: this._scope(where, { withDeleted }) });
  }

  /**
   * List with pagination + sorting + search + arbitrary `where` filters.
   * @param {object} query  Raw request query (page, limit, sort, search).
   * @param {object} where  Additional Prisma where filters (e.g. companyId).
   * @param {object} opts   { include, select, withDeleted }
   */
  async paginate(query = {}, where = {}, { include, select, withDeleted = false } = {}) {
    const pagination = parsePagination(query);
    const orderBy = parseSort(query.sort, this.sortFields, this.defaultSort);
    const search = buildSearch(query.search, this.searchFields);

    const finalWhere = this._scope({ ...where, ...(search ?? {}) }, { withDeleted });

    const [items, total] = await Promise.all([
      this.delegate.findMany({
        where: finalWhere,
        orderBy,
        skip: pagination.skip,
        take: pagination.take,
        ...(include ? { include } : {}),
        ...(select ? { select } : {}),
      }),
      this.delegate.count({ where: finalWhere }),
    ]);

    return { items, pagination: buildPaginationMeta(pagination, total) };
  }

  /** Run a callback inside a Prisma transaction. */
  transaction(fn) {
    return prisma.$transaction(fn);
  }
}

export default BaseRepository;
