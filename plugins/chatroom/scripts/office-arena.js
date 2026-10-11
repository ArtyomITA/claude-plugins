// The arena: a floor above the office for the paintball and zombie modes, played by everyone in the same office.
//
// It stands 4 m up (over the office ceiling), on the same 30 x 20 m plan, closed by walls and a ceiling with lights: crates, barrels,
// low barriers, columns, raised platforms with steps, two long corridors with openings, an open area in the middle, a base for each
// team. Everything is a voxel box with a colour, fused into two meshes (the solid things, and the neon that glows): two draw calls
// and eight lights whatever the number of pieces. The pieces are also the floor for walking: what can be climbed (up to 1.2 m, like the
// furniture of the office) and what can not, with the same rules the office uses, so a jump or a step takes you onto a crate or a platform.
//
// The data part has no browser in it (arenaPlan), so the plan can be checked in node: arena_test.mjs.
import {boxGeo} from './office-guns.js';
import {floorPlan} from './office-layout.js';

/** the words of the lift and of the arena (the viewer's strings are in office-ui.js; these are few and live with the arena) */
export const ARENA_TEXT = {
  it: {name: 'Arena', hintLift: "sali all'arena", hintExit: 'torna in ufficio', paintball: 'Paintball', zombie: 'Zombie', title: 'Sali in arena'},
  en: {name: 'Arena', hintLift: 'go up to the arena', hintExit: 'back to the office', paintball: 'Paintball', zombie: 'Zombies', title: 'Go up to the arena'},
};

/** the floor of the arena, above the floor of the office (the office ceiling is at 3 m) */
export const ARENA_Y = 4.0;
export const ARENA_H = 3.6;                                  // the ceiling of the arena, above its floor
export const SIZE = [30, 20];
/** the lift of the office: a core of glass and steel in the plaza; its door faces +z (the common room). The returning place is in front of it. */
export const ELEVATOR_AT = {x: 7.6, z: 2.4, hw: 0.95, hd: 0.75, out: {x: 7.6, z: 3.55, rot: 0}};
/** the lift of the arena, in the west wall: you arrive in front of it, on the base of the first team */
export const ARENA_EXIT = {x: -14.45, z: 0, hw: 0.4, hd: 1.0};

