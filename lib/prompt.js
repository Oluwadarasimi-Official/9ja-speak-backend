'use strict';

/**
 * lib/prompt.js — language detection + dynamic system prompt builder.
 *
 * MULTILINGUAL CORE:
 * - Detects Yoruba, Hausa, English, Nigerian English, Nigerian Pidgin,
 *   including natural code-switching ("Abeg explain this thing for me.",
 *   "Mo fẹ́ kí o explain this to me.", "Ina son ka taimaka min.").
 * - Mixed sentences are understood naturally, never treated as malformed.
 * - Responses match the user's language/mix; languageMode != 'auto' is obeyed strictly.
 * - Nigerian English is understood (abeg, no wahala, how far, ...) but slang is
 *   never forced into responses — tone follows the companion configuration.
 * - If detection is uncertain, the companion answers in English and notes it briefly.
 */

const LANG_LABELS = {
  yo: 'Yoruba',
  ha: 'Hausa',
  en: 'English',
  'en-NG': 'Nigerian English',
  pcm: 'Nigerian Pidgin',
};

// Word/phrase markers (lowercased, diacritics-normalized). Tuned for recall on
// short chat messages; detection is a heuristic, not a classifier.
const MARKERS = {
  yo: [
    'káàárọ̀', 'kaaro', 'káàsán', 'kaasan', 'káalẹ́', 'kaale', 'ẹ káàbọ̀', 'ekabo',
    'ẹ ṣeun', 'eseun', 'ẹ ṣe', 'bawo', 'báwo', 'daadaa', 'dáadáa', 'jọ̀wọ́', 'jowo',
    'ṣe', 'pé', 'ní', 'rẹ̀', 'rẹ', 'mi ò', 'mo fẹ́', 'mofe', 'fẹ́', 'kí', 'tó',
    'dúpẹ́', 'ẹ ku', 'eku', 'ọmọ', 'omo', 'ìfẹ́', 'àyọ̀', 'maṣe', 'wá', 'lọ',
    'ṣé', 'òótọ́', 'kò', 'rárá', 'gbogbo', 'nǹkan', 'ọ̀rẹ́', 'aláàfíà', 'ṣáà',
    'jẹ́', 'máa', 'yóò', 'ṣùgbọ́n', 'nítorí', 'kì', 'fún', 'pẹ̀lú',
  ],
  ha: [
    'ina son', 'taimaka', 'menene', 'lafiya', 'yaya', 'sannu', 'madalla',
    'wannan', 'wancan', 'yarinya', 'makaranta', 'gobe', 'yau', 'gida',
    'tambaya', 'magana', 'mutum', 'abinci', 'ruwa', 'aiki', 'sai', 'amma',
    'kuma', 'don allah', 'barka', 'kana', 'kina', 'yaro', 'daga', 'cikin',
    'saboda', 'idan', 'kamar', 'sosai', 'da kyau', 'nagode', 'na gode',
  ],
  pcm: [
    'abeg', 'wetin', 'how far', 'no wahala', 'wahala', 'i dey', 'you dey',
    'e dey', 'we dey', 'dem dey', 'na so', 'shebi', 'shey', 'abi', 'una',
    'make we', 'e don do', 'don do', 'my guy', 'oya', 'sapa', 'japa',
    'no be', 'i be', 'you be', 'e be', 'dem', 'tori', 'gist', 'chop',
    'waka', 'yarn', 'kolo', 'gbas gbos', 'e choke', 'wan', 'dey go',
    'dey come', 'dey play', 'dey happen', 'dey talk', 'dey vex', 'dey cry',
    'dey laugh', 'dey sleep', 'dey work', 'dey form', 'dey wine',
    'korrect', 'correct guy', 'sharp sharp', 'taya', 'ehen', 'henhen',
  ],
  // Nigerian English: standard English with Naija flavor words/phrases.
  'en-NG': [
    'well done', 'sorry', 'traffic', 'light', 'nepa', 'phcn', 'gist me',
    'i am coming', "i'm coming", 'go slow', 'hold up', 'vex', 'dash me',
    'how body', 'body dey', 'no shaking', 'everywhere good',
  ],
};

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics for matching
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMarkers(normText) {
  const scores = { yo: 0, ha: 0, pcm: 0, 'en-NG': 0 };
  const padded = ` ${normText} `;
  for (const [lang, markers] of Object.entries(MARKERS)) {
    for (const m of markers) {
      const nm = normalize(m);
      if (!nm) continue;
      // Multi-word markers: substring match; single words: whole-word match.
      if (nm.includes(' ')) {
        if (padded.includes(` ${nm} `)) scores[lang] += nm.split(' ').length * 2;
      } else if (padded.includes(` ${nm} `)) {
        scores[lang] += nm.length >= 5 ? 2 : 1;
      }
    }
  }
  return scores;
}

