/* Ledger AI assistant: adds an "Ask AI" button and a slide-out chat panel.
   Load it AFTER the main Ledger script, right before </body>:
   <script src="ledger-ai.js"></script> */
(function () {
  if (window.__ledgerAi) return;
  window.__ledgerAi = true;

  const el = (id) => document.getElementById(id);
  const SUGGESTIONS = ['Give me an overview of my open tasks', "What's due soon?", 'Summarise my notes'];
  const history = [];
  let busy = false;
  let stopDictation = () => {};

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.textContent = `
  #ai-btn { flex-shrink: 0; padding: 8px 12px; }
  #ai-panel { position: fixed; top: 0; bottom: 0; right: 0; width: min(440px, 100vw); background: var(--bg-raised);
    border-left: 1px solid var(--border); display: flex; flex-direction: column; transform: translateX(100%);
    visibility: hidden; transition: transform .22s ease, visibility 0s linear .22s; z-index: 45;
    padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  #ai-panel.open { transform: none; visibility: visible; transition: transform .22s ease, visibility 0s; box-shadow: -10px 0 36px rgba(0,0,0,.4); }
  @media (prefers-reduced-motion: reduce) { #ai-panel, #ai-panel.open { transition: none; } }
  .ai-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--border-soft); }
  .ai-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .ai-head-actions { display: flex; gap: 2px; }
  .ai-head-actions button { background: none; border: none; color: var(--ink-faint); font-size: 12px; padding: 5px 8px; border-radius: var(--radius); }
  .ai-head-actions button:hover { color: var(--ink); background: var(--bg-hover); }
  #ai-close { font-size: 18px; line-height: 1; padding: 3px 8px; }
  #ai-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .ai-msg { max-width: 92%; padding: 9px 12px; border-radius: 6px; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
  .ai-msg.user { align-self: flex-end; background: var(--accent-dim); color: #fff; white-space: pre-wrap; }
  .ai-msg.assistant { align-self: flex-start; background: var(--bg); border: 1px solid var(--border-soft); }
  .ai-msg.error { align-self: flex-start; background: rgba(201,124,110,.12); border: 1px solid var(--danger); }
  .ai-msg.thinking { align-self: flex-start; color: var(--ink-faint); font-style: italic; }
  .ai-msg p { margin: 0 0 6px; }
  .ai-msg p:last-child, .ai-msg ul:last-child, .ai-msg ol:last-child { margin-bottom: 0; }
  .ai-msg ul, .ai-msg ol { margin: 4px 0 6px; padding-left: 20px; }
  .ai-msg code { font-family: 'IBM Plex Mono', monospace; font-size: .88em; background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; color: var(--amber); }
  .ai-tablewrap { overflow-x: auto; margin: 4px 0 6px; }
  .ai-msg table { border-collapse: collapse; font-size: 13px; }
  .ai-msg th, .ai-msg td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
  .ai-empty { margin: auto 0; padding: 8px; color: var(--ink-faint); font-size: 13.5px; text-align: center; }
  .ai-chips { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 14px; }
  .ai-input-row { display: flex; gap: 8px; align-items: flex-end; padding: 12px; border-top: 1px solid var(--border-soft); }
  #ai-input { flex: 1; min-width: 0; resize: none; max-height: 140px; padding: 9px 10px; border: 1px solid var(--border);
    border-radius: var(--radius); background: var(--bg); font-size: 14px; line-height: 1.4; transition: border-color .12s; }
  #ai-input:hover { border-color: var(--ink-faint); }
  #ai-input:focus { border-color: var(--accent-dim); }
  #ai-mic { flex-shrink: 0; width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center; }
  #ai-mic svg { width: 16px; height: 16px; }
  #ai-mic.listening { background: var(--danger); border-color: var(--danger); color: #fff; animation: ai-pulse 1.2s ease-in-out infinite; }
  @keyframes ai-pulse { 50% { opacity: .6; } }
  @media (prefers-reduced-motion: reduce) { #ai-mic.listening { animation: none; } }
  @media (max-width: 560px) { #ai-input { font-size: 16px; } }`;
  document.head.appendChild(style);

  // ---------- Markup ----------
  document.body.insertAdjacentHTML('beforeend', `
  <aside id="ai-panel" aria-label="AI assistant">
    <div class="ai-head">
      <h2>Assistant</h2>
      <div class="ai-head-actions">
        <button id="ai-clear" type="button">Clear</button>
        <button id="ai-close" type="button" aria-label="Close assistant">&times;</button>
      </div>
    </div>
    <div id="ai-messages"></div>
    <div class="ai-input-row">
        <textarea id="ai-input" rows="1" placeholder="Ask about your tasks and notes..."></textarea>
      <button class="btn-secondary" id="ai-mic" type="button" aria-label="Dictate" aria-pressed="false" title="Dictate">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg>
      </button>
      <button class="primary-btn" id="ai-send" type="button">Send</button>
    </div>
  </aside>`);

  const btn = document.createElement('button');
  btn.id = 'ai-btn';
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'Ask AI';
  const addBtn = el('add-btn');
  addBtn.parentNode.insertBefore(btn, addBtn);

  // ---------- Rendering ----------
  const inline = (s) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  function render(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    let html = '', list = null, i = 0;
    const close = () => { if (list) { html += '</' + list + '>'; list = null; } };
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*\|/.test(line)) {                       // markdown table
        close();
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.filter(r => !/^\s*\|[\s:|-]+\|?\s*$/.test(r));
        html += '<div class="ai-tablewrap"><table>' + body.map((r, n) =>
          '<tr>' + cells(r).map(c => (n === 0 ? '<th>' : '<td>') + inline(c) + (n === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table></div>';
        continue;
      }
      const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,6}\s+(.*)/);
      if (ul || ol) {
        const want = ul ? 'ul' : 'ol';
        if (list !== want) { close(); html += '<' + want + '>'; list = want; }
        html += '<li>' + inline((ul || ol)[1]) + '</li>';
      } else if (!line.trim()) { close(); }
      else { close(); html += '<p>' + (h ? '<strong>' + inline(h[1]) + '</strong>' : inline(line)) + '</p>'; }
      i++;
    }
    close();
    return html;
  }
  function add(role, text) {
    const m = document.createElement('div');
    m.className = 'ai-msg ' + role;
    if (role === 'assistant') m.innerHTML = render(text); else m.textContent = text;
    el('ai-messages').appendChild(m);
    el('ai-messages').scrollTop = el('ai-messages').scrollHeight;
    return m;
  }
  function showEmpty() {
    el('ai-messages').innerHTML = '<div class="ai-empty">Ask me about your tasks and notes, or just chat.<div class="ai-chips">' +
      SUGGESTIONS.map(s => `<button type="button" class="chip" data-q="${escapeHtml(s)}"><span>${escapeHtml(s)}</span></button>`).join('') + '</div></div>';
  }

  // ---------- Sending ----------
  // Deadlines are converted to local time here so the AI never does timezone maths.
  function deadlines() {
    const out = {};
    tasks.forEach(t => {
      const d = parseDate(t.deadline);
      if (d) out[t.id] = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    });
    return out;
  }
  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    el('ai-send').disabled = true;
    const empty = el('ai-messages').querySelector('.ai-empty');
    if (empty) empty.remove();
    add('user', text);
    el('ai-input').value = '';
    el('ai-input').style.height = 'auto';
    const wait = add('thinking', 'Thinking…');
    try {
      const r = await pb.send('/api/ai/chat', { method: 'POST', body: {
        message: text, history: history.slice(),
        now: new Date().toString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, deadlines: deadlines(),
      }});
      wait.remove();
      history.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply });
      add('assistant', r.reply);
    } catch (err) {
      wait.remove();
      const d = (err && err.response) || {};
      let msg = d.error || 'Something went wrong talking to the assistant.';
      if (err && err.status === 403) msg = "This login isn't allowed to use the assistant.";
      if (err && err.status === 401) msg = 'You are signed out. Sign in again and retry.';
      if (d.detail) msg += '\n' + d.detail;
      add('error', msg);
    } finally {
      busy = false;
      el('ai-send').disabled = false;
      el('ai-input').focus();
    }
  }

  // ---------- Open / close / events ----------
  const open = () => { closeRail(); el('ai-panel').classList.add('open'); setTimeout(() => el('ai-input').focus(), 230); };
  const close = () => el('ai-panel').classList.remove('open');
  const reset = () => { history.length = 0; showEmpty(); };

  btn.addEventListener('click', () => el('ai-panel').classList.contains('open') ? close() : open());
  el('ai-close').addEventListener('click', close);
  el('ai-clear').addEventListener('click', reset);
  el('ai-send').addEventListener('click', () => send(el('ai-input').value));
  el('ai-messages').addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-q]');
    if (c) send(c.dataset.q);
  });
  el('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(el('ai-input').value); }
  });
  el('ai-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
  });
  el('ai-panel').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  pb.authStore.onChange(() => { if (!pb.authStore.isValid) { close(); reset(); } });

    // ---------- Dictation ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = el('ai-mic');
  if (!SR) {
    mic.hidden = true;
  } else {
    let rec = null;
    const setUi = (on) => {
      mic.classList.toggle('listening', on);
      mic.setAttribute('aria-pressed', on ? 'true' : 'false');
      mic.title = on ? 'Stop dictating' : 'Dictate';
    };
    stopDictation = () => { if (rec) { try { rec.stop(); } catch (_) {} } };
    function startDictation() {
      if (busy) return;
      const input = el('ai-input');
      const base = input.value ? input.value.replace(/\s+$/, '') + ' ' : '';
      rec = new SR();
      rec.lang = navigator.language || 'en-AU';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => {
        let text = '';
        for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
        input.value = base + text.trim();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      };
      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Microphone access is blocked for this site.', 4000);
        else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast('Dictation error: ' + ev.error, 3000);
      };
      rec.onend = () => { setUi(false); rec = null; input.focus(); };
      try { rec.start(); setUi(true); } catch (_) { setUi(false); rec = null; }
    }
    mic.addEventListener('click', () => (rec ? stopDictation() : startDictation()));
  }

  showEmpty();
})();