const hash = (...n) => { let h = 2166136261; for (const v of n) { h ^= Math.round(v * 100) + 7919; h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const mix = (a, b, t) => { const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const shade = (c, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(c.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

const C = {floorA: '#6a707a', floorB: '#5f656f', base: '#2a2d34', wall: '#5c6370', wallLow: '#3a3f49', wallTop: '#434955', trim: '#7a818d', wallW: '#3f6785', wallWlow: '#2b4a62', wallE: '#86553a', wallElow: '#5e3b27', line: '#cfd3d9', yellow: '#e4b422', black: '#1d1f24',
  teamA: '#26c6da', teamB: '#ff9800', teamAfloor: '#2a7f99', teamBfloor: '#99601f', concrete: '#9ea4ab', concreteD: '#7d838a', wood: '#a47c4c', woodD: '#6d4f2c', green: '#55663f', steel: '#59616c', steelL: '#8a929d',
  ceil: '#3b414d', beam: '#4a5160', panel: '#fff3d6'};

/** the pieces of the arena: boxes to draw (solid and glowing) and the footprints that block or can be climbed, in metres from the middle of the floor */
export function arenaPlan() {
  const solid = [], glow = [], pieces = [], lamps = [];
  /** a box from its corners (x0 y0 z0 x1 y1 z1) to the [w, h, d, x, y, z, colour] boxGeo wants */
  const bx = (list, x0, y0, z0, x1, y1, z1, col) => list.push([x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, col]);
  const S = (...a) => bx(solid, ...a), G = (...a) => bx(glow, ...a);
  /** what a figure meets: a footprint and a top (kind says what it is, for the tests) */
  const piece = (kind, x0, z0, x1, z1, top) => pieces.push({kind, x0, z0, x1, z1, top});

  // ---- the floor: tiles of 2 m with a thin gap, the bases of the teams, the lines
  S(-15, -0.4, -10, 15, -0.02, 10, C.base);
  for (let i = 0; i < 15; i++) for (let j = 0; j < 10; j++) {
    const x0 = -15 + i * 2 + 0.02, z0 = -10 + j * 2 + 0.02, cx = x0 + 1, k = hash(i, j) * 0.14 - 0.07;
    const col = cx < -10.5 ? C.teamAfloor : cx > 10.5 ? C.teamBfloor : (i + j) % 2 ? C.floorA : C.floorB;
    S(x0, -0.02, z0, x0 + 1.96, 0, z0 + 1.96, shade(col, 1 + k));
  }
  const stripe = (x0, z0, x1, z1, col, y = 0.004) => G(x0, 0, z0, x1, y + 0.01, z1, col);
  S(-0.05, 0, -10, 0.05, 0.012, 10, C.line);                                             // the middle line
  for (const sx of [-1, 1]) {                                                              // the base of a team: bright edges and a pad in front of the lift (or the spawn)
    const x0 = sx < 0 ? -14.5 : 10.5, x1 = sx < 0 ? -10.5 : 14.5, col = sx < 0 ? C.teamA : C.teamB;
    stripe(x0, -4.05, x1, -3.95, col); stripe(x0, 3.95, x1, 4.05, col); stripe(sx < 0 ? -10.55 : 10.45, -4.05, sx < 0 ? -10.45 : 10.55, 4.05, col);
    for (let k = -1; k <= 1; k++) S(sx * 12.5 - 0.5, 0, k * 2.4 - 0.6, sx * 12.5 + 0.5, 0.02, k * 2.4 + 0.6, shade(col, 0.55)), G(sx * 12.5 - 0.42, 0.02, k * 2.4 - 0.52, sx * 12.5 + 0.42, 0.03, k * 2.4 + 0.52, col);
  }
  for (const x of [-7.5, 7.5]) for (let z = -9.6; z < 9.7; z += 1.2) S(x - 0.06, 0, z, x + 0.06, 0.012, z + 0.6, C.yellow);   // dashed lines of the lanes

  // ---- the outer walls: concrete panels with a dark foot, grooves, and a neon strip low and high
  const wall = (x0, z0, x1, z1, h, kind = 'wall') => { piece(kind, x0, z0, x1, z1, h); };
  wall(-15, -10, 15, -9.5, ARENA_H); wall(-15, 9.5, 15, 10, ARENA_H); wall(-15, -10, -14.5, 10, ARENA_H); wall(14.5, -10, 15, 10, ARENA_H);
  for (const [a, b, up, low] of [[-15, -5, C.wallW, C.wallWlow], [-5, 5, C.wall, C.wallLow], [5, 15, C.wallE, C.wallElow]]) {       // blue to the west, grey in the middle, rust to the east
    S(a, 0, -10, b, 0.5, -9.5, low); S(a, 0.5, -10, b, ARENA_H, -9.5, up); S(a, 0, 9.5, b, 0.5, 10, low); S(a, 0.5, 9.5, b, ARENA_H, 10, up);
  }
  S(-15, 0, -10, -14.5, 0.5, 10, C.wallWlow); S(-15, 0.5, -10, -14.5, ARENA_H, 10, C.wallW); S(14.5, 0, -10, 15, 0.5, 10, C.wallElow); S(14.5, 0.5, -10, 15, ARENA_H, 10, C.wallE);
  // the word ARENA in neon letters (a 5 x 7 font): on the west wall above the lift, on the east wall, and on the lane walls (below)
  const FONT = {A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'], E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#']};
  // `at` is the plane of the face (z for N and S, x for W and E), `mid` the middle of the word along it
  const word = (wall, px, top, at, mid = 0) => [...'ARENA'].forEach((ch, li) => FONT[ch].forEach((row, r) => [...row].forEach((c, k) => {
    if (c !== '#') return;
    const u0 = -(5 * 5 * px + 4 * px) / 2 + li * 6 * px + k * px, u1 = u0 + px, y0 = top - (r + 1) * px, y1 = top - r * px;     // u: along the wall, to the right of whoever looks at it
    if (wall === 'N') G(mid + u0, y0, at, mid + u1, y1, at + 0.04, '#7df0ff'); else if (wall === 'S') G(mid - u1, y0, at - 0.04, mid - u0, y1, at, '#7df0ff');
    else if (wall === 'W') G(at, y0, mid - u1, at + 0.04, y1, mid - u0, '#7df0ff'); else G(at - 0.04, y0, mid + u0, at, y1, mid + u1, '#7df0ff');
  })));
  word('W', 0.1, 3.45, -14.5); word('E', 0.14, 3.4, 14.5);
  // the north and south walls are hidden behind the 2.4 m lane walls (from the middle only the top row showed, 'ODLWO'), so the word is on the faces of the middle lane walls instead, at eye height
  word('N', 0.14, 1.8, -6.2, 0.3); word('S', 0.14, 1.8, 6.2, -1.5);
  for (const [y, hh] of [[0.55, 0.05], [3.52, 0.05]]) {
    G(-14.5, y, -9.5, 0, y + hh, -9.46, C.teamA); G(0, y, -9.5, 14.5, y + hh, -9.46, C.teamB); G(-14.5, y, 9.46, 0, y + hh, 9.5, C.teamA); G(0, y, 9.46, 14.5, y + hh, 9.5, C.teamB);
    G(-14.5, y, -9.5, -14.46, y + hh, 9.5, C.teamA); G(14.46, y, -9.5, 14.5, y + hh, 9.5, C.teamB);
  }
  // the lift of the arena (west wall): a frame, two steel doors, a green light above
  S(-14.5, 0, -1.0, -14.38, 2.6, 1.0, C.steel); S(-14.38, 0, -0.8, -14.34, 2.4, 0, C.steelL); S(-14.38, 0, 0, -14.34, 2.4, 0.8, C.steelL); S(-14.38, 2.4, -0.9, -14.3, 2.5, 0.9, C.black);
  S(-14.38, 0.9, -0.03, -14.33, 1.3, 0.03, C.black); G(-14.36, 2.62, -0.5, -14.3, 2.76, 0.5, '#3ddc84');
  G(-14.44, 1.1, -1.12, -14.4, 1.4, -1.06, '#3ddc84');                                       // the call button
  piece('exit', -14.5, -1.0, -14.38, 1.0, 2.6);

  // ---- the ceiling: a slab, beams across, light panels
  S(-15, ARENA_H, -10, 15, ARENA_H + 0.3, 10, C.ceil);
  for (let x = -12; x <= 12.1; x += 6) S(x - 0.18, ARENA_H - 0.38, -9.5, x + 0.18, ARENA_H, 9.5, C.beam);
  for (let z = -6; z <= 6.1; z += 6) S(-14.5, ARENA_H - 0.3, z - 0.15, 14.5, ARENA_H, z + 0.15, C.beam);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const x = -12 + i * 6 + 3, z = -6 + j * 6 + 3 - 0.0; if (x > 14) continue; G(x - 1.0, ARENA_H - 0.07, z - 0.3, x + 1.0, ARENA_H - 0.04, z + 0.3, C.panel); }
  const L = (x, z, col, k = 2.4) => lamps.push({x, y: ARENA_H - 0.5, z, color: col, intensity: k});
  L(-10, -5, '#a7e3f5'); L(-10, 5, '#a7e3f5'); L(10, -5, '#ffc995'); L(10, 5, '#ffc995'); L(-3.5, 0, '#fff0d0'); L(3.5, 0, '#fff0d0'); L(0, -8, '#fff0d0', 2.0); L(0, 8, '#fff0d0', 2.0);

  // ---- the things to hide behind and to climb on
  const crate = (x, z, s, levels = 1, tint = null, y = 0) => {                                    // a wooden crate (or a stack of them): posts at the corners, rails, a cross on the sides
    const h = y + s * levels, a = x - s / 2, b = x + s / 2, c = z - s / 2, d = z + s / 2, base = tint || mix(C.wood, C.green, hash(x, z) > 0.7 ? 0.8 : 0), wd = shade(base, 0.6), p = Math.max(0.05, s * 0.1);
    for (let l = 0; l < levels; l++) {
      const y0 = y + l * s, y1 = y0 + s, body = shade(base, 1 + (hash(x, z, l) - 0.5) * 0.12);
      S(a, y0, c, b, y1, d, body);
      for (const [px, pz] of [[a, c], [b - p, c], [a, d - p], [b - p, d - p]]) S(px - 0.01, y0, pz - 0.01, px + p + 0.01, y1, pz + p + 0.01, wd);
      for (const yy of [y0, y1 - p]) { S(a - 0.01, yy, c - 0.01, b + 0.01, yy + p, c + p, wd); S(a - 0.01, yy, d - p, b + 0.01, yy + p, d + 0.01, wd); S(a - 0.01, yy, c, a + p, yy + p, d, wd); S(b - p, yy, c, b + 0.01, yy + p, d, wd); }
      S(a + p, y0 + s * 0.45, c - 0.012, b - p, y0 + s * 0.55, c, wd); S(a + p, y0 + s * 0.45, d, b - p, y0 + s * 0.55, d + 0.012, wd);
      S(a - 0.012, y0 + s * 0.45, c + p, a, y0 + s * 0.55, d - p, wd); S(b, y0 + s * 0.45, c + p, b + 0.012, y0 + s * 0.55, d - p, wd);
    }
    piece('crate', a, c, b, d, h);
  };
  const barrel = (x, z, col) => {                                                          // an octagonal barrel: three boxes across, two bands, a lid
    const r = 0.3, q = 0.17, h = 0.9, dk = shade(col, 0.7);
    S(x - r, 0, z - q, x + r, h, z + q, col); S(x - q, 0, z - r, x + q, h, z + r, col); S(x - 0.255, 0, z - 0.255, x + 0.255, h, z + 0.255, col);
    for (const yy of [0.18, 0.7]) { S(x - r - 0.01, yy, z - q, x + r + 0.01, yy + 0.07, z + q, dk); S(x - q, yy, z - r - 0.01, x + q, yy + 0.07, z + r + 0.01, dk); S(x - 0.265, yy, z - 0.265, x + 0.265, yy + 0.07, z + 0.265, dk); }
    S(x - 0.2, h, z - 0.2, x + 0.2, h + 0.02, z + 0.2, dk); S(x - 0.05, h + 0.02, z - 0.05, x + 0.05, h + 0.06, z + 0.05, C.steelL);
    S(x - 0.07, 0.34, z - r - 0.012, x + 0.07, 0.58, z - r, '#f2f2f2');                      // a label
    piece('barrel', x - r, z - r, x + r, z + r, h);
  };
  const barrier = (x, z, len, alongX = true) => {                                           // a concrete barrier, 0.9 m high, hazard band on top
    const w = alongX ? len : 0.5, d = alongX ? 0.5 : len, a = x - w / 2, b = x + w / 2, c = z - d / 2, e = z + d / 2, t = 0.07;
    const sh = alongX ? [[a, c + 0.0, b, e], [a, c + 0.07, b, e - 0.07], [a, c + 0.14, b, e - 0.14]] : [[a, c, b, e], [a + 0.07, c, b - 0.07, e], [a + 0.14, c, b - 0.14, e]];
    S(sh[0][0], 0, sh[0][1], sh[0][2], 0.35, sh[0][3], C.concrete); S(sh[1][0], 0.35, sh[1][1], sh[1][2], 0.7, sh[1][3], C.concrete); S(sh[2][0], 0.7, sh[2][1], sh[2][2], 0.9, sh[2][3], C.concreteD);
    const n = Math.max(2, Math.round(len / 0.3));
    for (let i = 0; i < n; i += 2) { const u0 = (alongX ? a : c) + len * i / n, u1 = u0 + len / n; alongX ? S(u0, 0.82, sh[2][1] - t * 0, u1, 0.9 + 0.005, sh[2][3], C.yellow) : S(sh[2][0], 0.82, u0, sh[2][2], 0.905, u1, C.yellow); }
    piece('barrier', a, c, b, e, 0.9);
  };
  const column = (x, z) => {
    S(x - 0.45, 0, z - 0.45, x + 0.45, 0.25, z + 0.45, C.steel); S(x - 0.4, 0.25, z - 0.4, x + 0.4, ARENA_H, z + 0.4, C.concrete);
    for (const yy of [0.25, 0.5, 0.75]) S(x - 0.405, yy, z - 0.405, x + 0.405, yy + 0.12, z + 0.405, yy === 0.5 ? C.yellow : C.black);
    S(x - 0.45, ARENA_H - 0.2, z - 0.45, x + 0.45, ARENA_H, z + 0.45, C.steel); G(x - 0.415, 2.4, z - 0.415, x + 0.415, 2.46, z + 0.415, x < 0 ? C.teamA : C.teamB);
    piece('column', x - 0.45, z - 0.45, x + 0.45, z + 0.45, ARENA_H);
  };
  const platform = (x0, z0, x1, z1, h, col = C.steel) => {                                  // a raised deck: a body, a lighter top, yellow edges
    S(x0, 0, z0, x1, h - 0.06, z1, shade(col, 0.8)); S(x0 - 0.04, h - 0.06, z0 - 0.04, x1 + 0.04, h, z1 + 0.04, col);
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.5) for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.5) S(x, h, z, x + 0.28, h + 0.012, z + 0.28, C.steelL);
    S(x0 - 0.04, h - 0.1, z0 - 0.05, x1 + 0.04, h - 0.04, z0 - 0.04, C.yellow); S(x0 - 0.04, h - 0.1, z1 + 0.04, x1 + 0.04, h - 0.04, z1 + 0.05, C.yellow);
    S(x0 - 0.05, h - 0.1, z0 - 0.04, x0 - 0.04, h - 0.04, z1 + 0.04, C.yellow); S(x1 + 0.04, h - 0.1, z0 - 0.04, x1 + 0.05, h - 0.04, z1 + 0.04, C.yellow);
    piece('platform', x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h);
  };
  const steps = (x0, z0, x1, z1, dir) => {                                                  // two steps of 33 cm leading to a 99 cm platform: dir is the way up (+x, -x, +z, -z)
    const n = 2, rise = 0.33, run = 0.55;
    for (let i = 0; i < n; i++) {                                                           // the step nearest to the platform is the highest
      const far = (n - i) * run, h = rise * (i + 1);
      let a = x0, b = x1, c = z0, d = z1;
      if (dir === '+x') { a = x0 - far; b = x0 - far + run; } else if (dir === '-x') { a = x1 + far - run; b = x1 + far; } else if (dir === '+z') { c = z0 - far; d = z0 - far + run; } else { c = z1 + far - run; d = z1 + far; }
      // the stair on the side of the platform: the first step is the farthest from it and the lowest
      S(a, 0, c, b, h - 0.04, d, C.steel); S(a, h - 0.04, c, b, h, d, C.steelL);
      piece('step', a, c, b, d, h);
    }
  };
  const lane = (x0, z0, x1, z1, h = 2.4) => { piece('lane', x0, z0, x1, z1, h); S(x0, 0, z0, x1, 0.4, z1, C.wallLow); S(x0, 0.4, z0, x1, h, z1, C.wall); S(x0 - 0.01, h, z0 - 0.01, x1 + 0.01, h + 0.06, z1 + 0.01, C.trim);
    if (x1 - x0 > z1 - z0) G(x0, 1.9, z0 - 0.012, x1, 1.95, z0, x0 < 0 ? C.teamA : C.teamB), G(x0, 1.9, z1, x1, 1.95, z1 + 0.012, x0 < 0 ? C.teamA : C.teamB); };

  // the middle: a platform with steps from north and south, columns round it
  platform(-3, -2, 3, 2, 0.99); steps(-1, -2, 1, 2, '+z'); steps(-1, -2, 1, 2, '-z');
  crate(-1.9, -0.9, 0.9, 1, null, 0.99); crate(1.9, 0.9, 0.9, 1, null, 0.99); crate(-1.9, 0.9, 0.6, 1, null, 0.99);
  // the side platforms, facing the middle, with a crate to hide behind on top
  platform(-9.5, -2, -6.5, 2, 0.99); steps(-9.5, -1, -6.5, 1, '-x'); crate(-8.9, 1.2, 0.9, 1, null, 0.99);
  platform(6.5, -2, 9.5, 2, 0.99); steps(6.5, -1, 9.5, 1, '+x'); crate(8.9, -1.2, 0.9, 1, null, 0.99);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) column(sx * 5.5, sz * 4.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) column(sx * 11.8, sz * 7.4);
  // the corridors: a long wall with two openings, a lane between it and the outer wall, things in it
  for (const [a, b] of [[-11, -4.8], [-2.8, 3.4], [5.4, 11]]) lane(a, -6.6, b, -6.2);
  for (const [a, b] of [[-11, -6.2], [-4.2, 1.2], [3.2, 11]]) lane(a, 6.2, b, 6.6);
  crate(-8.2, -8.2, 0.9, 1); crate(-7.3, -8.2, 0.6, 1); barrel(-0.5, -8.7, '#c0392b'); barrel(0.2, -8.2, '#c0392b'); barrier(7.4, -8.3, 1.6, false); crate(10.2, -8.5, 0.9, 2);
  crate(8.4, 8.2, 0.9, 1); crate(7.5, 8.2, 0.6, 1); barrel(0.5, 8.7, '#d4a017'); barrel(-0.2, 8.2, '#d4a017'); barrier(-7.4, 8.3, 1.6, false); crate(-10.2, 8.5, 0.9, 2);
  // the open area: cover in the lanes of the middle
  barrier(-4.2, -2.6, 1.8, true); barrier(4.2, 2.6, 1.8, true); barrier(-4.2, 2.8, 1.2, false); barrier(4.2, -2.8, 1.2, false);
  crate(0, -4.4, 0.9, 1); crate(0.9, -4.4, 0.6, 1); crate(0, 4.4, 0.9, 1); crate(-0.9, 4.4, 0.6, 1);
  barrel(-2.2, 3.2, '#2c6fbb'); barrel(-2.9, 3.6, '#2c6fbb'); barrel(2.2, -3.2, '#e67e22'); barrel(2.9, -3.6, '#e67e22');
  crate(-11.5, -2.2, 0.9, 1, '#4f6a8a'); crate(-11.5, 2.2, 0.9, 1, '#4f6a8a'); crate(11.5, -2.2, 0.9, 1, '#8a5a3a'); crate(11.5, 2.2, 0.9, 1, '#8a5a3a');
  barrier(-9.2, -5.1, 2.0, false); barrier(9.2, 5.1, 2.0, false); crate(-9.8, 5.2, 0.9, 1); crate(9.8, -5.2, 0.9, 1);

  const spawns = {A: [{x: -12.5, z: 0, rot: Math.PI / 2}, {x: -12.5, z: -2.4, rot: Math.PI / 2}, {x: -12.5, z: 2.4, rot: Math.PI / 2}],
                  B: [{x: 12.5, z: 0, rot: -Math.PI / 2}, {x: 12.5, z: -2.4, rot: -Math.PI / 2}, {x: 12.5, z: 2.4, rot: -Math.PI / 2}]};
  return {solid, glow, pieces, lamps, spawns};
}

