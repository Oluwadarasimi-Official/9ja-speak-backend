'use strict';

/**
 * lib/rateLimit.js — in-memory sliding-window rate limiting.
 *
 * Limits: 60 req/min per API key, 10 req/min for guests.
 * NOTE: serverless instances each hold their own window, so this is an
 * approximation under concurrency — intentionally simple and stateless-safe.
 */

const WINDOW_MS = 60 * 1000;
const LIMITS = { key: 60, guest: 10 };

const buckets = new Map(); // key -> Array<timestampMs>

function checkRateLimit(identity) {
  const tier = identity && identity.tier === 'key' ? 'key' : 'guest';
  const limit = LIMITS[tier];
  const bucketKey = `${tier}:${identity ? identity.id : 'anon'}`;
  const now = Date.now();

  let stamps = buckets.get(bucketKey);
  if (!stamps) {
    stamps = [];
    buckets.set(bucketKey, stamps);
  }
  while (stamps.length && stamps[0] <= now - WINDOW_MS) stamps.shift();

  if (stamps.length >= limit) {
    const retryAfter = Math.ceil((stamps[0] + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter), limit, tier };
  }
  stamps.push(now);

  // Opportunistic cleanup so the map cannot grow unboundedly.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || v[v.length - 1] <= now - WINDOW_MS) buckets.delete(k);
    }
  }
  return { allowed: true, retryAfter: 0, limit, tier };
}

module.exports = { checkRateLimit, LIMITS, WINDOW_MS };
