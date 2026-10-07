# Orbit — Sign up & login with email OTP

A full-stack authentication flow: sign up, log in and reset a password, each confirmed with a
**5-digit email code sent over SMTP**. Codes are generated, stored (as HMACs) and verified only on the server.
The UI is a dark, glassy single-page app with an animated OTP component.

- **Server:** Node 22.13+ · Express 5 · built-in `node:sqlite` · built-in `crypto` (scrypt, CSPRNG) · Nodemailer
- **Client:** React 19 · Vite · plain CSS (no UI or animation libraries)
- **Shared:** `libphonenumber-js` validates mobile numbers identically in the browser and on the server

## Quick start

```bash
npm install
cp .env.example .env        # then edit SMTP_* and OTP_SECRET
npm run dev                 # http://localhost:3000
```

No SMTP server handy? Run the local mail catcher in a second terminal. It prints every email
(including the code) to that terminal and never delivers anything:

```bash
npm run mail:dev            # SMTP on 127.0.0.1:1025
```

…and point `.env` at it: `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, leave `SMTP_USER` empty.

| Script | What it does |
| --- | --- |
| `npm run dev` | API + Vite dev server (HMR) on one port |
| `npm run build` | Production client build → `dist/client` |
| `npm start` | Production server (serves the built client) |
| `npm test` | Integration tests against a real SMTP sink + unit tests |
| `npm run mail:dev` | Local SMTP catcher for development |

> `npm run dev` doesn't auto-restart on server changes. Node's `--watch` loops endlessly on Windows
> machines with NTFS last-access updates enabled, so restart it after editing `server/`. The client hot-reloads.

## Configuration

All configuration comes from environment variables (see [.env.example](.env.example)). Only
`VITE_*` variables reach the browser bundle; SMTP settings and secrets never do.

| Variable | Default | Notes |
| --- | --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | — / 587 / auto | `SMTP_SECURE=true` for implicit TLS (465). In production STARTTLS is required on other ports. |
| `OTP_SECRET` | random per process in dev | **Required in production** (≥ 32 chars). Key for hashing codes at rest. |
| `OTP_TTL_SECONDS` | 120 | Code lifetime |
| `OTP_RESEND_COOLDOWN_SECONDS` | 30 | Minimum gap between sends |
| `OTP_MAX_ATTEMPTS` | 5 | Wrong guesses before the code locks |
| `LOGIN_OTP_REQUIRED` | true | Require an email code after a correct password |
| `SESSION_TTL_DAYS` | 7 | Sliding idle timeout (absolute cap: 30 days) |
| `APP_ORIGIN` | — | Public origin for the CSRF Origin check in production |
| `TRUST_PROXY` | false | Set behind a reverse proxy so rate limits see real client IPs |
| `COOKIE_SECURE` | true in production | Secure, `__Host-` prefixed cookies (needs HTTPS) |
| `DATABASE_PATH` | `./data/app.db` | SQLite file |

## How it works

```
Sign up:  form ─▶ POST /api/auth/signup ─▶ email code ─▶ POST /api/auth/signup/verify-otp ─▶ account created + session
Log in:   form ─▶ POST /api/auth/login (password checked) ─▶ email code ─▶ POST /api/auth/login/verify-otp ─▶ session
Reset:    form ─▶ POST /api/auth/password-reset ─▶ email code ─▶ POST /api/auth/password-reset/verify-otp ─▶ password changed + session
```

All three flows share **one** server implementation ([server/services/otp.js](server/services/otp.js))
and **one** UI component ([`<OTPVerification />`](client/src/components/otp/OTPVerification.jsx)).

### API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/session` | Current session (also issues the CSRF cookie) |
| `POST` | `/api/auth/signup` | Validate details, email a code |
| `POST` | `/api/auth/login` | Check credentials, email a code |
| `POST` | `/api/auth/password-reset` | Email a code to confirm a new password |
| `POST` | `/api/auth/{signup,login,password-reset}/send-otp` | Resend (cooldown + per-flow limit) |
| `POST` | `/api/auth/{signup,login,password-reset}/verify-otp` | Verify `{ code }`, complete the flow |
| `POST` | `/api/auth/logout` | Destroy the session |
| `GET` | `/api/account` | Example protected endpoint |

