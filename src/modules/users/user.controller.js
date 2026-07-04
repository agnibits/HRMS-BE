import { userService } from './user.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';

/** HTTP layer for the User module. */
export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await userService.list(req.validatedQuery ?? req.query);
  return paginated(res, items, pagination, 'Users retrieved');
});

export const getOne = asyncHandler(async (req, res) => {
  return ok(res, await userService.getById(req.params.id), 'User retrieved');
});

export const create = asyncHandler(async (req, res) => {
  return created(res, await userService.create(req.body, req.user.id), 'User created');
});

export const update = asyncHandler(async (req, res) => {
  return ok(res, await userService.update(req.params.id, req.body, req.user.id), 'User updated');
});

export const updateProfile = asyncHandler(async (req, res) => {
  return ok(res, await userService.updateProfile(req.user.id, req.body), 'Profile updated');
});

export const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.params.id, req.user.id);
  return noContent(res);
});

export const restore = asyncHandler(async (req, res) => {
  return ok(res, await userService.restore(req.params.id, req.user.id), 'User restored');
});

export const assignRoles = asyncHandler(async (req, res) => {
  return ok(res, await userService.assignRoles(req.params.id, req.body.roleIds, req.user.id), 'Roles assigned');
});

export const exportUsers = asyncHandler(async (req, res) => {
  const buffer = await userService.exportToExcel(req.validatedQuery ?? req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="users-${Date.now()}.xlsx"`);
  return res.send(Buffer.from(buffer));
});

export const importUsers = asyncHandler(async (req, res) => {
  const result = await userService.importFromFile(req.file, {
    companyId: req.body.companyId ?? req.user.companyId,
    actorId: req.user.id,
  });
  return ok(res, result, 'Bulk import completed');
});

export default { list, getOne, create, update, updateProfile, remove, restore, assignRoles, exportUsers, importUsers };
