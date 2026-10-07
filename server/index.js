import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createLogger } from './logger.js';
import { createMailer } from './services/mailer.js';

// Cross-platform alternative to NODE_ENV=production (used by `npm start`).
if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let loaded;
try {
  loaded = loadConfig();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}
const { config, warnings } = loaded;
const logger = createLogger(config.logLevel);
warnings.forEach((warning) => logger.warn(warning));

const db = openDatabase(path.resolve(root, config.databasePath));
const mailer = createMailer(config, logger);
const app = createApp({ config, db, mailer, logger });
const server = http.createServer(app);

if (config.isProd) {
  const dist = path.join(root, 'dist', 'client');
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    logger.error('Client build not found. Run `npm run build` first.');
    process.exit(1);
  }
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.js'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(config.port, config.host, () => {
  const address = server.address();
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  logger.info(`${config.appName} running at http://${host}:${address.port} (${config.isProd ? 'production' : 'development'})`);
  if (mailer.configured) {
    mailer.verifyConnection().then((ok) => ok && logger.info(`SMTP ready (${config.smtp.host}:${config.smtp.port})`));
  }
});

function shutdown() {
  logger.info('Shutting down');
  server.close(() => {
    app.locals.close();
    mailer.close();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
