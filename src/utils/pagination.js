/**
 * Parses common list query parameters into a normalized shape used by all
 * repositories. Supports page/limit pagination, multi-field sorting, and a
 * generic `search` term applied by each module to its searchable columns.
 *
 * Query examples:
 *   ?page=2&limit=20&sort=-createdAt,name&search=john
 */
const MAX_LIMIT = 100;

export function parsePagination(query = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  page = Number.isFinite(page) && page > 0 ? page : 1;
  limit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 20;

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/**
 * Parse `sort` into a Prisma `orderBy` array.
 * `-field` => desc, `field` => asc. Only whitelisted fields are honored.
 *
 * @param {string} sort
 * @param {string[]} allowed  Sortable field names
 * @param {object} fallback   Default orderBy
 */
export function parseSort(sort, allowed = [], fallback = { createdAt: 'desc' }) {
  if (!sort) return [fallback];
  const orderBy = [];
  for (const raw of String(sort).split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const desc = token.startsWith('-');
    const field = desc ? token.slice(1) : token;
    if (allowed.includes(field)) orderBy.push({ [field]: desc ? 'desc' : 'asc' });
  }
  return orderBy.length ? orderBy : [fallback];
}

/**
 * Builds the pagination meta block returned to clients.
 */
export function buildPaginationMeta({ page, limit }, total) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * OR-search across a set of string columns (case-insensitive contains).
 * @returns {object|undefined} Prisma `where` fragment or undefined when empty.
 */
export function buildSearch(search, fields = []) {
  const term = (search ?? '').toString().trim();
  if (!term || fields.length === 0) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) };
}

export default { parsePagination, parseSort, buildPaginationMeta, buildSearch };
