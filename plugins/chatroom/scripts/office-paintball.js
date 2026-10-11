// Paintball. A mode you switch on from the "Altro" menu: in first person a click shoots, the crosshair is the middle
// of the screen, the paint stays on walls, furniture and figures until you switch the mode off (then it all goes). You
// have HP; at 0 you are out for a few seconds and come back with full HP. 1, 2, 3 change the weapon.
//
// With a friend in the same office the shots go over the presence channel, the one that already carries where you are and
// your jumps: your snapshot {on, hp, w, k, shots[]} rides in your position (`pb`), and the other side draws your shots
// (a short tracer and a splat at the same place) and takes the damage of the ones that hit it. Everyone owns their own HP:
// the shooter says who it hit and for how much, the one hit applies it once (each shot has a number).
//
// The numbers to play with are the two tables below.

export const WEAPONS = [
  {id: 'pistol',  it: 'Pistola',        en: 'Pistol',  pellets: 1, burst: 1, gap: 0,    damage: 20, spread: 0.004, range: 80, cooldown: 0.35},
  {id: 'smg',     it: 'Mitra',          en: 'SMG',     pellets: 1, burst: 4, gap: 0.07, damage: 8,  spread: 0.025, range: 70, cooldown: 0.7},
  {id: 'shotgun', it: 'Fucile a pompa', en: 'Shotgun', pellets: 5, burst: 1, gap: 0,    damage: 12, spread: 0.11,  range: 9,  cooldown: 1.0},
];
export const RULES = {hp: 100, respawn: 3, maxSplats: 200, tracer: 0.16, shots: 12, recoil: 2.2};
/** zombie mode: they come in waves, walk to you along the real floor routes, bite when close; a headshot counts double */
export const ZOMBIES = {hp: 40, speed: 0.9, bite: 10, biteEvery: 1, reach: 1.0, first: 3, more: 2, max: 10, pause: 3, spawnMin: 7};
const COLORS = ['#ff1744', '#ffea00', '#00e5ff', '#76ff03', '#e040fb', '#ff9100', '#2979ff', '#f50057'];
const TEXT = {
  it: {zon: '🧟 Zombie: sopravvivi alle ondate', lock: 'Spegni il paintball per uscire dalla prima persona', zoff: 'Zombie spenti', over: (w, k) => `Eliminato: ondata ${w}, zombie ${k}`, on: '🔫 Paintball acceso: clic per sparare, 1 2 3 per le armi', off: 'Paintball spento: le macchie sono sparite', hit: n => `Colpito da ${n}`, out: n => `Eliminato: rinasci tra ${n} s`, pov: 'Entra in prima persona (POV) per sparare', hp: 'HP'},
  en: {zon: '🧟 Zombies: survive the waves', lock: 'Switch paintball off to leave first person', zoff: 'Zombies off', over: (w, k) => `You are out: wave ${w}, ${k} zombies`, on: '🔫 Paintball on: click to shoot, 1 2 3 for weapons', off: 'Paintball off: the paint is gone', hit: n => `Hit by ${n}`, out: n => `You are out: back in ${n} s`, pov: 'Go first person (POV) to shoot', hp: 'HP'},
};
const CSS = `
.o-pnt { position: absolute; inset: 0; pointer-events: none; z-index: 24; font: 600 13px "Segoe UI", system-ui, sans-serif; color: #fff; }
.o-pnt .o-pnt-cross { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; display: none; }
.o-pnt .o-pnt-cross:before, .o-pnt .o-pnt-cross:after { content: ""; position: absolute; background: #fff; box-shadow: 0 0 3px #000; }
.o-pnt .o-pnt-cross:before { left: 10px; top: 0; width: 2px; height: 22px; } .o-pnt .o-pnt-cross:after { top: 10px; left: 0; height: 2px; width: 22px; }
.o-pnt .o-pnt-me { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%); min-width: 240px; padding: 8px 12px; border-radius: 10px; background: #14151de6; text-align: center; }
.o-pnt .o-pnt-bar { height: 10px; margin: 5px 0; border-radius: 5px; background: #333; overflow: hidden; } .o-pnt .o-pnt-bar i { display: block; height: 100%; background: #43a047; transition: width .2s; }
.o-pnt .o-pnt-w b { padding: 1px 6px; margin: 0 2px; border-radius: 6px; opacity: .55; } .o-pnt .o-pnt-w b.o-on { opacity: 1; background: #e53935; }
.o-pnt .o-pnt-others { position: absolute; right: 12px; top: 56px; min-width: 150px; padding: 6px 10px; border-radius: 10px; background: #14151dcc; }
.o-pnt .o-pnt-others div { margin: 3px 0; } .o-pnt .o-pnt-others .o-pnt-bar { height: 6px; margin: 2px 0 0; }
.o-pnt .o-pnt-z { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 4px 12px; border-radius: 10px; background: #14151dcc; display: none; }
.o-pnt .o-pnt-flash { position: absolute; inset: 0; background: radial-gradient(transparent 55%, #e53935aa); opacity: 0; transition: opacity .5s; }
.o-pnt .o-pnt-flash.o-on { opacity: 1; transition: none; }
.o-pnt .o-pnt-msg { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-size: 22px; text-shadow: 0 2px 6px #000; text-align: center; }
`;

