import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { signupInput, startTestServer } from './helpers/harness.js';

/** Runs a complete signup and returns the logged-in client. */
async function signUp(ctx, overrides = {}) {
  const client = ctx.client();
  const input = signupInput(overrides);
  const before = ctx.sink.messages.length;
  const res = await client.post('/api/auth/signup', input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const code = await ctx.nextCode(input.email, before);
  const verified = await client.post('/api/auth/signup/verify-otp', { code });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return { client, input, code };
}

function assertNoCodeLeak(client, code) {
  for (const body of client.bodies) assert.ok(!body.includes(code), 'an API response contained the OTP');
}

describe('signup', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(() => ctx.close());

  test('sends a 5-digit OTP and creates the account only after verification', async () => {
    const client = ctx.client();
    const input = signupInput({ email: 'Grace@Example.com' });
    const res = await client.post('/api/auth/signup', input);

    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body.verification).sort(), ['attemptsLeft', 'destination', 'expiresIn', 'length', 'resendIn']);
    assert.equal(res.body.verification.destination, 'g***@example.com');
    assert.equal(res.body.verification.length, 5);
    assert.equal(res.body.verification.expiresIn, 120);
    assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', 'grace@example.com').n, 0);

    const code = await ctx.nextCode('grace@example.com');
    assert.match(code, /^\d{5}$/);

    // The flow cookie is HttpOnly and scoped to the auth API.
    const flowCookie = res.setCookies.find((c) => c.startsWith('otp_flow='));
    assert.match(flowCookie, /HttpOnly/i);
    assert.match(flowCookie, /Path=\/api\/auth/i);

    // Only an HMAC of the code is stored, never the code itself.
    const row = ctx.db.get("SELECT * FROM email_verifications WHERE email = ? AND purpose = 'signup'", 'grace@example.com');
    assert.match(row.otp_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes(code));

    const verified = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.user.email, 'grace@example.com');
    assert.equal(verified.body.user.phone, '+12015550123');
    assert.equal(verified.body.user.emailVerified, true);
    assert.equal(verified.body.user.passwordHash, undefined);

    const sessionCookie = verified.setCookies.find((c) => c.startsWith('sid='));
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);

    const user = ctx.db.get('SELECT * FROM users WHERE email = ?', 'grace@example.com');
    assert.match(user.password_hash, /^scrypt\$32768\$8\$3\$/);
    assert.ok(!user.password_hash.includes(input.password));

    const session = await client.get('/api/auth/session');
    assert.equal(session.body.authenticated, true);
    assertNoCodeLeak(client, code);
  });

  test('rejects an email that is already registered', async () => {
    await signUp(ctx, { email: 'taken@example.com' });
    const res = await ctx.client().post('/api/auth/signup', signupInput({ email: 'TAKEN@example.com' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
    assert.ok(res.body.error.fields.email);
  });

  test('validates every field server-side and sends nothing for invalid input', async () => {
    const before = ctx.sink.messages.length;
    const res = await ctx.client().post('/api/auth/signup', {
      firstName: '',
      lastName: '<script>',
      email: 'not-an-email',
      phoneCountry: 'ZZ',
      phone: '12',
      password: 'weakpass',
      confirmPassword: 'different',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(res.body.error.fields).sort(), [
      'confirmPassword', 'email', 'firstName', 'lastName', 'password', 'phoneCountry',
    ]);
    const badPhone = await ctx.client().post('/api/auth/signup', signupInput({ email: 'phone@example.com', phone: '12345' }));
    assert.equal(badPhone.body.error.fields.phone, 'Enter a valid mobile number for the selected country.');
    // UK landline is not a mobile number.
    const landline = await ctx.client().post('/api/auth/signup', signupInput({ email: 'uk@example.com', phoneCountry: 'GB', phone: '020 7946 0000' }));
    assert.ok(landline.body.error.fields.phone);
    assert.equal(ctx.sink.messages.length, before);
  });

  test('wrong code is rejected and counts an attempt', async () => {
    const client = ctx.client();
    await client.post('/api/auth/signup', signupInput({ email: 'wrong@example.com' }));
    const code = await ctx.nextCode('wrong@example.com');
    const wrong = code === '00000' ? '11111' : '00000';

    const res = await client.post('/api/auth/signup/verify-otp', { code: wrong });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'OTP_INVALID');
    assert.equal(res.body.error.attemptsLeft, 4);

    const malformed = await client.post('/api/auth/signup/verify-otp', { code: '12a45' });
    assert.equal(malformed.status, 400);

    const ok = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(ok.status, 200);
  });

  test('a code can only be used once', async () => {
    const client = ctx.client();
    await client.post('/api/auth/signup', signupInput({ email: 'replay@example.com' }));
    const code = await ctx.nextCode('replay@example.com');
    const flow = client.jar.get('otp_flow');
    assert.equal((await client.post('/api/auth/signup/verify-otp', { code })).status, 200);

    client.jar.set('otp_flow', flow); // replay the old flow cookie
    const replay = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(replay.status, 410);
    assert.equal(replay.body.error.code, 'VERIFICATION_NOT_FOUND');
  });

  test('expired codes are refused', async () => {
    const client = ctx.client();
    await client.post('/api/auth/signup', signupInput({ email: 'expired@example.com' }));
    const code = await ctx.nextCode('expired@example.com');
    ctx.db.run('UPDATE email_verifications SET expires_at = ? WHERE email = ?', Date.now() - 1, 'expired@example.com');

    const res = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'OTP_EXPIRED');
    assert.equal(ctx.db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', 'expired@example.com').n, 0);
  });

  test('resend enforces the cooldown, invalidates the old code and restarts expiry', async () => {
    const client = ctx.client();
    const email = 'resend@example.com';
    await client.post('/api/auth/signup', signupInput({ email }));
    const first = await ctx.nextCode(email);

    const tooSoon = await client.post('/api/auth/signup/send-otp');
    assert.equal(tooSoon.status, 429);
    assert.equal(tooSoon.body.error.code, 'OTP_RESEND_COOLDOWN');
    assert.ok(tooSoon.body.error.retryAfter > 0 && tooSoon.body.error.retryAfter <= 30);
    assert.equal(tooSoon.headers.get('retry-after'), String(tooSoon.body.error.retryAfter));

    ctx.db.run('UPDATE email_verifications SET last_sent_at = last_sent_at - 31000, expires_at = ? WHERE email = ?', Date.now() + 5000, email);
    const count = ctx.sink.messages.length;
    const resent = await client.post('/api/auth/signup/send-otp');
    assert.equal(resent.status, 200);
    assert.equal(resent.body.verification.expiresIn, 120);
    assert.equal(resent.body.verification.resendIn, 30);
    const second = await ctx.nextCode(email, count);

    if (first !== second) {
      const old = await client.post('/api/auth/signup/verify-otp', { code: first });
      assert.equal(old.body.error.code, 'OTP_INVALID');
    }
    const ok = await client.post('/api/auth/signup/verify-otp', { code: second });
    assert.equal(ok.status, 200);
    assertNoCodeLeak(client, second);
  });

  test('locks the code after the maximum number of attempts', async () => {
    const client = ctx.client();
    await client.post('/api/auth/signup', signupInput({ email: 'spam@example.com' }));
    const code = await ctx.nextCode('spam@example.com');
    const wrong = code === '99999' ? '88888' : '99999';

    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await client.post('/api/auth/signup/verify-otp', { code: wrong });
      statuses.push(res.body.error.code);
    }
    assert.deepEqual(statuses, ['OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID', 'OTP_TOO_MANY_ATTEMPTS']);

    const correct = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(correct.status, 429);
    assert.equal(correct.body.error.code, 'OTP_TOO_MANY_ATTEMPTS');
  });

  test('starting a new signup invalidates the previous flow', async () => {
    const client = ctx.client();
    await client.post('/api/auth/signup', signupInput({ email: 'twice@example.com' }));
    const firstFlow = client.jar.get('otp_flow');
    const firstCode = await ctx.nextCode('twice@example.com');
    const count = ctx.sink.messages.length;
    await client.post('/api/auth/signup', signupInput({ email: 'twice@example.com' }));
    await ctx.nextCode('twice@example.com', count);

    const other = ctx.client();
    other.jar.set('otp_flow', firstFlow);
    const res = await other.post('/api/auth/signup/verify-otp', { code: firstCode });
    assert.equal(res.body.error.code, 'VERIFICATION_NOT_FOUND');
  });

  test('reports SMTP failures without leaking internals', async () => {
    ctx.sink.failNextDelivery();
    const res = await ctx.client().post('/api/auth/signup', signupInput({ email: 'smtp@example.com' }));
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, 'OTP_SEND_FAILED');
    assert.doesNotMatch(JSON.stringify(res.body), /554|smtp|127\.0\.0\.1|stack/i);
  });
});

