import crypto from 'node:crypto';

const MINUTE = 60_000;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function readBool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return TRUE_VALUES.has(String(raw).trim().toLowerCase());
}

function readInt(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readTrustProxy(raw) {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // e.g. "loopback" or a comma-separated subnet list
}

/** Default rate-limit rules. `windowMs` is the fixed window length. */
export const DEFAULT_RATE_LIMITS = {
  signupPerIp: { limit: 10, windowMs: 15 * MINUTE },
  loginPerIp: { limit: 30, windowMs: 15 * MINUTE },
  loginFailuresPerEmail: { limit: 8, windowMs: 15 * MINUTE },
  resetPerIp: { limit: 10, windowMs: 15 * MINUTE },
  otpSendPerEmail: { limit: 8, windowMs: 60 * MINUTE },
  otpVerifyPerIp: { limit: 40, windowMs: 10 * MINUTE },
};

export function loadConfig(env = process.env, overrides = {}) {
  const isProd = env.NODE_ENV === 'production';
  const smtpPort = readInt(env, 'SMTP_PORT', 587, { min: 1, max: 65535 });

  const config = {
    isProd,
    port: readInt(env, 'PORT', 3000, { min: 0, max: 65535 }),
    host: env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
    appName: env.APP_NAME || 'Orbit',
    appOrigin: env.APP_ORIGIN ? env.APP_ORIGIN.replace(/\/+$/, '') : null,
    trustProxy: readTrustProxy(env.TRUST_PROXY),
    databasePath: env.DATABASE_PATH || './data/app.db',
    secureCookies: readBool(env, 'COOKIE_SECURE', isProd),
    logLevel: env.LOG_LEVEL || 'info',
    otpSecret: env.OTP_SECRET || '',
    loginOtpRequired: readBool(env, 'LOGIN_OTP_REQUIRED', true),
    otp: {
      ttlSeconds: readInt(env, 'OTP_TTL_SECONDS', 120, { min: 30, max: 900 }),
      resendCooldownSeconds: readInt(env, 'OTP_RESEND_COOLDOWN_SECONDS', 30, { min: 10, max: 600 }),
      maxAttempts: readInt(env, 'OTP_MAX_ATTEMPTS', 5, { min: 1, max: 10 }),
      maxSendsPerFlow: 5,
      flowTtlMinutes: 15,
    },
    session: {
      ttlDays: readInt(env, 'SESSION_TTL_DAYS', 7, { min: 1, max: 90 }),
      absoluteDays: 30,
    },
    smtp: {
      host: env.SMTP_HOST || '',
      port: smtpPort,
      secure: readBool(env, 'SMTP_SECURE', smtpPort === 465),
      user: env.SMTP_USER || '',
      password: env.SMTP_PASSWORD || '',
      from: env.SMTP_FROM || '',
    },
    rateLimits: { ...DEFAULT_RATE_LIMITS },
  };

  for (const [key, value] of Object.entries(overrides)) {
    config[key] =
      value && typeof value === 'object' && !Array.isArray(value) && config[key]
        ? { ...config[key], ...value }
        : value;
  }

  const warnings = [];
  if (config.isProd) {
    const missing = [];
    if (config.otpSecret.length < 32) missing.push('OTP_SECRET (at least 32 characters)');
    if (!config.smtp.host) missing.push('SMTP_HOST');
    if (!config.smtp.from) missing.push('SMTP_FROM');
    if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}.`);
    if (!config.appOrigin) warnings.push('APP_ORIGIN is not set; Origin checks fall back to the Host header.');
  } else if (!config.otpSecret) {
    // Development convenience only: codes issued before a restart become invalid.
    config.otpSecret = crypto.randomBytes(32).toString('base64url');
    warnings.push('OTP_SECRET is not set; using a temporary secret for this process.');
  }
  if (!config.smtp.host) warnings.push('SMTP_HOST is not set; verification emails cannot be sent.');
  if (!config.smtp.from) config.smtp.from = `${config.appName} <no-reply@localhost>`;

  return { config, warnings };
}
