// The floor: one flat piece per zone of the plan (office-layout.js floor.zones), each with a pixel-art texture drawn on
// a canvas: carpet tiles, wooden planks, ceramic tiles with grout, stone slabs, gym rubber, a rug with its border.
// The voxel look at 32 pixels a metre: pixels stay sharp up close (nearest filter)
// and calm in the distance (mipmaps, anisotropic filtering). A dozen draw calls; textures repeat in world space.

const PX = 32;                                         // texels per metre
const rnd = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shade = (hex, f) => {                            // a colour made lighter (f > 1) or darker (f < 1)
  const n = parseInt(hex.slice(1), 16), c = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
const dot = (g, x, y, color) => { g.fillStyle = color; g.fillRect(x, y, 1, 1); };
/** single pixels a bit lighter or darker: fibres, grain */
function speckle(g, w, h, r, n, base, amount = 0.08) {
  for (let i = 0; i < n; i++) dot(g, Math.floor(r() * w), Math.floor(r() * h), shade(base, 1 + (r() < 0.5 ? -amount : amount)));
}
function planks(g, w, h, {wood, ph, seed}) {          // rows `ph` pixels tall, staggered planks, grain, 1 px seams
  const r = rnd(seed);
  for (let y = 0; y < h; y += ph) {
    let x = -Math.floor(r() * w * 0.5);
    while (x < w) {
      const len = Math.floor(w * (0.3 + r() * 0.3)), base = shade(wood, 0.88 + r() * 0.22).match(/\d+/g).map(Number);
      const hex = '#' + base.map(v => v.toString(16).padStart(2, '0')).join('');
      g.fillStyle = hex; g.fillRect(x, y, len, ph);
      for (let k = 0; k < len * ph / 6; k++) {         // grain: short runs along the plank
        const gx = x + Math.floor(r() * len), gy = y + 1 + Math.floor(r() * (ph - 1));
        g.fillStyle = shade(hex, r() < 0.7 ? 0.9 : 1.08); g.fillRect(gx, gy, 2 + Math.floor(r() * 4), 1);
      }
      g.fillStyle = shade(wood, 0.6); g.fillRect(x, y, 1, ph);        // the joint between two planks
      x += len;
    }
    g.fillStyle = shade(wood, 0.66); g.fillRect(0, y, w, 1);           // the seam between two rows
  }
  g.drawImage(g.canvas, 0, 0, 1, h, w - 1, 0, 1, h);  // the last column matches the first, so the repeat has no step
}
function grid(g, w, h, {color, grout, n, seed, vary = 0.05, mottle = 0}) {   // n x n tiles with 1 px grout
  const r = rnd(seed), s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const tone = shade(color, 1 - vary + r() * vary * 2);
    g.fillStyle = tone; g.fillRect(i * s, j * s, s, s);
    for (let k = 0; k < mottle * s * s / 64; k++) dot(g, i * s + Math.floor(r() * s), j * s + Math.floor(r() * s), shade(color, r() < 0.5 ? 0.9 : 1.07));
  }
  g.fillStyle = grout;
  for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, 1, h); g.fillRect(0, i * s, w, 1); }
}

