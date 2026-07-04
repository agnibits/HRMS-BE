import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import crypto from 'node:crypto';
import { config } from '../../config/env.js';

/**
 * TOTP-based MFA helpers. The shared secret is encrypted at rest (AES-256-GCM,
 * key derived from JWT_ACCESS_SECRET) so a database leak does not expose usable
 * seeds. Time-step tolerance of ±1 window handles minor clock drift.
 */
authenticator.options = { window: 1 };

const KEY = crypto.createHash('sha256').update(config.jwt.accessSecret).digest();

export function generateSecret() {
  return authenticator.generateSecret();
}

export function verifyToken(secret, token) {
  try {
    return authenticator.verify({ token: String(token).trim(), secret });
  } catch {
    return false;
  }
}

export async function buildQrCode(email, secret) {
  const otpauth = authenticator.keyuri(email, config.appName, secret);
  const qrDataUrl = await qrcode.toDataURL(otpauth);
  return { otpauth, qrDataUrl };
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export default { generateSecret, verifyToken, buildQrCode, encryptSecret, decryptSecret };
