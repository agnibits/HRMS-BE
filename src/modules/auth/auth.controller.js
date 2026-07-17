import { authService } from './auth.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok, created } from '../../utils/ApiResponse.js';
import { extractDeviceInfo } from '../../utils/deviceInfo.js';
import { config } from '../../config/env.js';
import { parseDurationToMs } from '../../utils/duration.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Thin HTTP layer for the Auth module. Extracts request data, delegates to the
 * service, and shapes the HTTP response. The refresh token is additionally set
 * as an httpOnly cookie so browser clients need not store it in JS-readable
 * storage (mobile clients use the body value).
 */
const refreshCookieName = 'refresh_token';
function setRefreshCookie(res, token) {
  res.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    maxAge: parseDurationToMs(config.jwt.refreshExpiresIn),
    path: `${config.apiPrefix}/auth`,
  });
}

export const login = asyncHandler(async (req, res) => {
  const deviceInfo = extractDeviceInfo(req);
  const result = await authService.login({ ...req.body, deviceInfo });

  if (result.mfaRequired) {
    return ok(res, { mfaRequired: true, mfaToken: result.mfaToken, userId: result.userId },
      'MFA verification required');
  }
  setRefreshCookie(res, result.refreshToken);
  return ok(res, result, 'Login successful');
});

export const verifyMfa = asyncHandler(async (req, res) => {
  const deviceInfo = extractDeviceInfo(req);
  const result = await authService.verifyMfa({ ...req.body, deviceInfo });
  setRefreshCookie(res, result.refreshToken);
  return ok(res, result, 'Login successful');
});

export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.[refreshCookieName];
  if (!refreshToken) throw ApiError.unauthorized('Refresh token required', { code: 'NO_REFRESH_TOKEN' });
  const deviceInfo = extractDeviceInfo(req);
  const result = await authService.refresh({ refreshToken, deviceInfo });
  setRefreshCookie(res, result.refreshToken);
  return ok(res, result, 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout({ sessionId: req.user?.sessionId, accessJti: req.user?.jti, userId: req.user?.id });
  res.clearCookie(refreshCookieName, { path: `${config.apiPrefix}/auth` });
  return ok(res, null, 'Logged out');
});

export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id, { exceptSessionId: req.user.sessionId });
  return ok(res, null, 'Logged out from all other devices');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  return ok(res, null, 'If an account exists, a reset link has been sent');
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  return ok(res, null, 'Password reset successful');
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({
    userId: req.user.id,
    currentSessionId: req.user.sessionId,
    ...req.body,
  });
  return ok(res, null, 'Password changed. Other sessions have been signed out.');
});

export const sendVerification = asyncHandler(async (req, res) => {
  await authService.sendVerificationEmail(req.user.id);
  return ok(res, null, 'Verification email sent');
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body);
  return ok(res, null, 'Email verified');
});

export const me = asyncHandler(async (req, res) => {
  return ok(res, await authService.me(req.user.id), 'Current user');
});

// ── MFA ──────────────────────────────────────────────────────────────
export const setupMfa = asyncHandler(async (req, res) => {
  return created(res, await authService.setupMfa(req.user.id), 'Scan the QR code and confirm with a code');
});
export const enableMfa = asyncHandler(async (req, res) => {
  await authService.enableMfa({ userId: req.user.id, code: req.body.code });
  return ok(res, null, 'MFA enabled');
});
export const disableMfa = asyncHandler(async (req, res) => {
  await authService.disableMfa({ userId: req.user.id, password: req.body.password });
  return ok(res, null, 'MFA disabled');
});

// ── Sessions & devices ────────────────────────────────────────────────
export const listSessions = asyncHandler(async (req, res) => {
  return ok(res, await authService.listSessions(req.user.id, req.user.sessionId), 'Active sessions');
});
export const revokeSessionById = asyncHandler(async (req, res) => {
  await authService.revokeSessionById({ userId: req.user.id, sessionId: req.params.id });
  return ok(res, null, 'Session revoked');
});
export const listDevices = asyncHandler(async (req, res) => {
  return ok(res, await authService.listDevices(req.user.id), 'Devices');
});
export const trustDevice = asyncHandler(async (req, res) => {
  const device = await authService.trustDevice({
    userId: req.user.id,
    deviceId: req.params.id,
    trusted: req.body.trusted,
  });
  return ok(res, device, 'Device updated');
});
export const removeDevice = asyncHandler(async (req, res) => {
  await authService.removeDevice({ userId: req.user.id, deviceId: req.params.id });
  return ok(res, null, 'Device removed');
});

export default {
  login,
  verifyMfa,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
  sendVerification,
  verifyEmail,
  me,
  setupMfa,
  enableMfa,
  disableMfa,
  listSessions,
  revokeSessionById,
  listDevices,
  trustDevice,
  removeDevice,
};
