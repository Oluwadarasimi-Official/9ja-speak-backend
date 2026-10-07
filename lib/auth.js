'use strict';

/**
 * lib/auth.js — stateless authentication.
 *
 * Two modes:
 *  1. API key: request carries `x-api-key` matching the APP_API_KEY env var.
 *  2. Guest: request carries `x-guest: true` (tighter rate limits).
 *
 * The backend is stateless — conversation persistence lives on the device.
 *
 * AuthProvider is an interface so OAuth (or any other scheme) can be added
 * later without touching routes: implement verify(req) and register it in
 * PROVIDERS below.
 */

class AuthProvider {
  /**
   * @param {object} req - Node http IncomingMessage
   * @returns {Promise<{type:string, id:string, tier:string}|null>}
   *   An auth context, or null when this provider does not apply.
   */
  async verify(/* req */) {
    throw new Error('AuthProvider.verify() must be implemented by subclass');
  }
}

function header(req, name) {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** API-key auth: x-api-key === APP_API_KEY. */
class ApiKeyAuthProvider extends AuthProvider {
  async verify(req) {
    const expected = process.env.APP_API_KEY;
    if (!expected) return null; // key auth unavailable until the key is set
    const provided = header(req, 'x-api-key');
    if (typeof provided === 'string' && provided.length > 0 && timingSafeEqual(provided, expected)) {
      return { type: 'api_key', id: 'key', tier: 'key' };
    }
    return null;
  }
}

/** Guest auth: x-guest: true header. */
class GuestAuthProvider extends AuthProvider {
  async verify(req) {
    const g = header(req, 'x-guest');
    if (typeof g === 'string' && g.trim().toLowerCase() === 'true') {
      return { type: 'guest', id: 'guest', tier: 'guest' };
    }
    return null;
  }
}

// Future OAuth provider goes here — implement AuthProvider and add to the list.
// class OAuthAuthProvider extends AuthProvider { ... }

const PROVIDERS = [new ApiKeyAuthProvider(), new GuestAuthProvider()];

/**
 * Authenticate a request.
 * @returns {Promise<{type,tier,id}|null>} auth context or null (unauthenticated)
 */
async function authenticate(req) {
  for (const p of PROVIDERS) {
    const ctx = await p.verify(req);
    if (ctx) return ctx;
  }
  return null;
}

function timingSafeEqual(a, b) {
  // Constant-time comparison to avoid timing side-channels on the API key.
  const crypto = require('crypto');
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still compare in constant-ish time to avoid leaking length quickly.
    const dummy = crypto.timingSafeEqual(ab, ab);
    return dummy && false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { AuthProvider, ApiKeyAuthProvider, GuestAuthProvider, authenticate };
