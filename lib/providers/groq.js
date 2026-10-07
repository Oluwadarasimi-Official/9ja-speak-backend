'use strict';

/**
 * lib/providers/groq.js — Groq OpenAI-compatible streaming provider.
 *
 * POST {GROQ_API_BASE}/chat/completions  { stream: true }
 * Auth via Authorization: Bearer header.
 *
 * Attachments: images (png/jpeg/webp) are sent as image_url data-URL parts.
 * Non-image attachments (audio, pdf) are NOT supported by this provider — they
 * raise attachments_unsupported instead of being silently dropped.
 */

const { GROQ_MODEL, GROQ_API_BASE, PROVIDER_CONNECT_TIMEOUT_MS } = require('../config/models');
const { AIProvider, ProviderError, classifyError } = require('./base');

const GROQ_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

class GroqProvider extends AIProvider {
  constructor() {
    super('groq');
  }

  isConfigured() {
    return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
  }

  _buildMessages(messages, systemPrompt, attachments) {
    const out = [{ role: 'system', content: systemPrompt }];
    for (const m of messages) {
      if (m.role === 'system') continue; // already in the system message
      out.push({ role: m.role, content: m.content });
    }
    if (attachments && attachments.length > 0) {
      for (const a of attachments) {
        if (!GROQ_IMAGE_MIMES.has(a.mimeType)) {
          throw new ProviderError(
            'attachments_unsupported',
            this.name,
            `This file type (${a.mimeType}) is not supported by the Groq provider. ` +
              'Images (PNG/JPEG/WebP) are supported; audio and PDF need the Gemini provider.',
            { retryable: false }
          );
        }
      }
      // Attach images to the last user message (validation guarantees the last
      // message is from the user).
      const last = out[out.length - 1];
      const parts = [{ type: 'text', text: last.content }];
      for (const a of attachments) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${a.mimeType};base64,${a.dataBase64}` },
        });
      }
      last.content = parts;
    }
    return out;
  }

  async *streamRequest({ messages, systemPrompt, attachments = [], signal }) {
    if (!this.isConfigured()) throw this.notConfiguredError();

    const url = `${GROQ_API_BASE}/chat/completions`;
    const body = {
      model: GROQ_MODEL,
      stream: true,
      temperature: 0.9,
      messages: this._buildMessages(messages, systemPrompt, attachments),
    };

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
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
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
      await res.text().catch(() => '');
      throw this._httpError(res.status);
    }

    clearTimeout(connectTimer);
    if (!res.body) {
      throw new ProviderError('server_error', this.name, 'The Groq service returned an empty response.', { retryable: true });
    }

    try {
      yield* this._readSse(res.body, signal);
    } catch (err) {
      throw classifyError(err, this.name);
    }
  }

  _httpError(status) {
    if (status === 429) {
      return new ProviderError('rate_limited', this.name, 'Groq rate limit reached.', { status, retryable: true });
    }
    if (status === 401 || status === 403) {
      return new ProviderError('auth_failed', this.name, 'Groq rejected the API key.', { status, retryable: false });
    }
    if (status >= 500) {
      return new ProviderError('server_error', this.name, 'Groq had an internal error.', { status, retryable: true });
    }
    if (status === 400) {
      return new ProviderError('bad_request', this.name, 'Groq rejected the request as invalid.', { status, retryable: false });
    }
    return new ProviderError('server_error', this.name, `Groq request failed (status ${status}).`, { status, retryable: status >= 500 || status === 429 });
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
        return;
      }
      const choices = chunk.choices || [];
      for (const c of choices) {
        const delta = c.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'token', text: delta.content };
        }
      }
    };

    while (true) {
      if (signal && signal.aborted) {
        throw new ProviderError('timeout', 'groq', 'The Groq request was aborted.', { retryable: true });
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

module.exports = { GroqProvider };
