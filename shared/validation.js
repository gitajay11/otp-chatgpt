// Validation rules shared by the browser and the server.
// The server always re-runs these; client-side checks are only for fast feedback.
import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/mobile';

export const OTP_LENGTH = 5;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 50;
export const EMAIL_MAX = 254;

const asString = (value) => (typeof value === 'string' ? value : '');

const NAME_RE = /^[\p{L}\p{M}](?:[\p{L}\p{M}'’ .-]*[\p{L}\p{M}.])?$/u;
const EMAIL_LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const EMAIL_TLD_RE = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;
const OTP_RE = new RegExp(`^\\d{${OTP_LENGTH}}$`);

export const PASSWORD_RULES = [
  { id: 'length', label: `${PASSWORD_MIN}+ characters`, test: (p) => p.length >= PASSWORD_MIN },
  { id: 'lower', label: 'Lowercase letter', test: (p) => /\p{Ll}/u.test(p) },
  { id: 'upper', label: 'Uppercase letter', test: (p) => /\p{Lu}/u.test(p) },
  { id: 'number', label: 'Number', test: (p) => /\p{Nd}/u.test(p) },
  { id: 'symbol', label: 'Symbol', test: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
];

export function normalizeEmail(value) {
  return asString(value).trim().toLowerCase();
}

export function normalizeName(value) {
  return asString(value).trim().replace(/\s+/g, ' ');
}

export function isEmail(email) {
  if (!email || email.length > EMAIL_MAX) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return false;
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  if (local.length > 64 || !EMAIL_LOCAL_RE.test(local) || labels.length < 2) return false;
  return labels.every((l) => EMAIL_LABEL_RE.test(l)) && EMAIL_TLD_RE.test(labels.at(-1));
}

export function passwordScore(password) {
  const p = asString(password);
  return PASSWORD_RULES.reduce((score, rule) => score + (rule.test(p) ? 1 : 0), 0);
}

export function validateName(value, label) {
  const name = normalizeName(value);
  if (!name) return `Enter your ${label}.`;
  if (name.length > NAME_MAX) return `Use ${NAME_MAX} characters or fewer.`;
  if (!NAME_RE.test(name)) return 'Use letters, spaces, hyphens or apostrophes only.';
  return null;
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Enter your email address.';
  if (!isEmail(email)) return 'Enter a valid email address, like name@example.com.';
  return null;
}

export function validatePassword(value) {
  const password = asString(value);
  if (!password) return 'Enter a password.';
  if (password.length > PASSWORD_MAX) return `Use ${PASSWORD_MAX} characters or fewer.`;
  if (passwordScore(password) < PASSWORD_RULES.length) {
    return `Use ${PASSWORD_MIN}+ characters with uppercase, lowercase, a number and a symbol.`;
  }
  return null;
}

function validateConfirmation(password, confirm) {
  if (!confirm) return 'Confirm your password.';
  if (confirm !== password) return 'Passwords do not match.';
  return null;
}

/**
 * Validates a mobile number against the selected country.
 * Returns `{ error, field }` on failure or `{ e164, country, national }` on success.
 */
export function validatePhone(countryValue, numberValue) {
  const country = asString(countryValue).toUpperCase();
  if (!country || !isSupportedCountry(country)) {
    return { error: 'Select a valid country code.', field: 'phoneCountry' };
  }
  const number = asString(numberValue).trim();
  if (!number) return { error: 'Enter your mobile number.', field: 'phone' };
  if (number.length > 24 || !/^[\d\s().+-]+$/.test(number)) {
    return { error: 'Use digits only.', field: 'phone' };
  }
  const parsed = parsePhoneNumberFromString(number, country);
  if (
    !parsed ||
    !parsed.isValid() ||
    parsed.countryCallingCode !== getCountryCallingCode(country)
  ) {
    return { error: 'Enter a valid mobile number for the selected country.', field: 'phone' };
  }
  return { e164: parsed.number, country: parsed.country ?? country, national: parsed.format('NATIONAL', { nationalPrefix: false }) };
}

function result(errors, values) {
  return { errors, values, valid: Object.keys(errors).length === 0 };
}

function put(errors, field, message) {
  if (message) errors[field] = message;
}

export function validateSignup(input = {}) {
  const errors = {};
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);
  const email = normalizeEmail(input.email);
  const password = asString(input.password);
  const confirmPassword = asString(input.confirmPassword);

  put(errors, 'firstName', validateName(firstName, 'first name'));
  put(errors, 'lastName', validateName(lastName, 'last name'));
  put(errors, 'email', validateEmail(email));

  const phone = validatePhone(input.phoneCountry, input.phone);
  if (phone.error) put(errors, phone.field, phone.error);

  put(errors, 'password', validatePassword(password));
  put(errors, 'confirmPassword', validateConfirmation(password, confirmPassword));

  return result(errors, {
    firstName,
    lastName,
    email,
    phoneCountry: phone.country ?? asString(input.phoneCountry).toUpperCase(),
    phoneE164: phone.e164 ?? null,
    password,
  });
}

export function validateLogin(input = {}) {
  const errors = {};
  const email = normalizeEmail(input.email);
  const password = asString(input.password);
  put(errors, 'email', validateEmail(email));
  if (!password) errors.password = 'Enter your password.';
  else if (password.length > PASSWORD_MAX) errors.password = 'Incorrect email or password.';
  return result(errors, { email, password });
}

export function validatePasswordReset(input = {}) {
  const errors = {};
  const email = normalizeEmail(input.email);
  const password = asString(input.password);
  put(errors, 'email', validateEmail(email));
  put(errors, 'password', validatePassword(password));
  put(errors, 'confirmPassword', validateConfirmation(password, asString(input.confirmPassword)));
  return result(errors, { email, password });
}

export function isOtpCode(value) {
  return typeof value === 'string' && OTP_RE.test(value);
}

/** "user@gmail.com" → "u***@gmail.com" */
export function maskEmail(email) {
  const value = asString(email);
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value[0]}***${value.slice(at)}`;
}
