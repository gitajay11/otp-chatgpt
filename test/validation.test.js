import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isEmail,
  isOtpCode,
  maskEmail,
  passwordScore,
  validatePassword,
  validatePhone,
  validateSignup,
} from '../shared/validation.js';
import { generateNumericCode } from '../server/security/crypto.js';
import { hashPassword, verifyPassword } from '../server/security/passwords.js';

test('email validation', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.org', 'x@xn--80ak6aa92e.com']) assert.ok(isEmail(ok), ok);
  for (const bad of ['', 'a@b', 'a@@b.co', '.a@b.co', 'a..b@c.co', 'a@-b.co', 'a b@c.co', 'a@b.c']) assert.ok(!isEmail(bad), bad);
});

test('phone validation per country, normalised to E.164', () => {
  assert.equal(validatePhone('IN', '98765 43210').e164, '+919876543210');
  assert.equal(validatePhone('GB', '07400 123456').e164, '+447400123456');
  assert.equal(validatePhone('US', '+1 201-555-0123').e164, '+12015550123');
  assert.equal(validatePhone('CA', '201 555 0123').e164, '+12015550123'); // shared +1 plan
  assert.ok(validatePhone('IN', '12345').error);
  assert.ok(validatePhone('IN', '+44 7400 123456').error); // wrong country code
  assert.equal(validatePhone('XX', '98765 43210').field, 'phoneCountry');
  assert.ok(validatePhone('IN', '98765abc10').error);
});

test('password strength rules', () => {
  assert.equal(passwordScore('Abcdef1!'), 5);
  assert.ok(validatePassword('abcdefgh'));
  assert.ok(validatePassword('Short1!'));
  assert.equal(validatePassword('Good#Pass1'), null);
  assert.ok(validatePassword(`Aa1!${'x'.repeat(130)}`));
});

test('signup validation normalises values', () => {
  const { valid, values } = validateSignup({
    firstName: '  Jean-Luc ', lastName: "O'Brien", email: ' Jean@Example.COM ', phoneCountry: 'fr',
    phone: '06 12 34 56 78', password: 'Picard#1701', confirmPassword: 'Picard#1701',
  });
  assert.ok(valid);
  assert.equal(values.firstName, 'Jean-Luc');
  assert.equal(values.email, 'jean@example.com');
  assert.equal(values.phoneE164, '+33612345678');
});

test('OTP helpers', () => {
  assert.ok(isOtpCode('01234'));
  assert.ok(!isOtpCode('1234'));
  assert.ok(!isOtpCode('123456'));
  assert.ok(!isOtpCode(12345));
  assert.equal(maskEmail('user@gmail.com'), 'u***@gmail.com');
  const codes = new Set(Array.from({ length: 200 }, () => generateNumericCode(5)));
  for (const code of codes) assert.match(code, /^\d{5}$/);
  assert.ok(codes.size > 150, 'codes should be random');
});

test('password hashing', async () => {
  const hash = await hashPassword('Correct#Horse1');
  assert.notEqual(hash, await hashPassword('Correct#Horse1')); // salted
  assert.ok(await verifyPassword('Correct#Horse1', hash));
  assert.ok(!(await verifyPassword('Correct#Horse2', hash)));
  assert.ok(!(await verifyPassword('anything', 'garbage')));
});
