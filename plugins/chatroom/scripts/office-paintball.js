// Paintball and zombies. A mode you switch on from the "Altro" menu, played in first person only: a click shoots a ball of
// paint that flies and leaves a splash where it lands (on walls, furniture and figures) until you switch the mode off; you
// have HP; at 0 you are out for a few seconds. 1, 2, 3 change the weapon. Zombie mode adds waves of zombies that walk to you.
//
// Cost: everything that repeats is instanced (the paint, the balls, the zombies' limbs): a handful of draw calls whatever the
// number of splashes or zombies, no allocation per frame. The shots hit-scan (instant), the ball you see is only the show.
//
// With a friend in the same office your snapshot rides in your position (`pb`): playing, HP, weapon, your last shots, and
// the zombies if you run them. The other side draws your balls and splashes, takes the damage of the shots that hit it,
// and in zombie mode the zombies are the same for both: whoever started the mode simulates them and sends position, life
// and state; the other interpolates, and tells the owner which zombie it hit.
//
// The numbers to play with are the tables below.

export const WEAPONS = [
  {id: 'pistol',  it: 'Pistola',        en: 'Pistol',  pellets: 1, burst: 1, gap: 0,    damage: 20, spread: 0.004, range: 80, cooldown: 0.35, speed: 70, kick: 0.5, mag: 12},
  {id: 'smg',     it: 'Mitra',          en: 'SMG',     pellets: 1, burst: 4, gap: 0.07, damage: 8,  spread: 0.025, range: 70, cooldown: 0.7,  speed: 65, kick: 0.25, mag: 32},
  {id: 'shotgun', it: 'Fucile a pompa', en: 'Shotgun', pellets: 5, burst: 1, gap: 0,    damage: 12, spread: 0.11,  range: 9,  cooldown: 1.0,  speed: 45, kick: 1.0, mag: 6},
];
export const RULES = {hp: 100, respawn: 3, splatsPerKind: 48, bolts: 64, shots: 12, recoil: 1.6, reload: 1.3};
/** zombie mode: they come in waves, walk to you along the real floor routes, bite when close; a headshot counts double */
export const ZOMBIES = {hp: 40, speed: 0.9, bite: 10, biteEvery: 1, reach: 1.15, first: 3, more: 2, max: 10, pause: 3, spawnMin: 7, safeAbove: 0.75, headMul: 2};
/** the zombie mood: how dark the room gets, the fog, how often the lights fail */
export const MOOD = {ambient: 0.62, sun: 0.36, lamps: 0.8, exposure: 0.95, fog: 0.032, flickerEvery: 2.4};
const MAXZ = 16;
const COLORS = ['#ff1744', '#ffea00', '#00e5ff', '#76ff03', '#e040fb', '#ff9100', '#2979ff', '#f50057'];
const TEXT = {
  it: {zon: '🧟 Zombie: sopravvivi alle ondate', lock: 'Spegni il paintball per uscire dalla prima persona', zoff: 'Zombie spenti', over: (w, k) => `Eliminato: ondata ${w}, zombie ${k}`, on: '🔫 Paintball acceso: clic per sparare, 1 2 3 per le armi', off: 'Paintball spento: le macchie sono sparite',
       hit: n => `Colpito da ${n}`, out: n => `Eliminato: rinasci tra ${n} s`, pov: 'Entra in prima persona (POV) per sparare', hp: 'HP', wave: 'ONDATA', kills: 'UCCISI', left: 'ZOMBIE', next: n => `Ondata ${n}`, coop: 'in squadra', reload: 'RICARICA', free: '∞', askTitle: n => `${n} ha avviato la modalità Zombie`, join: 'Partecipa in POV', watch: 'Guarda dall\'alto', watching: '👁 Guardi dall\'alto: nessuna interazione', stop: 'Partecipa'},
  en: {zon: '🧟 Zombies: survive the waves', lock: 'Switch paintball off to leave first person', zoff: 'Zombies off', over: (w, k) => `You are out: wave ${w}, ${k} zombies`, on: '🔫 Paintball on: click to shoot, 1 2 3 for weapons', off: 'Paintball off: the paint is gone',
       hit: n => `Hit by ${n}`, out: n => `You are out: back in ${n} s`, pov: 'Go first person (POV) to shoot', hp: 'HP', wave: 'WAVE', kills: 'KILLS', left: 'ZOMBIES', next: n => `Wave ${n}`, coop: 'as a team', reload: 'RELOAD', free: '∞', askTitle: n => `${n} started Zombie mode`, join: 'Join in first person', watch: 'Watch from above', watching: '👁 Watching from above: no interaction', stop: 'Join'},
};
const CSS = `
.o-pnt { position: absolute; inset: 0; pointer-events: none; z-index: 24; font: 700 14px "Segoe UI", system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px #000c; }
.o-pnt svg { display: block; shape-rendering: crispEdges; filter: drop-shadow(0 2px 2px #000a); }
.o-pnt .o-pnt-cross { position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; display: none; transition: transform .08s; }
.o-pnt .o-pnt-cross i { position: absolute; background: #fff; box-shadow: 0 0 0 1px #000, 0 0 4px #000; border-radius: 1px; }
.o-pnt .o-pnt-cross i:nth-child(1) { left: 16px; top: 0; width: 3px; height: 11px; } .o-pnt .o-pnt-cross i:nth-child(2) { left: 16px; bottom: 0; width: 3px; height: 11px; }
.o-pnt .o-pnt-cross i:nth-child(3) { top: 16px; left: 0; height: 3px; width: 11px; } .o-pnt .o-pnt-cross i:nth-child(4) { top: 16px; right: 0; height: 3px; width: 11px; }
.o-pnt .o-pnt-cross.o-fire { transform: scale(1.5); } .o-pnt .o-pnt-cross.o-hit i { background: #ff5252; }
.o-pnt .o-pnt-hpbox { position: absolute; left: 22px; bottom: 74px; display: flex; align-items: center; gap: 12px; }
.o-pnt .o-pnt-hpnum { font-size: 38px; line-height: 1; min-width: 78px; text-align: right; font-weight: 800; letter-spacing: .02em; }
.o-pnt .o-pnt-hpbar { position: relative; width: 250px; height: 22px; background: #0008; border: 2px solid #ffffffcc; border-radius: 4px; overflow: hidden; box-shadow: 0 2px 6px #0007; }
.o-pnt .o-pnt-hpbar i { display: block; height: 100%; width: 100%; background: #43a047; transition: width .2s, background .3s; }
.o-pnt .o-pnt-hpbar:after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 24px, #000a 24px 25px); }
.o-pnt .o-pnt-hpbox.o-low .o-pnt-hpnum { color: #ff5252; animation: o-pnt-pulse .7s infinite alternate; } @keyframes o-pnt-pulse { to { opacity: .55; } }
.o-pnt .o-pnt-gunbox { position: absolute; right: 22px; bottom: 74px; text-align: right; }
.o-pnt .o-pnt-slots { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }
.o-pnt .o-pnt-slot { position: relative; width: 62px; height: 40px; border-radius: 6px; background: #0007; border: 2px solid #ffffff44; display: flex; align-items: center; justify-content: center; opacity: .7; }
.o-pnt .o-pnt-slot b { position: absolute; left: 4px; top: 1px; font-size: 11px; opacity: .85; }
.o-pnt .o-pnt-slot.o-on { opacity: 1; border-color: #f5b400; background: #f5b40033; }
.o-pnt .o-pnt-gun { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
.o-pnt .o-pnt-gname { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .85; }
.o-pnt .o-pnt-ammo { font-size: 38px; line-height: 1; font-weight: 800; } .o-pnt .o-pnt-ammo small { font-size: 18px; opacity: .65; margin-left: 4px; }
.o-pnt .o-pnt-ammo.o-empty { color: #ff5252; }
.o-pnt .o-pnt-others { position: absolute; right: 12px; top: 56px; min-width: 150px; padding: 6px 10px; border-radius: 10px; background: #14151dcc; }
.o-pnt .o-pnt-others div { margin: 3px 0; } .o-pnt .o-pnt-others .o-pnt-bar { height: 6px; margin: 2px 0 0; border-radius: 3px; background: #333; overflow: hidden; } .o-pnt .o-pnt-others .o-pnt-bar i { display: block; height: 100%; }
.o-pnt .o-pnt-z { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: none; gap: 26px; align-items: center; white-space: nowrap; }
.o-pnt .o-pnt-z div { display: flex; align-items: center; gap: 8px; } .o-pnt .o-pnt-z .o-big { font-size: 30px; font-weight: 800; line-height: 1; } .o-pnt .o-pnt-z small { display: block; font-size: 10px; letter-spacing: .14em; opacity: .75; }
.o-pnt .o-pnt-flash { position: absolute; inset: 0; background: radial-gradient(transparent 55%, #e5393590); opacity: 0; transition: opacity .5s; }
.o-pnt .o-pnt-flash.o-on { opacity: 1; transition: none; }
.o-pnt .o-pnt-vig { position: absolute; inset: 0; background: radial-gradient(transparent 45%, #00000075); opacity: 0; transition: opacity 1.2s; }
.o-pnt .o-pnt-vig.o-on { opacity: 1; } .o-pnt .o-pnt-vig.o-near { background: radial-gradient(transparent 45%, #4a0a0a66); }
.o-pnt.o-watch .o-pnt-hpbox, .o-pnt.o-watch .o-pnt-gunbox, .o-pnt.o-watch .o-pnt-cross, .o-pnt.o-watch .o-pnt-others { display: none !important; }
.o-pnt .o-pnt-wbadge { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%); display: none; pointer-events: auto; padding: 8px 14px; border-radius: 10px; background: #14151dcc; border: 1px solid #f5b400; white-space: nowrap; }
.o-pnt.o-watch .o-pnt-wbadge { display: flex; gap: 14px; align-items: center; } .o-pnt .o-pnt-wbadge button, .o-pnt-ask button { font: inherit; color: #fff; background: #f5b40033; border: 1px solid #f5b400; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.o-pnt-ask { position: absolute; left: 50%; top: 74px; transform: translateX(-50%); z-index: 26; padding: 10px 16px; border-radius: 12px; background: #14151de6; border: 1px solid #f5b400; font: 700 14px "Segoe UI", system-ui, sans-serif; color: #fff; text-align: center; box-shadow: 0 8px 22px #0008; }
.o-pnt-ask div + div { margin-top: 8px; display: flex; gap: 10px; justify-content: center; }
.o-pnt .o-pnt-msg { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-size: 26px; text-shadow: 0 2px 8px #000; text-align: center; }
`;
const PAL = {b: '#c9ced6', g: '#8b929c', d: '#4a525c', k: '#2b2f36', h: '#8d6e63', r: '#ff5252', m: '#42a5f5', w: '#ffffff', y: '#ffd54f', G: '#7fc36a', e: '#d32f2f', s: '#e8e8e8'};
/** a small pixel-art picture from rows of letters (see PAL); '.' is empty */
function pix(rows, scale) {
  const rects = []; rows.forEach((row, y) => { for (let x = 0; x < row.length;) { const c = row[x]; if (c === '.') { x++; continue; } let n = 1; while (row[x + n] === c) n++; rects.push(`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${PAL[c]}"/>`); x += n; } });
  return `<svg width="${rows[0].length * scale}" height="${rows.length * scale}" viewBox="0 0 ${rows[0].length} ${rows.length}">${rects.join('')}</svg>`;
}
const ICONS = {
  pistol: ['.......rrr......', '.bbbbbbbbbbbbb..', '.bbbbbbbbbbbbgg.', '.dddddddddddg...', '.ddddddddd......', '..hhh.dd........', '..hhh...........', '..hhh...........'],
  smg: ['.......mmmm.......', '.......mmmm.......', '.bbbbbbbbbbbbbbgg.', 'kbbbbbbbbbbbbbbggg', 'kddddddddddddg....', 'kk.hh..kk.........', '...hh..kk.........', '...hh..kk.........'],
  shotgun: ['..rrr.............', '..rrr.............', '.dddgggggggggggggg', 'hddddbbbbbbbbbbbbb', 'hhdd..hhhh........', 'hhh...............'],
  heart: ['.rr...rr.', 'rrrrr.rrr'.replace('.', 'r'), 'rrrrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'],
  skull: ['..ssss..', '.ssssss.', 'ss.ss.ss', 'ssssssss', '.ssssss.', '..s..s..', '..ssss..', '..s.s.s.'],
  zombie: ['.GGGGGG.', 'GGGGGGGG', 'GeeGGeeG', 'GGGGGGGG', 'GGdddGGG', 'GGGGGGGG', '.GGGGGG.', '..G..G..'],
  wave: ['y.y.y.y.', '.y.y.y.y', 'y.y.y.y.', '.y.y.y.y'],
};
ICONS.heart = ['.rr...rr.', 'rrrr.rrrr', 'rrrrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'];