const hashName = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const r2 = v => Math.round(v * 100) / 100;

/** pov(): true in first person with the camera on the eyes; me(): my name; players(): Map name -> root Object3D of the friends here;
 *  sink(pb): where my snapshot goes (office.js sends it with my position; null when the mode is off); lang(): 'it' or 'en';
 *  say(text): a short message on screen */
export function createPaintball({THREE, scene, camera, canvas, root, pov, me, players, sink, lang = () => 'it', say = () => {}, body = () => null, floor = null, size = [30, 20], enterPov = () => {}}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const hud = document.createElement('div'); hud.className = 'o-pnt'; hud.style.display = 'none';
  hud.innerHTML = `<div class="o-pnt-flash"></div><div class="o-pnt-cross"></div><div class="o-pnt-others"></div><div class="o-pnt-z"></div>
    <div class="o-pnt-me"><div class="o-pnt-hp"></div><div class="o-pnt-bar"><i></i></div><div class="o-pnt-w"></div></div><div class="o-pnt-msg"></div>`;
  root.appendChild(hud);
  const el = {flash: hud.querySelector('.o-pnt-flash'), cross: hud.querySelector('.o-pnt-cross'), others: hud.querySelector('.o-pnt-others'),
              z: hud.querySelector('.o-pnt-z'), hp: hud.querySelector('.o-pnt-hp'), bar: hud.querySelector('.o-pnt-me .o-pnt-bar i'), w: hud.querySelector('.o-pnt-w'), msg: hud.querySelector('.o-pnt-msg')};
  const T = () => TEXT[lang()] || TEXT.it;

  // the paint: one instanced mesh for the world (a single draw call), small meshes stuck to the figures
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#fff';
    let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;           // the same splat on every computer
    g.beginPath(); g.arc(64, 64, 30, 0, 7); g.fill();
    for (let i = 0; i < 12; i++) { const a = rnd() * 6.283, d = 30 + rnd() * 22, r = 3 + rnd() * 9; g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 7); g.fill();
                                   g.lineWidth = r * 0.8; g.beginPath(); g.moveTo(64 + Math.cos(a) * 25, 64 + Math.sin(a) * 25); g.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); g.stroke(); g.strokeStyle = '#fff'; }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const plane = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false});
  const world = new THREE.InstancedMesh(plane, mat, RULES.maxSplats);
  world.count = 0; world.frustumCulled = false; world.renderOrder = 3; world.userData.noShot = true; world.raycast = () => {}; scene.add(world);
  let placed = 0;
  const figSplats = [];
  const tracers = [];
  for (let i = 0; i < 12; i++) {                                                          // a pool of short lines: the shots you can see
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({transparent: true, opacity: 0.9, toneMapped: false}));
    line.visible = false; line.frustumCulled = false; line.userData.noShot = true; line.raycast = () => {}; scene.add(line); tracers.push({line, until: 0});
  }

  const Z = new THREE.Vector3(0, 0, 1), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  function splat(point, normal, ci, shooterSize = 1) {
    const size = (0.28 + Math.random() * 0.22) * shooterSize, n = normal.clone().normalize();
    _q.setFromUnitVectors(Z, n); _r.setFromAxisAngle(Z, Math.random() * 6.283); _q.multiply(_r);
    const i = placed % RULES.maxSplats; placed++; world.count = Math.min(RULES.maxSplats, placed);
    _m.compose(_p.copy(point).addScaledVector(n, 0.012), _q, _s.set(size, size, 1)); world.setMatrixAt(i, _m); world.setColorAt(i, _c.set(COLORS[ci]));
    world.instanceMatrix.needsUpdate = true; world.instanceColor.needsUpdate = true;
  }
  function figureSplat(top, point, normal, ci) {                                           // on a figure: it carries the paint when it walks
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({map: tex, color: COLORS[ci], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false}));
    const size = 0.12 + Math.random() * 0.1, n = normal.clone().applyQuaternion(top.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    m.position.copy(top.worldToLocal(point.clone())).addScaledVector(n, 0.012); m.quaternion.setFromUnitVectors(Z, n); m.scale.set(size, size, 1);
    m.userData.noShot = true; m.raycast = () => {}; top.add(m); figSplats.push({top, m});
    if (figSplats.length > 60) { const o = figSplats.shift(); o.top.remove(o.m); o.m.material.dispose(); }
  }
  function tracer(from, to, ci) {
    const t = tracers.find(x => !x.line.visible) || tracers[0];
    const a = t.line.geometry.attributes.position; a.setXYZ(0, from.x, from.y - 0.05, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    t.line.material.color.set(COLORS[ci]); t.line.visible = true; t.until = performance.now() / 1000 + RULES.tracer;
  }
  function clearPaint() {
    world.count = 0; placed = 0;
    for (const o of figSplats) { o.top.remove(o.m); o.m.material.dispose(); }
    figSplats.length = 0; for (const t of tracers) t.line.visible = false;
  }

  // the game
  let on = false, hp = RULES.hp, weapon = 0, alive = true, respawnAt = 0, nextShot = 0, deaths = 0, shotId = 0, flashUntil = 0;
  let out = [];                                                                           // my last shots, with their numbers
  const others = new Map();                                                               // name -> {hp, w, k, seen}
  const ray = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _rt = new THREE.Vector3();
  const publish = () => sink(on ? {on: true, hp: Math.round(hp), w: weapon, k: deaths, shots: out.slice(-RULES.shots)} : null);

  function drawHud() {
    const w = WEAPONS[weapon], L = lang();
    el.hp.textContent = `${T().hp} ${Math.round(hp)}`; el.bar.style.width = Math.max(0, hp) + '%'; el.bar.style.background = hp > 50 ? '#43a047' : hp > 25 ? '#fb8c00' : '#e53935';
    el.w.innerHTML = WEAPONS.map((x, i) => `<b class="${i === weapon ? 'o-on' : ''}">${i + 1} ${x[L] || x.it}</b>`).join('');
    el.others.style.display = others.size ? '' : 'none';
    el.others.innerHTML = [...others].map(([n, o]) => `<div>${n.replace(/[<>&"]/g, '')} · ${o.hp}<div class="o-pnt-bar"><i style="width:${o.hp}%;background:${o.hp > 50 ? '#43a047' : o.hp > 25 ? '#fb8c00' : '#e53935'}"></i></div></div>`).join('');
  }
  function hurt(d, by) {
    if (!alive) return;
    hp = Math.max(0, hp - d); flashUntil = performance.now() / 1000 + 0.25; el.flash.classList.add('o-on');
    if (hp <= 0) { alive = false; deaths++; respawnAt = performance.now() / 1000 + RULES.respawn; el.msg.textContent = zOn ? T().over(Math.max(1, wave), kills) : T().out(RULES.respawn); }
    else { el.msg.textContent = T().hit(by); setTimeout(() => { if (alive) el.msg.textContent = ''; }, 900); }
    drawHud(); publish();
  }
  function hitOf(h) {                                                                      // what a ray hit: a friend, a figure, or the place
    let friend = null, top = null;
    const roots = players();
    for (let o = h.object; o; o = o.parent) {
      for (const [n, r] of roots) if (r === o) friend = n;
      if (o.parent === scene) top = o;
    }
    const zombie = h.object.userData.zombie || null, figure = friend || h.object.userData.person || zombie ? top : null;
    const nrm = (h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : _d.clone().negate());
    if (nrm.dot(_d) > 0) nrm.negate();
    return {friend, figure, zombie, normal: nrm};
  }
  function shootOnce(w) {
    camera.getWorldPosition(_o); camera.getWorldDirection(_d); _u.set(0, 1, 0); _rt.crossVectors(_d, _u).normalize(); _u.crossVectors(_rt, _d).normalize();
    const base = _d.clone();
    for (let k = 0; k < w.pellets; k++) {
      _d.copy(base).addScaledVector(_rt, (Math.random() - 0.5) * 2 * w.spread).addScaledVector(_u, (Math.random() - 0.5) * 2 * w.spread).normalize();
      ray.set(_o, _d); ray.near = 0.25; ray.far = w.range;
      const hit = ray.intersectObjects(scene.children, true).find(h => {
        for (let o = h.object; o; o = o.parent) if (o.userData.noShot || o === camera || !o.visible) return false;
        return !h.object.isSprite && !h.object.isLine && !h.object.isPoints && h.object.userData.person !== me();
      });
      const ci = hashName(me()) % COLORS.length;
      const to = hit ? hit.point.clone() : _o.clone().addScaledVector(_d, w.range);
      tracer(_o, to, ci);
      let friend = null, nrm = _d.clone().negate();
      if (hit) {
        const r = hitOf(hit); friend = r.friend; nrm = r.normal;
        if (r.zombie && !r.zombie.dead) { r.zombie.hp -= w.damage * (hit.object.userData.head ? 2 : 1); if (r.zombie.hp <= 0) killZombie(r.zombie, performance.now() / 1000); }
        if (r.figure) figureSplat(r.figure, hit.point, nrm, ci); else splat(hit.point, nrm, ci);
      }
      out.push({id: ++shotId, o: [r2(_o.x), r2(_o.y), r2(_o.z)], p: [r2(to.x), r2(to.y), r2(to.z)], n: hit ? [r2(nrm.x), r2(nrm.y), r2(nrm.z)] : null, h: friend, d: friend ? w.damage : 0, c: ci});
    }
    if (out.length > RULES.shots * 2) out = out.slice(-RULES.shots);
    publish();
  }
  function fire() {
    if (!on || !alive) return;
    if (!pov()) return say(T().pov);
    const now = performance.now() / 1000, w = WEAPONS[weapon];
    if (now < nextShot) return;
    nextShot = now + w.cooldown + (w.burst - 1) * w.gap;
    camera.fov += RULES.recoil; camera.updateProjectionMatrix();                           // a kick that the camera's own easing takes back, smoothly
    for (let b = 0; b < w.burst; b++) b ? setTimeout(() => { if (on && alive) shootOnce(w); }, b * w.gap * 1000) : shootOnce(w);
  }
  function effect(s, by) {                                                                 // a friend's shot, drawn here
    const from = _o.set(...s.o), to = _p.set(...s.p), ci = s.c % COLORS.length;
    tracer(from, to, ci);
    if (s.n) {
      const nrm = new THREE.Vector3(...s.n);
      let fig = null;
      for (const [n, r] of players()) if (n === s.h) fig = r;
      if (fig) figureSplat(fig, to, nrm, ci); else splat(to, nrm, ci);
    }
    if (s.h === me()) hurt(s.d, by);
  }

  // zombies
  const zgeo = {head: new THREE.BoxGeometry(0.3, 0.3, 0.3), torso: new THREE.BoxGeometry(0.44, 0.62, 0.24), arm: new THREE.BoxGeometry(0.13, 0.58, 0.13), leg: new THREE.BoxGeometry(0.16, 0.62, 0.16), eyes: new THREE.BoxGeometry(0.2, 0.05, 0.02)};
  const zmat = {skin: new THREE.MeshLambertMaterial({color: '#7cb342'}), shirt: new THREE.MeshLambertMaterial({color: '#6d4c41'}), pants: new THREE.MeshLambertMaterial({color: '#37474f'}), eyes: new THREE.MeshBasicMaterial({color: '#ff1744', toneMapped: false})};
  const zs = []; let zOn = false, wave = 0, kills = 0, nextWaveAt = 0;
  const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  function buildZombie(x, z0, now) {
    const g = new THREE.Group(), z = {root: g, hp: ZOMBIES.hp, dead: false, path: [], pathAt: -9, lastTarget: null, vel: new THREE.Vector3(), yaw: 0, born: now, bite: 0, phase: Math.random() * 6, deadAt: 0, limbs: {}};
    const limb = (geo, mat, px, py, pz, drop, key, head) => {
      const m = new THREE.Mesh(geo, mat), pv = new THREE.Group(); pv.position.set(px, py, pz); m.position.y = -drop; pv.add(m); g.add(pv); m.userData.zombie = z; if (head) m.userData.head = true; if (key) z.limbs[key] = pv; return pv;
    };
    limb(zgeo.head, zmat.skin, 0, 1.62, 0, 0, null, true); limb(zgeo.torso, zmat.shirt, 0, 1.08, 0, 0);
    limb(zgeo.eyes, zmat.eyes, 0, 1.64, 0.155, 0, null, true);
    limb(zgeo.arm, zmat.skin, -0.3, 1.38, 0, 0.29, 'armL'); limb(zgeo.arm, zmat.skin, 0.3, 1.38, 0, 0.29, 'armR');
    limb(zgeo.leg, zmat.pants, -0.11, 0.78, 0, 0.31, 'legL'); limb(zgeo.leg, zmat.pants, 0.11, 0.78, 0, 0.31, 'legR');
    z.limbs.armL.rotation.x = z.limbs.armR.rotation.x = -1.45;                              // arms stretched forward
    g.position.set(x, 0, z0); g.scale.y = 0.2; scene.add(g); zs.push(z);
    return z;
  }
  function startWave(now) {
    wave++; const me3 = body(); if (!me3) return;
    const n = Math.min(ZOMBIES.max, ZOMBIES.first + (wave - 1) * ZOMBIES.more);
    for (let tries = 0, made = 0; made < n && tries < 200; tries++) {
      const x = (Math.random() - 0.5) * (size[0] - 2), z0 = (Math.random() - 0.5) * (size[1] - 2);
      if (Math.hypot(x - me3.x, z0 - me3.z) < ZOMBIES.spawnMin || (floor && (floor.blocked(x, z0, 0.3) || !floor.route({x, z: z0}, me3)))) continue;
      buildZombie(x, z0, now); made++;
    }
  }
  function clearZombies() { for (const z of zs) scene.remove(z.root); zs.length = 0; }
  function restartZombies(now) { clearZombies(); wave = 0; kills = 0; nextWaveAt = now + 1.5; }
  function killZombie(z, now) { z.dead = true; z.deadAt = now; z.root.userData.noShot = true; kills++; nextWaveAt = now + ZOMBIES.pause; }
  function stepZombies(dt, now) {
    if (!zOn) return;
    const me3 = body();
    if (!me3 || !pov()) return;                                                            // they wait while you are not in the game
    if (alive && !zs.some(z => !z.dead) && now >= nextWaveAt) startWave(now);
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i], g = z.root, p = g.position;
      if (z.dead) {                                                                         // falls over, lies there a moment, goes
        const k = Math.min(1, (now - z.deadAt) / 0.5); g.rotation.x = -k * 1.5; p.y = -Math.max(0, now - z.deadAt - 2) * 0.5;
        if (now - z.deadAt > 3.2) { scene.remove(g); zs.splice(i, 1); }
        continue;
      }
      g.scale.y = Math.min(1, g.scale.y + dt * 1.5);                                        // rises from the floor
      const dist = Math.hypot(me3.x - p.x, me3.z - p.z);
      const moved = z.lastTarget ? Math.hypot(me3.x - z.lastTarget.x, me3.z - z.lastTarget.z) : 99;
      if (alive && (now - z.pathAt > 3 || (moved > 2 && now - z.pathAt > 0.8))) {
        z.pathAt = now + Math.random() * 0.3; z.lastTarget = {x: me3.x, z: me3.z};
        z.path = floor ? (floor.route({x: p.x, z: p.z}, {x: me3.x, z: me3.z}) || []) : [];
      }
      let wx = 0, wz = 0;
      if (alive && dist > ZOMBIES.reach) {
        while (z.path.length > 1 && Math.hypot(z.path[0].x - p.x, z.path[0].z - p.z) < 0.35) z.path.shift();
        const t = z.path[0] || me3, dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
        wx = dx / d * ZOMBIES.speed; wz = dz / d * ZOMBIES.speed;
      }
      const k = 1 - Math.exp(-5 * dt);                                                      // smooth: it speeds up and slows down, it does not jump
      z.vel.x += (wx - z.vel.x) * k; z.vel.z += (wz - z.vel.z) * k;
      p.x += z.vel.x * dt; p.z += z.vel.z * dt;
      const sp = Math.hypot(z.vel.x, z.vel.z);
      if (sp > 0.05) z.yaw += angDiff(z.yaw, Math.atan2(z.vel.x, z.vel.z)) * (1 - Math.exp(-8 * dt));
      else if (alive) z.yaw += angDiff(z.yaw, Math.atan2(me3.x - p.x, me3.z - p.z)) * (1 - Math.exp(-6 * dt));
      g.rotation.y = z.yaw; z.phase += sp * dt * 5.5;
      const sw = Math.sin(z.phase) * 0.6 * Math.min(1, sp);
      z.limbs.legL.rotation.x = sw; z.limbs.legR.rotation.x = -sw; z.limbs.armL.rotation.x = -1.45 + sw * 0.25; z.limbs.armR.rotation.x = -1.45 - sw * 0.25;
      if (alive && dist <= ZOMBIES.reach + 0.25 && now - z.bite > ZOMBIES.biteEvery && now - z.born > 0.8) { z.bite = now; hurt(ZOMBIES.bite, '🧟'); }
    }
    el.z.textContent = `🧟 ${wave} · ✔ ${kills} · ${zs.filter(z => !z.dead).length}`;
  }

  // input: a click that is not a drag shoots, 1 2 3 choose the weapon
  let down = null;
  root.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, true);
  root.addEventListener('click', e => {
    if (!on || e.target !== canvas || !pov()) return;
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    e.stopImmediatePropagation(); e.stopPropagation(); fire();
  }, true);
  document.addEventListener('keydown', e => {
    if (!on || !pov() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-3]$/.test(e.key) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    weapon = +e.key - 1; drawHud(); publish(); e.preventDefault();
  });

  return {
    active: () => on,
    /** switch the mode on or off (no argument: the other way) */
    toggle(next = !on) {
      if (next === on) return on;
      on = next; others.clear();
      if (on) { hp = RULES.hp; alive = true; weapon = 0; out = []; hud.style.display = ''; el.msg.textContent = ''; enterPov(); say(T().on); }      // the game is played in first person only
      else { hud.style.display = 'none'; clearPaint(); if (zOn) { zOn = false; clearZombies(); el.z.style.display = 'none'; } say(T().off); }
      drawHud(); publish();
      return on;
    },
    /** each frame */
    update(dt) {
      if (!on) return;
      const now = performance.now() / 1000;
      el.cross.style.display = pov() && alive ? 'block' : 'none';
      if (flashUntil && now > flashUntil) { flashUntil = 0; el.flash.classList.remove('o-on'); }
      if (!alive) {
        const left = Math.ceil(respawnAt - now);
        if (left <= 0) { hp = RULES.hp; alive = true; el.msg.textContent = ''; if (zOn) restartZombies(now); drawHud(); publish(); } else if (!zOn) el.msg.textContent = T().out(left);
      }
      stepZombies(dt, now);
      for (const t of tracers) if (t.line.visible && now > t.until) t.line.visible = false;
      for (const [n, o] of others) if (now - (o.at || now) > 8) { others.delete(n); drawHud(); }          // a friend who went quiet is gone
    },
    /** what a friend here says about their paintball (their `pb` in their position); null or off: they are not playing */
    receive(name, pb) {
      if (!on) return;
      if (!pb || !pb.on) { if (others.delete(name)) drawHud(); return; }
      let o = others.get(name);
      if (!o) { o = {hp: 100, w: 0, k: 0, seen: Math.max(0, ...(pb.shots || []).map(s => s.id))}; others.set(name, o); }   // what was shot before we met is not replayed
      o.hp = pb.hp; o.w = pb.w; o.k = pb.k; o.at = performance.now() / 1000;
      for (const s of pb.shots || []) if (s.id > o.seen) { o.seen = s.id; effect(s, name); }
      drawHud();
    },
    /** zombie mode on or off (on turns the paintball on too) */
    zombies(next = !zOn) {
      if (next === zOn) return zOn;
      if (next && !on) this.toggle(true);
      zOn = next; el.z.style.display = zOn ? 'block' : 'none';
      if (zOn) { restartZombies(performance.now() / 1000); say(T().zon); } else { clearZombies(); say(T().zoff); }
      return zOn;
    },
    zombiesOn: () => zOn,
    lockMessage: () => say(T().lock),
    snapshot: () => (on ? {on: true, hp: Math.round(hp), w: weapon, k: deaths, shots: out.slice(-RULES.shots)} : null),
    /** for tests */
    _state: () => ({on, pov: pov(), hp, alive, weapon, deaths, splats: world.count, figSplats: figSplats.length, others: [...others], zombies: zs.map(z => [z.root.position.x, z.root.position.z, z.hp, z.dead]), wave, kills}),
    _fire: () => fire(),
  };
}
