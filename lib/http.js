'use strict';

/**
 * lib/http.js — shared HTTP helpers: CORS, raw body reading, JSON responses.
 */

const MAX_RAW_BYTES = 25 * 1024 * 1024 + 1024; // hard ceiling (25MB + slack)

function applyCors(req, res) {
  const origin = process.env.APP_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-guest');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/**
 * Read the raw request body with a byte cap. Rejects with { code: 'too_large' }
 * when the cap is exceeded.
 */
function readRawBody(req, cap = MAX_RAW_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > cap) {
        reject(Object.assign(new Error('body too large'), { code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = { applyCors, sendJson, readRawBody, MAX_RAW_BYTES };
