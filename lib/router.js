'use strict';

/**
 * lib/router.js — provider router with health tracking and failover.
 *
 * providerMode "auto":  try Gemini first. On timeout (8s connect), 429, 5xx,
 *   or network error → fail over to Groq with retry policy (2 retries,
 *   exponential backoff 500ms → 1s).
 * providerMode "gemini"|"groq": pinned to that provider, still retries once.
 *
 * Missing keys: structured { error: 'provider_not_configured' } — never fake
 * AI output. The user's message is never lost on provider failure: the router
 * throws a ProviderError which the route turns into a graceful SSE error event
 * the app can render as a retryable error, keeping the conversation intact.
 */

const { AIProvider, ProviderError } = require('./providers/base');
const { GeminiProvider } = require('./providers/gemini');
const { GroqProvider } = require('./providers/groq');
const { FAILOVER_RETRIES, FAILOVER_BACKOFF_MS, PINNED_RETRIES } = require('./config/models');

const gemini = new GeminiProvider();
const groq = new GroqProvider();

// Failover-eligible error codes (transient provider-side problems).
const FAILOVER_CODES = new Set(['timeout', 'rate_limited', 'server_error', 'network_error', 'unknown']);

function emptyHealth() {
  return {
    configured: false,
    requests: 0,
    failures: 0,
    lastSuccess: null,   // ISO timestamp
    lastError: null,     // { code, at }
    avgLatencyMs: null,  // rolling average of successful requests
  };
}

const health = {
  gemini: emptyHealth(),
  groq: emptyHealth(),
};

function recordSuccess(name, latencyMs) {
  const h = health[name];
  h.requests += 1;
  h.configured = true;
  h.lastSuccess = new Date().toISOString();
  h.avgLatencyMs = h.avgLatencyMs === null
    ? Math.round(latencyMs)
    : Math.round(h.avgLatencyMs * 0.7 + latencyMs * 0.3);
}

function recordFailure(name, err, configured) {
  const h = health[name];
  h.requests += 1;
  h.failures += 1;
  h.configured = configured;
  h.lastError = { code: err && err.code ? err.code : 'unknown', at: new Date().toISOString() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one provider attempt, yielding tokens. Wraps errors for classification
 * and applies the connect timeout semantics inside each provider.
 */
async function* attempt(provider, args) {
  const started = Date.now();
  try {
    yield* provider.streamRequest(args);
    recordSuccess(provider.name, Date.now() - started);
  } catch (err) {
    const classified = err instanceof ProviderError ? err : new ProviderError('unknown', provider.name, 'Unexpected provider error.', { retryable: true });
    recordFailure(provider.name, classified, provider.isConfigured());
    throw classified;
  }
}

async function* withRetries(provider, args, retries, backoffMs) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(backoffMs[Math.min(i - 1, backoffMs.length - 1)]);
    try {
      yield* attempt(provider, args);
      return;
    } catch (err) {
      lastErr = err;
      if (!err.retryable) throw err; // permanent errors: no retry
    }
  }
  throw lastErr;
}

/**
 * Route a chat request through the provider(s).
 * @param {object} opts
 * @param {'auto'|'gemini'|'groq'} opts.providerMode
 * @param {Array} opts.messages
 * @param {string} opts.systemPrompt
 * @param {Array} opts.attachments
 * @param {AbortSignal} opts.signal
 * @yields {{type:'token', text:string}} plus a final {type:'provider', provider, model}
 *   meta event identifying the provider that served the request.
 */
async function* routeStream({ providerMode = 'auto', messages, systemPrompt, attachments = [], signal }) {
  const args = { messages, systemPrompt, attachments, signal };
  const { GEMINI_MODEL, GROQ_MODEL } = require('./config/models');

  if (providerMode === 'gemini' || providerMode === 'groq') {
    const provider = providerMode === 'gemini' ? gemini : groq;
    if (!provider.isConfigured()) throw provider.notConfiguredError();
    try {
      yield* withRetries(provider, args, PINNED_RETRIES, [500]);
      yield { type: 'provider', provider: provider.name, model: provider.name === 'gemini' ? GEMINI_MODEL : GROQ_MODEL };
    } catch (err) {
      throw err;
    }
    return;
  }

  // auto: Gemini first, then Groq failover.
  if (!gemini.isConfigured() && !groq.isConfigured()) {
    throw gemini.notConfiguredError(); // honest: nothing configured
  }

  let primaryErr = null;
  if (gemini.isConfigured()) {
    try {
      yield* attempt(gemini, args);
      yield { type: 'provider', provider: 'gemini', model: GEMINI_MODEL };
      return;
    } catch (err) {
      primaryErr = err;
      // Non-transient (auth_failed, bad_request, content_blocked,
      // attachments_unsupported, not_configured): do NOT fail over silently —
      // the error is meaningful and must reach the client as-is.
      if (!FAILOVER_CODES.has(err.code)) throw err;
    }
  }

  if (!groq.isConfigured()) {
    // Gemini failed and Groq has no key — surface the original failure.
    throw primaryErr || groq.notConfiguredError();
  }

  try {
    yield* withRetries(groq, args, FAILOVER_RETRIES, FAILOVER_BACKOFF_MS);
    yield { type: 'provider', provider: 'groq', model: GROQ_MODEL, failoverFrom: primaryErr ? 'gemini' : null };
  } catch (err) {
    throw err;
  }
}

function getProvidersHealth() {
  return {
    gemini: { ...health.gemini, configured: gemini.isConfigured(), model: require('./config/models').GEMINI_MODEL },
    groq: { ...health.groq, configured: groq.isConfigured(), model: require('./config/models').GROQ_MODEL },
    default: 'auto',
  };
}

module.exports = { routeStream, getProvidersHealth, _health: health, _providers: { gemini, groq } };
module.exports.AIProvider = AIProvider; // re-exported for convenience
