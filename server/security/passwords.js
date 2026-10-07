import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// OWASP-recommended scrypt profile (N=2^15, r=8, p=3) ≈ 32 MiB per hash.
const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

const prepare = (password) => String(password).normalize('NFKC');

/** Returns a self-describing hash: scrypt$N$r$p$salt$key (base64url parts). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(prepare(password), salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEMORY });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  const actual = await scrypt(prepare(password), salt, expected.length, { N, r, p, maxmem: MAX_MEMORY });
  return crypto.timingSafeEqual(actual, expected);
}

let dummyHash;

/** Burns the same work as a real check so unknown emails can't be detected by timing. */
export async function verifyDummyPassword(password) {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}
