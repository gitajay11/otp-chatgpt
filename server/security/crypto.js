import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/** Uniformly distributed numeric code from the CSPRNG, e.g. "04821". */
export function generateNumericCode(length) {
  return crypto.randomInt(0, 10 ** length).toString().padStart(length, '0');
}
