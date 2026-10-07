import { AppError } from '../http/errors.js';
import { generateNumericCode, hmacSha256, randomToken, safeEqual, sha256 } from '../security/crypto.js';
import { OTP_LENGTH, maskEmail } from '../../shared/validation.js';
import { MailDeliveryError } from './mailer.js';

const flowNotFound = () =>
  new AppError(410, 'VERIFICATION_NOT_FOUND', 'This verification session has ended. Please start again.');

const sendFailed = () =>
  new AppError(502, 'OTP_SEND_FAILED', "We couldn't send the verification email. Please try again in a moment.");

/**
 * Email OTP verification flows (signup, login, password reset).
 *
 * - Codes come from the CSPRNG and are stored only as HMAC-SHA256(secret, flow:code).
 * - Each flow is identified by a random token kept in an HttpOnly cookie
 *   (only its SHA-256 is stored).
 * - Codes expire, allow a limited number of attempts and are consumed exactly once.
 * - Resending replaces the stored hash, which invalidates the previous code.
 */
export function createOtpService({ db, mailer, config, logger, now = Date.now }) {
  const { ttlSeconds, resendCooldownSeconds, maxAttempts, maxSendsPerFlow, flowTtlMinutes } = config.otp;
  const ttlMs = ttlSeconds * 1000;
  const cooldownMs = resendCooldownSeconds * 1000;

  const hashCode = (flowHash, code) => hmacSha256(config.otpSecret, `${flowHash}:${code}`);

  function findActiveFlow(flowToken, purpose) {
    if (!flowToken) return null;
    const row = db.get('SELECT * FROM email_verifications WHERE flow_hash = ?', sha256(flowToken));
    if (!row || row.purpose !== purpose || row.verified_at || row.invalidated_at || row.flow_expires_at <= now()) {
      return null;
    }
    return row;
  }

  function publicInfo(row) {
    const time = now();
    return {
      destination: maskEmail(row.email),
      length: OTP_LENGTH,
      expiresIn: Math.max(0, Math.ceil((row.expires_at - time) / 1000)),
      resendIn: Math.max(0, Math.ceil((row.last_sent_at + cooldownMs - time) / 1000)),
      attemptsLeft: Math.max(0, maxAttempts - row.attempts),
    };
  }

  /**
   * Password-reset flows answer identically whether or not the account exists,
   * so their emails are sent in the background and failures are only logged.
   */
  async function deliver(row, code) {
    const message = { to: row.email, code, purpose: row.purpose, ttlSeconds };
    if (row.purpose !== 'password_reset') return mailer.sendVerificationCode(message);
    if (!row.user_id) return undefined;
    mailer.sendVerificationCode(message).catch(() => {
      logger.warn('Background password-reset email failed');
    });
    return undefined;
  }

  return {
    async start({ purpose, email, userId = null, payload = null }) {
      const time = now();
      // Starting a new flow invalidates any unfinished flow for the same email and purpose.
      db.run(
        `UPDATE email_verifications SET invalidated_at = ?
         WHERE email = ? AND purpose = ? AND verified_at IS NULL AND invalidated_at IS NULL`,
        time, email, purpose,
      );

      const flowToken = randomToken(32);
      const flowHash = sha256(flowToken);
      const code = generateNumericCode(OTP_LENGTH);
      const { lastInsertRowid } = db.run(
        `INSERT INTO email_verifications
           (flow_hash, purpose, email, user_id, payload, otp_hash, expires_at, last_sent_at, flow_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        flowHash, purpose, email, userId, payload ? JSON.stringify(payload) : null,
        hashCode(flowHash, code), time + ttlMs, time, time + flowTtlMinutes * 60_000, time,
      );
      const row = db.get('SELECT * FROM email_verifications WHERE id = ?', lastInsertRowid);

      try {
        await deliver(row, code);
      } catch (error) {
        db.run('UPDATE email_verifications SET invalidated_at = ? WHERE id = ?', now(), row.id);
        if (error instanceof MailDeliveryError) throw sendFailed();
        throw error;
      }
      return { flowToken, info: publicInfo(row) };
    },

    /** `beforeSend(email)` runs once all flow checks pass, e.g. for per-email rate limits. */
    async resend(flowToken, purpose, { beforeSend } = {}) {
      const row = findActiveFlow(flowToken, purpose);
      if (!row) throw flowNotFound();

      const time = now();
      const waitMs = row.last_sent_at + cooldownMs - time;
      if (waitMs > 0) {
        const retryAfter = Math.ceil(waitMs / 1000);
        throw new AppError(429, 'OTP_RESEND_COOLDOWN', `You can request a new code in ${retryAfter}s.`, { retryAfter });
      }
      if (row.send_count >= maxSendsPerFlow) {
        throw new AppError(429, 'OTP_SEND_LIMIT', "You've requested too many codes. Please start again later.");
      }
      beforeSend?.(row.email);

      const code = generateNumericCode(OTP_LENGTH);
      // Conditional update claims the resend slot, so concurrent requests can't both send.
      const claimed = db.run(
        `UPDATE email_verifications
         SET otp_hash = ?, expires_at = ?, attempts = 0, last_sent_at = ?, send_count = send_count + 1
         WHERE id = ? AND last_sent_at = ? AND verified_at IS NULL AND invalidated_at IS NULL`,
        hashCode(row.flow_hash, code), time + ttlMs, time, row.id, row.last_sent_at,
      );
      if (claimed.changes === 0) {
        throw new AppError(429, 'OTP_RESEND_COOLDOWN', 'A new code was just sent. Please check your inbox.', {
          retryAfter: resendCooldownSeconds,
        });
      }

      const updated = db.get('SELECT * FROM email_verifications WHERE id = ?', row.id);
      try {
        await deliver(updated, code);
      } catch (error) {
        // Allow an immediate retry; the undelivered code stays unusable because nobody received it.
        db.run('UPDATE email_verifications SET last_sent_at = ? WHERE id = ?', row.last_sent_at, row.id);
        if (error instanceof MailDeliveryError) throw sendFailed();
        throw error;
      }
      return publicInfo(updated);
    },

    /**
     * Checks a code and consumes the flow on success. Failed attempts are persisted
     * immediately, so callers must not wrap this in a transaction that could roll
     * them back. It is synchronous, so the caller's follow-up action runs before
     * any other request is handled.
     */
    verify(flowToken, purpose, code) {
      const row = findActiveFlow(flowToken, purpose);
      if (!row) throw flowNotFound();

      if (row.attempts >= maxAttempts) throw tooManyAttempts();
      if (row.expires_at <= now()) {
        throw new AppError(410, 'OTP_EXPIRED', 'This code has expired. Request a new code.');
      }

      const counted = db.run(
        `UPDATE email_verifications SET attempts = attempts + 1
         WHERE id = ? AND attempts < ? AND verified_at IS NULL AND invalidated_at IS NULL`,
        row.id, maxAttempts,
      );
      if (counted.changes === 0) throw tooManyAttempts();

      if (!safeEqual(hashCode(row.flow_hash, code), row.otp_hash)) {
        const attemptsLeft = maxAttempts - (row.attempts + 1);
        if (attemptsLeft <= 0) throw tooManyAttempts();
        throw new AppError(422, 'OTP_INVALID', 'Incorrect verification code. Please try again.', {
          details: { attemptsLeft },
        });
      }

      const consumed = db.run(
        'UPDATE email_verifications SET verified_at = ? WHERE id = ? AND verified_at IS NULL AND invalidated_at IS NULL',
        now(), row.id,
      );
      if (consumed.changes === 0) throw flowNotFound();

      return { email: row.email, userId: row.user_id, payload: row.payload ? JSON.parse(row.payload) : null };
    },
  };
}

const tooManyAttempts = () =>
  new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code to continue.');
