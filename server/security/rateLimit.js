import { AppError } from '../http/errors.js';

/**
 * Fixed-window, in-memory rate limiter. Suitable for a single instance;
 * swap the Map for a shared store (e.g. Redis) when running several instances.
 */
export function createRateLimiter({ now = Date.now } = {}) {
  const buckets = new Map();

  function bucket(key, windowMs) {
    const time = now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs };
      buckets.set(key, entry);
    }
    return entry;
  }

  const retryAfter = (entry) => Math.max(1, Math.ceil((entry.resetAt - now()) / 1000));

  const sweeper = setInterval(() => {
    const time = now();
    for (const [key, entry] of buckets) if (entry.resetAt <= time) buckets.delete(key);
  }, 60_000);
  sweeper.unref();

  return {
    /** Counts one hit and throws 429 once the limit is exceeded. */
    consume(key, { limit, windowMs }, message) {
      const entry = bucket(key, windowMs);
      entry.count += 1;
      if (entry.count > limit) throw tooManyRequests(retryAfter(entry), message);
    },
    /** Throws 429 if the key is already at its limit, without counting a hit. */
    check(key, { limit, windowMs }, message) {
      const entry = bucket(key, windowMs);
      if (entry.count >= limit) throw tooManyRequests(retryAfter(entry), message);
    },
    hit(key, { windowMs }) {
      bucket(key, windowMs).count += 1;
    },
    reset(key) {
      buckets.delete(key);
    },
    close() {
      clearInterval(sweeper);
    },
  };
}

function tooManyRequests(retryAfter, message) {
  const minutes = Math.ceil(retryAfter / 60);
  const wait = retryAfter < 60 ? `${retryAfter} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return new AppError(429, 'RATE_LIMITED', message ?? `Too many requests. Please try again in ${wait}.`, {
    retryAfter,
  });
}
