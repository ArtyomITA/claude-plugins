// Voxel models for the 3D office: a mesher with per-vertex ambient occlusion (the Minecraft look) and a small
// colour jitter per voxel, and every piece of furniture and every character built from boxes of voxels.
import * as THREE from 'three';

export const VS = 0.1;                                   // one voxel = 10 cm
const AO = [0.5, 0.68, 0.85, 1];
const FACES = [                                          // u x v = n, so each quad is wound outwards
  {n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1]}, {n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0]},
  {n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0]}, {n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1]},
  {n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0]}, {n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0]},
];
const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
export const rnd = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
export const hashName = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

export class Vox {
  constructor() { this.m = new Map(); }
  set(x, y, z, c) { this.m.set(key(x, y, z), [x, y, z, c]); return this; }
  del(x, y, z) { this.m.delete(key(x, y, z)); return this; }
  has(x, y, z) { return this.m.has(key(x, y, z)); }
  /** fill an inclusive box; c is a colour or (x, y, z) => colour (null leaves the cell alone) */
  box(x0, y0, z0, x1, y1, z1, c) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          const col = typeof c === 'function' ? c(x, y, z) : c;
          if (col !== null && col !== undefined) this.set(x, y, z, col);
        }
    return this;
  }
  /** geometry with flat normals, vertex colours, AO and jitter; pivot in voxel units, scale in metres */
  geometry({pivot = [0, 0, 0], scale = VS, jitter = 0.06, ao = true, glow = 1} = {}) {
    const pos = [], nor = [], col = [], c = new THREE.Color(), corner = [0, 0, 0, 0];
    for (const [x, y, z, hex] of this.m.values()) {
      c.set(hex);
      const j = 1 + (hash(x, y, z) - 0.5) * 2 * jitter;
      for (const {n, u, v} of FACES) {
        if (this.has(x + n[0], y + n[1], z + n[2])) continue;
        const b = [x + Math.max(n[0], 0), y + Math.max(n[1], 0), z + Math.max(n[2], 0)];
        const pts = [];
        for (let k = 0; k < 4; k++) {
          const a = k === 1 || k === 2 ? 1 : 0, bb = k >= 2 ? 1 : 0;
          pts.push([b[0] + a * u[0] + bb * v[0], b[1] + a * u[1] + bb * v[1], b[2] + a * u[2] + bb * v[2]]);
          if (ao) {
            const su = a ? 1 : -1, sv = bb ? 1 : -1, o = [x + n[0], y + n[1], z + n[2]];
            const s1 = this.has(o[0] + su * u[0], o[1] + su * u[1], o[2] + su * u[2]) ? 1 : 0;
            const s2 = this.has(o[0] + sv * v[0], o[1] + sv * v[1], o[2] + sv * v[2]) ? 1 : 0;
            const cr = this.has(o[0] + su * u[0] + sv * v[0], o[1] + su * u[1] + sv * v[1], o[2] + su * u[2] + sv * v[2]) ? 1 : 0;
            corner[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
          } else corner[k] = 3;
        }
        // corners 0..3 = (0,0) (1,0) (1,1) (0,1); split along the brighter diagonal so AO does not smear
        const order = corner[0] + corner[2] < corner[1] + corner[3] ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
        for (const k of order) {
          const p = pts[k];
          pos.push((p[0] - pivot[0]) * scale, (p[1] - pivot[1]) * scale, (p[2] - pivot[2]) * scale);
          nor.push(n[0], n[1], n[2]);
          const f = AO[corner[k]] * j * glow;
          col.push(c.r * f, c.g * f, c.b * f);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export const MAT = {
  solid: new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.82, metalness: 0.02}),
  glow: new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false}),
};

/** a mesh from a Vox, casting and receiving shadows */
export function mesh(vox, opts = {}, glow = false) {
  const m = new THREE.Mesh(vox.geometry(glow ? {...opts, ao: false, jitter: 0, glow: opts.glow || 1.3} : opts), glow ? MAT.glow : MAT.solid);
  m.castShadow = !glow; m.receiveShadow = !glow;
  return m;
}

// ------------------------------------------------------------------ characters
const SKIN = ['#f6d3b8', '#ecbd99', '#d29a70', '#a46c48', '#7a4a2e', '#ffe0c6'];
const HAIR = ['#2b1d16', '#5a3825', '#a0522d', '#d6a64f', '#1d1d24', '#b9b9c2', '#6f3fa0', '#d9553f', '#2f6f8f'];
const PANTS = ['#2f3e5c', '#3a3a40', '#4b5d3b', '#5c4033', '#26304a', '#6b6f78'];
const STYLES = ['short', 'spiky', 'bob', 'bun', 'cap', 'beanie', 'long', 'bald'];
export const darker = (hex, f = 0.7) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

/** a chibi voxel person facing +z; returns {root, body, parts} with pivots to animate */
export function person({name = '?', shirt = '#3a7bd5', kind = 'agent', scale = 1}) {
  const r = rnd(hashName(name));
  const skin = SKIN[Math.floor(r() * SKIN.length)], hair = HAIR[Math.floor(r() * HAIR.length)];
  const pants = kind === 'boss' ? '#1f2230' : PANTS[Math.floor(r() * PANTS.length)];
  const style = kind === 'boss' ? 'short' : kind === 'lead' ? 'bun' : STYLES[Math.floor(r() * STYLES.length)];
  const headphones = kind === 'agent' && r() < 0.3, glasses = kind === 'lead' || (kind === 'agent' && r() < 0.18);
  const shoe = '#2a2420';

  const leg = new Vox().box(0, 1, 0, 1, 3, 1, pants).box(0, 0, 0, 1, 0, 1, shoe).box(0, 0, 2, 1, 0, 2, shoe);
  const arm = new Vox().box(0, 1, 0, 1, 4, 1, kind === 'boss' ? '#262a3a' : shirt).box(0, 0, 0, 1, 0, 1, skin);
  const torso = new Vox().box(0, 0, 0, 5, 4, 2, kind === 'boss' ? '#262a3a' : shirt).box(0, 0, 0, 5, 0, 2, darker(pants, 0.8));
  if (kind === 'boss') torso.box(2, 1, 2, 3, 4, 2, '#f2f2f2').box(2, 1, 3, 2, 3, 3, '#c62828').set(3, 4, 3, '#c62828');
  else if (kind === 'lead') torso.box(2, 2, 2, 3, 4, 2, '#f5f5f5').set(1, 3, 3, '#f5c542');          // shirt under the cardigan, a pen
  else torso.box(2, 4, 2, 3, 4, 2, darker(shirt, 0.75)).set(4, 3, 3, '#ffffff');                     // collar and badge

  const head = new Vox().box(0, 0, 0, 6, 5, 5, skin);
  head.set(2, 2, 5, '#1b1b2a').set(4, 2, 5, '#1b1b2a').set(3, 1, 5, '#a8584f');
  head.set(1, 1, 5, '#f0a3a0').set(5, 1, 5, '#f0a3a0');
  const H = (x0, y0, z0, x1, y1, z1) => head.box(x0, y0, z0, x1, y1, z1, hair);
  if (style !== 'bald' && style !== 'cap' && style !== 'beanie') {
    H(0, 5, 0, 6, 5, 5); H(0, 2, 0, 6, 5, 1); H(0, 3, 0, 0, 5, 4); H(6, 3, 0, 6, 5, 4); H(0, 4, 5, 1, 4, 5); H(5, 4, 5, 6, 4, 5);
  }
  if (style === 'spiky') { H(1, 6, 2, 1, 6, 2); H(3, 6, 1, 3, 7, 1); H(5, 6, 3, 5, 6, 3); H(2, 6, 4, 2, 6, 4); H(4, 6, 4, 4, 6, 4); H(3, 6, 2, 3, 6, 3); }
  if (style === 'bob') { H(0, 1, 0, 0, 5, 3); H(6, 1, 0, 6, 5, 3); H(0, 0, 0, 6, 1, 0); }
  if (style === 'bun') { H(2, 6, 1, 4, 7, 3); H(3, 8, 2, 3, 8, 2); }
  if (style === 'long') { H(0, 0, 0, 6, 1, 1); H(0, 1, 0, 0, 2, 3); H(6, 1, 0, 6, 2, 3); }
  if (style === 'cap') { head.box(0, 5, 0, 6, 6, 5, shirt).box(1, 5, 6, 5, 5, 7, darker(shirt, 0.7)); H(0, 2, 0, 6, 4, 0); }
  if (style === 'beanie') { head.box(0, 4, 0, 6, 6, 5, darker(shirt, 0.85)).set(3, 7, 3, '#ffffff'); head.box(0, 4, 5, 6, 4, 5, '#eeeeee'); }
  if (style === 'bald') { head.box(1, 0, 5, 5, 0, 5, hair).set(1, 1, 5, hair).set(5, 1, 5, hair).set(3, 0, 6, hair); }
  if (headphones) { head.box(0, 6, 3, 6, 6, 3, '#222222').box(-1, 2, 2, -1, 3, 3, shirt).box(7, 2, 2, 7, 3, 3, shirt); }
  if (glasses) { head.box(1, 2, 6, 2, 2, 6, '#9fd3ff').box(4, 2, 6, 5, 2, 6, '#9fd3ff').box(1, 3, 6, 5, 3, 6, '#20202a'); }

  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.scale.setScalar(scale);
  const part = (vox, pivot, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); g.add(mesh(vox, {pivot})); body.add(g); return g; };
  const parts = {
    legL: part(leg, [1, 4, 1], -0.1, 0.4, 0), legR: part(leg, [1, 4, 1], 0.1, 0.4, 0),
    torso: part(torso, [3, 0, 1.5], 0, 0.4, 0),
    head: part(head, [3.5, 0, 3], 0, 0.9, 0),
  };
  parts.armL = part(arm, [1, 5, 1], -0.4, 0.88, 0); parts.armR = part(arm, [1, 5, 1], 0.4, 0.88, 0);
  parts.torso.add(parts.head); parts.head.position.set(0, 0.5, 0);           // the head follows the torso
  parts.torso.add(parts.armL); parts.armL.position.set(-0.4, 0.48, 0);
  parts.torso.add(parts.armR); parts.armR.position.set(0.4, 0.48, 0);
  return {root, body, parts, style, glasses};
}

