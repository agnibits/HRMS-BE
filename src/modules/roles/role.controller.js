import { roleService } from './role.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created, paginated, noContent } from '../../utils/ApiResponse.js';

export const catalog = asyncHandler(async (_req, res) =>
  ok(res, roleService.catalog(), 'Permission catalog')
);

export const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await roleService.list(req.validatedQuery ?? req.query, req.user.companyId);
  return paginated(res, items, pagination, 'Roles retrieved');
});

export const getOne = asyncHandler(async (req, res) =>
  ok(res, await roleService.getById(req.params.id), 'Role retrieved')
);

export const create = asyncHandler(async (req, res) =>
  created(res, await roleService.create(req.body, { actorId: req.user.id, companyId: req.user.companyId }), 'Role created')
);

export const update = asyncHandler(async (req, res) =>
  ok(res, await roleService.update(req.params.id, req.body, req.user.id), 'Role updated')
);

export const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id, req.user.id);
  return noContent(res);
});

export default { catalog, list, getOne, create, update, remove };
