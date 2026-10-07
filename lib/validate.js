'use strict';

/**
 * lib/validate.js — request validation for POST /api/chat.
 *
 * - messages: required non-empty array, last message must be user, each ≤ 6000 chars.
 * - companion / user / memory: optional, normalized (unknown fields ignored).
 * - languageMode / providerMode: optional enums, default 'auto'.
 * - attachments: optional [{ name, mimeType, dataBase64 }], max 3 per request,
 *   each base64 payload ≤ 5MB, allowlisted mime types only:
 *   image/png, image/jpeg, image/webp, audio/mpeg, audio/wav, application/pdf.
 *   Attachments are never silently dropped — unsupported combinations raise a
 *   structured error at the provider layer.
 * - Body size: 1MB max without attachments, 25MB max with attachments.
 * - Unknown extra fields anywhere in the body are ignored gracefully.
 */

const { normalizeMessages, normalizeUser } = require('./conversation');
const { normalizeCompanion } = require('./companion');
const { sanitizeMemory } = require('./memory');

const MAX_BODY_BYTES = 1024 * 1024; // 1MB without attachments
const MAX_BODY_BYTES_WITH_ATTACHMENTS = 25 * 1024 * 1024; // 25MB with attachments
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_B64_BYTES = 5 * 1024 * 1024; // 5MB base64 per file

const ATTACHMENT_MIME_ALLOWLIST = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'application/pdf',
]);

const LANGUAGE_MODES = new Set(['auto', 'yo', 'ha', 'en', 'en-NG', 'pcm']);
const PROVIDER_MODES = new Set(['auto', 'gemini', 'groq']);

const B64_RE = /^[A-Za-z0-9+/=\s]*$/;

function validateAttachments(input) {
  if (input === undefined || input === null) return { attachments: [], error: null };
  if (!Array.isArray(input)) return { attachments: null, error: 'attachments must be an array' };
  if (input.length > MAX_ATTACHMENTS) {
    return { attachments: null, error: `at most ${MAX_ATTACHMENTS} attachments per request` };
  }
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== 'object') return { attachments: null, error: `attachments[${i}] must be an object` };
    const name = typeof a.name === 'string' ? a.name.slice(0, 200) : `file-${i}`;
    const mimeType = typeof a.mimeType === 'string' ? a.mimeType.trim().toLowerCase() : '';
    if (!ATTACHMENT_MIME_ALLOWLIST.has(mimeType)) {
      return {
        attachments: null,
        error: `attachments[${i}].mimeType "${mimeType || 'missing'}" is not allowed (allowed: ${[...ATTACHMENT_MIME_ALLOWLIST].join(', ')})`,
      };
    }
    const dataBase64 = typeof a.dataBase64 === 'string' ? a.dataBase64.replace(/\s+/g, '') : '';
    if (!dataBase64) return { attachments: null, error: `attachments[${i}].dataBase64 is required` };
    if (dataBase64.length > MAX_ATTACHMENT_B64_BYTES) {
      return { attachments: null, error: `attachments[${i}] exceeds the 5MB per-file limit` };
    }
    if (!B64_RE.test(dataBase64)) {
      return { attachments: null, error: `attachments[${i}].dataBase64 is not valid base64` };
    }
    out.push({ name, mimeType, dataBase64 });
  }
  return { attachments: out, error: null };
}

/**
 * Validate the parsed JSON body.
 * @param {*} body - parsed JSON (unknown fields ignored)
 * @param {number} rawBytes - raw request byte length (for the size cap)
 * @returns {{ value: object|null, error: string|null }}
 */
function validateChatBody(body, rawBytes = 0) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, error: 'request body must be a JSON object' };
  }

  const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
  const sizeCap = hasAttachments ? MAX_BODY_BYTES_WITH_ATTACHMENTS : MAX_BODY_BYTES;
  if (rawBytes > sizeCap) {
    return {
      value: null,
      error: hasAttachments
        ? 'request body exceeds the 25MB limit for requests with attachments'
        : 'request body exceeds the 1MB limit',
    };
  }

  const { messages, error: msgErr } = normalizeMessages(body.messages);
  if (msgErr) return { value: null, error: msgErr };

  const { attachments, error: attErr } = validateAttachments(body.attachments);
  if (attErr) return { value: null, error: attErr };

  const languageMode = LANGUAGE_MODES.has(body.languageMode) ? body.languageMode : 'auto';
  const providerMode = PROVIDER_MODES.has(body.providerMode) ? body.providerMode : 'auto';

  return {
    value: {
      messages,
      companion: normalizeCompanion(body.companion),
      user: normalizeUser(body.user),
      memory: sanitizeMemory(body.memory),
      attachments,
      languageMode,
      providerMode,
    },
    error: null,
  };
}

module.exports = {
  validateChatBody,
  validateAttachments,
  MAX_BODY_BYTES,
  MAX_BODY_BYTES_WITH_ATTACHMENTS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_B64_BYTES,
  ATTACHMENT_MIME_ALLOWLIST,
  LANGUAGE_MODES,
  PROVIDER_MODES,
};
