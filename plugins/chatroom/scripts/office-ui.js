// The HTML layer over the 3D office: name tags, speech bubbles, progress rings, the top bar, the inspector,
// and what gets your attention when an agent waits for you (tab title, favicon, chime, desktop notification).

const CSS = `
#office { position: fixed; inset: 0 auto 0 0; width: 100vw; background: #1b1d27; z-index: 1; overflow: hidden;
  font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #f4f1ea; display: none; }
body.mode-split #office, body.mode-office #office { display: block; }
body.mode-split #office { width: var(--office-w, 62vw); }
body.mode-split { padding-left: var(--office-w, 62vw); }
body.mode-office > :not(#office):not(#panel):not(#scrim):not(#lightbox) { display: none !important; }
#office canvas { display: block; width: 100%; height: 100%; outline: none; }
#office .o-tags { position: absolute; inset: 0; pointer-events: none; }
#office .o-tag { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;
  gap: 3px; white-space: nowrap; transition: opacity .25s; }
#office .o-name { display: flex; align-items: center; gap: 5px; padding: 2px 7px 2px 4px; background: #14151dd9; border-radius: 3px;
  box-shadow: 2px 2px 0 #0008; font-weight: 700; font-size: 12px; letter-spacing: .02em; pointer-events: auto; cursor: pointer; }
#office .o-name i { font-style: normal; font-size: 13px; }
#office .o-name b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-name small { font-weight: 500; opacity: .7; font-size: 10.5px; }
#office .o-ring { width: 26px; height: 26px; }
#office .o-line { font-size: 11px; padding: 1px 6px; background: #0d0e14b3; border-radius: 3px; max-width: 220px; overflow: hidden;
  text-overflow: ellipsis; }
#office .o-bubble { max-width: 240px; white-space: normal; background: #fffdf6; color: #1b1b22; padding: 6px 9px; border-radius: 4px;
  box-shadow: 3px 3px 0 #0007; font-size: 12px; position: relative; animation: pop .25s ease-out; }
#office .o-bubble:after { content: ""; position: absolute; left: 50%; bottom: -6px; border: 6px solid transparent; border-bottom: 0;
  border-top-color: #fffdf6; transform: translateX(-50%); }
#office .o-bubble.o-plan { background: #fff3c4; } #office .o-bubble.o-user { background: #ffe1ec; }
#office .o-bubble.o-vote { background: #e6f4ea; }
#office .o-bubble.o-status, #office .o-bubble.o-idle { max-width: 190px; padding: 3px 7px; font-size: 10.5px; font-style: italic;
  background: #d9dde3; color: #39404a; box-shadow: 2px 2px 0 #0005; }
#office .o-bubble.o-idle { background: #c9d3da; }
#office .o-bubble.o-status:after { border-top-color: #d9dde3; } #office .o-bubble.o-idle:after { border-top-color: #c9d3da; }
#office .o-bubble.o-plan:after { border-top-color: #fff3c4; } #office .o-bubble.o-user:after { border-top-color: #ffe1ec; }
#office .o-bubble.o-vote:after { border-top-color: #e6f4ea; }
#office .o-flag { font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 3px; box-shadow: 2px 2px 0 #0008; }
#office .o-flag.o-wait { background: #e53935; color: #fff; animation: blink 1s steps(2) infinite; }
#office .o-flag.o-tag { background: #ffca28; color: #222; } #office .o-flag.o-late { background: #ff7043; color: #fff; }
#office .o-flag.o-idle { background: #455a64; color: #e0e0e0; } #office .o-flag.o-vote-yes { background: #43a047; color: #fff; }
#office .o-flag.o-vote-no { background: #c62828; color: #fff; }
#office .o-hud { position: absolute; left: 12px; top: 10px; right: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  pointer-events: none; }
#office .o-hud > * { pointer-events: auto; }
#office .o-chip { background: #14151dd9; padding: 5px 9px; border-radius: 3px; box-shadow: 2px 2px 0 #0008; font-weight: 600; }
#office .o-chip.o-big { font-size: 15px; } #office .o-chip.o-warn { background: #c62828; }
#office .o-btns { position: absolute; right: 12px; bottom: 10px; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
#office button { background: #14151dd9; border: 0; color: #f4f1ea; padding: 5px 9px; border-radius: 3px; box-shadow: 2px 2px 0 #0008;
  cursor: pointer; font: inherit; font-weight: 600; }
#office button.o-on { background: #f5b400; color: #222; }
#office button:focus-visible, #office .o-name:focus-visible { outline: 2px solid #ffd54f; }
#office .o-inspector { position: absolute; right: 12px; bottom: 52px; width: 300px; max-height: 70%; overflow: auto; background: #14151df2;
  border-radius: 4px; box-shadow: 4px 4px 0 #0009; padding: 12px; display: none; }
#office .o-inspector.o-open { display: block; }
#office .o-inspector h3 { margin: 0 0 2px; font-size: 16px; display: flex; gap: 6px; align-items: center; }
#office .o-inspector .o-meta { opacity: .75; font-size: 11.5px; margin-bottom: 8px; }
#office .o-bar { height: 7px; background: #2a2c38; border-radius: 2px; overflow: hidden; margin: 3px 0 8px; }
#office .o-bar > div { height: 100%; background: linear-gradient(90deg, #43a047, #fbc02d, #e53935); }
#office .o-spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; margin: 3px 0 8px; }
#office .o-spark div { flex: 1; background: #4fc3f7; min-height: 1px; border-radius: 1px; }
#office .o-tools div { display: flex; gap: 6px; font-size: 11.5px; padding: 2px 0; border-bottom: 1px solid #ffffff10; }
#office .o-tools span:last-child { margin-left: auto; opacity: .6; }
#office .o-tools .o-err { color: #ff8a80; }
#office .o-msgs div { font-size: 11.5px; padding: 4px 0; border-bottom: 1px solid #ffffff10; cursor: pointer; }
#office .o-row { display: flex; gap: 6px; margin-top: 8px; }
#office .o-help { position: absolute; left: 12px; bottom: 10px; font-size: 11px; opacity: .55; pointer-events: none; }
@keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes blink { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { #office .o-bubble, #office .o-flag.o-wait { animation: none; } }
@media (max-width: 900px) { body.mode-split { padding-left: 0; padding-top: 42vh; } body.mode-split #office { width: 100vw; height: 42vh; inset: 0 0 auto 0; } }
`;

