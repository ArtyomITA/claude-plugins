// Paintball and zombies. A mode you switch on from the "Altro" menu, played in first person only: a click shoots a ball of
// paint that flies and leaves a splash where it lands (on walls, furniture and figures) until you switch the mode off; you
// have HP; at 0 you are out for a few seconds. 1-6 (or the wheel) change the weapon: pistol, SMG, shotgun, sniper (right
// button or Z zooms), grenade launcher (paint burst with an area), minigun (hold the button, it spins up). Zombie mode adds
// waves of zombies of five kinds (walker, runner, brute, spitter, and a boss at the end of every few waves).
//
// Cost: everything that repeats is instanced (the paint, the balls, the bits and the smoke, the zombies' limbs): a handful of
// draw calls whatever the number of splashes or zombies, no allocation per frame. The shots hit-scan (instant), the ball you
// see is only the show; the launcher's ball and the spitter's goo fly for real and burst where the ray ended.
//
// With a friend in the same office your snapshot rides in your position (`pb`): playing, HP, weapon, your last shots, and
// the zombies if you run them. The other side draws your balls and splashes, takes the damage of the shots that hit it,
// and in zombie mode the zombies are the same for both: whoever started the mode simulates them (and chases the nearest
// of the two) and sends position, life, kind and state; the other interpolates, and tells the owner which zombie it hit.
//
// The numbers to play with are the tables in office-guns.js (weapons) and office-zombies.js (zombies), and the two below.

import {boxGeo, WEAPONS, GUNS, GUN_ICONS} from './office-guns.js';
import {ZOMBIES, ZT, ZT_LIST, ZGEO, waveMix} from './office-zombies.js';
export {WEAPONS, GUNS, ZOMBIES, ZT};

export const RULES = {hp: 100, respawn: 3, splatsPerKind: 48, bolts: 96, shots: 12, recoil: 1.6, reload: 1.3};
/** the zombie mood: how dark the room gets, the fog, how often the lights fail */
export const MOOD = {ambient: 0.55, sun: 0.33, lamps: 0.72, exposure: 0.93, fog: 0.04, flickerEvery: 2.4};
const MAXZ = 16;
const COLORS = ['#ff1744', '#ffea00', '#00e5ff', '#76ff03', '#e040fb', '#ff9100', '#2979ff', '#f50057'];
const TOXIC = '#7cff3a', SHOCK = '#ffb74d';
const TEXT = {
  it: {zon: '🧟 Zombie: sopravvivi alle ondate', lock: 'Spegni il paintball per uscire dalla prima persona', zoff: 'Zombie spenti', over: (w, k) => `Eliminato: ondata ${w}, zombie ${k}`, on: '🔫 Paintball acceso: clic per sparare, 1-6 o rotella per le armi, R ricarica, tasto destro o Z zoom del cecchino', off: 'Paintball spento: le macchie sono sparite',
       hit: n => `Colpito da ${n}`, out: n => `Eliminato: rinasci tra ${n} s`, pov: 'Entra in prima persona (POV) per sparare', hp: 'HP', wave: 'ONDATA', kills: 'UCCISI', left: 'ZOMBIE', next: n => `Ondata ${n}`, coop: 'in squadra', reload: 'RICARICA', free: '∞', askTitle: n => `${n} ha avviato la modalità Zombie`, join: 'Partecipa in POV', watch: 'Guarda dall\'alto', watching: '👁 Guardi dall\'alto: nessuna interazione', stop: 'Partecipa', boss: 'BOSS', bossIn: 'Il BOSS è arrivato!'},
  en: {zon: '🧟 Zombies: survive the waves', lock: 'Switch paintball off to leave first person', zoff: 'Zombies off', over: (w, k) => `You are out: wave ${w}, ${k} zombies`, on: '🔫 Paintball on: click to shoot, 1-6 or the wheel for weapons, R reloads, right button or Z zooms the sniper', off: 'Paintball off: the paint is gone',
       hit: n => `Hit by ${n}`, out: n => `You are out: back in ${n} s`, pov: 'Go first person (POV) to shoot', hp: 'HP', wave: 'WAVE', kills: 'KILLS', left: 'ZOMBIES', next: n => `Wave ${n}`, coop: 'as a team', reload: 'RELOAD', free: '∞', askTitle: n => `${n} started Zombie mode`, join: 'Join in first person', watch: 'Watch from above', watching: '👁 Watching from above: no interaction', stop: 'Join', boss: 'BOSS', bossIn: 'The BOSS is here!'},
};
const CSS = `
.o-pnt { position: absolute; inset: 0; pointer-events: none; z-index: 24; font: 700 14px "Segoe UI", system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px #000c; }
.o-pnt svg { display: block; shape-rendering: crispEdges; filter: drop-shadow(0 2px 2px #000a); }
.o-pnt .o-pnt-cross { position: absolute; left: 50%; top: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; display: none; transition: transform .08s; }
.o-pnt .o-pnt-cross i { position: absolute; background: #fff; box-shadow: 0 0 0 1px #000, 0 0 4px #000; border-radius: 1px; }
.o-pnt .o-pnt-cross i:nth-child(1) { left: 16px; top: 0; width: 3px; height: 11px; } .o-pnt .o-pnt-cross i:nth-child(2) { left: 16px; bottom: 0; width: 3px; height: 11px; }
.o-pnt .o-pnt-cross i:nth-child(3) { top: 16px; left: 0; height: 3px; width: 11px; } .o-pnt .o-pnt-cross i:nth-child(4) { top: 16px; right: 0; height: 3px; width: 11px; }
.o-pnt .o-pnt-cross.o-fire { transform: scale(1.5); } .o-pnt .o-pnt-cross.o-hit i { background: #ff5252; }
.o-pnt .o-pnt-scope { position: absolute; inset: 0; display: none; background: radial-gradient(circle at 50% 50%, transparent 0, transparent 33vmin, #000 33.4vmin); }
.o-pnt .o-pnt-scope:before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; background: linear-gradient(90deg, transparent 17%, #000c 17% 83%, transparent 83%); }
.o-pnt .o-pnt-scope:after { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; background: linear-gradient(0deg, transparent 17%, #000c 17% 83%, transparent 83%); }
.o-pnt .o-pnt-scope i { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; background: #ff3030; border-radius: 50%; z-index: 1; }
.o-pnt .o-pnt-hpbox { position: absolute; left: 22px; bottom: 74px; display: flex; align-items: center; gap: 12px; }
.o-pnt .o-pnt-hpnum { font-size: 38px; line-height: 1; min-width: 78px; text-align: right; font-weight: 800; letter-spacing: .02em; }
.o-pnt .o-pnt-hpbar { position: relative; width: 250px; height: 22px; background: #0008; border: 2px solid #ffffffcc; border-radius: 4px; overflow: hidden; box-shadow: 0 2px 6px #0007; }
.o-pnt .o-pnt-hpbar i { display: block; height: 100%; width: 100%; background: #43a047; transition: width .2s, background .3s; }
.o-pnt .o-pnt-hpbar:after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 24px, #000a 24px 25px); }
.o-pnt .o-pnt-hpbox.o-low .o-pnt-hpnum { color: #ff5252; animation: o-pnt-pulse .7s infinite alternate; } @keyframes o-pnt-pulse { to { opacity: .55; } }
.o-pnt .o-pnt-gunbox { position: absolute; left: 22px; bottom: 124px; }
.o-pnt .o-pnt-slots { display: flex; gap: 6px; margin-bottom: 8px; }
.o-pnt .o-pnt-slot { pointer-events: auto; cursor: pointer; position: relative; width: 62px; height: 40px; border-radius: 6px; background: #0007; border: 2px solid #ffffff44; display: flex; align-items: center; justify-content: center; opacity: .7; }
.o-pnt .o-pnt-slot svg { max-width: 92%; height: auto; }
.o-pnt .o-pnt-slot b { position: absolute; left: 4px; top: 1px; font-size: 11px; opacity: .85; }
.o-pnt .o-pnt-slot.o-on { opacity: 1; border-color: #f5b400; background: #f5b40033; }
.o-pnt .o-pnt-gun { display: flex; align-items: center; gap: 14px; }
.o-pnt .o-pnt-gname { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .85; }
.o-pnt .o-pnt-ammo { font-size: 38px; line-height: 1; font-weight: 800; } .o-pnt .o-pnt-ammo small { font-size: 18px; opacity: .65; margin-left: 4px; }
.o-pnt .o-pnt-ammo.o-empty { color: #ff5252; }
.o-pnt .o-pnt-others { position: absolute; right: 12px; top: 56px; min-width: 150px; padding: 6px 10px; border-radius: 10px; background: #14151dcc; }
.o-pnt .o-pnt-others div { margin: 3px 0; } .o-pnt .o-pnt-others .o-pnt-bar { height: 6px; margin: 2px 0 0; border-radius: 3px; background: #333; overflow: hidden; } .o-pnt .o-pnt-others .o-pnt-bar i { display: block; height: 100%; }
.o-pnt .o-pnt-z { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: none; gap: 26px; align-items: center; white-space: nowrap; }
.o-pnt .o-pnt-z div { display: flex; align-items: center; gap: 8px; } .o-pnt .o-pnt-z .o-big { font-size: 30px; font-weight: 800; line-height: 1; } .o-pnt .o-pnt-z small { display: block; font-size: 10px; letter-spacing: .14em; opacity: .75; }
.o-pnt .o-pnt-boss { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); width: min(420px, 60vw); display: none; text-align: center; }
.o-pnt .o-pnt-boss b { font-size: 13px; letter-spacing: .3em; color: #ff8a80; } .o-pnt .o-pnt-bbar { height: 14px; margin-top: 3px; background: #000a; border: 2px solid #ffffffcc; border-radius: 4px; overflow: hidden; } .o-pnt .o-pnt-bbar i { display: block; height: 100%; width: 100%; background: linear-gradient(#ff5252, #b71c1c); transition: width .15s; }
.o-pnt .o-pnt-flash { position: absolute; inset: 0; background: radial-gradient(transparent 58%, #e5393560); opacity: 0; transition: opacity .5s; }
.o-pnt .o-pnt-flash.o-on { opacity: 1; transition: none; }
.o-pnt .o-pnt-vig { position: absolute; inset: 0; background: radial-gradient(transparent 38%, #00000090); opacity: 0; transition: opacity 1.2s; }
.o-pnt .o-pnt-vig.o-on { opacity: 1; } .o-pnt .o-pnt-vig.o-near { background: radial-gradient(transparent 38%, #4a080870); }
.o-pnt.o-watch .o-pnt-hpbox, .o-pnt.o-watch .o-pnt-gunbox, .o-pnt.o-watch .o-pnt-cross, .o-pnt.o-watch .o-pnt-others, .o-pnt.o-watch .o-pnt-scope { display: none !important; }
.o-pnt .o-pnt-wbadge { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%); display: none; pointer-events: auto; padding: 8px 14px; border-radius: 10px; background: #14151dcc; border: 1px solid #f5b400; white-space: nowrap; }
.o-pnt.o-watch .o-pnt-wbadge { display: flex; gap: 14px; align-items: center; } .o-pnt .o-pnt-wbadge button, .o-pnt-ask button { font: inherit; color: #fff; background: #f5b40033; border: 1px solid #f5b400; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.o-pnt-ask { position: absolute; left: 50%; top: 74px; transform: translateX(-50%); z-index: 26; padding: 10px 16px; border-radius: 12px; background: #14151de6; border: 1px solid #f5b400; font: 700 14px "Segoe UI", system-ui, sans-serif; color: #fff; text-align: center; box-shadow: 0 8px 22px #0008; }
.o-pnt-ask div + div { margin-top: 8px; display: flex; gap: 10px; justify-content: center; }
.o-pnt .o-pnt-msg { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font-size: 26px; text-shadow: 0 2px 8px #000; text-align: center; }
@media (max-width: 620px) { .o-pnt .o-pnt-slot { width: 44px; height: 34px; } .o-pnt .o-pnt-hpbar { width: 150px; } }
`;
const PAL = {b: '#c9ced6', g: '#8b929c', d: '#4a525c', k: '#2b2f36', h: '#8d6e63', r: '#ff5252', m: '#42a5f5', w: '#ffffff', y: '#ffd54f', G: '#7fc36a', e: '#d32f2f', s: '#e8e8e8', o: '#ff9a1f', l: '#9cff3a', a: '#4dd2ff'};
/** a small pixel-art picture from rows of letters (see PAL); '.' is empty; short rows are padded */
function pix(rows, scale) {
  const W = Math.max(...rows.map(r => r.length)), rects = [];
  rows.forEach((row, y) => { for (let x = 0; x < row.length;) { const c = row[x]; if (c === '.') { x++; continue; } let n = 1; while (row[x + n] === c) n++; rects.push(`<rect x="${x}" y="${y}" width="${n}" height="1" fill="${PAL[c]}"/>`); x += n; } });
  return `<svg width="${W * scale}" height="${rows.length * scale}" viewBox="0 0 ${W} ${rows.length}">${rects.join('')}</svg>`;
}
const ICONS = {
  ...GUN_ICONS,
  heart: ['.rr...rr.', 'rrrr.rrrr', 'rrrrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'],
  skull: ['..ssss..', '.ssssss.', 'ss.ss.ss', 'ssssssss', '.ssssss.', '..s..s..', '..ssss..', '..s.s.s.'],
  zombie: ['.GGGGGG.', 'GGGGGGGG', 'GeeGGeeG', 'GGGGGGGG', 'GGdddGGG', 'GGGGGGGG', '.GGGGGG.', '..G..G..'],
  wave: ['y.y.y.y.', '.y.y.y.y', 'y.y.y.y.', '.y.y.y.y'],
};

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
  /** wi: the weapon (0 pistol, 1 SMG, 2 shotgun, 3 sniper, 4 launcher, 5 minigun) */
  shot: (wi, pan, g = 1) => {
    if (wi === 1) blip({f0: 240, f1: 80, type: 'triangle', dur: 0.07, gain: 0.13 * g, nz: 0.5, nzF: 2600, pan});
    else if (wi === 2) { blip({f0: 200, f1: 60, type: 'triangle', dur: 0.14, gain: 0.2 * g, nz: 0.9, nzF: 1100, pan}); blip({f0: 110, f1: 40, type: 'sawtooth', dur: 0.2, gain: 0.14 * g, pan}); }
    else if (wi === 3) { blip({f0: 1400, f1: 90, type: 'square', dur: 0.12, gain: 0.12 * g, nz: 0.8, nzF: 3000, pan}); blip({f0: 90, f1: 30, type: 'sine', dur: 0.4, gain: 0.22 * g, pan}); }
    else if (wi === 4) { blip({f0: 160, f1: 45, type: 'sine', dur: 0.28, gain: 0.22 * g, nz: 0.4, nzF: 500, pan}); blip({f0: 700, f1: 300, type: 'square', dur: 0.05, gain: 0.07 * g, pan}); }
    else if (wi === 5) blip({f0: 190, f1: 110, type: 'sawtooth', dur: 0.05, gain: 0.08 * g, nz: 0.45, nzF: 1800, pan});
    else blip({f0: 260, f1: 70, type: 'triangle', dur: 0.09, gain: 0.16 * g, nz: 0.5, nzF: 2400, pan});
  },
  boom: (pan, g) => { blip({f0: 90, f1: 28, type: 'sine', dur: 0.5, gain: 0.3 * g, nz: 0.9, nzF: 420, pan}); blip({dur: 0.25, gain: 0.12 * g, nz: 0.8, nzF: 1600, pan}); },
  spit: (pan, g) => blip({f0: 320, f1: 130, type: 'sine', dur: 0.3, gain: 0.14 * g, nz: 0.3, nzF: 900, pan, vib: 30}),
  spin: f => blip({f0: 120 + f * 260, f1: 140 + f * 280, type: 'sawtooth', dur: 0.09, gain: 0.04}),
  splat: (pan, g) => blip({dur: 0.09, gain: 0.12 * g, nz: 0.9, nzF: 900, pan}),
  tick: () => blip({f0: 1500, f1: 900, type: 'square', dur: 0.05, gain: 0.07}),
  groan: (pan, g, t = 0) => {
    if (t === 1) blip({f0: 420 + Math.random() * 80, f1: 260, type: 'sawtooth', dur: 0.4, gain: 0.08 * g, nz: 0.2, nzF: 900, pan, vib: 30});          // the runner screams
    else if (t === 2) blip({f0: 62, f1: 42, type: 'sawtooth', dur: 1.1, gain: 0.16 * g, nz: 0.3, nzF: 180, pan, vib: 10});                                 // the brute rumbles
    else if (t === 4) blip({f0: 55, f1: 30, type: 'sawtooth', dur: 1.6, gain: 0.24 * g, nz: 0.4, nzF: 150, pan, vib: 8});                                  // the boss roars
    else blip({f0: 85 + Math.random() * 25, f1: 55, type: 'sawtooth', dur: 0.9, gain: 0.11 * g, nz: 0.25, nzF: 250, pan, vib: 14});
  },
  zhit: (pan, g) => blip({f0: 140, f1: 70, type: 'sawtooth', dur: 0.16, gain: 0.12 * g, nz: 0.4, nzF: 500, pan}),
  zdie: (pan, g) => blip({f0: 110, f1: 28, type: 'sawtooth', dur: 0.7, gain: 0.14 * g, nz: 0.3, nzF: 300, pan, vib: 6}),
  hurt: () => blip({f0: 90, f1: 40, type: 'sine', dur: 0.25, gain: 0.3, nz: 0.5, nzF: 400}),
  bite: () => blip({f0: 200, f1: 80, type: 'sawtooth', dur: 0.12, gain: 0.18, nz: 0.6, nzF: 800}),
};

