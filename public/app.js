'use strict';
/* 9Ja Speak web client — plain JS, no build step. Talks to /api/* relatively.
   ChatGPT-level polish, original 9Ja Speak skin. Nothing faked: every control works. */

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
const SUGGESTIONS = [
  { tag: 'Yoruba', q: 'Ṣàlàyé photosynthesis fún mi' },
  { tag: 'Pidgin', q: 'How far, wetin be the capital of Kano State?' },
  { tag: 'Learn', q: 'Teach me 5 common Yoruba greetings with pronunciations' },
  { tag: 'Hausa', q: "Translate 'good morning, how are you?' to Hausa" },
];

const state = {
  profile: store.get('ninejaspeak.profile', null),
  convos: normalizeConvos(store.get('ninejaspeak.chats', [])),
  activeId: store.get('ninejaspeak.active', null),
  streaming: false,
  ttsOn: store.get('ninejaspeak.tts', false),
  tempChat: false,
  providerInfo: null,
  activeProvider: null,
  pendingAttachments: [],
  stickToBottom: true,
  aborter: null,
};

function normalizeConvos(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: c.id || uid(),
    title: c.title || 'New chat',
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt || c.createdAt || Date.now(),
    pinned: !!c.pinned,
    temp: !!c.temp,
    messages: Array.isArray(c.messages) ? c.messages : [],
  }));
}

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2800);
}
function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function copyText(t) {
  const done = () => toast('Copied');
  const fail = () => toast('Copy failed');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, fail);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { fail(); }
  ta.remove();
}