/** the walking world of the arena: the same questions the office asks of its floor (blocked, the top under a point, the route) */
export function arenaWorld(plan = arenaPlan()) {
  const climb = [], hard = [], all = [];
  for (const p of plan.pieces) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0, box = {x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, hw: w / 2, hd: d / 2, rot: 0};
    all.push(box);
    if (p.kind !== 'exit' && p.top >= 0.3 && p.top <= 1.2 && w * d >= 0.35 && w < 8 && d < 8) climb.push({x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, top: p.top});
    else hard.push(box);
  }
  const floorAll = floorPlan({size: SIZE}, {boxes: all}), floorN = floorPlan({size: SIZE}, {boxes: hard});
  const climbTop = (x, z, alt, m = 0) => { let best = null; for (const b of climb) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && alt >= b.top - 0.05 && (best === null || b.top > best)) best = b.top; return best; };
  return {floorAll, floorN, climb, climbTop, blocked: (x, z, r) => floorAll.blocked(x, z, r), route: (a, b) => floorAll.route(a, b), clear: (a, b) => floorAll.clear(a, b)};
}

/** the meshes, the lights and the world of the arena; hidden until somebody goes up */
export function createArena({THREE, scene, lamps = []}) {
  const plan = arenaPlan(), world = arenaWorld(plan), group = new THREE.Group();
  const solid = new THREE.Mesh(boxGeo(THREE, plan.solid), new THREE.MeshLambertMaterial({vertexColors: true, emissive: '#2a2e36'}));
  const glow = new THREE.Mesh(boxGeo(THREE, plan.glow), new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false}));
  glow.userData.noShot = true; glow.raycast = () => {};
  group.add(solid, glow); group.position.y = ARENA_Y; group.visible = false; scene.add(group);
  const lights = plan.lamps.map(l => { const p = new THREE.PointLight(l.color, l.intensity, 16, 1.5); p.position.set(l.x, ARENA_Y + l.y, l.z); scene.add(p); lamps.push(p); return p; });
  return {group, plan, world, solid, glow, lights, spawns: plan.spawns,
    /** where a team starts: the n-th place of team 'A' or 'B' */
    spawn: (team, n = 0) => { const list = plan.spawns[team === 'B' ? 'B' : 'A']; return list[n % list.length]; },
    show: on => { group.visible = on; },
    /** metres from a point on the floor to the door of the lift of the arena */
    nearExit: p => Math.hypot(Math.max(Math.abs(p.x - ARENA_EXIT.x) - ARENA_EXIT.hw, 0), Math.max(Math.abs(p.z - ARENA_EXIT.z) - ARENA_EXIT.hd, 0))};
}