describe('login', () => {
  let ctx;
  let account;
  before(async () => {
    ctx = await startTestServer();
    account = await signUp(ctx, { email: 'login@example.com' });
  });
  after(() => ctx.close());

  test('wrong password and unknown email get the same generic error', async () => {
    const wrongPassword = await ctx.client().post('/api/auth/login', { email: 'login@example.com', password: 'Wrong#Password1' });
    const unknown = await ctx.client().post('/api/auth/login', { email: 'nobody@example.com', password: 'Wrong#Password1' });
    for (const res of [wrongPassword, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(res.body.error.message, 'Incorrect email or password.');
    }
  });

  test('valid credentials require the email OTP before a session exists', async () => {
    const client = ctx.client();
    const count = ctx.sink.messages.length;
    const res = await client.post('/api/auth/login', { email: 'LOGIN@example.com', password: account.input.password });
    assert.equal(res.status, 200);
    assert.equal(res.body.otpRequired, true);
    assert.equal(res.body.verification.destination, 'l***@example.com');
    assert.equal(client.jar.has('sid'), false);
    assert.equal((await client.get('/api/account')).status, 401);

    const code = await ctx.nextCode('login@example.com', count);
    // A signup flow token can't be used on the login endpoint and vice versa.
    const crossPurpose = await client.post('/api/auth/signup/verify-otp', { code });
    assert.equal(crossPurpose.body.error.code, 'VERIFICATION_NOT_FOUND');

    const verified = await client.post('/api/auth/login/verify-otp', { code });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.user.email, 'login@example.com');

    // Session persists across requests and survives a "new tab" with the same cookie.
    const account2 = await client.get('/api/account');
    assert.equal(account2.status, 200);
    const sameBrowser = ctx.client();
    sameBrowser.jar.set('sid', client.jar.get('sid'));
    assert.equal((await sameBrowser.get('/api/auth/session')).body.authenticated, true);
    assertNoCodeLeak(client, code);
  });

  test('logout destroys the session server-side', async () => {
    const client = ctx.client();
    const count = ctx.sink.messages.length;
    await client.post('/api/auth/login', { email: 'login@example.com', password: account.input.password });
    await client.post('/api/auth/login/verify-otp', { code: await ctx.nextCode('login@example.com', count) });
    const token = client.jar.get('sid');

    const res = await client.post('/api/auth/logout');
    assert.equal(res.status, 204);
    assert.equal(client.jar.has('sid'), false);

    const stolen = ctx.client();
    stolen.jar.set('sid', token);
    assert.equal((await stolen.get('/api/account')).status, 401);
  });

  test('expired sessions are rejected and reported', async () => {
    async function expiredClient() {
      const client = ctx.client();
      const count = ctx.sink.messages.length;
      await client.post('/api/auth/login', { email: 'login@example.com', password: account.input.password });
      await client.post('/api/auth/login/verify-otp', { code: await ctx.nextCode('login@example.com', count) });
      ctx.db.run('UPDATE sessions SET expires_at = ?', Date.now() - 1);
      return client;
    }

    const api = await expiredClient();
    const res = await api.get('/api/account');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'SESSION_EXPIRED');
    assert.equal(api.jar.has('sid'), false); // cookie cleared

    const page = await expiredClient();
    const status = await page.get('/api/auth/session');
    assert.equal(status.body.authenticated, false);
    assert.equal(status.body.reason, 'expired');
  });

  test('forged session tokens are rejected', async () => {
    const client = ctx.client();
    client.jar.set('sid', 'forged-token');
    assert.equal((await client.get('/api/account')).body.error.code, 'UNAUTHENTICATED');
  });
});

