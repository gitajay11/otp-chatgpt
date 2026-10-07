export function createUserService({ db, now = Date.now }) {
  return {
    findByEmail: (email) => db.get('SELECT * FROM users WHERE email = ?', email),

    findById: (id) => db.get('SELECT * FROM users WHERE id = ?', id),

    create({ firstName, lastName, email, phoneCountry, phoneE164, passwordHash }) {
      const time = now();
      const { lastInsertRowid } = db.run(
        `INSERT INTO users
           (first_name, last_name, email, phone_country, phone_e164, password_hash,
            email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        firstName, lastName, email, phoneCountry, phoneE164, passwordHash, time, time, time,
      );
      return db.get('SELECT * FROM users WHERE id = ?', lastInsertRowid);
    },

    updatePassword(id, passwordHash) {
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', passwordHash, now(), id);
    },
  };
}

/** The only user shape that ever leaves the server. */
export function toPublicUser(user) {
  return {
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone_e164,
    phoneCountry: user.phone_country,
    emailVerified: Boolean(user.email_verified_at),
    createdAt: new Date(user.created_at).toISOString(),
  };
}
