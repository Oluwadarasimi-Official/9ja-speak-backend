'use strict';

/**
 * lib/providers/base.js — AIProvider interface/base class + ProviderError.
 *
 * Every provider (Gemini, Groq, future ones) extends AIProvider and implements:
 *   - isConfigured(): boolean — true when its API key env var is present.
 *   - streamRequest({ messages, systemPrompt, attachments, signal }): AsyncGenerator
 *       yielding { type: 'token', text: string } events.
 *
 * Providers throw ProviderError (never raw fetch errors) so the router can
 * classify failures and the route can sanitize what reaches the client.
 */

class ProviderError extends Error {
  /**
   * @param {string} code - machine-readable code, e.g. 'timeout', 'rate_limited',
   *   'server_error', 'network_error', 'not_configured', 'bad_request',
   *   'attachments_unsupported', 'content_blocked', 'auth_failed'
   * @param {string} provider - provider name ('gemini' | 'groq' | ...)
   * @param {string} message - safe, human-readable message (no keys/URLs/stack)
   * @param {object} [opts] - { status, retryable, retryAfterMs }
   */
  constructor(code, provider, message, opts = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider;
    this.status = opts.status || null;
    this.retryable = opts.retryable !== undefined ? opts.retryable : true;
    this.retryAfterMs = opts.retryAfterMs || null;
  }
}

class AIProvider {
  constructor(name) {
    this.name = name;
  }

  /** @returns {boolean} true when the provider's API key is configured. */
  isConfigured() {
    return false;
  }

  /** Structured error used when the key is missing — never fakes AI output. */
  notConfiguredError() {
    return new ProviderError(
      'not_configured',
      this.name,
      `The ${this.name} AI provider is not configured yet (API key missing). ` +
        'Ask the app owner to add the provider API key, then try again.',
      { retryable: false }
    );
  }

  /**
   * Stream a chat completion.
   * @param {object} args
   * @param {Array<{role:string, content:string}>} args.messages
   * @param {string} args.systemPrompt
   * @param {Array<{name:string, mimeType:string, dataBase64:string}>} args.attachments
   * @param {AbortSignal} args.signal
   * @yields {{type:'token', text:string}}
   */
  async *streamRequest(/* args */) {
    throw new Error('AIProvider.streamRequest() must be implemented by subclass');
  }
}

/**
 * Classify an unknown thrown value into a ProviderError.
 * @param {*} err
 * @param {string} provider
 */
function classifyError(err, provider) {
  if (err instanceof ProviderError) return err;
  const msg = (err && err.message) || String(err);
  if (err && (err.name === 'AbortError' || /aborted/i.test(msg))) {
    return new ProviderError('timeout', provider, `The ${provider} request timed out.`, { retryable: true });
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network/i.test(msg)) {
    return new ProviderError('network_error', provider, `Could not reach the ${provider} service (network error).`, { retryable: true });
  }
  return new ProviderError('unknown', provider, `The ${provider} provider hit an unexpected error.`, { retryable: true });
}

module.exports = { AIProvider, ProviderError, classifyError };
