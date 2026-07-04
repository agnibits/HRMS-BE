import { z } from 'zod';

/**
 * Zod request schemas for the Auth module. A single strong-password policy is
 * reused everywhere a new password is set.
 */
export const passwordPolicy = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a special character');

const email = z.string().trim().toLowerCase().email('Invalid email address');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
  deviceName: z.string().max(120).optional(),
});

export const mfaVerifySchema = z.object({
  userId: z.string().min(1),
  mfaToken: z.string().min(1),
  code: z.string().min(4).max(10),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(), // may also come from an httpOnly cookie
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: passwordPolicy,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicy,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must differ from current password',
    path: ['newPassword'],
  });

export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const enableMfaSchema = z.object({ code: z.string().min(4).max(10) });
export const disableMfaSchema = z.object({ password: z.string().min(1) });

export const trustDeviceSchema = z.object({ trusted: z.boolean() });

export const idParam = z.object({ id: z.string().min(1) });

export default {
  loginSchema,
  mfaVerifySchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  enableMfaSchema,
  disableMfaSchema,
  trustDeviceSchema,
  idParam,
};