Errors are always `{ error: { code, message, fields?, retryAfter? } }` with user-safe messages
(`EMAIL_TAKEN`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `OTP_RESEND_COOLDOWN`,
`OTP_SEND_FAILED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `SESSION_EXPIRED`, …).

### Database

`users`, `sessions` and `email_verifications` in SQLite, migrated on startup ([server/db.js](server/db.js)).
A user row exists only after the email is verified; pending signup details wait inside the
verification row and are pruned 24 h after the flow expires.

### `<OTPVerification />`

```jsx
<OTPVerification
  length={5}
  destination="u***@gmail.com"
  expiresIn={120}
  resendIn={30}
  onVerify={(code) => api('/auth/login/verify-otp', { method: 'POST', body: { code } })}
  onResend={async () => (await api('/auth/login/send-otp', { method: 'POST' })).verification}
  onSuccess={(result) => …}
/>
```

Five inputs backed by one state array: auto-focus, auto-advance, Backspace/Delete/arrow/Home/End
keys, paste or OS autofill of the full code, numeric keypad on phones, and no non-digits accepted.
When the fifth digit lands, the boxes gather into an orbit and rotate (digits counter-rotate to stay
upright) while the server checks the code. The result is applied at the end of a rotation so
nothing snaps. Success collapses the boxes into a drawn ✓. Failure returns them to the row with a
shake and a red ✕ message. With `prefers-reduced-motion`, the orbit is replaced by a simple fade.
The motion lives entirely in [otp.css](client/src/components/otp/otp.css) and uses only transforms
and opacity.

## Security

- **Passwords:** scrypt (N=2¹⁵, r=8, p=3) with a per-user salt. Unknown emails take the same time as wrong passwords.
- **Codes:** `crypto.randomInt` → exactly 5 digits. Stored as `HMAC-SHA256(OTP_SECRET, flow:code)` and compared in constant time. Codes expire, are single-use, lock after 5 wrong attempts, and are replaced (the old one invalidated) on resend. They are never returned by the API, logged or stored in the browser.
- **Flows:** bound to the browser by a random token in an HttpOnly, `SameSite=Strict` cookie scoped to `/api/auth`. A code for one purpose can't complete another.
- **Sessions:** a random 256-bit token in an HttpOnly, `SameSite=Lax` cookie (`Secure` and `__Host-` in production). Only its SHA-256 is stored. Rotated on every sign-in, with sliding expiry and an absolute cap. Logout and password reset revoke sessions server-side.
- **CSRF:** a double-submit token (`X-CSRF-Token` header must match the cookie) plus an Origin check on every state-changing request.
- **Rate limits:** per-IP limits on signup, login, reset and verification; per-email limits on failed logins and on emails sent; a resend cooldown; and a send cap per flow. The limiter is in-memory, so use a shared store such as Redis when running multiple instances.
- **Headers:** a strict CSP in production, HSTS when secure, `X-Frame-Options: DENY`, `nosniff`, `no-store` on API responses.
- **Validation:** every field is re-validated on the server with the same rules the client uses.

Known trade-off: signup reports "email already registered", as the spec requires, which reveals
that an account exists. Password reset does not reveal it.

## Project layout

```
server/            Express API (config, db, routes, services, security, http helpers)
shared/            Validation shared by client and server
client/            Vite + React SPA
  src/components/  OTPVerification, form controls, icons, UI primitives
  src/pages/       Auth flows (sign up / log in / reset) and the dashboard
test/              node:test suites + in-process SMTP sink
scripts/           Dev mail catcher
```
