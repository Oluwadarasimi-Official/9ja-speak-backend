'use strict';

/**
 * lib/usage.js — in-memory usage counters (per auth identity, per day).
 *
 * Tracks requests/day and an estimated token count (chars/4 heuristic).
 * Included in chat metadata events. Resets daily; serverless-safe
 * approximation like the rate limiter.
 */

const counters = new Map(); // `${identityId}:${yyyy-mm-dd}` -> { requests, estTokens }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function identityKey(auth) {
  if (!auth) return 'anon';
  return `${auth.type}:${auth.id}`;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/** Record one completed chat turn. */
function recordUsage(auth, promptChars, completionChars) {
  const key = `${identityKey(auth)}:${todayKey()}`;
  let c = counters.get(key);
  if (!c) {
    c = { date: todayKey(), requests: 0, estTokens: 0 };
    counters.set(key, c);
  }
  c.requests += 1;
  c.estTokens += estimateTokens(promptChars) + estimateTokens(completionChars);
  return getUsage(auth);
}

/** Current usage snapshot for an identity (before recording the new request). */
function getUsage(auth) {
  const key = `${identityKey(auth)}:${todayKey()}`;
  const c = counters.get(key);
  return {
    date: todayKey(),
    requestsToday: c ? c.requests : 0,
    estTokensToday: c ? c.estTokens : 0,
  };
}

module.exports = { recordUsage, getUsage, estimateTokens };