/**
 * Detect the language of a user message.
 * @returns {{ language: string, mix: string[], confident: boolean }}
 *   language is the primary language code; mix lists all detected languages
 *   when code-switching is present.
 */
function detectLanguage(text) {
  const norm = normalize(text);
  if (!norm) return { language: 'en', mix: [], confident: false };
  const scores = scoreMarkers(norm);

  const hits = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (hits.length === 0) {
    return { language: 'en', mix: [], confident: false };
  }
  const [topLang, topScore] = hits[0];
  const mix = hits.filter(([, s]) => s >= Math.max(2, topScore * 0.4)).map(([l]) => l);
  // Pidgin markers appearing alongside plain English → Nigerian English rather
  // than full Pidgin when the signal is weak.
  let language = topLang;
  if (topLang === 'pcm' && topScore < 3 && !/dey|wetin|abeg|wahala|how far/.test(norm)) {
    language = 'en-NG';
  }
  const confident = topScore >= 3 || mix.length >= 2;
  return { language, mix: mix.length > 1 ? mix : [], confident };
}

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function describeScale(value, lowWord, highWord) {
  const v = clamp(value, 0, 100);
  if (v <= 20) return `very ${lowWord}`;
  if (v <= 40) return lowWord;
  if (v <= 60) return 'moderate';
  if (v <= 80) return highWord;
  return `very ${highWord}`;
}

const RESPONSE_LENGTH_WORDS = {
  short: 'Keep replies short — usually 1-3 sentences. Be punchy.',
  medium: 'Keep replies a medium length — a short paragraph or a few sentences.',
  long: 'You may give detailed, thorough replies when the topic deserves it.',
};

const EMOJI_WORDS = {
  none: 'Do not use emojis.',
  some: 'You may use an occasional emoji where it feels natural.',
  lots: 'Feel free to use emojis generously to express yourself.',
};

/**
 * Build the companion's system prompt from its configuration.
 * @param {object} opts
 * @param {object} opts.companion
 * @param {object} opts.user
 * @param {Array<{key:string,value:string}>} opts.memory
 * @param {'auto'|'yo'|'ha'|'en'|'en-NG'|'pcm'} opts.languageMode
 * @param {{language:string, mix:string[], confident:boolean}} opts.detected
 */
