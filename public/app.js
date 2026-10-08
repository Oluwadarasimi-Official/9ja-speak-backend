'use strict';
/* 9Ja Speak web client — plain JS, no build step. Talks to /api/* relatively. */

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const AVATARS = ['🦁','🌺','🥁','🌟','🦅','🎭','🍃','🔥','💫','🐘','🌙','⚡'];
const TRAITS = ['Friendly','Funny','Intelligent','Calm','Playful','Encouraging','Teacher','Curious'];
const LANGS = { auto: 'Auto detect', yo: 'Yoruba', ha: 'Hausa', en: 'English', 'en-NG': 'Nigerian English', pcm: 'Pidgin' };
const SPEECH_LOCALE = { auto: 'en-NG', yo: 'yo-NG', ha: 'ha-NG', en: 'en-US', 'en-NG': 'en-NG', pcm: 'en-NG' };

const state = {
  profile: store.get('ninejaspeak.profile', null),
  convos: store.get('ninejaspeak.chats', []),
  activeId: store.get('ninejaspeak.active', null),
  streaming: false,
  ttsOn: store.get('ninejaspeak.tts', false),
  tempChat: false,
  providerInfo: null,
};

/* ---------- helpers ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(text) {
  let h = esc(text);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  return h.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2600);
}
function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function activeConvo() {
  let c = state.convos.find((x) => x.id === state.activeId);
  if (!c) {
    c = { id: uid(), title: 'New chat', createdAt: Date.now(), messages: [], temp: false };
    state.convos.unshift(c);
    state.activeId = c.id;
    persist();
  }
  return c;
}
function persist() {
  const saved = state.convos.filter((c) => !c.temp);
  store.set('ninejaspeak.chats', saved);
  store.set('ninejaspeak.active', state.activeId);
}

/* ---------- welcome ---------- */
function initWelcome() {
  const av = $('#w-avatars');
  av.innerHTML = '';
  AVATARS.forEach((e, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = e; b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', 'Avatar ' + e);
    if (i === 0) { b.classList.add('sel'); b.setAttribute('aria-checked', 'true'); }
    b.onclick = () => { av.querySelectorAll('button').forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); }); b.classList.add('sel'); b.setAttribute('aria-checked', 'true'); };
    av.appendChild(b);
  });
  const tr = $('#w-traits');
  tr.innerHTML = '';
  TRAITS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t;
    if (['Friendly', 'Intelligent'].includes(t)) b.classList.add('sel');
    b.onclick = () => b.classList.toggle('sel');
    tr.appendChild(b);
  });
  $('#w-start').onclick = () => {
    const name = $('#w-name').value.trim();
    if (!name) { toast('Tell me your name first 🙂'); $('#w-name').focus(); return; }
    const aiName = $('#w-ainame').value.trim() || 'Ayo';
    state.profile = {
      userName: name,
      aiName,
      nickname: $('#w-nick').value.trim(),
      avatar: (av.querySelector('.sel') || {}).textContent || '🦁',
      lang: $('#w-lang').value,
      traits: [...tr.querySelectorAll('.sel')].map((x) => x.textContent),
      createdAt: Date.now(),
    };
    store.set('ninejaspeak.profile', state.profile);
    enterChat();
  };
}

/* ---------- chat shell ---------- */
function enterChat() {
  $('#welcome').hidden = true;
  $('#chat').hidden = false;
  const p = state.profile;
  $('#c-avatar').textContent = p.avatar;
  $('#c-avatar').classList.add('live');
  $('#c-name').textContent = p.aiName + (p.nickname ? ` (${p.nickname})` : '');
  $('#input').placeholder = `Message ${p.aiName}… (Yoruba, Hausa, Pidgin — anything)`;
  $('#c-lang').value = p.lang || 'auto';
  document.title = `9Ja Speak — ${p.aiName}`;
  renderMessages();
  updateTtsLabel(); updateTempLabel();
  refreshProviderBar();
}

function setStatus(text, cls) {
  const s = $('#c-status');
  s.textContent = text;
  s.classList.toggle('thinking', cls === 'thinking');
}