// ------------------------------------------------------------------ furniture
const WOOD = ['#b8834f', '#a87443', '#c79a63'];
export function desk(top = '#c79a63') {
  const v = new Vox(), leg = darker(top, 0.55);
  v.box(0, 6, 0, 15, 6, 7, top).box(0, 6, 0, 15, 6, 0, darker(top, 0.85));
  for (const [x, z] of [[0, 0], [15, 0], [0, 7], [15, 7]]) v.box(x, 0, z, x, 5, z, leg);
  v.box(1, 2, 0, 14, 5, 0, darker(top, 0.8));                                                      // modesty panel
  v.box(11, 3, 1, 14, 5, 6, darker(top, 0.9)).box(12, 4, 7, 13, 4, 7, '#d8d8d8');                // drawers
  return mesh(v, {pivot: [8, 0, 4]});
}
export function monitor(frame = '#22252c') {
  const v = new Vox().box(0, 2, 0, 8, 7, 0, frame).box(4, 0, 0, 4, 1, 0, frame).box(2, 0, -1, 6, 0, 1, frame);
  const g = new THREE.Group(); g.add(mesh(v, {pivot: [4.5, 0, 0.5]}));
  return g;
}
export function laptop() {
  const v = new Vox().box(0, 0, 0, 6, 0, 4, '#2b2f38').box(1, 0, 1, 5, 0, 3, '#4a505c').box(0, 1, 4, 6, 5, 4, '#2b2f38').box(1, 2, 4, 5, 4, 4, '#7fd3ff');
  return mesh(v, {pivot: [3.5, 0, 2.5]});
}
export function keyboard() {
  return mesh(new Vox().box(0, 0, 0, 4, 0, 1, (x, y, z) => (x + z) % 2 ? '#e7e7ea' : '#cfd0d6').box(6, 0, 1, 6, 0, 1, '#d9d9de'), {pivot: [3.5, 0, 1]});
}
export function mug(color) {
  return mesh(new Vox().box(0, 0, 0, 1, 1, 1, color).set(2, 1, 0, color), {pivot: [1, 0, 1]});
}
export function chair(color = '#30343f', accent = null) {
  const v = new Vox(), dark = '#1d1f25';
  v.box(1, 0, 3, 5, 0, 3, dark).box(3, 0, 1, 3, 0, 5, dark).box(3, 1, 3, 3, 3, 3, '#7a7f8c');
  v.box(0, 4, 0, 6, 4, 6, color).box(0, 5, 6, 6, 10, 6, color).box(2, 5, 6, 4, 9, 6, accent || darker(color, 1.25));
  return mesh(v, {pivot: [3.5, 0, 3.5]});
}
export function bossChair() {
  const v = new Vox(), leather = '#5b1d1d', gold = '#d4a640';
  v.box(1, 0, 4, 7, 0, 4, '#1d1f25').box(4, 0, 1, 4, 0, 7, '#1d1f25').box(4, 1, 4, 4, 3, 4, '#8a8f9c');
  v.box(0, 4, 0, 8, 5, 8, leather).box(0, 6, 8, 8, 16, 9, leather).box(-1, 6, 2, -1, 8, 8, leather).box(9, 6, 2, 9, 8, 8, leather);
  v.box(2, 7, 8, 6, 15, 8, darker(leather, 1.35)).box(0, 16, 9, 8, 16, 9, gold);
  return mesh(v, {pivot: [4.5, 0, 4.5]});
}
export function bossDesk() {
  const v = new Vox(), wood = '#5a3a22', gold = '#d4a640';
  v.box(0, 6, 0, 23, 7, 9, wood).box(0, 0, 0, 23, 5, 1, darker(wood, 0.85)).box(0, 0, 0, 1, 5, 9, darker(wood, 0.85)).box(22, 0, 0, 23, 5, 9, darker(wood, 0.85));
  v.box(0, 7, 0, 23, 7, 0, gold).box(4, 2, -1, 19, 2, -1, gold);
  v.box(9, 8, 1, 14, 8, 1, '#2b2b2b').box(9, 9, 1, 14, 9, 1, gold);                                // nameplate stand
  v.box(19, 8, 6, 20, 9, 7, '#c62828').box(19, 10, 6, 20, 10, 7, '#ffffff');                       // the boss mug
  v.box(2, 8, 6, 3, 8, 7, '#2e7d32').box(2, 9, 6, 3, 11, 7, '#43a047').set(2, 12, 6, '#66bb6a');  // a small plant
  return mesh(v, {pivot: [12, 0, 5]});
}
export function smallDesk() {
  const v = new Vox(), top = '#e9e4da';
  v.box(0, 6, 0, 11, 6, 6, top);
  for (const [x, z] of [[0, 0], [11, 0], [0, 6], [11, 6]]) v.box(x, 0, z, x, 5, z, '#9a9a9a');
  v.box(3, 7, 2, 6, 7, 4, '#202228').box(8, 7, 1, 10, 7, 4, '#f4f1e8').box(8, 7, 1, 10, 7, 1, '#8d6e63');  // tablet, clipboard
  return mesh(v, {pivot: [6, 0, 3.5]});
}
export function table() {
  const v = new Vox(), top = '#d7b98c';
  v.box(0, 6, 1, 29, 6, 12, top).box(1, 6, 0, 28, 6, 13, top).box(0, 6, 0, 0, 6, 0, null);
  v.box(13, 0, 5, 16, 5, 8, '#6d4c41').box(10, 0, 4, 19, 0, 9, '#5d4037');
  return mesh(v, {pivot: [15, 0, 7]});
}
export function stool(color) {
  return mesh(new Vox().box(0, 4, 0, 4, 4, 4, color).box(2, 0, 2, 2, 3, 2, '#6b6f78').box(1, 0, 1, 3, 0, 3, '#4a4d55'), {pivot: [2.5, 0, 2.5]});
}
export function plant(seed = 1, big = true) {
  const r = rnd(seed * 7919), v = new Vox(), h = big ? 9 : 4;
  v.box(0, 0, 0, 3, 3, 3, '#b5653a').box(0, 3, 0, 3, 3, 3, '#5d4037');
  for (let i = 0; i < (big ? 70 : 18); i++) {
    const y = 4 + Math.floor(r() * h), w = Math.max(1, Math.round((big ? 3.2 : 1.8) * (1 - (y - 4) / (h + 3)) + r()));
    v.set(1 + Math.round((r() - 0.5) * w * 2), y, 1 + Math.round((r() - 0.5) * w * 2), ['#2e7d32', '#388e3c', '#43a047', '#66bb6a'][Math.floor(r() * 4)]);
  }
  return mesh(v, {pivot: [2, 0, 2]});
}
export function coffeeCorner() {
  const v = new Vox(), wood = '#8d6e63';
  v.box(0, 0, 0, 17, 6, 5, wood).box(0, 7, 0, 17, 7, 5, '#eceff1');                                // counter
  v.box(2, 8, 1, 6, 13, 4, '#37474f').box(3, 9, 4, 5, 11, 4, '#90a4ae').box(3, 8, 5, 5, 8, 5, '#263238');  // machine
  v.box(9, 8, 2, 10, 9, 3, '#ffffff').box(12, 8, 2, 13, 9, 3, '#ffcc80');                          // cups
  v.box(14, 8, 1, 16, 15, 4, '#90caf9').box(14, 8, 1, 16, 9, 4, '#eceff1');                       // water cooler
  return mesh(v, {pivot: [9, 0, 3]});
}
export function sofa(color = '#26a69a') {
  const v = new Vox();
  v.box(0, 0, 0, 17, 3, 6, darker(color, 0.8)).box(0, 4, 0, 17, 9, 1, color).box(0, 4, 0, 1, 6, 6, color).box(16, 4, 0, 17, 6, 6, color);
  v.box(2, 4, 2, 7, 4, 6, darker(color, 1.15)).box(10, 4, 2, 15, 4, 6, darker(color, 1.15));
  return mesh(v, {pivot: [9, 0, 3.5]});
}
export function rack() {
  const v = new Vox().box(0, 0, 0, 6, 19, 6, '#1c1f26');
  for (let y = 2; y <= 17; y += 3) v.box(1, y, 7, 5, y + 1, 7, '#2d323c');
  return mesh(v, {pivot: [3.5, 0, 3.5]});
}
export function shelf(seed = 3) {
  const r = rnd(seed), v = new Vox().box(0, 0, 0, 15, 19, 0, '#6d4c41');
  for (const y of [0, 6, 12, 19]) v.box(0, y, 0, 15, y, 4, '#8d6e63');
  v.box(0, 0, 0, 0, 19, 4, '#8d6e63').box(15, 0, 0, 15, 19, 4, '#8d6e63');
  const books = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#00838f', '#ef6c00', '#4e342e'];
  for (const y of [1, 7, 13]) for (let x = 1; x < 15; x++) if (r() < 0.82) v.box(x, y, 1, x, y + 2 + Math.floor(r() * 3), 3, books[Math.floor(r() * books.length)]);
  return mesh(v, {pivot: [8, 0, 2]});
}
export function printer() {
  const v = new Vox().box(0, 0, 0, 7, 3, 5, '#e0e0e0').box(0, 4, 0, 7, 4, 5, '#bdbdbd').box(2, 2, 6, 5, 2, 7, '#f5f5f5').box(6, 4, 4, 6, 4, 4, '#4caf50');
  const g = new THREE.Group(); g.add(mesh(v, {pivot: [4, 0, 3]}));
  const legs = new Vox().box(0, 0, 0, 9, 5, 7, '#455a64').box(1, 1, 7, 8, 4, 7, '#37474f');
  const base = mesh(legs, {pivot: [5, 0, 4]}); g.add(base); g.children[0].position.y = 0.6;
  return g;
}
export function floorLamp() {
  const g = new THREE.Group();
  g.add(mesh(new Vox().box(0, 0, 0, 3, 0, 3, '#37474f').box(1, 1, 1, 2, 16, 2, '#455a64').box(0, 17, 0, 3, 19, 3, '#ffe0b2'), {pivot: [2, 0, 2]}));
  return g;
}