/* ---------- conversations ---------- */
function activeConvo() {
  let c = state.convos.find((x) => x.id === state.activeId);
  if (!c) {
    c = { id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, temp: state.tempChat, messages: [] };
    state.convos.unshift(c);
    state.activeId = c.id;
    persist();
  }
  return c;
}
function persist() {
  store.set('ninejaspeak.chats', state.convos.filter((c) => !c.temp));
  store.set('ninejaspeak.active', state.activeId);
}
function newChat() {
  if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
  const c = { id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), pinned: false, temp: state.tempChat, messages: [] };
  state.convos.unshift(c);
  state.activeId = c.id;
  persist();
  renderConvoList();
  renderMessages();
  closeSidebar();
  $('#input').focus();
}
function switchConvo(id) {
  if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
  state.activeId = id;
  persist();
  renderConvoList();
  renderMessages();
  closeSidebar();
}
function deleteConvo(id) {
  if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
  openModal({
    title: 'Delete chat?',
    body: 'This conversation will be removed from this browser. This cannot be undone.',
    okLabel: 'Delete', danger: true,
    onOk: () => {
      state.convos = state.convos.filter((c) => c.id !== id);
      if (state.activeId === id) state.activeId = null;
      persist(); renderConvoList(); renderMessages();
      toast('Chat deleted.');
    },
  });
}
function togglePin(id) {
  const c = state.convos.find((x) => x.id === id);
  if (c) { c.pinned = !c.pinned; persist(); renderConvoList(); }
}
function renderConvoList() {
  const box = $('#convo-list');
  box.innerHTML = '';
  const q = ($('#convo-search').value || '').trim().toLowerCase();
  const match = (c) => !q || c.title.toLowerCase().includes(q) ||
    c.messages.some((m) => (m.content || '').toLowerCase().includes(q));
  const list = state.convos.filter(match);
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'convo-empty';
    d.textContent = q ? 'No chats match your search.' : 'No conversations yet.\nStart a new chat above.';
    box.appendChild(d);
    return;
  }
  const groups = [['📌 Pinned', list.filter((c) => c.pinned)], ['Recent', list.filter((c) => !c.pinned)]];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const gl = document.createElement('div');
    gl.className = 'convo-group-label'; gl.textContent = label;
    box.appendChild(gl);
    items.sort((a, b) => b.updatedAt - a.updatedAt).forEach((c) => box.appendChild(convoItemEl(c)));
  }
}
function convoItemEl(c) {
  const el = document.createElement('div');
  el.className = 'convo-item' + (c.id === state.activeId ? ' active' : '');
  const lastUser = [...c.messages].reverse().find((m) => m.role === 'user');
  el.innerHTML = `
    <div class="t">${esc(c.title)}</div>
    <div class="s">${c.pinned ? '<span class="pin-dot">📌</span>' : ''}<span>${timeAgo(c.updatedAt)}${c.temp ? ' · temp' : ''}</span></div>
    <div class="row-actions">
      <button data-act="pin" title="${c.pinned ? 'Unpin' : 'Pin'}">${c.pinned ? '📍' : '📌'}</button>
      <button data-act="rename" title="Rename">✏️</button>
      <button data-act="del" class="danger" title="Delete">🗑</button>
    </div>`;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) { switchConvo(c.id); return; }
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'pin') togglePin(c.id);
    else if (act === 'del') deleteConvo(c.id);
    else if (act === 'rename') startRename(el, c);
  });
  return el;
}
function startRename(el, c) {
  const t = el.querySelector('.t');
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = c.title;
  input.maxLength = 60;
  t.replaceWith(input);
  input.focus(); input.select();
  const commit = (save) => {
    if (save && input.value.trim()) { c.title = input.value.trim(); c.updatedAt = Date.now(); persist(); }
    renderConvoList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

/* ---------- sidebar ---------- */
function openSidebar() { $('#sidebar').classList.add('open'); $('#backdrop').hidden = false; }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#backdrop').hidden = true; }
function initSidebar() {
  $('#hamburger').onclick = openSidebar;
  $('#side-close').onclick = closeSidebar;
  $('#backdrop').onclick = closeSidebar;
  $('#new-chat').onclick = newChat;
  $('#convo-search').addEventListener('input', renderConvoList);
  $('#side-reset').onclick = () => {
    openModal({
      title: 'Start over?',
      body: 'Create a brand-new AI companion? Your saved chats stay in this browser.',
      okLabel: 'Start over',
      onOk: () => { store.del('ninejaspeak.profile'); location.reload(); },
    });
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
  $('#side-avatar').textContent = p.avatar;
  $('#side-username').textContent = p.userName;
  $('#side-ainame').textContent = 'Talking to ' + p.aiName;
  document.title = `9Ja Speak — ${p.aiName}`;
  updateTtsLabel(); updateTempLabel();
  renderConvoList();
  renderMessages();
  refreshProviders();
}
function setStatus(text, cls) {
  const s = $('#c-status');
  s.textContent = text;
  s.className = 'peer-status' + (cls ? ' ' + cls : '');
}

/* ---------- messages ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  const c = activeConvo();
  c.messages.forEach((m, i) => { m._idx = i; });
  if (!c.messages.length) {
    box.appendChild(emptyStateEl());
  } else {
    c.messages.forEach((m, i) => box.appendChild(msgRow(m, i)));
  }
  state.stickToBottom = true;
  box.scrollTop = box.scrollHeight;
  updateJump();
}
function emptyStateEl() {
  const p = state.profile;
  const d = document.createElement('div');
  d.className = 'empty';
  const chips = SUGGESTIONS.map((s) =>
    `<button data-q="${esc(s.q)}"><b>${esc(s.tag)}</b>${esc(s.q)}</button>`).join('');
  d.innerHTML = `
    <div class="big">${esc(p.avatar)}</div>
    <h3>${esc(greeting())}, ${esc(p.userName)}. <span class="hl">I'm ${esc(p.aiName)}.</span></h3>
    <p>Your AI. Your Language. Your Voice. — ask me anything in Yoruba, Hausa, English, Nigerian English or Pidgin.</p>
    <div class="suggest">${chips}</div>`;
  d.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => send(b.dataset.q);
  });
  return d;
}
function msgRow(m, idx) {
  const p = state.profile;
  const row = document.createElement('div');
  row.className = 'row ' + m.role + (m.error ? ' error-row' : '');
  const body = document.createElement('div');
  body.className = 'row-body';

  if (m.role === 'user') {
    if (m.attachments && m.attachments.length) {
      const th = document.createElement('div');
      th.className = 'attach-thumbs';
      m.attachments.forEach((a) => {
        const im = document.createElement('img');
        im.src = a.dataUrl; im.alt = esc(a.name || 'attachment');
        th.appendChild(im);
      });
      body.appendChild(th);
    }
    const bub = document.createElement('div');
    bub.className = 'user-bubble';
    bub.textContent = m.content;
    body.appendChild(bub);
  } else {
    const av = document.createElement('div');
    av.className = 'avatar'; av.textContent = p.avatar;
    row.appendChild(av);
    const name = document.createElement('div');
    name.className = 'row-name'; name.textContent = p.aiName;
    body.appendChild(name);
    const txt = document.createElement('div');
    txt.className = 'ai-text' + (m.streaming ? ' streaming' : '');
    if (m.streaming && !m.content) txt.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    else if (m.error) txt.appendChild(errorCard(m, idx));
    else if (m.streaming) { txt.textContent = m.content; txt.classList.add('stream-caret'); }
    else txt.innerHTML = fmt(m.content);
    body.appendChild(txt);
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let metaHtml = `<span>${time}</span>`;
  if (m.role === 'ai' && m.meta) {
    if (m.meta.provider) metaHtml += `<span class="prov-tag">${esc(m.meta.provider.toUpperCase())}</span>`;
    if (m.meta.failoverFrom) metaHtml += `<span>via failover</span>`;
    if (m.meta.language && m.meta.language !== 'auto') metaHtml += `<span>· ${esc(LANGS[m.meta.language] || m.meta.language)}</span>`;
  }
  const acts = document.createElement('span');
  acts.className = 'msg-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'chip-btn'; copyBtn.textContent = '⧉'; copyBtn.title = 'Copy';
  copyBtn.onclick = () => copyText(m.content || '');
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
  const tmp = document.createElement('span'); tmp.innerHTML = metaHtml;
  meta.appendChild(tmp); meta.appendChild(acts);
  body.appendChild(meta);
  row.appendChild(body);
  return row;
}
function errorCard(m, idx) {
  const card = document.createElement('div');
  card.className = 'error-card';
  const msg = document.createElement('div');
  msg.textContent = m.content;
  const rb = document.createElement('button');
  rb.className = 'retry-btn'; rb.textContent = '↻ Try again';
  rb.onclick = () => retry(idx);
  card.appendChild(msg); card.appendChild(rb);
  return card;
}
function appendMsg(m) {
  const box = $('#messages');
  const empty = box.querySelector('.empty');
  if (empty) empty.remove();
  const c = activeConvo();
  m._idx = c.messages.length;
  c.messages.push(m);
  c.updatedAt = Date.now();
  if (!c.temp) persist();
  const el = msgRow(m, m._idx);
  box.appendChild(el);
  state.stickToBottom = true;
  box.scrollTop = box.scrollHeight;
  updateJump();
  renderConvoList();
  return { msg: m, el };
}
function refreshRow(idx) {
  const c = activeConvo();
  const box = $('#messages');
  const old = box.children[idx];
  if (!old || !old.classList.contains('row')) return;
  const fresh = msgRow(c.messages[idx], idx);
  box.replaceChild(fresh, old);
  if (state.stickToBottom) box.scrollTop = box.scrollHeight;
  updateJump();
}

/* ---------- scroll ---------- */
function initScroll() {
  const box = $('#messages');
  box.addEventListener('scroll', () => {
    state.stickToBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    updateJump();
  }, { passive: true });
  $('#jump').onclick = () => {
    state.stickToBottom = true;
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    updateJump();
  };
}
function updateJump() {
  const box = $('#messages');
  const need = box.scrollHeight - box.clientHeight > 120;
  $('#jump').hidden = state.stickToBottom || !need;
}
function scrollBottom(force) {
  const box = $('#messages');
  if (force || state.stickToBottom) box.scrollTop = box.scrollHeight;
  updateJump();
}

/* ---------- SSE ---------- */
async function streamChat(payload, cbs, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-guest': 'true' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status}).`;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch {}
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', evt = null, done = false;

  const handleLine = (line) => {
    if (!line) { evt = null; return; }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) { evt = line.slice(6).trim(); return; }
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

  try {
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
  } catch (e) {
    if (signal && signal.aborted) { cbs.aborted(); return; }
    throw e;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (buf.trim()) handleLine(buf.trim());
  cbs.done();
}

/* ---------- send flow ---------- */
function buildPayload(text, attachments) {
  const p = state.profile;
  const c = activeConvo();
  const history = c.messages
    .filter((m) => !m.error && !m.streaming && m.content)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: text });
  const payload = {
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
  if (attachments && attachments.length) {
    payload.attachments = attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, dataBase64: a.dataBase64 }));
  }
  return payload;
}

