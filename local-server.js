'use strict';

/**
 * local-server.js — plain Node HTTP server wrapper for the 9Ja Speak backend.
 *
 * Used for non-Vercel runtimes (e.g. Rumpty Cloud) that run `npm start`.
 * Routes:
 *   GET  /api/health
 *   GET  /api/health/providers
 *   POST /api/chat            (SSE streaming)
 *   GET  /                    (info)
 */

const http = require('http');
const { sendJson } = require('./lib/http');

const chatHandler = require('./api/chat');
const healthHandler = require('./api/health');
const providersHandler = require('./api/health/providers');

const PORT = parseInt(process.env.PORT, 10) || 8080;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/chat') return chatHandler(req, res);
    if (path === '/api/health/providers') return providersHandler(req, res);
    if (path === '/api/health') return healthHandler(req, res);
    if (path === '/') {
      return sendJson(res, 200, {
        name: '9ja-speak-backend',
        status: 'ok',
        endpoints: ['GET /api/health', 'GET /api/health/providers', 'POST /api/chat'],
      });
    }
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