/** an inclusive rectangle of floor tiles at 0.5 m, wood planks with rugs drawn on top */
export function floor(w, d, rugs = []) {
  const v = new Vox();
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) v.set(x, 0, z, WOOD[(z + (x % 3 === 0 ? 1 : 0)) % WOOD.length]);
  for (const {x0, z0, x1, z1, color, border} of rugs)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.set(x, 0, z, x === x0 || x === x1 || z === z0 || z === z1 ? border : color);
  const m = mesh(v, {pivot: [w / 2, 1, d / 2], scale: 0.5, jitter: 0.08});
  m.castShadow = false;
  return m;
}

/** a wall of 0.25 m voxels along x (length cells, height cells), with window holes [from, to] in cells */
export function wall(length, height, holes = [], color = '#e8dfcc') {
  const v = new Vox();
  for (let x = 0; x < length; x++) for (let y = 0; y < height; y++) {
    const hole = holes.some(([a, b]) => x >= a && x <= b && y >= 3 && y <= 9);
    if (hole) continue;
    const frame = holes.some(([a, b]) => (x === a - 1 || x === b + 1) && y >= 3 && y <= 9) || holes.some(([a, b]) => x >= a - 1 && x <= b + 1 && (y === 2 || y === 10));
    v.set(x, y, 0, y === 0 ? '#8d6e63' : frame ? '#fafafa' : y === 11 ? darker(color, 0.9) : color);
  }
  return mesh(v, {pivot: [0, 0, 0.5], scale: 0.25, jitter: 0.03});
}

