import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { ApiError } from './ApiError.js';

/**
 * JWT helpers for the access/refresh token pair.
 *  - Access token: short-lived, carries identity + a permission snapshot.
 *  - Refresh token: long-lived, references a persisted session (jti) so it can
 *    be rotated and revoked server-side.
 */
export function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.appName,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: config.appName,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, { issuer: config.appName });
  } catch (err) {
    throw ApiError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token',
      { code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' }
    );
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwt.refreshSecret, { issuer: config.appName });
  } catch (err) {
    throw ApiError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Refresh token expired' : 'Invalid refresh token',
      { code: 'REFRESH_TOKEN_INVALID' }
    );
  }
}

export default { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