/* ---------- messages ---------- */
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  const c = activeConvo();
  if (!c.messages.length) {
    const p = state.profile;
    const d = document.createElement('div');
    d.className = 'empty';
    d.innerHTML = `<div class="big">${esc(p.avatar)}</div><h3>${esc(greeting())}, ${esc(p.userName)}.</h3><p>Talk to ${esc(p.aiName)} in ${esc(LANGS[p.lang] || 'any language')} — type, or tap the mic and just speak.</p>`;
    box.appendChild(d);
    return;
  }
  c.messages.forEach((m, i) => box.appendChild(msgEl(m, i)));
  box.scrollTop = box.scrollHeight;
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function msgEl(m, idx) {
  const p = state.profile;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + m.role + (m.error ? ' error' : '');
  const av = document.createElement('div');
  av.className = 'avatar';
  av.textContent = m.role === 'user' ? (p.userName || '?').trim().charAt(0).toUpperCase() : p.avatar;
  const body = document.createElement('div');
  const bub = document.createElement('div');
  bub.className = 'bubble';
  bub.innerHTML = m.streaming ? '<span class="typing"><i></i><i></i><i></i></span>' : fmt(m.content);
  body.appendChild(bub);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let metaHtml = `<span>${time}</span>`;
  if (m.meta && m.meta.provider) metaHtml += `<span class="prov-tag">${esc(m.meta.provider)}</span>`;
  if (m.meta && m.meta.language && m.meta.language !== 'auto') metaHtml += `<span>· ${esc(LANGS[m.meta.language] || m.meta.language)}</span>`;
  if (m.meta && m.meta.failoverFrom) metaHtml += `<span>· via failover</span>`;
  const acts = document.createElement('span');
  acts.className = 'msg-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'chip-btn'; copyBtn.textContent = '⧉'; copyBtn.title = 'Copy';
  copyBtn.onclick = () => { navigator.clipboard.writeText(m.content).then(() => toast('Copied'), () => toast('Copy failed')); };
  acts.appendChild(copyBtn);

  if (m.role === 'ai' && !m.error) {
    const spk = document.createElement('button');
    spk.className = 'chip-btn'; spk.textContent = '🔊'; spk.title = 'Read aloud';
    spk.onclick = () => speak(m.content);
    acts.appendChild(spk);
    const reg = document.createElement('button');
    reg.className = 'chip-btn'; reg.textContent = '↻'; reg.title = 'Regenerate';
    reg.onclick = () => regenerate(idx);
    acts.appendChild(reg);
  }
  if (m.error) {
    const rb = document.createElement('button');
    rb.className = 'retry-btn'; rb.textContent = '↻ Try again';
    rb.onclick = () => retry(idx);
    body.appendChild(rb);
  }
  const tmp = document.createElement('span'); tmp.innerHTML = metaHtml;
  meta.appendChild(tmp); meta.appendChild(acts);
  body.appendChild(meta);
  wrap.appendChild(av); wrap.appendChild(body);
  return wrap;
}

function appendMsg(m) {
  const empty = $('#messages .empty');
  if (empty) empty.remove();
  const c = activeConvo();
  c.messages.push(m);
  if (!c.temp) persist();
  const el = msgEl(m, c.messages.length - 1);
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return { msg: m, el };
}
function updateMsg(idx, patch) {
  const c = activeConvo();
  Object.assign(c.messages[idx], patch);
  if (!c.temp) persist();
  const box = $('#messages');
  const old = box.children[idx];
  const fresh = msgEl(c.messages[idx], idx);
  if (old) box.replaceChild(fresh, old);
  box.scrollTop = box.scrollHeight;
}

/* ---------- SSE ---------- */
async function streamChat(payload, cbs) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-guest': 'true' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status}).`;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', evt = null, done = false;

  const handleLine = (line) => {
    if (line.startsWith('event:')) { evt = line.slice(6).trim(); return; }
    if (line.startsWith(':')) return; // heartbeat
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data === '[DONE]') { done = true; return; }
      let obj = null;
      try { obj = JSON.parse(data); } catch { return; }
      if (evt === 'token' && obj.text) cbs.token(obj.text);
      else if (evt === 'metadata') cbs.metadata(obj);
      else if (evt === 'error') cbs.error(obj);
      evt = null;
    }
  };

  for (;;) {
    const { value, done: rd } = await reader.read();
    if (rd) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
      if (done) break;
    }
    if (done) break;
  }
  if (buf.trim()) handleLine(buf.trim());
  cbs.done();
}

