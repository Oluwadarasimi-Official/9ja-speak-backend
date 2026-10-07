'use strict';

/**
 * lib/companion.js — companion configuration normalization.
 *
 * companion = { name, nickname, avatarStyle?, personalityTraits: [...],
 *   formality (0-100), humor (0-100), energy (0-100),
 *   responseLength: 'short'|'medium'|'long',
 *   emojiPreference: 'none'|'some'|'lots', customInstructions,
 *   voiceId?, primaryLanguage, secondaryLanguages: [] }
 *
 * Unknown extra fields are ignored gracefully.
 */

function clamp(n, fallback, lo = 0, hi = 100) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function oneOf(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function normalizeCompanion(input) {
  const c = input && typeof input === 'object' ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    name: str(c.name, 80) || '9Ja',
    nickname: str(c.nickname, 80),
    avatarStyle: str(c.avatarStyle, 40),
    personalityTraits: Array.isArray(c.personalityTraits)
      ? c.personalityTraits.filter((t) => typeof t === 'string').map((t) => t.slice(0, 60)).slice(0, 12)
      : [],
    formality: clamp(c.formality, 50),
    humor: clamp(c.humor, 50),
    energy: clamp(c.energy, 60),
    responseLength: oneOf(c.responseLength, ['short', 'medium', 'long'], 'medium'),
    emojiPreference: oneOf(c.emojiPreference, ['none', 'some', 'lots'], 'some'),
    customInstructions: str(c.customInstructions, 8000),
    voiceId: str(c.voiceId, 80),
    primaryLanguage: str(c.primaryLanguage, 20) || 'auto',
    secondaryLanguages: Array.isArray(c.secondaryLanguages)
      ? c.secondaryLanguages.filter((l) => typeof l === 'string').map((l) => l.slice(0, 20)).slice(0, 6)
      : [],
  };
}

module.exports = { normalizeCompanion };