export const L = {
  en: {code: 'writing code', read: 'reading', term: 'terminal', web: 'on the web', post: 'writing in the chat', chat: 'reading the chat',
       agent: 'delegating', msg: 'messaging', other: 'working', think: 'thinking', idle: 'idle', coffee: 'coffee break',
       wait: 'NEEDS YOU', tagged: '@ for you', late: 'late status', you: 'you', lead: 'assistant', waiting: n => `${n} need you`,
       working: n => `${n} working`, idles: n => `${n} idle`, done: 'CLOSED', plan: v => `plan v${v}`, votes: (y, n) => `${y} yes / ${n} to vote`,
       split: 'Split', office: 'Office', chat: 'Chat', reset: 'View', follow: 'Follow', quality: q => `Quality: ${q}`,
       notify: 'Alerts', help: 'drag: orbit · wheel: zoom · click: inspect · ←→: next agent · F: follow · Esc', tag: '@ Tag',
       jump: 'In the chat', ctx: 'context', pulse: 'activity, last 5 min', tools: 'last tools', msgs: 'last messages',
       mod: 'live (mod)', tail: 'from transcripts', nodata: 'chat only'},
  it: {code: 'scrive codice', read: 'legge', term: 'terminale', web: 'sul web', post: 'scrive in chat', chat: 'legge la chat',
       agent: 'delega', msg: 'messaggio', other: 'lavora', think: 'pensa', idle: 'idle', coffee: 'pausa caffè',
       wait: 'TI ASPETTA', tagged: '@ per te', late: 'status in ritardo', you: 'tu', lead: 'assistente', waiting: n => `${n} ti aspettano`,
       working: n => `${n} lavorano`, idles: n => `${n} idle`, done: 'CHIUSO', plan: v => `piano v${v}`, votes: (y, n) => `${y} sì / ${n} da votare`,
       split: 'Diviso', office: 'Ufficio', chat: 'Chat', reset: 'Vista', follow: 'Segui', quality: q => `Qualità: ${q}`,
       notify: 'Avvisi', help: 'trascina: ruota · rotella: zoom · clic: dettagli · ←→: agente dopo · F: segui · Esc', tag: '@ Tagga',
       jump: 'Nella chat', ctx: 'contesto', pulse: 'attività, ultimi 5 min', tools: 'ultimi strumenti', msgs: 'ultimi messaggi',
       mod: 'dal vivo (mod)', tail: 'dai transcript', nodata: 'solo chat'},
};
export const EMOJI = {code: '✏️', read: '📖', term: '💻', web: '🌐', post: '💬', chat: '👀', agent: '🤖', msg: '✉️', other: '🔧',
                      think: '💭', idle: '💤', coffee: '☕'};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export function createUI(root, {onMode, onReset, onFollow, onQuality, onSelect, onTag, onJump, onNext}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  root.insertAdjacentHTML('beforeend', `<div class="o-tags"></div>
    <div class="o-hud"><span class="o-chip o-big" data-k="title"></span><span class="o-chip" data-k="pct"></span><span class="o-chip o-warn" data-k="wait" hidden></span>
      <span class="o-chip" data-k="work"></span><span class="o-chip" data-k="idle"></span><span class="o-chip" data-k="plan" hidden></span><span class="o-chip" data-k="src"></span>
</div>
    <div class="o-btns"><button data-b="split"></button><button data-b="office"></button><button data-b="chat"></button>
      <button data-b="reset"></button><button data-b="follow"></button><button data-b="quality"></button><button data-b="notify"></button></div>
    <div class="o-inspector" tabindex="-1"></div><div class="o-help"></div>`);
  const tags = root.querySelector('.o-tags'), hud = root.querySelector('.o-hud'), insp = root.querySelector('.o-inspector'), btns = root.querySelector('.o-btns');
  const chip = k => hud.querySelector(`[data-k="${k}"]`), btn = b => btns.querySelector(`[data-b="${b}"]`);
  let lang = 'it';
  const t = () => L[lang] || L.en;
  btns.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.b;
    if (['split', 'office', 'chat'].includes(k)) onMode(k);
    else if (k === 'reset') onReset(); else if (k === 'follow') onFollow(); else if (k === 'quality') onQuality();
    else if (k === 'notify') askNotify();
  });
  const labels = new Map();

  function label(name) {
    let l = labels.get(name);
    if (l) return l;
    const el = document.createElement('div'); el.className = 'o-tag';
    el.innerHTML = `<div class="o-bub"></div><div class="o-flags"></div><svg class="o-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#14151dd9" stroke="#ffffff22" stroke-width="5"/><circle class="o-arc" cx="18" cy="18" r="15" fill="none" stroke-width="5" stroke-dasharray="0 100" transform="rotate(-90 18 18)" pathLength="100"/><text x="18" y="22" text-anchor="middle" font-size="11" font-weight="700" fill="#fff"></text></svg><div class="o-line"></div><div class="o-name" tabindex="0" role="button"></div>`;
    el.querySelector('.o-name').addEventListener('click', () => onSelect(name));
    el.querySelector('.o-name').addEventListener('keydown', e => { if (e.key === 'Enter') onSelect(name); });
    tags.appendChild(el);
    l = {el, bub: el.querySelector('.o-bub'), flags: el.querySelector('.o-flags'), ring: el.querySelector('.o-ring'), arc: el.querySelector('.o-arc'),
         pct: el.querySelector('text'), line: el.querySelector('.o-line'), name: el.querySelector('.o-name'), key: ''};
    labels.set(name, l);
    return l;
  }

  return {
    setLang(x) { lang = x === 'en' ? 'en' : 'it'; },
    t,
    /** place a tag at screen x, y (CSS pixels); visible false hides it */
    place(name, x, y, visible, scale = 1) {
      const l = label(name);
      l.el.style.opacity = visible ? '1' : '0';
      l.el.style.left = x + 'px'; l.el.style.top = y + 'px';
      l.el.style.transform = `translate(-50%, -100%) scale(${scale})`;
    },
    /** what a tag shows; only touches the DOM when something changed */
    tag(name, d) {
      const l = label(name), key = JSON.stringify(d);
      if (key === l.key) return;
      l.key = key;
      l.name.innerHTML = `<b style="background:${esc(d.color)}"></b><i>${esc(d.emoji)}</i>${esc(d.title)}${d.sub ? ` <small>${esc(d.sub)}</small>` : ''}`;
      l.line.textContent = d.line || ''; l.line.style.display = d.line ? '' : 'none';
      l.ring.style.display = d.pct == null ? 'none' : '';
      if (d.pct != null) { l.arc.setAttribute('stroke', d.color); l.arc.setAttribute('stroke-dasharray', `${d.pct} ${100 - d.pct}`); l.pct.textContent = d.pct; }
      l.flags.innerHTML = (d.flags || []).map(([cls, text]) => `<span class="o-flag o-${cls}">${esc(text)}</span>`).join(' ');
      l.bub.innerHTML = d.bubble ? `<div class="o-bubble o-${esc(d.bubbleKind || 'x')}">${esc(d.bubble)}</div>` : '';
    },
    hud(d) {
      chip('title').textContent = d.title; chip('pct').textContent = d.pct == null ? '—' : `${d.pct}%`;
      chip('wait').style.display = d.waiting ? '' : 'none'; chip('wait').textContent = `🙋 ${t().waiting(d.waiting)}`;
      chip('work').textContent = `⚙️ ${t().working(d.working)}`; chip('idle').textContent = `💤 ${t().idles(d.idle)}`;
      chip('plan').style.display = d.plan ? '' : 'none'; chip('plan').textContent = d.plan || '';
      chip('src').textContent = d.src;
      for (const k of ['split', 'office', 'chat']) { btn(k).textContent = t()[k]; btn(k).classList.toggle('o-on', d.mode === k); }
      btn('reset').textContent = '🎥 ' + t().reset; btn('follow').textContent = '🎯 ' + t().follow; btn('follow').classList.toggle('o-on', !!d.follow);
      btn('quality').textContent = t().quality(d.quality); btn('notify').textContent = '🔔 ' + t().notify;
      btn('notify').classList.toggle('o-on', notifyOn());
      root.querySelector('.o-help').textContent = t().help;
    },
    inspect(d) {
      if (!d) { insp.classList.remove('o-open'); return; }
      insp.classList.add('o-open');
      const bins = new Array(30).fill(0);
      for (const age of d.pulse || []) bins[Math.max(0, 29 - Math.floor(age / 10))]++;
      const max = Math.max(1, ...bins);
      const ctx = d.ctx && d.window ? Math.min(100, Math.round(100 * d.ctx / d.window)) : null;
      insp.innerHTML = `<h3><span>${esc(d.emoji)}</span>${esc(d.name)}</h3>
        <div class="o-meta">${esc([d.role, d.model, d.state].filter(Boolean).join(' · '))}</div>
        ${d.pct != null ? `<div>${d.pct}%</div><div class="o-bar"><div style="width:${d.pct}%;background:${esc(d.color)}"></div></div>` : ''}
        ${ctx != null ? `<div>${t().ctx}: ${Math.round(d.ctx / 1000)}k / ${Math.round(d.window / 1000)}k (${ctx}%)</div><div class="o-bar"><div style="width:${ctx}%"></div></div>` : ''}
        ${d.pulse ? `<div>${t().pulse}</div><div class="o-spark">${bins.map(b => `<div style="height:${Math.round(100 * b / max)}%"></div>`).join('')}</div>` : ''}
        ${(d.recent || []).length ? `<div>${t().tools}</div><div class="o-tools">${d.recent.slice(0, 10).map(r => `<div class="${r.ok ? '' : 'o-err'}"><span>${esc(r.emoji)}</span><span>${esc(r.tool)} ${esc(r.target || '')}</span><span>${r.ms < 1000 ? r.ms + ' ms' : Math.round(r.ms / 1000) + ' s'}</span></div>`).join('')}</div>` : ''}
        ${(d.msgs || []).length ? `<div style="margin-top:8px">${t().msgs}</div><div class="o-msgs">${d.msgs.map(m => `<div data-n="${m.n}">#${m.n} ${esc(m.text.slice(0, 140))}</div>`).join('')}</div>` : ''}
        <div class="o-row"><button data-x="tag">${t().tag}</button><button data-x="jump">${t().jump}</button></div>`;
      insp.querySelector('[data-x="tag"]').onclick = () => onTag(d.name);
      insp.querySelector('[data-x="jump"]').onclick = () => onJump(d.lastN);
      insp.querySelectorAll('.o-msgs [data-n]').forEach(el => el.onclick = () => onJump(+el.dataset.n));
    },
    remove(name) { const l = labels.get(name); if (l) { l.el.remove(); labels.delete(name); } },
    onKey: e => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { onNext(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
      else if (e.key === 'Escape') onSelect(null);
      else if (e.key === 'f' || e.key === 'F') onFollow();
    },
  };
}

