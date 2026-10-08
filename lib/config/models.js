'use strict';

/**
 * lib/config/models.js — centralized model + provider configuration.
 *
 * All model names and provider endpoints live here. Routes and providers must
 * read from this module; no hard-coded model names anywhere else.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'; // 2.5-flash retired for new keys (Oct 2026)
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

// Per-attempt connection timeout (time-to-first-token) in ms.
const PROVIDER_CONNECT_TIMEOUT_MS = 8000;

// Failover policy for providerMode "auto": retries on the fallback provider
// with exponential backoff.
const FAILOVER_RETRIES = 2;
const FAILOVER_BACKOFF_MS = [500, 1000];

// Manual (pinned) provider mode still retries once before giving up.
const PINNED_RETRIES = 1;

module.exports = {
  GEMINI_MODEL,
  GROQ_MODEL,
  GEMINI_API_BASE,
  GROQ_API_BASE,
  PROVIDER_CONNECT_TIMEOUT_MS,
  FAILOVER_RETRIES,
  FAILOVER_BACKOFF_MS,
  PINNED_RETRIES,
};