const hashName = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// ------------------------------------------------------------------ sound (small synths, made when first needed)
let actx = null, noiseBuf = null;
function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
function noise(c) {
  if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate >> 1, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}
/** one short sound: a tone sliding from f0 to f1 and/or a burst of noise, panned left/right and quieter with distance */
function blip({f0 = 0, f1 = 0, type = 'sine', dur = 0.1, gain = 0.2, nz = 0, nzF = 1500, pan = 0, vib = 0}) {
  const c = ac(); if (!c || gain < 0.002) return;
  const t = c.currentTime, out = c.createGain(); out.gain.setValueAtTime(gain, t); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = out;
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); out.connect(p); p.connect(c.destination); node = out; } else out.connect(c.destination);
  if (f0) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 || f0), t + dur);
            if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 6; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
            o.connect(node); o.start(t); o.stop(t + dur); }
  if (nz) { const s = c.createBufferSource(); s.buffer = noise(c); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = nzF; const g = c.createGain(); g.gain.value = nz;
            s.connect(f); f.connect(g); g.connect(node); s.start(t); s.stop(t + dur); }
}
const SFX = {
  shot: (w, pan) => { blip({f0: 260 - w * 40, f1: 70, type: 'triangle', dur: 0.09, gain: 0.16, nz: 0.5, nzF: 2400 - w * 600, pan}); if (w === 2) blip({f0: 120, f1: 45, type: 'sawtooth', dur: 0.18, gain: 0.14, pan}); },
  splat: (pan, g) => blip({dur: 0.09, gain: 0.12 * g, nz: 0.9, nzF: 900, pan}),
  tick: () => blip({f0: 1500, f1: 900, type: 'square', dur: 0.05, gain: 0.07}),
  groan: (pan, g) => blip({f0: 85 + Math.random() * 25, f1: 55, type: 'sawtooth', dur: 0.9, gain: 0.11 * g, nz: 0.25, nzF: 250, pan, vib: 14}),
  zhit: (pan, g) => blip({f0: 140, f1: 70, type: 'sawtooth', dur: 0.16, gain: 0.12 * g, nz: 0.4, nzF: 500, pan}),
  zdie: (pan, g) => blip({f0: 110, f1: 28, type: 'sawtooth', dur: 0.7, gain: 0.14 * g, nz: 0.3, nzF: 300, pan, vib: 6}),
  hurt: () => blip({f0: 90, f1: 40, type: 'sine', dur: 0.25, gain: 0.3, nz: 0.5, nzF: 400}),
  bite: () => blip({f0: 200, f1: 80, type: 'sawtooth', dur: 0.12, gain: 0.18, nz: 0.6, nzF: 800}),
};

