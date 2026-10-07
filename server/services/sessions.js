import { randomToken, sha256 } from '../security/crypto.js';

const DAY = 24 * 60 * 60_000;
const TOUCH_INTERVAL = 15 * 60_000;

/**
 * Opaque, server-side sessions. The browser holds a random token in an
 * HttpOnly cookie; the database only stores its SHA-256 hash.
 */
export function createSessionService({ db, config, now = Date.now }) {
  const idleMs = config.session.ttlDays * DAY;
  const absoluteMs = config.session.absoluteDays * DAY;

  return {
    create(userId, { ip, userAgent } = {}) {
      const token = randomToken(32);
      const time = now();
      const expiresAt = time + idleMs;
      db.run(
        `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sha256(token), userId, time, time, expiresAt, ip ?? null, userAgent?.slice(0, 255) ?? null,
      );
      return { token, expiresAt };
    },

    /**
     * Resolves a session token. Sliding expiration: active sessions are extended
     * (at most every 15 minutes) up to an absolute lifetime.
     * Returns { status: 'none' | 'invalid' | 'expired' | 'valid', ... }.
     */
    resolve(token) {
      if (!token) return { status: 'none' };
      const tokenHash = sha256(token);
      const session = db.get('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
      if (!session) return { status: 'invalid' };

      const time = now();
      const hardLimit = session.created_at + absoluteMs;
      if (session.expires_at <= time || hardLimit <= time) {
        db.run('DELETE FROM sessions WHERE id = ?', session.id);
        return { status: 'expired' };
      }

      const user = db.get('SELECT * FROM users WHERE id = ?', session.user_id);
      if (!user) return { status: 'invalid' };

      let renewed = false;
      if (time - session.last_seen_at >= TOUCH_INTERVAL) {
        session.last_seen_at = time;
        session.expires_at = Math.min(time + idleMs, hardLimit);
        db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', time, session.expires_at, session.id);
        renewed = true;
      }
      return { status: 'valid', session, user, renewed };
    },

    destroy(token) {
      if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    },

    destroyAllForUser(userId) {
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    },
  };
}
