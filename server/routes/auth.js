import express from 'express';
import {
  OTP_LENGTH,
  isOtpCode,
  validateLogin,
  validatePasswordReset,
  validateSignup,
} from '../../shared/validation.js';
import { AppError, validationError } from '../http/errors.js';
import { cookieNames } from '../http/cookies.js';
import { sessionCookieOptions } from '../http/session.js';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../security/passwords.js';
import { toPublicUser } from '../services/users.js';

/** URL segment → verification purpose stored in the database. */
const PURPOSES = { signup: 'signup', login: 'login', 'password-reset': 'password_reset' };

const emailTaken = () =>
  new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.', {
    fields: { email: 'An account with this email already exists. Try logging in instead.' },
  });

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

const iso = (ms) => new Date(ms).toISOString();

export function createAuthRouter({ config, users, sessions, otp, limiter }) {
  const router = express.Router();
  const names = cookieNames(config.secureCookies);
  const limits = config.rateLimits;
  const flowCookie = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/api/auth' };

  function beginVerification(res, flowToken) {
    res.cookie(names.flow, flowToken, { ...flowCookie, maxAge: config.otp.flowTtlMinutes * 60_000 });
  }

  function limitOtpSends(email) {
    limiter.consume(`otp-send:${email}`, limits.otpSendPerEmail, 'Too many verification emails requested. Please try again later.');
  }

  /** Issues a fresh session (rotating any existing one) and returns the response body. */
  function signIn(req, res, user) {
    sessions.destroy(req.auth.token);
    const { token, expiresAt } = sessions.create(user.id, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(names.session, token, sessionCookieOptions(config, expiresAt));
    return { user: toPublicUser(user), session: { expiresAt: iso(expiresAt) } };
  }

  // What a successfully verified code authorises, per purpose.
  const onVerified = {
    signup(req, res, { email, payload }) {
      if (users.findByEmail(email)) throw emailTaken();
      const user = users.create({ ...payload, email });
      return signIn(req, res, user);
    },
    login(req, res, { userId }) {
      const user = users.findById(userId);
      if (!user) throw new AppError(410, 'VERIFICATION_NOT_FOUND', 'This verification session has ended. Please start again.');
      return signIn(req, res, user);
    },
    password_reset(req, res, { userId, payload }) {
      // Flows for unknown emails never had a code delivered; treat any guess as wrong.
      const user = userId && users.findById(userId);
      if (!user) throw new AppError(422, 'OTP_INVALID', 'Incorrect verification code. Please try again.');
      users.updatePassword(user.id, payload.passwordHash);
      sessions.destroyAllForUser(user.id);
      return signIn(req, res, { ...user, password_hash: payload.passwordHash });
    },
  };

  router.get('/session', (req, res) => {
    const { status, user, session } = req.auth;
    if (status === 'valid') {
      return res.json({ authenticated: true, user: toPublicUser(user), session: { expiresAt: iso(session.expires_at) } });
    }
    return res.json({ authenticated: false, ...(status === 'expired' && { reason: 'expired' }) });
  });

  router.post('/signup', async (req, res) => {
    limiter.consume(`signup:${req.ip}`, limits.signupPerIp);
    const { valid, errors, values } = validateSignup(req.body);
    if (!valid) throw validationError(errors);
    if (users.findByEmail(values.email)) throw emailTaken();
    limitOtpSends(values.email);

    const passwordHash = await hashPassword(values.password);
    const { flowToken, info } = await otp.start({
      purpose: 'signup',
      email: values.email,
      payload: {
        firstName: values.firstName,
        lastName: values.lastName,
        phoneCountry: values.phoneCountry,
        phoneE164: values.phoneE164,
        passwordHash,
      },
    });
    beginVerification(res, flowToken);
    res.status(201).json({ verification: info });
  });

  router.post('/login', async (req, res) => {
    limiter.consume(`login:${req.ip}`, limits.loginPerIp);
    const { valid, errors, values } = validateLogin(req.body);
    if (!valid) throw validationError(errors);

    const failureKey = `login-fail:${values.email}`;
    limiter.check(failureKey, limits.loginFailuresPerEmail, 'Too many failed attempts. Please try again later or reset your password.');

    const user = users.findByEmail(values.email);
    const ok = user
      ? await verifyPassword(values.password, user.password_hash)
      : await verifyDummyPassword(values.password);
    if (!ok) {
      limiter.hit(failureKey, limits.loginFailuresPerEmail);
      throw invalidCredentials();
    }
    limiter.reset(failureKey);

    if (!config.loginOtpRequired) {
      return res.json({ otpRequired: false, ...signIn(req, res, user) });
    }
    limitOtpSends(user.email);
    const { flowToken, info } = await otp.start({ purpose: 'login', email: user.email, userId: user.id });
    beginVerification(res, flowToken);
    return res.json({ otpRequired: true, verification: info });
  });

  // Answers identically whether or not the account exists (no account enumeration).
  router.post('/password-reset', async (req, res) => {
    limiter.consume(`reset:${req.ip}`, limits.resetPerIp);
    const { valid, errors, values } = validatePasswordReset(req.body);
    if (!valid) throw validationError(errors);
    limitOtpSends(values.email);

    const user = users.findByEmail(values.email);
    const passwordHash = await hashPassword(values.password);
    const { flowToken, info } = await otp.start({
      purpose: 'password_reset',
      email: values.email,
      userId: user?.id ?? null,
      payload: { passwordHash },
    });
    beginVerification(res, flowToken);
    res.status(202).json({ verification: info });
  });

  // Resend + verify are shared by every flow, so there is exactly one OTP implementation.
  for (const [segment, purpose] of Object.entries(PURPOSES)) {
    router.post(`/${segment}/send-otp`, async (req, res) => {
      const verification = await otp.resend(req.cookies[names.flow], purpose, { beforeSend: limitOtpSends });
      res.json({ verification });
    });

    router.post(`/${segment}/verify-otp`, (req, res) => {
      limiter.consume(`otp-verify:${req.ip}`, limits.otpVerifyPerIp);
      const code = req.body?.code;
      if (!isOtpCode(code)) throw validationError({ code: `Enter the ${OTP_LENGTH}-digit code.` });

      const verified = otp.verify(req.cookies[names.flow], purpose, code);
      const body = onVerified[purpose](req, res, verified);
      res.clearCookie(names.flow, flowCookie);
      res.json(body);
    });
  }

  router.post('/logout', (req, res) => {
    sessions.destroy(req.auth.token);
    res.clearCookie(names.session, sessionCookieOptions(config));
    res.status(204).end();
  });

  return router;
}
