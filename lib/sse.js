'use strict';

/**
 * lib/sse.js — Server-Sent Events helpers for /api/chat.
 *
 * Event types:
 *   event: token     data: {"text": "..."}
 *   event: metadata   data: {"provider","model","latencyMs","language","usage",...}
 *   event: error      data: {"error":"<code>", "provider": "...", "message": "...", "retryable": bool}
 * Final line:  data: [DONE]
 */

function sendEvent(res, type, payload) {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendToken(res, text) {
  sendEvent(res, 'token', { text });
}

function sendMetadata(res, metadata) {
  sendEvent(res, 'metadata', metadata);
}

/**
 * Map a ProviderError (or unknown error) to a sanitized SSE error payload.
 * Never leaks stack traces, API keys, or URLs containing keys.
 */
function toErrorPayload(err) {
  const code = err && typeof err.code === 'string' ? err.code : 'internal_error';
  const provider = err && typeof err.provider === 'string' ? err.provider : null;
  const retryable = err && typeof err.retryable === 'boolean' ? err.retryable : false;

  const MESSAGES = {
    not_configured:
      'The AI provider is not configured yet (API key missing). The app owner needs to add the provider key before chat can work.',
    provider_not_configured:
      'The AI provider is not configured yet (API key missing). The app owner needs to add the provider key before chat can work.',
    attachments_unsupported:
      'One or more attached files are not supported by the active AI provider. Images work everywhere; audio and PDF need the Gemini provider.',
    timeout: 'The AI provider took too long to respond. Please try again.',
    rate_limited: 'The AI provider is rate-limited right now. Please wait a moment and try again.',
    server_error: 'The AI provider had a temporary error. Please try again.',
    network_error: 'Could not reach the AI provider (network error). Please try again.',
    content_blocked: 'The AI provider declined to answer that. Try rephrasing your message.',
    auth_failed: 'The AI provider rejected its API key. The app owner needs to check the key configuration.',
    bad_request: 'The request was rejected by the AI provider. Try a shorter message.',
    unknown: 'The AI service hit an unexpected error. Please try again.',
    internal_error: 'Something went wrong on our side. Please try again.',
  };

  return {
    error: code === 'not_configured' ? 'provider_not_configured' : code,
    provider,
    message: MESSAGES[code] || MESSAGES.internal_error,
    retryable,
  };
}

function sendError(res, err) {
  sendEvent(res, 'error', toErrorPayload(err));
}

function sendDone(res) {
  res.write('data: [DONE]\n\n');
}

module.exports = { sendEvent, sendToken, sendMetadata, sendError, sendDone, toErrorPayload };
