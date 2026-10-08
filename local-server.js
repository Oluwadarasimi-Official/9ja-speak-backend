'use strict';

/**
 * local-server.js — plain Node HTTP server wrapper for the 9Ja Speak backend.
 *
 * Used for non-Vercel runtimes (e.g. Rumpty Cloud) that run `npm start`.
 * Routes:
 *   GET  /api/health
 *   GET  /api/health/providers
 *   POST /api/chat            (SSE streaming)
 *   GET  /                    (web app — serves ./public/index.html)
 *   GET  /<static>            (files under ./public/, correct content types)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendJson } = require('./lib/http');

const chatHandler = require('./api/chat');
const healthHandler = require('./api/health');
const providersHandler = require('./api/health/providers');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Serve a file from ./public/. Returns true if the path was handled. */
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/chat') return chatHandler(req, res);
    if (path === '/api/health/providers') return providersHandler(req, res);
    if (path === '/api/health') return healthHandler(req, res);
    if (serveStatic(req, res, url.pathname)) return;
    return sendJson(res, 404, { error: 'not_found', message: 'Unknown endpoint.' });
  } catch (err) {
    try {
      sendJson(res, 500, { error: 'internal_error', message: 'Unexpected server error.' });
    } catch (_) {
      /* already responded */
    }
  }
});

server.listen(PORT, () => {
  console.log(`9ja-speak-backend listening on :${PORT}`);
});