/* ---------- send flow ---------- */
function buildPayload(text) {
  const p = state.profile;
  const c = activeConvo();
  const history = c.messages
    .filter((m) => !m.error && !m.streaming && m.content)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: text });
  return {
    messages: history,
    companion: {
      name: p.aiName, nickname: p.nickname, avatarStyle: 'emoji',
      personalityTraits: p.traits, formality: 40, humor: 65, energy: 70,
      responseLength: 'medium', emojiPreference: 'some',
      primaryLanguage: p.lang || 'auto', secondaryLanguages: [],
    },
    user: { name: p.userName },
    languageMode: $('#c-lang').value || 'auto',
    providerMode: 'auto',
    memory: [],
  };
}

async function send(text) {
  text = (text || '').trim();
  if (!text || state.streaming) return;
  const c = activeConvo();
  if (state.tempChat && !c.temp) { c.temp = true; }

  appendMsg({ role: 'user', content: text, ts: Date.now() });
  if (c.messages.length <= 2 && (!c.title || c.title === 'New chat')) {
    c.title = text.slice(0, 42); persist();
  }
  const ai = appendMsg({ role: 'ai', content: '', ts: Date.now(), streaming: true });
  const aiIdx = activeConvo().messages.length - 1;
  $('#input').value = ''; autoresize();
  state.streaming = true;
  setStatus('thinking…', 'thinking');
  $('#send').disabled = true;

  let gotToken = false, meta = null, errObj = null;
  try {
    await streamChat(buildPayload(text), {
      token: (t) => {
        gotToken = true;
        ai.msg.content += t; ai.msg.streaming = false;
        const bub = ai.el.querySelector('.bubble');
        bub.innerHTML = fmt(ai.msg.content) ;
        bub.classList.add('stream-caret');
        $('#messages').scrollTop = $('#messages').scrollHeight;
      },
      metadata: (m) => { meta = m; },
      error: (e) => { errObj = e; },
      done: () => {},
    });
  } catch (e) {
    errObj = { message: e.message || 'Network error. Please try again.', error: 'network_error', retryable: true };
  }

  state.streaming = false;
  $('#send').disabled = false;

  const finish = { streaming: false, meta: meta || undefined };
  if (errObj) {
    finish.error = true;
    finish.content = errObj.message || 'Something went wrong. Please try again.';
  } else if (!gotToken) {
    finish.error = true;
    finish.content = 'No response arrived. Check your connection and try again.';
  }
  updateMsg(aiIdx, finish);
  const bar = $('#provider-bar');
  if (meta && meta.provider && !meta.error) {
    bar.hidden = false; bar.classList.add('ok');
    bar.textContent = `◈ ${meta.provider}${meta.failoverFrom ? ` (failover from ${meta.failoverFrom})` : ''} · ${Math.round((meta.latencyMs || 0) / 100) / 10}s`;
  } else if (errObj) {
    bar.hidden = false; bar.classList.remove('ok');
    bar.textContent = '⚠ ' + (errObj.message || 'AI unavailable');
  }
  setStatus(errObj ? 'having trouble' : 'online', errObj ? '' : '');

  if (!errObj && state.ttsOn && ai.msg.content) speak(ai.msg.content);
  if (!activeConvo().temp) persist();
}

function retry(idx) {
  const c = activeConvo();
  // find the user message this error followed
  let uIdx = idx - 1;
  while (uIdx >= 0 && c.messages[uIdx].role !== 'user') uIdx--;
  if (uIdx < 0) return;
  const text = c.messages[uIdx].content;
  c.messages.splice(uIdx); // drop user msg + failed ai msg; send() re-adds
  if (!c.temp) persist();
  renderMessages();
  send(text);
}

function regenerate(idx) {
  const c = activeConvo();
  let uIdx = idx - 1;
  while (uIdx >= 0 && c.messages[uIdx].role !== 'user') uIdx--;
  if (uIdx < 0) return;
  const text = c.messages[uIdx].content;
  c.messages.splice(uIdx);
  if (!c.temp) persist();
  renderMessages();
  send(text);
}