// each kind: m = metres one texture covers (its size is m * PX pixels), rough = roughness, draw(g, w, h)
const KINDS = {
  carpet: {m: 1, rough: 0.95, draw(g, w, h) {                      // carpet tiles, 50 cm, the weave turned a quarter each
    const r = rnd(7), s = w / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const base = (i + j) % 2 ? '#5a616c' : '#545b66';
      g.fillStyle = base; g.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < s; k += 2) { g.fillStyle = shade(base, 0.93); if ((i + j) % 2) g.fillRect(i * s + k, j * s, 1, s); else g.fillRect(i * s, j * s + k, s, 1); }
    }
    speckle(g, w, h, r, w * h / 6, '#575e69', 0.1);
    g.fillStyle = '#41464f'; g.fillRect(0, 0, w, 1); g.fillRect(0, s, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(s, 0, 1, h);
  }},
  booth: {m: 1, rough: 0.95, draw(g, w, h) { g.fillStyle = '#474e5b'; g.fillRect(0, 0, w, h); speckle(g, w, h, rnd(3), w * h / 4, '#474e5b', 0.1); }},
  parquet: {m: 2, rough: 0.55, draw: (g, w, h) => planks(g, w, h, {wood: '#a2703f', ph: 5, seed: 11})},
  parquetLight: {m: 2, rough: 0.55, draw: (g, w, h) => planks(g, w, h, {wood: '#b98b5d', ph: 5, seed: 12})},
  common: {m: 2, rough: 0.6, draw: (g, w, h) => planks(g, w, h, {wood: '#a97b55', ph: 6, seed: 13})},
  tiles: {m: 1.2, rough: 0.35, draw: (g, w, h) => grid(g, w, h, {color: '#e2ddd3', grout: '#b7b0a4', n: 4, seed: 21, vary: 0.03, mottle: 2})},
  stone: {m: 2.4, rough: 0.7, draw: (g, w, h) => grid(g, w, h, {color: '#b8b3a9', grout: '#8f8a81', n: 4, seed: 22, vary: 0.07, mottle: 10})},
  game: {m: 1, rough: 0.8, draw(g, w, h) {                         // gym rubber tiles with small studs
    grid(g, w, h, {color: '#3c574a', grout: '#2c4237', n: 2, seed: 31, vary: 0.05, mottle: 3});
    for (let x = 2; x < w; x += 4) for (let y = 2; y < h; y += 4) dot(g, x, y, '#4a6a5a');
  }},
  mat: {m: 0.5, rough: 1, draw(g, w, h) { g.fillStyle = '#2f3136'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3d43'; for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1); }},
  bridge: {m: 1, rough: 0.5, draw(g, w, h) {                       // metal grating: diamonds of pixels
    g.fillStyle = '#4b5059'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if ((x + y) % 8 === 0 || (x - y + 64) % 8 === 0) dot(g, x, y, '#30343a');
  }},
  rug: {fit: true, rough: 1, draw(g, w, h) {                       // drawn to the rug's own size: a border and a pattern
    const r = rnd(41), b = Math.max(2, Math.round(Math.min(w, h) * 0.07));
    g.fillStyle = '#6b5b73'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if ((x + y) % 6 === 0) dot(g, x, y, '#61526a');
    g.fillStyle = '#4f4256'; g.fillRect(0, 0, w, b); g.fillRect(0, h - b, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
    g.fillStyle = '#c9a85b'; g.fillRect(b + 1, b + 1, w - 2 * b - 2, 1); g.fillRect(b + 1, h - b - 2, w - 2 * b - 2, 1);
    g.fillRect(b + 1, b + 1, 1, h - 2 * b - 2); g.fillRect(w - b - 2, b + 1, 1, h - 2 * b - 2);
    speckle(g, w, h, r, w * h / 8, '#6b5b73', 0.08);
  }},
};

/** the floor of the plan: size [w, d] in metres centred on 0, the base kind, and zones {x0, z0, x1, z1, kind} drawn
 *  over it in order (a later zone wins where they overlap, as before) */
export function buildFloor({THREE, renderer, size: [w, d], base, zones}) {
  const group = new THREE.Group(), aniso = renderer.capabilities.getMaxAnisotropy(), made = {};
  const texture = (draw, cw, ch) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    draw(c.getContext('2d'), cw, ch);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;                 // pixels, not blur, up close
    return t;
  };
  const piece = (x0, z0, x1, z1, kind, layer) => {
    const K = KINDS[kind] || KINDS.carpet;
    const map = K.fit ? texture(K.draw, Math.round((x1 - x0) * PX), Math.round((z1 - z0) * PX))
                      : made[kind] ??= texture(K.draw, K.m * PX, K.m * PX);
    const u = x => K.fit ? (x - x0) / (x1 - x0) : x / K.m, v = z => K.fit ? (z - z0) / (z1 - z0) : z / K.m;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u(x0), v(z0), u(x0), v(z1), u(x1), v(z1), u(x1), v(z0)], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({map, roughness: K.rough, metalness: 0,
                                                              polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 2}));
    m.receiveShadow = true; m.renderOrder = layer;
    group.add(m);
  };
  piece(-w / 2, -d / 2, w / 2, d / 2, base, 0);
  zones.forEach((z, i) => piece(z.x0, z.z0, z.x1, z.z1, z.kind, i + 1));
  return group;
}