function setStreamingUI(on) {
  state.streaming = on;
  const btn = $('#send');
  btn.disabled = false;
  btn.classList.toggle('stop', on);
  btn.innerHTML = on ? '■' : '➤';
  btn.title = on ? 'Stop' : 'Send';
  $('#mic').disabled = on;
  $('#attach').disabled = on;
}

async function send(text) {
  text = (text || '').trim();
  if (!text || state.streaming) return;

  const c = activeConvo();
  if (state.tempChat && !c.temp) c.temp = true;

  const atts = takePendingAttachments();
  const userMsg = { role: 'user', content: text, ts: Date.now() };
  if (atts.length) userMsg.attachments = atts.map((a) => ({ name: a.name, dataUrl: a.dataUrl }));
  appendMsg(userMsg);

  if (c.messages.length <= 2 && (!c.title || c.title === 'New chat')) {
    c.title = text.slice(0, 42) || 'Image message';
    persist(); renderConvoList();
  }

  const aiRef = appendMsg({ role: 'ai', content: '', ts: Date.now(), streaming: true });
  const aiIdx = aiRef.msg._idx;
  $('#input').value = ''; autoresize();
  setStreamingUI(true);
  setStatus('thinking…', 'thinking');
  state.aborter = new AbortController();

  let gotToken = false, meta = null, errObj = null, wasAborted = false;
  try {
    await streamChat(buildPayload(text, atts), {
      token: (t) => {
        gotToken = true;
        aiRef.msg.content += t;
        aiRef.msg.streaming = false;
        const txt = aiRef.el.querySelector('.ai-text');
        if (txt) {
          txt.classList.add('streaming', 'stream-caret');
          txt.textContent = aiRef.msg.content;
        }
        if (state.stickToBottom) $('#messages').scrollTop = $('#messages').scrollHeight;
        updateJump();
      },
      metadata: (m) => { meta = m; },
      error: (e) => { errObj = e; },
      done: () => {},
      aborted: () => { wasAborted = true; },
    }, state.aborter.signal);
  } catch (e) {
    if (e && e.name === 'AbortError') { wasAborted = true; }
    else errObj = { message: e.message || 'Network error. Please try again.', error: 'network_error', retryable: true };
  }

  setStreamingUI(false);
  state.aborter = null;

  const finish = { streaming: false, meta: meta || undefined };
  if (wasAborted) {
    if (!aiRef.msg.content) {
      // stopped before anything arrived — drop the placeholder row
      const cc = activeConvo();
      cc.messages.splice(aiIdx, 1);
      cc.messages.forEach((m, i) => { m._idx = i; });
      if (!cc.temp) persist();
      renderMessages();
      setStatus('online');
      return;
    }
    // keep partial answer, no error
  } else if (errObj) {
    finish.error = true;
    finish.content = errObj.message || 'Something went wrong. Please try again.';
  } else if (!gotToken) {
    finish.error = true;
    finish.content = 'No response arrived. Check your connection and try again.';
  }
  Object.assign(aiRef.msg, finish);
  refreshRow(aiIdx);

  const bar = $('#provider-bar');
  if (meta && meta.provider && !meta.error) {
    bar.hidden = false; bar.classList.add('ok');
    bar.textContent = `◈ ${meta.provider}${meta.failoverFrom ? ` (failover from ${meta.failoverFrom})` : ''} · ${(Math.round((meta.latencyMs || 0) / 100) / 10)}s`;
    state.activeProvider = { name: meta.provider, failoverFrom: meta.failoverFrom || null };
    paintProviderChip();
  } else if (errObj && !wasAborted) {
    bar.hidden = false; bar.classList.remove('ok');
    bar.textContent = '⚠ ' + (errObj.message || 'AI unavailable');
  }
  setStatus(errObj && !wasAborted ? 'having trouble' : 'online', errObj && !wasAborted ? 'error' : '');

  if (!errObj && state.ttsOn && aiRef.msg.content) speak(aiRef.msg.content);
  if (!activeConvo().temp) persist();
  renderConvoList();
}