/** a big pixel/voxel block for the skyline, dark with lit windows drawn by the caller */
export function building(w, h, d, color) {
  return mesh(new Vox().box(0, 0, 0, w - 1, h - 1, d - 1, color), {pivot: [w / 2, 0, d / 2], scale: 0.5, ao: false, jitter: 0.04});
}

// ------------------------------------------------------------------ the office kit (pods, glass rooms, kitchen)
export function workDesk(top = '#e9e7e2') {
  const v = new Vox(), metal = '#3b3f46';
  v.box(0, 6, 0, 15, 6, 7, top).box(0, 6, 7, 15, 6, 7, darker(top, 0.9));
  v.box(0, 0, 1, 0, 5, 6, metal).box(15, 0, 1, 15, 5, 6, metal).box(0, 0, 0, 0, 0, 7, metal).box(15, 0, 0, 15, 0, 7, metal);
  v.box(2, 4, 1, 13, 4, 2, '#4a4f58');                                                                   // cable tray
  return mesh(v, {pivot: [8, 0, 4]});
}
/** a fabric screen between facing desks, len in voxels along x */
export function divider(len = 34, color = '#5b7380') {
  const v = new Vox().box(0, 7, 0, len - 1, 11, 0, (x, y) => (x + y) % 5 === 0 ? darker(color, 0.92) : color)
    .box(0, 12, 0, len - 1, 12, 0, '#9aa3ad').box(0, 0, 0, 0, 12, 0, '#9aa3ad').box(len - 1, 0, 0, len - 1, 12, 0, '#9aa3ad');
  return mesh(v, {pivot: [len / 2, 0, 0.5]});
}
export function deskLamp() {
  return mesh(new Vox().box(0, 0, 0, 2, 0, 2, '#2f3338').box(1, 1, 1, 1, 5, 1, '#2f3338').box(1, 5, 2, 1, 5, 3, '#2f3338').box(0, 4, 3, 2, 4, 5, '#f2f0e6'), {pivot: [1.5, 0, 1.5]});
}
/** aluminium posts and rails of a glass wall, len in metres along x; the glass is a separate pane */
export function glassFrame(len, door = null) {
  const v = new Vox(), n = Math.round(len * 10), al = '#a7b0ba';
  v.box(0, 25, 0, n - 1, 25, 0, al).box(0, 0, 0, n - 1, 0, 0, al);
  for (let x = 0; x < n; x += 10) v.box(x, 0, 0, x, 25, 0, al);
  v.box(n - 1, 0, 0, n - 1, 25, 0, al);
  if (door) for (let x = Math.round(door[0] * 10); x <= Math.round(door[1] * 10); x++) v.del(x, 0, 0);
  return mesh(v, {pivot: [0, 0, 0.5]});
}
export const GLASS = new THREE.MeshStandardMaterial({color: '#cfe8f5', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide});
export function glassPane(len, h = 2.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), GLASS); m.renderOrder = 2;
  return m;
}
export function confTable() {
  const v = new Vox(), wood = '#5a463b';
  v.box(0, 7, 0, 27, 7, 11, wood).box(1, 7, 0, 26, 7, 0, darker(wood, 0.85));
  v.box(6, 0, 4, 7, 6, 7, '#3b3f46').box(20, 0, 4, 21, 6, 7, '#3b3f46').box(4, 0, 5, 9, 0, 6, '#3b3f46').box(18, 0, 5, 23, 0, 6, '#3b3f46');
  v.box(12, 8, 5, 15, 8, 6, '#2b2f38');                                                                  // conference phone
  return mesh(v, {pivot: [14, 0, 6]});
}
export function meetChair(color = '#3d434c') {
  const v = new Vox();
  v.box(2, 0, 2, 2, 3, 2, '#7a7f8c').box(0, 0, 2, 4, 0, 2, '#2a2d33').box(2, 0, 0, 2, 0, 4, '#2a2d33');
  v.box(0, 4, 0, 4, 4, 4, color).box(0, 5, 4, 4, 8, 4, color);
  return mesh(v, {pivot: [2.5, 0, 2.5]});
}
/** kitchen run along x (length in voxels): base cabinets, stone top, sink, coffee machine, kettle */
export function kitchen(len = 28) {
  const v = new Vox(), white = '#f0eee9', stone = '#3a3f45';
  v.box(0, 0, 0, len - 1, 7, 5, white).box(0, 8, 0, len - 1, 8, 5, stone);
  for (let x = 0; x < len; x += 7) v.box(x, 1, 6, x, 6, 6, '#d6d3cc').box(x + 3, 6, 6, x + 4, 6, 6, '#8a8f99');
  v.box(4, 8, 2, 9, 8, 4, '#9aa3ad').box(6, 9, 0, 6, 11, 1, '#9aa3ad');                                // sink and tap
  v.box(14, 9, 1, 18, 14, 4, '#1f2328').box(15, 10, 4, 17, 12, 4, '#7d8792').box(15, 9, 5, 17, 9, 5, '#2c2f36');  // espresso machine
  v.box(15, 9, 5, 15, 9, 5, '#ffffff');
  v.box(22, 9, 2, 24, 12, 4, '#c0392b').set(23, 13, 3, '#2c2f36');                                    // kettle
  return mesh(v, {pivot: [len / 2, 0, 3]});
}
export function upperCabinets(len = 28) {
  const v = new Vox().box(0, 0, 0, len - 1, 6, 3, '#f0eee9');
  for (let x = 0; x < len; x += 7) v.box(x, 0, 4, x, 6, 4, '#d6d3cc').box(x + 3, 0, 4, x + 4, 0, 4, '#8a8f99');
  return mesh(v, {pivot: [len / 2, 0, 2]});
}
export function fridge() {
  return mesh(new Vox().box(0, 0, 0, 7, 19, 6, '#cfd4da').box(0, 12, 7, 7, 12, 7, '#aeb5bd').box(6, 5, 7, 6, 10, 7, '#7d8792').box(6, 14, 7, 6, 17, 7, '#7d8792'), {pivot: [4, 0, 3.5]});
}
export function barTable() {
  return mesh(new Vox().box(0, 10, 0, 9, 10, 9, '#a87443').box(4, 0, 4, 5, 9, 5, '#2f3338').box(2, 0, 2, 7, 0, 7, '#2f3338'), {pivot: [5, 0, 5]});
}
export function barStool(color = '#3d434c') {
  return mesh(new Vox().box(0, 7, 0, 3, 7, 3, color).box(1, 0, 1, 2, 6, 2, '#7a7f8c').box(0, 3, 0, 3, 3, 0, '#7a7f8c').box(0, 0, 0, 3, 0, 3, '#2f3338'), {pivot: [2, 0, 2]});
}
export function coffeeTable() {
  return mesh(new Vox().box(0, 3, 0, 9, 3, 5, '#a87443').box(0, 0, 0, 0, 2, 0, '#2f3338').box(9, 0, 0, 9, 2, 0, '#2f3338').box(0, 0, 5, 0, 2, 5, '#2f3338').box(9, 0, 5, 9, 2, 5, '#2f3338').box(2, 4, 2, 3, 4, 3, '#ffffff'), {pivot: [5, 0, 3]});
}
export function planter(seed = 1) {
  const r = rnd(seed * 31), v = new Vox().box(0, 0, 0, 4, 4, 4, '#5f6670').box(0, 4, 0, 4, 4, 4, '#4e342e');
  for (let i = 0; i < 90; i++) {
    const y = 5 + Math.floor(r() * 12), w = Math.max(1, Math.round(3.4 * (1 - (y - 5) / 16) + r()));
    v.set(2 + Math.round((r() - 0.5) * w * 2), y, 2 + Math.round((r() - 0.5) * w * 2), ['#2e7d32', '#388e3c', '#43a047', '#1b5e20'][Math.floor(r() * 4)]);
  }
  return mesh(v, {pivot: [2.5, 0, 2.5]});
}
/** floor of 0.5 m tiles coloured by zone: fn(x, z) -> colour, x and z tile indices */
export function zoneFloor(w, d, fn) {
  const v = new Vox();
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) v.set(x, 0, z, fn(x, z));
  const m = mesh(v, {pivot: [w / 2, 1, d / 2], scale: 0.5, jitter: 0.05});
  m.castShadow = false;
  return m;
}
/** a wall like wall(), but its windows have venetian blinds: slats every other row */
export function blindWall(length, height, holes = [], color = '#ece8e1') {
  const v = new Vox();
  for (let x = 0; x < length; x++) for (let y = 0; y < height; y++) {
    const inHole = holes.some(([a, b]) => x >= a && x <= b && y >= 3 && y <= 9);
    const frame = holes.some(([a, b]) => (x === a - 1 || x === b + 1) && y >= 3 && y <= 9) || holes.some(([a, b]) => x >= a - 1 && x <= b + 1 && (y === 2 || y === 10));
    if (inHole) { if (y % 2 === 0) v.set(x, y, 1, '#e3e6e8'); continue; }
    v.set(x, y, 0, y === 0 ? '#5f6670' : frame ? '#f7f7f5' : y === 11 ? darker(color, 0.9) : color);
  }
  return mesh(v, {pivot: [0, 0, 0.5], scale: 0.25, jitter: 0.03});
}
