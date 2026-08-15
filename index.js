'use strict';
/**
 * llytpr-wl.v01nh — ultra-fast YouTube frontend.
 * InnerTube API + rotating free-proxy transport + cipher solver.
 *
 * Runs standalone (node index.js, PORT env) and on Vercel (@vercel/node picks
 * up the exported express app).
 *
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
const path = require('node:path');
const express = require('express');

const { router } = require('./server/routes');
const { proxyManager } = require('./server/proxies');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// API
app.use(router);

// Static SPA assets
const pub = path.join(__dirname, 'public');
app.use(express.static(pub, {
  index: 'index.html',
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (/\.(js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
    if (/index\.html$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// SPA fallback for any other GET (hash routing anyway, but keep URLs pretty)
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(pub, 'index.html'));
});

// JSON 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'not found', code: 'NOT_FOUND' }));

// Central error handler — never leak stack traces, never crash
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return;
  const status = err.status && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: err.message || 'internal error', code: err.code || 'INTERNAL' });
});

process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e?.message || e);
});
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e?.message || e);
});

module.exports = app;

/* istanbul ignore next */
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[llytpr-wl.v01nh] listening on 0.0.0.0:${port}`);
    console.log('[llytpr-wl.v01nh] Made by Kakinie with llytpr-wl.v01nh TEAM. V1');
    // warm the proxy pool in the background
    proxyManager.refresh().catch(() => {});
  });
}
