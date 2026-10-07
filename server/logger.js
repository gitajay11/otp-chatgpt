const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal structured logger. Callers must never pass request bodies, codes,
 * passwords or tokens in `meta`.
 */
export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (name, method) => (message, meta) => {
    if (LEVELS[name] < threshold) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}`;
    if (meta) console[method](line, meta);
    else console[method](line);
  };
  return {
    debug: write('debug', 'log'),
    info: write('info', 'log'),
    warn: write('warn', 'warn'),
    error: write('error', 'error'),
  };
}