function stopStream() {
  if (state.aborter) state.aborter.abort();
}

function lastUserTextBefore(idx) {
  const c = activeConvo();
  let uIdx = idx - 1;
  while (uIdx >= 0 && c.messages[uIdx].role !== 'user') uIdx--;
  return uIdx >= 0 ? { uIdx, text: c.messages[uIdx].content, atts: c.messages[uIdx].attachments } : null;
}
function retry(idx) {
  if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
  const found = lastUserTextBefore(idx);
  if (!found) return;
  const c = activeConvo();
  const text = c.messages[found.uIdx].content;
  c.messages.splice(found.uIdx);
  if (!c.temp) persist();
  renderMessages();
  // attachments were already sent once; resend text only (images stay visible in history)
  send(text);
}
function regenerate(idx) {
  if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
  const found = lastUserTextBefore(idx);
  if (!found) return;
  const c = activeConvo();
  const text = c.messages[found.uIdx].content;
  c.messages.splice(found.uIdx);
  if (!c.temp) persist();
  renderMessages();
  send(text);
}

/* ---------- attachments ---------- */
function takePendingAttachments() {
  const a = state.pendingAttachments;
  state.pendingAttachments = [];
  renderAttachPreview();
  return a;
}
function renderAttachPreview() {
  const box = $('#attach-preview');
  box.innerHTML = '';
  box.hidden = !state.pendingAttachments.length;
  state.pendingAttachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const im = document.createElement('img');
    im.src = a.dataUrl; im.alt = esc(a.name);
    const x = document.createElement('button');
    x.textContent = '✕'; x.title = 'Remove';
    x.onclick = () => { state.pendingAttachments.splice(i, 1); renderAttachPreview(); };
    chip.appendChild(im); chip.appendChild(x);
    box.appendChild(chip);
  });
}
function processImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Only images can be attached.'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const MAX = 1568;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = cv.toDataURL('image/jpeg', 0.85);
        const b64 = dataUrl.split(',')[1] || '';
        if (!b64 || b64.length > 4.5 * 1024 * 1024) return reject(new Error('Image is too large.'));
        resolve({ name: file.name || 'image.jpg', mimeType: 'image/jpeg', dataBase64: b64, dataUrl });
      } catch (e) { reject(new Error('Could not read that image.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
function initAttachments() {
  const fi = $('#file-input');
  $('#attach').onclick = () => fi.click();
  fi.addEventListener('change', async () => {
    const files = [...fi.files].slice(0, 3 - state.pendingAttachments.length);
    fi.value = '';
    if (!files.length) { if (state.pendingAttachments.length >= 3) toast('At most 3 images per message.'); return; }
    for (const f of files) {
      try {
        const a = await processImage(f);
        state.pendingAttachments.push(a);
      } catch (e) { toast(e.message); }
    }
    renderAttachPreview();
  });
}

/* ---------- provider status ---------- */
async function refreshProviders() {
  try {
    const r = await fetch('/api/health/providers');
    state.providerInfo = await r.json();
  } catch { state.providerInfo = null; }
  paintProviderChip();
}
function providerSummary() {
  const j = state.providerInfo;
  if (!j) return { label: 'AI status unknown', cls: '', detail: null };
  const g = j.gemini || {}, q = j.groq || {};
  if (state.activeProvider) {
    const f = state.activeProvider.failoverFrom ? ` (failover from ${state.activeProvider.failoverFrom})` : '';
    return { label: cap(state.activeProvider.name) + f, cls: 'ok', detail: j };
  }
  if (g.configured) return { label: 'Gemini', cls: 'ok', detail: j };
  if (q.configured) return { label: 'Groq', cls: 'ok', detail: j };
  return { label: 'AI offline', cls: 'warn', detail: j };
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function paintProviderChip() {
  const s = providerSummary();
  $('#prov-label').textContent = s.label;
  $('#prov-chip .dot').className = 'dot ' + s.cls;
}
function showProviderModal() {
  const j = state.providerInfo;
  if (!j) { toast('Could not reach provider status.'); return; }
  const line = (name, p) => {
    const ok = p && p.configured;
    return `<div class="prov-line"><span>${esc(cap(name))}${p && p.model ? ` <span style="opacity:.6">· ${esc(p.model)}</span>` : ''}</span><span class="${ok ? 'ok' : 'bad'}">${ok ? 'ready' : 'no key yet'}</span></div>`;
  };
  const avg = (p) => p && p.avgLatencyMs != null ? ` · ~${Math.round(p.avgLatencyMs)}ms` : '';
  openModal({
    title: '◈ AI provider status',
    bodyHTML:
      line('gemini', j.gemini) + line('groq', j.groq) +
      `<div class="prov-line"><span>Mode</span><span>${esc(j.default || 'auto')}${state.activeProvider && state.activeProvider.failoverFrom ? ` · failover from ${esc(state.activeProvider.failoverFrom)}` : ''}</span></div>` +
      `<div style="margin-top:10px">Automatic failover is on: if one provider fails, the other takes over and your message is never lost.${avg(j.gemini)}${avg(j.groq)}</div>`,
    okLabel: 'Close', hideCancel: true,
  });
  refreshProviders();
}

/* ---------- modal ---------- */
let modalOk = null;
function openModal({ title, body, bodyHTML, okLabel = 'Confirm', danger = false, hideCancel = false, onOk = null }) {
  $('#modal-title').textContent = title;
  const b = $('#modal-body');
  b.innerHTML = '';
  if (bodyHTML) b.innerHTML = bodyHTML;
  else b.textContent = body || '';
  const ok = $('#modal-ok');
  ok.textContent = okLabel;
  ok.classList.toggle('danger', !!danger);
  $('#modal-cancel').style.display = hideCancel ? 'none' : '';
  modalOk = onOk;
  $('#modal-backdrop').hidden = false;
}
function closeModal() { $('#modal-backdrop').hidden = true; modalOk = null; }
function initModal() {
  $('#modal-cancel').onclick = closeModal;
  $('#modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });
  $('#modal-ok').onclick = () => { const f = modalOk; closeModal(); if (f) f(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal-backdrop').hidden) closeModal(); });
}

/* ---------- voice input ---------- */
let recog = null, recognizing = false, micBase = '';
function micSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
function toggleMic() {
  if (!micSupported()) { toast('Voice input is not supported in this browser.'); return; }
  if (recognizing) { try { recog.stop(); } catch {} return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = SPEECH_LOCALE[$('#c-lang').value] || 'en-NG';
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  micBase = $('#input').value ? $('#input').value.replace(/\s+$/, '') + ' ' : '';
  const micBtn = $('#mic');
  recog.onstart = () => { recognizing = true; micBtn.classList.add('rec'); setStatus('listening…', 'thinking'); };
  recog.onresult = (e) => {
    let interim = '';
    for (const r of e.results) {
      if (r.isFinal) micBase += r[0].transcript.replace(/\s+$/, '') + ' ';
      else interim += r[0].transcript;
    }
    $('#input').value = (micBase + interim).trimStart();
    autoresize();
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone blocked — allow it in browser settings.');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Voice hiccup — try again.');
  };
  recog.onend = () => { recognizing = false; micBtn.classList.remove('rec'); setStatus('online'); };
  try { recog.start(); } catch { toast('Could not start voice input.'); recognizing = false; }
}

/* ---------- TTS ---------- */
function speak(text) {
  if (!('speechSynthesis' in window)) { toast('Read-aloud is not supported here.'); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 600));
    u.lang = SPEECH_LOCALE[$('#c-lang').value] || 'en-NG';
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch { toast('Read-aloud failed.'); }
}
function updateTtsLabel() { $('#m-tts-state').textContent = state.ttsOn ? 'on' : 'off'; }
function updateTempLabel() { $('#m-temp-state').textContent = state.tempChat ? 'on' : 'off'; }

/* ---------- composer ---------- */
function autoresize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 150) + 'px';
}

function initChat() {
  const input = $('#input');
  input.addEventListener('input', autoresize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  $('#send').onclick = () => {
    if (state.streaming) stopStream();
    else send(input.value);
  };

  const mic = $('#mic');
  if (!micSupported()) { mic.disabled = true; mic.title = 'Voice input not supported in this browser'; }
  else mic.onclick = toggleMic;

  initAttachments();
  initScroll();
  initModal();

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

  $('#prov-chip').onclick = showProviderModal;

  const menu = $('#c-menu');
  $('#c-menu-btn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });

  $('#m-tts').onclick = () => {
    state.ttsOn = !state.ttsOn;
    store.set('ninejaspeak.tts', state.ttsOn);
    updateTtsLabel();
    if (!state.ttsOn && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch {} }
    menu.hidden = true;
  };
  $('#m-temp').onclick = () => {
    state.tempChat = !state.tempChat;
    updateTempLabel();
    toast(state.tempChat ? "Temporary chat on — new chats won't be saved." : 'Temporary chat off.');
    menu.hidden = true;
  };
  $('#m-clear').onclick = () => {
    menu.hidden = true;
    if (state.streaming) { toast('Wait for the reply to finish first.'); return; }
    openModal({
      title: 'Clear this chat?',
      body: 'All messages in this conversation will be removed from this browser.',
      okLabel: 'Clear', danger: true,
      onOk: () => {
        const c = activeConvo();
        c.messages = []; c.title = 'New chat'; c.updatedAt = Date.now();
        persist(); renderMessages(); renderConvoList();
        toast('Chat cleared.');
      },
    });
  };
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
    b.onclick = () => {
      av.querySelectorAll('button').forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('sel'); b.setAttribute('aria-checked', 'true');
    };
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
  const start = () => {
    const name = $('#w-name').value.trim();
    if (!name) { toast('Tell me your name first 🙂'); $('#w-name').focus(); return; }
    state.profile = {
      userName: name,
      aiName: $('#w-ainame').value.trim() || 'Ayo',
      nickname: $('#w-nick').value.trim(),
      avatar: (av.querySelector('.sel') || {}).textContent || '🦁',
      lang: $('#w-lang').value,
      traits: [...tr.querySelectorAll('.sel')].map((x) => x.textContent),
      createdAt: Date.now(),
    };
    store.set('ninejaspeak.profile', state.profile);
    enterChat();
  };
  $('#w-start').onclick = start;
  $('#welcome').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') start(); });
}

/* ---------- boot ---------- */
initWelcome();
initSidebar();
initChat();
if (state.profile) enterChat();
