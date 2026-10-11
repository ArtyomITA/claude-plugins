// The games corner, playable: ping pong and foosball against the computer, in real time; pool against the computer or,
// turn by turn, with a friend through the common room (each shot carries where every ball ended, so both sides agree).
// Each game draws on one canvas laid over the office; Esc closes it.

const W = 800, H = 440;
const css = `
.o-cues { display: flex; gap: 6px; margin: 6px 0 0; }
.o-cues button { flex: 1; font-size: 12px; padding: 4px 6px; white-space: nowrap; }
.o-cues button.o-on { background: #f5b400; border-color: #f5b400; color: #1b1b22; }
.o-cues kbd { font: 700 10px monospace; opacity: .65; border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
.o-pool-chips { display: flex; gap: 8px; margin-bottom: 6px; }
.o-pchip { flex: 1; display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 9px; background: #1d2230; border: 1px solid #2c3347; opacity: .72; transition: opacity .2s, border-color .2s; min-width: 0; }
.o-pchip b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o-pchip.o-turn { opacity: 1; border-color: #ffd54f; box-shadow: inset 0 0 0 1px #ffd54f55; }
.o-pg { font-size: 11px; opacity: .7; }
.o-pd { display: flex; gap: 2px; }
.o-pb { width: 11px; height: 11px; border-radius: 50%; display: inline-block; background: var(--c, #888); box-shadow: inset -2px -2px 3px #0006; }
.o-pb.o-str { background: linear-gradient(180deg, #f5f5f5 0 28%, var(--c) 28% 72%, #f5f5f5 72% 100%); }
.o-pb.o-off { background: #ffffff1a; box-shadow: none; }
.o-pb.o-eight { background: #111; color: #fff; font: 700 8px/11px sans-serif; text-align: center; }
.o-pp { margin-left: auto; font-weight: 700; color: #ffd54f; white-space: nowrap; }
.o-game-wait { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 0 2px; font-weight: 600; }
.o-game-ov { position: absolute; inset: 0; background: rgba(8,10,16,.72); display: flex; align-items: center; justify-content: center; z-index: 30; }
.o-game-box { background: #12151c; border-radius: 10px; padding: 10px 12px 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5); color: #e8eaf0;
              font: 13px/1.4 "Segoe UI", system-ui, sans-serif; max-width: 96%; }
.o-game-box canvas { display: block; width: min(800px, 92vw); height: auto; border-radius: 6px; cursor: crosshair; touch-action: none; }
.o-game-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
.o-game-top button, .o-game-menu button { background: #2a3040; color: #e8eaf0; border: 1px solid #3a4256; border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit; }
.o-game-top button:hover, .o-game-menu button:hover { background: #3a4256; }
.o-game-menu { display: flex; flex-direction: column; gap: 8px; min-width: 280px; padding: 8px 4px; }
.o-game-menu h3 { margin: 0 0 4px; font-size: 16px; }
`;

// ------------------------------------------------------------------ pool: physics shared by every side
const R = 10, POCKET = 19, RAIL = 34;
const POCKETS = [[RAIL, RAIL], [W / 2, RAIL - 4], [W - RAIL, RAIL], [RAIL, H - RAIL], [W / 2, H - RAIL + 4], [W - RAIL, H - RAIL]];
const COLORS = ['#f5f5f5', '#f9a825', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#2e7d32', '#6d1b1b', '#111111',
                '#f9a825', '#1565c0', '#c62828', '#6a1b9a', '#ef6c00', '#2e7d32', '#6d1b1b'];
const group = n => n === 0 ? 'cue' : n === 8 ? 'eight' : n < 8 ? 'solids' : 'stripes';
/** the cues (keys 1 to 4). power: how hard the same pull hits (1 = classic); shake: the aim trembles by up to this many radians (the shot too);
 *  long: the aim line goes on past the first touch and one cushion; curve: radians per step the cue ball turns before it touches a ball.
 *  The chosen cue travels in the shot, so a friend's side plays the same shot. */
export const CUES = {
  classic: {key: '1', icon: '🎱', power: 1, tip: '#4aa3df', body: ['#f1dfb8', '#d9a95f', '#4a2b12'], width: 5},
  power: {key: '2', icon: '⚡', power: 1.4, shake: 0.05, tip: '#e53935', body: ['#3b3b3b', '#151515', '#050505'], width: 7},
  precise: {key: '3', icon: '🎯', power: 0.8, long: true, tip: '#cfd8dc', body: ['#a9794a', '#6b4423', '#2c1a0c'], width: 3.5},
  spin: {key: '4', icon: '🌀', power: 1, curve: 0.008, tip: '#43a047', body: ['#e9d4a6', '#43a047', '#2c1a0c'], width: 5},
};
export function poolRack() {
  const balls = [[W * 0.26, H / 2]];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let k = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) {
    const n = order[k++];
    balls[n] = [W * 0.68 + row * R * 1.75, H / 2 + (i - row / 2) * R * 2.02];
  }
  return balls;
}
/** one shot, simulated to rest: returns where each ball ended (null if pocketed), the first ball hit, the pocketed ones.
 *  frames gets every step's positions (for the animation); events gets what could be heard: {step, k: 'hit' | 'rail' | 'pot', v}.
 *  Fast balls are moved in several small sub-steps (a ball never travels more than about 5 px at once), so they neither
 *  pass through each other nor jitter; the cloth slows a ball a little at every step and more as it creeps. */
