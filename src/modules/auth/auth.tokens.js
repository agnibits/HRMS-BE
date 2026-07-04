import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { redis } from '../../config/redis.js';
import { config } from '../../config/env.js';
import { signAccessToken, signRefreshToken } from '../../utils/jwt.js';
import { sha256 } from '../../utils/password.js';
import { parseDurationToMs } from '../../utils/duration.js';

/**
 * Access/refresh token + session lifecycle. A refresh token is bound 1:1 to a
 * persisted Session row (hashed). Refreshing rotates the token and updates the
 * hash, so a stolen refresh token is invalidated the moment the legitimate
 * client refreshes (rotation + reuse detection).
 */

/** Resolve or create the Device row for this login context. */
export async function upsertDevice(userId, deviceInfo = {}) {
  const fingerprint = deviceInfo.fingerprint || sha256(`${userId}:${deviceInfo.userAgent || 'unknown'}`);
  return prisma.device.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: {
      userId,
      fingerprint,
      name: deviceInfo.name,
      platform: deviceInfo.platform,
      browser: deviceInfo.browser,
      lastIp: deviceInfo.ip,
    },
    update: { lastIp: deviceInfo.ip, lastSeenAt: new Date() },
  });
}

/**
 * Issue a fresh access/refresh pair and persist the session.
 * @returns {{accessToken, refreshToken, session, expiresIn}}
 */
export async function issueTokens(user, { deviceInfo = {}, permissions, roles } = {}) {
  const device = await upsertDevice(user.id, deviceInfo);
  const jti = randomUUID();
  const sessionId = randomUUID();

  const refreshToken = signRefreshToken({ sub: user.id, sid: sessionId });
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    companyId: user.companyId ?? null,
    roles: roles ?? [],
    permissions: permissions ?? [],
    sid: sessionId,
    jti,
  });

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      deviceId: device.id,
      refreshTokenHash: sha256(refreshToken),
      ipAddress: deviceInfo.ip,
      userAgent: deviceInfo.userAgent,
      expiresAt: new Date(Date.now() + parseDurationToMs(config.jwt.refreshExpiresIn)),
    },
  });

  return {
    accessToken,
    refreshToken,
    session,
    expiresIn: Math.floor(parseDurationToMs(config.jwt.accessExpiresIn) / 1000),
  };
}

/** Rotate an existing session onto a new token pair (called on refresh). */
export async function rotateSession(session, user, { permissions, roles, deviceInfo = {} } = {}) {
  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: user.id, sid: session.id });
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    companyId: user.companyId ?? null,
    roles: roles ?? [],
    permissions: permissions ?? [],
    sid: session.id,
    jti,
  });

  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: sha256(refreshToken),
      lastUsedAt: new Date(),
      ipAddress: deviceInfo.ip ?? session.ipAddress,
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(parseDurationToMs(config.jwt.accessExpiresIn) / 1000),
  };
}

/** Revoke a single session and blacklist any still-valid access token jti. */
export async function revokeSession(sessionId, reason = 'logout', accessJti) {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  if (accessJti) await blacklistAccessJti(accessJti);
}

/** Revoke every active session for a user (e.g. on password change). */
export async function revokeAllSessions(userId, { exceptSessionId, reason = 'revoke_all' } = {}) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

/** Push an access-token jti onto the revocation list until it would expire. */
export async function blacklistAccessJti(jti) {
  const ttl = Math.ceil(parseDurationToMs(config.jwt.accessExpiresIn) / 1000);
  await redis.set(`bl:access:${jti}`, '1', 'EX', ttl).catch(() => {});
}

export default { issueTokens, rotateSession, revokeSession, revokeAllSessions, upsertDevice };
