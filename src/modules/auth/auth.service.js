import { prisma } from '../../config/prisma.js';
import { config } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../../utils/password.js';
import { verifyRefreshToken } from '../../utils/jwt.js';
import { userRepository } from '../users/user.repository.js';
import { enqueueEmail } from '../../queues/index.js';
import { templates } from '../../notifications/mail.service.js';
import { record, AuditAction } from '../audit/audit.service.js';
import {
  issueTokens,
  rotateSession,
  revokeSession,
  revokeAllSessions,
} from './auth.tokens.js';
import * as mfa from './auth.mfa.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/**
 * Authentication business logic. Controllers stay thin; all rules
 * (lockout, MFA gating, token rotation, session/device management) live here.
 */
class AuthService {
  // ── Login ────────────────────────────────────────────────────────────
  async login({ email, password, deviceInfo }) {
    const user = await userRepository.findByEmailWithPermissions(email);

    // Constant-ish behavior: run a dummy verify to reduce user enumeration timing.
    if (!user) {
      await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$invalid$invalid', password).catch(() => {});
      throw ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw ApiError.tooManyRequests('Account temporarily locked. Try again later.', {
        code: 'ACCOUNT_LOCKED',
      });
    }
    if (user.status === 'DISABLED' || user.status === 'SUSPENDED') {
      throw ApiError.forbidden('Account is not active', { code: 'ACCOUNT_INACTIVE' });
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      await this.#registerFailedLogin(user);
      await record({ action: AuditAction.LOGIN_FAILED, entity: 'auth', entityId: user.id, actorId: user.id, status: 'FAILURE' });
      throw ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
    }

    // Reset lockout counters on success.
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }

    // MFA gate — issue a short-lived challenge token instead of full tokens.
    if (config.security.enableMfa && user.mfaEnabled) {
      const challenge = randomToken(24);
      await prisma.otpCode.create({
        data: {
          userId: user.id,
          purpose: 'MFA_LOGIN',
          codeHash: sha256(challenge),
          expiresAt: new Date(Date.now() + config.security.otpExpiresMin * 60000),
        },
      });
      return { mfaRequired: true, mfaToken: challenge, userId: user.id };
    }