// ------------------------------------------------------------------ attention
let audio = null;
export function unlockAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
}
/** the two-note chime (E5 then E6) when someone starts waiting for you */
export function chime() {
  if (!audio || audio.state !== 'running') return;
  for (const [f, at] of [[659.25, 0], [1318.5, 0.16]]) {
    const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.4);
  }
}
const notifyOn = () => 'Notification' in window && Notification.permission === 'granted';
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
const shown = new Map();
/** desktop notification only while the page is hidden; a wait stays until handled, clicking focuses the agent */
export function notify(id, title, body, sticky, onClick) {
  if (!notifyOn() || (!document.hidden && document.hasFocus())) return;
  shown.get(id)?.close();
  try {
    const n = new Notification(title, {body, tag: 'chatroom-' + id, requireInteraction: !!sticky});
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
    shown.set(id, n);
  } catch (e) {}
}
export function unnotify(keep) { for (const [id, n] of shown) if (!keep.has(id)) { n.close(); shown.delete(id); } }
window.addEventListener('focus', () => { for (const n of shown.values()) n.close(); shown.clear(); });

/** the tab title counts who waits for you; the favicon gets a red dot */
let lastIcon = '';
export function badge(baseTitle, waiting, icon) {
  document.title = (waiting ? `(${waiting}) 🙋 ` : '') + baseTitle;
  const keyIcon = icon + waiting;
  if (keyIcon === lastIcon) return;
  lastIcon = keyIcon;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon || '💬', 32, 36);
  if (waiting) { g.fillStyle = '#e53935'; g.beginPath(); g.arc(50, 14, 13, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText(String(waiting), 50, 15); }
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = c.toDataURL();
}
