import { z } from 'zod';
import { defineCrudModule } from '../../core/crudModule.js';
import { nanoid } from 'nanoid';
import {
  listQuery,
  isoDate,
  optDate,
  nstr,
  ostr,
  resolveUserName,
  resolveCandidateName,
  resolveDepartmentId,
  workHoursBetween,
  dayCount,
} from './helpers.js';

/**
 * All standard HR CRUD modules, defined declaratively via the CRUD factory.
 * Each entry produces the same five endpoints, envelope, RBAC (resource:action),
 * audit, pagination/sort/search and filters the frontend already targets.
 * Special cases (documents upload, notifications, company settings) live in
 * their own files and are mounted alongside these in routes/index.js.
 */

// ── enum value lists (kept in sync with prisma enums) ────────────────────
const E = {
  entity: ['ACTIVE', 'INACTIVE'],
  attendance: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'],
  leaveType: ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID'],
  leaveStatus: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  holiday: ['PUBLIC', 'COMPANY', 'OPTIONAL'],
  payroll: ['UNPAID', 'PROCESSING', 'PAID'],
  jobType: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'],
  jobStatus: ['OPEN', 'ON_HOLD', 'CLOSED'],
  candidate: ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'],
  interviewMode: ['ONSITE', 'REMOTE', 'PHONE'],
  interviewStatus: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  onboarding: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'],
  cycle: ['Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL'],
  review: ['DRAFT', 'IN_PROGRESS', 'COMPLETED'],
  goal: ['ON_TRACK', 'AT_RISK', 'BEHIND', 'COMPLETED', 'CANCELLED'],
  course: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
  asset: ['AVAILABLE', 'ASSIGNED', 'IN_REPAIR', 'RETIRED'],
  expense: ['PENDING', 'APPROVED', 'REJECTED', 'REIMBURSED'],
  ticketPriority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  ticketStatus: ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED'],
};

const partial = (shape) => z.object(shape).partial().refine((d) => Object.keys(d).length > 0, {
  message: 'At least one field is required',
});

// Map a denormalized "employee" reference (id) → { employeeId, employeeName }.
const withEmployee = async (raw) => {
  if (raw.employee === undefined) return {};
  return { employeeId: raw.employee || null, employeeName: await resolveUserName(raw.employee) };
};