    return this.#finalizeLogin(user, deviceInfo);
  }

  async verifyMfa({ userId, mfaToken, code, deviceInfo }) {
    const user = await userRepository.findByIdWithPermissions(userId);
    if (!user || !user.mfaEnabled) throw ApiError.badRequest('MFA not enabled', { code: 'MFA_NOT_ENABLED' });

    // The mfaToken proves the user already passed the password step.
    const challenge = await prisma.otpCode.findFirst({
      where: { userId, purpose: 'MFA_LOGIN', usedAt: null, codeHash: sha256(mfaToken), expiresAt: { gt: new Date() } },
    });
    if (!challenge) throw ApiError.unauthorized('MFA session expired, please login again', { code: 'MFA_EXPIRED' });

    const secret = mfa.decryptSecret(user.mfaSecret);
    if (!mfa.verifyToken(secret, code)) {
      throw ApiError.unauthorized('Invalid MFA code', { code: 'MFA_INVALID' });
    }

    await prisma.otpCode.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    return this.#finalizeLogin(user, deviceInfo);
  }

  // ── Token refresh (rotation + reuse detection) ───────────────────────
  async refresh({ refreshToken, deviceInfo }) {
    const payload = verifyRefreshToken(refreshToken);
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw ApiError.unauthorized('Session expired or revoked', { code: 'SESSION_INVALID' });
    }
    // Reuse detection: presented token no longer matches the stored hash.
    if (session.refreshTokenHash !== sha256(refreshToken)) {
      await revokeAllSessions(session.userId, { reason: 'refresh_reuse_detected' });
      throw ApiError.unauthorized('Refresh token reuse detected. All sessions revoked.', {
        code: 'TOKEN_REUSE',
      });
    }

    const user = await userRepository.findByIdWithPermissions(session.userId);
    if (!user) throw ApiError.unauthorized('User no longer exists', { code: 'USER_NOT_FOUND' });

    const tokens = await rotateSession(session, user, {
      permissions: user.permissionList,
      roles: user.roleNames,
      deviceInfo,
    });
    return { ...tokens, user: this.#publicUser(user) };
  }

  // ── Logout ───────────────────────────────────────────────────────────
  async logout({ sessionId, accessJti }) {
    if (sessionId) await revokeSession(sessionId, 'logout', accessJti);
    await record({ action: AuditAction.LOGOUT, entity: 'auth', entityId: sessionId });
  }

  async logoutAll(userId, { exceptSessionId } = {}) {
    await revokeAllSessions(userId, { exceptSessionId, reason: 'logout_all' });
  }

  // ── Password: change / forgot / reset ────────────────────────────────
  async changePassword({ userId, currentPassword, newPassword, currentSessionId }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw ApiError.badRequest('Current password is incorrect', { code: 'INVALID_CURRENT_PASSWORD' });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });
    // Invalidate every other session for safety.
    await revokeAllSessions(userId, { exceptSessionId: currentSessionId, reason: 'password_changed' });
    await record({ action: AuditAction.PASSWORD_CHANGE, entity: 'auth', entityId: userId, actorId: userId });
  }

  async forgotPassword({ email }) {
    const user = await userRepository.findByEmail(email);
    // Always respond success to avoid user enumeration.
    if (!user) return;

    const token = randomToken(32);
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + config.security.passwordResetExpiresMin * 60000),
      },
    });
    const url = `${config.frontendUrl}/reset-password?token=${token}`;
    const tpl = templates.passwordReset({ name: user.firstName, url });
    await enqueueEmail({ to: user.email, ...tpl });
  }

  async resetPassword({ token, newPassword }) {
    const record_ = await prisma.verificationToken.findFirst({
      where: { type: 'PASSWORD_RESET', tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!record_) throw ApiError.badRequest('Invalid or expired reset token', { code: 'RESET_TOKEN_INVALID' });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record_.userId },
        data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
      }),
      prisma.verificationToken.update({ where: { id: record_.id }, data: { usedAt: new Date() } }),
    ]);
    await revokeAllSessions(record_.userId, { reason: 'password_reset' });
    await record({ action: AuditAction.PASSWORD_CHANGE, entity: 'auth', entityId: record_.userId });
  }

  // ── Email verification ───────────────────────────────────────────────
  async sendVerificationEmail(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (user.emailVerifiedAt) throw ApiError.badRequest('Email already verified', { code: 'ALREADY_VERIFIED' });

    const token = randomToken(32);
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + config.security.emailVerifyExpiresHours * 3600000),
      },
    });
    const url = `${config.frontendUrl}/verify-email?token=${token}`;
    const tpl = templates.emailVerification({ name: user.firstName, url });
    await enqueueEmail({ to: user.email, ...tpl });
  }

  async verifyEmail({ token }) {
    const rec = await prisma.verificationToken.findFirst({
      where: { type: 'EMAIL_VERIFICATION', tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!rec) throw ApiError.badRequest('Invalid or expired verification token', { code: 'VERIFY_TOKEN_INVALID' });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: rec.userId },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      }),
      prisma.verificationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
  }

  // ── MFA setup / enable / disable ─────────────────────────────────────
  async setupMfa(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (user.mfaEnabled) throw ApiError.badRequest('MFA already enabled', { code: 'MFA_ALREADY_ENABLED' });

    const secret = mfa.generateSecret();
    // Store the (encrypted) pending secret; only activated after verify.
    await prisma.user.update({ where: { id: userId }, data: { mfaSecret: mfa.encryptSecret(secret) } });
    const { otpauth, qrDataUrl } = await mfa.buildQrCode(user.email, secret);
    return { secret, otpauth, qrDataUrl };
  }

  async enableMfa({ userId, code }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) throw ApiError.badRequest('Start MFA setup first', { code: 'MFA_NOT_SETUP' });
    if (!mfa.verifyToken(mfa.decryptSecret(user.mfaSecret), code)) {
      throw ApiError.badRequest('Invalid MFA code', { code: 'MFA_INVALID' });
    }
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaVerifiedAt: new Date() } });
  }

  async disableMfa({ userId, password }) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw ApiError.badRequest('Password is incorrect', { code: 'INVALID_PASSWORD' });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaVerifiedAt: null },
    });
  }

  // ── Session & device management ──────────────────────────────────────
  async listSessions(userId, currentSessionId) {
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      device: s.device ? { name: s.device.name, platform: s.device.platform, browser: s.device.browser } : null,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSessionId,
    }));
  }

  async revokeSessionById({ userId, sessionId }) {
    const session = await prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw ApiError.notFound('Session not found');
    await revokeSession(sessionId, 'revoked_by_user');
  }

  async listDevices(userId) {
    return prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });
  }

  async trustDevice({ userId, deviceId, trusted }) {
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw ApiError.notFound('Device not found');
    return prisma.device.update({ where: { id: deviceId }, data: { isTrusted: !!trusted } });
  }

  async removeDevice({ userId, deviceId }) {
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw ApiError.notFound('Device not found');
    // Revoke sessions on that device, then delete it.
    await prisma.session.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'device_removed' },
    });
    await prisma.device.delete({ where: { id: deviceId } });
  }

  async me(userId) {
    const user = await userRepository.findByIdWithPermissions(userId);
    if (!user) throw ApiError.notFound('User not found');
    return this.#publicUser(user);
  }

  // ── Private helpers ──────────────────────────────────────────────────
  async #finalizeLogin(user, deviceInfo) {
    const tokens = await issueTokens(user, {
      deviceInfo,
      permissions: user.permissionList,
      roles: user.roleNames,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: deviceInfo?.ip ?? null },
    });
    await record({ action: AuditAction.LOGIN, entity: 'auth', entityId: user.id, actorId: user.id });
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      sessionId: tokens.session.id,
      user: this.#publicUser(user),
    };
  }

  async #registerFailedLogin(user) {
    const failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    const data = { failedLoginCount };
    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      data.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      data.failedLoginCount = 0;
    }
    await prisma.user.update({ where: { id: user.id }, data });
  }

  #publicUser(user) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      companyId: user.companyId,
      emailVerified: !!user.emailVerifiedAt,
      mfaEnabled: user.mfaEnabled,
      roles: user.roleNames ?? [],
      permissions: user.permissionList ?? [],
    };
  }
}

export const authService = new AuthService();
export default authService;
