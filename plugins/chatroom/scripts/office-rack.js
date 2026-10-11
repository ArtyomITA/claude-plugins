// The rack by each desk: the background processes of an agent (shells, monitors, servers it started and left running), one line per process with a shape and a
// colour (solid green: running, blinking: it wrote in the last seconds, hollow yellow: silent for a minute, red cross: it failed, grey cross: killed, grey dot: finished
// well), and the start of its command beside it. A click opens a panel with the commands and, for a process Claude Code keeps the output of, the last lines. The data
// is what the viewer reads from the agents' transcripts (activity.py: nothing is asked of the agents); the commands and the lines are for this computer only.

const S = {
  en: {title: 'processes', none: 'nothing running in the background', kind: {shell: 'shell', monitor: 'monitor', agent: 'agent'}, ago: n => `${n} ago`, since: 'started', code: n => `exit code ${n}`,
       state: {running: 'running', quiet: 'quiet for a while', done: 'finished', failed: 'failed', killed: 'stopped'}, lines: 'last lines (only on this computer)', noLines: 'no output saved for this one: only the command, the state and the exit code',
       pick: 'pick a process to see its last lines', close: 'Close'},
  it: {title: 'processi', none: 'niente in esecuzione in background', kind: {shell: 'shell', monitor: 'monitor', agent: 'agente'}, ago: n => `${n} fa`, since: 'partito', code: n => `codice di uscita ${n}`,
       state: {running: 'in corso', quiet: 'fermo da un po', done: 'finito', failed: 'fallito', killed: 'fermato'}, lines: 'ultime righe (solo su questo computer)', noLines: 'di questo non c\'e output salvato: solo comando, stato e codice di uscita',
       pick: 'scegli un processo per vederne le ultime righe', close: 'Chiudi'},
};
const CSS = `
.o-rk-ov { position: absolute; inset: 0; z-index: 8; background: #05070fdd; display: flex; align-items: center; justify-content: center; }
.o-rk { width: min(96%, 760px); max-height: 90%; overflow: auto; background: #0d1226; border: 3px solid #4fc3f7; border-radius: 14px; box-shadow: 0 0 36px #4fc3f744, 0 14px 44px #000; padding: 12px 16px 16px; color: #e8ecff; font-family: "Segoe UI", sans-serif; }
.o-rk h2 { margin: 0 0 8px; font-size: 18px; color: #4fc3f7; display: flex; align-items: center; gap: 8px; }
.o-rk h2 button { margin-left: auto; background: #ffffff14; color: #fff; border: 1px solid #ffffff30; border-radius: 8px; padding: 3px 10px; cursor: pointer; }
.o-rk .o-row { display: flex; align-items: baseline; gap: 10px; padding: 6px 4px; border-bottom: 1px solid #ffffff10; cursor: pointer; font-size: 13.5px; }
.o-rk .o-row:hover, .o-rk .o-row.o-on { background: #4fc3f71a; }
.o-rk .o-row code { background: #ffffff12; border-radius: 4px; padding: 1px 6px; font-size: 12.5px; word-break: break-all; }
.o-rk .o-row small { margin-left: auto; color: #8c97b8; white-space: nowrap; }
.o-rk .o-sym { width: 16px; text-align: center; font-weight: 900; flex: none; }
.o-rk pre { background: #060913; border: 1px solid #ffffff14; border-radius: 8px; padding: 8px 10px; margin: 10px 0 0; max-height: 260px; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-all; color: #cfd8ff; }
.o-rk .o-meta { color: #8c97b8; font-size: 12px; margin-top: 8px; }
`;
const GREEN = '#43d17a', YELLOW = '#f5c542', RED = '#ef5350', GREY = '#7a869a';
const esc = x => String(x ?? '').replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
/** the start of a command, short enough for a line of the rack: the program and what it works on */
const short = cmd => String(cmd || '').replace(/^(?:cd [^;&]+(?:&&|;)\s*)/, '').split(/\s+/).filter(w => !/^-/.test(w)).slice(0, 3).map(w => w.split(/[\\/]/).pop()).join(' ').slice(0, 24) || '…';
const ago = (at, now, T) => { const s = Math.max(0, Math.round(now - at)); return T.ago(s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`); };

/** THREE, V (office-voxel.js); raycastables: what a click can hit; tail(name, id) -> Promise of {lines, ...} (the viewer's /procs.json) */
export function createRacks({THREE, V, root, raycastables, lang = () => 'en', tail, at = [-0.74, 0, 1.0]}) {
  const L = () => S[lang()] || S.en;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const racks = new Map();                           // agent name -> {group, tex, canvas, key, procs}
  let ov = null, shownName = null, sel = null;

  function sym(g, x, y, state, blink) {
    g.lineWidth = 3;
    if (state === 'running') {
      g.fillStyle = g.strokeStyle = GREEN; g.beginPath(); g.arc(x, y, 8, 0, 7); if (blink) { g.lineWidth = 3; g.stroke(); } else g.fill();
    } else if (state === 'quiet') {
      g.strokeStyle = YELLOW; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke();
    } else if (state === 'failed' || state === 'killed') {
      g.strokeStyle = state === 'failed' ? RED : GREY; g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke();
    } else { g.fillStyle = GREY; g.fillRect(x - 5, y - 5, 10, 10); }
  }
  function draw(rec, now) {
    const {canvas: c, procs} = rec, g = c.getContext('2d'), blinkOn = Math.floor(now * 2) % 2 === 0;
    g.fillStyle = '#080c16'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#2c3a5e'; g.lineWidth = 3; g.strokeRect(2, 2, c.width - 4, c.height - 4);
    g.textBaseline = 'middle'; g.font = '600 17px "Segoe UI", sans-serif';
    if (!procs.length) { g.fillStyle = '#34405f'; g.fillRect(14, c.height / 2 - 1, 30, 3); return; }
    procs.slice(0, 6).forEach((p, i) => {
      const y = 22 + i * 28;
      sym(g, 20, y, p.state, p.state === 'running' && now - p.last < 5 && blinkOn);
      g.fillStyle = p.state === 'running' ? '#e8ecff' : p.state === 'quiet' ? '#d8cf9a' : p.state === 'failed' ? '#ffb4ab' : '#8c97b8';
      let t = short(p.cmd); while (t.length > 1 && g.measureText(t).width > c.width - 54) t = t.slice(0, -1);
      g.fillText(t, 38, y);
    });
  }
  function attach(name, desk) {
    if (racks.has(name)) return;
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 176;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter;
    const body = V.mesh(new V.Vox().box(0, 0, 0, 6, 10, 4, '#2b2f3a').box(0, 0, 0, 6, 0, 4, '#1b1e26').box(1, 10, 1, 5, 10, 3, '#3a3f4d'), {pivot: [3.5, 0, 2.5], scale: 0.05, jitter: 0.03});
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.275), new THREE.MeshBasicMaterial({map: tex, toneMapped: false})); screen.position.set(0, 0.29, 0.127);
    const group = new THREE.Group(); group.position.set(...at); group.add(body, screen); desk.g.add(group);
    group.traverse(o => { o.userData.rack = name; if (o.isMesh) raycastables.push(o); });
    const rec = {group, tex, canvas, key: '', procs: [], body, screen}; racks.set(name, rec); draw(rec, 0); tex.needsUpdate = true;
  }
  function detach(name) {
    const r = racks.get(name); if (!r) return;
    r.group.removeFromParent(); r.group.traverse(o => { const i = raycastables.indexOf(o); if (i >= 0) raycastables.splice(i, 1); o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    racks.delete(name); if (shownName === name) close();
  }
  /** the processes of an agent, from the viewer's state; redraws the rack only when something it shows changed */
  function set(name, procs, now) {
    const r = racks.get(name); if (!r) return;
    r.procs = (procs || []).slice(0, 6);
    const key = r.procs.map(p => `${p.id}:${p.state}:${p.cmd}`).join('|');
    if (key !== r.key) { r.key = key; draw(r, now); r.tex.needsUpdate = true; }
    if (shownName === name) fill();
  }
  /** blinking: a running process that wrote in the last 5 s flashes (hollow, solid) twice a second */
  function update() {
    const now = Date.now() / 1000, phase = Math.floor(now * 2) % 2;
    for (const r of racks.values()) {
      if (r.phase === phase || !r.procs.some(p => p.state === 'running' && now - p.last < 5)) continue;
      r.phase = phase; draw(r, now); r.tex.needsUpdate = true;
    }
  }

  // ------------------------------------------------ the panel
  function fill() {
    const r = racks.get(shownName); if (!ov || !r) return;
    const T = L(), now = Date.now() / 1000, box = ov.querySelector('.o-rk');
    const mark = {running: ['●', GREEN], quiet: ['○', YELLOW], done: ['■', GREY], failed: ['✕', RED], killed: ['✕', GREY]};
    box.innerHTML = `<h2>⚙ ${esc(shownName)} · ${esc(T.title)} <button data-x>${T.close} (Esc)</button></h2>`
      + (r.procs.length ? r.procs.map(p => `<div class="o-row${sel === p.id ? ' o-on' : ''}" data-id="${esc(p.id)}"><span class="o-sym" style="color:${(mark[p.state] || mark.done)[1]}">${(mark[p.state] || mark.done)[0]}</span><code>${esc(p.cmd)}</code>`
        + `<small>${esc(T.kind[p.kind] || p.kind)} · ${esc(T.state[p.state] || p.state)}${p.code != null && p.state !== 'running' ? ' · ' + esc(T.code(p.code)) : ''} · ${esc(T.since)} ${esc(ago(p.started, now, T))}</small></div>`).join('')
        : `<div class="o-meta">${esc(T.none)}</div>`)
      + `<div class="o-meta">${esc(sel ? '' : T.pick)}</div><pre hidden></pre>`;
    if (sel) loadTail(r.procs.find(p => p.id === sel));
  }
  async function loadTail(p) {
    const pre = ov?.querySelector('pre'), meta = ov?.querySelector('.o-meta:last-of-type'); if (!pre || !p) return;
    const T = L();
    if (!p.tail) { pre.hidden = true; if (meta) meta.textContent = T.noLines; return; }
    try {
      const j = await tail(shownName, p.id);
      if (!ov || sel !== p.id) return;
      pre.hidden = false; pre.textContent = (j.lines || []).join('\n') || '…'; pre.scrollTop = pre.scrollHeight; if (meta) meta.textContent = T.lines;
    } catch (e) { pre.hidden = true; }
  }
  const onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  function open(name) {
    if (!racks.has(name)) return;
    close(); shownName = name; sel = null;
    ov = document.createElement('div'); ov.className = 'o-rk-ov'; ov.innerHTML = '<div class="o-rk"></div>';
    for (const ev of ['pointerdown', 'wheel', 'keydown']) ov.addEventListener(ev, e => e.stopPropagation());
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-x]')) return close();
      const row = e.target.closest('[data-id]'); if (row) { sel = row.dataset.id; fill(); }
    });
    root.appendChild(ov); addEventListener('keydown', onKey, true); document.exitPointerLock?.(); fill();
  }
  function close() { if (!ov) return; removeEventListener('keydown', onKey, true); ov.remove(); ov = null; shownName = null; sel = null; }

  return {attach, detach, set, update, open, close, active: () => !!ov, has: name => racks.has(name), count: name => racks.get(name)?.procs.length || 0,
          /** world position of a rack (for the E key and the camera) */
          where: name => racks.get(name)?.group.getWorldPosition(new THREE.Vector3())};
}
