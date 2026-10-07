import nodemailer from 'nodemailer';
import { verificationEmail } from './emailTemplates.js';

export class MailDeliveryError extends Error {}

/**
 * SMTP mailer. Credentials come from configuration only and never leave the server.
 * Nodemailer's own logger stays disabled so message bodies (codes) are never logged.
 */
export function createMailer(config, logger) {
  const { smtp } = config;

  if (!smtp.host) {
    return {
      configured: false,
      async sendVerificationCode() {
        throw new MailDeliveryError('SMTP is not configured');
      },
      async verifyConnection() {
        return false;
      },
      close() {},
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: config.isProd && !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  });

  return {
    configured: true,

    async sendVerificationCode({ to, code, purpose, ttlSeconds }) {
      const { subject, text, html } = verificationEmail({ appName: config.appName, code, purpose, ttlSeconds });
      try {
        await transport.sendMail({ from: smtp.from, to, subject, text, html });
      } catch (error) {
        logger.error('SMTP delivery failed', { purpose, code: error.code, responseCode: error.responseCode });
        throw new MailDeliveryError('SMTP delivery failed');
      }
    },

    async verifyConnection() {
      try {
        await transport.verify();
        return true;
      } catch (error) {
        logger.warn('SMTP connection check failed', { code: error.code, responseCode: error.responseCode });
        return false;
      }
    },

    close: () => transport.close(),
  };
}
