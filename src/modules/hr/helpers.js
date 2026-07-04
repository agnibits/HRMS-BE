import { z } from 'zod';
import { prisma } from '../../config/prisma.js';

/**
 * Shared building blocks for the generated HR CRUD modules: a common list-query
 * schema, coercion helpers, and denormalization resolvers that turn an id
 * (employee/requester/candidate/department) into a stored display value so
 * reads stay join-free and fast.
 */
export const listQuery = (extra = {}) =>
  z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sort: z.string().optional(),
    search: z.string().optional(),
    ...extra,
  });

export const isoDate = z.coerce.date();
export const optDate = z.coerce.date().nullable().optional();
export const nstr = z.string().trim().min(1);
export const ostr = z.string().trim().nullable().optional();

/** Resolve a user's display name (for denormalized employee/requester fields). */
export async function resolveUserName(id) {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
  return u ? `${u.firstName} ${u.lastName}`.trim() : null;
}

/** Resolve a candidate's display name. */
export async function resolveCandidateName(id) {
  if (!id) return null;
  const c = await prisma.candidate.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
  return c ? `${c.firstName} ${c.lastName}`.trim() : null;
}

/** Resolve a department reference (id OR name) to a valid department id within the company. */
export async function resolveDepartmentId(value, companyId) {
  if (!value) return null;
  const dept = await prisma.department.findFirst({
    where: { companyId: companyId ?? undefined, deletedAt: null, OR: [{ id: String(value) }, { name: String(value) }] },
    select: { id: true },
  });
  return dept?.id ?? null;
}

/** Hours between two datetimes, rounded to 2 decimals (0 if incomplete). */
export function workHoursBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
}

/** Inclusive day count between two dates. */
export function dayCount(start, end) {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms >= 0 ? Math.floor(ms / 86_400_000) + 1 : 0;
}

export const zEnum = (values) => z.enum(values);
