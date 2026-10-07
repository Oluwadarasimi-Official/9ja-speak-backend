'use strict';

/**
 * GET /api/health/providers → per-provider health:
 * { gemini: {configured, model, requests, failures, lastSuccess, lastError, avgLatencyMs},
 *   groq: {...}, default: 'auto' }
 */

const { applyCors, sendJson } = require('../../lib/http');
const { getProvidersHealth } = require('../../lib/router');

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
  sendJson(res, 200, getProvidersHealth());
};
