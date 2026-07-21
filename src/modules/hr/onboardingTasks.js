import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Onboarding checklist. The checklist is the substance of onboarding: ticking
 * items is what actually moves a new hire's progress, so tasks — when present —
 * are the single source of truth for both progress% and status.
 */

// A sensible default checklist every new onboarding starts with. Companies can
// add/remove items per hire; a configurable template is a later enhancement.
export const DEFAULT_ONBOARDING_TASKS = [
  'Send welcome email & offer letter',
  'Collect documents (ID, tax, bank details)',
  'Allocate laptop & equipment',
  'Set up company email & accounts',
  'Add to payroll',
  'Team introduction & workspace tour',
];

/** Seed a fresh onboarding with the default checklist (once, on create). */
export async function seedDefaultTasks({ id, companyId }) {
  await prisma.onboardingTask.createMany({
    data: DEFAULT_ONBOARDING_TASKS.map((title, position) => ({ onboardingId: id, companyId, title, position })),
  });
}

/**
 * Recompute progress% and status from the checklist. Tasks are the source of
 * truth when present: progress = done/total, and status auto-advances
 * (none → NOT_STARTED, some → IN_PROGRESS, all → COMPLETED) unless the
 * onboarding is ON_HOLD. With no tasks we leave the manually-set values alone.
 */
export async function recomputeProgress(onboardingId) {
  const tasks = await prisma.onboardingTask.findMany({ where: { onboardingId }, select: { done: true } });
  if (!tasks.length) return;
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const progress = Math.round((done / total) * 100);
  const current = await prisma.onboarding.findUnique({ where: { id: onboardingId }, select: { status: true } });
  let status = current?.status;
  if (status !== 'ON_HOLD') status = done === 0 ? 'NOT_STARTED' : done === total ? 'COMPLETED' : 'IN_PROGRESS';
  await prisma.onboarding.update({ where: { id: onboardingId }, data: { progress, status } });
}

/** Load an onboarding within the caller's company, or 404. */
async function ownOnboarding(id, companyId) {
  const row = await prisma.onboarding.findFirst({
    where: { id, companyId: companyId ?? undefined, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!row) throw ApiError.notFound('onboarding not found', { code: 'ONBOARDING_NOT_FOUND' });
  return row;
}

const taskCreate = z.object({ title: z.string().trim().min(1).max(200) });
const taskUpdate = z
  .object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field is required' });

/**
 * Register the /onboarding/:id/tasks sub-resource. Every mutation recomputes the
 * parent's progress/status and returns the full, freshly-shaped onboarding so
 * the client always has the current checklist + progress in one round-trip.
 */
export function registerTaskRoutes(router, { service, ctxOf, perms, ok, created, asyncHandler, authorize, validate }) {
  router.post(
    '/:id/tasks',
    authorize(perms.update),
    validate({ body: taskCreate }),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const onb = await ownOnboarding(req.params.id, ctx.companyId);
      const position = await prisma.onboardingTask.count({ where: { onboardingId: onb.id } });
      await prisma.onboardingTask.create({
        data: { onboardingId: onb.id, companyId: onb.companyId, title: req.body.title, position },
      });
      await recomputeProgress(onb.id);
      return created(res, await service.get(onb.id, ctx));
    })
  );

  router.patch(
    '/:id/tasks/:taskId',
    authorize(perms.update),
    validate({ body: taskUpdate }),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const onb = await ownOnboarding(req.params.id, ctx.companyId);
      const task = await prisma.onboardingTask.findFirst({ where: { id: req.params.taskId, onboardingId: onb.id } });
      if (!task) throw ApiError.notFound('task not found', { code: 'ONBOARDING_TASK_NOT_FOUND' });
      const data = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.done !== undefined) {
        data.done = req.body.done;
        data.completedAt = req.body.done ? new Date() : null;
      }
      await prisma.onboardingTask.update({ where: { id: task.id }, data });
      await recomputeProgress(onb.id);
      return ok(res, await service.get(onb.id, ctx), 'Updated');
    })
  );

  router.delete(
    '/:id/tasks/:taskId',
    authorize(perms.update),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const onb = await ownOnboarding(req.params.id, ctx.companyId);
      const task = await prisma.onboardingTask.findFirst({ where: { id: req.params.taskId, onboardingId: onb.id } });
      if (!task) throw ApiError.notFound('task not found', { code: 'ONBOARDING_TASK_NOT_FOUND' });
      await prisma.onboardingTask.delete({ where: { id: task.id } });
      await recomputeProgress(onb.id);
      return ok(res, await service.get(onb.id, ctx), 'Deleted');
    })
  );
}
