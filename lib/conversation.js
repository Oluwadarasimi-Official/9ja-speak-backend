'use strict';

/**
 * lib/conversation.js — message list normalization.
 *
 * Valid roles: 'user' | 'assistant' | 'system'. The last message must be from
 * the user. Backend is stateless: the device owns persistence and sends the
 * messages it wants the model to see.
 */

const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGE_LEN = 6000;
const MAX_MESSAGES = 100;

/**
 * @returns {{ messages: Array<{role,content}> | null, error: string|null }}
 */
function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { messages: null, error: 'messages must be a non-empty array' };
  }
  if (input.length > MAX_MESSAGES) {
    return { messages: null, error: `messages must contain at most ${MAX_MESSAGES} entries` };
  }
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    if (!m || typeof m !== 'object') return { messages: null, error: `messages[${i}] must be an object` };
    if (!VALID_ROLES.has(m.role)) return { messages: null, error: `messages[${i}].role must be one of user|assistant|system` };
    if (typeof m.content !== 'string' || m.content.length === 0) {
      return { messages: null, error: `messages[${i}].content must be a non-empty string` };
    }
    if (m.content.length > MAX_MESSAGE_LEN) {
      return { messages: null, error: `messages[${i}].content exceeds ${MAX_MESSAGE_LEN} characters` };
    }
    out.push({ role: m.role, content: m.content });
  }
  if (out[out.length - 1].role !== 'user') {
    return { messages: null, error: 'the last message must be from the user' };
  }
  return { messages: out, error: null };
}

/** Normalize the optional user profile object (unknown fields ignored). */
function normalizeUser(input) {
  const u = input && typeof input === 'object' ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    name: str(u.name, 80),
    username: str(u.username, 80),
    bio: str(u.bio, 400),
    preferredLanguage: str(u.preferredLanguage, 40),
    timezone: str(u.timezone, 60),
  };
}

module.exports = { normalizeMessages, normalizeUser, VALID_ROLES, MAX_MESSAGE_LEN, MAX_MESSAGES };
