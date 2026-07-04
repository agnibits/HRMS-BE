import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * SMTP transport (Nodemailer). Works with MailHog locally and any SMTP provider
 * (SES, SendGrid, Postmark) in production. Templates are simple functions
 * returning subject + html so they stay dependency-free and testable.
 */
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
  return transporter;
}

export async function sendMail({ to, subject, html, text }) {
  const info = await getTransporter().sendMail({
    from: config.mail.from,
    to,
    subject,
    html,
    text: text ?? html?.replace(/<[^>]+>/g, ' '),
  });
  logger.debug({ to, subject, messageId: info.messageId }, 'email sent');
  return info;
}

// ── Templates ────────────────────────────────────────────────────────────
export const templates = {
  emailVerification: ({ name, url }) => ({
    subject: `Verify your ${config.appName} account`,
    html: `<p>Hi ${name},</p><p>Confirm your email to activate your account:</p>
           <p><a href="${url}">Verify email</a></p>
           <p>This link expires in ${config.security.emailVerifyExpiresHours} hours.</p>`,
  }),
  passwordReset: ({ name, url }) => ({
    subject: `Reset your ${config.appName} password`,
    html: `<p>Hi ${name},</p><p>We received a request to reset your password:</p>
           <p><a href="${url}">Reset password</a></p>
           <p>This link expires in ${config.security.passwordResetExpiresMin} minutes.
           If you didn't request this, you can ignore this email.</p>`,
  }),
  otpCode: ({ name, code }) => ({
    subject: `Your ${config.appName} verification code`,
    html: `<p>Hi ${name},</p><p>Your one-time code is:</p>
           <h2 style="letter-spacing:4px">${code}</h2>
           <p>It expires in ${config.security.otpExpiresMin} minutes.</p>`,
  }),
  welcome: ({ name, email, tempPassword }) => ({
    subject: `Welcome to ${config.appName}`,
    html: `<p>Hi ${name},</p><p>An account has been created for you.</p>
           <p>Email: <b>${email}</b><br/>Temporary password: <b>${tempPassword}</b></p>
           <p>Please sign in and change your password.</p>`,
  }),
};

export default { sendMail, templates };
