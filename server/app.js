import express from 'express';
import { pruneExpired } from './db.js';
import { cookieParser } from './http/cookies.js';
import { AppError, errorHandler } from './http/errors.js';
import { loadSession, requireAuth } from './http/session.js';
import { createAuthRouter } from './routes/auth.js';
import { csrfProtection } from './security/csrf.js';
import { securityHeaders } from './security/headers.js';
import { createRateLimiter } from './security/rateLimit.js';
import { createOtpService } from './services/otp.js';
import { createSessionService } from './services/sessions.js';
import { createUserService, toPublicUser } from './services/users.js';

/** Builds the Express app with the JSON API mounted under /api. */
export function createApp({ config, db, mailer, logger, now = Date.now }) {
  const users = createUserService({ db, now });
  const sessions = createSessionService({ db, config, now });
  const otp = createOtpService({ db, mailer, config, logger, now });
  const limiter = createRateLimiter({ now });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders(config));
  app.use(cookieParser());

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const started = performance.now();
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0];
      logger.info(`${req.method} ${path} ${res.statusCode} ${Math.round(performance.now() - started)}ms`);
    });
    next();
  });
  api.use(express.json({ limit: '10kb' }));
  api.use(csrfProtection(config));
  api.use(loadSession({ config, sessions }));

  api.use('/auth', createAuthRouter({ config, users, sessions, otp, limiter }));
  api.get('/account', requireAuth, (req, res) => {
    res.json({ user: toPublicUser(req.auth.user) });
  });
  api.use(() => {
    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  });
  api.use(errorHandler(logger));
  app.use('/api', api);

  const pruner = setInterval(() => pruneExpired(db, now()), 10 * 60_000);
  pruner.unref();
  app.locals.close = () => {
    clearInterval(pruner);
    limiter.close();
  };

  return app;
}
