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
.o-pcue { font-size: 13px; }
.o-pp small { color: #ef5350; font-size: 11px; }
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

  // ---------------------------------------------------------------- ping pong and foosball: against the computer, or with a friend in real time.
  // With a friend each side moves its own paddle (or rods) at once and sends where it is about 25 times a second; both sides simulate the ball with
  // the same physics, so nothing waits for the tunnel; the creator of the game (net.role 0) is the referee: it sends the ball's state about fifteen
  // times a second and at every bounce and point, and the other side moves its ball gently towards it (or snaps when it is far off). The other side
  // guesses how old a snapshot is from a ping (half the round trip). Points are the referee's: the other side holds the ball at the edge until it hears.
  /** the glue of a match in real time: send / listen, ping, the other's paddle, the rematch; `net` comes from the page (see office.js) */
  function netSession(net, s, onSnap, onStart) {
    const out = {rtt: 120, lastP: 0, lastY: null, oppAt: 0, off: null, sent: 0};
    out.send = (m) => net.send(m);
    out.off = net.on((m, from) => {
      if (m.k === 'p') {                                                       // the other's paddle or rods
        const now = performance.now(), dt = Math.max(0.02, (now - out.oppAt) / 1000);
        if (out.oppAt) s.oppV = Math.max(-900, Math.min(900, (m.y - s.oppT) / dt)) * 0.5 + s.oppV * 0.5;
        out.oppAt = now; s.oppT = m.y; if (m.c !== undefined) s.oppC = m.c;
      } else if (m.k === 'q') net.send({k: 'o', c: m.c});                       // a ping: answered at once
      else if (m.k === 'o') out.rtt = Math.max(10, Math.min(900, performance.now() - m.c));
      else if (m.k === 's') onStart(m);
      else onSnap(m);
    });
    const ping = setInterval(() => net.send({k: 'q', c: performance.now()}), 1000);
    return {rtt: () => out.rtt, send: m => net.send(m), close() { out.off(); clearInterval(ping); },
            /** your paddle, throttled: when it moved, at most every 40 ms, and now and then if it did not */
            paddle(y, c) {
              const now = performance.now();
              if (now - out.lastP > 40 && (out.lastY === null || Math.abs(y - out.lastY) > 0.8 || now - out.lastP > 250 || c !== out.lastC)) {
                out.lastP = now; out.lastY = y; out.lastC = c; net.send(c === undefined ? {k: 'p', y: +y.toFixed(1)} : {k: 'p', y: +y.toFixed(1), c});
              }
            }};
  }

  function pingPong(net = null) {
    const role = net ? net.role : 0, X = x => role ? W - x : x;                // canonical: player 0 on the left; the second player sees the table turned round
    const box = shell('🏓 Ping pong · ' + (net ? net.friend : t().vsCpu)), {c, g, pt, rr} = canvas(box), score = box.querySelector('.o-game-score');
    const s = {me: H / 2, opp: H / 2, oppT: H / 2, meV: 0, oppV: 0, bx: W / 2, by: H / 2, vx: 0, vy: 0, spin: 0, pts: [0, 0], serve: 0, wait: 1, msg: 0, hold: false, started: !net}, trail = [];
    let mouseY = H / 2, seq = 0, lastSnap = 0;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
    const PH = 70, PW = 10, SP = 330, ref = !net || role === 0;                  // the referee decides points and serves
    const serve = () => { s.bx = W / 2; s.by = H / 2; const dir = s.serve ? 1 : -1; s.vx = dir * SP; s.vy = (Math.random() - 0.5) * 180; s.spin = 0; s.wait = 0.9; s.hold = false; };
    const snap = () => { lastSnap = performance.now(); if (net) ns.send({k: 'b', n: ++seq, x: +s.bx.toFixed(1), y: +s.by.toFixed(1), vx: +s.vx.toFixed(1), vy: +s.vy.toFixed(1), sp: +s.spin.toFixed(1), a: s.pts[0], b: s.pts[1], w: +Math.max(0, s.wait).toFixed(2), m: s.msg, sv: s.serve}); };
    const reset = () => { s.pts = [0, 0]; s.msg = 0; s.serve = 0; serve(); };
    const ns = net && netSession(net, s, m => {                                 // the referee's snapshot: the ball, the points, the serve
      if (m.k !== 'b' || role === 0) return;
      const d = Math.min(0.3, ns.rtt() / 2000), tx = m.x + (m.w > 0 ? 0 : m.vx * d), ty = m.y + (m.w > 0 ? 0 : m.vy * d), err = Math.hypot(tx - s.bx, ty - s.by);
      if (s.hold || err > 60 || m.w > 0 || !s.started) { s.bx = tx; s.by = ty; } else { s.bx += (tx - s.bx) * 0.5; s.by += (ty - s.by) * 0.5; }
      s.vx = m.vx; s.vy = m.vy; s.spin = m.sp; s.pts = [m.a, m.b]; s.wait = m.w; s.msg = m.m; s.serve = m.sv; s.hold = false; s.started = true;
    }, () => {                                                                  // 's': the other is ready (or asks for another game); the referee starts, the other follows
      if (role === 0) { if (!s.started || s.msg) { s.started = true; reset(); snap(); ns.send({k: 's'}); } }
      else if (s.msg) { s.pts = [0, 0]; s.msg = 0; }
    });
    if (ref && !net) serve();
    let readyAt = 0;
    c.addEventListener('pointerdown', () => { unlock(); if (s.msg) { if (net) { if (role === 0) { reset(); snap(); ns.send({k: 's'}); } else ns.send({k: 's'}); } else pingPong(); } });
    const stopLoop = loop(dt => {
      const prev = s.me; s.me += (Math.max(PH / 2, Math.min(H - PH / 2, mouseY)) - s.me) * Math.min(1, dt * 18); s.meV = (s.me - prev) / dt;
      if (net) {
        ns.paddle(s.me);
        s.opp += (s.oppT - s.opp) * Math.min(1, dt * 20);
        if (!s.started && role === 1 && performance.now() - readyAt > 400) { readyAt = performance.now(); ns.send({k: 's'}); }     // "I am here": until the referee's first snapshot
      } else {
        const aim = s.by + (s.vx > 0 ? 0 : (H / 2 - s.by) * 0.6);                    // the computer watches the ball, a little late
        s.opp += Math.max(-260 * dt, Math.min(260 * dt, aim - s.opp));
      }
      if (s.started && s.wait > 0) s.wait -= dt;
      else if (s.started && !s.msg && !s.hold) {
        s.vy += s.spin * dt; s.spin *= 0.985; s.bx += s.vx * dt; s.by += s.vy * dt;
        let event = false;
        if (s.by < 8 || s.by > H - 8) { s.vy *= -1; s.by = Math.max(8, Math.min(H - 8, s.by)); sound('rail', 3); event = true; }
        const hit = (px, side, dir) => {
          if (Math.abs(s.bx - px) > PW || Math.abs(s.by - (side === role ? s.me : s.opp)) > PH / 2 + 6 || Math.sign(s.vx) !== -dir) return;
          const py = side === role ? s.me : s.opp, v = side === role ? s.meV : net ? s.oppV : 0, off = (s.by - py) / (PH / 2), sp = Math.min(760, Math.abs(s.vx) * 1.06 + 12);
          s.vx = dir * sp; s.vy = off * 300 + v * 0.25; s.spin = net || side === role ? -v * 0.6 : (Math.random() - 0.5) * 200; s.bx = px + dir * PW; sound('hit', 7); event = true;
        };
        hit(30, 0, 1); hit(W - 30, 1, -1);
        if (s.bx < -10 || s.bx > W + 10) {
          if (ref) {
            s.pts[s.bx < 0 ? 1 : 0]++; s.serve = s.bx < 0 ? 0 : 1; sound('pot', 6);
            if (Math.max(...s.pts) >= 11 && Math.abs(s.pts[0] - s.pts[1]) >= 2) { s.msg = s.pts[0] > s.pts[1] ? 1 : 2; } else serve();
            event = true;
          } else { s.hold = true; s.vx = s.vy = 0; s.bx = s.bx < 0 ? -10 : W + 10; }                                // wait for the referee's word
        }
        if (net && role === 0 && (event || performance.now() - lastSnap > 66)) snap();
      }
      if (net && role === 0 && s.started && (s.wait > 0 || s.msg) && performance.now() - lastSnap > 150) snap();                   // keep the other informed while nothing moves
      // the table, as the player sees it: own side on the left, the net, the score as faint figures behind
      let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1976d2'); gr.addColorStop(1, '#0a3b86'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 4; g.strokeRect(10, 10, W - 20, H - 20); g.lineWidth = 2; g.beginPath(); g.moveTo(10, H / 2); g.lineTo(W - 10, H / 2); g.stroke();
      g.font = '800 130px Segoe UI'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.07)'; g.fillText(s.pts[role], W * 0.25, H / 2 + 45); g.fillText(s.pts[1 - role], W * 0.75, H / 2 + 45); g.textAlign = 'left';
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(W / 2 - 9, 0, 18, H);
      g.fillStyle = 'rgba(245,245,245,.92)'; g.fillRect(W / 2 - 2, 0, 4, H);
      g.fillStyle = '#b0bec5'; for (let y = 12; y < H; y += 10) g.fillRect(W / 2 - 3, y, 6, 2);
      g.fillStyle = '#78909c'; for (const y of [4, H - 4]) { g.beginPath(); g.arc(W / 2, y, 6, 0, 7); g.fill(); }
      const paddle = (x, y, rubber, dir) => {                                                                // a wooden handle behind a blade with rubber
        g.fillStyle = '#c79a63'; rr(dir > 0 ? x - PW - 15 : x + PW, y - 5, 15, 10, 3); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)'; rr((dir > 0 ? x - PW : x) + 2, y - PH / 2 + 4, PW, PH, 5); g.fill();
        g.fillStyle = rubber; rr(dir > 0 ? x - PW : x, y - PH / 2, PW, PH, 5); g.fill();
        g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect((dir > 0 ? x - PW : x) + 2, y - PH / 2 + 4, 2, PH - 8);
      };
      paddle(30, s.me, '#e53935', 1); paddle(W - 30, s.opp, '#263238', -1);                                  // (your paddle is always the left one on your screen)
      const bx = role ? W - s.bx : s.bx;
      if (!s.hold) { trail.push([bx, s.by]); if (trail.length > 9) trail.shift(); }
      trail.forEach(([x, y], i) => { g.fillStyle = `rgba(255,245,157,${(i + 1) / 40})`; g.beginPath(); g.arc(x, y, 2 + i * 0.55, 0, 7); g.fill(); });
      if (!s.hold && s.started) {
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(bx + 3, s.by + 5, 7, 5, 0, 0, 7); g.fill();
        gr = g.createRadialGradient(bx - 2, s.by - 2, 1, bx, s.by, 8); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#ffeb3b'); g.fillStyle = gr; g.beginPath(); g.arc(bx, s.by, 7, 0, 7); g.fill();
      }
      score.textContent = net ? `${s.pts[role]} – ${s.pts[1 - role]} ${net.friend}${!s.started ? ' · ⏳' : ''}` : `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { const won = s.msg - 1 === role; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText((won ? t().youWin : net ? t().theyWin(net.friend) : t().cpuWins) + ' · ' + t().clickAgain, W / 2, H / 2 + 10); g.textAlign = 'left'; }
    });
    stop = () => { stopLoop(); ns?.close(); };
  }

  // foosball: your rods follow the mouse, a click kicks; against the computer or a friend (the same scheme as ping pong: you move your own rods at once)
  function foosball(net = null) {
    const role = net ? net.role : 0, X = x => role ? W - x : x, mine = role;      // team 0 attacks right (the creator of the game), team 1 left; the second player sees the table turned round
    const box = shell('⚽ ' + t().foosball + ' · ' + (net ? net.friend : t().vsCpu)), {c, g, pt, rr} = canvas(box), score = box.querySelector('.o-game-score');
    const GOAL = 70, rods = [  // x, players, gap, team
      [50, 1, 0, 0], [130, 2, 120, 1], [200, 2, 140, 0], [310, 5, 70, 1], [400, 5, 70, 0], [490, 3, 110, 1], [600, 2, 140, 1], [670, 3, 110, 0], [750, 1, 0, 1]];
    const s = {y: [0, 0], ball: {x: W / 2, y: H / 2, vx: 0, vy: 0}, kick: [0, 0], pts: [0, 0], msg: 0, wait: 1, flash: 0, oppT: 0, oppV: 0, oppC: 0, hold: false, started: !net}, trail = [];
    let mouseY = H / 2, kc = 0, seq = 0, lastSnap = 0, readyAt = 0;
    const ref = !net || role === 0;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
    const reset = toward => { s.ball = {x: W / 2, y: H / 2, vx: toward * 60, vy: (Math.random() - 0.5) * 120}; s.wait = 0.8; s.hold = false; };
    const snap = () => { lastSnap = performance.now(); if (net) ns.send({k: 'f', n: ++seq, x: +s.ball.x.toFixed(1), y: +s.ball.y.toFixed(1), vx: +s.ball.vx.toFixed(1), vy: +s.ball.vy.toFixed(1), a: s.pts[0], b: s.pts[1], w: +Math.max(0, s.wait).toFixed(2), m: s.msg}); };
    const restart = () => { s.pts = [0, 0]; s.msg = 0; reset(Math.random() < 0.5 ? 1 : -1); };
    const ns = net && netSession(net, s, m => {
      if (m.k !== 'f' || role === 0) return;
      const d = Math.min(0.3, ns.rtt() / 2000), b = s.ball, tx = m.x + (m.w > 0 ? 0 : m.vx * d), ty = m.y + (m.w > 0 ? 0 : m.vy * d), err = Math.hypot(tx - b.x, ty - b.y);
      if (s.hold || err > 60 || m.w > 0 || !s.started) { b.x = tx; b.y = ty; } else { b.x += (tx - b.x) * 0.5; b.y += (ty - b.y) * 0.5; }
      b.vx = m.vx; b.vy = m.vy; s.pts = [m.a, m.b]; s.wait = m.w; s.msg = m.m; s.hold = false; s.started = true;
    }, () => {
      if (role === 0) { if (!s.started || s.msg) { s.started = true; restart(); snap(); ns.send({k: 's'}); } }
      else if (s.msg) { s.pts = [0, 0]; s.msg = 0; }
    });
    if (!net) reset(Math.random() < 0.5 ? 1 : -1);
    c.addEventListener('pointerdown', () => {
      unlock();
      if (s.msg) { if (net) { if (role === 0) { restart(); snap(); ns.send({k: 's'}); } else ns.send({k: 's'}); } else foosball(); return; }
      s.kick[mine] = 0.18; kc++;
    });
    let lastC = 0;
    const stopLoop = loop(dt => {
      s.y[mine] += ((mouseY - H / 2) - s.y[mine]) * Math.min(1, dt * 14);
      const other = 1 - mine;
      if (net) {
        ns.paddle(s.y[mine], kc);
        s.y[other] += (s.oppT - s.y[other]) * Math.min(1, dt * 20);
        if (s.oppC !== lastC) { lastC = s.oppC; s.kick[other] = 0.18; }                                           // the other kicked
        if (!s.started && role === 1 && performance.now() - readyAt > 400) { readyAt = performance.now(); ns.send({k: 's'}); }
      } else s.y[1] += Math.max(-220 * dt, Math.min(220 * dt, (s.ball.y - H / 2) * 0.9 - s.y[1]));
      for (const k of [0, 1]) s.kick[k] = Math.max(0, s.kick[k] - dt);
      s.flash = Math.max(0, s.flash - dt);
      const b = s.ball;
      if (s.started && s.wait > 0) s.wait -= dt;
      else if (s.started && !s.msg && !s.hold) {
        let event = false;
        b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.995; b.vy *= 0.995;
        if (b.y < 18 || b.y > H - 18) { b.vy *= -1; b.y = Math.max(18, Math.min(H - 18, b.y)); sound('rail', 3); event = true; }
        if (b.x < 14 || b.x > W - 14) {
          if (Math.abs(b.y - H / 2) < GOAL) {
            if (ref) {
              s.pts[b.x < 14 ? 1 : 0]++; s.flash = 1; sound('pot', 7); event = true;
              if (Math.max(...s.pts) >= 5) s.msg = s.pts[0] > s.pts[1] ? 1 : 2; else reset(b.x < 14 ? 1 : -1);
            } else { s.hold = true; b.vx = b.vy = 0; b.x = b.x < 14 ? 6 : W - 6; s.flash = 1; }                       // a goal: the referee will say
          } else { b.vx *= -0.8; b.x = Math.max(14, Math.min(W - 14, b.x)); event = true; }
        }
        for (const [x, n, gap, team] of rods) {
          const dir = team ? -1 : 1;
          if (!net && team && Math.abs(b.x - x) < 60 && Math.sign(x - b.x) === dir && s.kick[1] <= 0 && Math.random() < dt * 6) s.kick[1] = 0.18;     // the computer kicks now and then
          for (let i = 0; i < n; i++) {
            const py = H / 2 + (i - (n - 1) / 2) * gap + s.y[team];
            if (Math.abs(b.x - x) < 14 && Math.abs(b.y - py) < 16) {
              if (s.kick[team] > 0) { b.vx = dir * (430 + Math.random() * 120); b.vy = (b.y - py) * 18 + (Math.random() - 0.5) * 80; }
              else { b.vx = dir * Math.max(80, Math.abs(b.vx) * 0.6); b.vy += (b.y - py) * 4; }
              b.x = x + dir * 15; sound('hit', s.kick[team] > 0 ? 9 : 4); event = true;
            }
          }
        }
        if (net && role === 0 && (event || performance.now() - lastSnap > 66)) snap();
      }
      if (net && role === 0 && s.started && (s.wait > 0 || s.msg) && performance.now() - lastSnap > 150) snap();
      // the pitch, as the player sees it: own team on the left attacking right
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#2e7d32' : '#2a7430'; g.fillRect(i * W / 10, 0, W / 10, H); }
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.strokeRect(8, 8, W - 16, H - 16); g.beginPath(); g.moveTo(W / 2, 8); g.lineTo(W / 2, H - 8); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 50, 0, 7); g.stroke(); g.strokeRect(8, H / 2 - GOAL - 20, 70, GOAL * 2 + 40); g.strokeRect(W - 78, H / 2 - GOAL - 20, 70, GOAL * 2 + 40);
      for (const x of [0, W - 10]) { g.fillStyle = '#263238'; g.fillRect(x, H / 2 - GOAL, 10, GOAL * 2); g.fillStyle = 'rgba(255,255,255,.22)'; for (let y = H / 2 - GOAL; y < H / 2 + GOAL; y += 8) g.fillRect(x, y, 10, 1); }
      for (const [x0, n, gap, team] of rods) {
        const x = X(x0), bar = g.createLinearGradient(x - 3, 0, x + 3, 0); bar.addColorStop(0, '#78909c'); bar.addColorStop(0.5, '#eceff1'); bar.addColorStop(1, '#78909c');
        g.fillStyle = bar; g.fillRect(x - 3, 0, 6, H);
        const mineTeam = team === mine;
        for (let i = 0; i < n; i++) {
          const py = H / 2 + (i - (n - 1) / 2) * gap + s.y[team], k = s.kick[team] > 0 ? (mineTeam ? 9 : -9) : 0, c1 = mineTeam ? '#ef5350' : '#42a5f5', c2 = mineTeam ? '#b71c1c' : '#1565c0';
          g.fillStyle = 'rgba(0,0,0,.28)'; rr(x - 6 + k + 3, py - 14 + 4, 12, 28, 4); g.fill();
          const bg = g.createLinearGradient(x - 6, 0, x + 6, 0); bg.addColorStop(0, c1); bg.addColorStop(1, c2); g.fillStyle = bg; rr(x - 6 + k, py - 14, 12, 28, 4); g.fill();
          g.fillStyle = '#ffe0b2'; g.beginPath(); g.arc(x + k, py, 4.5, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - 6 + k, py - 14, 12, 3);
        }
      }
      const bx = X(b.x);
      if (!s.hold) { trail.push([bx, b.y]); if (trail.length > 8) trail.shift(); }
      trail.forEach(([x, y], i) => { g.fillStyle = `rgba(255,255,255,${(i + 1) / 34})`; g.beginPath(); g.arc(x, y, 2 + i * 0.6, 0, 7); g.fill(); });
      if (s.started) {
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(bx + 3, b.y + 5, 8, 5.5, 0, 0, 7); g.fill();
        const bgr = g.createRadialGradient(bx - 3, b.y - 3, 1, bx, b.y, 9); bgr.addColorStop(0, '#fff'); bgr.addColorStop(1, '#cfd8dc'); g.fillStyle = bgr; g.beginPath(); g.arc(bx, b.y, 8, 0, 7); g.fill();
      }
      if (s.flash > 0) { g.globalAlpha = Math.min(1, s.flash * 1.4); g.fillStyle = '#fff'; g.font = '800 64px Segoe UI'; g.textAlign = 'center'; g.fillText(t().goal, W / 2, H / 2 - 70 + (1 - s.flash) * -30); g.textAlign = 'left'; g.globalAlpha = 1; }
      score.textContent = net ? `${s.pts[mine]} – ${s.pts[1 - mine]} ${net.friend}${!s.started ? ' · ⏳' : ''}` : `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { const won = s.msg - 1 === mine; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText((won ? t().youWin : net ? t().theyWin(net.friend) : t().cpuWins) + ' · ' + t().clickAgain, W / 2, H / 2 + 10); g.textAlign = 'left'; }
    });
    stop = () => { stopLoop(); ns?.close(); };
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
    const fouls = {}, lastCue = {};                                                       // fouls and the cue last used, per player (from the shots played so far)
    for (const sh of game?.shots || []) { fouls[sh.by] = (fouls[sh.by] || 0) + (sh.fl ? 1 : 0); lastCue[sh.by] = sh.cue || 'classic'; }
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
            fouls[shooter] = (fouls[shooter] || 0) + (judged.foul ? 1 : 0); lastCue[shooter] = fx.cue || 'classic';
            if (!vsCpu && shooter === me()) sendShot(game.id, {a: +angle.toFixed(5), p: +power.toFixed(4), fl: judged.foul ? 1 : 0, ...(fx.cue ? {cue: fx.cue, ...(fx.cue === 'spin' ? {sp: fx.sp < 0 ? -1 : 1} : {})} : {}), end: judged.end, turn: players.indexOf(judged.turn),
                                                     groups: players.map(p => judged.groups[p] || null), win: judged.winner ? players.indexOf(judged.winner) : undefined});
          };
        }
      }};
    }
    // a friend's shot that arrives: the cue strikes, the balls run, then its result is taken as the truth
    const api = {receive(line) {
      if (frames || strike || line.end === undefined) return;
      shoot(line.a, line.p, false, {cue: line.cue, sp: line.sp});
      const who = line.by || players.find(x => x !== me());
      fouls[who] = (fouls[who] || 0) + (line.fl ? 1 : 0); lastCue[who] = line.cue || 'classic';
      const then = strike.then;
      strike.then = () => { then(); after = () => Object.assign(st, {balls: line.end, groups: named(line.groups), turn: players[line.turn] || st.turn, winner: line.win == null ? null : players[line.win]}); };
    }};
    const cueAt = (cx, cy, a, back, kind = 'classic') => {                              // the cue: a stick behind the ball, each kind with its own colours and thickness
      const C = CUES[kind] || CUES.classic, x0 = cx - Math.cos(a) * back, y0 = cy - Math.sin(a) * back, x1 = x0 - Math.cos(a) * 230, y1 = y0 - Math.sin(a) * 230;
      const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, C.body[0]); gr.addColorStop(0.14, C.body[1]); gr.addColorStop(1, C.body[2]);
      g.strokeStyle = gr; g.lineCap = 'round'; g.lineWidth = C.width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = C.tip; g.lineWidth = C.width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 - Math.cos(a) * 4, y0 - Math.sin(a) * 4); g.stroke();   // the tip and ferrule
      if (kind === 'spin') { g.strokeStyle = '#2e9e4d'; g.lineWidth = C.width + 1; g.beginPath(); g.moveTo(x0 - Math.cos(a) * 22, y0 - Math.sin(a) * 22); g.lineTo(x0 - Math.cos(a) * 46, y0 - Math.sin(a) * 46); g.stroke(); }
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
          if (cue === 'spin') {                                                                                      // the way the cue ball will bend
            const nx = -Math.sin(a) * spinDir, ny = Math.cos(a) * spinDir, len = Math.min(200, hit.t * 0.8 + 40);
            g.strokeStyle = 'rgba(129,199,132,.95)'; g.lineWidth = 2; g.setLineDash([]); g.beginPath(); g.moveTo(cx, cy);
            g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6 + nx * 22, cy + Math.sin(a) * len * 0.6 + ny * 22, cx + Math.cos(a) * len + nx * 46, cy + Math.sin(a) * len + ny * 46); g.stroke();
            const ex = cx + Math.cos(a) * len + nx * 46, ey = cy + Math.sin(a) * len + ny * 46, ta = Math.atan2(ey - (cy + Math.sin(a) * len * 0.6 + ny * 22), ex - (cx + Math.cos(a) * len * 0.6 + nx * 22));
            g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(ta - 0.5) * 9, ey - Math.sin(ta - 0.5) * 9); g.lineTo(ex - Math.cos(ta + 0.5) * 9, ey - Math.sin(ta + 0.5) * 9); g.closePath(); g.fillStyle = 'rgba(129,199,132,.95)'; g.fill(); g.lineWidth = 1;
          }
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
        const pts = list.length - left.length - (fouls[p] || 0), cu = CUES[p === me() ? cue : lastCue[p]];
        return `<div class="o-pchip${st.turn === p && !st.winner ? ' o-turn' : ''}"><b>${esc(p)}</b>${cu ? `<span class="o-pcue" title="${esc(t()['cue_' + (p === me() ? cue : lastCue[p])])}">${cu.icon}</span>` : ''}<span class="o-pg">${grp ? esc(t()[grp]) : '?'}</span>`
          + `<span class="o-pd">${list.map(dot).join('')}${grp && !left.length && balls[8] ? '<i class="o-pb o-eight">8</i>' : ''}</span>`
          + `<span class="o-pp">${fouls[p] ? `<small title="${esc(t().poolFouls)}">⚠${fouls[p]}</small> ` : ''}${pts} ${esc(t().points)}</span></div>`;
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
  function poolMenu({kind = 'pool', friends, open, waiting, join, friend, restart, start}) {
    const icon = kind === 'pingpong' ? '🏓' : kind === 'foos' ? '⚽' : '🎱', cpu = kind === 'pingpong' ? () => pingPong() : kind === 'foos' ? () => foosball() : () => pool();
    const box = shell(icon + ' ' + (kind === 'pingpong' ? 'Ping pong' : kind === 'foos' ? t().foosball : t().pool));
    const m = document.createElement('div'), pl = kind === 'pool'; m.className = 'o-game-menu';
    m.innerHTML = `<button data-k="cpu">🤖 ${t().vsCpu}</button>` + (friends ? (open ? `<button data-k="open">${icon} ${t().openGame(open)}</button>` : join
      ? `<button data-k="join">🙋 ${pl ? t().joinPool(join) : t().joinMatch(join)}</button>` : waiting ? `<button data-k="open">⏳ ${t().poolWaiting(friend || t().poolWaitAny)}</button>` : `<button data-k="new">👥 ${pl ? t().newPool : t().newMatch}</button>`)
      : `<div>${pl ? t().poolFriends : t().matchFriends}</div>`) + (friends && restart ? `<button data-k="new">🔄 ${t().poolRestart}</button>` : '');
    m.onclick = e => { const k = e.target.dataset?.k; if (k === 'cpu') cpu(); else if (k) { close(); start(k); } };
    box.appendChild(m);
  }
  let current = null;
  return {
    active: () => !!ov,
    close,
    pingPong, foosball, poolMenu,
    /** a ping pong or foosball match with a friend, in real time: waiting for the friend, or on (ctx: friend, send(msg), on(fn) -> off, cancel) */
    openNet(game, ctx) {
      current = {id: game.id, waiting: game.players.length < 2, api: null};
      if (game.players.length < 2) {
        const box = shell((game.type === 'pingpong' ? '🏓 Ping pong' : '⚽ ' + t().foosball)), w = document.createElement('div'); w.className = 'o-game-wait';
        w.innerHTML = `<span>⏳ ${esc(t().poolWaiting(ctx.friend || t().poolWaitAny))}</span> <button>${t().poolCancel}</button>`;
        w.querySelector('button').onclick = () => { close(); ctx.cancel?.(); };
        box.appendChild(w);
        return;
      }
      (game.type === 'pingpong' ? pingPong : foosball)({role: game.players[0] === me() ? 0 : 1, friend: game.players.find(p => p !== me()), send: ctx.send, on: ctx.on});
    },
    /** a pool game with a friend, its state replayed from the common room */
    openPool(game, ctx = {}) { current = {id: game.id, waiting: game.players.length < 2, api: pool(game, ctx)}; },
    /** the id of the game whose table is open and still waiting for the friend (null otherwise) */
    openId: () => (current && ov ? current.id : null),
    waitingId: () => (current && current.waiting && ov ? current.id : null),
    /** a friend's shot arrived: the open table plays it */
    shot(id, line) { if (current && current.id === id && current.api && ov) current.api.receive(line); },
  };
}