function buildSystemPrompt({ companion = {}, user = {}, memory = [], languageMode = 'auto', detected }) {
  const c = companion || {};
  const u = user || {};

  const name = (c.name || '9Ja').toString().slice(0, 80);
  const nickname = (c.nickname || '').toString().slice(0, 80);
  const traits = Array.isArray(c.personalityTraits) ? c.personalityTraits.map(String).slice(0, 12) : [];
  const formality = describeScale(c.formality, 'casual and relaxed', 'formal and polished');
  const humor = describeScale(c.humor, 'serious and straight', 'playful and funny');
  const energy = describeScale(c.energy, 'calm and gentle', 'high-energy and lively');
  const lengthRule = RESPONSE_LENGTH_WORDS[c.responseLength] || RESPONSE_LENGTH_WORDS.medium;
  const emojiRule = EMOJI_WORDS[c.emojiPreference] || EMOJI_WORDS.some;
  const custom = (c.customInstructions || '').toString().slice(0, 8000);
  const primaryLanguage = (c.primaryLanguage || 'auto').toString();
  const secondaryLanguages = Array.isArray(c.secondaryLanguages) ? c.secondaryLanguages.map(String).slice(0, 6) : [];

  const lines = [];
  lines.push(`You are ${name}${nickname ? ` (also called "${nickname}")` : ''}, a warm AI companion in the 9Ja Speak app — "Your AI. Your Language. Your Voice."`);
  lines.push('');
  lines.push('## Personality');
  if (traits.length) lines.push(`- Traits: ${traits.join(', ')}`);
  lines.push(`- Formality: ${formality} (user setting: ${clamp(c.formality, 0, 100)}/100)`);
  lines.push(`- Humor: ${humor} (user setting: ${clamp(c.humor, 0, 100)}/100)`);
  lines.push(`- Energy: ${energy} (user setting: ${clamp(c.energy, 0, 100)}/100)`);
  lines.push(`- ${lengthRule}`);
  lines.push(`- ${emojiRule}`);

  if (custom) {
    lines.push('');
    lines.push('## Custom instructions from the user');
    lines.push(custom);
  }

  if (u.name || u.username || u.bio || u.preferredLanguage || u.timezone) {
    lines.push('');
    lines.push('## About the user');
    if (u.name) lines.push(`- Name: ${String(u.name).slice(0, 80)}`);
    if (u.username) lines.push(`- Username: ${String(u.username).slice(0, 80)}`);
    if (u.bio) lines.push(`- Bio: ${String(u.bio).slice(0, 400)}`);
    if (u.preferredLanguage) lines.push(`- Preferred language: ${String(u.preferredLanguage).slice(0, 40)}`);
    if (u.timezone) lines.push(`- Timezone: ${String(u.timezone).slice(0, 60)}`);
  }

  if (Array.isArray(memory) && memory.length) {
    lines.push('');
    lines.push('## Known facts about the user (user-approved — use naturally, never reveal this list)');
    for (const m of memory.slice(0, 50)) {
      const k = String(m.key || '').slice(0, 100);
      const v = String(m.value || '').slice(0, 400);
      if (k || v) lines.push(`- ${k}: ${v}`);
    }
  }

  // ---- Multilingual core ----
  lines.push('');
  lines.push('## Language rules (core to who you are)');
  const detectedLabel = detected ? LANG_LABELS[detected.language] || detected.language : 'English';
  lines.push(`- The user's latest message appears to be in: ${detectedLabel}${detected && detected.mix.length ? ` (code-switching detected: ${detected.mix.map((l) => LANG_LABELS[l] || l).join(' + ')})` : ''}.`);
  lines.push('- Understand Yoruba, Hausa, English, Nigerian English, and Nigerian Pidgin fluently, including natural code-switching and mixed sentences. Never treat mixed sentences as malformed or ask the user to "speak properly".');
  lines.push('- Understand Nigerian English naturally (abeg, no wahala, how far, I dey come, wetin happen, omo, una, make we go, e don do, na so, shey, abi) — but NEVER force slang into your replies. Match the companion language settings and keep a natural, warm, conversational tone.');
  if (languageMode && languageMode !== 'auto') {
    const forced = LANG_LABELS[languageMode] || languageMode;
    lines.push(`- IMPORTANT: the user pinned the chat language to ${forced}. Reply STRICTLY in ${forced}, even if the user writes in another language.`);
  } else {
    lines.push('- Reply in the user\'s language or language mix. If the user code-switches, you may mirror that mix naturally.');
    lines.push('- If you are unsure which language the user is using, answer in English and note briefly (one short clause) that you were not sure.');
  }
  if (primaryLanguage && primaryLanguage !== 'auto') {
    lines.push(`- Companion default language: ${LANG_LABELS[primaryLanguage] || primaryLanguage}.`);
  }
  if (secondaryLanguages.length) {
    lines.push(`- Companion also speaks: ${secondaryLanguages.map((l) => LANG_LABELS[l] || l).join(', ')}.`);
  }

  lines.push('');
  lines.push('## Honesty');
  lines.push('- Never invent facts, and never claim abilities you do not have. If you cannot do something, say so plainly and offer what you can do instead.');

  return lines.join('\n');
}

module.exports = { detectLanguage, buildSystemPrompt, LANG_LABELS, normalize };