export function createPaintball({THREE, scene, camera, canvas, root, pov, me, players, sink, lang = () => 'it', say = () => {}, body = () => null, floor = null, size = [30, 20], enterPov = () => {}, renderer = null, drawTarget = () => null, atmosphere = {}, aim = () => true, report = () => {}, level = () => 0, onMode = () => {}, respawn = () => {}}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const hud = document.createElement('div'); hud.className = 'o-pnt'; hud.style.display = 'none';
  hud.innerHTML = `<div class="o-pnt-vig"></div><div class="o-pnt-flash"></div><div class="o-pnt-scope"><i></i></div><div class="o-pnt-cross"><i></i><i></i><i></i><i></i></div><div class="o-pnt-others"></div><div class="o-pnt-z"></div><div class="o-pnt-boss"><b></b><div class="o-pnt-bbar"><i></i></div></div>
    <div class="o-pnt-hpbox"><span class="o-pnt-heart"></span><div class="o-pnt-hpnum"></div><div class="o-pnt-hpbar"><i></i></div></div>
    <div class="o-pnt-gunbox"><div class="o-pnt-slots"></div><div class="o-pnt-gun"><span class="o-pnt-gicon"></span><div><div class="o-pnt-gname"></div><div class="o-pnt-ammo"></div></div></div></div><div class="o-pnt-msg"></div><div class="o-pnt-wbadge"><span></span><button></button></div>`;
  root.appendChild(hud);
  const el = {vig: hud.querySelector('.o-pnt-vig'), flash: hud.querySelector('.o-pnt-flash'), cross: hud.querySelector('.o-pnt-cross'), scope: hud.querySelector('.o-pnt-scope'), others: hud.querySelector('.o-pnt-others'), z: hud.querySelector('.o-pnt-z'),
              boss: hud.querySelector('.o-pnt-boss'), bname: hud.querySelector('.o-pnt-boss b'), bbar: hud.querySelector('.o-pnt-bbar i'),
              hpbox: hud.querySelector('.o-pnt-hpbox'), heart: hud.querySelector('.o-pnt-heart'), hpnum: hud.querySelector('.o-pnt-hpnum'), bar: hud.querySelector('.o-pnt-hpbar i'), slots: hud.querySelector('.o-pnt-slots'),
              gname: hud.querySelector('.o-pnt-gname'), ammo: hud.querySelector('.o-pnt-ammo'), gicon: hud.querySelector('.o-pnt-gicon'), msg: hud.querySelector('.o-pnt-msg')};
  el.heart.innerHTML = pix(ICONS.heart, 4);
  // a friend started the zombie mode while I am not playing: join in first person, or watch from above (nothing to touch, no HP)
  let watch = false, watchOf = null, askFor = null; const refused = new Map();
  const ask = document.createElement('div'); ask.className = 'o-pnt-ask'; ask.style.display = 'none'; ask.innerHTML = '<div class="o-pnt-ask-t"></div><div><button data-a="join"></button><button data-a="watch"></button></div>'; root.appendChild(ask);
  const wbadge = hud.querySelector('.o-pnt-wbadge');
  const T = () => TEXT[lang()] || TEXT.it;
  const safeAbove = () => (level() ? 1.25 : ZOMBIES.safeAbove);                           // on the arena the platforms are 1 m high: the bite reaches up to there (the goo and the shockwave still find you)

  // scratch objects: nothing is allocated per frame
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, Q = THREE.Quaternion, E = THREE.Euler, Col = THREE.Color;
  const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _o = new V3(), _r = new V3(), _u = new V3(), _n = new V3(), _s = new V3(), _one = new V3(1, 1, 1), _e = new V3(), _f = new V3(), _g = new V3();
  const UP = new V3(0, 1, 0);
  const _mA = new M4(), _mB = new M4(), _mC = new M4(), _mD = new M4(), _mR = new M4(), _mT = new M4(), _mH = new M4();
  const _q = new Q(), _qI = new Q(), _eu = new E(), _col = new Col(), _col2 = new Col();
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

  // ---------------------------------------------------------------- bits and smoke: droplets, casings, goo, dust (two instanced meshes of cubes, pools of floats)
  const BITS = 200, SMOKES = 56;
  const bitsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({toneMapped: false}), BITS);
  const smokeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({toneMapped: false, transparent: true, opacity: 0.42, depthWrite: false}), SMOKES);
  for (const m of [bitsMesh, smokeMesh]) { m.count = 0; m.frustumCulled = false; m.userData.noShot = true; m.raycast = () => {}; m.visible = false; scene.add(m); }
  const pool = n => { const f = () => new Float32Array(n); return {n, cur: 0, x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), life: f(), max: f(), size: f(), grow: f(), grav: f(), bounce: f(), r: f(), g: f(), b: f()}; };
  const bits = pool(BITS), smoke = pool(SMOKES);
  /** one cube: where, how fast, how long it lives, its size, its colour, gravity (negative: it rises), bounce (it rests on the floor), growth */
  function spawn(p, x, y, z, vx, vy, vz, life, sz, col, grav = 9, bounce = 0, grow = 0) {
    let i = p.cur; for (let k = 0; k < p.n; k++) { const j = (p.cur + k) % p.n; if (p.life[j] <= 0) { i = j; break; } }
    p.cur = (i + 1) % p.n; _col.set(col);
    p.x[i] = x; p.y[i] = y; p.z[i] = z; p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz; p.life[i] = p.max[i] = life; p.size[i] = sz; p.grow[i] = grow; p.grav[i] = grav; p.bounce[i] = bounce; p.r[i] = _col.r; p.g[i] = _col.g; p.b[i] = _col.b;
  }
  function stepPool(p, mesh, dt) {
    let n = 0;
    for (let i = 0; i < p.n; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt; if (p.life[i] <= 0) continue;
      p.vy[i] -= p.grav[i] * dt; p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      if (p.grav[i] > 0 && p.y[i] < p.size[i] * 0.5) {
        p.y[i] = p.size[i] * 0.5;
        if (p.bounce[i] > 0) { if (Math.abs(p.vy[i]) > 0.6) { p.vy[i] *= -p.bounce[i]; p.vx[i] *= 0.6; p.vz[i] *= 0.6; } else { p.vx[i] = p.vy[i] = p.vz[i] = 0; } }
        else p.life[i] = Math.min(p.life[i], 0.08);
      }
      const k = p.life[i] / p.max[i], s = p.size[i] * (1 + p.grow[i] * (1 - k)) * Math.min(1, k * 5);
      _mA.compose(_a.set(p.x[i], p.y[i], p.z[i]), _qI, _s.set(s, s, s)); mesh.setMatrixAt(n, _mA); mesh.setColorAt(n, _col.setRGB(p.r[i], p.g[i], p.b[i])); n++;
    }
    mesh.count = n; if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }
  function clearBits() { bits.life.fill(0); smoke.life.fill(0); bitsMesh.count = smokeMesh.count = 0; }
  /** droplets of paint thrown off a surface (or a zombie) */
  function paintBurst(point, normal, col, n, speed = 2.2) {
    for (let k = 0; k < n; k++) {
      _e.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(speed * 0.8).addScaledVector(normal, speed * (0.4 + rnd() * 0.8));
      spawn(bits, point.x, point.y, point.z, _e.x, _e.y + 0.8, _e.z, 0.35 + rnd() * 0.4, 0.025 + rnd() * 0.03, col);
    }
  }
  /** the burst of the launcher (and of the spitter's goo): droplets up, a flat ring on the ground level, a blob of coloured smoke */
  function explode(point, normal, col, radius) {
    paintBurst(point, normal, col, 26, 4.5);
    for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; spawn(bits, point.x, point.y + 0.05, point.z, Math.cos(a) * radius * 2, 0.4, Math.sin(a) * radius * 2, 0.45, 0.07, col, 0, 0, 0); }
    for (let k = 0; k < 7; k++) spawn(smoke, point.x + (rnd() - 0.5) * radius * 0.5, point.y + (rnd() - 0.2) * radius * 0.4, point.z + (rnd() - 0.5) * radius * 0.5, (rnd() - 0.5) * 1.2, 0.5 + rnd(), (rnd() - 0.5) * 1.2, 0.5 + rnd() * 0.3, radius * 0.16, col, 0, 0, 3.2);
    SFX.boom(panOf(point), 1 / (1 + distTo(point) * 0.07));
  }
  /** the boss's slam: a ring of dust running over the floor */
  function shockwave(point, radius) {
    for (let k = 0; k < 30; k++) { const a = k / 30 * 6.283; spawn(bits, point.x, point.y + 0.03, point.z, Math.cos(a) * radius * 2, 0.15, Math.sin(a) * radius * 2, 0.5, 0.1, SHOCK, 0, 0, 0); }
    for (let k = 0; k < 10; k++) { const a = rnd() * 6.283, d = rnd() * radius * 0.8; spawn(smoke, point.x + Math.cos(a) * d, 0.15, point.z + Math.sin(a) * d, 0, 0.6 + rnd() * 0.6, 0, 0.7, 0.25, '#b9a58a', 0, 0, 3);
    }
    SFX.boom(panOf(point), 1 / (1 + distTo(point) * 0.06));
  }

  // ---------------------------------------------------------------- the balls in flight: instanced balls and trails, a pool of structs
  const ballGeo = new THREE.SphereGeometry(0.05, 7, 5), trailGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
  const balls = new THREE.InstancedMesh(ballGeo, new THREE.MeshBasicMaterial({toneMapped: false}), RULES.bolts);
  const trails = new THREE.InstancedMesh(trailGeo, new THREE.MeshBasicMaterial({toneMapped: false, transparent: true, opacity: 0.7}), RULES.bolts);
  for (const m of [balls, trails]) { m.count = 0; m.frustumCulled = false; m.userData.noShot = true; m.raycast = () => {}; m.visible = false; scene.add(m); }
  const bolts = Array.from({length: RULES.bolts}, () => ({live: false, p: new V3(), from: new V3(), dir: new V3(), left: 0, total: 0, speed: 60, ci: 0, kind: 0, hp: new V3(), hn: new V3(), hasN: false, top: null, zi: -1, dmg: 0, head: false, friend: null, mine: false,
    cb: new Col(), ct: new Col(), size: 1, lob: false, arc: 0, trailMax: 0.9, tw: 1, area: 0, ad: 0, src: 'me', ground: false}));
  let boltN = 0;
  /** kind: 0 nothing, 1 world splash, 2 figure splash, 3 zombie hit, 4 burst (area). extra: top, zi, dmg, head, friend, mine, ball/col (colours), size, lob, trail, tw, area, ad, src, ground */
  function launch(from, to, ci, speed, kind, normal, extra) {
    let b = null; for (let i = 0; i < bolts.length; i++) { const x = bolts[(boltN + i) % bolts.length]; if (!x.live) { b = x; boltN = (boltN + i + 1) % bolts.length; break; } }
    if (!b) return;
    const e = extra || {};
    b.live = true; b.from.copy(from); b.p.copy(from); b.dir.copy(to).sub(from); b.total = b.left = b.dir.length(); b.dir.multiplyScalar(1 / (b.left || 1)); b.speed = speed; b.ci = ci; b.kind = kind;
    b.hp.copy(to); b.hasN = !!normal; if (normal) b.hn.copy(normal); b.top = e.top || null; b.zi = e.zi ?? -1; b.dmg = e.dmg || 0; b.head = !!e.head; b.friend = e.friend || null; b.mine = !!e.mine;
    b.cb.set(e.ball || COLORS[ci]); b.ct.set(e.col || COLORS[ci]); b.size = e.size || 1; b.lob = !!e.lob; b.arc = b.lob ? Math.min(2.2, 0.25 + b.total * 0.1) : 0; b.trailMax = e.trail ?? 0.9; b.tw = e.tw || 1;
    b.area = e.area || 0; b.ad = e.ad || 0; b.src = e.src || 'me'; b.ground = !!e.ground;
  }
  function arrive(b) {
    if (b.kind === 1) { splat(b.hp, b.hn, b.ci); paintBurst(b.hp, b.hn, COLORS[b.ci], 4); SFX.splat(panOf(b.hp), 1 / (1 + distTo(b.hp) * 0.08)); }
    else if (b.kind === 2 && b.top) { figureSplat(b.top, b.hp, b.hn, b.ci); paintBurst(b.hp, b.hn, COLORS[b.ci], 3); SFX.splat(panOf(b.hp), 1 / (1 + distTo(b.hp) * 0.08)); }
    else if (b.kind === 3) { hitZombie(b.zi, b.hp, b.ci, b.dmg, b.head, b.mine); }
    else if (b.kind === 4) burst(b);
  }
  /** a ball that bursts: the launcher's, the spitter's goo, the boss's shockwave. Damage to the zombies is the owner's; damage to me is mine (never my own shot) */
  function burst(b) {
    const nrm = b.hasN ? b.hn : UP, col = b.ground ? SHOCK : b.src === 'zombie' ? TOXIC : COLORS[b.ci];
    if (b.ground) shockwave(b.hp, b.area);
    else {
      explode(b.hp, nrm, col, b.area);
      if (b.hasN) {
        const ax = Math.abs(nrm.y) > 0.9 ? _f.set(1, 0, 0) : _f.set(0, 1, 0); _g.crossVectors(ax, nrm).normalize(); _e.crossVectors(nrm, _g).normalize();
        splat(b.hp, nrm, b.src === 'zombie' ? 3 : b.ci, b.src === 'zombie' ? 1.1 : 2.2);
        for (let k = 0; k < 4; k++) { _c.copy(b.hp).addScaledVector(_g, (rnd() - 0.5) * 2.2).addScaledVector(_e, (rnd() - 0.5) * 2.2); splat(_c, nrm, b.src === 'zombie' ? 3 : b.ci, 0.4 + rnd() * 0.5); }
      }
    }
    if (b.src !== 'zombie' && owner && zOn) aoeZombies(b.hp, b.area, b.ad);
    if (on && alive && !b.mine) {
      const m3 = body(); if (!m3) return; const dx = m3.x - b.hp.x, dz = m3.z - b.hp.z;
      if (b.ground) { const d = Math.hypot(dx, dz); if (d <= b.area && (m3.y || 0) < safeAbove()) hurt(Math.round(b.ad * (1 - 0.4 * d / b.area)), '🧟'); }
      else { const d = Math.hypot(dx, m3.y + level() + 1.0 - b.hp.y, dz); if (d <= b.area) hurt(Math.round(b.ad * (1 - 0.6 * d / b.area)), b.src === 'zombie' ? '🧟' : (b.friend || '🔫')); }
    }
  }
  function stepBalls(dt) {
    let n = 0;
    for (const b of bolts) {
      if (!b.live) continue;
      const step = Math.min(b.left, b.speed * dt); b.left -= step; let look = b.dir;
      if (b.lob) {                                                                          // the lobbed ball flies an arc above the straight line
        const t = 1 - b.left / (b.total || 1); b.p.copy(b.from).addScaledVector(b.dir, b.total * t); b.p.y += b.arc * 4 * t * (1 - t);
        look = _c.copy(b.dir).multiplyScalar(b.total); look.y += b.arc * 4 * (1 - 2 * t); look.normalize();
      } else b.p.addScaledVector(b.dir, step);
      if (b.left <= 0.001) { b.live = false; arrive(b); continue; }
      _mA.compose(b.p, _qI, _s.set(b.size, b.size, b.size)); balls.setMatrixAt(n, _mA); balls.setColorAt(n, b.cb);
      const len = Math.min(b.trailMax, b.left + 0.2, 0.4 + b.speed * 0.012); _a.copy(b.p).addScaledVector(look, -len / 2); _q.setFromUnitVectors(_b.set(0, 0, 1), look);
      _mB.compose(_a, _q, _s.set(b.tw, b.tw, len)); trails.setMatrixAt(n, _mB); trails.setColorAt(n, b.ct);
      n++;
    }
    balls.count = trails.count = n; balls.instanceMatrix.needsUpdate = trails.instanceMatrix.needsUpdate = true;
    if (n) { balls.instanceColor.needsUpdate = trails.instanceColor.needsUpdate = true; }
  }
  const distTo = p => camera.getWorldPosition(_d).distanceTo(p);
  const panOf = p => { camera.getWorldPosition(_d); _r.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q)); return clamp(_c.copy(p).sub(_d).normalize().dot(_r) * 0.9, -1, 1); };

  // ---------------------------------------------------------------- the gun you hold: a voxel model on the camera, with its parts moving, a kick and a flash
  // drawn last with its own depth (the first part clears the depth buffer), so it never goes through a wall and its parts hide each other right
  const gunMat = new THREE.MeshLambertMaterial({vertexColors: true, transparent: true, fog: false, emissive: '#2a2d33'});
  const flashTex = (() => {
    const rows = ['....o....', '....o....', '..o.y.o..', '...yyy...', 'ooyywyyoo', '...yyy...', '..o.y.o..', '....o....', '....o....'], cols = {o: '#ff9a1f', y: '#ffe27a', w: '#ffffff'};
    const c = document.createElement('canvas'); c.width = c.height = 9; const g = c.getContext('2d');
    rows.forEach((r, y) => { for (let x = 0; x < 9; x++) if (r[x] !== '.') { g.fillStyle = cols[r[x]]; g.fillRect(x, y, 1, 1); } });
    const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flashMat = new THREE.MeshBasicMaterial({map: flashTex, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false});
  const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat); muzzle.renderOrder = 999; muzzle.visible = false; muzzle.frustumCulled = false; muzzle.userData.noShot = true;
  const guns = WEAPONS.map(w => {
    const def = GUNS[w.id], g = new THREE.Group(); g.visible = false; g.rotation.y = 0.07; g.scale.setScalar(def.scale || 1); camera.add(g);
    const parts = def.parts.map((pd, pi) => {
      const [px, py, pz] = pd.pivot || [0, 0, 0];
      const m = new THREE.Mesh(boxGeo(THREE, pd.boxes.map(b => [b[0] / 100, b[1] / 100, b[2] / 100, (b[3] - px) / 100, (b[4] - py) / 100, (b[5] - pz) / 100, b[6]])), gunMat);
      m.position.set(px / 100, py / 100, pz / 100); m.frustumCulled = false; m.renderOrder = 998; m.userData.noShot = true; g.add(m);
      if (pi === 0) { m.renderOrder = 997; m.onBeforeRender = r => r.clearDepth(); }
      return {m, role: pd.role || 'static', amp: (pd.amp || 0) / 100, home: m.position.clone()};
    });
    return {g, parts, def, w};
  });
  let kick = 0, slideK = 0, pumpP = 1, spinA = 0, spinT = 0, spinUp = 0, swapAt = -9, flashUntil = 0, zoomWant = false, zoomK = 0, holding = false, bobT = 0, bobS = 0, lastX = null, lastZ = null, magAt = 0;
  const hasDrum = def => def.parts.some(p => p.role === 'spin') && !def.tip.includes(1e9);

  // ---------------------------------------------------------------- the zombies: a few instanced meshes, whatever their number
  const zmat = new THREE.MeshLambertMaterial({vertexColors: true, emissive: '#33523a', emissiveIntensity: 1.15, fog: false}), zmatV = new THREE.MeshLambertMaterial({vertexColors: true, emissive: '#34363a', emissiveIntensity: 1, fog: false}), eyeMat = new THREE.MeshBasicMaterial({color: '#ff3030', toneMapped: false, fog: false});
  const PARTS = {}, cnt = {torso: 0, torsoR: 0, torsoB: 0, torsoS: 0, torsoX: 0, head: 0, headX: 0};
  for (const [name, cap] of [['torso', 1], ['torsoR', 1], ['torsoB', 1], ['torsoS', 1], ['torsoX', 1], ['head', 1], ['headX', 1], ['eyes', 1], ['uparm', 2], ['forearm', 2], ['thigh', 2], ['shin', 2]]) {
    const m = new THREE.InstancedMesh(boxGeo(THREE, ZGEO[name]), name === 'eyes' ? eyeMat : /^(torso.|headX)$/.test(name) ? zmatV : zmat, MAXZ * cap);
    m.count = 0; m.frustumCulled = false; m.userData.noShot = true; m.raycast = () => {}; m.castShadow = name !== 'eyes' && !name.startsWith('head'); m.visible = false; scene.add(m); PARTS[name] = {mesh: m, per: cap};
  }
  const stains = new THREE.InstancedMesh(planeGeo, stainMat, MAXZ * 6); stains.count = 0; stains.frustumCulled = false; stains.userData.noShot = true; stains.raycast = () => {}; stains.visible = false; scene.add(stains);
  const PART_LIST = Object.values(PARTS), PART_NAMES = Object.keys(PARTS);
  const zs = []; let zOn = false, wave = 0, kills = 0, nextWaveAt = 0, zid = 0, zStart = 0, lastGroan = 0, owner = true, zHtml = '', bossPending = false;
  const TINTS = ['#ffffff', '#e8f0dc', '#f2e4d4', '#dfe8f0'].map(h => new Col(h)), FLASH = new Col('#ff6a6a'), WHITE = new Col('#ffffff'), TINT_T = ZT_LIST.map(t => new Col(t.tint || '#ffffff'));
  function newZombie(type, x, z0, id, now, hp) {
    const T0 = ZT_LIST[type];
    return {id, type, x, z: z0, yaw: rnd() * 6.28, vx: 0, vz: 0, phase: rnd() * 6.28, hp, maxhp: hp, state: 'rise', born: now, deadAt: 0, bite: 0, path: [], pathAt: -9, lastT: null, tname: undefined, flash: 0, stagger: 0, tint: (rnd() * TINTS.length) | 0,
            limp: 0.65 + rnd() * 0.5, nStains: 0, st: new Float32Array(6 * 4), tx: x, tz: z0, tyaw: 0, scale: 0.2, atkT: -1, atkNext: now + 2 + rnd() * 2, fired: false, sc: T0.scale};
  }
  const hpFor = (type, w) => Math.round(ZT_LIST[type].hp * (1 + ZOMBIES.hpPerWave * Math.max(0, w - 1)) * (type === 4 ? 1 + 0.3 * Math.max(0, Math.floor(w / ZOMBIES.bossEvery) - 1) : 1));
  const windOf = T0 => T0.spit ? T0.spit.wind : T0.slam ? T0.slam.wind : 1;
  const shortAng = (a, b, k) => a + angDiff(a, b) * k;
  /** a local pose matrix: translate, then rotate XYZ */
  const loc = (out, px, py, pz, rx, ry, rz) => { _eu.set(rx, ry, rz, 'XYZ'); _q.setFromEuler(_eu); return out.compose(_a.set(px, py, pz), _q, _one); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function poseZombie(z, i, now) {
    const T0 = ZT_LIST[z.type], sc = z.sc, ty = z.type, sp = Math.hypot(z.vx, z.vz), moving = clamp(sp / T0.speed, 0, 1.3), ph = z.phase;
    const dead = z.state === 'dead', k = dead ? clamp((now - z.deadAt) / 0.55, 0, 1) : 0;
    // the root: place, turn, and a fall onto the back when dead (it slides a little, then sinks and shrinks)
    _eu.set(-k * 1.45, z.yaw, 0, 'YXZ'); _q.setFromEuler(_eu);
    const dis = dead ? clamp((now - z.deadAt - 1.6) / 1.2, 0, 1) : 0, g = z.scale * (1 - dis * 0.9);
    _mR.compose(_a.set(z.x, level() - dis * 0.35 + (dead ? 0.18 * k * sc[1] : 0), z.z), _q, _s.set(g * sc[0], g * sc[1], g * sc[2]));
    // an attack in progress: the wind-up (0..1) and the strike that follows
    const wd = windOf(T0), at = z.atkT, wp = at >= 0 ? clamp(at / wd, 0, 1) : 0, st = at > wd ? clamp((at - wd) / 0.25, 0, 1) : 0;
    // the body sways: lean forward, roll with the steps, a hit throws it back
    const hit = z.stagger > 0 ? Math.min(1, z.stagger / 0.25) : 0;
    let lean = dead ? 0 : 0.16 + 0.05 * Math.sin(ph * 0.5) - hit * 0.45;
    if (!dead) { if (ty === 1) lean += 0.38 * moving; else if (ty === 3) lean += -0.5 * wp + 0.7 * st; else if (ty === 4) lean += -0.4 * wp + 0.9 * st; }
    const roll = dead ? 0 : (ty === 2 ? 0.14 : 0.08) * Math.sin(ph * 0.5 + 1) * moving;
    loc(_mA, 0, 0.88, 0, 0, 0, 0).premultiply(_mR);                                        // the hips
    loc(_mB, 0, 0, 0, lean, 0, roll).premultiply(_mA);                                     // the torso hangs from the hips
    const tn = T0.torso, hn = T0.head || 'head';
    PARTS[tn].mesh.setMatrixAt(cnt[tn], _mB);
    loc(_mC, 0, 0.66, 0, dead ? 0.3 : 0.1 * Math.sin(ph * 0.37) + hit * 0.5 + (ty === 3 ? -0.9 * wp + 0.9 * st : 0), 0.15 * Math.sin(ph * 0.29), 0.12 * Math.sin(ph * 0.43)).premultiply(_mB);
    PARTS[hn].mesh.setMatrixAt(cnt[hn], _mC); PARTS.eyes.mesh.setMatrixAt(i, _mC);
    const armBase = at < 0 || ty === 3 ? T0.arms : (at < wd ? lerp(T0.arms, -3.0, wp) : lerp(-3.0, -0.2, st));
    for (let s = 0; s < 2; s++) {                                                          // arms forward, swinging a little, the forearm bent up
      const sg = s ? 1 : -1, swing = ty === 1 ? 0.55 * Math.sin(ph + s * Math.PI) * moving : 0.14 * Math.sin(ph + s * 2.2) * (0.5 + moving * 0.5);
      loc(_mD, sg * 0.30, 0.56, 0, dead ? -0.2 : armBase + swing - hit * 0.5, 0, -sg * 0.08 - (ty === 2 ? 0.18 : 0)).premultiply(_mB); PARTS.uparm.mesh.setMatrixAt(i * 2 + s, _mD);
      loc(_mT, 0, -0.30, 0, dead ? -0.3 : -0.32 - swing * 0.6, 0, 0).premultiply(_mD); PARTS.forearm.mesh.setMatrixAt(i * 2 + s, _mT);
    }
    for (let s = 0; s < 2; s++) {                                                          // legs: one drags (the runner pumps both, the brute stomps)
      const sg = s ? 1 : -1, amp = (ty === 1 ? 0.95 : ty === 2 ? 0.4 : (s ? 0.40 : 0.62) * z.limp) * moving;
      const a = dead ? (s ? 0.25 : -0.1) : Math.sin(ph + s * Math.PI) * amp, bend = dead ? 0.3 : Math.max(0, -Math.sin(ph + s * Math.PI + 0.6)) * (ty === 1 ? 1.1 : 0.7) * moving + 0.05;
      loc(_mD, sg * 0.11, 0, 0, a, 0, 0).premultiply(_mA); PARTS.thigh.mesh.setMatrixAt(i * 2 + s, _mD);
      loc(_mT, 0, -0.40, 0, bend, 0, 0).premultiply(_mD); PARTS.shin.mesh.setMatrixAt(i * 2 + s, _mT);
    }
    // one tint per kind (the walkers vary a little), a flash of red when it is hit
    if (z.flash > 0) { _col.copy(FLASH).multiplyScalar(1 + z.flash * 3); _col2.copy(_col); } else { _col.copy(ty === 0 ? TINTS[z.tint] : TINT_T[ty]); _col2.copy(ty === 0 ? TINTS[z.tint] : WHITE); }
    PARTS[tn].mesh.setColorAt(cnt[tn], _col2); PARTS[hn].mesh.setColorAt(cnt[hn], _col); cnt[tn]++; cnt[hn]++;
    for (const nm of ['uparm', 'forearm', 'thigh', 'shin']) for (let s = 0; s < 2; s++) PARTS[nm].mesh.setColorAt(i * 2 + s, _col);
    // the paint on it: small splashes fixed to the zombie's own frame
    for (let q = 0; q < Math.min(z.nStains, 6); q++) {                                         // each stain: x, y, front or back (+1 / -1), colour
      const o = q * 4; _eu.set(0, z.st[o + 2] < 0 ? Math.PI : 0, 0); _q.setFromEuler(_eu);
      _mH.compose(_a.set(z.st[o], z.st[o + 1], z.st[o + 2] * (T0.depth + 0.004)), _q, _s.set(0.3, 0.3, 1)).premultiply(_mB);
      const idx = stains.count++; stains.setMatrixAt(idx, _mH); stains.setColorAt(idx, _col2.set(COLORS[z.st[o + 3] | 0]));
    }
  }
  /** a place for a new zombie: far from me, on the floor, with a route to me */
  function spawnSpot(me3, minD) {
    for (let tries = 0; tries < 60; tries++) {
      const x = (rnd() - 0.5) * (size[0] - 2), z0 = (rnd() - 0.5) * (size[1] - 2);
      if (Math.hypot(x - me3.x, z0 - me3.z) < minD || (floor && (floor.blocked(x, z0, 0.3) || !floor.route({x, z: z0}, me3)))) continue;
      return [x, z0];
    }
    return null;
  }
  function startWave(now) {
    wave++; const me3 = body(); if (!me3) return;
    for (let i = zs.length - 1; i >= 0; i--) if (zs[i].state === 'dead') zs.splice(i, 1);                // the bodies of the last wave are gone: room for the new ones
    const mix = waveMix(wave); bossPending = mix.boss;
    const kinds = [...Array(mix.walkers).fill(0), ...Array(mix.runners).fill(1), ...Array(mix.brutes).fill(2), ...Array(mix.spitters).fill(3)];
    for (const type of kinds) { if (zs.length >= MAXZ - 1) break; const p = spawnSpot(me3, ZOMBIES.spawnMin); if (p) zs.push(newZombie(type, p[0], p[1], ++zid, now, hpFor(type, wave))); }
    el.msg.textContent = T().next(wave); setTimeout(() => { if (alive) el.msg.textContent = ''; }, 1600);
  }
  function spawnBoss(now) {
    const me3 = body(); if (!me3 || zs.length >= MAXZ) return; const p = spawnSpot(me3, 9) || spawnSpot(me3, 4); if (!p) return;
    zs.push(newZombie(4, p[0], p[1], ++zid, now, hpFor(4, wave))); bossAlert(); SFX.groan(0, 1, 4);
  }
  function bossAlert() { el.msg.textContent = T().bossIn; setTimeout(() => { if (alive) el.msg.textContent = ''; }, 2400); }
  function clearZombies() { zs.length = 0; for (const p of PART_LIST) { p.mesh.count = 0; p.mesh.visible = false; } stains.count = 0; stains.visible = false; el.boss.style.display = 'none'; }
  const showZombies = () => { for (const p of PART_LIST) p.mesh.visible = true; stains.visible = true; };
  function restartZombies(now) { clearZombies(); wave = 0; kills = 0; bossPending = false; zRunDone = false; nextWaveAt = now + 1.5; showZombies(); }
  function zombieAt(id) { for (const z of zs) if (z.id === id) return z; return null; }
  const friendAlive = () => { for (const o of others.values()) if (o.z && o.hp > 0) return true; return false; };
  /** a hit on zombie `id`: knock it back, paint it, hurt it (the owner of the zombies applies the damage) */
  function hitZombie(id, point, ci, dmg, head, mine) {
    const z = zombieAt(id); if (!z || z.state === 'dead') return;
    z.flash = 1; z.stagger = 0.25;
    const o = (z.nStains++ % 6) * 4, dx = point.x - z.x, dz = point.z - z.z, c = Math.cos(z.yaw), sn = Math.sin(z.yaw), lz = dx * sn + dz * c;
    z.st[o] = clamp((dx * c - dz * sn) / z.sc[0], -0.25, 0.25); z.st[o + 1] = clamp((point.y - level()) / z.sc[1] - 0.88, 0.05, 0.62); z.st[o + 2] = lz < 0 ? -1 : 1; z.st[o + 3] = ci;
    paintBurst(point, _n.set(point.x - z.x, 0.3, point.z - z.z).normalize(), COLORS[ci], 4, 1.8);
    SFX.zhit(panOf(point), 1 / (1 + distTo(point) * 0.08));
    if (owner) {
      z.hp -= dmg * (head ? ZOMBIES.headMul : 1);
      if (z.hp <= 0) killZombie(z, performance.now() / 1000);
    }                                                                                          // a follower only shows it: the owner takes the damage from the shot record
  }
  /** the burst of a grenade (or any area): everyone alive inside it, less the farther from the centre (the owner's job) */
  function aoeZombies(p, radius, dmg) {
    const now = performance.now() / 1000;
    for (const z of zs) {
      if (z.state === 'dead') continue;
      const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, 0.9 * z.sc[1] + level() - p.y, dz), reach = radius + 0.45 * z.sc[0];
      if (d > reach) continue;
      z.flash = 1; z.stagger = 0.4; z.hp -= dmg * (1 - 0.6 * clamp(d / reach, 0, 1)); const dd = Math.hypot(dx, dz) || 1; z.vx += dx / dd * 3.5; z.vz += dz / dd * 3.5;
      if (z.hp <= 0) killZombie(z, now);
    }
  }
  function killZombie(z, now) {
    z.state = 'dead'; z.deadAt = now; z.atkT = -1; kills++; nextWaveAt = now + ZOMBIES.pause; SFX.zdie(panOf(_a.set(z.x, 1, z.z)), 1 / (1 + distTo(_a) * 0.08));
    _b.set(z.x, 1.0 * z.sc[1] + level(), z.z); paintBurst(_b, UP, z.type === 3 ? TOXIC : '#7ea06a', 8, 2.6);
  }
  /** the targets of the zombies: me if I am up, and the friends who play the zombie mode and are up */
  const tgs = []; let tgN = 0;
  function targets(me3) {
    tgN = 0; const add = (x, y, z0, name) => { const t = tgs[tgN] || (tgs[tgN] = {x: 0, y: 0, z: 0, name: null}); t.x = x; t.y = y; t.z = z0; t.name = name; tgN++; };
    if (alive && me3) add(me3.x, me3.y || 0, me3.z, null);
    if (others.size) { const roots = players(); for (const [n, o] of others) { const r = o.z && o.hp > 0 && roots.get(n); if (r) { r.getWorldPosition(_a); add(_a.x, _a.y - level(), _a.z, n); } } }
  }
  /** the spitter's goo: a ball that flies to where the target stands (or to the wall in between), bursts and hurts whoever is near */
  function spitAt(z, tg) {
    const S = ZT.spitter.spit;
    _b.set(z.x + Math.sin(z.yaw) * 0.3, 1.45 * z.sc[1] + level(), z.z + Math.cos(z.yaw) * 0.3); _a.set(tg.x, tg.y + 1.1 + level(), tg.z); _d.copy(_a).sub(_b); const dist = _d.length(); _d.normalize();
    ray.set(_b, _d); ray.near = 0.2; ray.far = dist;
    const hit = ray.intersectObjects(scene.children, true).find(h => { for (let o = h.object; o; o = o.parent) if (o.userData.noShot || !o.visible) return false; return !h.object.isSprite && !h.object.isLine && !h.object.isPoints && !h.object.userData.person; });
    let n = null;
    if (hit) { _a.copy(hit.point); _n.copy(hit.face ? hit.face.normal : UP).transformDirection(hit.object.matrixWorld); if (_n.dot(_d) > 0) _n.negate(); n = _n; }
    launch(_b, _a, 3, S.speed, 4, n, {ball: TOXIC, col: TOXIC, size: 2, lob: true, area: S.area, ad: S.dmg, src: 'zombie', trail: 0.5});
    out.push({id: ++shotId, o: [r2(_b.x), r2(_b.y), r2(_b.z)], p: [r2(_a.x), r2(_a.y), r2(_a.z)], n: n ? [r2(n.x), r2(n.y), r2(n.z)] : null, h: null, d: 0, c: 3, w: 7});
    SFX.spit(panOf(_b), 1 / (1 + distTo(_b) * 0.08)); publish();
  }
  /** the boss's blow: a shockwave on the floor around it; a jump over it is safe */
  function slamAt(z) {
    const S = ZT.boss.slam; _a.set(z.x, 0.05 + level(), z.z);
    launch(_a, _a, 0, 999, 4, UP, {size: 0, area: S.radius, ad: S.dmg, src: 'zombie', ground: true});
    out.push({id: ++shotId, o: [r2(z.x), r2(0.05 + level()), r2(z.z)], p: [r2(z.x), r2(0.05 + level()), r2(z.z)], n: [0, 1, 0], h: null, d: 0, c: 0, w: 8}); publish();
  }
  function stepZombies(dt, now) {
    if (!zOn) return;
    const me3 = body(), live = !!(pov() && me3);
    for (const k in cnt) cnt[k] = 0; stains.count = 0;
    if (live && owner) {
      if (!zs.some(z => z.state !== 'dead') && now >= nextWaveAt && (alive || friendAlive())) { if (bossPending) { bossPending = false; spawnBoss(now); } else startWave(now); }
      for (let i = zs.length - 1; i >= 0; i--) if (zs[i].state === 'dead' && now - zs[i].deadAt > 3.2) zs.splice(i, 1);
    } else if (!owner) {
      for (let i = zs.length - 1; i >= 0; i--) if (zs[i].state === 'dead' && now - zs[i].deadAt > 3.2) zs.splice(i, 1);
    }
    if (owner) targets(me3);
    const nz = Math.min(zs.length, MAXZ);
    for (let i = 0; i < nz; i++) {
      const z = zs[i], T0 = ZT_LIST[z.type];
      z.flash = Math.max(0, z.flash - dt * 4); z.stagger = Math.max(0, z.stagger - dt);
      if (z.state === 'rise') { z.scale = Math.min(1, z.scale + dt * (z.type === 4 ? 0.9 : 1.6)); if (z.scale >= 1) z.state = 'walk'; }
      if (z.state !== 'dead' && (live || !owner)) {
        if (owner) {
          let tg = null, dist = 1e9; for (let t = 0; t < tgN; t++) { const d = Math.hypot(tgs[t].x - z.x, tgs[t].z - z.z); if (d < dist) { dist = d; tg = tgs[t]; } }
          if (tg) {
            const moved = z.lastT ? Math.hypot(tg.x - z.lastT.x, tg.z - z.lastT.z) : 99;
            if (now - z.pathAt > 3 || z.tname !== tg.name || (moved > 2 && now - z.pathAt > 0.8)) {
              z.pathAt = now + rnd() * 0.3; if (!z.lastT) z.lastT = {x: 0, z: 0}; z.lastT.x = tg.x; z.lastT.z = tg.z; z.tname = tg.name; z.path = floor ? (floor.route({x: z.x, z: z.z}, {x: tg.x, z: tg.z}) || []) : [];
            }
          }
          // the special attacks: the spitter spits from a distance, the boss slams the floor when close
          if (tg && z.atkT < 0 && now >= z.atkNext && z.stagger <= 0 && now - z.born > 1) {
            if (T0.spit && dist < T0.spit.range && dist > T0.spit.min) z.atkT = 0;
            else if (T0.slam && dist < T0.slam.radius - 0.4) z.atkT = 0;
          }
          let hold = false;
          if (z.atkT >= 0) {
            z.atkT += dt; hold = true; const wd = windOf(T0);
            if (T0.spit && z.stagger > 0.2 && !z.fired) { z.atkT = -1; z.atkNext = now + 1.2; hold = false; }
            else {
              if (!z.fired && z.atkT >= wd && tg) { z.fired = true; if (T0.spit) spitAt(z, tg); else slamAt(z); }
              if (z.atkT >= wd + 0.4) { z.atkT = -1; z.fired = false; z.atkNext = now + (T0.spit ? T0.spit.every : T0.slam.every) + rnd() * 0.8; }
            }
          }
          let wx = 0, wz = 0;
          const approach = tg && !hold && z.stagger <= 0 && (T0.spit ? (dist > T0.spit.hold || dist < T0.spit.min) : dist > T0.reach);
          if (approach) {
            while (z.path.length > 1 && Math.hypot(z.path[0].x - z.x, z.path[0].z - z.z) < 0.35) z.path.shift();
            const t = z.path[0] || tg, dx = t.x - z.x, dz = t.z - z.z, d = Math.hypot(dx, dz) || 1, sp = T0.speed * (0.8 + 0.35 * Math.sin(z.phase * 0.5));   // it lurches
            wx = dx / d * sp; wz = dz / d * sp;
          }
          if (tg && dist < T0.reach * 0.6 && dist > 1e-3) { wx -= (tg.x - z.x) / dist * 1.2; wz -= (tg.z - z.z) / dist * 1.2; }
          for (let j = 0; j < nz; j++) if (j !== i && zs[j].state !== 'dead') { const dx = z.x - zs[j].x, dz = z.z - zs[j].z, d2 = dx * dx + dz * dz, rr = 0.3 * z.sc[0] * zs[j].sc[0]; if (d2 < rr && d2 > 1e-6) { const d = Math.sqrt(d2); wx += dx / d * 0.5; wz += dz / d * 0.5; } }
          const k = 1 - Math.exp(-5 * dt); z.vx += (wx - z.vx) * k; z.vz += (wz - z.vz) * k; z.x += z.vx * dt; z.z += z.vz * dt;
          const minD = T0.near;                                   // never closer than this to anyone it hunts: a zombie inside the camera is a green wall
          for (let t = 0; t < tgN; t++) { const dx = z.x - tgs[t].x, dz = z.z - tgs[t].z, d = Math.hypot(dx, dz); if (d < minD) { if (d > 1e-3) { z.x = tgs[t].x + dx / d * minD; z.z = tgs[t].z + dz / d * minD; } else z.x += minD; } }
          const sp = Math.hypot(z.vx, z.vz);
          if (sp > 0.05 && !hold) z.yaw = shortAng(z.yaw, Math.atan2(z.vx, z.vz), 1 - Math.exp(-8 * dt)); else if (tg) z.yaw = shortAng(z.yaw, Math.atan2(tg.x - z.x, tg.z - z.z), 1 - Math.exp(-6 * dt));
          z.phase += sp * dt * 5.5;
          if (tg && z.atkT < 0 && dist <= T0.reach + 0.25 && tg.y < safeAbove() && now - z.bite > T0.biteEvery && now - z.born > 0.8) {
            z.bite = now; SFX.bite();
            if (tg.name === null) hurt(T0.bite, '🧟');
            else { out.push({id: ++shotId, o: [r2(z.x), 1, r2(z.z)], p: [r2(z.x), 1, r2(z.z)], n: null, h: tg.name, d: T0.bite, c: 0, w: 9}); publish(); }
          }
          if (now - lastGroan > 1.8 + rnd() * 2 && dist < 14 && rnd() < dt * 0.6) { lastGroan = now; SFX.groan(panOf(_a.set(z.x, 1.2 + level(), z.z)), 1 / (1 + dist * 0.12), z.type); }
        } else {                                                                           // a follower: glide to where the owner says it is
          const k = 1 - Math.exp(-9 * dt), ox = z.x, oz = z.z; z.x += (z.tx - z.x) * k; z.z += (z.tz - z.z) * k; z.vx = (z.x - ox) / Math.max(dt, 1e-3); z.vz = (z.z - oz) / Math.max(dt, 1e-3);
          const sp = Math.hypot(z.vx, z.vz); if (sp > 0.05) z.yaw = shortAng(z.yaw, z.tyaw, 1 - Math.exp(-8 * dt)); z.phase += sp * dt * 5.5;
          if (z.atkT >= 0) z.atkT += dt;
        }
      }
      poseZombie(z, i, now);
    }
    for (const name of PART_NAMES) { const p = PARTS[name]; p.mesh.count = name in cnt ? cnt[name] : nz * p.per; p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    stains.instanceMatrix.needsUpdate = true; if (stains.instanceColor) stains.instanceColor.needsUpdate = true;
    let left = 0, bz = null; for (let i = 0; i < zs.length; i++) if (zs[i].state !== 'dead') { left++; if (zs[i].type === 4) bz = zs[i]; }
    const html = `<div>${pix(ICONS.wave, 3)}<span class="o-big">${wave}</span><small>${T().wave}</small></div><div>${pix(ICONS.skull, 4)}<span class="o-big">${kills}</span><small>${T().kills}</small></div><div>${pix(ICONS.zombie, 4)}<span class="o-big">${left}</span><small>${T().left}</small></div>`; if (html !== zHtml) { zHtml = html; el.z.innerHTML = html; }
    el.boss.style.display = bz ? 'block' : 'none'; if (bz) { el.bname.textContent = T().boss; el.bbar.style.width = clamp(bz.hp / (bz.maxhp || 1) * 100, 0, 100) + '%'; }
    let near = 99; for (const z of zs) if (z.state !== 'dead' && me3) near = Math.min(near, Math.hypot(me3.x - z.x, me3.z - z.z));
    el.vig.classList.toggle('o-near', near < 3.5);
  }
  /** a ray against the zombies (spheres on the head and the body): the nearest hit, or null */
  function rayZombies(origin, dir, maxT) {
    let best = null, bt = maxT;
    for (const z of zs) {
      if (z.state === 'dead') continue;
      const s = z.scale, sy = z.sc[1] * s, sr = Math.max(z.sc[0], z.sc[2]) * s;
      for (let k = 0; k < 4; k++) {
        const cy = (k === 0 ? 1.62 : k === 1 ? 1.28 : k === 2 ? 0.9 : 0.4) * sy + level(), r = (k === 0 ? 0.2 : k === 1 ? 0.3 : k === 2 ? 0.32 : 0.28) * sr;
        _a.set(z.x - origin.x, cy - origin.y, z.z - origin.z); const tca = _a.dot(dir); if (tca < 0) continue;
        const d2 = _a.lengthSq() - tca * tca; if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2); if (t < bt && t > 0.2) { bt = t; best = {z, t, head: k === 0}; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- the game
  const ammo = WEAPONS.map(w => w.mag); let reloadUntil = 0, reloadStart = 0;
  // the leaderboards: a zombie run counts once (when I am out for good, or switch it off), the paintball when it ends if I hit a friend
  let zRunDone = false, pbHits = 0;
  function reportRun() { if (!zRunDone && zOn && kills > 0) { zRunDone = true; report({game: 'zombie', score: kills, extra: wave}); } }
  function reportPaint() { if (pbHits > 0) report({game: 'paintball', score: pbHits}); pbHits = 0; }
  let on = false, hp = RULES.hp, weapon = 0, alive = true, respawnAt = 0, nextShot = 0, deaths = 0, shotId = 0, flashT = 0, hitT = 0;
  let out = [];                                                                           // my last shots, with their numbers
  const others = new Map();                                                               // name -> {hp, w, k, seen, z, zt}
  const publish = () => sink(on ? snapshot() : null);
  function snapshot() {
    const s = {on: true, hp: Math.round(hp), w: weapon, k: deaths, shots: out.slice(-RULES.shots)};
    if (zOn) {
      s.z = 1; s.zt = zStart; s.zw = wave; s.zk = kills;
      if (owner) s.zs = zs.slice(0, MAXZ).map(z => ({i: z.id, x: r2(z.x), z: r2(z.z), r: r2(z.yaw), h: Math.max(0, Math.round(z.hp)), s: z.state === 'dead' ? 2 : z.state === 'rise' ? 1 : 0, t: z.type, m: Math.round(z.maxhp), a: z.atkT < 0 ? 0 : z.atkT < windOf(ZT_LIST[z.type]) ? 1 : 2}));
    }
    return s;
  }
  let hudFor = '', ammoHtml = '', othersHtml = '';
  function drawHud() {
    const L = lang(), w = WEAPONS[weapon], reloading = performance.now() / 1000 < reloadUntil;
    el.hpnum.textContent = Math.round(hp); el.bar.style.width = Math.max(0, hp) + '%'; el.bar.style.background = hp > 50 ? '#43a047' : hp > 25 ? '#fb8c00' : '#e53935'; el.hpbox.classList.toggle('o-low', hp <= 30);
    if (hudFor !== weapon + L) {                                                            // the slots and the big icon only change with the weapon (not with every shot)
      hudFor = weapon + L;
      el.slots.innerHTML = WEAPONS.map((x, i) => `<div class="o-pnt-slot${i === weapon ? ' o-on' : ''}"><b>${i + 1}</b>${pix(ICONS[x.id], 2)}</div>`).join('');
      el.gicon.innerHTML = pix(ICONS[w.id], 5); el.gname.textContent = w[L] || w.it;
    }
    el.ammo.classList.toggle('o-empty', reloading || ammo[weapon] === 0);
    { const h = reloading ? `<small>${T().reload}</small>` : `${ammo[weapon]}<small>/ ${T().free}</small>`; if (h !== ammoHtml) { ammoHtml = h; el.ammo.innerHTML = h; } }
    el.others.style.display = others.size ? '' : 'none';
    { const h = [...others].map(([n, o]) => `<div>${n.replace(/[<>&"]/g, '')} · ${o.hp}<div class="o-pnt-bar"><i style="width:${o.hp}%;background:${o.hp > 50 ? '#43a047' : o.hp > 25 ? '#fb8c00' : '#e53935'}"></i></div></div>`).join(''); if (h !== othersHtml) { othersHtml = h; el.others.innerHTML = h; } }
  }
  function hurt(d, by) {
    if (!alive) return;
    hp = Math.max(0, hp - d); flashT = performance.now() / 1000 + 0.3; el.flash.classList.add('o-on'); SFX.hurt();
    if (hp <= 0) { alive = false; deaths++; respawnAt = performance.now() / 1000 + RULES.respawn; zoomWant = false; holding = false; if (zOn && !friendAlive()) reportRun(); el.msg.textContent = zOn && !friendAlive() ? T().over(Math.max(1, wave), kills) : T().out(RULES.respawn); }
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
  /** the muzzle, in the world: the tip of the model of the gun in hand */
  function muzzlePos(target) { const g = guns[weapon]; g.g.updateMatrixWorld(true); return g.g.localToWorld(target.set(g.def.tip[0] / 100, g.def.tip[1] / 100, g.def.tip[2] / 100)); }
  const zoomFactor = () => (zoomK > 0.001 && WEAPONS[weapon].zoom ? 1 - zoomK * (1 - 1 / WEAPONS[weapon].zoom) : 1);
  function setWeapon(i) {
    if (i === weapon || i < 0 || i >= WEAPONS.length) return;
    weapon = i; reloadUntil = 0; swapAt = performance.now() / 1000; zoomWant = false; spinUp = 0;
    guns[weapon].g.add(muzzle); const t = guns[weapon].def.tip; muzzle.position.set(t[0] / 100, t[1] / 100, t[2] / 100);
    blip({f0: 500, f1: 800, type: 'square', dur: 0.04, gain: 0.05}); drawHud(); publish();
  }
  function startReload(now) {
    const w = WEAPONS[weapon]; if (now < reloadUntil || ammo[weapon] >= w.mag) return;
    reloadStart = now; reloadUntil = now + w.reload; zoomWant = false;
    blip({f0: 600, f1: 300, type: 'square', dur: 0.06, gain: 0.08}); setTimeout(() => blip({f0: 450, f1: 250, type: 'square', dur: 0.05, gain: 0.07}), w.reload * 380); setTimeout(() => blip({f0: 900, f1: 500, type: 'square', dur: 0.06, gain: 0.08}), w.reload * 900); drawHud();
  }
  /** a cartridge case thrown out of the gun (brass, or red for the shotgun) */
  function eject(wi) {
    const g = guns[wi], d = g.def; if (!d.eject) return;
    g.g.updateMatrixWorld(true); g.g.localToWorld(_e.set(d.eject[0] / 100, d.eject[1] / 100, d.eject[2] / 100)); camera.getWorldQuaternion(_q);
    _f.set(1, 0, 0).applyQuaternion(_q); _g.set(0, 1, 0).applyQuaternion(_q); _c.set(0, 0, -1).applyQuaternion(_q);
    spawn(bits, _e.x, _e.y, _e.z, _f.x * (1.3 + rnd()) + _g.x * (1.1 + rnd() * 0.5) - _c.x * 0.3, _f.y * (1.3 + rnd()) + _g.y * (1.1 + rnd() * 0.5), _f.z * (1.3 + rnd()) + _g.z * (1.1 + rnd() * 0.5) - _c.z * 0.3, 1.6, wi === 2 ? 0.022 : 0.014, wi === 2 ? '#e53935' : '#e0b040', 9, 0.45);
  }
  /** the world in front of a ray: the nearest thing that counts (not the effects, not me) */
  function worldHit(o, d, far) {
    ray.set(o, d); ray.near = 0.25; ray.far = far;
    return ray.intersectObjects(scene.children, true).find(h => {
      for (let p = h.object; p; p = p.parent) if (p.userData.noShot || p === camera || !p.visible) return false;
      return !h.object.isSprite && !h.object.isLine && !h.object.isPoints && h.object.userData.person !== me();
    });
  }
  function shootOnce(w) {
    if (ammo[weapon] <= 0) return startReload(performance.now() / 1000);
    ammo[weapon]--;
    camera.getWorldPosition(_o); camera.getWorldDirection(_d); _u.set(0, 1, 0); _r.crossVectors(_d, _u).normalize(); _u.crossVectors(_r, _d).normalize();
    const bx = _d.x, by = _d.y, bz = _d.z, ci = hashName(me()) % COLORS.length;
    muzzlePos(_c); const mx = _c.x, my = _c.y, mz = _c.z;
    const spread = w.zoom && zoomK > 0.8 ? 0.0006 : w.spread;
    for (let k = 0; k < w.pellets; k++) {
      _d.set(bx, by, bz).addScaledVector(_r, (rnd() - 0.5) * 2 * spread).addScaledVector(_u, (rnd() - 0.5) * 2 * spread).normalize();
      const hit = worldHit(_o, _d, w.range);
      const zh = zOn ? rayZombies(_o, _d, hit ? hit.distance : w.range) : null;
      const look = {ball: null, col: w.tracer, trail: w.trail, tw: w.tw, size: w.size};
      let friend = null;
      if (w.area) {                                                                       // the launcher: a lobbed ball that bursts where the ray ends
        const to = zh ? _a.copy(_o).addScaledVector(_d, zh.t) : hit ? _a.copy(hit.point) : _a.copy(_o).addScaledVector(_d, w.range); let nrm = null;
        if (zh) nrm = _n.copy(_d).negate(); else if (hit) { surface(hit); nrm = _n; }
        _b.set(mx, my, mz); launch(_b, to, ci, w.speed, 4, nrm, {...look, lob: true, area: w.area, ad: w.areaDamage, src: 'me', mine: true});
        out.push({id: ++shotId, o: [r2(mx), r2(my), r2(mz)], p: [r2(to.x), r2(to.y), r2(to.z)], n: nrm ? [r2(nrm.x), r2(nrm.y), r2(nrm.z)] : null, h: null, d: 0, c: ci, w: weapon});
      } else if (zh) {                                                                    // a zombie is nearer than the wall behind it
        _a.copy(_o).addScaledVector(_d, zh.t); _b.set(mx, my, mz); _n.copy(_d).negate();
        launch(_b, _a, ci, w.speed, 3, _n, {...look, zi: zh.z.id, dmg: w.damage, head: zh.head, mine: true});
        out.push({id: ++shotId, o: [r2(mx), r2(my), r2(mz)], p: [r2(_a.x), r2(_a.y), r2(_a.z)], n: null, h: null, d: 0, c: ci, zi: zh.z.id, zd: Math.round(w.damage * (zh.head ? ZOMBIES.headMul : 1)), w: weapon});
        hitT = performance.now() / 1000; el.cross.classList.add('o-hit'); SFX.tick();
      } else {
        const to = hit ? _a.copy(hit.point) : _a.copy(_o).addScaledVector(_d, w.range); _b.set(mx, my, mz);
        if (hit) {
          const r = surface(hit); friend = r.friend;
          if (r.figure) launch(_b, to, ci, w.speed, 2, _n, {...look, top: r.figure}); else launch(_b, to, ci, w.speed, 1, _n, look);
          if (friend) { pbHits++; hitT = performance.now() / 1000; el.cross.classList.add('o-hit'); SFX.tick(); }
        } else launch(_b, to, ci, w.speed, 0, null, look);
        out.push({id: ++shotId, o: [r2(mx), r2(my), r2(mz)], p: [r2(to.x), r2(to.y), r2(to.z)], n: hit ? [r2(_n.x), r2(_n.y), r2(_n.z)] : null, h: friend, d: friend ? Math.round(w.damage * (w.pvp ?? 1)) : 0, c: ci, w: weapon});
      }
    }
    if (out.length > RULES.shots * 2) out = out.slice(-RULES.shots);
    const nowS = performance.now() / 1000, g = guns[weapon];
    SFX.shot(weapon, 0); kick = Math.min(1.6, kick + w.kick); slideK = 1; if (g.parts.some(p => p.role === 'pump')) pumpP = 0; if (g.parts.some(p => p.role === 'spin') && !w.spin) spinT += Math.PI / 3;
    flashUntil = nowS + (w.id === 'sniper' ? 0.07 : 0.05); muzzle.rotation.z = rnd() * 6.28; muzzle.scale.setScalar(g.def.flash * (0.8 + rnd() * 0.5)); flashMat.color.set(w.tracer).lerp(WHITE, 0.55);
    muzzlePos(_e); _f.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(_q)); for (let k = 0; k < (w.pellets > 1 ? 4 : 2); k++) spawn(smoke, _e.x, _e.y, _e.z, _f.x * 0.8 + (rnd() - 0.5) * 0.5, _f.y * 0.8 + 0.4 + rnd() * 0.3, _f.z * 0.8 + (rnd() - 0.5) * 0.5, 0.5 + rnd() * 0.3, 0.03, '#d0d4da', -0.6, 0, 2.4);
    if (w.id === 'shotgun' || w.id === 'sniper') { const wi = weapon; setTimeout(() => { if (on && weapon === wi) eject(wi); }, 420); } else eject(weapon);
    el.cross.classList.add('o-fire'); setTimeout(() => el.cross.classList.remove('o-fire'), 70);
    camera.fov += RULES.recoil * w.kick * 2 * zoomFactor(); camera.updateProjectionMatrix();
    if (ammo[weapon] <= 0) startReload(nowS); else drawHud();
    publish();
  }
  function fire() {
    if (!on || !alive) return;
    if (!pov()) return say(T().pov);
    const now = performance.now() / 1000, w = WEAPONS[weapon];
    if (now < nextShot || now < reloadUntil) return;
    if (ammo[weapon] <= 0) return startReload(now);
    if (w.spin && spinUp < w.spin) return;                                                // the minigun fires once its barrels are spinning
    nextShot = now + (w.spin ? w.cooldown / clamp(spinUp, 0.4, 1) : w.cooldown);
    shootOnce(w);
  }
  /** a friend's shot, drawn here: the ball in flight, then the splash; the damage if it hit me, or a zombie of mine */
  function effect(s, by) {
    const wi = s.w | 0;
    if (wi === 9) { if (on && s.h === me()) { SFX.bite(); hurt(s.d, '🧟'); } return; }          // a bite from a zombie of theirs
    _b.set(s.o[0], s.o[1], s.o[2]); _a.set(s.p[0], s.p[1], s.p[2]);
    if (wi === 7 || wi === 8) {                                                           // goo or shockwave of a zombie of theirs
      const slam = wi === 8, S = slam ? ZT.boss.slam : ZT.spitter.spit;
      launch(_b, _a, 3, slam ? 999 : S.speed, 4, s.n ? _n.set(s.n[0], s.n[1], s.n[2]) : null, {ball: TOXIC, col: slam ? SHOCK : TOXIC, size: slam ? 0 : 2, lob: !slam, trail: 0.5, area: slam ? S.radius : S.area, ad: S.dmg, src: 'zombie', ground: slam});
      if (!slam) SFX.spit(panOf(_b), 1 / (1 + distTo(_b) * 0.08));
      return;
    }
    const w = WEAPONS[wi] || WEAPONS[0], ci = s.c % COLORS.length, look = {col: w.tracer, trail: w.trail, tw: w.tw, size: w.size};
    if (w.area) { launch(_b, _a, ci, w.speed, 4, s.n ? _n.set(s.n[0], s.n[1], s.n[2]) : null, {...look, lob: true, area: w.area, ad: w.areaDamage, src: 'friend', friend: by}); SFX.shot(wi, panOf(_b)); return; }
    let kind = 0, top = null;
    if (s.n) { _n.set(s.n[0], s.n[1], s.n[2]); kind = 1; for (const [n, r] of players()) if (n === s.h) { top = r; kind = 2; } }
    launch(_b, _a, ci, w.speed > 60 ? 60 : w.speed, kind, s.n ? _n : null, {...look, top});
    SFX.shot(wi, panOf(_b));
    if (on && s.h === me()) hurt(s.d, by);
    if (owner && zOn && s.zi) { const z = zombieAt(s.zi); if (z && z.state !== 'dead') { z.flash = 1; z.stagger = 0.25; z.hp -= s.zd || 0; if (z.hp <= 0) killZombie(z, performance.now() / 1000); } }
  }
  // zombies of another player's game: their frame, interpolated
  function followFrame(pb) {
    const now = performance.now() / 1000;
    wave = pb.zw || 0; kills = pb.zk || 0;
    const seen = new Set();
    for (const f of pb.zs || []) {
      seen.add(f.i); let z = zombieAt(f.i); const type = clamp(f.t | 0, 0, ZT_LIST.length - 1);
      if (!z) {
        if (zs.length >= MAXZ) continue;
        z = newZombie(type, f.x, f.z, f.i, now, f.h); z.scale = f.s === 1 ? 0.2 : 1; z.state = f.s === 2 ? 'dead' : f.s === 1 ? 'rise' : 'walk'; zs.push(z); if (type === 4 && f.s !== 2) bossAlert();
      }
      z.tx = f.x; z.tz = f.z; z.tyaw = f.r; z.hp = f.h; z.maxhp = f.m || z.maxhp;
      if (f.a > 0) { if (z.atkT < 0) z.atkT = 0; if (f.a === 2 && z.atkT < windOf(ZT_LIST[z.type])) z.atkT = windOf(ZT_LIST[z.type]); } else z.atkT = -1;
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
    balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = true; for (const sp of splashes) sp.mesh.visible = true; hud.style.display = ''; hud.classList.add('o-watch'); el.z.style.display = 'flex';
    wbadge.querySelector('span').textContent = T().watching; wbadge.querySelector('button').textContent = T().stop;
  }
  function stopWatch() {
    if (!watch) return; watch = false; watchOf = null; zOn = false; owner = true; clearZombies(); clearPaint(); clearBits(); moodOff(); hud.style.display = 'none'; hud.classList.remove('o-watch'); el.z.style.display = 'none';
    balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = false; for (const b2 of bolts) b2.live = false; balls.count = trails.count = 0; others.clear();
  }

  el.slots.addEventListener('pointerdown', e => e.stopPropagation());
  el.slots.addEventListener('click', e => { const sl = e.target.closest('.o-pnt-slot'); if (sl && on) { e.stopPropagation(); setWeapon([...el.slots.children].indexOf(sl)); } });
  // input: a click that is not a drag shoots, 1-6 or the wheel choose the weapon, R reloads, Z / right button zoom. With the mouse captured the
  // shot starts at the press (and an automatic weapon keeps firing while the button is down)
  let down = null;
  const captured = () => document.pointerLockElement === canvas;
  root.addEventListener('pointerdown', e => {
    down = [e.clientX, e.clientY]; if (on) ac();
    if (!on || !alive || e.target !== canvas || !pov()) return;
    if (e.button === 2 && WEAPONS[weapon].zoom) { zoomWant = true; e.preventDefault(); return; }
    if (e.button === 0 && captured() && aim()) { holding = true; fire(); }
  }, true);
  window.addEventListener('pointerup', e => { if (e.button === 2) zoomWant = false; if (e.button === 0) holding = false; }, true);
  window.addEventListener('blur', () => { holding = false; zoomWant = false; });
  document.addEventListener('pointerlockchange', () => { if (!captured()) { holding = false; zoomWant = false; } });
  root.addEventListener('contextmenu', e => { if (on && pov()) e.preventDefault(); }, true);
  root.addEventListener('click', e => {
    if (!on || e.target !== canvas || !pov() || !aim()) return;
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    e.stopImmediatePropagation(); e.stopPropagation(); if (!captured() && e.button === 0) fire();
  }, true);
  let wheelAt = 0;
  root.addEventListener('wheel', e => {
    if (!on || !pov() || !alive || !aim() || e.target !== canvas) return;
    const t = performance.now(); if (t - wheelAt > 110) { wheelAt = t; setWeapon((weapon + (e.deltaY > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length); }
    e.preventDefault();
  }, {passive: false, capture: true});
  document.addEventListener('keydown', e => {
    if (!on || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-6rRzZ]$/.test(e.key) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (/[rR]/.test(e.key)) startReload(performance.now() / 1000);
    else if (/[zZ]/.test(e.key)) { if (WEAPONS[weapon].zoom) zoomWant = !zoomWant; }
    else setWeapon(+e.key - 1);
    e.preventDefault();
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
    if (hemi) { hemi.intensity = s.hemi * MOOD.ambient * (0.85 + 0.15 * Math.sin(mood.t * 1.3)); const pulse = 0.5 + 0.5 * Math.sin(mood.t * 0.9); hemi.color.setRGB(0.72 + 0.28 * pulse, 0.68 - 0.26 * pulse, 0.74 - 0.28 * pulse); }
    if (sun) sun.intensity = s.sun * MOOD.sun * (rnd() < 0.015 ? 0.2 : 1);
  }

  /** the gun in hand each frame: where it sits, the kick, the parts that move */
  function poseGun(dt, now, p) {
    const gi = guns[weapon], d = gi.def, w = WEAPONS[weapon], me3 = body();
    kick *= Math.exp(-13 * dt); slideK *= Math.exp(-22 * dt); if (pumpP < 1) pumpP = Math.min(1, pumpP + dt / 0.55);
    if (w.spin) spinT = spinA += spinUp * 30 * dt; else spinA += (spinT - spinA) * (1 - Math.exp(-14 * dt));
    zoomK += ((zoomWant && alive && p && w.zoom && now >= reloadUntil ? 1 : 0) - zoomK) * (1 - Math.exp(-12 * dt));
    if (me3) { const sp = lastX === null ? 0 : Math.hypot(me3.x - lastX, me3.z - lastZ) / Math.max(dt, 1e-3); lastX = me3.x; lastZ = me3.z; bobS += (clamp(sp, 0, 5) - bobS) * (1 - Math.exp(-8 * dt)); }
    bobT += dt * (2.5 + bobS * 2.4);
    const reloading = now < reloadUntil, rp = reloading ? clamp((now - reloadStart) / Math.max(0.1, reloadUntil - reloadStart), 0, 1) : 0, dip = reloading ? Math.sin(Math.PI * rp) : 0;
    const sw = clamp(1 - (now - swapAt) / 0.3, 0, 1), swE = sw * sw, bob = Math.min(bobS, 2) * (1 - zoomK);
    gi.g.position.set(d.pos[0] + Math.sin(bobT) * 0.004 * bob - dip * 0.03, d.pos[1] + Math.abs(Math.cos(bobT)) * 0.006 * bob - swE * 0.25 - dip * 0.1 + kick * 0.012, d.pos[2] + kick * d.kickZ);
    gi.g.rotation.set(kick * 0.14 + dip * 0.5 - swE * 0.6, 0.07 - dip * 0.3, dip * 0.25 + Math.sin(bobT) * 0.01 * bob);
    const magK = !reloading ? 0 : rp < 0.2 ? 0 : rp < 0.4 ? (rp - 0.2) / 0.2 : rp < 0.6 ? 1 : rp < 0.8 ? 1 - (rp - 0.6) / 0.2 : 0;
    for (const pt of gi.parts) {
      if (pt.role === 'slide') pt.m.position.z = pt.home.z + slideK * pt.amp;
      else if (pt.role === 'pump') pt.m.position.z = pt.home.z + (pumpP < 1 ? pt.amp * Math.sin(Math.PI * clamp((pumpP - 0.12) / 0.88, 0, 1)) : 0);
      else if (pt.role === 'mag') pt.m.position.y = pt.home.y - pt.amp * magK;
      else if (pt.role === 'spin') pt.m.rotation.z = spinA;
    }
  }

  /** the shaders of what the mode draws, built when it starts (not on the first shot or the first zombie, which would freeze the picture for half a second) */
  function precompile() {       // for the target the scene is drawn into: a program built for the screen is another program (tone mapping, colour space)
    try { const was = muzzle.visible; muzzle.visible = true; renderer?.setRenderTarget(drawTarget()); renderer?.compile(scene, camera); muzzle.visible = was; } catch (e) {} finally { renderer?.setRenderTarget(null); }
  }

  const api = {
    active: () => on,
    /** for the shader prewarm (office.js): everything the mode draws shown, and the zombie fog if asked; the function it returns puts it all back */
    warm(fog) {
      if (on || watch) return () => {};
      const fogWas = scene.fog, gunOf = muzzle.parent;
      for (const sp of splashes) sp.mesh.visible = true;
      balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = muzzle.visible = stains.visible = true;
      for (const p of PART_LIST) p.mesh.visible = true;
      guns.forEach(g => { g.g.visible = true; }); guns[0].g.add(muzzle);
      if (fog) scene.fog = new THREE.FogExp2('#05070b', MOOD.fog);
      return () => {
        for (const sp of splashes) sp.mesh.visible = false;
        balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = muzzle.visible = stains.visible = false;
        for (const p of PART_LIST) p.mesh.visible = false;
        guns.forEach(g => { g.g.visible = false; }); if (gunOf) gunOf.add(muzzle); else muzzle.removeFromParent();
        scene.fog = fogWas;
      };
    },
    /** switch the mode on or off (no argument: the other way) */
    toggle(next = !on) {
      if (watch) stopWatch();
      if (next === on) return on;
      on = next; others.clear();
      if (on) {
        hp = RULES.hp; alive = true; weapon = 0; out = []; WEAPONS.forEach((w, i) => { ammo[i] = w.mag; }); reloadUntil = 0; hud.style.display = ''; el.msg.textContent = ''; enterPov(); ac(); onMode(true);
        zoomWant = false; zoomK = 0; spinUp = 0; spinA = spinT = 0; holding = false; kick = slideK = 0; pumpP = 1; lastX = null;
        for (const sp of splashes) sp.mesh.visible = true; balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = true; guns.forEach((g, i) => { g.g.visible = i === weapon; });
        guns[weapon].g.add(muzzle); { const t = guns[weapon].def.tip; muzzle.position.set(t[0] / 100, t[1] / 100, t[2] / 100); }
        precompile();
        say(T().on);
      } else {
        reportRun(); reportPaint(); onMode(false); hud.style.display = 'none'; clearPaint(); clearBits(); balls.visible = trails.visible = bitsMesh.visible = smokeMesh.visible = false; guns.forEach(g => { g.g.visible = false; }); muzzle.visible = false; holding = false; zoomWant = false; zoomK = 0;
        if (zOn) { zOn = false; clearZombies(); el.z.style.display = 'none'; moodOff(); }
        for (const b of bolts) b.live = false; balls.count = trails.count = 0;
        el.flash.classList.remove('o-on'); el.vig.classList.remove('o-on', 'o-near'); el.msg.textContent = ''; el.cross.className = 'o-pnt-cross'; el.scope.style.display = 'none';
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
      if (!next) reportRun();
      zOn = next; el.z.style.display = zOn ? 'flex' : 'none';
      if (zOn) { owner = true; zStart = Date.now() % 2000000000; zHtml = ''; restartZombies(performance.now() / 1000); moodOn(); precompile(); say(T().zon); }
      else { clearZombies(); el.z.style.display = 'none'; moodOff(); el.vig.classList.remove('o-near'); say(T().zoff); }
      publish();
      return zOn;
    },
    zombiesOn: () => zOn,
    lockMessage: () => say(T().lock),
    /** how much the sniper's zoom narrows the view (1: not at all); the camera multiplies its field of view by it, the mouse by it too */
    zoomFactor,
    /** each frame */
    update(dt) {
      if (!on && !watch) return;
      dt = Math.min(dt, 0.1); const now = performance.now() / 1000, p = pov(), w = WEAPONS[weapon];
      if (reloadUntil && now >= reloadUntil) { reloadUntil = 0; ammo[weapon] = WEAPONS[weapon].mag; drawHud(); }
      if (flashT && now > flashT) { flashT = 0; el.flash.classList.remove('o-on'); }
      if (hitT && now > hitT + 0.15) { hitT = 0; el.cross.classList.remove('o-hit'); }
      if (!alive) {
        const left = Math.ceil(respawnAt - now);
        if (left <= 0) { hp = RULES.hp; alive = true; WEAPONS.forEach((w, i) => { ammo[i] = w.mag; }); el.msg.textContent = ''; if (zOn && owner && !friendAlive()) restartZombies(now); respawn(); drawHud(); publish(); } else if (!zOn || friendAlive()) el.msg.textContent = T().out(left);
      }
      if (on) {
        // a button held down: an automatic weapon keeps firing; the minigun spins up while it is held and winds down after
        if (w.auto && holding && alive && p && captured()) { if (w.spin) { const was = spinUp; spinUp = Math.min(1, spinUp + dt / 0.65); if (((was * 6) | 0) !== ((spinUp * 6) | 0)) SFX.spin(spinUp); } fire(); } else if (w.spin) spinUp = Math.max(0, spinUp - dt / 1.1);
        poseGun(dt, now, p);
        el.cross.style.display = p && alive && zoomK < 0.5 ? 'block' : 'none'; el.scope.style.display = p && alive && zoomK > 0.55 ? 'block' : 'none';
        guns.forEach((g, i) => { g.g.visible = p && alive && i === weapon && zoomK < 0.5; });
        muzzle.visible = p && alive && now < flashUntil && zoomK < 0.5;
      }
      stepBalls(dt); stepPool(bits, bitsMesh, dt); stepPool(smoke, smokeMesh, dt);
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
    _state: () => ({on, pov: pov(), hp, alive, weapon, deaths, splats: splashes.reduce((n, s) => n + s.mesh.count, 0), figSplats: figSplats.length, others: [...others], zombies: zs.map(z => [z.x, z.z, z.hp, z.state === 'dead', z.type]), wave, kills, owner, bolts: bolts.filter(b => b.live).length,
      bits: bitsMesh.count, smoke: smokeMesh.count, zoomK, spinUp, ammo: ammo.slice(), bossPending, calls: {zombiePartMeshes: Object.keys(PARTS).length + 1}}),
    _fire: () => fire(),
    _zs: () => zs,
    _guns: () => guns,
    _killAll: () => { const now = performance.now() / 1000; for (const z of zs) if (z.state !== 'dead') killZombie(z, now); },
    _setWeapon: setWeapon,
    _hold: (v, spin) => { holding = v; if (spin !== undefined) spinUp = spin; },
    _spawn: (type, x, z0) => { const z = newZombie(type, x, z0, ++zid, performance.now() / 1000, hpFor(type, Math.max(1, wave))); zs.push(z); return z.id; },
  };
  return api;
}
