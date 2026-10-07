'use strict';

/**
 * lib/providers/gemini.js — Gemini REST streaming provider.
 *
 * POST {GEMINI_API_BASE}/models/{model}:streamGenerateContent?alt=sse
 * Auth via the x-goog-api-key header (key never appears in the URL).
 *
 * Attachments: all allowlisted mime types are supported via inlineData parts.
 */

const { GEMINI_MODEL, GEMINI_API_BASE, PROVIDER_CONNECT_TIMEOUT_MS } = require('../config/models');
const { AIProvider, ProviderError, classifyError } = require('./base');

function toGeminiRole(role) {
  if (role === 'assistant') return 'model';
  if (role === 'user') return 'user';
  return 'user'; // system messages are folded into systemInstruction
}

class GeminiProvider extends AIProvider {
  constructor() {
    super('gemini');
  }

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  }

  _buildContents(messages, attachments) {
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') continue; // handled via systemInstruction
      const parts = [{ text: m.content }];
      contents.push({ role: toGeminiRole(m.role), parts });
    }
    // Attach inlineData parts to the last user message (validation guarantees
    // the last message is from the user).
    if (attachments && attachments.length > 0 && contents.length > 0) {
      const last = contents[contents.length - 1];
      for (const a of attachments) {
        last.parts.push({ inlineData: { mimeType: a.mimeType, data: a.dataBase64 } });
      }
    }
    return contents;
  }

  async *streamRequest({ messages, systemPrompt, attachments = [], signal }) {
    if (!this.isConfigured()) throw this.notConfiguredError();

    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:streamGenerateContent?alt=sse`;
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: this._buildContents(messages, attachments),
      generationConfig: { temperature: 0.9 },
    };

    // Connect timeout: abort if the provider takes too long to start streaming.
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(() => connectCtrl.abort(), PROVIDER_CONNECT_TIMEOUT_MS);
    const combinedSignal = signal
      ? AbortSignal.any([signal, connectCtrl.signal])
      : connectCtrl.signal;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });
    } catch (err) {
      clearTimeout(connectTimer);
      throw classifyError(err, this.name);
    }

    if (!res.ok) {
      clearTimeout(connectTimer);
      const text = await res.text().catch(() => '');
      throw this._httpError(res.status, text);
    }

    // First byte received — the connection is alive; clear the connect timer.
    clearTimeout(connectTimer);
    if (!res.body) {
      throw new ProviderError('server_error', this.name, 'The Gemini service returned an empty response.', { retryable: true });
    }

    try {
      yield* this._readSse(res.body, signal);
    } catch (err) {
      throw classifyError(err, this.name);
    }
  }

  _httpError(status, rawText) {
    // Sanitize: never forward raw provider text (may contain key fragments).
    if (status === 429) {
      return new ProviderError('rate_limited', this.name, 'Gemini rate limit reached — retrying with the fallback provider.', { status, retryable: true });
    }
    if (status === 401 || status === 403) {
      return new ProviderError('auth_failed', this.name, 'Gemini rejected the API key.', { status, retryable: false });
    }
    if (status >= 500) {
      return new ProviderError('server_error', this.name, 'Gemini had an internal error.', { status, retryable: true });
    }
    if (status === 400) {
      return new ProviderError('bad_request', this.name, 'Gemini rejected the request as invalid.', { status, retryable: false });
    }
    return new ProviderError('server_error', this.name, `Gemini request failed (status ${status}).`, { status, retryable: status >= 500 || status === 429 });
  }

  async *_readSse(body, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = function* (line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        return; // ignore malformed chunk
      }
      if (chunk.promptFeedback && chunk.promptFeedback.blockReason) {
        throw new ProviderError('content_blocked', 'gemini', 'Gemini blocked the response for safety reasons.', { retryable: false });
      }
      const candidates = chunk.candidates || [];
      for (const c of candidates) {
        if (c.finishReason && c.finishReason === 'SAFETY') {
          throw new ProviderError('content_blocked', 'gemini', 'Gemini blocked the response for safety reasons.', { retryable: false });
        }
        const parts = (c.content && c.content.parts) || [];
        for (const p of parts) {
          if (p.text) yield { type: 'token', text: p.text };
        }
      }
    };

    while (true) {
      if (signal && signal.aborted) {
        throw new ProviderError('timeout', 'gemini', 'The Gemini request was aborted.', { retryable: true });
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        yield* processLine(line);
      }
    }
    if (buffer.trim()) yield* processLine(buffer);
  }
}

module.exports = { GeminiProvider };
