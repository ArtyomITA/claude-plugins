// The GitHub window of the control room: a screen on the wall with the project's open pull requests (with the state of their checks), the latest CI runs, the last
// commits and the open issues; a click on it (or Altro > GitHub) opens a panel with every line as a link. The data comes from the viewer (/github.json: gh and git run in
// the project folder, cached for a minute, local only: it never goes through the relay to friends). Without a project folder the screen is not there at all.

const S = {
  en: {title: 'GitHub', prs: 'PULL REQUESTS', runs: 'CI RUNS', commits: 'COMMITS', issues: 'ISSUES', none: 'nothing open', noneRuns: 'no runs yet', detached: 'detached copy', ago: n => `${n} ago`, loading: 'loading…', panel: 'GitHub',
       missing: 'gh is not installed (cli.github.com)', login: 'gh is not logged in: run  gh auth login', err: 'gh did not answer', draft: 'draft', updated: s => `updated ${s} ago`, stale: ' (old data)',
       checks: {success: 'checks passed', failure: 'checks failed', pending: 'checks running', none: 'no checks'}, close: 'Close', open: 'open on GitHub'},
  it: {title: 'GitHub', prs: 'PULL REQUEST', runs: 'ESECUZIONI CI', commits: 'COMMIT', issues: 'ISSUE', none: 'niente di aperto', noneRuns: 'nessuna esecuzione', detached: 'copia staccata', ago: n => `${n} fa`, loading: 'carico…', panel: 'GitHub',
       missing: 'gh non e installato (cli.github.com)', login: 'gh non e collegato: esegui  gh auth login', err: 'gh non risponde', draft: 'bozza', updated: s => `aggiornato ${s} fa`, stale: ' (dati vecchi)',
       checks: {success: 'controlli ok', failure: 'controlli falliti', pending: 'controlli in corso', none: 'nessun controllo'}, close: 'Chiudi', open: 'apri su GitHub'},
};
const CSS = `
.o-gh-ov { position: absolute; inset: 0; z-index: 8; background: #05070fdd; display: flex; align-items: center; justify-content: center; }
.o-gh { width: min(96%, 900px); max-height: 92%; overflow: auto; background: #0e1428; border: 3px solid #d4a640; border-radius: 14px; box-shadow: 0 0 40px #d4a64044, 0 14px 44px #000; padding: 12px 16px 16px; color: #e8ecff; font-family: "Segoe UI", sans-serif; }
.o-gh h2 { margin: 0 0 4px; font-size: 20px; color: #ffd54f; display: flex; align-items: center; gap: 10px; }
.o-gh h2 small { font-size: 12.5px; color: #9fb3ff; font-weight: 500; }
.o-gh h2 button { margin-left: auto; background: #ffffff14; color: #fff; border: 1px solid #ffffff30; border-radius: 8px; padding: 3px 10px; cursor: pointer; }
.o-gh h3 { margin: 14px 0 4px; font-size: 13px; letter-spacing: 1.5px; color: #ffd54f; border-bottom: 1px solid #ffffff1a; padding-bottom: 3px; }
.o-gh .o-row { display: flex; align-items: baseline; gap: 8px; padding: 4px 2px; font-size: 14px; border-bottom: 1px solid #ffffff0d; }
.o-gh .o-row a { color: #e8ecff; text-decoration: none; }
.o-gh .o-row a:hover { text-decoration: underline; color: #fff; }
.o-gh .o-row small { color: #8c97b8; margin-left: auto; white-space: nowrap; }
.o-gh .o-dot { display: inline-block; width: 11px; height: 11px; border-radius: 50%; flex: none; }
.o-gh .o-empty { color: #8c97b8; font-size: 13.5px; padding: 4px 2px; }
.o-gh .o-msg { color: #ffab91; font-size: 14px; padding: 6px 2px; }
.o-gh code { background: #ffffff14; border-radius: 4px; padding: 1px 5px; font-size: 12.5px; }
`;
const DOT = {success: '#43d17a', failure: '#ef5350', pending: '#f5c542', running: '#f5c542', queued: '#f5c542', cancelled: '#7a869a', none: '#7a869a'};
const branchOf = (d, T) => !d.branch || d.branch === 'HEAD' ? T.detached : d.branch;
const ago = (at, now, T) => {
  const s = Math.max(0, Math.round(now - at));
  return T.ago(s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 129600 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
};
/** a short age for the wall: 40s, 12m, 3h, 2d */
const age = (at, now) => { const s = Math.max(0, Math.round(now - at)); return s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 129600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
const esc = x => String(x ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));

/** board: {mesh, canvas, g, tex} made by the office (a plane of the size of the screen, drawn at canvas.lw x canvas.lh); frame: a mesh to hide with it */
export function createGithubWall({board, frame = null, raycastables, root, lang = () => 'en', url = 'github.json', every = 30000, onEnabled = () => {}, paused = () => false}) {
  const L = () => S[lang()] || S.en;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  let data = null, ov = null, drawnAt = 0, timer = 0, busy = false, announced = false;
  board.mesh.traverse(o => { o.userData.github = true; if (o.isMesh) raycastables.push(o); });
  board.mesh.visible = false; if (frame) frame.visible = false;                       // until the viewer says there is a project

  // ------------------------------------------------ the screen
  function fit(g, text, w) {
    if (g.measureText(text).width <= w) return text;
    let s = text; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1);
    return s + '…';
  }
  function zone(g, x, y, w, h, title, lines, empty, neutral = false) {
    g.fillStyle = '#121a35'; g.fillRect(x, y, w, h);
    g.fillStyle = '#ffd54f'; g.font = '800 27px "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.fillText(title, x + 12, y + 24);
    g.font = '500 21px "Segoe UI", sans-serif';
    if (typeof lines === 'string') { g.fillStyle = '#ffab91'; g.fillText(fit(g, lines, w - 24), x + 12, y + 56); return; }
    if (!lines.length) { g.fillStyle = neutral ? '#8c97b8' : '#7fd6a0'; g.font = '700 25px "Segoe UI", sans-serif'; g.fillText((neutral ? '' : '✓ ') + empty, x + 14, y + h * 0.62); return; }
    lines.slice(0, 4).forEach((l, i) => {
      const yy = y + 62 + i * 33;
      if (l.dot) { g.fillStyle = l.dot; g.beginPath(); g.arc(x + 20, yy, 6, 0, 7); g.fill(); }
      g.fillStyle = '#e8ecff'; g.font = '500 21px "Segoe UI", sans-serif';
      const subW = l.sub ? g.measureText(l.sub).width + 8 : 0;
      g.fillText(fit(g, l.text, w - 48 - subW), x + 34, yy);
      if (l.sub) { g.fillStyle = '#8c97b8'; g.font = '500 18px "Segoe UI", sans-serif'; g.textAlign = 'right'; g.fillText(l.sub, x + w - 12, yy); g.textAlign = 'left'; }
    });
  }
  function draw() {
    const {g, canvas: k} = board, W = k.lw, H = k.lh, T = L(), now = Date.now() / 1000, d = data;
    g.fillStyle = '#0a0f21'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d4a640'; g.lineWidth = 5; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = '#161d3a'; g.fillRect(9, 9, W - 18, 40);
    g.textBaseline = 'middle'; g.font = '800 26px "Segoe UI", sans-serif'; g.fillStyle = '#ffd54f'; g.fillText('GitHub', 20, 30);
    g.font = '600 18px "Segoe UI", sans-serif'; g.fillStyle = '#9fb3ff';
    if (d) g.fillText(fit(g, `${d.repo || ''} · ${branchOf(d, T)}`, W - 360), 124, 30);
    if (d && d.at) { g.textAlign = 'right'; g.fillStyle = d.stale ? '#ffab91' : '#7f8ab0'; g.font = '600 19px "Segoe UI", sans-serif'; g.fillText(T.updated(ago(d.at, now, {ago: x => x})) + (d.stale ? T.stale : ''), W - 20, 30); g.textAlign = 'left'; }
    const zw = (W - 9 * 2 - 8) / 2, zh = (H - 9 - 56 - 8) / 2, x0 = 9, x1 = 9 + zw + 8, y0 = 56, y1 = 56 + zh + 8;
    if (!d || d.gh === 'loading') { zone(g, x0, y0, zw, zh, T.prs, T.loading); zone(g, x1, y0, zw, zh, T.runs, T.loading); zone(g, x0, y1, zw, zh, T.commits, T.loading); zone(g, x1, y1, zw, zh, T.issues, T.loading); }
    else {
      const ghMsg = d.gh === 'ok' ? null : d.gh === 'missing' ? T.missing : d.gh === 'not logged in' ? T.login : T.err;
      const prs = (d.prs || []).map(p => ({dot: DOT[p.checks] || DOT.none, text: `#${p.n} ${p.draft ? '[' + T.draft + '] ' : ''}${p.title}`, sub: '@' + p.author}));
      const runs = (d.runs || []).map(r => ({dot: DOT[r.state] || DOT.none, text: `${r.workflow || 'CI'} · ${r.title}`, sub: age(r.at, now)}));
      const commits = (d.commits || []).map(c => ({dot: null, text: `${c.sha} ${c.subject}`, sub: age(c.at, now)}));
      const issues = (d.issues || []).map(i => ({dot: '#a78bfa', text: `#${i.n} ${i.title}`, sub: '@' + i.author}));
      zone(g, x0, y0, zw, zh, `${T.prs} ${d.prs ? d.prs.length : ''}`, ghMsg && !d.prs ? ghMsg : prs, T.none);
      zone(g, x1, y0, zw, zh, T.runs, ghMsg && !d.runs ? ghMsg : runs, T.noneRuns, true);
      zone(g, x0, y1, zw, zh, T.commits, d.commits ? commits : (d.errors && d.errors.log) || T.err, T.none);
      zone(g, x1, y1, zw, zh, `${T.issues} ${d.issues ? d.issues.length : ''}`, ghMsg && !d.issues ? ghMsg : issues, T.none);
    }
    board.tex.needsUpdate = true; drawnAt = now;
  }

  // ------------------------------------------------ the data
  async function load() {
    if (busy) return; busy = true;
    try {
      const r = await fetch(url, {cache: 'no-store'});
      if (r.ok) { data = await r.json(); const on = !!(data && data.enabled); board.mesh.visible = on; if (frame) frame.visible = on; if (on) { draw(); if (!announced) { announced = true; onEnabled(); } } if (ov) fill(); }
    } catch (e) { /* the viewer is away: the screen keeps what it had */ }
    busy = false;
  }
  load(); timer = setInterval(() => { if (ov || !paused()) load(); }, every);      // gh and git run for it on the server: not while nobody sees the office

  // ------------------------------------------------ the panel
  function fill() {
    const T = L(), d = data, now = Date.now() / 1000; if (!ov || !d) return;
    const link = (u, text) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(T.open)}">${esc(text)}</a>` : esc(text);
    const dot = c => `<i class="o-dot" style="background:${DOT[c] || DOT.none}" title="${esc(T.checks[c] || c)}"></i>`;
    const ghMsg = d.gh === 'ok' ? null : d.gh === 'missing' ? T.missing : d.gh === 'not logged in' ? T.login : T.err;
    const sec = (title, rows, empty, failed) => `<h3>${esc(title)}</h3>` + (failed ? `<div class="o-msg">${esc(failed)}</div>` : rows.length ? rows.join('') : `<div class="o-empty">${esc(empty)}</div>`);
    const box = ov.querySelector('.o-gh');
    box.innerHTML = `<h2>🐙 ${esc(d.repo)} <small>${esc(branchOf(d, T))}${d.at ? ' · ' + esc(T.updated(ago(d.at, now, {ago: x => x}))) : ''}</small><button data-x>${T.close} (Esc)</button></h2>`
      + sec(T.prs, (d.prs || []).map(p => `<div class="o-row">${dot(p.checks)}${link(p.url, `#${p.n} ${p.title}`)}<small>${esc(p.draft ? T.draft + ' · ' : '')}@${esc(p.author)}${p.review ? ' · ' + esc(p.review) : ''} · ${esc(ago(p.at, now, T))}</small></div>`), T.none, ghMsg && !d.prs ? ghMsg : '')
      + sec(T.runs, (d.runs || []).map(r => `<div class="o-row">${dot(r.state)}${link(r.url, `${r.workflow || 'CI'} · ${r.title}`)}<small>${esc(r.branch)} · ${r.secs ? Math.floor(r.secs / 60) + ':' + String(r.secs % 60).padStart(2, '0') + ' · ' : ''}${esc(ago(r.at, now, T))}</small></div>`), T.noneRuns, ghMsg && !d.runs ? ghMsg : '')
      + sec(T.commits, (d.commits || []).map(c => `<div class="o-row"><code>${esc(c.sha)}</code>${esc(c.subject)}<small>${esc(c.author)} · ${esc(ago(c.at, now, T))}</small></div>`), T.none, d.commits ? '' : T.err)
      + sec(T.issues, (d.issues || []).map(i => `<div class="o-row">${dot('none')}${link(i.url, `#${i.n} ${i.title}`)}<small>${esc((i.labels || []).join(', '))}${i.labels?.length ? ' · ' : ''}@${esc(i.author)} · ${esc(ago(i.at, now, T))}</small></div>`), T.none, ghMsg && !d.issues ? ghMsg : '');
  }
  const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  function open() {
    if (ov) return close();
    if (!data || !data.enabled) return;
    ov = document.createElement('div'); ov.className = 'o-gh-ov'; ov.innerHTML = '<div class="o-gh"></div>';
    for (const ev of ['pointerdown', 'wheel', 'keydown']) ov.addEventListener(ev, e => e.stopPropagation());
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
    root.appendChild(ov); addEventListener('keydown', onKey, true); fill(); load();
  }
  function close() { if (!ov) return; removeEventListener('keydown', onKey, true); ov.remove(); ov = null; }

  /** show this data now (the same shape as /github.json): for tests and demos */
  function feed(d) { data = d; const on = !!(d && d.enabled); board.mesh.visible = on; if (frame) frame.visible = on; if (on) draw(); if (ov) fill(); }
  return {feed, open, close, active: () => !!ov, enabled: () => !!(data && data.enabled), mesh: board.mesh,
          /** metres from a point on the floor to the screen's foot (0 right under it) */
          near: p => Math.hypot(p.x - board.mesh.position.x, p.z - board.mesh.position.z),
          update: () => { if (data && data.enabled && Date.now() / 1000 - drawnAt > 10) draw(); }, stop: () => clearInterval(timer)};
}