export const hrModules = [
  // ─────────────────────────── Organization ─────────────────────────────
  defineCrudModule({
    resource: 'departments',
    model: 'department',
    permissionPrefix: 'department',
    searchFields: ['name', 'code', 'head'],
    sortFields: ['createdAt', 'name', 'code', 'status'],
    filters: { status: 'status' },
    include: { _count: { select: { employees: true } } },
    transform: ({ _count, ...r }) => ({ ...r, employeeCount: _count?.employees ?? 0 }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.entity).optional() }),
      create: z.object({ name: nstr, code: nstr, head: ostr, description: ostr, status: z.enum(E.entity).optional() }),
      update: partial({ name: nstr, code: nstr, head: ostr, description: ostr, status: z.enum(E.entity) }),
    },
  }),

  defineCrudModule({
    resource: 'designations',
    model: 'designation',
    permissionPrefix: 'designation',
    searchFields: ['title', 'code'],
    sortFields: ['createdAt', 'title', 'level', 'status'],
    include: { _count: { select: { employees: true } } },
    transform: ({ _count, ...r }) => ({ ...r, employeeCount: _count?.employees ?? 0 }),
    mapInput: async (body, ctx) => {
      const data = {
        title: body.title,
        level: body.level,
        description: body.description,
      };
      if (body.department !== undefined) data.departmentId = await resolveDepartmentId(body.department, ctx.companyId);
      if (body.status !== undefined) data.status = body.status;
      if (body.title) data.code = `${slug(body.title)}-${nanoid(4)}`;
      return data;
    },
    exportable: true,
    schemas: {
      list: listQuery(),
      create: z.object({
        title: nstr,
        department: ostr,
        level: z.coerce.number().int().min(1).max(15),
        description: ostr,
        status: z.enum(E.entity).optional(),
      }),
      update: partial({
        title: nstr,
        department: z.string().nullable(),
        level: z.coerce.number().int().min(1).max(15),
        description: ostr,
        status: z.enum(E.entity),
      }),
    },
  }),

  // ─────────────────────────── Time management ──────────────────────────
  defineCrudModule({
    resource: 'attendance',
    model: 'attendance',
    permissionPrefix: 'attendance',
    searchFields: ['employeeName', 'notes'],
    sortFields: ['createdAt', 'date', 'status'],
    filters: { status: 'status' },
    defaultSort: { date: 'desc' },
    transform: (r) => ({ ...r, workHours: workHoursBetween(r.checkIn, r.checkOut) }),
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      date: body.date,
      checkIn: body.checkIn ?? null,
      checkOut: body.checkOut ?? null,
      status: body.status,
      notes: body.notes,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.attendance).optional() }),
      create: z.object({
        employee: nstr,
        date: isoDate,
        checkIn: optDate,
        checkOut: optDate,
        status: z.enum(E.attendance).optional(),
        notes: ostr,
      }),
      update: partial({
        employee: z.string(),
        date: isoDate,
        checkIn: optDate,
        checkOut: optDate,
        status: z.enum(E.attendance),
        notes: ostr,
      }),
    },
  }),

  defineCrudModule({
    resource: 'leaves',
    model: 'leave',
    permissionPrefix: 'leave',
    searchFields: ['employeeName', 'reason'],
    sortFields: ['createdAt', 'startDate', 'status', 'type'],
    filters: { status: 'status', type: 'type' },
    defaultSort: { startDate: 'desc' },
    transform: (r) => ({ ...r, days: dayCount(r.startDate, r.endDate) }),
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      type: body.type,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason,
      status: body.status,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.leaveStatus).optional(), type: z.enum(E.leaveType).optional() }),
      create: z.object({
        employee: nstr,
        type: z.enum(E.leaveType).optional(),
        startDate: isoDate,
        endDate: isoDate,
        reason: nstr,
        status: z.enum(E.leaveStatus).optional(),
      }),
      update: partial({
        employee: z.string(),
        type: z.enum(E.leaveType),
        startDate: isoDate,
        endDate: isoDate,
        reason: nstr,
        status: z.enum(E.leaveStatus),
      }),
    },
  }),

  defineCrudModule({
    resource: 'holidays',
    model: 'holiday',
    permissionPrefix: 'holiday',
    searchFields: ['name', 'description'],
    sortFields: ['createdAt', 'date', 'type'],
    filters: { type: 'type' },
    defaultSort: { date: 'asc' },
    exportable: true,
    schemas: {
      list: listQuery({ type: z.enum(E.holiday).optional() }),
      create: z.object({ name: nstr, date: isoDate, type: z.enum(E.holiday).optional(), description: ostr }),
      update: partial({ name: nstr, date: isoDate, type: z.enum(E.holiday), description: ostr }),
    },
  }),

  // ─────────────────────────── Payroll ──────────────────────────────────
  defineCrudModule({
    resource: 'payroll',
    model: 'payroll',
    permissionPrefix: 'payroll',
    searchFields: ['employeeName', 'period'],
    sortFields: ['createdAt', 'period', 'status'],
    filters: { status: 'status' },
    transform: (r) => ({ ...r, net: round2(r.gross - r.deductions + r.bonus) }),
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      period: body.period,
      gross: body.gross,
      deductions: body.deductions,
      bonus: body.bonus,
      status: body.status,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.payroll).optional() }),
      create: z.object({
        employee: nstr,
        period: nstr,
        gross: z.coerce.number().min(0),
        deductions: z.coerce.number().min(0).default(0),
        bonus: z.coerce.number().min(0).optional(),
        status: z.enum(E.payroll).optional(),
      }),
      update: partial({
        employee: z.string(),
        period: nstr,
        gross: z.coerce.number().min(0),
        deductions: z.coerce.number().min(0),
        bonus: z.coerce.number().min(0),
        status: z.enum(E.payroll),
      }),
    },
  }),

  // ─────────────────────────── Recruitment ──────────────────────────────
  defineCrudModule({
    resource: 'jobs',
    model: 'job',
    permissionPrefix: 'job',
    searchFields: ['title', 'department', 'location'],
    sortFields: ['createdAt', 'title', 'status', 'openings'],
    filters: { status: 'status', type: 'type' },
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.jobStatus).optional(), type: z.enum(E.jobType).optional() }),
      create: z.object({
        title: nstr,
        department: ostr,
        location: ostr,
        type: z.enum(E.jobType).optional(),
        openings: z.coerce.number().int().min(1),
        status: z.enum(E.jobStatus).optional(),
        description: ostr,
      }),
      update: partial({
        title: nstr,
        department: ostr,
        location: ostr,
        type: z.enum(E.jobType),
        openings: z.coerce.number().int().min(1),
        status: z.enum(E.jobStatus),
        description: ostr,
        applicants: z.coerce.number().int().min(0),
      }),
    },
  }),

  defineCrudModule({
    resource: 'candidates',
    model: 'candidate',
    permissionPrefix: 'candidate',
    searchFields: ['firstName', 'lastName', 'email', 'jobTitle'],
    sortFields: ['createdAt', 'firstName', 'lastName', 'stage'],
    filters: { stage: 'stage' },
    exportable: true,
    schemas: {
      list: listQuery({ stage: z.enum(E.candidate).optional() }),
      create: z.object({
        firstName: nstr,
        lastName: nstr,
        email: z.string().email(),
        phone: ostr,
        jobTitle: nstr,
        stage: z.enum(E.candidate).optional(),
        source: ostr,
      }),
      update: partial({
        firstName: nstr,
        lastName: nstr,
        email: z.string().email(),
        phone: ostr,
        jobTitle: nstr,
        stage: z.enum(E.candidate),
        source: ostr,
      }),
    },
  }),

  defineCrudModule({
    resource: 'interviews',
    model: 'interview',
    permissionPrefix: 'interview',
    searchFields: ['candidateName', 'jobTitle', 'interviewer'],
    sortFields: ['createdAt', 'scheduledAt', 'status'],
    filters: { status: 'status', mode: 'mode', candidateId: 'candidateId' },
    defaultSort: { scheduledAt: 'desc' },
    mapInput: async (body) => {
      const data = {
        jobTitle: body.jobTitle,
        round: body.round,
        interviewer: body.interviewer,
        scheduledAt: body.scheduledAt,
        mode: body.mode,
        status: body.status,
        notes: body.notes,
      };
      if (body.candidate !== undefined) {
        data.candidateId = body.candidate || null;
        data.candidateName = await resolveCandidateName(body.candidate);
      }
      return data;
    },
    exportable: true,
    schemas: {
      list: listQuery({
        status: z.enum(E.interviewStatus).optional(),
        mode: z.enum(E.interviewMode).optional(),
        candidateId: z.string().optional(),
      }),
      create: z.object({
        candidate: nstr,
        jobTitle: ostr,
        round: ostr,
        interviewer: nstr,
        scheduledAt: isoDate,
        mode: z.enum(E.interviewMode).optional(),
        status: z.enum(E.interviewStatus).optional(),
        notes: ostr,
      }),
      update: partial({
        candidate: z.string(),
        jobTitle: ostr,
        round: ostr,
        interviewer: nstr,
        scheduledAt: isoDate,
        mode: z.enum(E.interviewMode),
        status: z.enum(E.interviewStatus),
        notes: ostr,
      }),
    },
  }),

  // ─────────────────────────── Onboarding / Perf / Goals / Learning ──────
  defineCrudModule({
    resource: 'onboarding',
    model: 'onboarding',
    permissionPrefix: 'onboarding',
    searchFields: ['employeeName', 'buddy', 'manager'],
    sortFields: ['createdAt', 'startDate', 'status', 'progress'],
    filters: { status: 'status' },
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      startDate: body.startDate,
      buddy: body.buddy,
      manager: body.manager,
      status: body.status,
      progress: body.progress,
      notes: body.notes,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.onboarding).optional() }),
      create: z.object({
        employee: nstr,
        startDate: isoDate,
        buddy: ostr,
        manager: ostr,
        status: z.enum(E.onboarding).optional(),
        progress: z.coerce.number().int().min(0).max(100).optional(),
        notes: ostr,
      }),
      update: partial({
        employee: z.string(),
        startDate: isoDate,
        buddy: ostr,
        manager: ostr,
        status: z.enum(E.onboarding),
        progress: z.coerce.number().int().min(0).max(100),
        notes: ostr,
      }),
    },
  }),

  defineCrudModule({
    resource: 'performance-reviews',
    model: 'performanceReview',
    entity: 'performanceReview',
    permissionPrefix: 'performance',
    searchFields: ['employeeName', 'reviewer', 'summary'],
    sortFields: ['createdAt', 'cycle', 'status', 'score'],
    filters: { status: 'status', cycle: 'cycle' },
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      reviewer: body.reviewer,
      cycle: body.cycle,
      score: body.score,
      status: body.status,
      summary: body.summary,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.review).optional(), cycle: z.enum(E.cycle).optional() }),
      create: z.object({
        employee: nstr,
        reviewer: nstr,
        cycle: z.enum(E.cycle).optional(),
        score: z.coerce.number().min(0).max(5).optional(),
        status: z.enum(E.review).optional(),
        summary: ostr,
      }),
      update: partial({
        employee: z.string(),
        reviewer: nstr,
        cycle: z.enum(E.cycle),
        score: z.coerce.number().min(0).max(5),
        status: z.enum(E.review),
        summary: ostr,
      }),
    },
  }),

  defineCrudModule({
    resource: 'goals',
    model: 'goal',
    permissionPrefix: 'goal',
    searchFields: ['title', 'owner'],
    sortFields: ['createdAt', 'dueDate', 'status', 'progress'],
    filters: { status: 'status' },
    defaultSort: { dueDate: 'asc' },
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.goal).optional() }),
      create: z.object({
        title: nstr,
        owner: nstr,
        dueDate: isoDate,
        progress: z.coerce.number().int().min(0).max(100).optional(),
        status: z.enum(E.goal).optional(),
        keyResults: z.any().optional(),
      }),
      update: partial({
        title: nstr,
        owner: nstr,
        dueDate: isoDate,
        progress: z.coerce.number().int().min(0).max(100),
        status: z.enum(E.goal),
        keyResults: z.any(),
      }),
    },
  }),

  defineCrudModule({
    resource: 'courses',
    model: 'course',
    permissionPrefix: 'course',
    searchFields: ['title', 'category', 'instructor'],
    sortFields: ['createdAt', 'title', 'status'],
    filters: { status: 'status', category: 'category' },
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.course).optional(), category: z.string().optional() }),
      create: z.object({
        title: nstr,
        category: ostr,
        instructor: ostr,
        durationHours: z.coerce.number().min(0),
        status: z.enum(E.course).optional(),
        description: ostr,
      }),
      update: partial({
        title: nstr,
        category: ostr,
        instructor: ostr,
        durationHours: z.coerce.number().min(0),
        status: z.enum(E.course),
        description: ostr,
        enrolled: z.coerce.number().int().min(0),
      }),
    },
  }),

  // ─────────────────────────── Ops (assets / expenses / helpdesk) ────────
  defineCrudModule({
    resource: 'assets',
    model: 'asset',
    permissionPrefix: 'asset',
    searchFields: ['name', 'tag', 'category', 'assignedTo'],
    sortFields: ['createdAt', 'name', 'status'],
    filters: { status: 'status', category: 'category' },
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.asset).optional(), category: z.string().optional() }),
      create: z.object({
        name: nstr,
        tag: nstr,
        category: ostr,
        assignedTo: ostr,
        purchaseDate: optDate,
        cost: z.coerce.number().min(0).optional(),
        status: z.enum(E.asset).optional(),
      }),
      update: partial({
        name: nstr,
        tag: nstr,
        category: ostr,
        assignedTo: ostr,
        purchaseDate: optDate,
        cost: z.coerce.number().min(0),
        status: z.enum(E.asset),
      }),
    },
  }),

  defineCrudModule({
    resource: 'expenses',
    model: 'expense',
    permissionPrefix: 'expense',
    searchFields: ['title', 'employeeName', 'category'],
    sortFields: ['createdAt', 'date', 'status', 'amount'],
    filters: { status: 'status', category: 'category' },
    defaultSort: { date: 'desc' },
    mapInput: async (body) => ({
      ...(await withEmployee(body)),
      title: body.title,
      category: body.category,
      amount: body.amount,
      date: body.date,
      status: body.status,
      notes: body.notes,
    }),
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.expense).optional(), category: z.string().optional() }),
      create: z.object({
        title: nstr,
        employee: nstr,
        category: ostr,
        amount: z.coerce.number().min(0),
        date: isoDate,
        status: z.enum(E.expense).optional(),
        notes: ostr,
      }),
      update: partial({
        title: nstr,
        employee: z.string(),
        category: ostr,
        amount: z.coerce.number().min(0),
        date: isoDate,
        status: z.enum(E.expense),
        notes: ostr,
      }),
    },
  }),

  defineCrudModule({
    resource: 'tickets',
    model: 'ticket',
    permissionPrefix: 'ticket',
    searchFields: ['subject', 'requesterName', 'category', 'assignee'],
    sortFields: ['createdAt', 'priority', 'status'],
    filters: { status: 'status', priority: 'priority' },
    mapInput: async (body) => {
      const data = {
        subject: body.subject,
        category: body.category,
        priority: body.priority,
        assignee: body.assignee,
        status: body.status,
        description: body.description,
      };
      if (body.requester !== undefined) {
        data.requesterId = body.requester || null;
        data.requesterName = await resolveUserName(body.requester);
      }
      return data;
    },
    exportable: true,
    schemas: {
      list: listQuery({ status: z.enum(E.ticketStatus).optional(), priority: z.enum(E.ticketPriority).optional() }),
      create: z.object({
        subject: nstr,
        requester: nstr,
        category: ostr,
        priority: z.enum(E.ticketPriority).optional(),
        assignee: ostr,
        status: z.enum(E.ticketStatus).optional(),
        description: ostr,
      }),
      update: partial({
        subject: nstr,
        requester: z.string(),
        category: ostr,
        priority: z.enum(E.ticketPriority),
        assignee: ostr,
        status: z.enum(E.ticketStatus),
        description: ostr,
      }),
    },
  }),
];

function slug(s) {
  return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default hrModules;
