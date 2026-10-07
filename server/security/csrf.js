import { AppError } from '../http/errors.js';
import { cookieNames } from '../http/cookies.js';
import { randomToken, safeEqual } from './crypto.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection plus an Origin check.
 * A readable csrf cookie is issued on any API request; state-changing requests
 * must echo it in the X-CSRF-Token header (cross-site pages can't read it).
 */
export function csrfProtection(config) {
  const { csrf: cookieName } = cookieNames(config.secureCookies);

  return (req, res, next) => {
    if (!req.cookies[cookieName]) {
      const token = randomToken(24);
      req.cookies[cookieName] = token;
      res.cookie(cookieName, token, {
        httpOnly: false,
        secure: config.secureCookies,
        sameSite: 'strict',
        path: '/',
      });
    }

    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    const expectedOrigin = config.appOrigin ?? `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== expectedOrigin) throw csrfError();

    const header = req.get('x-csrf-token');
    if (!header || !safeEqual(header, req.cookies[cookieName])) throw csrfError();
    next();
  };
}

const csrfError = () =>
  new AppError(403, 'CSRF_INVALID', 'Your security token is out of date. Please refresh the page and try again.');
