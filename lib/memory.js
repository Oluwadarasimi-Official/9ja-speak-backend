'use strict';

/**
 * lib/memory.js — user-approved memory facts.
 *
 * memory = [{ key, value }] — only facts the user approved on-device.
 * This module sanitizes them and renders the "Known facts" prompt block.
 * The backend never invents memories; it only formats what the device sends.
 */

const MAX_FACTS = 50;
const MAX_KEY_LEN = 100;
const MAX_VALUE_LEN = 400;

/** Sanitize + cap memory entries. Unknown/malformed entries are dropped. */
function sanitizeMemory(memory) {
  if (!Array.isArray(memory)) return [];
  const out = [];
  for (const m of memory) {
    if (!m || typeof m !== 'object') continue;
    const key = String(m.key || '').trim().slice(0, MAX_KEY_LEN);
    const value = String(m.value || '').trim().slice(0, MAX_VALUE_LEN);
    if (!key && !value) continue;
    out.push({ key, value });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

module.exports = { sanitizeMemory, MAX_FACTS };