describe('password reset', () => {
  let ctx;
  before(async () => {
    ctx = await startTestServer();
    await signUp(ctx, { email: 'reset@example.com' });
  });
  after(() => ctx.close());

  test('responds identically for unknown emails and sends nothing', async () => {
    const count = ctx.sink.messages.length;
    const res = await ctx.client().post('/api/auth/password-reset', {
      email: 'ghost@example.com', password: 'New#Password1', confirmPassword: 'New#Password1',
    });
    assert.equal(res.status, 202);
    assert.equal(res.body.verification.destination, 'g***@example.com');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ctx.sink.messages.length, count);
  });

  test('changes the password, revokes old sessions and signs in', async () => {
    const old = ctx.client();
    let count = ctx.sink.messages.length;
    await old.post('/api/auth/login', { email: 'reset@example.com', password: signupInput().password });
    await old.post('/api/auth/login/verify-otp', { code: await ctx.nextCode('reset@example.com', count) });
    assert.equal((await old.get('/api/account')).status, 200);

    const client = ctx.client();
    count = ctx.sink.messages.length;
    const res = await client.post('/api/auth/password-reset', {
      email: 'reset@example.com', password: 'Brand#New2Pass', confirmPassword: 'Brand#New2Pass',
    });
    assert.equal(res.status, 202);
    const verified = await client.post('/api/auth/password-reset/verify-otp', { code: await ctx.nextCode('reset@example.com', count) });
    assert.equal(verified.status, 200);

    assert.equal((await old.get('/api/account')).status, 401);
    const login = await ctx.client().post('/api/auth/login', { email: 'reset@example.com', password: 'Brand#New2Pass' });
    assert.equal(login.body.otpRequired, true);
  });
});

