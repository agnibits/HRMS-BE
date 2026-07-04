import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context propagated implicitly through the async call stack.
 * Lets deep layers (repositories, audit, logger) read the current request id
 * and authenticated user without threading them through every function.
 */
export const als = new AsyncLocalStorage();

export function runWithContext(context, fn) {
  return als.run(context, fn);
}

export function getContext() {
  return als.getStore() ?? {};
}

export function getRequestId() {
  return getContext().requestId;
}

export function getCurrentUser() {
  return getContext().user ?? null;
}

export function getCurrentUserId() {
  return getContext().user?.id ?? null;
}

export function getCurrentCompanyId() {
  return getContext().user?.companyId ?? null;
}

export default { als, runWithContext, getContext, getRequestId, getCurrentUser };