/* ---------- provider status ---------- */
async function refreshProviderBar() {
  try {
    const r = await fetch('/api/health/providers');
    const j = await r.json();
    state.providerInfo = j;
  } catch { state.providerInfo = null; }
}
function showProviderStatus() {
  const j = state.providerInfo;
  if (!j) { toast('Could not reach provider status.'); return; }
  const fmtOne = (k) => {
    const p = j[k] || {};
    return `${k}: ${p.configured ? 'ready (' + (p.model || '?') + ')' : 'not configured yet'}`;
  };
  toast(`◈ ${fmtOne('gemini')} · ${fmtOne('groq')} · mode: ${(j.default || 'auto')}`);
}

/* ---------- voice input ---------- */
let recog = null, recognizing = false;
function micSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function toggleMic() {
  if (!micSupported()) { toast('Voice input is not supported in this browser.'); return; }
  if (recognizing) { recog.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = SPEECH_LOCALE[$('#c-lang').value] || 'en-NG';
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  const micBtn = $('#mic');
  recog.onstart = () => { recognizing = true; micBtn.classList.add('rec'); setStatus('listening…', 'thinking'); };
  recog.onresult = (e) => {
    let interim = '', final = '';
    for (const r of e.results) { (r.isFinal ? final += r[0].transcript : interim += r[0].transcript); }
    $('#input').value = (final || interim).trim();
    autoresize();
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Microphone blocked — allow it in browser settings.');
    else if (e.error !== 'aborted') toast('Voice hiccup — try again.');
  };
  recog.onend = () => { recognizing = false; micBtn.classList.remove('rec'); setStatus('online'); };
  try { recog.start(); } catch { toast('Could not start voice input.'); }
}

/* ---------- TTS ---------- */
function speak(text) {
  if (!('speechSynthesis' in window)) { toast('Read-aloud is not supported here.'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 600));
  u.lang = SPEECH_LOCALE[$('#c-lang').value] || 'en-NG';
  u.rate = 1;
  speechSynthesis.speak(u);
}
function updateTtsLabel() { $('#m-tts-state').textContent = state.ttsOn ? 'on' : 'off'; }
function updateTempLabel() { $('#m-temp-state').textContent = state.tempChat ? 'on' : 'off'; }

/* ---------- composer ---------- */
function autoresize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 130) + 'px';
}

function initChat() {
  const input = $('#input');
  input.addEventListener('input', autoresize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  $('#send').onclick = () => send(input.value);

  const mic = $('#mic');
  if (!micSupported()) { mic.disabled = true; mic.title = 'Voice input not supported in this browser'; }
  else mic.onclick = toggleMic;

  $('#c-theme').onclick = () => {
    const h = document.documentElement;
    h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
    $('#c-theme').textContent = h.dataset.theme === 'dark' ? '☾' : '☀';
    store.set('ninejaspeak.theme', h.dataset.theme);
  };
  const savedTheme = store.get('ninejaspeak.theme', 'dark');
  document.documentElement.dataset.theme = savedTheme;
  $('#c-theme').textContent = savedTheme === 'dark' ? '☾' : '☀';

  $('#c-lang').onchange = (e) => {
    state.profile.lang = e.target.value;
    store.set('ninejaspeak.profile', state.profile);
  };

  const menu = $('#c-menu');
  $('#c-menu-btn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });

  $('#m-provider').onclick = () => { menu.hidden = true; showProviderStatus(); };
  $('#m-tts').onclick = () => { state.ttsOn = !state.ttsOn; store.set('ninejaspeak.tts', state.ttsOn); updateTtsLabel(); if (!state.ttsOn && 'speechSynthesis' in window) speechSynthesis.cancel(); };
  $('#m-temp').onclick = () => {
    state.tempChat = !state.tempChat; updateTempLabel();
    toast(state.tempChat ? 'Temporary chat on — this chat won\'t be saved.' : 'Temporary chat off.');
  };
  $('#m-clear').onclick = () => {
    menu.hidden = true;
    const c = activeConvo();
    c.messages = []; c.title = 'New chat';
    persist(); renderMessages(); toast('Chat cleared.');
  };
  $('#m-reset').onclick = () => {
    menu.hidden = true;
    if (!confirm('Start over with a new companion? Your saved chats stay in this browser.')) return;
    store.del('ninejaspeak.profile');
    location.reload();
  };
}

/* ---------- boot ---------- */
initWelcome();
initChat();
if (state.profile) enterChat();
