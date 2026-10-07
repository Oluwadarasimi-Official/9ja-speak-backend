'use strict';

/**
 * GET /api/health → { status: 'ok', version, time }
 */

const { applyCors, sendJson } = require('../lib/http');
const pkg = require('../package.json');

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET.' });
    return;
  }
  sendJson(res, 200, {
    status: 'ok',
    version: pkg.version,
    time: new Date().toISOString(),
  });
};