describe('security controls', () => {
  test('state-changing requests require a matching CSRF token and same origin', async () => {
    const ctx = await startTestServer();
    try {
      const client = ctx.client();
      const noToken = await client.post('/api/auth/login', { email: 'a@b.co', password: 'x' }, { csrf: false });
      assert.equal(noToken.status, 403);
      assert.equal(noToken.body.error.code, 'CSRF_INVALID');

      await client.get('/api/auth/session');
      const mismatch = await client.post('/api/auth/login', { email: 'a@b.co', password: 'x' }, { csrf: false, headers: { 'x-csrf-token': 'nope' } });
      assert.equal(mismatch.status, 403);

      const crossSite = await client.post('/api/auth/login', { email: 'a@b.co', password: 'x' }, { headers: { origin: 'https://evil.example' } });
      assert.equal(crossSite.status, 403);

      const csrfCookie = (await ctx.client().get('/api/auth/session')).setCookies.find((c) => c.startsWith('csrf_token='));
      assert.match(csrfCookie, /SameSite=Strict/i);
    } finally {
      await ctx.close();
    }
  });

  test('rate limits signup attempts per IP', async () => {
    const ctx = await startTestServer({ rateLimits: { signupPerIp: { limit: 2, windowMs: 60_000 } } });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await ctx.client().post('/api/auth/signup', signupInput({ email: `rl${i}@example.com` }))).status);
      }
      assert.deepEqual(statuses, [201, 201, 429]);
    } finally {
      await ctx.close();
    }
  });

  test('locks out an email after repeated failed logins, even with the right password', async () => {
    const ctx = await startTestServer({ rateLimits: { loginFailuresPerEmail: { limit: 3, windowMs: 60_000 } } });
    try {
      const { input } = await signUp(ctx, { email: 'brute@example.com' });
      for (let i = 0; i < 3; i += 1) {
        const res = await ctx.client().post('/api/auth/login', { email: 'brute@example.com', password: `Wrong#${i}aaaa` });
        assert.equal(res.status, 401);
      }
      const locked = await ctx.client().post('/api/auth/login', { email: 'brute@example.com', password: input.password });
      assert.equal(locked.status, 429);
      assert.equal(locked.body.error.code, 'RATE_LIMITED');
    } finally {
      await ctx.close();
    }
  });

  test('limits how many OTP emails one address can receive', async () => {
    const ctx = await startTestServer({ rateLimits: { otpSendPerEmail: { limit: 2, windowMs: 60_000 } } });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await ctx.client().post('/api/auth/signup', signupInput({ email: 'flood@example.com' }))).status);
      }
      assert.deepEqual(statuses, [201, 201, 429]);
      assert.equal(ctx.sink.messages.length, 2);
    } finally {
      await ctx.close();
    }
  });

  test('can skip login OTP when configured, but never skips signup verification', async () => {
    const ctx = await startTestServer({ config: { loginOtpRequired: false } });
    try {
      const { input } = await signUp(ctx, { email: 'nootp@example.com' });
      const client = ctx.client();
      const res = await client.post('/api/auth/login', { email: input.email, password: input.password });
      assert.equal(res.body.otpRequired, false);
      assert.equal((await client.get('/api/account')).status, 200);
    } finally {
      await ctx.close();
    }
  });

  test('errors never expose internals and unknown API routes 404', async () => {
    const ctx = await startTestServer();
    try {
      const client = ctx.client();
      const badJson = await client.request('POST', '/api/auth/login', '{"email":', {});
      assert.equal(badJson.status, 400);
      assert.equal(badJson.body.error.code, 'INVALID_JSON');
      const missing = await client.get('/api/nope');
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get('cache-control'), 'no-store');
      assert.equal(missing.headers.get('x-powered-by'), null);
    } finally {
      await ctx.close();
    }
  });
});
