// The guns of the paintball mode: the numbers of each weapon, its voxel model (fine boxes, about 1 cm) and its HUD icon.
// A model is a list of parts; the first one is the body and never moves. The other parts have a role that office-paintball.js
// animates: 'slide' goes back with every shot, 'pump' goes back and forth after a shot (pump, bolt), 'mag' drops while
// reloading, 'spin' turns (the drum of the launcher, the barrels of the minigun). Boxes are [w, h, d, x, y, z, colour] in
// centimetres: x right, y up, z towards you, the barrel points to -z.

/** voxel boxes (metres) to one geometry with the colour of every box and a different shade for each face */
export function boxGeo(THREE, boxes) {
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

/** The numbers to play with. tracer: the colour of the streak behind the ball. auto: keeps firing while the button is down.
 * pvp: the share of the damage that counts against a friend. area/areaDamage: the burst of the launcher (metres, damage at the centre).
 * zoom: how many times the sniper magnifies. spin: the share of the spin-up the minigun needs before it fires. */
export const WEAPONS = [
  {id: 'pistol',  it: 'Pistola',        en: 'Pistol',           tracer: '#ffe14d', pellets: 1, damage: 20, spread: 0.004, range: 80,  cooldown: 0.32,  speed: 75,  kick: 0.5,  mag: 12,  reload: 1.1, trail: 0.7},
  {id: 'smg',     it: 'Mitra',          en: 'SMG',              tracer: '#ff9a1f', pellets: 1, damage: 8,  spread: 0.022, range: 70,  cooldown: 0.085, speed: 70,  kick: 0.28, mag: 36,  reload: 1.5, trail: 0.6, auto: true},
  {id: 'shotgun', it: 'Fucile a pompa', en: 'Shotgun',          tracer: '#ffffff', pellets: 7, damage: 10, spread: 0.1,   range: 10,  cooldown: 0.95,  speed: 50,  kick: 1.0,  mag: 6,   reload: 2.0, trail: 0.5},
  {id: 'sniper',  it: 'Cecchino',       en: 'Sniper',           tracer: '#4dd2ff', pellets: 1, damage: 80, spread: 0.035, range: 160, cooldown: 1.25,  speed: 150, kick: 1.5,  mag: 5,   reload: 2.2, trail: 2.2, tw: 1.7, zoom: 3.2, pvp: 0.5},
  {id: 'grenade', it: 'Lanciagranate',  en: 'Grenade launcher', tracer: '#9cff3a', pellets: 1, damage: 30, spread: 0.01,  range: 34,  cooldown: 1.1,   speed: 26,  kick: 1.3,  mag: 4,   reload: 2.3, trail: 0.5, size: 2.6, lob: true, area: 2.6, areaDamage: 48, pvp: 0.6},
  {id: 'minigun', it: 'Minigun',        en: 'Minigun',          tracer: '#ff4d5e', pellets: 1, damage: 5,  spread: 0.05,  range: 60,  cooldown: 0.055, speed: 75,  kick: 0.16, mag: 160, reload: 3.0, trail: 0.6, auto: true, spin: 0.55, pvp: 0.6},
];

// ------------------------------------------------------------------ the models
const K = '#2b2f37', D = '#3d434d', S = '#5a636f', M = '#7b838f', L = '#9aa1ac', H = '#d3d8df', W1 = '#9a7b6c', W2 = '#6a4a3e', GL = '#353941', GL2 = '#4a4f58', SL = '#44567a';
const rep = (n, f) => Array.from({length: n}, (_, i) => f(i));
/** the right hand closed on a grip at (x, y, z), and the sleeve that goes back out of the picture */
const rhand = (x, y, z) => [[4.4, 3.8, 4.6, x, y + 0.9, z, GL], [4.6, 1.0, 1.5, x, y + 2.3, z - 3.0, GL2], [4.6, 1.0, 1.5, x, y + 1.2, z - 3.0, GL2], [4.6, 1.0, 1.5, x, y + 0.1, z - 3.0, GL2], [4.6, 1.0, 1.5, x, y - 1.0, z - 3.0, GL2],
  [1.3, 1.4, 4.2, x - 2.5, y + 2.2, z - 0.6, GL2], [4.0, 0.7, 1.4, x, y + 3.0, z - 1.6, '#555a63'], [5.0, 5.0, 17, x + 0.6, y - 0.6, z + 11, SL], [5.4, 5.4, 1.4, x + 0.6, y - 0.6, z + 2.6, H]];
/** the left hand under a fore-end at (x, y, z) */
const lhand = (x, y, z) => [[5.0, 2.2, 6.0, x, y - 1.4, z, GL], [1.4, 3.4, 5.6, x - 2.8, y + 0.2, z, GL2], [1.4, 3.4, 5.6, x + 2.8, y + 0.2, z, GL2], [4.6, 1.0, 1.4, x, y + 1.6, z - 2.8, GL2], [5.2, 5.0, 17, x - 2.2, y - 4.6, z + 12, SL], [5.6, 5.4, 1.4, x - 2.2, y - 4.6, z + 3.8, H]];
const ring = (r, n, f) => rep(n, i => f(Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r, i));

export const GUNS = {
  pistol: {
    scale: 1, pos: [0.15, -0.125, -0.38], tip: [0, 3.5, -10.8], eject: [1.9, 4.4, 1.0], flash: 0.16, kickZ: 0.05,
    parts: [
      {boxes: [[3.0, 2.0, 15.5, 0, 1.4, -0.3, S], [3.0, 1.6, 5.5, 0, 0.6, -8.2, S], [3.0, 0.7, 6.4, 0, -0.5, -1.4, D], [3.0, 1.8, 0.8, 0, 0.4, -4.4, D], [0.8, 1.6, 0.9, 0, 0.4, -1.6, H],
        ...rep(5, i => [3.2, 2.1, 5.2, 0, -1.0 - i * 2.1, 4.0 + i * 0.55, K]), [0.5, 7.4, 3.8, 1.85, -5.2, 5.2, W1], [0.5, 7.4, 3.8, -1.85, -5.2, 5.2, W1],
        ...rep(3, j => [0.6, 0.8, 0.8, 1.95, -3.4 - j * 1.9, 4.2 + (j % 2) * 2, W2]), [3.0, 8.5, 1.2, 0, -4.6, 8.0, D], ...rhand(0, -4.4, 6.4)]},
      {role: 'slide', amp: 4.2, boxes: [[3.4, 3.2, 17, 0, 3.6, -0.8, H], [2.6, 0.7, 15.5, 0, 5.55, -0.8, L], ...rep(4, i => [3.6, 2.4, 0.5, 0, 3.6, 4.2 + i * 1.1, M]), [2.0, 2.0, 1.4, 0, 3.4, -9.9, K],
        [0.8, 1.3, 0.8, 0, 6.2, -8.2, '#ff5252'], [1.0, 1.2, 0.8, -1.1, 6.1, 6.4, K], [1.0, 1.2, 0.8, 1.1, 6.1, 6.4, K], [0.5, 1.6, 4.5, 1.75, 4.0, 0.3, K]]},
      {role: 'mag', amp: 7, boxes: [[3.0, 3.0, 4.8, 0, -9.0, 6.8, K], [3.5, 1.0, 5.4, 0, -10.9, 6.9, '#ff5252']]},
    ]},
  smg: {
    scale: 0.92, pos: [0.17, -0.12, -0.38], tip: [0, 1.0, -29.8], eject: [2.6, 2.4, -2], flash: 0.2, kickZ: 0.04,
    parts: [
      {boxes: [[5.0, 6.0, 24, 0, 0, 0, D], [4.6, 1.4, 24, 0, 3.6, 0, S], ...rep(6, i => [2.0, 0.6, 1.2, 0, 4.6, -10 + i * 4, M]), [4.0, 4.4, 6, 0, 0.6, -14.5, S], [3.4, 3.4, 9, 0, 1.0, -21.5, D],
        ...rep(4, i => [1.4, 0.5, 1.0, 0, 2.85, -18.5 - i * 2.2, K]), [2.6, 2.6, 3.4, 0, 1.0, -27.7, M], [1.4, 1.4, 0.6, 0, 1.0, -29.5, K],
        [0.8, 2.0, 0.8, 0, 5.4, -17, '#ff9a1f'], [0.6, 2.0, 0.6, -1.3, 5.3, -17, S], [0.6, 2.0, 0.6, 1.3, 5.3, -17, S], [3.2, 1.6, 1.4, 0, 5.2, 6, S],
        [0.9, 0.9, 12, 1.6, 1.5, 18, M], [0.9, 0.9, 12, -1.6, 1.5, 18, M], [0.9, 4.4, 0.9, 1.6, -0.6, 24, M], [0.9, 4.4, 0.9, -1.6, -0.6, 24, M], [4.2, 5.0, 1.2, 0, 0.6, 24.6, D],
        ...rep(4, i => [4.0, 2.6, 4.2, 0, -4.6 - i * 2.4, 5.5 + i * 0.5, K]), [0.5, 6, 3.4, 2.2, -8, 7, W2], [0.5, 6, 3.4, -2.2, -8, 7, W2],
        [3, 0.8, 7, 0, -3.4, -1.5, D], [0.8, 1.6, 0.8, 0, -2.4, -0.5, H], [3.6, 5.5, 3.4, 0, -5, -11, K], [3.8, 0.8, 3.6, 0, -2.6, -11, '#ff9a1f'], [0.5, 1.8, 6, 2.55, 2.0, -2, K],
        ...rhand(0, -7.4, 7.2), ...lhand(0, -6.4, -11)]},
      {role: 'slide', amp: 2.4, boxes: [[2.4, 1.6, 3.2, 3.2, 2.8, 2, H], [1.2, 1.2, 2.6, 2.6, 2.8, 1, L]]},
      {role: 'mag', amp: 9, boxes: [[3.4, 12, 4.4, 0, -8.0, -5, K], [3.6, 1.0, 4.6, 0, -12.3, -5, '#ff9a1f'], [0.4, 6, 2, 1.75, -7, -5, '#ffd54f']]},
    ]},
  shotgun: {
    scale: 0.88, pos: [0.16, -0.14, -0.36], tip: [0, 2.6, -53.2], eject: [2.4, 2.4, -3], flash: 0.3, kickZ: 0.08,
    parts: [
      {boxes: [[2.4, 2.4, 48, 0, 2.6, -28, L], [2.8, 2.8, 1.4, 0, 2.6, -52.5, D], [0.8, 1.4, 0.8, 0, 4.5, -52, '#ffffff'], [1.0, 0.8, 44, 0, 4.2, -28, H],
        [2.2, 2.2, 34, 0, -0.2, -19, S], [2.8, 2.8, 1.4, 0, -0.2, -36.5, D], [3.0, 3.0, 1.2, 0, -0.2, -28, M], [3.0, 3.0, 1.2, 0, -0.2, -14, M],
        [4.6, 6.8, 17, 0, 0.8, 0, D], [3.6, 1.0, 17, 0, 4.6, 0, S], [0.4, 2.4, 6, 2.35, 0.6, 2, K], [0.4, 2.0, 5, 2.35, 2.6, -3, K],
        [3.0, 0.8, 6, 0, -3.2, 3, D], [0.8, 1.6, 0.8, 0, -2.2, 2.6, H],
        [4.2, 7, 6, 0, 0.4, 10, W1], [4.2, 7.4, 6, 0, -0.2, 16, W1], [4.2, 8, 6, 0, -1.2, 22, W1], [4.2, 9, 5, 0, -2.2, 27.5, W1], [4.4, 9.6, 1.2, 0, -2.4, 30.8, D],
        ...rep(4, i => [4.4, 0.5, 5, 0, 3.3 - i * 2.4 - 0.5, 12 + i * 4, W2]),
        ...rep(3, i => [1.5, 1.4, 4.2, -2.55, 1.6 + i * 1.7, 6.5, '#e53935']), ...rep(3, i => [1.5, 1.4, 1.2, -2.55, 1.6 + i * 1.7, 9.0, '#d4a017']), ...rhand(0, -3.6, 9.5)]},
      {role: 'pump', amp: 7.5, boxes: [[4.8, 4.4, 13, 0, -2.4, -20, W1], ...rep(4, i => [5.0, 4.6, 0.7, 0, -2.4, -25 + i * 3, W2]), [4.6, 4.6, 1.0, 0, -2.4, -13.2, D], ...lhand(0, -2.2, -20)]},
    ]},
  sniper: {
    scale: 0.8, pos: [0.16, -0.14, -0.35], tip: [0, 2.2, -74.5], eject: [2.6, 2.8, 2], flash: 0.2, kickZ: 0.09, scoped: true,
    parts: [
      {boxes: [[2.2, 2.2, 60, 0, 2.2, -40, S], [3.4, 3.4, 6, 0, 2.2, -73, D], ...rep(2, i => [3.6, 1.0, 1.6, 0, 2.2, -71 - i * 2.6, K]), [4.4, 4.8, 20, 0, 0.6, -20, '#2f3b46'], [2.0, 0.8, 18, 0, 3.4, -20, M],
        [0.8, 0.8, 12, 2.6, -2.8, -24, L], [0.8, 0.8, 12, -2.6, -2.8, -24, L], [4.6, 6.0, 22, 0, 1.2, 0, '#37424e'], [3.2, 1.0, 22, 0, 4.7, 0, M],
        [3.2, 3.2, 26, 0, 7.6, -4, K], [4.6, 4.6, 5, 0, 7.6, -18.5, D], [4.0, 4.0, 4, 0, 7.6, 10, D], [3.6, 3.6, 0.6, 0, 7.6, -21.3, '#4dd2ff'], [1.8, 1.8, 2, 0, 9.9, -4, M], [1.8, 1.8, 2, 2.4, 7.6, -4, M],
        [2.4, 2.2, 2.4, 0, 5.2, -12, S], [2.4, 2.2, 2.4, 0, 5.2, 3, S], [3.4, 6, 7, 0, -4, 2, K], [3.6, 0.8, 7.2, 0, -5.6, 2, '#4dd2ff'],
        [4.2, 7, 10, 0, 0.2, 16, '#37424e'], [4.2, 9, 8, 0, -1, 24.5, '#37424e'], [3.8, 2.4, 10, 0, 5.4, 18, '#2b343d'], [4.4, 10.5, 2, 0, -1, 29.5, D],
        ...rep(3, i => [3.6, 2.8, 4.2, 0, -4.2 - i * 2.4, 8.5 + i * 0.5, '#2b343d']), [3.0, 0.7, 6, 0, -3.4, 4.5, D], [0.8, 1.6, 0.8, 0, -2.4, 4.5, H], ...rhand(0, -5.6, 9.8), ...lhand(0, -3.4, -18)]},
      {role: 'pump', amp: 6, boxes: [[2.4, 2.4, 10, 0, 3.6, 6, L], [3.4, 1.2, 1.2, 3.0, 2.8, 4, H], [2.0, 2.0, 2.0, 5.2, 2.8, 4, '#4dd2ff']]},
    ]},
  grenade: {
    scale: 0.78, pos: [0.17, -0.13, -0.36], tip: [0, 2.0, -37.5], eject: null, flash: 0.28, kickZ: 0.09,
    parts: [
      {boxes: [[6.0, 6.0, 26, 0, 2.0, -26, S], [7.2, 7.2, 3, 0, 2.0, -39.5, '#9cff3a'], [4.4, 4.4, 0.6, 0, 2.0, -41.2, K], [0.8, 2.0, 0.8, 0, 6.0, -34, '#9cff3a'],
        [5.6, 8, 16, 0, 0, 7, D], [3.2, 1.2, 16, 0, 4.6, 7, M], ...rep(5, i => [3.4, 0.5, 0.8, 0, 5.3, 1 + i * 3, K]),
        [0.8, 10, 12, 5.6, -1, -7, S], [0.8, 10, 12, -5.6, -1, -7, S], [5.6, 2.0, 12, 0, 5.4, -7, S],
        [4.4, 4.4, 16, 0, -4.4, -18, L], [4.6, 4.6, 2.4, 0, -4.4, -15, '#9cff3a'], [4.6, 4.6, 1.4, 0, -4.4, -25, D],
        [4.4, 7, 14, 0, 0, 20, D], [4.6, 9, 2, 0, -0.5, 27.5, K], ...rep(3, i => [3.6, 3.2, 4.4, 0, -5.4 - i * 2.6, 8.5 + i * 0.5, W2]), ...rhand(0, -8.8, 10), ...lhand(0, -6.2, -18)]},
      {role: 'spin', pivot: [0, -1, -7], boxes: [[3.2, 3.2, 12, 0, -1, -7, M], ...ring(3.7, 6, (x, y, i) => [3.0, 3.0, 11, x, y - 1, -7, i % 2 ? L : H]), ...ring(3.7, 6, (x, y, i) => [3.2, 3.2, 1.0, x, y - 1, -12.8, i % 2 ? '#9cff3a' : D])]},
    ]},
  minigun: {
    scale: 0.7, pos: [0.17, -0.12, -0.38], tip: [0, 0, -44.8], eject: [4.5, -3.5, -6], flash: 0.3, kickZ: 0.025,
    parts: [
      {boxes: [[10.5, 10.5, 14, 0, 0, -4, '#3a4048'], [10.9, 10.9, 1.4, 0, 0, -10.8, '#ff4d5e'], [8.6, 8.6, 8, 0, 0, 7, D], [2.6, 2.6, 16, 0, 7.8, -4, S], [2.6, 3.0, 2.6, 0, 6.4, -10, S], [2.6, 3.0, 2.6, 0, 6.4, 3, S],
        [8.4, 7, 12, 0, -9.4, -2, '#3b4a2f'], [8.6, 1.0, 12.4, 0, -6.2, -2, K], ...rep(5, i => [1.4, 1.4, 2.2, -3 + i * 1.5, -5.4 + (i % 2) * 0.5, -2, '#d4a017']),
        ...rep(3, i => [3.4, 3.2, 3.8, 0, -8.2 - i * 2.6, 8 + i * 0.4, D]), [0.8, 1.8, 0.8, 0, -4.6, 3, H], ...rhand(0, -10.4, 10.4), ...lhand(0, 10, -4)]},
      {role: 'spin', pivot: [0, 0, 0], boxes: [...ring(3.1, 6, (x, y, i) => [1.7, 1.7, 36, x, y, -26, i % 2 ? S : M]), [8.6, 5.6, 1.6, 0, 0, -43, D], [5.6, 8.6, 1.6, 0, 0, -43, D], [8.6, 5.6, 1.4, 0, 0, -30, D], [5.6, 8.6, 1.4, 0, 0, -30, D],
        [7.4, 7.4, 6, 0, 0, -14.5, M], ...ring(3.1, 6, (x, y) => [1.9, 1.9, 1.0, x, y, -44.2, K])]},
    ]},
};
export const GUN_ORDER = ['pistol', 'smg', 'shotgun', 'sniper', 'grenade', 'minigun'];

/** the HUD icons, rows of letters (see PAL in office-paintball.js), '.' empty */
export const GUN_ICONS = {
  pistol: ['.......rrr......', '.bbbbbbbbbbbbb..', '.bbbbbbbbbbbbgg.', '.dddddddddddg...', '.ddddddddd......', '..hhh.dd........', '..hhh...........', '..hhh...........'],
  smg: ['.......oooo.......', '.......oooo.......', '.bbbbbbbbbbbbbbgg.', 'kbbbbbbbbbbbbbbggg', 'kddddddddddddg....', 'kk.hh..oo.........', '...hh..oo.........', '...hh..oo.........'],
  shotgun: ['..rrr.............', '..rrr.............', '.dddgggggggggggggg', 'hddddbbbbbbbbbbbbb', 'hhdd..hhhh........', 'hhh...............'],
  sniper: ['.........kkkkk............', '.........aaakk.............', 'gggggggggggggddddd.........', 'bbbbbbbbbbbbbdddddhhhhhhhhh', '.........dd..kddhhhhhhhhh..', '.............kk..hh.hh.....'],
  grenade: ['....llll.................', '.llllllllgggggggggg.......', '.llll.ggddddddddddgg......', '......mmmmddddddd.........', '.......mhhdddddhhh........', '........hhh..hhhh.........'],
  minigun: ['.gggggggggg...............', 'gbgbgbgbgbddddddd.........', 'gbgbgbgbgbdrrdddd.yyy.....', 'gbgbgbgbgbddddddddyyy.....', '.gggggggggg.dd..hh........', '............dd..hh........'],
};
