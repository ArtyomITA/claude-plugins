// The timeline of an agent: what it did over the last minutes, one tick for each tool call on the row of its kind (reading, editing, running,
// the web, agents, the room's chat), red when the call failed, a yellow span while it waited for a permission, the percentages it stated and
// how full its context was. A small strip over the head of the agent (the last ten minutes), and a larger chart in the inspector (the last
// half hour), in the manner of the traces of agents (a span for each call) and of the curves that show an agent's progress.
//
// The data come from /timeline.json (activity.py): times are seconds ago, so the clock of the page and the one of the server never meet.
// Drawing takes a 2D context and sizes, nothing else, so a test can run it with a pretend context.

export const LANES = ['read', 'edit', 'run', 'web', 'agent', 'chat', 'other'];
export const COLORS = ['#42a5f5', '#ffa726', '#66bb6a', '#ab47bc', '#26c6da', '#cfd8dc', '#8d6e63'];
const ERR = '#ff5252', WAIT = '#ffd54f', PCT = '#ffffff', CTX = '#80cbc4';

/** a short text of what the data say, for a title or a test: calls, errors, the last percentage */
export function summary(a) {
  if (!a) return null;
  const ev = a.ev || [], errors = ev.filter(e => !e[3]).length, st = a.st || [];
  return {calls: ev.length, errors, running: !!a.run, waits: (a.wt || []).length, pct: st.length ? st[st.length - 1][1] : null, ctx: (a.cx || []).length ? a.cx[a.cx.length - 1][1] : null};
}

/** the strip: `span` seconds from the left (old) to the right (now) in a W x H box */
export function drawStrip(g, W, H, a, span = 600) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(12,14,22,0.82)'; g.fillRect(0, 0, W, H);
  if (!a) return;
  const x = age => W - Math.max(0, Math.min(span, age)) / span * W, top = 3, band = H - 9;
  for (const [from, to] of a.wt || []) { const x0 = x(from), x1 = x(to); g.fillStyle = WAIT; g.fillRect(Math.min(x0, x1), H - 5, Math.max(2, Math.abs(x1 - x0)), 3); }
  for (const [age, ms, lane, ok] of a.ev || []) {
    if (age > span) continue;
    const x0 = x(age), w = Math.max(1.5, ms / 1000 / span * W);
    g.fillStyle = ok ? COLORS[lane] || COLORS[6] : ERR; g.fillRect(x0, top, w, band);
  }
  if (a.run) { g.fillStyle = COLORS[a.run[1]] || COLORS[6]; g.fillRect(Math.min(W - 3, x(a.run[0])), top, Math.max(3, W - x(a.run[0])), band); g.fillStyle = PCT; g.fillRect(W - 2, top, 2, band); }   // what runs now, to the edge
  const st = (a.st || []).filter(p => p[0] <= span);
  if (st.length > 1) { g.strokeStyle = PCT; g.lineWidth = 1; g.beginPath(); st.forEach(([age, pct], i) => { const px = x(age), py = H - 6 - pct / 100 * (H - 12); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
}

/** the chart: lanes on top, the percentages below, the context at the bottom, time on the x axis (`span` seconds back), in a W x H box */
export function drawChart(g, W, H, a, span = 1800, names = LANES, labels = {}) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(12,14,22,0.9)'; g.fillRect(0, 0, W, H);
  const left = 44, right = 6, w = W - left - right, laneH = 9, lanesH = LANES.length * laneH, gap = 8, pctH = Math.max(24, Math.round((H - lanesH - gap * 3 - 14) * 0.6)), ctxH = Math.max(16, H - lanesH - pctH - gap * 3 - 14);
  const x = age => left + w - Math.max(0, Math.min(span, age)) / span * w;
  g.font = '9px "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'right'; g.fillStyle = '#9aa0ad';
  // the time grid: a line every ten minutes
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let m = 0; m <= span / 60 + 0.01; m += 10) { const gx = Math.round(x(m * 60)) + 0.5; g.beginPath(); g.moveTo(gx, 2); g.lineTo(gx, H - 12); g.stroke(); }
  // the lanes
  LANES.forEach((l, i) => { const y = 3 + i * laneH; g.fillStyle = COLORS[i]; g.fillText(labels[l] || names[i] || l, left - 5, y + laneH / 2); g.fillStyle = 'rgba(255,255,255,0.04)'; if (i % 2) g.fillRect(left, y, w, laneH); });
  if (a) {
    for (const [from, to] of a.wt || []) { const x0 = x(from), x1 = x(to); g.fillStyle = 'rgba(255,213,79,0.28)'; g.fillRect(Math.min(x0, x1), 2, Math.max(2, Math.abs(x1 - x0)), lanesH + 2); }
    for (const [age, ms, lane, ok] of a.ev || []) {
      if (age > span) continue;
      const w1 = Math.max(1.5, ms / 1000 / span * w);
      g.fillStyle = ok ? COLORS[lane] || COLORS[6] : ERR; g.fillRect(x(age), 3 + lane * laneH + 1, w1, laneH - 2);
    }
    if (a.run) { const y = 3 + a.run[1] * laneH + 1; g.fillStyle = COLORS[a.run[1]]; g.fillRect(x(a.run[0]), y, W - right - x(a.run[0]), laneH - 2); }
  }
  // the percentages the agent stated
  const y0 = 3 + lanesH + gap;
  g.fillStyle = '#9aa0ad'; g.fillText('%', left - 5, y0 + pctH / 2); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.strokeRect(left + 0.5, y0 + 0.5, w - 1, pctH - 1);
  const st = a ? (a.st || []).filter(p => p[0] <= span) : [];
  if (st.length) {
    g.strokeStyle = PCT; g.lineWidth = 1.5; g.beginPath(); st.forEach(([age, pct], i) => { const px = x(age), py = y0 + pctH - 2 - pct / 100 * (pctH - 4); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
    const [age, pct] = st[st.length - 1]; g.fillStyle = PCT; g.textAlign = 'left'; g.fillText(pct + '%', Math.min(W - 24, x(age) + 3), Math.max(y0 + 6, y0 + pctH - 2 - pct / 100 * (pctH - 4) - 4)); g.textAlign = 'right';
  }
  // how full the context was
  const y1 = y0 + pctH + gap;
  g.fillStyle = '#9aa0ad'; g.fillText('ctx', left - 5, y1 + ctxH / 2); g.strokeStyle = 'rgba(255,255,255,0.12)'; g.strokeRect(left + 0.5, y1 + 0.5, w - 1, ctxH - 1);
  const cx = a ? (a.cx || []).filter(p => p[0] <= span) : [];
  if (cx.length) {
    g.strokeStyle = CTX; g.lineWidth = 1.5; g.beginPath(); cx.forEach(([age, tokens, win], i) => { const px = x(age), py = y1 + ctxH - 2 - Math.min(1, tokens / (win || 1e6)) * (ctxH - 4); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
  }
  // the time axis
  g.fillStyle = '#9aa0ad'; g.textAlign = 'center';
  for (let m = 0; m <= span / 60 + 0.01; m += 10) g.fillText(m === 0 ? (labels.now || 'now') : '-' + m + 'm', Math.min(W - 18, Math.max(left + 8, x(m * 60))), H - 5);
}
