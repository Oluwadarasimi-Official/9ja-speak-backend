'use strict';

/**
 * POST /api/chat — Server-Sent Events streaming chat.
 *
 * Request (JSON):
 *   { messages: [{role, content}...], companion: {...}, user: {...},
 *     languageMode: 'auto'|'yo'|'ha'|'en'|'en-NG'|'pcm',
 *     providerMode: 'auto'|'gemini'|'groq',
 *     memory: [{key, value}],
 *     attachments: [{name, mimeType, dataBase64}] }
 *
 * Response: text/event-stream
 *   event: token     {"text": "..."}
 *   event: metadata   {provider, model, latencyMs, language, detectedMix,
 *                      languageMode, providerMode, usage}
 *   event: error      {error, provider, message, retryable}  (graceful — the
 *                      client renders it as a retryable error; the conversation
 *                      on the device stays intact)
 *   data: [DONE]
 *
 * Auth: `x-api-key` (APP_API_KEY) or guest mode (`x-guest: true`).
 * Rate limits: 60 req/min per API key, 10/min for guests (429 + Retry-After).
 */

const { applyCors, sendJson, readRawBody } = require('../lib/http');
const { authenticate } = require('../lib/auth');
const { checkRateLimit } = require('../lib/rateLimit');
const { validateChatBody } = require('../lib/validate');
const { detectLanguage, buildSystemPrompt } = require('../lib/prompt');
const { routeStream } = require('../lib/router');
const { ProviderError } = require('../lib/providers/base');
const { sendToken, sendMetadata, sendError, sendDone, toErrorPayload } = require('../lib/sse');
const { recordUsage, getUsage, estimateTokens } = require('../lib/usage');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  // ---- Auth (stateless: API key or guest) ----
  let auth;
  try {
    auth = await authenticate(req);
  } catch {
    sendJson(res, 500, { error: 'internal_error', message: 'Authentication failed unexpectedly.' });
    return;
  }
  if (!auth) {
    sendJson(res, 401, {
      error: 'unauthorized',
      message: 'Missing credentials. Send the x-api-key header or x-guest: true.',
    });
    return;
  }

  // ---- Rate limit (in-memory sliding window) ----
  const rl = checkRateLimit(auth);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    sendJson(res, 429, {
      error: 'rate_limited',
      message: `Too many requests — try again in ${rl.retryAfter}s.`,
      retryAfter: rl.retryAfter,
    });
    return;
  }

  // ---- Body (raw read so we can enforce our own size caps) ----
  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    if (err && err.code === 'too_large') {
      sendJson(res, 413, { error: 'payload_too_large', message: 'Request body exceeds the 25MB maximum.' });
    } else {
      sendJson(res, 400, { error: 'bad_request', message: 'Could not read the request body.' });
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON.' });
    return;
  }

  const { value, error: validationError } = validateChatBody(parsed, raw.length);
  if (validationError) {
    sendJson(res, 400, { error: 'invalid_request', message: validationError });
    return;
  }

  const { messages, companion, user, memory, attachments, languageMode, providerMode } = value;

  // ---- Language detection on the latest user message ----
  const lastUserText = messages[messages.length - 1].content;
  const detected = detectLanguage(lastUserText);
  const effectiveLanguage = languageMode !== 'auto' ? languageMode : detected.language;

  // ---- System prompt ----
  const systemPrompt = buildSystemPrompt({ companion, user, memory, languageMode, detected });

  // ---- SSE stream ----
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const started = Date.now();
  let providerUsed = null;
  let modelUsed = null;
  let failoverFrom = null;
  let completionChars = 0;
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  // Heartbeat keeps proxies from closing idle streams while the provider spins up.
  const heartbeat = setInterval(() => {
    if (!clientGone) res.write(': ping\n\n');
  }, 15000);

  const finish = () => {
    clearInterval(heartbeat);
    try { sendDone(res); } catch { /* client gone */ }
    try { res.end(); } catch { /* client gone */ }
  };

  try {
    const stream = routeStream({
      providerMode,
      messages,
      systemPrompt,
      attachments,
      signal: undefined, // per-attempt connect timeouts live inside providers
    });

    for await (const evt of stream) {
      if (clientGone) break;
      if (evt.type === 'token') {
        completionChars += evt.text.length;
        sendToken(res, evt.text);
      } else if (evt.type === 'provider') {
        providerUsed = evt.provider;
        modelUsed = evt.model;
        failoverFrom = evt.failoverFrom || null;
      }
    }

    if (clientGone) { finish(); return; }

    const latencyMs = Date.now() - started;
    const promptChars = messages.reduce((n, m) => n + m.content.length, 0) + systemPrompt.length;
    const usage = recordUsage(auth, promptChars, completionChars);

    sendMetadata(res, {
      provider: providerUsed,
      model: modelUsed,
      failoverFrom,
      latencyMs,
      language: effectiveLanguage,
      detectedMix: detected.mix,
      languageDetectionConfident: detected.confident,
      languageMode,
      providerMode,
      attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType })),
      usage: {
        requestsToday: usage.requestsToday,
        estTokensToday: usage.estTokensToday,
        estTokensThisRequest: estimateTokens(promptChars) + estimateTokens(completionChars),
        tier: auth.tier,
      },
    });
    finish();
  } catch (err) {
    if (clientGone) { finish(); return; }
    // Graceful SSE error — the app displays it as a retryable error and the
    // device-side conversation stays intact. The user's message is never lost.
    const payload = toErrorPayload(err instanceof ProviderError ? err : new ProviderError('internal_error', null, 'internal', { retryable: false }));
    sendMetadata(res, {
      provider: providerUsed,
      model: modelUsed,
      latencyMs: Date.now() - started,
      language: effectiveLanguage,
      detectedMix: detected.mix,
      languageDetectionConfident: detected.confident,
      languageMode,
      providerMode,
      error: true,
      usage: getUsage(auth),
    });
    sendError(res, err);
    finish();
  }
};