/** the lift of the office: a voxel core with glass doors and a lit sign; the doors open when somebody is near */
export function createElevator({THREE, scene, raycastables = [], at = ELEVATOR_AT}) {
  const g = new THREE.Group(), boxes = [], glassBoxes = [];
  const bx = (list, x0, y0, z0, x1, y1, z1, col) => list.push([x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, col]);
  const {hw, hd} = at, steel = '#6c7480', steelL = '#9aa2ad', dark = '#343943', glass = '#7fc8e8';
  bx(boxes, -hw, 0, -hd, hw, 0.12, hd, dark); bx(boxes, -hw, 0.12, -hd, -hw + 0.12, 2.7, hd, steel); bx(boxes, hw - 0.12, 0.12, -hd, hw, 2.7, hd, steel); bx(boxes, -hw + 0.12, 0.12, -hd, hw - 0.12, 2.7, -hd + 0.1, steel);
  bx(boxes, -hw, 2.7, -hd, hw, 2.82, hd, dark); bx(boxes, -hw + 0.12, 2.5, hd - 0.1, hw - 0.12, 2.7, hd, steel); bx(boxes, -hw + 0.12, 0.12, hd - 0.1, -0.5, 2.5, hd, steel); bx(boxes, 0.5, 0.12, hd - 0.1, hw - 0.12, 2.5, hd, steel);
  for (let i = 0; i < 6; i++) bx(boxes, -hw + 0.12, 0.3 + i * 0.4, -hd + 0.1, hw - 0.12, 0.34 + i * 0.4, -hd + 0.13, steelL);                 // ribs on the back wall inside
  bx(boxes, 0.62, 1.05, hd, 0.8, 1.25, hd + 0.04, dark); bx(boxes, 0.66, 1.1, hd + 0.04, 0.76, 1.14, hd + 0.05, '#3ddc84'); bx(boxes, 0.66, 1.16, hd + 0.04, 0.76, 1.2, hd + 0.05, '#ffb300');   // the call panel
  const body = new THREE.Mesh(boxGeo(THREE, boxes), new THREE.MeshLambertMaterial({vertexColors: true}));
  body.castShadow = true; g.add(body);
  // two glass doors that slide apart
  const doorGeo = boxGeo(THREE, [[0.5, 2.38, 0.05, 0.25, 1.31, 0, glass], [0.5, 0.04, 0.06, 0.25, 0.14, 0, steel], [0.5, 0.04, 0.06, 0.25, 2.48, 0, steel], [0.04, 2.38, 0.06, 0.02, 1.31, 0, steelL]]);
  const mat = new THREE.MeshLambertMaterial({vertexColors: true, transparent: true, opacity: 0.55});
  const dl = new THREE.Mesh(doorGeo, mat), dr = new THREE.Mesh(doorGeo, mat); dr.scale.x = -1; dl.position.set(0, 0, hd - 0.05); dr.position.set(0, 0, hd - 0.05); g.add(dl, dr);
  // the sign over the door: a lit plate with the word
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
  c.fillStyle = '#10131a'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#ff9800'; c.fillRect(0, 0, 256, 5); c.fillRect(0, 59, 256, 5);
  c.font = '900 34px "Courier New", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#00e5ff'; c.shadowBlur = 12; c.fillStyle = '#e0ffff'; c.fillText('▲ ARENA ▲', 128, 34);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), new THREE.MeshBasicMaterial({map: tex, toneMapped: false})); sign.position.set(0, 2.95, hd + 0.01); g.add(sign);
  g.position.set(at.x, 0, at.z); scene.add(g);
  g.traverse(o => { if (o.isMesh) { o.userData.lift = true; raycastables.push(o); } });
  let open = 0;
  return {group: g, box: {x: at.x, z: at.z, hw, hd, rot: 0},
    /** metres from a point on the floor to the core (0: touching it) */
    near: p => Math.hypot(Math.max(Math.abs(p.x - at.x) - hw, 0), Math.max(Math.abs(p.z - at.z) - hd, 0)),
    update(dt, from) { const want = from && Math.hypot(Math.max(Math.abs(from.x - at.x) - hw, 0), Math.max(Math.abs(from.z - at.z) - hd, 0)) < 2.2 ? 1 : 0; open += (want - open) * Math.min(1, dt * 5); dl.position.x = open * 0.5; dr.position.x = -open * 0.5; }};
}
