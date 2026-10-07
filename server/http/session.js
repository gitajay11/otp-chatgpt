import { AppError } from './errors.js';
import { cookieNames } from './cookies.js';

export function sessionCookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    ...(expiresAt && { expires: new Date(expiresAt) }),
  };
}

/** Attaches `req.auth` ({ status, user, session, token }) to every API request. */
export function loadSession({ config, sessions }) {
  const { session: cookieName } = cookieNames(config.secureCookies);

  return (req, res, next) => {
    const token = req.cookies[cookieName];
    const result = sessions.resolve(token);
    req.auth = { ...result, token };

    if (result.status === 'invalid' || result.status === 'expired') {
      res.clearCookie(cookieName, sessionCookieOptions(config));
    } else if (result.renewed) {
      res.cookie(cookieName, token, sessionCookieOptions(config, result.session.expires_at));
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (req.auth?.status === 'valid') return next();
  if (req.auth?.status === 'expired') {
    throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  throw new AppError(401, 'UNAUTHENTICATED', 'Please log in to continue.');
}
