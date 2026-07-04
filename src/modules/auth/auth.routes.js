import { Router } from 'express';
import * as ctrl from './auth.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import * as v from './auth.validators.js';

const router = Router();

// ─────────────────────────── Public (rate-limited) ──────────────────────
/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Authenticate with email + password
 *     description: Returns an access/refresh token pair, or an MFA challenge when the account has MFA enabled.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: admin@hrms.local }
 *               password: { type: string, example: "Admin@12345" }
 *               deviceName: { type: string, example: "Chrome on Windows" }
 *     responses:
 *       200:
 *         description: Login success (tokens) or MFA challenge
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/AuthTokens'
 *                 - $ref: '#/components/schemas/MfaChallenge'
 *       401: { $ref: '#/components/responses/UnauthorizedError' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many attempts (rate limited) }
 */
router.post('/login', authRateLimiter, validate({ body: v.loginSchema }), ctrl.login);

/**
 * @openapi
 * /auth/mfa/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Complete login by verifying the TOTP code
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, mfaToken, code]
 *             properties:
 *               userId: { type: string }
 *               mfaToken: { type: string, description: The mfaToken returned by /auth/login }
 *               code: { type: string, example: "123456" }
 *     responses:
 *       200: { description: Login successful, content: { application/json: { schema: { $ref: '#/components/schemas/AuthTokens' } } } }
 *       401: { $ref: '#/components/responses/UnauthorizedError' }
 */
router.post('/mfa/verify', authRateLimiter, validate({ body: v.mfaVerifySchema }), ctrl.verifyMfa);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access/refresh pair
 *     description: Refresh tokens rotate on every use; reusing a rotated token revokes all sessions (reuse detection). The token may be sent in the body or via the httpOnly cookie set at login.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: New token pair, content: { application/json: { schema: { $ref: '#/components/schemas/AuthTokens' } } } }
 *       401: { $ref: '#/components/responses/UnauthorizedError' }
 */
router.post('/refresh', validate({ body: v.refreshSchema }), ctrl.refresh);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset link
 *     description: Always returns 200 to prevent user enumeration.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties: { email: { type: string, format: email } }
 *     responses:
 *       200: { description: Reset link sent if the account exists }
 */
router.post('/forgot-password', authRateLimiter, validate({ body: v.forgotPasswordSchema }), ctrl.forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using an emailed token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string, example: "N3wPassw0rd!" }
 *     responses:
 *       200: { description: Password reset; all sessions revoked }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/reset-password', authRateLimiter, validate({ body: v.resetPasswordSchema }), ctrl.resetPassword);

/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify email using an emailed token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties: { token: { type: string } }
 *     responses:
 *       200: { description: Email verified }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/verify-email', validate({ body: v.verifyEmailSchema }), ctrl.verifyEmail);

// ─────────────────────────── Authenticated ──────────────────────────────
router.use(authenticate);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the current authenticated user
 *     responses:
 *       200: { description: Current user, content: { application/json: { schema: { $ref: '#/components/schemas/AuthUser' } } } }
 *       401: { $ref: '#/components/responses/UnauthorizedError' }
 */
router.get('/me', ctrl.me);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out the current session
 *     responses: { 200: { description: Logged out } }
 */
router.post('/logout', ctrl.logout);

/**
 * @openapi
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Log out of all other sessions/devices
 *     responses: { 200: { description: Other sessions revoked } }
 */
router.post('/logout-all', ctrl.logoutAll);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password (revokes other sessions)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, example: "N3wPassw0rd!" }
 *     responses:
 *       200: { description: Password changed }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/change-password', validate({ body: v.changePasswordSchema }), ctrl.changePassword);

/**
 * @openapi
 * /auth/send-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Resend the email-verification link to the current user
 *     responses: { 200: { description: Verification email sent } }
 */
router.post('/send-verification', ctrl.sendVerification);

/**
 * @openapi
 * /auth/mfa/setup:
 *   post:
 *     tags: [Auth]
 *     summary: Begin MFA setup — returns a TOTP secret and QR code
 *     responses:
 *       201:
 *         description: Scan the QR with an authenticator app, then confirm via /auth/mfa/enable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 secret: { type: string }
 *                 otpauth: { type: string }
 *                 qrDataUrl: { type: string, description: Base64 data URL of the QR image }
 */
router.post('/mfa/setup', ctrl.setupMfa);

/**
 * @openapi
 * /auth/mfa/enable:
 *   post:
 *     tags: [Auth]
 *     summary: Confirm and enable MFA with a TOTP code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [code], properties: { code: { type: string, example: "123456" } } }
 *     responses:
 *       200: { description: MFA enabled }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/mfa/enable', validate({ body: v.enableMfaSchema }), ctrl.enableMfa);

/**
 * @openapi
 * /auth/mfa/disable:
 *   post:
 *     tags: [Auth]
 *     summary: Disable MFA (requires the account password)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [password], properties: { password: { type: string } } }
 *     responses:
 *       200: { description: MFA disabled }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/mfa/disable', validate({ body: v.disableMfaSchema }), ctrl.disableMfa);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Auth]
 *     summary: List active sessions for the current user
 *     responses:
 *       200:
 *         description: Active sessions
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Session' } }
 */
router.get('/sessions', ctrl.listSessions);

/**
 * @openapi
 * /auth/sessions/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Revoke a specific session
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: Session revoked }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.delete('/sessions/:id', validate({ params: v.idParam }), ctrl.revokeSessionById);

/**
 * @openapi
 * /auth/devices:
 *   get:
 *     tags: [Auth]
 *     summary: List known devices for the current user
 *     responses:
 *       200:
 *         description: Devices
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Device' } }
 */
router.get('/devices', ctrl.listDevices);

/**
 * @openapi
 * /auth/devices/{id}/trust:
 *   patch:
 *     tags: [Auth]
 *     summary: Mark a device as trusted / untrusted
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [trusted], properties: { trusted: { type: boolean } } }
 *     responses:
 *       200: { description: Device updated, content: { application/json: { schema: { $ref: '#/components/schemas/Device' } } } }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.patch('/devices/:id/trust', validate({ params: v.idParam, body: v.trustDeviceSchema }), ctrl.trustDevice);

/**
 * @openapi
 * /auth/devices/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Remove a device and revoke its sessions
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       200: { description: Device removed }
 *       404: { $ref: '#/components/responses/NotFoundError' }
 */
router.delete('/devices/:id', validate({ params: v.idParam }), ctrl.removeDevice);

export default router;
