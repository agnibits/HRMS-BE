/**
 * Central permission catalog. Permissions follow a `resource:action` convention.
 * Roles are collections of these permissions; the access token carries a
 * flattened snapshot so authorization checks are O(1) and DB-free per request.
 *
 * `SUPER_ADMIN` holds the wildcard `*`, which is expanded to the full explicit
 * permission list when building a user's token (so front-end role guards that
 * check for concrete strings like `department:read` also work).
 */
export const WILDCARD = '*';

const ACTIONS = ['read', 'create', 'update', 'delete'];

// Every CRUD resource in the system (used to generate resource:action perms).
export const CRUD_RESOURCES = [
  'user',
  'role',
  'employee',
  'department',
  'designation',
  'attendance',
  'leave',
  'leaveType',
  'holiday',
  'payroll',
  'job',
  'candidate',
  'interview',
  'onboarding',
  'performance',
  'goal',
  'course',
  'asset',
  'expense',
  'ticket',
  'document',
  'notification',
  'company',
];

// Build the flat permission map: { USER_READ: 'user:read', ... } plus extras.
function buildPermissions() {
  const map = {};
  for (const resource of CRUD_RESOURCES) {
    for (const action of ACTIONS) {
      map[`${resource.toUpperCase()}_${action.toUpperCase()}`] = `${resource}:${action}`;
    }
  }
  // Non-CRUD / special permissions
  map.USER_IMPORT = 'user:import';
  map.USER_EXPORT = 'user:export';
  map.ROLE_ASSIGN = 'role:assign';
  map.ORG_MANAGE = 'org:manage';
  map.ORG_READ = 'org:read';
  map.AUDIT_READ = 'audit:read';
  map.SETTINGS_MANAGE = 'settings:manage';
  return map;
}

export const PERMISSIONS = buildPermissions();

export const ALL_PERMISSIONS = [...new Set(Object.values(PERMISSIONS))];

/**
 * Platform-level permissions belong ONLY to the Agnibits platform SUPER_ADMIN
 * (tenant provisioning across all companies). Deliberately excluded from
 * ALL_PERMISSIONS so company ADMINs never receive them.
 */
export const PLATFORM_PERMISSIONS = ['platform:manage'];
PERMISSIONS.PLATFORM_MANAGE = 'platform:manage';

/** Expand a permission set: the wildcard grants every permission incl. platform. */
export function expandPermissions(permissionSet) {
  const set = new Set(permissionSet);
  if (set.has(WILDCARD)) return [WILDCARD, ...ALL_PERMISSIONS, ...PLATFORM_PERMISSIONS];
  return [...set];
}

// HR staff can manage most people-operations but not roles/company/audit deletion.
const HR_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !p.startsWith('role:') && !p.startsWith('company:') && p !== 'audit:read'
);

// Managers & employees are mostly read-only.
const READ_ONLY = ALL_PERMISSIONS.filter((p) => p.endsWith(':read'));

/**
 * Built-in system roles seeded on first run. Application-defined roles can be
 * created at runtime via the RBAC module.
 */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: 'SUPER_ADMIN',
    description: 'Full, unrestricted access across all companies.',
    isSystem: true,
    permissions: [WILDCARD],
  },
  ADMIN: {
    name: 'ADMIN',
    description: 'Company administrator.',
    isSystem: true,
    permissions: [...ALL_PERMISSIONS, 'user:import', 'user:export', 'role:assign'],
  },
  HR: {
    name: 'HR',
    description: 'Human Resources staff.',
    isSystem: true,
    permissions: [...HR_PERMISSIONS, 'user:export'],
  },
  MANAGER: {
    name: 'MANAGER',
    description: 'People manager / team lead.',
    isSystem: true,
    permissions: READ_ONLY,
  },
  EMPLOYEE: {
    name: 'EMPLOYEE',
    description: 'Standard employee self-service access.',
    isSystem: true,
    permissions: ['employee:read', 'attendance:read', 'leave:read', 'notification:read'],
  },
};

export default { PERMISSIONS, SYSTEM_ROLES, ALL_PERMISSIONS, WILDCARD, expandPermissions, CRUD_RESOURCES };
