import { userService } from './user.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';
import { tenantScope } from '../../utils/tenant.js';

/** HTTP layer for the User module. All operations are tenant-scoped via `ctx`. */
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await userService.list(req.validatedQuery ?? req.query, tenantScope(req.user));
  return paginated(res, items, pagination, 'Users retrieved');
});

export const getOne = asyncHandler(async (req, res) => {
  return ok(res, await userService.getById(req.params.id, tenantScope(req.user)), 'User retrieved');
});

export const create = asyncHandler(async (req, res) => {
  return created(res, await userService.create(req.body, tenantScope(req.user)), 'User created');
});

export const update = asyncHandler(async (req, res) => {
  return ok(res, await userService.update(req.params.id, req.body, tenantScope(req.user)), 'User updated');
});

export const updateProfile = asyncHandler(async (req, res) => {
  return ok(res, await userService.updateProfile(req.user.id, req.body), 'Profile updated');
});

export const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.params.id, tenantScope(req.user));
  return noContent(res);
});

export const restore = asyncHandler(async (req, res) => {
  return ok(res, await userService.restore(req.params.id, tenantScope(req.user)), 'User restored');
});

export const assignRoles = asyncHandler(async (req, res) => {
  return ok(res, await userService.assignRoles(req.params.id, req.body.roleIds, tenantScope(req.user)), 'Roles assigned');
});

export const resendInvite = asyncHandler(async (req, res) => {
  return ok(res, await userService.resendInvite(req.params.id, tenantScope(req.user)), 'Invitation resent');
});

export const exportUsers = asyncHandler(async (req, res) => {
  const buffer = await userService.exportToExcel(req.validatedQuery ?? req.query, tenantScope(req.user));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="users-${Date.now()}.xlsx"`);
  return res.send(Buffer.from(buffer));
});

export const importUsers = asyncHandler(async (req, res) => {
  const result = await userService.importFromFile(req.file, tenantScope(req.user));
  return ok(res, result, 'Bulk import completed');
});

export default { list, getOne, create, update, updateProfile, remove, restore, assignRoles, resendInvite, exportUsers, importUsers };
