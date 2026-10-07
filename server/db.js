import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Each entry upgrades the schema by one version (tracked in PRAGMA user_version).
// All timestamps are Unix epoch milliseconds.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id                INTEGER PRIMARY KEY,
    first_name        TEXT    NOT NULL,
    last_name         TEXT    NOT NULL,
    email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    phone_country     TEXT    NOT NULL,
    phone_e164        TEXT    NOT NULL,
    password_hash     TEXT    NOT NULL,
    email_verified_at INTEGER NOT NULL,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY,
    token_hash   TEXT    NOT NULL UNIQUE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

  -- One row per verification flow. Only an HMAC of the current code is stored;
  -- resending replaces otp_hash, which invalidates the previous code.
  CREATE TABLE email_verifications (
    id              INTEGER PRIMARY KEY,
    flow_hash       TEXT    NOT NULL UNIQUE,
    purpose         TEXT    NOT NULL CHECK (purpose IN ('signup', 'login', 'password_reset')),
    email           TEXT    NOT NULL COLLATE NOCASE,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    payload         TEXT,
    otp_hash        TEXT    NOT NULL,
    expires_at      INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    send_count      INTEGER NOT NULL DEFAULT 1,
    last_sent_at    INTEGER NOT NULL,
    flow_expires_at INTEGER NOT NULL,
    verified_at     INTEGER,
    invalidated_at  INTEGER,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX idx_email_verifications_email_purpose ON email_verifications(email, purpose);
  CREATE INDEX idx_email_verifications_flow_expires_at ON email_verifications(flow_expires_at);
  `,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(raw);

  const statements = new Map();
  const prepare = (sql) => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = raw.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  return {
    get: (sql, ...params) => prepare(sql).get(...params),
    all: (sql, ...params) => prepare(sql).all(...params),
    run: (sql, ...params) => prepare(sql).run(...params),
    /** Runs `fn` inside a transaction. `fn` must be synchronous. */
    transaction(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        raw.exec('COMMIT');
        return value;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => raw.close(),
  };
}

function migrate(raw) {
  const { user_version: version } = raw.prepare('PRAGMA user_version').get();
  for (let next = version; next < MIGRATIONS.length; next += 1) {
    raw.exec('BEGIN');
    try {
      raw.exec(MIGRATIONS[next]);
      raw.exec(`PRAGMA user_version = ${next + 1}`);
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Removes expired sessions and stale verification flows. */
export function pruneExpired(db, now = Date.now()) {
  db.run('DELETE FROM sessions WHERE expires_at <= ?', now);
  db.run('DELETE FROM email_verifications WHERE flow_expires_at <= ?', now - 24 * 60 * 60_000);
}
