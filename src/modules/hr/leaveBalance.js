import { prisma } from '../../config/prisma.js';
import { config } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { dayCount } from './helpers.js';

/**
 * Leave balance logic. A leave's `type` (enum, e.g. ANNUAL) maps to a company
 * LeavePolicy by matching `type === policy.code`. Allocation comes from the
 * policy's daysPerYear; usage is summed from the employee's leaves in the
 * current calendar year.
 */
function currentYearRange() {
  const year = new Date().getFullYear();
  return { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59) };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Per-policy balance for an employee: allocated / used / pending / remaining. */
export async function computeBalances(companyId, employeeId) {
  const [policies, leaves] = await Promise.all([
    prisma.leavePolicy.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    }),
    prisma.leave.findMany({
      where: { companyId, employeeId, deletedAt: null, startDate: currentYearRange() },
      select: { type: true, status: true, startDate: true, endDate: true },
    }),
  ]);

  return policies.map((p) => {
    const forType = leaves.filter((l) => l.type === p.code);
    const sumDays = (list) => list.reduce((s, l) => s + dayCount(l.startDate, l.endDate), 0);
    const used = sumDays(forType.filter((l) => l.status === 'APPROVED'));
    const pending = sumDays(forType.filter((l) => l.status === 'PENDING'));
    const allocated = p.daysPerYear;
    return {
      code: p.code,
      name: p.name,
      color: p.color,
      paid: p.paid,
      carryForward: p.carryForward,
      allocated: round1(allocated),
      used: round1(used),
      pending: round1(pending),
      remaining: round1(allocated - used),
      available: round1(allocated - used - pending),
    };
  });
}

/**
 * Guard used by the leaves module's create hook: throws 422 when the requested
 * days exceed the available balance. No-ops when enforcement is off, no paid
 * policy matches the type, or required fields are missing (so leave creation is
 * never blocked before policies are configured).
 */
export async function assertBalance(companyId, data) {
  if (!config.leave.enforceBalance) return;
  if (!companyId || !data.employeeId || !data.type || !data.startDate || !data.endDate) return;

  const policy = await prisma.leavePolicy.findFirst({
    where: { companyId, code: data.type, status: 'ACTIVE', deletedAt: null },
  });
  if (!policy || !policy.paid) return; // no allocation defined / unpaid → don't block

  const consumedLeaves = await prisma.leave.findMany({
    where: {
      companyId,
      employeeId: data.employeeId,
      type: data.type,
      deletedAt: null,
      status: { in: ['APPROVED', 'PENDING'] },
      startDate: currentYearRange(),
    },
    select: { startDate: true, endDate: true },
  });
  const consumed = consumedLeaves.reduce((s, l) => s + dayCount(l.startDate, l.endDate), 0);
  const requested = dayCount(data.startDate, data.endDate);
  const available = policy.daysPerYear - consumed;

  if (requested > available) {
    throw ApiError.unprocessable(
      `Insufficient ${policy.name} balance: requested ${round1(requested)} day(s), available ${round1(available)}.`,
      {
        code: 'INSUFFICIENT_LEAVE_BALANCE',
        details: { requested: round1(requested), available: round1(available), allocated: policy.daysPerYear, consumed: round1(consumed) },
      }
    );
  }
}

export default { computeBalances, assertBalance };
