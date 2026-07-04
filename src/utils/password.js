import argon2 from 'argon2';
import crypto from 'node:crypto';

/**
 * Password hashing using Argon2id — the current OWASP recommendation.
 * Also provides helpers for one-way token hashing (reset/verify tokens are
 * stored hashed so a DB leak does not expose usable tokens).
 */
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain) {
  return argon2.hash(plain, ARGON_OPTS);
}

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Cryptographically-random URL-safe token (e.g. for email verify / reset). */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Deterministic SHA-256 hash for storing opaque tokens. */
export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Numeric OTP of given length (default 6 digits). */
export function generateNumericOtp(length = 6) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(length, '0');
}

export default { hashPassword, verifyPassword, randomToken, sha256, generateNumericOtp };
