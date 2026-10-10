// The games corner, playable: ping pong and foosball against the computer, in real time; pool against the computer or,
// turn by turn, with a friend through the common room (each shot carries where every ball ended, so both sides agree).
// Each game draws on one canvas laid over the office; Esc closes it.

const W = 800, H = 440;
const css = `
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
/** one shot, simulated to rest: returns where each ball ended (null if pocketed), the first ball hit, the pocketed ones */
export function poolSimulate(start, angle, power, frames = null) {
  const b = start.map(p => p && {x: p[0], y: p[1], vx: 0, vy: 0});
  const speed = 6 + power * 22;
  b[0].vx = Math.cos(angle) * speed; b[0].vy = Math.sin(angle) * speed;
  const potted = [];
  let first = null;
  for (let step = 0; step < 6000; step++) {
    let moving = false;
    for (let sub = 0; sub < 2; sub++) {
      for (const p of b) if (p) { p.x += p.vx / 2; p.y += p.vy / 2; }
      for (let i = 0; i < 16; i++) {
        const p = b[i]; if (!p) continue;
        for (const [px, py] of POCKETS) if ((p.x - px) ** 2 + (p.y - py) ** 2 < POCKET * POCKET) { b[i] = null; potted.push(i); break; }
        if (!b[i]) continue;
        if (p.x < RAIL + R) { p.x = RAIL + R; p.vx = Math.abs(p.vx) * 0.78; } else if (p.x > W - RAIL - R) { p.x = W - RAIL - R; p.vx = -Math.abs(p.vx) * 0.78; }
        if (p.y < RAIL + R) { p.y = RAIL + R; p.vy = Math.abs(p.vy) * 0.78; } else if (p.y > H - RAIL - R) { p.y = H - RAIL - R; p.vy = -Math.abs(p.vy) * 0.78; }
        for (let j = i + 1; j < 16; j++) {
          const q = b[j]; if (!q) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          if (i === 0 && first === null) first = j;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = (2 * R - d) / 2;
          p.x -= nx * over; p.y -= ny * over; q.x += nx * over; q.y += ny * over;
          const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
          if (rel > 0) { const k = rel * 0.97; p.vx -= k * nx; p.vy -= k * ny; q.vx += k * nx; q.vy += k * ny; }
        }
      }
    }
    for (const p of b) if (p) {
      const v = Math.hypot(p.vx, p.vy), slow = Math.max(0, v - 0.045) / (v || 1);
      p.vx *= slow * 0.993; p.vy *= slow * 0.993;
      if (v > 0.02) moving = true;
    }
    if (frames) frames.push(b.map(p => p && [p.x, p.y]));
    if (!moving) break;
  }
  return {end: b.map(p => p && [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), first, potted};
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
    return {c, g: c.getContext('2d'), pt};
  }
  const loop = fn => { let id = 0, last = performance.now(); const tick = now => { fn(Math.min(0.033, (now - last) / 1000)); last = now; id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => cancelAnimationFrame(id); };

  // ping pong: your paddle on the left follows the mouse; where you hit the ball sets its angle, your paddle's speed its spin
  function pingPong() {
    const box = shell('🏓 Ping pong · ' + t().vsCpu), {c, g, pt} = canvas(box), score = box.querySelector('.o-game-score');
    const s = {me: H / 2, cpu: H / 2, meV: 0, bx: W / 2, by: H / 2, vx: 0, vy: 0, spin: 0, pts: [0, 0], serve: 0, wait: 1, msg: ''};
    let mouseY = H / 2;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
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
        if (s.by < 8 || s.by > H - 8) { s.vy *= -1; s.by = Math.max(8, Math.min(H - 8, s.by)); }
        const hit = (px, py, dir) => {
          if (Math.abs(s.bx - px) > PW || Math.abs(s.by - py) > PH / 2 + 6 || Math.sign(s.vx) !== -dir) return;
          const off = (s.by - py) / (PH / 2), sp = Math.min(760, Math.abs(s.vx) * 1.06 + 12);
          s.vx = dir * sp; s.vy = off * 300 + (dir > 0 ? s.meV * 0.25 : 0); s.spin = dir > 0 ? -s.meV * 0.6 : (Math.random() - 0.5) * 200; s.bx = px + dir * PW;
        };
        hit(30, s.me, 1); hit(W - 30, s.cpu, -1);
        if (s.bx < -10 || s.bx > W + 10) {
          s.pts[s.bx < 0 ? 1 : 0]++; s.serve = s.bx < 0 ? 0 : 1;
          if (Math.max(...s.pts) >= 11 && Math.abs(s.pts[0] - s.pts[1]) >= 2) s.msg = s.pts[0] > s.pts[1] ? t().youWin : t().cpuWins; else serve();
        }
      }
      g.fillStyle = '#0d47a1'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12); g.lineWidth = 2; g.beginPath(); g.moveTo(6, H / 2); g.lineTo(W - 6, H / 2); g.stroke();
      g.fillStyle = '#e0e0e0'; g.fillRect(W / 2 - 2, 0, 4, H);
      g.fillStyle = '#e53935'; g.fillRect(30 - PW, s.me - PH / 2, PW, PH); g.fillStyle = '#212121'; g.fillRect(W - 30, s.cpu - PH / 2, PW, PH);
      g.fillStyle = '#fff59d'; g.beginPath(); g.arc(s.bx, s.by, 7, 0, 7); g.fill();
      score.textContent = `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText(s.msg + ' · ' + t().clickAgain, W / 2, H / 2 + 10); }
    });
    c.addEventListener('pointerdown', () => { if (s.msg) pingPong(); });
  }

  // foosball: your rods (red) move together with the mouse, a click kicks; the computer (blue) does the same
  function foosball() {
    const box = shell('⚽ ' + t().foosball + ' · ' + t().vsCpu), {c, g, pt} = canvas(box), score = box.querySelector('.o-game-score');
    const GOAL = 70, rods = [  // x, players, gap, team (0 = you, attacking right)
      [50, 1, 0, 0], [130, 2, 120, 1], [200, 2, 140, 0], [310, 5, 70, 1], [400, 5, 70, 0], [490, 3, 110, 1], [600, 2, 140, 1], [670, 3, 110, 0], [750, 1, 0, 1]];
    const s = {y: [0, 0], ball: {x: W / 2, y: H / 2, vx: 0, vy: 0}, kick: [0, 0], pts: [0, 0], msg: '', wait: 1};
    let mouseY = H / 2;
    c.addEventListener('pointermove', e => { mouseY = pt(e)[1]; });
    c.addEventListener('pointerdown', () => { if (s.msg) return foosball(); s.kick[0] = 0.18; });
    const reset = toward => { s.ball = {x: W / 2, y: H / 2, vx: toward * 60, vy: (Math.random() - 0.5) * 120}; s.wait = 0.8; };
    reset(Math.random() < 0.5 ? 1 : -1);
    stop = loop(dt => {
      s.y[0] += ((mouseY - H / 2) - s.y[0]) * Math.min(1, dt * 14);
      s.y[1] += Math.max(-220 * dt, Math.min(220 * dt, (s.ball.y - H / 2) * 0.9 - s.y[1]));
      for (const k of [0, 1]) s.kick[k] = Math.max(0, s.kick[k] - dt);
      const b = s.ball;
      if (s.wait > 0) s.wait -= dt;
      else if (!s.msg) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.995; b.vy *= 0.995;
        if (b.y < 18 || b.y > H - 18) { b.vy *= -1; b.y = Math.max(18, Math.min(H - 18, b.y)); }
        if (b.x < 14 || b.x > W - 14) {
          if (Math.abs(b.y - H / 2) < GOAL) { s.pts[b.x < 14 ? 1 : 0]++; if (Math.max(...s.pts) >= 5) s.msg = s.pts[0] > s.pts[1] ? t().youWin : t().cpuWins; else reset(b.x < 14 ? 1 : -1); }
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
              b.x = x + dir * 15;
            }
          }
        }
      }
      g.fillStyle = '#2e7d32'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.strokeRect(8, 8, W - 16, H - 16); g.beginPath(); g.moveTo(W / 2, 8); g.lineTo(W / 2, H - 8); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 50, 0, 7); g.stroke();
      g.fillStyle = '#ddd'; g.fillRect(0, H / 2 - GOAL, 8, GOAL * 2); g.fillRect(W - 8, H / 2 - GOAL, 8, GOAL * 2);
      for (const [x, n, gap, team] of rods) {
        g.fillStyle = '#b0bec5'; g.fillRect(x - 2, 0, 4, H);
        for (let i = 0; i < n; i++) {
          const py = H / 2 + (i - (n - 1) / 2) * gap + s.y[team], k = s.kick[team] > 0 ? (team ? -8 : 8) : 0;
          g.fillStyle = team ? '#1e88e5' : '#e53935'; g.fillRect(x - 6 + k, py - 14, 12, 28);
        }
      }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(b.x, b.y, 8, 0, 7); g.fill();
      score.textContent = `${t().you} ${s.pts[0]} – ${s.pts[1]} CPU`;
      if (s.msg) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 30px Segoe UI'; g.textAlign = 'center'; g.fillText(s.msg + ' · ' + t().clickAgain, W / 2, H / 2 + 10); }
    });
  }

  // pool: aim from the cue ball toward the mouse, hold to load the shot, let go to shoot
  function pool(game = null) {
    const vsCpu = !game, players = vsCpu ? [me(), 'CPU'] : game.players;
    const named = a => Object.fromEntries((a || []).map((g, i) => [players[i], g]).filter(([, g]) => g));    // [group0, group1] -> {name: group}
    const box = shell('🎱 ' + t().pool + ' · ' + (vsCpu ? t().vsCpu : players.join(' – ')), null), {c, g, pt} = canvas(box), score = box.querySelector('.o-game-score');
    const st = vsCpu ? {balls: poolRack(), groups: {}, turn: me(), winner: null, players} : {balls: game.balls, groups: named(game.groups), turn: players[game.turn], winner: game.done?.winner || null, players};
    let mouse = [W / 2, H / 2], charge = 0, holding = false, frames = null, fi = 0, after = null, cpuAt = 0;
    c.addEventListener('pointermove', e => { mouse = pt(e); });
    c.addEventListener('pointerdown', e => { if (st.winner && vsCpu) return pool(); if (canShoot()) { holding = true; charge = 0; } });
    const release = () => { if (holding) { holding = false; shoot(Math.atan2(mouse[1] - st.balls[0][1], mouse[0] - st.balls[0][0]), Math.max(0.08, charge)); } };
    addEventListener('pointerup', release);                                            // also when the mouse is let go outside the canvas
    const canShoot = () => !frames && !st.winner && st.turn === me();
    function shoot(angle, power) {
      const shooter = st.turn;
      frames = []; fi = 0;
      const res = poolSimulate(st.balls, angle, power, frames);
      const judged = poolJudge(st, shooter, res);
      after = () => {
        Object.assign(st, {balls: judged.end, groups: judged.groups, turn: judged.turn, winner: judged.winner});
        if (!vsCpu && shooter === me()) sendShot(game.id, {a: +angle.toFixed(5), p: +power.toFixed(4), end: judged.end, turn: players.indexOf(judged.turn),
                                                 groups: players.map(p => judged.groups[p] || null), win: judged.winner ? players.indexOf(judged.winner) : undefined});
      };
    }
    // a friend's shot that arrives: play it out, then take its result as the truth
    const api = {receive(line) {
      if (frames || line.end === undefined) return;
      frames = []; fi = 0; poolSimulate(st.balls, line.a, line.p, frames);
      after = () => Object.assign(st, {balls: line.end, groups: named(line.groups), turn: players[line.turn] || st.turn, winner: line.win == null ? null : players[line.win]});
    }};
    const stopLoop = loop(dt => {
      if (holding) charge = Math.min(1, charge + dt / 1.2);
      let balls = st.balls;
      if (frames) {
        fi += 2; balls = frames[Math.min(fi, frames.length - 1)] || balls;
        if (fi >= frames.length - 1) { frames = null; after?.(); after = null; }
      } else if (vsCpu && st.turn === 'CPU' && !st.winner) {
        cpuAt += dt;
        if (cpuAt > 0.9) { cpuAt = 0; const s = poolAim(st.balls, st.groups.CPU); shoot(s.angle, s.power); }
      }
      g.fillStyle = '#5d3a1a'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#1b7a3a'; g.fillRect(RAIL, RAIL, W - 2 * RAIL, H - 2 * RAIL);
      g.fillStyle = '#0c0c0c'; for (const [px, py] of POCKETS) { g.beginPath(); g.arc(px, py, POCKET, 0, 7); g.fill(); }
      balls.forEach((p, n) => {
        if (!p) return;
        g.fillStyle = COLORS[n]; g.beginPath(); g.arc(p[0], p[1], R, 0, 7); g.fill();
        if (n > 8) { g.fillStyle = '#f5f5f5'; g.fillRect(p[0] - R + 2, p[1] - 3, 2 * R - 4, 6); }
        if (n) { g.fillStyle = n === 8 ? '#fff' : '#111'; g.font = '700 8px Segoe UI'; g.textAlign = 'center'; g.fillText(n, p[0], p[1] + 3); }
      });
      if (canShoot()) {
        const [cx, cy] = st.balls[0], a = Math.atan2(mouse[1] - cy, mouse[0] - cx);
        g.strokeStyle = 'rgba(255,255,255,.45)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 600, cy + Math.sin(a) * 600); g.stroke(); g.setLineDash([]);
        const back = 16 + charge * 60;
        g.strokeStyle = '#d7b98e'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - Math.cos(a) * back, cy - Math.sin(a) * back); g.lineTo(cx - Math.cos(a) * (back + 220), cy - Math.sin(a) * (back + 220)); g.stroke(); g.lineWidth = 1;
        if (holding) { g.fillStyle = '#ffd54f'; g.fillRect(RAIL, H - 14, (W - 2 * RAIL) * charge, 6); }
      }
      const gname = p => st.groups[p] ? ` (${t()[st.groups[p]]})` : '';
      score.textContent = st.winner ? `🏆 ${st.winner}` : `${t().turnOf(st.turn)} · ${players.map(p => p + gname(p)).join(' · ')}`;
      if (st.winner) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, H / 2 - 40, W, 80); g.fillStyle = '#fff'; g.font = '700 28px Segoe UI'; g.textAlign = 'center'; g.fillText(`🏆 ${st.winner}` + (vsCpu ? ' · ' + t().clickAgain : ''), W / 2, H / 2 + 10); }
    });
    stop = () => { stopLoop(); removeEventListener('pointerup', release); };
    return api;
  }

  /** the pool table's menu: against the computer, or a game with friends in the common room */
  function poolMenu({friends, open, waiting, join, start}) {
    const box = shell('🎱 ' + t().pool);
    const m = document.createElement('div'); m.className = 'o-game-menu';
    m.innerHTML = `<button data-k="cpu">🤖 ${t().vsCpu}</button>` + (friends ? (open ? `<button data-k="open">🎱 ${t().openGame(open)}</button>` : join
      ? `<button data-k="join">🙋 ${t().joinPool(join)}</button>` : waiting ? `<div>${t().waitingPlayer}</div>` : `<button data-k="new">👥 ${t().newPool}</button>`) : `<div>${t().poolFriends}</div>`);
    m.onclick = e => { const k = e.target.dataset?.k; if (k === 'cpu') pool(); else if (k) { close(); start(k); } };
    box.appendChild(m);
  }
  let current = null;
  return {
    active: () => !!ov,
    close,
    pingPong, foosball, poolMenu,
    /** a pool game with a friend, its state replayed from the common room */
    openPool(game) { current = {id: game.id, api: pool(game)}; },
    /** a friend's shot arrived: the open table plays it */
    shot(id, line) { if (current && current.id === id && ov) current.api.receive(line); },
  };
}