export function poolSimulate(start, angle, power, frames = null, events = null, fx = {}) {
  const b = start.map(p => p && {x: p[0], y: p[1], vx: 0, vy: 0});
  const speed = 6 + power * 22 * (CUES[fx.cue]?.power ?? 1);
  b[0].vx = Math.cos(angle) * speed; b[0].vy = Math.sin(angle) * speed;
  const potted = [];
  let first = null;
  for (let step = 0; step < 4000; step++) {
    let moving = false, top = 0;
    if (fx.cue === 'spin' && first === null && b[0] && Math.hypot(b[0].vx, b[0].vy) > 0.5) {         // the spin: the cue ball turns until it touches a ball
      const turn = (fx.sp < 0 ? -1 : 1) * CUES.spin.curve, co = Math.cos(turn), si = Math.sin(turn), vx = b[0].vx;
      b[0].vx = vx * co - b[0].vy * si; b[0].vy = vx * si + b[0].vy * co;
    }
    for (const p of b) if (p) top = Math.max(top, Math.abs(p.vx) + Math.abs(p.vy));
    const sub = Math.max(2, Math.min(6, Math.ceil(top / 5))), k = 1 / sub;
    for (let s = 0; s < sub; s++) {
      for (const p of b) if (p) { p.x += p.vx * k; p.y += p.vy * k; }
      for (let i = 0; i < 16; i++) {
        const p = b[i]; if (!p) continue;
        for (const [px, py] of POCKETS) if ((p.x - px) ** 2 + (p.y - py) ** 2 < POCKET * POCKET) { events?.push({step, k: 'pot', v: Math.hypot(p.vx, p.vy)}); b[i] = null; potted.push(i); break; }
        if (!b[i]) continue;
        let rail = 0;
        if (p.x < RAIL + R) { p.x = RAIL + R; rail = Math.abs(p.vx); p.vx = rail * 0.8; } else if (p.x > W - RAIL - R) { p.x = W - RAIL - R; rail = Math.abs(p.vx); p.vx = -rail * 0.8; }
        if (p.y < RAIL + R) { p.y = RAIL + R; rail = Math.max(rail, Math.abs(p.vy)); p.vy = Math.abs(p.vy) * 0.8; } else if (p.y > H - RAIL - R) { p.y = H - RAIL - R; rail = Math.max(rail, Math.abs(p.vy)); p.vy = -Math.abs(p.vy) * 0.8; }
        if (rail > 0.5) events?.push({step, k: 'rail', v: rail});
        for (let j = i + 1; j < 16; j++) {
          const q = b[j]; if (!q) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          if (i === 0 && first === null) first = j;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = (2 * R - d) / 2;
          p.x -= nx * over; p.y -= ny * over; q.x += nx * over; q.y += ny * over;
          const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
          if (rel > 0) { const kk = rel * 0.96; p.vx -= kk * nx; p.vy -= kk * ny; q.vx += kk * nx; q.vy += kk * ny; events?.push({step, k: 'hit', v: rel}); }
        }
      }
    }
    for (const p of b) if (p) {
      const v = Math.hypot(p.vx, p.vy);
      if (!v) continue;
      const nv = Math.max(0, v * 0.984 - 0.03);
      p.vx *= nv / v; p.vy *= nv / v;
      if (nv > 0.025) moving = true;
    }
    if (frames) frames.push(b.map(p => p && [p.x, p.y]));
    if (!moving) break;
  }
  return {end: b.map(p => p && [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), first, potted};
}
/** the first thing the cue ball meets along an aim: {t, n} with n the ball (or -1 for a cushion) and t the distance of its centre then */
export function poolAimHit(balls, cx, cy, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = {t: 1e9, n: -1};
  balls.forEach((p, n) => {
    if (!p || n === 0) return;
    const px = p[0] - cx, py = p[1] - cy, proj = px * dx + py * dy, d2 = px * px + py * py - proj * proj;
    if (proj < 0 || d2 > 4 * R * R) return;
    const t = proj - Math.sqrt(4 * R * R - d2);
    if (t < best.t) best = {t, n};
  });
  const wall = [dx > 0 ? (W - RAIL - R - cx) / dx : dx < 0 ? (RAIL + R - cx) / dx : 1e9, dy > 0 ? (H - RAIL - R - cy) / dy : dy < 0 ? (RAIL + R - cy) / dy : 1e9];
  const tw = Math.min(...wall);
  return tw < best.t ? {t: tw, n: -1} : best;
}
/** after a shot: whose turn, which group is whose, who won; rules of a simple eight ball */
export function poolJudge(state, shooter, result) {
  const {end, first, potted} = result, groups = {...state.groups}, players = state.players;
  const other = players[1 - players.indexOf(shooter)] || shooter;
  const mine = groups[shooter];
  const scratch = potted.includes(0) || first === null || (mine && group(first) !== mine && !(group(first) === 'eight' && cleared(end, mine)));
  if (!mine) {
    const firstPot = potted.find(n => n !== 0 && n !== 8);
    if (firstPot && !scratch) { groups[shooter] = group(firstPot); groups[other] = group(firstPot) === 'solids' ? 'stripes' : 'solids'; }
  }
  if (potted.includes(8)) {
    const won = !scratch && groups[shooter] && cleared(end, groups[shooter]);
    return {end: placeCue(end), groups, turn: other, winner: won ? shooter : other};
  }
  const potMine = potted.some(n => n !== 0 && (groups[shooter] ? group(n) === groups[shooter] : true));
  return {end: placeCue(end), groups, turn: !scratch && potMine ? shooter : other, winner: null, foul: scratch};
}
const cleared = (end, g) => end.every((p, n) => !p || group(n) !== g);
function placeCue(end) {
  if (end[0]) return end;
  const out = end.slice(); let x = W * 0.26, y = H / 2;
  while (out.some((p, n) => p && n && Math.hypot(p[0] - x, p[1] - y) < 2 * R + 1)) y += 2 * R + 2;
  out[0] = [x, Math.min(H - RAIL - R, y)];
  return out;
}
/** the computer's shot: a ball of its group that goes clean to a pocket, else the nearest one, never quite perfect */
function poolAim(end, g) {
  const cue = end[0], targets = end.map((p, n) => p && n && (g ? group(n) === g || (group(n) === 'eight' && cleared(end, g)) : n !== 8) ? n : null).filter(Boolean);
  const clear = (ax, ay, bx, by, skip) => end.every((p, n) => {
    if (!p || n === 0 || skip.includes(n)) return true;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    return Math.hypot(ax + t * (bx - ax) - p[0], ay + t * (by - ay) - p[1]) > 2 * R;
  });
  let best = null;
  for (const n of targets) for (const [px, py] of POCKETS) {
    const [tx, ty] = end[n], d = Math.hypot(px - tx, py - ty), gx = tx - (px - tx) / d * 2 * R, gy = ty - (py - ty) / d * 2 * R;
    const cut = ((gx - cue[0]) * (px - tx) + (gy - cue[1]) * (py - ty)) / (Math.hypot(gx - cue[0], gy - cue[1]) * d || 1);
    if (cut < 0.35 || !clear(cue[0], cue[1], gx, gy, [n]) || !clear(tx, ty, px, py, [n])) continue;
    const score = cut * 2 - (d + Math.hypot(gx - cue[0], gy - cue[1])) / 900;
    if (!best || score > best.score) best = {score, angle: Math.atan2(gy - cue[1], gx - cue[0]), power: Math.min(1, 0.25 + (d + Math.hypot(gx - cue[0], gy - cue[1])) / 900)};
  }
  if (!best) {
    const n = targets.sort((a, b) => Math.hypot(end[a][0] - cue[0], end[a][1] - cue[1]) - Math.hypot(end[b][0] - cue[0], end[b][1] - cue[1]))[0] || 8;
    best = {angle: Math.atan2(end[n][1] - cue[1], end[n][0] - cue[0]), power: 0.55};
  }
  return {angle: best.angle + (Math.random() - 0.5) * 0.03, power: Math.max(0.15, Math.min(1, best.power + (Math.random() - 0.5) * 0.1))};
}

// ------------------------------------------------------------------ the overlay and the three games
export function createGames({root, t, me, sendShot}) {
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  let ov = null, stop = null;
  function shell(title, onClose) {
    close();
    ov = document.createElement('div'); ov.className = 'o-game-ov';
    ov.innerHTML = `<div class="o-game-box"><div class="o-game-top"><b>${title}</b><span class="o-game-score"></span><button>✕ Esc</button></div></div>`;
    ov.querySelector('button').onclick = close;
    ov.addEventListener('pointerdown', e => e.stopPropagation()); ov.addEventListener('wheel', e => e.stopPropagation());
    root.appendChild(ov);
    stop = onClose || null;
    return ov.querySelector('.o-game-box');
  }
  function close() { if (stop) stop(); stop = null; if (ov) ov.remove(); ov = null; }
  addEventListener('keydown', e => { if (ov && e.key === 'Escape') { close(); e.stopImmediatePropagation(); } }, true);
  function canvas(box) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; box.appendChild(c);
    const pt = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    const g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    return {c, g, pt, rr};
  }
  const loop = fn => { let id = 0, last = performance.now(); const tick = now => { fn(Math.min(0.033, (now - last) / 1000)); last = now; id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); };

  // ping pong: your paddle on the left follows the mouse; where you hit the ball sets its angle, your paddle's speed its spin
  function pingPong() {
    const box = shell('🏓 Ping pong · ' + t().vsCpu), {c, g, pt, rr} = canvas(box), score = box.querySelector('.o-game-score');
    const s = {me: H / 2, cpu: H / 2, meV: 0, bx: W / 2, by: H / 2, vx: 0, vy: 0, spin: 0, pts: [0, 0], serve: 0, wait: 1, msg: ''}, trail = [];
    let mouseY = H / 2;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
    c.addEventListener('pointerdown', unlock);
    const PH = 70, PW = 10, SP = 330;
    const serve = () => { s.bx = W / 2; s.by = H / 2; const dir = s.serve ? 1 : -1; s.vx = dir * SP; s.vy = (Math.random() - 0.5) * 180; s.spin = 0; s.wait = 0.9; };
    serve();
    stop = loop(dt => {
      const prev = s.me; s.me += (Math.max(PH / 2, Math.min(H - PH / 2, mouseY)) - s.me) * Math.min(1, dt * 18); s.meV = (s.me - prev) / dt;
      const aim = s.by + (s.vx > 0 ? 0 : (H / 2 - s.by) * 0.6);                    // the computer watches the ball, a little late
      s.cpu += Math.max(-260 * dt, Math.min(260 * dt, aim - s.cpu));
      if (s.wait > 0) s.wait -= dt;
      else if (!s.msg) {
        s.vy += s.spin * dt; s.spin *= 0.985; s.bx += s.vx * dt; s.by += s.vy * dt;
        if (s.by < 8 || s.by > H - 8) { s.vy *= -1; s.by = Math.max(8, Math.min(H - 8, s.by)); sound('rail', 3); }
        const hit = (px, py, dir) => {
          if (Math.abs(s.bx - px) > PW || Math.abs(s.by - py) > PH / 2 + 6 || Math.sign(s.vx) !== -dir) return;
          const off = (s.by - py) / (PH / 2), sp = Math.min(760, Math.abs(s.vx) * 1.06 + 12);
          s.vx = dir * sp; s.vy = off * 300 + (dir > 0 ? s.meV * 0.25 : 0); s.spin = dir > 0 ? -s.meV * 0.6 : (Math.random() - 0.5) * 200; s.bx = px + dir * PW; sound('hit', 7);
        };
        hit(30, s.me, 1); hit(W - 30, s.cpu, -1);
        if (s.bx < -10 || s.bx > W + 10) {
          s.pts[s.bx < 0 ? 1 : 0]++; s.serve = s.bx < 0 ? 0 : 1; sound('pot', 6);
          if (Math.max(...s.pts) >= 11 && Math.abs(s.pts[0] - s.pts[1]) >= 2) s.msg = s.pts[0] > s.pts[1] ? t().youWin : t().cpuWins; else serve();
        }
      }
      let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1976d2'); gr.addColorStop(1, '#0a3b86'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 4; g.strokeRect(10, 10, W - 20, H - 20); g.lineWidth = 2; g.beginPath(); g.moveTo(10, H / 2); g.lineTo(W - 10, H / 2); g.stroke();
      g.font = '800 130px Segoe UI'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.07)'; g.fillText(s.pts[0], W * 0.25, H / 2 + 45); g.fillText(s.pts[1], W * 0.75, H / 2 + 45); g.textAlign = 'left';
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(W / 2 - 9, 0, 18, H);                                  // the net: its shadow, the band, the mesh and the posts
      g.fillStyle = 'rgba(245,245,245,.92)'; g.fillRect(W / 2 - 2, 0, 4, H);
      g.fillStyle = '#b0bec5'; for (let y = 12; y < H; y += 10) g.fillRect(W / 2 - 3, y, 6, 2);
      g.fillStyle = '#78909c'; for (const y of [4, H - 4]) { g.beginPath(); g.arc(W / 2, y, 6, 0, 7); g.fill(); }
      const paddle = (x, y, rubber, dir) => {                                                                // a wooden handle behind a blade with rubber
        g.fillStyle = '#c79a63'; rr(dir > 0 ? x - PW - 15 : x + PW, y - 5, 15, 10, 3); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)'; rr((dir > 0 ? x - PW : x) + 2, y - PH / 2 + 4, PW, PH, 5); g.fill();
        g.fillStyle = rubber; rr(dir > 0 ? x - PW : x, y - PH / 2, PW, PH, 5); g.fill();
        g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect((dir > 0 ? x - PW : x) + 2, y - PH / 2 + 4, 2, PH - 8);
      };
      paddle(30, s.me, '#e53935', 1); paddle(W - 30, s.cpu, '#263238', -1);
      trail.push([s.bx, s.by]); if (trail.length > 9) trail.shift();
      trail.forEach(([x, y], i) => { g.fillStyle = `rgba(255,245,157,${(i + 1) / 40})`; g.beginPath(); g.arc(x, y, 2 + i * 0.55, 0, 7); g.fill(); });
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(s.bx + 3, s.by + 5, 7, 5, 0, 0, 7); g.fill();
      gr = g.createRadialGradient(s.bx - 2, s.by - 2, 1, s.bx, s.by, 8); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#ffeb3b'); g.fillStyle = gr; g.beginPath(); g.arc(s.bx, s.by, 7, 0, 7); g.fill();
      score.textContent = `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText(s.msg + ' · ' + t().clickAgain, W / 2, H / 2 + 10); }
    });
    c.addEventListener('pointerdown', () => { if (s.msg) pingPong(); });
  }

  // foosball: your rods (red) move together with the mouse, a click kicks; the computer (blue) does the same
  function foosball() {
    const box = shell('⚽ ' + t().foosball + ' · ' + t().vsCpu), {c, g, pt, rr} = canvas(box), score = box.querySelector('.o-game-score');
    const GOAL = 70, rods = [  // x, players, gap, team (0 = you, attacking right)
      [50, 1, 0, 0], [130, 2, 120, 1], [200, 2, 140, 0], [310, 5, 70, 1], [400, 5, 70, 0], [490, 3, 110, 1], [600, 2, 140, 1], [670, 3, 110, 0], [750, 1, 0, 1]];
    const s = {y: [0, 0], ball: {x: W / 2, y: H / 2, vx: 0, vy: 0}, kick: [0, 0], pts: [0, 0], msg: '', wait: 1, flash: 0}, trail = [];
    let mouseY = H / 2;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
    c.addEventListener('pointerdown', () => { unlock(); if (s.msg) return foosball(); s.kick[0] = 0.18; });
    const reset = toward => { s.ball = {x: W / 2, y: H / 2, vx: toward * 60, vy: (Math.random() - 0.5) * 120}; s.wait = 0.8; };
    reset(Math.random() < 0.5 ? 1 : -1);
    stop = loop(dt => {
      s.y[0] += ((mouseY - H / 2) - s.y[0]) * Math.min(1, dt * 14);
      s.y[1] += Math.max(-220 * dt, Math.min(220 * dt, (s.ball.y - H / 2) * 0.9 - s.y[1]));
      for (const k of [0, 1]) s.kick[k] = Math.max(0, s.kick[k] - dt);
      s.flash = Math.max(0, s.flash - dt);
      const b = s.ball;
      if (s.wait > 0) s.wait -= dt;
      else if (!s.msg) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.995; b.vy *= 0.995;
        if (b.y < 18 || b.y > H - 18) { b.vy *= -1; b.y = Math.max(18, Math.min(H - 18, b.y)); sound('rail', 3); }
        if (b.x < 14 || b.x > W - 14) {
          if (Math.abs(b.y - H / 2) < GOAL) { s.pts[b.x < 14 ? 1 : 0]++; s.flash = 1; sound('pot', 7); if (Math.max(...s.pts) >= 5) s.msg = s.pts[0] > s.pts[1] ? t().youWin : t().cpuWins; else reset(b.x < 14 ? 1 : -1); }
          else { b.vx *= -0.8; b.x = Math.max(14, Math.min(W - 14, b.x)); }
        }
        for (const [x, n, gap, team] of rods) {
          const dir = team ? -1 : 1;
          if (team && Math.abs(b.x - x) < 60 && Math.sign(x - b.x) === dir && s.kick[1] <= 0 && Math.random() < dt * 6) s.kick[1] = 0.18;
          for (let i = 0; i < n; i++) {
            const py = H / 2 + (i - (n - 1) / 2) * gap + s.y[team];
            if (Math.abs(b.x - x) < 14 && Math.abs(b.y - py) < 16) {
              if (s.kick[team] > 0) { b.vx = dir * (430 + Math.random() * 120); b.vy = (b.y - py) * 18 + (Math.random() - 0.5) * 80; }
              else { b.vx = dir * Math.max(80, Math.abs(b.vx) * 0.6); b.vy += (b.y - py) * 4; }
              b.x = x + dir * 15; sound('hit', s.kick[team] > 0 ? 9 : 4);
            }
          }
        }
      }
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#2e7d32' : '#2a7430'; g.fillRect(i * W / 10, 0, W / 10, H); }          // the pitch, mown in stripes
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.strokeRect(8, 8, W - 16, H - 16); g.beginPath(); g.moveTo(W / 2, 8); g.lineTo(W / 2, H - 8); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 50, 0, 7); g.stroke(); g.strokeRect(8, H / 2 - GOAL - 20, 70, GOAL * 2 + 40); g.strokeRect(W - 78, H / 2 - GOAL - 20, 70, GOAL * 2 + 40);
      for (const x of [0, W - 10]) { g.fillStyle = '#263238'; g.fillRect(x, H / 2 - GOAL, 10, GOAL * 2); g.fillStyle = 'rgba(255,255,255,.22)'; for (let y = H / 2 - GOAL; y < H / 2 + GOAL; y += 8) g.fillRect(x, y, 10, 1); }
      for (const [x, n, gap, team] of rods) {
        const bar = g.createLinearGradient(x - 3, 0, x + 3, 0); bar.addColorStop(0, '#78909c'); bar.addColorStop(0.5, '#eceff1'); bar.addColorStop(1, '#78909c');
        g.fillStyle = bar; g.fillRect(x - 3, 0, 6, H);
        for (let i = 0; i < n; i++) {
          const py = H / 2 + (i - (n - 1) / 2) * gap + s.y[team], k = s.kick[team] > 0 ? (team ? -9 : 9) : 0, c1 = team ? '#42a5f5' : '#ef5350', c2 = team ? '#1565c0' : '#b71c1c';
          g.fillStyle = 'rgba(0,0,0,.28)'; rr(x - 6 + k + 3, py - 14 + 4, 12, 28, 4); g.fill();                                  // a little man: shadow, body, head, shirt stripe
          const bg = g.createLinearGradient(x - 6, 0, x + 6, 0); bg.addColorStop(0, c1); bg.addColorStop(1, c2); g.fillStyle = bg; rr(x - 6 + k, py - 14, 12, 28, 4); g.fill();
          g.fillStyle = '#ffe0b2'; g.beginPath(); g.arc(x + k, py, 4.5, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - 6 + k, py - 14, 12, 3);
        }
      }
      trail.push([b.x, b.y]); if (trail.length > 8) trail.shift();
      trail.forEach(([x, y], i) => { g.fillStyle = `rgba(255,255,255,${(i + 1) / 34})`; g.beginPath(); g.arc(x, y, 2 + i * 0.6, 0, 7); g.fill(); });
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(b.x + 3, b.y + 5, 8, 5.5, 0, 0, 7); g.fill();
      const bgr = g.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, 9); bgr.addColorStop(0, '#fff'); bgr.addColorStop(1, '#cfd8dc'); g.fillStyle = bgr; g.beginPath(); g.arc(b.x, b.y, 8, 0, 7); g.fill();
      if (s.flash > 0) { g.globalAlpha = Math.min(1, s.flash * 1.4); g.fillStyle = '#fff'; g.font = '800 64px Segoe UI'; g.textAlign = 'center'; g.fillText(t().goal, W / 2, H / 2 - 70 + (1 - s.flash) * -30); g.textAlign = 'left'; g.globalAlpha = 1; }
      score.textContent = `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText(s.msg + ' · ' + t().clickAgain, W / 2, H / 2 + 10); }
    });
  }

  // pool: aim from the cue ball toward the mouse (a ghost ball shows where it first touches), hold to load the shot, let go: the cue strikes
  let ac = null;                                                                // sound: a click for ball on ball, a thud for a cushion, a plop for a pocket
  const sound = (k, v) => {
    if (!ac || ac.state !== 'running') return;
    const o = ac.createOscillator(), gn = ac.createGain(), now = ac.currentTime;
    o.type = k === 'hit' ? 'triangle' : 'sine'; o.frequency.setValueAtTime(k === 'hit' ? 900 + Math.min(1, v / 10) * 500 : k === 'rail' ? 170 : 460, now);
    if (k === 'pot') o.frequency.exponentialRampToValueAtTime(90, now + 0.2);
    gn.gain.setValueAtTime(Math.min(0.22, 0.03 + v * 0.012), now); gn.gain.exponentialRampToValueAtTime(0.0001, now + (k === 'hit' ? 0.05 : 0.18));
    o.connect(gn); gn.connect(ac.destination); o.start(now); o.stop(now + 0.22);
  };
  const unlock = () => { if (!ac) try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { ac = null; } ac?.resume?.(); };
  const esc = x => String(x).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
  /** the table itself, drawn once: wooden frame, cloth with a soft light, diamonds and pockets */
  const tableImage = (() => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const k = cv.getContext('2d');
    let gr = k.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#7a4c24'); gr.addColorStop(0.5, '#5d3a1a'); gr.addColorStop(1, '#3f2710');
    k.fillStyle = gr; k.fillRect(0, 0, W, H);
    k.fillStyle = '#145f2e'; k.fillRect(RAIL - 5, RAIL - 5, W - 2 * RAIL + 10, H - 2 * RAIL + 10);                    // cushions
    gr = k.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.6); gr.addColorStop(0, '#26a355'); gr.addColorStop(1, '#14703a');
    k.fillStyle = gr; k.fillRect(RAIL, RAIL, W - 2 * RAIL, H - 2 * RAIL);
    k.fillStyle = '#f0e2c0'; for (let i = 1; i < 8; i++) { if (i === 4) continue; for (const y of [RAIL / 2, H - RAIL / 2]) { k.beginPath(); k.arc(RAIL + i * (W - 2 * RAIL) / 8, y, 2.4, 0, 7); k.fill(); } }
    for (let i = 1; i < 4; i++) for (const x of [RAIL / 2, W - RAIL / 2]) { k.beginPath(); k.arc(x, RAIL + i * (H - 2 * RAIL) / 4, 2.4, 0, 7); k.fill(); }
    k.strokeStyle = 'rgba(255,255,255,.12)'; k.lineWidth = 1; k.beginPath(); k.moveTo(W * 0.26, RAIL); k.lineTo(W * 0.26, H - RAIL); k.stroke();    // the head string
    for (const [px, py] of POCKETS) { gr = k.createRadialGradient(px, py, 2, px, py, POCKET + 2); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#1a1a1a'); k.fillStyle = gr; k.beginPath(); k.arc(px, py, POCKET, 0, 7); k.fill(); }
    return cv;
  })();
  function drawBall(g, x, y, n) {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x + 2.5, y + 3.5, R, R * 0.85, 0, 0, 7); g.fill();
    g.fillStyle = n > 8 ? '#f5f5f5' : COLORS[n]; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
    if (n > 8) { g.save(); g.beginPath(); g.arc(x, y, R, 0, 7); g.clip(); g.fillStyle = COLORS[n]; g.fillRect(x - R, y - 5, 2 * R, 10); g.restore(); }
    if (n) {
      g.fillStyle = '#f5f5f5'; g.beginPath(); g.arc(x, y, 4.2, 0, 7); g.fill();
      g.fillStyle = '#111'; g.font = '700 6.5px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, x, y + 0.5); g.textBaseline = 'alphabetic';
    }
    const gr = g.createRadialGradient(x - 3.5, y - 4, 1, x - 1, y - 1, R + 1);
    gr.addColorStop(0, 'rgba(255,255,255,.8)'); gr.addColorStop(0.35, 'rgba(255,255,255,.1)'); gr.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  }
  function pool(game = null, ctx = {}) {
    const vsCpu = !game, players = vsCpu ? [me(), 'CPU'] : game.players, waitingFor = !vsCpu && players.length < 2;
    const named = a => Object.fromEntries((a || []).map((g, i) => [players[i], g]).filter(([, g]) => g));    // [group0, group1] -> {name: group}
    const box = shell('🎱 ' + t().pool + ' · ' + (vsCpu ? t().vsCpu : players.join(' – ')), null), {c, g, pt} = canvas(box), score = box.querySelector('.o-game-score');
    const chips = document.createElement('div'); chips.className = 'o-pool-chips'; box.insertBefore(chips, c);          // who must pot which balls, and the points
    // under the table: whose turn it is and how to shoot; with a friend also the way out (cancel while waiting, forfeit while playing)
    const bar = document.createElement('div'); bar.className = 'o-game-wait';
    bar.innerHTML = `<span></span>` + (vsCpu ? '' : ` <button>${waitingFor ? t().poolCancel : '🏳 ' + t().poolQuit}</button>`);
    if (!vsCpu) bar.querySelector('button').onclick = () => { close(); ctx.cancel?.(); };
    box.appendChild(bar);
    const st = vsCpu ? {balls: poolRack(), groups: {}, turn: me(), winner: null, players} : {balls: game.balls, groups: named(game.groups), turn: players[game.turn], winner: game.done?.winner || null, players};
    let mouse = [W / 2, H / 2], charge = 0, holding = false, frames = null, evs = null, fi = 0, after = null, cpuAt = 0, strike = null, chipKey = '', cue = 'classic', spinDir = 1;
    // the cue to shoot with: four buttons (or the keys 1 to 4; 4 again turns the spin the other way)
    const cuesEl = document.createElement('div'); cuesEl.className = 'o-cues'; box.insertBefore(cuesEl, bar);
    const drawCues = () => {
      cuesEl.innerHTML = Object.entries(CUES).map(([k, v]) => `<button data-c="${k}" class="${cue === k ? 'o-on' : ''}" title="${esc(t()['cue_' + k + '_tip'])}">`
        + `<kbd>${v.key}</kbd> ${v.icon} ${esc(t()['cue_' + k])}${k === 'spin' ? (spinDir > 0 ? ' ↷' : ' ↶') : ''}</button>`).join('');
    };
    const pick = k => { if (!CUES[k]) return; if (k === 'spin' && cue === 'spin') spinDir = -spinDir; cue = k; drawCues(); };
    cuesEl.onclick = e => { const b = e.target.closest('button'); if (b) pick(b.dataset.c); };
    const onKey = e => { if (!ov || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return; const k = Object.entries(CUES).find(([, v]) => v.key === e.key)?.[0]; if (k) { pick(k); e.stopImmediatePropagation(); } };
    addEventListener('keydown', onKey, true);
    drawCues();
    c.addEventListener('pointermove', e => { mouse = pt(e); });
    c.addEventListener('pointerdown', e => {
      if (!ac) try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { ac = null; }
      ac?.resume?.();
      if (st.winner && vsCpu) return pool();
      if (canShoot()) { holding = true; charge = 0; }
    });
    const release = () => {
      if (!holding) return;
      holding = false;
      const shake = CUES[cue].shake ? (Math.random() - 0.5) * 2 * CUES[cue].shake : 0;                // a powerful cue is hard to hold still
      const aim = Math.atan2(mouse[1] - st.balls[0][1], mouse[0] - st.balls[0][0]) + shake;
      shoot(aim, Math.max(0.08, charge), true, cue === 'classic' ? {} : {cue, sp: spinDir});
    };
    addEventListener('pointerup', release);                                            // also when the mouse is let go outside the canvas
    const canShoot = () => !frames && !strike && !st.winner && !waitingFor && st.turn === me();
    /** the cue strikes (a tenth of a second), then the balls run */
    function shoot(angle, power, mine = true, fx = {}) {
      strike = {t: 0, angle, power, cue: fx.cue || 'classic', back: 16 + (mine ? charge : power) * 60, then: () => {
        frames = []; evs = []; fi = 0;
        const res = poolSimulate(st.balls, angle, power, frames, evs, fx);
        if (mine) {
          const shooter = st.turn, judged = poolJudge(st, shooter, res);
          after = () => {
            Object.assign(st, {balls: judged.end, groups: judged.groups, turn: judged.turn, winner: judged.winner});
            if (!vsCpu && shooter === me()) sendShot(game.id, {a: +angle.toFixed(5), p: +power.toFixed(4), ...(fx.cue ? {cue: fx.cue, ...(fx.cue === 'spin' ? {sp: fx.sp < 0 ? -1 : 1} : {})} : {}), end: judged.end, turn: players.indexOf(judged.turn),
                                                     groups: players.map(p => judged.groups[p] || null), win: judged.winner ? players.indexOf(judged.winner) : undefined});
          };
        }
      }};
    }
    // a friend's shot that arrives: the cue strikes, the balls run, then its result is taken as the truth
    const api = {receive(line) {
      if (frames || strike || line.end === undefined) return;
      shoot(line.a, line.p, false, {cue: line.cue, sp: line.sp});
      const then = strike.then;
      strike.then = () => { then(); after = () => Object.assign(st, {balls: line.end, groups: named(line.groups), turn: players[line.turn] || st.turn, winner: line.win == null ? null : players[line.win]}); };
    }};
    const cueAt = (cx, cy, a, back, kind = 'classic') => {                              // the cue: a stick behind the ball, each kind with its own colours and thickness
      const C = CUES[kind] || CUES.classic, x0 = cx - Math.cos(a) * back, y0 = cy - Math.sin(a) * back, x1 = x0 - Math.cos(a) * 230, y1 = y0 - Math.sin(a) * 230;
      const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, C.body[0]); gr.addColorStop(0.14, C.body[1]); gr.addColorStop(1, C.body[2]);
      g.strokeStyle = gr; g.lineCap = 'round'; g.lineWidth = C.width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = C.tip; g.lineWidth = C.width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 - Math.cos(a) * 4, y0 - Math.sin(a) * 4); g.stroke();   // the tip and ferrule
      if (kind === 'power') { g.strokeStyle = '#ff7043'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - Math.cos(a) * 30, y0 - Math.sin(a) * 30); g.lineTo(x0 - Math.cos(a) * 120, y0 - Math.sin(a) * 120); g.stroke(); }
      g.lineCap = 'butt'; g.lineWidth = 1;
    };
    const stopLoop = loop(dt => {
      if (holding) charge = Math.min(1, charge + dt / 1.1);
      let balls = st.balls;
      if (strike) {
        strike.t += dt;
        if (strike.t >= 0.1) { const f = strike.then; strike = null; f(); sound('hit', 6 + (frames && frames.length ? 4 : 0)); }
      } else if (frames) {
        const prev = fi;
        fi += dt * 60 * (frames.length - fi > 90 ? 1 : 1.25);                           // sixty steps a second, a little faster for the last stretch
        const i0 = Math.min(Math.floor(fi), frames.length - 1), i1 = Math.min(i0 + 1, frames.length - 1), u = fi - Math.floor(fi), A = frames[i0], B = frames[i1];
        balls = A.map((p, n) => !p ? null : !B[n] || u === 0 ? p : [p[0] + (B[n][0] - p[0]) * u, p[1] + (B[n][1] - p[1]) * u]);
        for (const e of evs) if (e.step >= prev && e.step < fi) sound(e.k, e.v);
        if (fi >= frames.length - 1) { frames = null; evs = null; after?.(); after = null; }
      } else if (vsCpu && st.turn === 'CPU' && !st.winner) {
        cpuAt += dt;
        if (cpuAt > 0.9) { cpuAt = 0; const s = poolAim(st.balls, st.groups.CPU); shoot(s.angle, s.power, true); }
      }
      g.drawImage(tableImage, 0, 0);
      balls.forEach((p, n) => { if (p && n) drawBall(g, p[0], p[1], n); });
      if (balls[0]) drawBall(g, balls[0][0], balls[0][1], 0);
      if (canShoot() || strike) {
        const [cx, cy] = st.balls[0], aim = Math.atan2(mouse[1] - cy, mouse[0] - cx), a = strike ? strike.angle : aim + (cue === 'power' ? Math.sin(performance.now() / 55) * 0.02 : 0);
        if (!strike) {
          const hit = poolAimHit(st.balls, cx, cy, a), tx = cx + Math.cos(a) * hit.t, ty = cy + Math.sin(a) * hit.t, long = CUES[cue].long;
          g.strokeStyle = cue === 'power' ? 'rgba(255,138,101,.7)' : 'rgba(255,255,255,.5)'; g.lineWidth = long ? 1 : 1.5; g.setLineDash(long ? [2, 5] : [5, 6]);
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
          g.strokeStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(tx, ty, R, 0, 7); g.stroke();                  // where the cue ball touches
          if (hit.n > 0) {                                                                                           // and where the ball it touches will go
            const [bx, by] = st.balls[hit.n], d = Math.hypot(bx - tx, by - ty) || 1, nx = (bx - tx) / d, ny = (by - ty) / d, len = long ? 150 : 46;
            g.strokeStyle = 'rgba(255,224,130,.75)'; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + nx * len, by + ny * len); g.stroke();
            if (long) {                                                                                              // the precise cue shows the cue ball's own way on, too
              const dx = Math.cos(a), dy = Math.sin(a), dot = dx * nx + dy * ny, ox = dx - dot * nx, oy = dy - dot * ny, ol = Math.hypot(ox, oy);
              if (ol > 0.08) { g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + ox / ol * 80, ty + oy / ol * 80); g.stroke(); }
            }
          } else if (long) {                                                                                         // no ball: the line bounces off the cushion
            const vx = Math.cos(a) * (Math.abs(tx - (RAIL + R)) < 0.5 || Math.abs(tx - (W - RAIL - R)) < 0.5 ? -1 : 1), vy = Math.sin(a) * (Math.abs(ty - (RAIL + R)) < 0.5 || Math.abs(ty - (H - RAIL - R)) < 0.5 ? -1 : 1);
            g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + vx * 160, ty + vy * 160); g.stroke();
          }
          if (cue === 'spin') { g.strokeStyle = 'rgba(129,199,132,.9)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R + 7, spinDir > 0 ? -0.6 : Math.PI + 0.6 - 1.4, spinDir > 0 ? 0.8 : Math.PI + 0.6 + 0.2); g.stroke(); g.lineWidth = 1; }   // a hint of the curve
          g.lineWidth = 1;
        }
        const back = strike ? strike.back * (1 - Math.min(1, strike.t / 0.1)) + 3 : 14 + charge * 60;
        cueAt(cx, cy, a, back, strike ? strike.cue : cue);
        if (holding) {                                                                                               // the power: a bar that goes green, yellow, red
          const w = (W - 2 * RAIL) * charge, gr = g.createLinearGradient(RAIL, 0, W - RAIL, 0); gr.addColorStop(0, '#66bb6a'); gr.addColorStop(0.6, '#ffd54f'); gr.addColorStop(1, '#ef5350');
          g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(RAIL, H - 16, W - 2 * RAIL, 7); g.fillStyle = gr; g.fillRect(RAIL, H - 16, w, 7);
        }
      }
      // who must pot what, and how many each has potted (the balls of their group that are off the table)
      const html = players.map(p => {
        const grp = st.groups[p], list = grp === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : grp === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
        const left = list.filter(n => balls[n]), dot = n => balls[n] ? `<i class="o-pb${n > 8 ? ' o-str' : ''}" style="--c:${COLORS[n]}"></i>` : '<i class="o-pb o-off"></i>';
        return `<div class="o-pchip${st.turn === p && !st.winner ? ' o-turn' : ''}"><b>${esc(p)}</b><span class="o-pg">${grp ? esc(t()[grp]) : '?'}</span>`
          + `<span class="o-pd">${list.map(dot).join('')}${grp && !left.length && balls[8] ? '<i class="o-pb o-eight">8</i>' : ''}</span><span class="o-pp">${list.length - left.length} ${esc(t().points)}</span></div>`;
      }).join('');
      if (html !== chipKey) { chipKey = html; chips.innerHTML = html; }
      bar.firstChild.textContent = waitingFor ? `⏳ ${t().poolWaiting(ctx.friend || t().poolWaitAny)}` : st.winner || frames || strike ? '' : canShoot() ? t().poolYourTurn : t().poolTheirTurn(st.turn);
      score.textContent = waitingFor ? '⏳' : st.winner ? `🏆 ${st.winner}` : t().turnOf(st.turn);
      if (st.winner) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 28px Segoe UI'; g.textAlign = 'center'; g.fillText(`🏆 ${st.winner}` + (vsCpu ? ' · ' + t().clickAgain : ''), W / 2, H / 2 + 10); }
    });
    stop = () => { stopLoop(); removeEventListener('pointerup', release); removeEventListener('keydown', onKey, true); };
    return api;
  }

  /** the pool table's menu: against the computer, or a game with friends in the common room */
  function poolMenu({friends, open, waiting, join, friend, restart, start}) {
    const box = shell('🎱 ' + t().pool);
    const m = document.createElement('div'); m.className = 'o-game-menu';
    m.innerHTML = `<button data-k="cpu">🤖 ${t().vsCpu}</button>` + (friends ? (open ? `<button data-k="open">🎱 ${t().openGame(open)}</button>` : join
      ? `<button data-k="join">🙋 ${t().joinPool(join)}</button>` : waiting ? `<button data-k="open">⏳ ${t().poolWaiting(friend || t().poolWaitAny)}</button>` : `<button data-k="new">👥 ${t().newPool}</button>`) : `<div>${t().poolFriends}</div>`) + (friends && restart ? `<button data-k="new">🔄 ${t().poolRestart}</button>` : '');
    m.onclick = e => { const k = e.target.dataset?.k; if (k === 'cpu') pool(); else if (k) { close(); start(k); } };
    box.appendChild(m);
  }
  let current = null;
  return {
    active: () => !!ov,
    close,
    pingPong, foosball, poolMenu,
    /** a pool game with a friend, its state replayed from the common room */
    openPool(game, ctx = {}) { current = {id: game.id, waiting: game.players.length < 2, api: pool(game, ctx)}; },
    /** the id of the game whose table is open and still waiting for the friend (null otherwise) */
    openId: () => (current && ov ? current.id : null),
    waitingId: () => (current && current.waiting && ov ? current.id : null),
    /** a friend's shot arrived: the open table plays it */
    shot(id, line) { if (current && current.id === id && ov) current.api.receive(line); },
  };
}