// ------------------------------------------------------------------ small geometry helper: voxel boxes with a colour each
function boxGeo(THREE, boxes) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const [w, h, d, x, y, z, hex] of boxes) {
    c.set(hex); const hs = [w / 2, h / 2, d / 2], ctr = [x, y, z];
    for (let ax = 0; ax < 3; ax++) for (const sgn of [1, -1]) {
      const t1 = (ax + 1) % 3, t2 = (ax + 2) % 3, shade = ax === 1 ? (sgn > 0 ? 1 : 0.55) : ax === 2 ? (sgn > 0 ? 0.85 : 0.7) : (sgn > 0 ? 0.8 : 0.65);
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]], order = sgn > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];    // counter-clockwise seen from outside
      for (const k of order) {
        const v = [0, 0, 0]; v[ax] = ctr[ax] + sgn * hs[ax]; v[t1] = ctr[t1] + quad[k][0] * hs[t1]; v[t2] = ctr[t2] + quad[k][1] * hs[t2];
        pos.push(v[0], v[1], v[2]); const n = [0, 0, 0]; n[ax] = sgn; nor.push(n[0], n[1], n[2]); col.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
const SKIN = '#9fc29a', SKIN2 = '#86a881', SHIRT = '#7a7468', SHIRT2 = '#524d44', PANTS = '#4a5d68', DARK = '#1a1a1a', WOUND = '#7a1f1f';
const ZGEO = {   // the zombie's rigid pieces, each hanging from its own pivot (the origin), +Z is the way it faces
  torso: [[0.40, 0.20, 0.22, 0, 0, 0, PANTS], [0.44, 0.50, 0.25, 0, 0.36, 0, SHIRT], [0.58, 0.10, 0.23, 0, 0.60, 0, SHIRT2], [0.42, 0.05, 0.235, 0, 0.11, 0, DARK],
          [0.14, 0.14, 0.02, 0.10, 0.28, 0.135, SKIN2], [0.10, 0.16, 0.02, -0.12, 0.46, 0.135, SKIN], [0.20, 0.07, 0.02, 0.02, 0.18, 0.135, SHIRT2], [0.09, 0.09, 0.02, -0.13, 0.22, 0.135, WOUND], [0.10, 0.10, 0.10, 0, 0.68, 0, SKIN2]],
  head: [[0.30, 0.30, 0.30, 0, 0.15, 0, SKIN], [0.32, 0.07, 0.32, 0, 0.31, 0, '#262018'], [0.12, 0.10, 0.12, -0.08, 0.34, -0.06, '#262018'], [0.20, 0.035, 0.02, 0, 0.055, 0.153, '#2a1010'], [0.05, 0.07, 0.04, 0, 0.13, 0.16, SKIN2],
         [0.07, 0.07, 0.02, -0.09, 0.24, 0.152, WOUND], [0.04, 0.09, 0.07, -0.16, 0.14, 0, SKIN2], [0.04, 0.09, 0.07, 0.16, 0.14, 0, SKIN2]],
  eyes: [[0.07, 0.045, 0.03, -0.07, 0.17, 0.155, '#ff3030'], [0.07, 0.045, 0.03, 0.07, 0.17, 0.155, '#ff3030']],
  uparm: [[0.15, 0.30, 0.15, 0, -0.15, 0, SKIN], [0.17, 0.13, 0.17, 0, -0.065, 0, SHIRT]],
  forearm: [[0.14, 0.27, 0.14, 0, -0.135, 0, SKIN], [0.12, 0.11, 0.11, 0, -0.31, 0, SKIN2], [0.15, 0.06, 0.15, 0, -0.02, 0, SHIRT2]],
  thigh: [[0.15, 0.40, 0.16, 0, -0.20, 0, PANTS], [0.08, 0.10, 0.02, 0.02, -0.14, 0.085, SKIN2]],
  shin: [[0.13, 0.38, 0.14, 0, -0.19, 0, '#3a4650'], [0.15, 0.07, 0.26, 0, -0.405, 0.05, DARK]],
};

// finer voxels (about 4-5 cm) on top of the big pieces: ribs, torn strips, buttons, teeth, fingers, bandages, laces
const BONE = '#d8dccf', BLOOD = '#5a1515', BTN = '#d0c9b8', TEETH = '#d8d2b0', BAND = '#c9c2b0';
ZGEO.torso.push(...[0, 1, 2, 3].map(i => [0.14, 0.025, 0.02, -0.10, 0.20 + 0.055 * i, 0.136, BONE]), [0.03, 0.30, 0.02, -0.10, 0.34, 0.133, '#9aa391'],
  [0.05, 0.14, 0.02, -0.15, 0.03, 0.14, SHIRT], [0.05, 0.10, 0.02, -0.02, 0.02, 0.14, SHIRT], [0.05, 0.17, 0.02, 0.11, 0.04, 0.14, SHIRT2], [0.08, 0.12, 0.02, 0.12, 0.44, 0.137, BLOOD], [0.06, 0.05, 0.02, 0.06, 0.52, 0.137, BLOOD],
  ...[0, 1, 2].map(i => [0.025, 0.025, 0.02, 0.0, 0.52 - 0.12 * i, 0.137, BTN]), [0.22, 0.06, 0.20, 0, 0.67, 0, SHIRT2], [0.46, 0.05, 0.15, 0, 0.05, -0.02, '#2b3a42'],
  [0.40, 0.45, 0.02, 0, 0.36, -0.136, SHIRT2], [0.12, 0.10, 0.02, 0.06, 0.40, -0.14, BLOOD]);
ZGEO.head.push([0.10, 0.07, 0.02, -0.07, 0.17, 0.151, '#1a2a1a'], [0.10, 0.07, 0.02, 0.07, 0.17, 0.151, '#1a2a1a'], ...[-2, -1, 0, 1, 2].map(i => [0.025, 0.03, 0.02, i * 0.04, 0.052, 0.156, TEETH]),
  [0.05, 0.03, 0.02, 0.07, 0.09, 0.152, WOUND], [0.06, 0.08, 0.06, 0.10, 0.34, 0.04, '#262018'], [0.05, 0.10, 0.05, -0.02, 0.35, 0.10, '#262018'], [0.04, 0.06, 0.04, 0.12, 0.33, -0.10, '#262018'],
  [0.03, 0.02, 0.02, 0, 0.115, 0.172, '#4a6a46'], [0.10, 0.025, 0.02, 0, 0.21, 0.152, SKIN2]);
ZGEO.forearm.push(...[-0.03, 0, 0.03].map(x => [0.025, 0.075, 0.03, x, -0.355, 0.0, SKIN2]), [0.12, 0.03, 0.12, 0, -0.10, 0, BAND], [0.12, 0.025, 0.12, 0, -0.17, 0, BAND], [0.05, 0.03, 0.02, 0.03, -0.22, 0.056, WOUND]);
ZGEO.uparm.push([0.05, 0.05, 0.14, -0.04, -0.14, 0, SHIRT2], [0.04, 0.06, 0.02, 0.03, -0.25, 0.06, WOUND], [0.14, 0.03, 0.14, 0, -0.01, 0, SHIRT2]);
ZGEO.thigh.push([0.12, 0.08, 0.02, 0, -0.36, 0.085, '#2d3c44'], ...[-0.05, 0, 0.05].map(x => [0.04, 0.05, 0.17, x, -0.405, 0, '#334651']), [0.04, 0.12, 0.02, -0.04, -0.12, 0.085, BLOOD]);
ZGEO.shin.push([0.135, 0.05, 0.145, 0, -0.32, 0, '#8a8a82'], [0.06, 0.02, 0.02, 0, -0.40, 0.185, '#e0e0d8'], [0.16, 0.025, 0.27, 0, -0.435, 0.05, '#101010'], [0.04, 0.04, 0.02, 0.04, -0.10, 0.072, WOUND]);

export function createPaintball({THREE, scene, camera, canvas, root, pov, me, players, sink, lang = () => 'it', say = () => {}, body = () => null, floor = null, size = [30, 20], enterPov = () => {}, renderer = null, atmosphere = {}, aim = () => true}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const hud = document.createElement('div'); hud.className = 'o-pnt'; hud.style.display = 'none';
  hud.innerHTML = `<div class="o-pnt-vig"></div><div class="o-pnt-flash"></div><div class="o-pnt-cross"><i></i><i></i><i></i><i></i></div><div class="o-pnt-others"></div><div class="o-pnt-z"></div>
    <div class="o-pnt-hpbox"><span class="o-pnt-heart"></span><div class="o-pnt-hpnum"></div><div class="o-pnt-hpbar"><i></i></div></div>
    <div class="o-pnt-gunbox"><div class="o-pnt-slots"></div><div class="o-pnt-gun"><div><div class="o-pnt-gname"></div><div class="o-pnt-ammo"></div></div><span class="o-pnt-gicon"></span></div></div><div class="o-pnt-msg"></div><div class="o-pnt-wbadge"><span></span><button></button></div>`;
  root.appendChild(hud);
  const el = {vig: hud.querySelector('.o-pnt-vig'), flash: hud.querySelector('.o-pnt-flash'), cross: hud.querySelector('.o-pnt-cross'), others: hud.querySelector('.o-pnt-others'), z: hud.querySelector('.o-pnt-z'),
              hpbox: hud.querySelector('.o-pnt-hpbox'), heart: hud.querySelector('.o-pnt-heart'), hpnum: hud.querySelector('.o-pnt-hpnum'), bar: hud.querySelector('.o-pnt-hpbar i'), slots: hud.querySelector('.o-pnt-slots'),
              gname: hud.querySelector('.o-pnt-gname'), ammo: hud.querySelector('.o-pnt-ammo'), gicon: hud.querySelector('.o-pnt-gicon'), msg: hud.querySelector('.o-pnt-msg')};
  el.heart.innerHTML = pix(ICONS.heart, 4);
  // a friend started the zombie mode while I am not playing: join in first person, or watch from above (nothing to touch, no HP)
  let watch = false, watchOf = null, askFor = null; const refused = new Map();
  const ask = document.createElement('div'); ask.className = 'o-pnt-ask'; ask.style.display = 'none'; ask.innerHTML = '<div class="o-pnt-ask-t"></div><div><button data-a="join"></button><button data-a="watch"></button></div>'; root.appendChild(ask);
  const wbadge = hud.querySelector('.o-pnt-wbadge');
  const T = () => TEXT[lang()] || TEXT.it;

  // scratch objects: nothing is allocated per frame
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, Q = THREE.Quaternion, E = THREE.Euler, Col = THREE.Color;
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _o = new V3(), _r = new V3(), _u = new V3(), _n = new V3(), _s = new V3(), _one = new V3(1, 1, 1);
  const _mA = new M4(), _mB = new M4(), _mC = new M4(), _mD = new M4(), _mR = new M4(), _mT = new M4(), _mH = new M4();
  const _q = new Q(), _eu = new E(), _col = new Col(), _col2 = new Col();
  const ray = new THREE.Raycaster();
  const rnd = () => Math.random();

  // ---------------------------------------------------------------- the paint on surfaces: four splash shapes, each one instanced mesh
  function splashTexture(seed) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    let s = seed * 7919 + 13; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    g.beginPath(); const n = 22, base = 25 + R() * 6;
    for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, r = base * (0.75 + R() * 0.55) * (i % 2 ? 1.12 : 0.92), x = 64 + Math.cos(a) * r, y = 56 + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill();
    for (let i = 0; i < 9; i++) { const a = R() * 6.283, d = base + 4 + R() * 24, r = 1.5 + R() * 5; g.beginPath(); g.arc(64 + Math.cos(a) * d, 56 + Math.sin(a) * d, r, 0, 7); g.fill(); }
    for (let i = 0; i < 3; i++) { const x = 64 + (R() - 0.5) * base * 1.3, len = 18 + R() * 34; g.lineWidth = 3 + R() * 4; g.beginPath(); g.moveTo(x, 62); g.lineTo(x + (R() - 0.5) * 4, 62 + len); g.stroke(); g.beginPath(); g.arc(x, 64 + len, g.lineWidth * 0.9, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const flat = (map, extra = {}) => new THREE.MeshBasicMaterial({map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, ...extra});
  const KINDS = 4, splashes = [];
  for (let k = 0; k < KINDS; k++) {
    const m = new THREE.InstancedMesh(planeGeo, flat(splashTexture(k + 1)), RULES.splatsPerKind);
    m.count = 0; m.frustumCulled = false; m.renderOrder = 3; m.userData.noShot = true; m.raycast = () => {}; m.visible = false; scene.add(m);
    splashes.push({mesh: m, placed: 0});
  }
  const stainMat = flat(splashes[0].mesh.material.map, {side: THREE.DoubleSide});
  const figSplats = [];
  /** a splash on a surface: `n` the surface normal, texture "up" follows gravity on walls */
  function splat(point, normal, ci, scale = 1) {
    const sp = splashes[(rnd() * KINDS) | 0], i = sp.placed % RULES.splatsPerKind; sp.placed++; sp.mesh.count = Math.min(RULES.splatsPerKind, sp.placed);
    _n.copy(normal).normalize();
    if (Math.abs(_n.y) > 0.9) _u.set(rnd() - 0.5, 0, rnd() - 0.5).normalize(); else _u.set(0, 1, 0);
    _r.crossVectors(_u, _n).normalize(); _u.crossVectors(_n, _r).normalize();
    const size = (0.34 + rnd() * 0.26) * scale;
    _mA.makeBasis(_r.multiplyScalar(size), _u.multiplyScalar(size), _n); _mA.setPosition(_a.copy(point).addScaledVector(_n, 0.012));
    sp.mesh.setMatrixAt(i, _mA); sp.mesh.setColorAt(i, _col.set(COLORS[ci])); sp.mesh.instanceMatrix.needsUpdate = true; sp.mesh.instanceColor.needsUpdate = true;
  }
  function figureSplat(top, point, normal, ci) {                                           // on a figure: it carries the paint when it moves
    const m = new THREE.Mesh(planeGeo, flat(splashes[0].mesh.material.map, {color: COLORS[ci]}));
    const sz = 0.12 + rnd() * 0.1; _n.copy(normal).applyQuaternion(top.getWorldQuaternion(_q).invert()).normalize();
    m.position.copy(top.worldToLocal(_a.copy(point))).addScaledVector(_n, 0.012); m.quaternion.setFromUnitVectors(new V3(0, 0, 1), _n); m.scale.set(sz, sz, 1);
    m.userData.noShot = true; m.raycast = () => {}; top.add(m); figSplats.push({top, m});
    if (figSplats.length > 60) { const o = figSplats.shift(); o.top.remove(o.m); o.m.material.dispose(); }
  }
  function clearPaint() {
    for (const sp of splashes) { sp.mesh.count = 0; sp.placed = 0; sp.mesh.visible = false; }
    for (const o of figSplats) { o.top.remove(o.m); o.m.material.dispose(); }
    figSplats.length = 0;
  }

  // ---------------------------------------------------------------- the balls in flight: instanced balls and trails, a pool of structs
  const ballGeo = new THREE.SphereGeometry(0.05, 7, 5), trailGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
  const balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshBasicMaterial({toneMapped: false}), RULES.bolts);
  const trails = new THREE.InstancedMesh(trailGeo, new THREE.MeshBasicMaterial({toneMapped: false, transparent: true, opacity: 0.55}), RULES.bolts);
  for (const m of [balls, trails]) { m.count = 0; m.frustumCulled = false; m.userData.noShot = true; m.raycast = () => {}; m.visible = false; scene.add(m); }
  const bolts = Array.from({length: RULES.bolts}, () => ({live: false, p: new V3(), dir: new V3(), left: 0, speed: 60, ci: 0, kind: 0, hp: new V3(), hn: new V3(), top: null, zi: -1, dmg: 0, head: false, friend: null, mine: false}));
  let boltN = 0;
  function launch(from, to, ci, speed, kind, normal, extra) {            // kind: 0 nothing, 1 world splash, 2 figure splash, 3 zombie hit
    let b = null; for (let i = 0; i < bolts.length; i++) { const x = bolts[(boltN + i) % bolts.length]; if (!x.live) { b = x; boltN = (boltN + i + 1) % bolts.length; break; } }
    if (!b) return;
    b.live = true; b.p.copy(from); b.dir.copy(to).sub(from); b.left = b.dir.length(); b.dir.multiplyScalar(1 / (b.left || 1)); b.speed = speed; b.ci = ci; b.kind = kind;
    b.hp.copy(to); if (normal) b.hn.copy(normal); b.top = extra?.top || null; b.zi = extra?.zi ?? -1; b.dmg = extra?.dmg || 0; b.head = !!extra?.head; b.friend = extra?.friend || null; b.mine = !!extra?.mine;
  }
  function arrive(b) {
    if (b.kind === 1) { splat(b.hp, b.hn, b.ci); SFX.splat(panOf(b.hp), 1 / (1 + distTo(b.hp) * 0.08)); }
    else if (b.kind === 2 && b.top) { figureSplat(b.top, b.hp, b.hn, b.ci); SFX.splat(panOf(b.hp), 1 / (1 + distTo(b.hp) * 0.08)); }
    else if (b.kind === 3) { hitZombie(b.zi, b.hp, b.ci, b.dmg, b.head, b.mine); }
  }
  function stepBalls(dt) {
    let n = 0;
    for (const b of bolts) {
      if (!b.live) continue;
      const step = Math.min(b.left, b.speed * dt); b.p.addScaledVector(b.dir, step); b.left -= step;
      if (b.left <= 0.001) { b.live = false; arrive(b); continue; }
      _mA.makeTranslation(b.p.x, b.p.y, b.p.z); balls.setMatrixAt(n, _mA); balls.setColorAt(n, _col.set(COLORS[b.ci]));
      const len = Math.min(0.9, b.left + 0.2, 0.4 + b.speed * 0.012); _a.copy(b.p).addScaledVector(b.dir, -len / 2); _q.setFromUnitVectors(_b.set(0, 0, 1), b.dir);
      _mB.compose(_a, _q, _s.set(1, 1, len)); trails.setMatrixAt(n, _mB); trails.setColorAt(n, _col);
      n++;
    }
    balls.count = trails.count = n; balls.instanceMatrix.needsUpdate = trails.instanceMatrix.needsUpdate = true;
    if (n) { balls.instanceColor.needsUpdate = trails.instanceColor.needsUpdate = true; }
  }
  const distTo = p => camera.getWorldPosition(_d).distanceTo(p);
  const panOf = p => { camera.getWorldPosition(_d); _r.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q)); return clamp(_c.copy(p).sub(_d).normalize().dot(_r) * 0.9, -1, 1); };

  // ---------------------------------------------------------------- the gun you hold: a voxel model on the camera, with a kick and a flash
  const gunMat = new THREE.MeshLambertMaterial({vertexColors: true, depthTest: false}), flashMat = new THREE.MeshBasicMaterial({color: '#fff3b0', transparent: true, opacity: 0.95, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false});
  const gunBoxesOld = [
    [[0.05, 0.09, 0.20, 0, 0, 0, '#2b2f36'], [0.045, 0.11, 0.06, 0, -0.08, 0.05, '#1c1f24'], [0.07, 0.07, 0.07, 0, 0.075, -0.02, '#e53935'], [0.03, 0.03, 0.10, 0, 0.01, -0.14, '#4a4f58']],
    [[0.06, 0.10, 0.34, 0, 0, 0, '#2b2f36'], [0.05, 0.16, 0.06, 0, -0.12, 0.04, '#1c1f24'], [0.04, 0.12, 0.05, 0, -0.07, 0.13, '#1c1f24'], [0.08, 0.08, 0.08, 0, 0.09, -0.03, '#1e88e5'], [0.03, 0.03, 0.18, 0, 0.01, -0.24, '#4a4f58']],
    [[0.06, 0.07, 0.55, 0, 0, 0, '#3a2f26'], [0.05, 0.05, 0.50, 0, 0.065, -0.02, '#4a4f58'], [0.07, 0.065, 0.16, 0, -0.05, -0.14, '#6d4c41'], [0.06, 0.12, 0.14, 0, -0.05, 0.30, '#6d4c41'], [0.08, 0.08, 0.08, 0, 0.12, 0.0, '#e53935']],
  ];
  const gunBoxes = [
    [[0.05, 0.05, 0.22, 0, 0.03, 0, '#c9ced6'], [0.045, 0.045, 0.06, 0, 0.03, -0.14, '#8b929c'], [0.05, 0.05, 0.18, 0, -0.02, 0.02, '#4a525c'], [0.045, 0.1, 0.05, 0, -0.08, 0.07, '#8d6e63'], [0.06, 0.04, 0.06, 0, 0.075, -0.02, '#ff5252'], [0.015, 0.02, 0.015, 0, 0.065, -0.1, '#ffffff']],
    [[0.06, 0.07, 0.36, 0, 0.0, 0, '#c9ced6'], [0.05, 0.05, 0.12, 0, 0.0, -0.22, '#8b929c'], [0.055, 0.05, 0.30, 0, -0.05, 0.02, '#4a525c'], [0.04, 0.14, 0.05, 0, -0.12, 0.03, '#2b2f36'], [0.045, 0.1, 0.05, 0, -0.08, 0.14, '#8d6e63'], [0.07, 0.06, 0.08, 0, 0.065, -0.02, '#42a5f5']],
    [[0.055, 0.055, 0.60, 0, 0.0, 0, '#8b929c'], [0.07, 0.06, 0.20, 0, -0.045, -0.12, '#8d6e63'], [0.06, 0.07, 0.24, 0, -0.01, 0.12, '#4a525c'], [0.05, 0.1, 0.16, 0, -0.04, 0.32, '#8d6e63'], [0.07, 0.05, 0.08, 0, 0.055, 0.04, '#ff5252']],
  ];
  const guns = gunBoxes.map(b => { const m = new THREE.Mesh(boxGeo(THREE, b), gunMat); m.scale.setScalar(0.8); m.rotation.y = 0.1; m.renderOrder = 998; m.visible = false; m.frustumCulled = false; m.userData.noShot = true; camera.add(m); return m; });
  const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat); muzzle.renderOrder = 999; muzzle.visible = false; muzzle.frustumCulled = false; muzzle.userData.noShot = true; camera.add(muzzle);
  const GUNPOS = [[0.19, -0.19, -0.52], [0.20, -0.19, -0.55], [0.19, -0.18, -0.6]], TIP = [-0.1, -0.28, -0.7];
  let kick = 0, flashUntil = 0;

  // ---------------------------------------------------------------- the zombies: seven instanced meshes, whatever their number
  const zmat = new THREE.MeshLambertMaterial({vertexColors: true, emissive: '#33523a', emissiveIntensity: 1.15, fog: false}), eyeMat = new THREE.MeshBasicMaterial({color: '#ff3030', toneMapped: false, fog: false});
  const PARTS = {};
  for (const [name, cap] of [['torso', 1], ['head', 1], ['eyes', 1], ['uparm', 2], ['forearm', 2], ['thigh', 2], ['shin', 2]]) {
    const m = new THREE.InstancedMesh(boxGeo(THREE, ZGEO[name]), name === 'eyes' ? eyeMat : zmat, MAXZ * cap);
    m.count = 0; m.frustumCulled = false; m.userData.noShot = true; m.raycast = () => {}; m.castShadow = name !== 'eyes' && name !== 'head'; m.visible = false; scene.add(m); PARTS[name] = {mesh: m, per: cap};
  }
  const stains = new THREE.InstancedMesh(planeGeo, stainMat, MAXZ * 6); stains.count = 0; stains.frustumCulled = false; stains.userData.noShot = true; stains.raycast = () => {}; stains.visible = false; scene.add(stains);
  const PART_LIST = Object.values(PARTS), PART_NAMES = Object.keys(PARTS);
  const zs = []; let zOn = false, wave = 0, kills = 0, nextWaveAt = 0, zid = 0, zStart = 0, lastGroan = 0, owner = true, zHtml = '';
  const TINTS = ['#ffffff', '#e8f0dc', '#f2e4d4', '#dfe8f0'].map(h => new Col(h)), FLASH = new Col('#ff6a6a');
  function newZombie(x, z0, id, now) {
    const z = {id, x, z: z0, yaw: rnd() * 6.28, vx: 0, vz: 0, phase: rnd() * 6.28, hp: ZOMBIES.hp, state: 'rise', born: now, deadAt: 0, bite: 0, path: [], pathAt: -9, lastT: null, flash: 0, stagger: 0, tint: (rnd() * TINTS.length) | 0,
               limp: 0.65 + rnd() * 0.5, nStains: 0, st: new Float32Array(6 * 4), tx: x, tz: z0, scale: 0.2, sink: 0, ragdoll: 0, fall: 0};
    return z;
  }
  const shortAng = (a, b, k) => a + angDiff(a, b) * k;
  /** a local pose matrix: translate, then rotate XYZ */
  const loc = (out, px, py, pz, rx, ry, rz) => { _eu.set(rx, ry, rz, 'XYZ'); _q.setFromEuler(_eu); return out.compose(_a.set(px, py, pz), _q, _one); };
  function poseZombie(z, i, now) {
    const walk = z.state === 'walk' || z.state === 'rise', sp = Math.hypot(z.vx, z.vz), moving = clamp(sp / ZOMBIES.speed, 0, 1.3), ph = z.phase;
    const dead = z.state === 'dead', k = dead ? clamp((now - z.deadAt) / 0.55, 0, 1) : 0;
    // the root: place, turn, and a fall onto the back when dead (it slides a little, then sinks and shrinks)
    _eu.set(-k * 1.45, z.yaw, 0, 'YXZ'); _q.setFromEuler(_eu);
    const dis = dead ? clamp((now - z.deadAt - 1.6) / 1.2, 0, 1) : 0, sc = z.scale * (1 - dis * 0.9);
    _mR.compose(_a.set(z.x, -dis * 0.35 + (dead ? 0.18 * k : 0), z.z), _q, _s.set(sc, sc * (dead ? 1 : 1), sc));
    // the body sways: lean forward, roll with the steps, a hit throws it back
    const hit = z.stagger > 0 ? Math.min(1, z.stagger / 0.25) : 0;
    const lean = dead ? 0 : 0.16 + 0.05 * Math.sin(ph * 0.5) - hit * 0.45, roll = dead ? 0 : 0.08 * Math.sin(ph * 0.5 + 1) * moving;
    loc(_mA, 0, 0.88, 0, 0, 0, 0).premultiply(_mR);                                        // the hips
    loc(_mB, 0, 0, 0, lean, 0, roll).premultiply(_mA);                                     // the torso hangs from the hips
    const t = PARTS.torso.mesh; t.setMatrixAt(i, _mB);
    loc(_mC, 0, 0.66, 0, dead ? 0.3 : 0.1 * Math.sin(ph * 0.37) + hit * 0.5, 0.15 * Math.sin(ph * 0.29), 0.12 * Math.sin(ph * 0.43)).premultiply(_mB);
    PARTS.head.mesh.setMatrixAt(i, _mC); PARTS.eyes.mesh.setMatrixAt(i, _mC);
    for (let s = 0; s < 2; s++) {                                                          // arms stretched forward, swinging a little, the forearm bent up
      const sg = s ? 1 : -1, sw = dead ? 0 : 0.14 * Math.sin(ph + s * 2.2) * (0.5 + moving * 0.5);
      loc(_mD, sg * 0.30, 0.56, 0, dead ? -0.2 : -1.30 + sw - hit * 0.5, 0, -sg * 0.08).premultiply(_mB); PARTS.uparm.mesh.setMatrixAt(i * 2 + s, _mD);
      loc(_mT, 0, -0.30, 0, dead ? -0.3 : -0.32 - sw * 0.6, 0, 0).premultiply(_mD); PARTS.forearm.mesh.setMatrixAt(i * 2 + s, _mT);
    }
    for (let s = 0; s < 2; s++) {                                                          // legs: one drags
      const sg = s ? 1 : -1, amp = (s ? 0.40 : 0.62) * z.limp * moving, a = dead ? (s ? 0.25 : -0.1) : Math.sin(ph + s * Math.PI) * amp, bend = dead ? 0.3 : Math.max(0, -Math.sin(ph + s * Math.PI + 0.6)) * 0.7 * moving + 0.05;
      loc(_mD, sg * 0.11, 0, 0, a, 0, 0).premultiply(_mA); PARTS.thigh.mesh.setMatrixAt(i * 2 + s, _mD);
      loc(_mT, 0, -0.40, 0, bend, 0, 0).premultiply(_mD); PARTS.shin.mesh.setMatrixAt(i * 2 + s, _mT);
    }
    // one tint per zombie, a flash of red when it is hit
    if (z.flash > 0) _col.copy(FLASH).multiplyScalar(1 + z.flash * 3); else _col.copy(TINTS[z.tint]);
    for (let pi = 0; pi < PART_LIST.length; pi++) if (PART_NAMES[pi] !== 'eyes') { const p = PART_LIST[pi]; for (let s = 0; s < p.per; s++) p.mesh.setColorAt(i * p.per + s, _col); }
    // the paint on it: small splashes fixed to the zombie's own frame
    for (let q = 0; q < Math.min(z.nStains, 6); q++) {                                         // each stain: x, y, z on the torso (z = +-0.14 front or back), colour
      const o = q * 4; _eu.set(0, z.st[o + 2] < 0 ? Math.PI : 0, 0); _q.setFromEuler(_eu);
      _mH.compose(_a.set(z.st[o], z.st[o + 1], z.st[o + 2]), _q, _s.set(0.3, 0.3, 1)).premultiply(_mB);
      const idx = stains.count++; stains.setMatrixAt(idx, _mH); stains.setColorAt(idx, _col2.set(COLORS[z.st[o + 3] | 0]));
    }
  }
  function startWave(now) {
    wave++; const me3 = body(); if (!me3) return;
    const n = Math.min(ZOMBIES.max, ZOMBIES.first + (wave - 1) * ZOMBIES.more);
    for (let tries = 0, made = 0; made < n && tries < 220; tries++) {
      const x = (rnd() - 0.5) * (size[0] - 2), z0 = (rnd() - 0.5) * (size[1] - 2);
      if (Math.hypot(x - me3.x, z0 - me3.z) < ZOMBIES.spawnMin || (floor && (floor.blocked(x, z0, 0.3) || !floor.route({x, z: z0}, me3)))) continue;
      zs.push(newZombie(x, z0, ++zid, now)); made++;
    }
    if (n) { el.msg.textContent = T().next(wave); setTimeout(() => { if (alive) el.msg.textContent = ''; }, 1600); }
  }
  function clearZombies() { zs.length = 0; for (const p of PART_LIST) { p.mesh.count = 0; p.mesh.visible = false; } stains.count = 0; stains.visible = false; }
  const showZombies = () => { for (const p of PART_LIST) p.mesh.visible = true; stains.visible = true; };
  function restartZombies(now) { clearZombies(); wave = 0; kills = 0; nextWaveAt = now + 1.5; showZombies(); }
  function zombieAt(id) { for (const z of zs) if (z.id === id) return z; return null; }
  /** a hit on zombie `id`: knock it back, paint it, hurt it (the owner of the zombies applies the damage) */
  function hitZombie(id, point, ci, dmg, head, mine) {
    const z = zombieAt(id); if (!z || z.state === 'dead') return;
    z.flash = 1; z.stagger = 0.25;
    const o = (z.nStains++ % 6) * 4, dx = point.x - z.x, dz = point.z - z.z, c = Math.cos(z.yaw), sn = Math.sin(z.yaw), lz = dx * sn + dz * c;
    z.st[o] = clamp(dx * c - dz * sn, -0.25, 0.25); z.st[o + 1] = clamp(point.y - 0.88, 0.05, 0.62); z.st[o + 2] = lz < 0 ? -0.14 : 0.14; z.st[o + 3] = ci;
    SFX.zhit(panOf(point), 1 / (1 + distTo(point) * 0.08));
    if (owner) {
      z.hp -= dmg * (head ? ZOMBIES.headMul : 1);
      if (z.hp <= 0) killZombie(z, performance.now() / 1000);
    }                                                                                          // a follower only shows it: the owner takes the damage from the shot record
  }
  function killZombie(z, now) { z.state = 'dead'; z.deadAt = now; kills++; nextWaveAt = now + ZOMBIES.pause; SFX.zdie(panOf(_a.set(z.x, 1, z.z)), 1 / (1 + distTo(_a) * 0.08)); }
  function stepZombies(dt, now) {
    if (!zOn) return;
    const me3 = body();
    const live = !!(pov() && me3);
    for (let pi = 0; pi < PART_LIST.length; pi++) PART_LIST[pi].mesh.count = 0; stains.count = 0;
    if (live && owner) {
      if (alive && !zs.some(z => z.state !== 'dead') && now >= nextWaveAt) startWave(now);
      for (let i = zs.length - 1; i >= 0; i--) if (zs[i].state === 'dead' && now - zs[i].deadAt > 3.2) zs.splice(i, 1);
    } else if (!owner) {
      for (let i = zs.length - 1; i >= 0; i--) if (zs[i].state === 'dead' && now - zs[i].deadAt > 3.2) zs.splice(i, 1);
    }
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      z.flash = Math.max(0, z.flash - dt * 4); z.stagger = Math.max(0, z.stagger - dt);
      if (z.state === 'rise') { z.scale = Math.min(1, z.scale + dt * 1.6); if (z.scale >= 1) z.state = 'walk'; }
      if (z.state !== 'dead' && (live || !owner)) {
        if (owner) {
          const dist = Math.hypot(me3.x - z.x, me3.z - z.z), moved = z.lastT ? Math.hypot(me3.x - z.lastT.x, me3.z - z.lastT.z) : 99;
          if (alive && (now - z.pathAt > 3 || (moved > 2 && now - z.pathAt > 0.8))) {
            z.pathAt = now + rnd() * 0.3; if (!z.lastT) z.lastT = {x: 0, z: 0}; z.lastT.x = me3.x; z.lastT.z = me3.z; z.path = floor ? (floor.route({x: z.x, z: z.z}, {x: me3.x, z: me3.z}) || []) : [];
          }
          let wx = 0, wz = 0;
          if (alive && dist > ZOMBIES.reach && z.stagger <= 0) {
            while (z.path.length > 1 && Math.hypot(z.path[0].x - z.x, z.path[0].z - z.z) < 0.35) z.path.shift();
            const t = z.path[0] || me3, dx = t.x - z.x, dz = t.z - z.z, d = Math.hypot(dx, dz) || 1, sp = ZOMBIES.speed * (0.8 + 0.35 * Math.sin(z.phase * 0.5));   // it lurches
            wx = dx / d * sp; wz = dz / d * sp;
          }
          if (dist < 0.9 && dist > 1e-3) { wx -= (me3.x - z.x) / dist * 1.2; wz -= (me3.z - z.z) / dist * 1.2; }
          for (let j = 0; j < zs.length; j++) if (j !== i && zs[j].state !== 'dead') { const dx = z.x - zs[j].x, dz = z.z - zs[j].z, d2 = dx * dx + dz * dz; if (d2 < 0.3 && d2 > 1e-6) { const d = Math.sqrt(d2); wx += dx / d * 0.5; wz += dz / d * 0.5; } }
          const k = 1 - Math.exp(-5 * dt); z.vx += (wx - z.vx) * k; z.vz += (wz - z.vz) * k; z.x += z.vx * dt; z.z += z.vz * dt;
          const sp = Math.hypot(z.vx, z.vz);
          if (sp > 0.05) z.yaw = shortAng(z.yaw, Math.atan2(z.vx, z.vz), 1 - Math.exp(-8 * dt)); else if (alive) z.yaw = shortAng(z.yaw, Math.atan2(me3.x - z.x, me3.z - z.z), 1 - Math.exp(-6 * dt));
          z.phase += sp * dt * 5.5;
          if (alive && dist <= ZOMBIES.reach + 0.25 && (me3.y || 0) < ZOMBIES.safeAbove && now - z.bite > ZOMBIES.biteEvery && now - z.born > 0.8) { z.bite = now; SFX.bite(); hurt(ZOMBIES.bite, '🧟'); }
          if (now - lastGroan > 1.8 + rnd() * 2 && dist < 14 && rnd() < dt * 0.6) { lastGroan = now; SFX.groan(panOf(_a.set(z.x, 1.2, z.z)), 1 / (1 + dist * 0.12)); }
        } else {                                                                           // a follower: glide to where the owner says it is
          const k = 1 - Math.exp(-9 * dt), ox = z.x, oz = z.z; z.x += (z.tx - z.x) * k; z.z += (z.tz - z.z) * k; z.vx = (z.x - ox) / Math.max(dt, 1e-3); z.vz = (z.z - oz) / Math.max(dt, 1e-3);
          const sp = Math.hypot(z.vx, z.vz); if (sp > 0.05) z.yaw = shortAng(z.yaw, z.tyaw, 1 - Math.exp(-8 * dt)); z.phase += sp * dt * 5.5;
        }
      }
      poseZombie(z, i, now);
    }
    for (let pi = 0; pi < PART_LIST.length; pi++) { const p = PART_LIST[pi]; p.mesh.count = zs.length * p.per; p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    stains.instanceMatrix.needsUpdate = true; if (stains.instanceColor) stains.instanceColor.needsUpdate = true;
    let left = 0; for (let i = 0; i < zs.length; i++) if (zs[i].state !== 'dead') left++;
    const html = `<div>${pix(ICONS.wave, 3)}<span class="o-big">${wave}</span><small>${T().wave}</small></div><div>${pix(ICONS.skull, 4)}<span class="o-big">${kills}</span><small>${T().kills}</small></div><div>${pix(ICONS.zombie, 4)}<span class="o-big">${left}</span><small>${T().left}</small></div>`; if (html !== zHtml) { zHtml = html; el.z.innerHTML = html; }
    let near = 99; for (const z of zs) if (z.state !== 'dead' && me3) near = Math.min(near, Math.hypot(me3.x - z.x, me3.z - z.z));
    el.vig.classList.toggle('o-near', near < 3.5);
  }
  /** a ray against the zombies (spheres on the head and the body): the nearest hit, or null */
  function rayZombies(origin, dir, maxT) {
    let best = null, bt = maxT;
    for (const z of zs) {
      if (z.state === 'dead') continue;
      const s = z.scale;
      for (let k = 0; k < 4; k++) {
        const cy = (k === 0 ? 1.62 : k === 1 ? 1.28 : k === 2 ? 0.9 : 0.4) * s, r = (k === 0 ? 0.2 : k === 1 ? 0.3 : k === 2 ? 0.32 : 0.28) * s;
        _a.set(z.x - origin.x, cy - origin.y, z.z - origin.z); const tca = _a.dot(dir); if (tca < 0) continue;
        const d2 = _a.lengthSq() - tca * tca; if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2); if (t < bt && t > 0.2) { bt = t; best = {z, t, head: k === 0}; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- the game
  const ammo = WEAPONS.map(w => w.mag); let reloadUntil = 0;
  let on = false, hp = RULES.hp, weapon = 0, alive = true, respawnAt = 0, nextShot = 0, deaths = 0, shotId = 0, flashT = 0, hitT = 0;
  let out = [];                                                                           // my last shots, with their numbers
  const others = new Map();                                                               // name -> {hp, w, k, seen, z, zt}
  const publish = () => sink(on ? snapshot() : null);
  function snapshot() {
    const s = {on: true, hp: Math.round(hp), w: weapon, k: deaths, shots: out.slice(-RULES.shots)};
    if (zOn) {
      s.z = 1; s.zt = zStart; s.zw = wave; s.zk = kills;
      if (owner) s.zs = zs.slice(0, MAXZ).map(z => ({i: z.id, x: r2(z.x), z: r2(z.z), r: r2(z.yaw), h: Math.max(0, Math.round(z.hp)), s: z.state === 'dead' ? 2 : z.state === 'rise' ? 1 : 0}));
    }
    return s;
  }
  function drawHud() {
    const L = lang(), w = WEAPONS[weapon], reloading = performance.now() / 1000 < reloadUntil;
    el.hpnum.textContent = Math.round(hp); el.bar.style.width = Math.max(0, hp) + '%'; el.bar.style.background = hp > 50 ? '#43a047' : hp > 25 ? '#fb8c00' : '#e53935'; el.hpbox.classList.toggle('o-low', hp <= 30);
    el.slots.innerHTML = WEAPONS.map((x, i) => `<div class="o-pnt-slot${i === weapon ? ' o-on' : ''}"><b>${i + 1}</b>${pix(ICONS[x.id], 2)}</div>`).join('');
    el.gicon.innerHTML = pix(ICONS[w.id], 6); el.gname.textContent = w[L] || w.it;
    el.ammo.classList.toggle('o-empty', reloading || ammo[weapon] === 0);
    el.ammo.innerHTML = reloading ? `<small>${T().reload}</small>` : `${ammo[weapon]}<small>/ ${T().free}</small>`;
    el.others.style.display = others.size ? '' : 'none';
    el.others.innerHTML = [...others].map(([n, o]) => `<div>${n.replace(/[<>&"]/g, '')} · ${o.hp}<div class="o-pnt-bar"><i style="width:${o.hp}%;background:${o.hp > 50 ? '#43a047' : o.hp > 25 ? '#fb8c00' : '#e53935'}"></i></div></div>`).join('');
  }
  function hurt(d, by) {
    if (!alive) return;
    hp = Math.max(0, hp - d); flashT = performance.now() / 1000 + 0.3; el.flash.classList.add('o-on'); SFX.hurt();
    if (hp <= 0) { alive = false; deaths++; respawnAt = performance.now() / 1000 + RULES.respawn; el.msg.textContent = zOn ? T().over(Math.max(1, wave), kills) : T().out(RULES.respawn); }
    else { el.msg.textContent = T().hit(by); setTimeout(() => { if (alive) el.msg.textContent = ''; }, 900); }
    drawHud(); publish();
  }
  /** what a ray hit in the world: a friend, a figure of the office, or the place */
  function surface(h) {
    let friend = null, top = null; const roots = players();
    for (let o = h.object; o; o = o.parent) { for (const [n, r] of roots) if (r === o) friend = n; if (o.parent === scene) top = o; }
    const figure = friend || h.object.userData.person ? top : null;
    _n.copy(h.face ? h.face.normal : _d).transformDirection(h.object.matrixWorld);
    if (_n.dot(_d) > 0) _n.negate();
    return {friend, figure};
  }
  function muzzlePos(target) { return target.set(...TIP).applyMatrix4(camera.matrixWorld); }
  function startReload(now) { if (now < reloadUntil || ammo[weapon] >= WEAPONS[weapon].mag) return; reloadUntil = now + RULES.reload; blip({f0: 600, f1: 300, type: 'square', dur: 0.06, gain: 0.08}); setTimeout(() => blip({f0: 900, f1: 500, type: 'square', dur: 0.06, gain: 0.08}), RULES.reload * 600); drawHud(); }
  function shootOnce(w) {
    if (ammo[weapon] <= 0) return startReload(performance.now() / 1000);
    ammo[weapon]--;
    camera.getWorldPosition(_o); camera.getWorldDirection(_d); _u.set(0, 1, 0); _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
    const base = _s.copy(_d), ci = hashName(me()) % COLORS.length; const bx = base.x, by = base.y, bz = base.z;
    muzzlePos(_c); const mx = _c.x, my = _c.y, mz = _c.z;
    for (let k = 0; k < w.pellets; k++) {
      _d.set(bx, by, bz).addScaledVector(_r, (rnd() - 0.5) * 2 * w.spread).addScaledVector(_u, (rnd() - 0.5) * 2 * w.spread).normalize();
      ray.set(_o, _d); ray.near = 0.25; ray.far = w.range;
      const hit = ray.intersectObjects(scene.children, true).find(h => {
        for (let o = h.object; o; o = o.parent) if (o.userData.noShot || o === camera || !o.visible) return false;
        return !h.object.isSprite && !h.object.isLine && !h.object.isPoints && h.object.userData.person !== me();
      });
      const zh = zOn ? rayZombies(_o, _d, hit ? hit.distance : w.range) : null;
      let friend = null, rec = null;
      if (zh) {                                                                           // a zombie is nearer than the wall behind it
        _a.copy(_o).addScaledVector(_d, zh.t); _b.set(mx, my, mz); _n.copy(_d).negate();
        launch(_b, _a, ci, w.speed, 3, _n, {zi: zh.z.id, dmg: w.damage, head: zh.head, mine: true});
        rec = {p: _a, n: _n, zi: zh.z.id, zd: Math.round(w.damage * (zh.head ? ZOMBIES.headMul : 1))};
        out.push({id: ++shotId, o: [r2(mx), r2(my), r2(mz)], p: [r2(_a.x), r2(_a.y), r2(_a.z)], n: null, h: null, d: 0, c: ci, zi: zh.z.id, zd: rec.zd});
        hitT = performance.now() / 1000; el.cross.classList.add('o-hit'); SFX.tick();
      } else {
        const to = hit ? _a.copy(hit.point) : _a.copy(_o).addScaledVector(_d, w.range); _b.set(mx, my, mz);
        if (hit) {
          const r = surface(hit); friend = r.friend; _n.copy(_n);
          if (r.figure) launch(_b, to, ci, w.speed, 2, _n, {top: r.figure}); else launch(_b, to, ci, w.speed, 1, _n);
          if (friend) { hitT = performance.now() / 1000; el.cross.classList.add('o-hit'); SFX.tick(); }
        } else launch(_b, to, ci, w.speed, 0, null);
        out.push({id: ++shotId, o: [r2(mx), r2(my), r2(mz)], p: [r2(to.x), r2(to.y), r2(to.z)], n: hit ? [r2(_n.x), r2(_n.y), r2(_n.z)] : null, h: friend, d: friend ? w.damage : 0, c: ci});
      }
    }
    if (out.length > RULES.shots * 2) out = out.slice(-RULES.shots);
    SFX.shot(weapon, 0); kick = Math.min(1.4, kick + w.kick); flashUntil = performance.now() / 1000 + 0.05; el.cross.classList.add('o-fire'); setTimeout(() => el.cross.classList.remove('o-fire'), 70);
    camera.fov += RULES.recoil * w.kick * 2; camera.updateProjectionMatrix();
    if (ammo[weapon] <= 0) startReload(performance.now() / 1000); else drawHud();
    publish();
  }
  function fire() {
    if (!on || !alive) return;
    if (!pov()) return say(T().pov);
    const now = performance.now() / 1000, w = WEAPONS[weapon];
    if (now < nextShot || now < reloadUntil) return;
    if (ammo[weapon] <= 0) return startReload(now);
    nextShot = now + w.cooldown + (w.burst - 1) * w.gap;
    for (let b = 0; b < w.burst; b++) b ? setTimeout(() => { if (on && alive && ammo[weapon] > 0 && performance.now() / 1000 >= reloadUntil) shootOnce(w); }, b * w.gap * 1000) : shootOnce(w);
  }
  /** a friend's shot, drawn here: the ball in flight, then the splash; the damage if it hit me, or a zombie of mine */
  function effect(s, by) {
    const ci = s.c % COLORS.length; _b.set(s.o[0], s.o[1], s.o[2]); _a.set(s.p[0], s.p[1], s.p[2]);
    let kind = 0, top = null;
    if (s.n) { _n.set(s.n[0], s.n[1], s.n[2]); kind = 1; for (const [n, r] of players()) if (n === s.h) { top = r; kind = 2; } }
    launch(_b, _a, ci, 60, kind, s.n ? _n : null, {top});
    SFX.shot(0, panOf(_b));
    if (on && s.h === me()) hurt(s.d, by);
    if (owner && zOn && s.zi) { const z = zombieAt(s.zi); if (z && z.state !== 'dead') { z.flash = 1; z.stagger = 0.25; z.hp -= s.zd || 0; if (z.hp <= 0) killZombie(z, performance.now() / 1000); } }
  }
  // zombies of another player's game: their frame, interpolated
  function followFrame(pb) {
    const now = performance.now() / 1000;
    wave = pb.zw || 0; kills = pb.zk || 0;
    const seen = new Set();
    for (const f of pb.zs || []) {
      seen.add(f.i); let z = zombieAt(f.i);
      if (!z) { z = newZombie(f.x, f.z, f.i, now); z.scale = f.s === 1 ? 0.2 : 1; z.state = f.s === 2 ? 'dead' : f.s === 1 ? 'rise' : 'walk'; zs.push(z); }
      z.tx = f.x; z.tz = f.z; z.tyaw = f.r; z.hp = f.h;
      if (f.s === 2 && z.state !== 'dead') { z.state = 'dead'; z.deadAt = now; SFX.zdie(panOf(_a.set(z.x, 1, z.z)), 1 / (1 + distTo(_a) * 0.08)); }
    }
    for (let i = zs.length - 1; i >= 0; i--) if (!seen.has(zs[i].id) && zs[i].state !== 'dead') { zs[i].state = 'dead'; zs[i].deadAt = now; }
  }

  function showAsk(name, zt) { askFor = {name, zt}; ask.querySelector('.o-pnt-ask-t').textContent = T().askTitle(name); ask.querySelector('[data-a=join]').textContent = T().join; ask.querySelector('[data-a=watch]').textContent = T().watch; ask.style.display = ''; }
  function hideAsk() { askFor = null; ask.style.display = 'none'; }
  ask.addEventListener('pointerdown', e => e.stopPropagation());
  ask.addEventListener('click', e => { const bt = e.target.closest('button'); if (!bt || !askFor) return; const f = askFor; refused.set(f.name, f.zt); hideAsk(); if (bt.dataset.a === 'join') api.zombies(true); else startWatch(f.name); });
  wbadge.querySelector('button').addEventListener('click', () => { const f = watchOf; stopWatch(); api.zombies(true); });
  function startWatch(name) {
    watch = true; watchOf = name; zOn = true; owner = false; zStart = 2100000000; zHtml = ''; clearZombies(); showZombies(); moodOn();
    balls.visible = trails.visible = true; for (const sp of splashes) sp.mesh.visible = true; hud.style.display = ''; hud.classList.add('o-watch'); el.z.style.display = 'flex';
    wbadge.querySelector('span').textContent = T().watching; wbadge.querySelector('button').textContent = T().stop;
  }
  function stopWatch() {
    if (!watch) return; watch = false; watchOf = null; zOn = false; owner = true; clearZombies(); clearPaint(); moodOff(); hud.style.display = 'none'; hud.classList.remove('o-watch'); el.z.style.display = 'none';
    balls.visible = trails.visible = false; for (const b2 of bolts) b2.live = false; balls.count = trails.count = 0; others.clear();
  }

  // input: a click that is not a drag shoots, 1 2 3 choose the weapon
  let down = null;
  root.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (on) ac(); }, true);
  root.addEventListener('click', e => {
    if (!on || e.target !== canvas || !pov() || !aim()) return;
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    e.stopImmediatePropagation(); e.stopPropagation(); fire();
  }, true);
  document.addEventListener('keydown', e => {
    if (!on || !pov() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-3rR]$/.test(e.key) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (/[rR]/.test(e.key)) { startReload(performance.now() / 1000); e.preventDefault(); return; }
    weapon = +e.key - 1; reloadUntil = 0; drawHud(); publish(); e.preventDefault();
  });

  // ---------------------------------------------------------------- the zombie mood: darker, fog, lights that fail, a red pulse
  const mood = {saved: null, t: 0, lampOn: [], lampT: [], hemiColor: new Col()};
  function moodOn() {
    const {hemi, sun, lamps = []} = atmosphere; if (mood.saved) return;
    mood.saved = {hemi: hemi?.intensity, hemiColor: hemi?.color.clone(), sun: sun?.intensity, lamps: lamps.map(l => l.intensity), exposure: renderer?.toneMappingExposure, fog: scene.fog, env: scene.environmentIntensity};
    scene.fog = new THREE.FogExp2('#05070b', MOOD.fog);
    if (renderer) renderer.toneMappingExposure = MOOD.exposure;
    if (scene.environmentIntensity !== undefined) scene.environmentIntensity = mood.saved.env * 0.3;
    mood.lampOn = lamps.map(() => true); mood.lampT = lamps.map(() => 0); el.vig.classList.add('o-on');
  }
  function moodOff() {
    const s = mood.saved; if (!s) return; const {hemi, sun, lamps = []} = atmosphere;
    if (hemi) { hemi.intensity = s.hemi; hemi.color.copy(s.hemiColor); } if (sun) sun.intensity = s.sun; lamps.forEach((l, i) => { l.intensity = s.lamps[i]; });
    if (renderer) renderer.toneMappingExposure = s.exposure; scene.fog = s.fog; if (s.env !== undefined) scene.environmentIntensity = s.env;
    mood.saved = null; el.vig.classList.remove('o-on', 'o-near');
  }
  function moodStep(dt, now) {
    const s = mood.saved; if (!s) return; const {hemi, sun, lamps = []} = atmosphere;
    mood.t += dt;
    // the office lamps die and come back at random, the sun and the ambient breathe low, the sky colour pulses between cold and red
    lamps.forEach((l, i) => { mood.lampT[i] -= dt; if (mood.lampT[i] <= 0) { mood.lampOn[i] = rnd() > 0.45; mood.lampT[i] = rnd() * MOOD.flickerEvery * (mood.lampOn[i] ? 1.6 : 0.4); } l.intensity = s.lamps[i] * (mood.lampOn[i] ? MOOD.lamps * (0.75 + 0.25 * Math.sin(mood.t * 31 + i)) : 0.04); });
    if (hemi) { hemi.intensity = s.hemi * MOOD.ambient * (0.85 + 0.15 * Math.sin(mood.t * 1.3)); const pulse = 0.5 + 0.5 * Math.sin(mood.t * 0.9); hemi.color.setRGB(0.72 + 0.28 * pulse, 0.68 - 0.22 * pulse, 0.74 - 0.24 * pulse); }
    if (sun) sun.intensity = s.sun * MOOD.sun * (rnd() < 0.015 ? 0.2 : 1);
  }

  const api = {
    active: () => on,
    /** switch the mode on or off (no argument: the other way) */
    toggle(next = !on) {
      if (watch) stopWatch();
      if (next === on) return on;
      on = next; others.clear();
      if (on) {
        hp = RULES.hp; alive = true; weapon = 0; out = []; WEAPONS.forEach((w, i) => { ammo[i] = w.mag; }); reloadUntil = 0; hud.style.display = ''; el.msg.textContent = ''; enterPov(); ac();
        for (const sp of splashes) sp.mesh.visible = true; balls.visible = trails.visible = true; guns.forEach((g, i) => { g.visible = i === weapon; g.position.set(...GUNPOS[i]); });
        say(T().on);
      } else {
        hud.style.display = 'none'; clearPaint(); balls.visible = trails.visible = false; guns.forEach(g => { g.visible = false; }); muzzle.visible = false;
        if (zOn) { zOn = false; clearZombies(); el.z.style.display = 'none'; moodOff(); }
        for (const b of bolts) b.live = false; balls.count = trails.count = 0;
        el.flash.classList.remove('o-on'); el.vig.classList.remove('o-on', 'o-near'); el.msg.textContent = ''; el.cross.className = 'o-pnt-cross';
        say(T().off);
      }
      drawHud(); publish();
      return on;
    },
    /** zombie mode on or off (on turns the paintball on too) */
    zombies(next = !zOn) {
      if (watch) stopWatch();
      if (next === zOn) return zOn;
      if (next && !on) api.toggle(true);
      zOn = next; el.z.style.display = zOn ? 'flex' : 'none';
      if (zOn) { owner = true; zStart = Date.now() % 2000000000; zHtml = ''; restartZombies(performance.now() / 1000); moodOn(); say(T().zon); }
      else { clearZombies(); el.z.style.display = 'none'; moodOff(); el.vig.classList.remove('o-near'); say(T().zoff); }
      publish();
      return zOn;
    },
    zombiesOn: () => zOn,
    lockMessage: () => say(T().lock),
    /** each frame */
    update(dt) {
      if (!on && !watch) return;
      dt = Math.min(dt, 0.1); const now = performance.now() / 1000, p = pov(), w = WEAPONS[weapon];
      el.cross.style.display = p && alive ? 'block' : 'none';
      if (reloadUntil && now >= reloadUntil) { reloadUntil = 0; ammo[weapon] = WEAPONS[weapon].mag; drawHud(); }
      if (flashT && now > flashT) { flashT = 0; el.flash.classList.remove('o-on'); }
      if (hitT && now > hitT + 0.15) { hitT = 0; el.cross.classList.remove('o-hit'); }
      if (!alive) {
        const left = Math.ceil(respawnAt - now);
        if (left <= 0) { hp = RULES.hp; alive = true; WEAPONS.forEach((w, i) => { ammo[i] = w.mag; }); el.msg.textContent = ''; if (zOn && owner) restartZombies(now); drawHud(); publish(); } else if (!zOn) el.msg.textContent = T().out(left);
      }
      // the gun: shown in first person, kicks back and settles, the flash lasts a few frames
      kick *= Math.exp(-13 * dt);
      guns.forEach((g, i) => { g.visible = on && p && alive && i === weapon; if (g.visible) { g.position.set(GUNPOS[i][0], GUNPOS[i][1] + kick * 0.012, GUNPOS[i][2] + kick * 0.07); g.rotation.x = kick * 0.16; g.rotation.y = 0.1; } });
      muzzle.visible = on && p && alive && now < flashUntil; if (muzzle.visible) { muzzle.position.set(TIP[0] + 0.28, TIP[1] + 0.11, TIP[2] + 0.1); muzzle.rotation.z = rnd() * 6.28; muzzle.scale.setScalar(0.8 + rnd() * 0.8); }
      stepBalls(dt);
      for (const [n, o] of others) if (now - (o.at || now) > 8) { others.delete(n); if (watch) stopWatch(); else if (zOn && !owner) owner = true; drawHud(); }          // a friend who went quiet is gone (and the zombies he ran are mine now)
      if (zOn) { stepZombies(dt, now); moodStep(dt, now); }
    },
    /** what a friend here says about their paintball (their `pb` in their position); null or off: they are not playing */
    receive(name, pb) {
      if (!on) {
        if (watch) {                                                                       // watching a friend's game: draw it, nothing more
          if (name !== watchOf) return;
          if (!pb || !pb.z) { stopWatch(); return; }
          let o = others.get(name); if (!o) { o = {seen: Math.max(0, ...(pb.shots || []).map(s => s.id))}; others.set(name, o); }
          o.at = performance.now() / 1000; for (const s of pb.shots || []) if (s.id > o.seen) { o.seen = s.id; effect(s, name); }
          followFrame(pb); return;
        }
        if (pb && pb.on && pb.z && refused.get(name) !== pb.zt) { if (!askFor) showAsk(name, pb.zt); }
        else if (askFor && askFor.name === name && !(pb && pb.z)) hideAsk();
        return;
      }
      if (!pb || !pb.on) { if (others.delete(name)) drawHud(); return; }
      let o = others.get(name);
      if (!o) { o = {hp: 100, w: 0, k: 0, seen: Math.max(0, ...(pb.shots || []).map(s => s.id)), zh: 0}; others.set(name, o); }   // what was shot before we met is not replayed
      o.hp = pb.hp; o.w = pb.w; o.k = pb.k; o.at = performance.now() / 1000; o.z = !!pb.z; o.zt = pb.zt || 0;
      for (const s of pb.shots || []) if (s.id > o.seen) { o.seen = s.id; effect(s, name); }
      // zombies: the one who started the mode first runs them; the other follows
      if (zOn && pb.z) {
        const theirs = o.zt, mine = zStart;
        const iFollow = theirs < mine || (theirs === mine && name < me());
        if (iFollow && owner) { owner = false; clearZombies(); showZombies(); say(T().coop); }
        if (!iFollow && !owner) { owner = true; }
        if (!owner) followFrame(pb);
      } else if (zOn && !pb.z && !owner) { owner = true; }
      drawHud();
    },
    snapshot: () => (on ? snapshot() : null),
    /** for tests */
    _state: () => ({on, pov: pov(), hp, alive, weapon, deaths, splats: splashes.reduce((n, s) => n + s.mesh.count, 0), figSplats: figSplats.length, others: [...others], zombies: zs.map(z => [z.x, z.z, z.hp, z.state === 'dead']), wave, kills, owner, bolts: bolts.filter(b => b.live).length, calls: {zombiePartMeshes: Object.keys(PARTS).length + 1}}),
    _fire: () => fire(),
  };
  return api;
}
