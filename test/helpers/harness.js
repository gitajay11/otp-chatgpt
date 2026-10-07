import { loadConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/db.js';
import { createLogger } from '../../server/logger.js';
import { createMailer } from '../../server/services/mailer.js';
import { createSmtpSink, extractCode } from './smtp-sink.js';

const RELAXED_LIMITS = Object.fromEntries(
  ['signupPerIp', 'loginPerIp', 'loginFailuresPerEmail', 'resetPerIp', 'otpSendPerEmail', 'otpVerifyPerIp'].map(
    (key) => [key, { limit: 1000, windowMs: 60_000 }],
  ),
);

/** Starts the real app (in-memory DB) wired to an in-process SMTP sink. */
export async function startTestServer({ rateLimits = {}, config: overrides = {} } = {}) {
  const sink = createSmtpSink();
  const smtpPort = await sink.listen();

  const { config } = loadConfig(
    { NODE_ENV: 'test' },
    {
      databasePath: ':memory:',
      otpSecret: 'test-secret-'.padEnd(48, 'x'),
      secureCookies: false,
      smtp: { host: '127.0.0.1', port: smtpPort, secure: false, user: '', password: '', from: 'Orbit <no-reply@orbit.test>' },
      rateLimits: { ...RELAXED_LIMITS, ...rateLimits },
      ...overrides,
    },
  );
  const logger = createLogger('silent');
  const db = openDatabase(':memory:');
  const mailer = createMailer(config, logger);
  const app = createApp({ config, db, mailer, logger });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    db,
    sink,
    config,
    client: () => new TestClient(baseUrl),
    /** Waits for the next email to `to` after `afterCount` messages and returns its code. */
    async nextCode(to, afterCount = 0) {
      for (let i = 0; i < 100; i += 1) {
        const message = sink.messages.slice(afterCount).find((m) => m.to.includes(to));
        if (message) return extractCode(message.raw);
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`No email received for ${to}`);
    },
    async close() {
      app.locals.close();
      mailer.close();
      await new Promise((resolve) => server.close(resolve));
      await sink.close();
      db.close();
    },
  };
}

/** fetch wrapper with a cookie jar and automatic CSRF header. Records every response body. */
export class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.jar = new Map();
    this.bodies = [];
  }

  async request(method, path, body, { csrf = true, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    if (csrf && method !== 'GET') {
      if (!this.jar.has('csrf_token')) await this.request('GET', '/api/auth/session');
      requestHeaders['x-csrf-token'] = this.jar.get('csrf_token');
    }
    if (this.jar.size) requestHeaders.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');

    const res = await fetch(this.baseUrl + path, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of res.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(';');
      const name = pair.slice(0, pair.indexOf('=')).trim();
      const value = pair.slice(pair.indexOf('=') + 1).trim();
      const cleared = !value || attributes.some((a) => /expires=Thu, 01 Jan 1970/i.test(a));
      if (cleared) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    this.bodies.push(text);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON body
    }
    return { status: res.status, body: json, headers: res.headers, setCookies: res.headers.getSetCookie() };
  }

  get(path, options) {
    return this.request('GET', path, undefined, options);
  }

  post(path, body, options) {
    return this.request('POST', path, body ?? {}, options);
  }
}

export const signupInput = (overrides = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phoneCountry: 'US',
  phone: '(201) 555-0123',
  password: 'Analytical#Engine1',
  confirmPassword: 'Analytical#Engine1',
  ...overrides,
});
