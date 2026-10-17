// The 3D voxel office of the chatroom viewer. One desk per agent; the user sits in the boss chair, and the lead
// (the session that opened the room) is the assistant with glasses beside the boss, who reads every chat message.
// What each figure does comes from the chat (statuses, idle, plans, votes, tags) and from /state.json (the tool
// each agent is running, permissions it waits for, its context), fed by the chatroom mod or the transcripts.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as V from './office-voxel.js';
import {DEFAULT_LAYOUT, CATALOG, resolve, floorPlan, workstation, LEAD3_ITEMS} from './office-layout.js';
import {createEditor} from './office-edit.js';
import {createTV, createRadio, createLofi, createMixer, mixLevel} from './office-tv.js';
import {createArcade, ARCADE_AT} from './office-arcade.js';
import {createGithubWall} from './office-github.js';
import {buildSigns} from './office-signs.js';
import {createRacks} from './office-rack.js';
import {buildFloor} from './office-floor.js';
import {createGames} from './office-games.js';
import {createPaintball} from './office-paintball.js';
import {createArena, createElevator, ARENA_Y, ELEVATOR_AT, ARENA_TEXT} from './office-arena.js';
import {mergeStatic} from './office-merge.js';
import {createUI, replayGames, EMOJI, unlockAudio, chime, notify, unnotify, badge} from './office-ui.js';

const pref = (k, d) => { try { const v = localStorage.getItem('chatroom.office.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('chatroom.office.' + k, JSON.stringify(v)); } catch (e) {} };
const lerp = (a, b, k) => a + (b - a) * k;
const wrapAng = a => (a + Math.PI * 3) % (Math.PI * 2) - Math.PI;
const angLerp = (a, b, k) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
// a PLAN, a VOTE or a CLOSED is read at the start of a line, after a reply mark, tags or markdown: the same reading as chat.py heads()
const LINE_HEAD = /^(?:\s*↪\s*#\d+|\s*@[\w-]+[\s,:]*|\s*\d{1,3}[.)]\s+|[^\p{L}\p{N}_@↪]+|_+)+/u;
const QUOTED = /^\s*(?:↪\s*#\d+\s*)?(?:@[\w-]+[\s,:]*)*[>"“”«‘’'`(]/u;   // somebody else's words: not read
const heads = t => String(t || '').split('\n').filter(l => l.trim() && !QUOTED.test(l)).map(l => l.replace(LINE_HEAD, '')).filter(h => h.trim());
const firstHead = t => heads(t)[0] || '';
const HEAD_END = String.raw`[*_]*(?!\s*[\p{L}])`;   // a heading: "PLAN v2: ...", "PLAN v1 (draft)", not "PLAN v2 also needs a test"
const PCT = /(\d{1,3})\s?%/g, PLAN = new RegExp(String.raw`^(PLAN|PIANO)\s*v(\d+)` + HEAD_END, 'iu'), CLOSED = new RegExp(String.raw`^(CLOSED|CHIUSO)(?:\s*[vV](\d+))?` + HEAD_END, 'u');
const VOTE = /^(VOTE|VOTO)\s*v?(\d+)\s*[*_]*\s*:\s*[*_]*\s*(yes|no|sì|si)(?![\p{L}\p{N}])/iu, voteOf = t => firstHead(t).match(VOTE), EVERY = /(^|[^\w@])@(all|tutti|everyone)\b/i;

// ------------------------------------------------------------------ renderer, scene, camera
const root = document.getElementById('office') || document.body.appendChild(Object.assign(document.createElement('div'), {id: 'office'}));
document.body.classList.add('has-office');
// the canvas's own MSAA only matters when the scene is drawn straight to it ('bassa'); through the composer (alta, media) the
// composer's target does the anti-aliasing and the canvas MSAA only costs a big buffer and a resolve every frame (about 20 ms
// on an integrated GPU). A context cannot change its anti-aliasing, so crossing to or from 'bassa' reloads the page (see onQuality).
const DIRECT = pref('quality', 'alta') === 'bassa';
const renderer = new THREE.WebGLRenderer({antialias: DIRECT, powerPreference: 'high-performance'});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
root.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#161824');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const HOME = {pos: new THREE.Vector3(...DEFAULT_LAYOUT.camera.pos), target: new THREE.Vector3(...DEFAULT_LAYOUT.camera.target)};
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
Object.assign(controls, {enableDamping: true, dampingFactor: 0.08, minDistance: 6, maxDistance: 75, minPolarAngle: 0.02,
                         maxPolarAngle: 1.55, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, screenSpacePanning: true});

const hemi = new THREE.HemisphereLight('#fff3df', '#5b4632', 0.9);
const sun = new THREE.DirectionalLight('#ffe8c4', 2.1);
sun.position.set(-17, 20, 9); sun.castShadow = true;
{
  const half = Math.max(...DEFAULT_LAYOUT.size) / 2 + 5;                  // the shadow box covers the whole floor
  Object.assign(sun.shadow.camera, {left: -half, right: half, top: half, bottom: -half, near: 1, far: 80});
}
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 1.5;
scene.add(hemi, sun);
let level = 'office';                                                        // 'office', or 'arena': the floor above for paintball and zombies (office-arena.js)
const lamps = [], towerWindows = [];                                       // warm point lights; lit windows of our own building

// ------------------------------------------------------------------ quality and post-processing
// sharp: 4x MSAA in the composer's own target (the canvas antialias does not reach post-processing), rendering
// above the screen resolution on high, crisp shadows, and no blur pass at all
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4}));
composer.addPass(new RenderPass(scene, camera));
// the output pass (tone mapping, sRGB) and, in the same shader, the grade on the finished picture: a gentle S curve, a touch
// more colour, a soft vignette (the bloom it replaces cost about 14 ms a frame and barely showed). One full-screen pass,
// straight to the screen: a separate grade pass cost a second half-float target (written, resolved, read back).
const output = new OutputPass();
output.material.fragmentShader = output.material.fragmentShader.replace(/\}\s*$/, `
	vec3 x = gl_FragColor.rgb;
	x = mix(x, x * x * (3.0 - 2.0 * x), 0.2);
	x = mix(vec3(dot(x, vec3(0.299, 0.587, 0.114))), x, 1.1);
	vec2 d = vUv - 0.5; x *= 1.0 - dot(d, d) * 0.4;
	gl_FragColor.rgb = x;
}`);
composer.addPass(output);
const QUALITY = ['alta', 'media', 'bassa'];
let quality = pref('quality', 'alta');
let basePr = 1, dynScale = 1;                                               // the quality's pixel ratio, and how much of it the GPU keeps up with
function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  basePr = quality === 'alta' ? Math.min(2, Math.max(1.5, dpr)) : quality === 'media' ? Math.min(dpr, 1.25) : 1;
  renderer.setPixelRatio(basePr * dynScale);
  renderer.shadowMap.enabled = quality !== 'bassa';
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;   // redrawn on a schedule (see frame)
  sun.shadow.mapSize.setScalar(2048);                                          // 4096 cost four times the fill for edges nobody sees
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { const ms = quality === 'alta' ? 4 : 2; if (rt.samples !== ms) { rt.samples = ms; rt.dispose(); } }
  resize();
}

// ------------------------------------------------------------------ canvas textures
const SS = 2;                                                   // boards are drawn at twice their size: crisp text
function board(w, h, px = 256) {
  const canvas = document.createElement('canvas');
  canvas.lw = px; canvas.lh = Math.round(px * h / w);           // the size the drawing code works in
  canvas.width = canvas.lw * SS; canvas.height = canvas.lh * SS;
  canvas.getContext('2d').scale(SS, SS);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mat = new THREE.MeshBasicMaterial({map: tex, toneMapped: false});
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return {mesh: m, canvas, g: canvas.getContext('2d'), tex, mat};
}
function wrapText(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= maxLines) return; }
    else line = test;
  }
  if (line && n < maxLines) g.fillText(line, x, y + n * lh);
}

// ------------------------------------------------------------------ the room, built from the layout
// office-layout.js holds the plan as data (furniture catalog, walls, glass, zones, boards, pods); here it turns into
// meshes, lights and the places people use. Outer walls drop to a low stub when the camera is outside them (the
// dollhouse view) and stand whole in first person, where the ceiling appears too.
const VISIT = new URLSearchParams(location.search).has('visit');            // visiting the friend whose common room you joined
const VISIT_URL = 'visit.json' + (new URLSearchParams(location.search).get('visit') ? '?who=' + encodeURIComponent(new URLSearchParams(location.search).get('visit')) : '');
const getJson = url => fetch(url, {cache: 'no-store'}).then(r => r.ok ? r.json() : null).catch(() => null);
// the pack models (before the room is built), the user's own office if they furnished one, their look, a friend's office on a visit: together
const [, saved, settingsJson, visitJson] = await Promise.all([V.loadPack('vendor/office-pack.json'), getJson('office.json'), getJson('settings.json'), VISIT ? getJson(VISIT_URL) : null]);
let visit = visitJson, myLook = settingsJson?.avatar || null;
// the console of the first default offices stood at the height of the TV's picture, in front of it, and an office saved then keeps it there:
// it is set on the floor beside the TV when the layout loads (only the one that was never moved)
const tidy = items => items.map(it => it.type === 'console' && it.x === -12.2 && it.y === 0.45 && it.z === 0.45 ? {...it, x: -11.25, y: 0, z: 0.5} : it);
// an office saved before the third lead's table existed gets it (three live rooms: three leads)
const conLead3 = items => items.some(it => it.tag === 'lead3') ? items : [...items, ...LEAD3_ITEMS];
const LAYOUT = visit ? {...DEFAULT_LAYOUT, items: tidy(visit.items || DEFAULT_LAYOUT.items)}
  : Array.isArray(saved?.items) ? {...DEFAULT_LAYOUT, items: conLead3(tidy(saved.items))} : DEFAULT_LAYOUT;
const PLACED = resolve(LAYOUT, {packSize: V.packSize});
const ARC_ON = !visit && LAYOUT.floor.zones.some(z => z.kind === 'common');                // the arcade cabinet stands in the common room, whatever the furniture of a saved office
if (ARC_ON) PLACED.boxes.push({x: ARCADE_AT.x, z: ARCADE_AT.z, hw: ARCADE_AT.hw, hd: ARCADE_AT.hd, rot: ARCADE_AT.rot});
const LIFT_ON = !visit;                                                      // the lift to the arena stands in the plaza of the office
if (LIFT_ON) PLACED.boxes.push({x: ELEVATOR_AT.x, z: ELEVATOR_AT.z, hw: ELEVATOR_AT.hw, hd: ELEVATOR_AT.hd, rot: 0});
const FLOOR = floorPlan(LAYOUT, PLACED);
const [SIZE_X, SIZE_Z] = LAYOUT.size;
const add = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m; };

scene.add(buildFloor({THREE, renderer, size: LAYOUT.size, base: LAYOUT.floor.base, zones: LAYOUT.floor.zones}));   // pixel-art textures per zone
const cutaway = [];
for (const w of PLACED.walls) {
  const cells = Math.round(w.len / 0.25), c = ([u, v]) => [Math.floor(u / 0.25 + 0.01), Math.ceil(v / 0.25 - 0.01) - 1];
  const holes = w.windows.map(c), doors = w.doors.map(c);
  const full = add(V.blindWall(cells, 12, holes, '#ece8e1', doors), w.a[0], 0, w.a[1], w.rot);
  const stub = add(V.blindWall(cells, 2, [], '#ece8e1', doors), w.a[0], 0, w.a[1], w.rot);
  cutaway.push({full, stub, mid: new THREE.Vector3(w.mid[0], 0, w.mid[1]), out: new THREE.Vector3(w.out[0], 0, w.out[1])});
  for (const [u, v] of w.windows) {                                        // the glass in each window
    const mid = (u + v) / 2, p = new THREE.Mesh(new THREE.PlaneGeometry(v - u, 1.75), V.WINDOW); p.renderOrder = 2;
    full.attach(add(p, w.a[0] + w.dx / w.len * mid, 1.62, w.a[1] + w.dz / w.len * mid, w.rot));
  }
}
for (const g of PLACED.glass) {
  add(V.glassFrame(g.len, g.doors.length ? g.doors : null), g.a[0], 0, g.a[1], g.rot);
  let from = 0;
  for (const [u, v] of [...[...g.doors].sort((p, q) => p[0] - q[0]), [g.len, g.len]]) {
    if (u - from > 0.05) {
      const mid = (from + u) / 2, x = g.a[0] + g.dx / g.len * mid, z = g.a[1] + g.dz / g.len * mid;
      add(V.glassPane(u - from), x, 1.25, z, g.rot);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(u - from, 0.12), V.FROST); band.renderOrder = 3; add(band, x, 1.1, z, g.rot);
    }
    from = v;
  }
}
// door leaves, open; the one onto the bridge swings open only while the common room is shared
let bridgeLeaf = null;
for (const d of PLACED.doors) {
  const leaf = add(d.kind === 'glass' ? V.glassDoor(d.len) : V.woodDoor(d.len), d.hinge[0], 0, d.hinge[1], d.rot);
  if (d.kind === 'bridge') { bridgeLeaf = leaf; leaf.userData.closed = d.rot; }
}
// the building the office is in, and the street far below: no black void out of the windows
{
  const [sx, sz] = LAYOUT.size;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.8, 0.3, sz + 0.8), new THREE.MeshStandardMaterial({color: '#8a9099', roughness: 0.9}));
  slab.position.set(0, -0.16, 0); slab.receiveShadow = true; scene.add(slab);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.4, 11.7, sz + 0.4), new THREE.MeshStandardMaterial({color: '#4f5663', roughness: 0.85}));
  tower.position.set(0, -6.15, 0); scene.add(tower);
  const street = board(260, 260, 1024); street.mesh.rotation.x = -Math.PI / 2; street.mesh.position.y = -12; scene.add(street.mesh);
  const {g, canvas: k} = street, m = k.lw / 260;                          // 1 m = m pixels; roads every 40 m, our block in the middle
  g.fillStyle = '#3b4048'; g.fillRect(0, 0, k.lw, k.lh);
  for (let c = -120; c <= 120; c += 40) {
    const p = (c + 130) * m;
    g.fillStyle = '#23272e'; g.fillRect(p - 5 * m, 0, 10 * m, k.lh); g.fillRect(0, p - 5 * m, k.lw, 10 * m);
    g.fillStyle = '#c9b458'; for (let t = 0; t < k.lw; t += 6 * m) { g.fillRect(p - 0.2 * m, t, 0.4 * m, 3 * m); g.fillRect(t, p - 0.2 * m, 3 * m, 0.4 * m); }
  }
  street.mat.color.setScalar(0.55); street.tex.needsUpdate = true;
  const lit = [], r = V.rnd(41);
  for (const [nx, nz, w] of [[0, 1, sx], [0, -1, sx], [1, 0, sz], [-1, 0, sz]]) for (let y = -10.5; y < -1; y += 2.4) for (let t = -w / 2 + 1; t < w / 2 - 0.5; t += 1.6) {
    if (r() < 0.55) lit.push([nx ? nx * (sx / 2 + 0.21) : t, y, nz ? nz * (sz / 2 + 0.21) : t, nx ? Math.sign(nx) * Math.PI / 2 : nz > 0 ? 0 : Math.PI]);
  }
  const own = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 1.2), new THREE.MeshBasicMaterial({color: '#e0b56a'}), lit.length);
  lit.forEach(([x, y, z, ry], i) => { const mm = new THREE.Matrix4().makeRotationY(ry); mm.setPosition(x, y, z); own.setMatrixAt(i, mm); });
  scene.add(own); towerWindows.push(own);
}
const buildItem = it => it.pack ? V.packModel(it.pack, it) : V[it.model](...it.args);
const ITEM_MESHES = [];                                                     // the pieces the editor can move (not walls, not cubicles)
for (const it of PLACED.items) {
  if (it.part) continue;                                                   // a cubicle of a block: built with its block below
  const m = add(buildItem(it), it.x, it.y, it.z, it.rot);
  if (it.src !== undefined) { m.userData.src = it.src; m.userData.label = it.label || ''; ITEM_MESHES.push(m); }
}
for (const [src, item] of (LAYOUT.items || []).entries()) if (item.type === 'pod' || item.type === 'workstation') {
  const m = placeItem(item); m.userData.src = src; m.userData.label = item.label || ''; ITEM_MESHES.push(m);
}
/** one layout piece as a mesh in the scene, for the editor; a cubicle block is one group (its desks come with the
 *  saved layout), a workstation an invisible handle (its desk is drawn with the other desks) */
function placeItem(item) {
  const r = resolve({items: [{...item, x: 0, z: 0, rot: 0}], pods: LAYOUT.pods}, {packSize: V.packSize}), g = new THREE.Group();
  if (item.type === 'workstation') g.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 1.8), new THREE.MeshBasicMaterial({transparent: true, opacity: 0, depthWrite: false})));
  else if (r.items.length === 1) return add(buildItem(r.items[0]), item.x, r.items[0].y, item.z, item.rot || 0);
  for (const it of r.items) { const m = buildItem(it); m.position.set(it.x, it.y, it.z); m.rotation.y = it.rot; g.add(m); }
  return add(g, item.x, 0, item.z, item.rot || 0);
}
for (const [x, y, z] of [...(PLACED.fx.light || []), ...(LAYOUT.lights || [])]) {
  const l = new THREE.PointLight('#ffcf8a', 1, 7, 1.6); l.position.set(x, y, z); scene.add(l); lamps.push(l);
}

// ceiling and its light panels: first person only
const ceiling = new THREE.Group();
{
  const p = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, SIZE_Z), new THREE.MeshStandardMaterial({color: '#e9e6df', roughness: 0.95}));
  p.rotation.x = Math.PI / 2; p.position.y = 3; ceiling.add(p);
  for (let x = -SIZE_X / 2 + 3; x < SIZE_X / 2 - 1; x += 4) for (let z = -SIZE_Z / 2 + 2.5; z < SIZE_Z / 2 - 1; z += 4) {
    const l = V.ceilingLight(); l.position.set(x, 2.99, z); ceiling.add(l);
  }
  ceiling.visible = false; scene.add(ceiling);
}

// sky all around and a city below the windows (the office is a few floors up)
const sky = board(30, 9, 512); sky.mat.color.setScalar(0.72); sky.mat.side = THREE.BackSide;
sky.mesh.geometry.dispose(); sky.mesh.geometry = new THREE.CylinderGeometry(70, 70, 60, 48, 1, true); sky.mesh.position.y = 10; scene.add(sky.mesh);
const city = new THREE.Group(), cityLights = [];
{
  const r = V.rnd(77), reach = Math.max(SIZE_X, SIZE_Z) / 2;
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.06;
    let R = reach + 7 + r() * 16;
    if (LAYOUT.bridge && Math.cos(a) > 0.55) R += 16;                    // leave room for the friend's building
    const h = 20 + Math.floor(r() * 30), w = 4 + Math.floor(r() * 5), b = V.building(w, h, 4, ['#2c3446', '#343c52', '#262d3d'][i % 3]);
    b.position.set(Math.sin(a) * R, -12, Math.cos(a) * R); b.rotation.y = a; b.castShadow = false; city.add(b);
    for (let k = 0; k < 7; k++) {                                 // lit windows on the face toward the office
      const lx = (r() - 0.5) * w * 0.45, ly = -11.5 + r() * h * 0.45, lz = -1.03;
      cityLights.push([b.position.x + lx * Math.cos(a) + lz * Math.sin(a), ly, b.position.z - lx * Math.sin(a) + lz * Math.cos(a), a + Math.PI]);
    }
  }
  scene.add(city);
}
const winGeo = new THREE.PlaneGeometry(0.3, 0.4), winMat = new THREE.MeshBasicMaterial({color: '#e0b56a'});
const winLights = new THREE.InstancedMesh(winGeo, winMat, cityLights.length);
cityLights.forEach(([x, y, z, ry], i) => { const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(x, y, z); winLights.setMatrixAt(i, m); });
scene.add(winLights);

function drawSky(hour) {
  const {g, canvas: c} = sky, night = hour < 6.5 || hour >= 20, dusk = !night && (hour < 8 || hour >= 18);
  const grad = g.createLinearGradient(0, 0, 0, c.lh);
  const stops = night ? ['#0a1030', '#1b2350', '#2b2f5e'] : dusk ? ['#3b4a8c', '#e07e57', '#f2b072'] : ['#4f97d1', '#8cc3ea', '#c9e6f7'];
  stops.forEach((s, i) => grad.addColorStop(i / 2, s));
  g.fillStyle = grad; g.fillRect(0, 0, c.lw, c.lh);
  if (night) { const r = V.rnd(5); g.fillStyle = '#fff'; for (let i = 0; i < 90; i++) g.fillRect(r() * c.lw, r() * c.lh * 0.6, 2, 2); }
  sky.tex.needsUpdate = true;
  winLights.visible = night || dusk;
  for (const t of towerWindows) t.visible = night || dusk;
  // the sky changes with the hour, the office does not go dark: at night the ceiling lights are on (a warm white from above)
  sun.color.set(night ? '#fff1de' : dusk ? '#ffd1a8' : '#ffe8c4'); sun.intensity = night ? 1.25 : dusk ? 1.6 : 1.9;
  hemi.intensity = night ? 0.8 : 0.85;
  for (const l of lamps) l.intensity = night ? 4.5 : dusk ? 2.5 : 1.0;
  scene.background.set(night ? '#11131d' : '#1c1f2c');
}

// boards on the walls: TV with the live chat, whiteboard (kanban), clock, coffee sign, the boss's nameplate
const placeBoard = (b, key) => { const s = LAYOUT.boards[key]; add(b.mesh, s.x, s.y, s.z, s.rot || 0); return b; };
const tv = placeBoard(board(2.2, 1.25, 512), 'tv'), wb = placeBoard(board(2.6, 1.4, 768), 'whiteboard');
for (const [b, w, h, col] of [[tv, 2.36, 1.4, '#16181f'], [wb, 2.76, 1.56, '#cfd3da']]) {
  const f = V.mesh(new V.Vox().box(0, 0, 0, Math.round(w * 10) - 1, Math.round(h * 10) - 1, 0, col), {pivot: [w * 5, h * 5, 1]});
  f.position.copy(b.mesh.position); f.rotation.y = b.mesh.rotation.y; f.translateZ(-0.02); scene.add(f);
}
const clock = placeBoard(board(0.7, 0.7, 128), 'clock');
const coffeeSign = placeBoard(board(1.1, 0.36, 256), 'coffeeSign');
const nameplate = placeBoard(board(0.55, 0.16, 256), 'nameplate');
const commonSign = LAYOUT.boards.commonSign ? placeBoard(board(1.7, 0.42, 256), 'commonSign') : null;
// the leaderboards on the wall of the games corner: the first of every game; E opens the full table
const scoreboard = board(2.0, 1.2, 512), sbAt = LAYOUT.boards.scoreboard || {x: -9.9, y: 1.75, z: -9.85, rot: 0};
add(scoreboard.mesh, sbAt.x, sbAt.y, sbAt.z, sbAt.rot || 0);
{ const f = V.mesh(new V.Vox().box(0, 0, 0, 20, 12, 0, '#3b2a14'), {pivot: [10, 6, 1]}); f.position.copy(scoreboard.mesh.position); f.rotation.y = scoreboard.mesh.rotation.y; f.translateZ(-0.02); scene.add(f); }
let scoresKey = '';
// the GitHub window between the task board and the live TV of the control room (office-github.js): there only when the viewer has a project folder (chat.py serve --repo)
const ghBoard = board(2.2, 1.3, 768), ghAt = LAYOUT.boards.github || {x: 1.1, y: 1.6, z: -9.85, rot: 0};
add(ghBoard.mesh, ghAt.x, ghAt.y, ghAt.z, ghAt.rot || 0);
const ghFrame = V.mesh(new V.Vox().box(0, 0, 0, 23, 14, 0, '#2a2412'), {pivot: [12, 7.5, 1]}); ghFrame.position.copy(ghBoard.mesh.position); ghFrame.rotation.y = ghBoard.mesh.rotation.y; ghFrame.translateZ(-0.02); scene.add(ghFrame);
const signs = visit ? null : buildSigns({THREE, scene, V, signs: LAYOUT.signs || [], lang: () => DATA.config.lang});          // the neon signs and the guide at the entrance
let github = null;                                                         // made below, once the clickable things exist
ghBoard.mesh.visible = false; ghFrame.visible = false;

// the common room's door and, while the room is shared with friends, a glass bridge to their building
const bridge = new THREE.Group(), commonDoor = new THREE.Group();
let friendSign = null, bridgeOpen = null;
/** while shared, the bridge's floor is walkable and its door open; otherwise the door is shut and blocks the way */
function openBridge(on) {
  const B = LAYOUT.bridge, w = B.width;
  if (bridgeLeaf) bridgeLeaf.rotation.y = bridgeLeaf.userData.closed + (on ? 100 * Math.PI / 180 : 0);
  FLOOR.setExtra(on ? [{x0: B.x - w / 2, z0: B.z - 0.2, x1: B.x + w / 2, z1: B.z + B.length}] : [],
                 on ? [{x: B.x - w / 2, z: B.z + B.length / 2, hw: 0.05, hd: B.length / 2, rot: Math.PI / 2}, {x: B.x + w / 2, z: B.z + B.length / 2, hw: 0.05, hd: B.length / 2, rot: Math.PI / 2}]
                    : [{x: B.x, z: B.z, hw: 0.7, hd: 0.15, rot: 0}]);
  outCache.clear(); noRoom = false;
}
if (LAYOUT.bridge) {
  const B = LAYOUT.bridge, w = B.width, len = B.length, z1 = B.z + len, mid = B.z + len / 2;
  const steel = new THREE.MeshStandardMaterial({color: '#8c96a1', roughness: 0.5, metalness: 0.4});
  const box = (sx, sy, sz, x, y, z, mat = steel) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; bridge.add(m); return m; };
  box(w, 0.12, len, B.x, -0.06, mid, new THREE.MeshStandardMaterial({color: '#9aa3ad', roughness: 0.8}));            // deck
  box(w + 0.2, 0.5, len, B.x, -0.4, mid);                                                                         // girder
  for (const sx of [-1, 1]) {
    box(0.08, 0.08, len, B.x + sx * w / 2, 2.5, mid); box(0.08, 0.08, len, B.x + sx * w / 2, 0.02, mid);
    const pane = V.glassPane(len); pane.rotation.y = Math.PI / 2; pane.position.set(B.x + sx * w / 2, 1.25, mid); bridge.add(pane);
    const strip = V.mesh(new V.Vox().box(0, 0, 0, 0, 0, Math.round(len * 10) - 1, '#4dd0e1'), {pivot: [0.5, 0, 0]}, true);   // floor light
    strip.position.set(B.x + sx * (w / 2 - 0.12), 0.01, B.z); bridge.add(strip);
  }
  for (let k = 0; k <= len; k += 1) { box(w, 0.08, 0.08, B.x, 2.5, B.z + k); for (const sx of [-1, 1]) box(0.08, 2.5, 0.08, B.x + sx * w / 2, 1.25, B.z + k); }
  const roof = V.glassPane(w, len); roof.rotation.x = -Math.PI / 2; roof.position.set(B.x, 2.52, mid); bridge.add(roof);
  // the friend's building: same floor height as ours, lit windows facing us, an open entrance with a sign
  const fb = V.building(40, 30, 26, '#3a4660'); fb.position.set(B.x, -12, z1 + 6.5);      // its roof level with our ceiling
  fb.castShadow = false; bridge.add(fb);
  const lit = [], r = V.rnd(19);
  for (let y = -11; y < 2.6; y += 1.6) for (let x = -9; x <= 9; x += 1.5) if (Math.abs(x) > 1.6 || y < -0.5 || y > 2.6) if (r() < 0.62) lit.push([B.x + x, y, z1 - 0.02]);
  const wins = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({color: '#ffd9a0', toneMapped: false}), lit.length);
  lit.forEach(([x, y, z], i) => { const m = new THREE.Matrix4().makeRotationY(Math.PI); m.setPosition(x, y, z); wins.setMatrixAt(i, m); });
  bridge.add(wins);
  box(w, 2.4, 0.05, B.x, 1.2, z1 - 0.03, new THREE.MeshBasicMaterial({color: '#12202b'}));                         // doorway
  const frame = V.mesh(new V.Vox().box(0, 0, 0, Math.round(w * 10) + 1, 0, 0, '#80deea').box(0, 0, 0, 0, 24, 0, '#80deea')
    .box(Math.round(w * 10) + 1, 0, 0, Math.round(w * 10) + 1, 24, 0, '#80deea').box(0, 24, 0, Math.round(w * 10) + 1, 24, 0, '#80deea'), {pivot: [w * 5 + 1, 0, 0.5]}, true);
  frame.position.set(B.x, 0, z1 - 0.06); bridge.add(frame);
  friendSign = board(2.6, 0.5, 256); friendSign.mesh.position.set(B.x, 2.95, z1 - 0.08); friendSign.mesh.rotation.y = Math.PI; bridge.add(friendSign.mesh);
  const glow = new THREE.PointLight('#80deea', 2.5, 8, 1.8); glow.position.set(B.x, 2.2, B.z + 1); bridge.add(glow);
  bridge.visible = false; scene.add(bridge);
  scene.add(commonDoor);
}

// the places people use, from the layout
const vec = s => ({pos: new THREE.Vector3(s.x, s.y || 0, s.z), rot: s.rot, pose: s.pose || 'stand', tag: s.tag});
const SEATS = PLACED.seats.map(vec), STANDS = PLACED.spots.map(vec);
const seatOr = (tag, x, z) => SEATS.find(s => s.tag === tag) || {pos: new THREE.Vector3(x, 0, z), rot: 0, pose: 'stand', tag};
const LEAD_SEAT = seatOr('lead', 0, 0), LEAD2_SEAT = SEATS.find(s => s.tag === 'lead2') || LEAD_SEAT;
const LEAD3_SEAT = SEATS.find(s => s.tag === 'lead3') || LEAD2_SEAT;
const LEAD_SEATS = [LEAD_SEAT, LEAD2_SEAT, LEAD3_SEAT];                   // one table per live room, in the order they opened
const MEET = [...SEATS.filter(s => s.tag === 'meet'), ...SEATS.filter(s => s.tag === 'team')];
const COMMON = SEATS.filter(s => s.tag === 'common');
// the common room (the second coffee room): who may spend a break there, and whether friends share it (phase 4)
const commonRoom = () => {
  const c = DATA.config.common || {}, who = new Set(c.who || []);
  return {all: !!c.all, who, shared: !!c.shared, lets: name => !!c.all || who.has(name)};
};
const COFFEE = [...STANDS.filter(s => s.tag === 'coffee'), ...STANDS.filter(s => s.tag === 'play').map(s => ({...s, act: 'play'})),
                ...SEATS.filter(s => s.tag === 'coffee')];
if (!MEET.length) MEET.push(LEAD_SEAT);
if (!COFFEE.length) COFFEE.push(LEAD_SEAT);
const MACHINE = new THREE.Vector3(...(PLACED.fx.machine?.[0] || [0, 1.5, 0]));
const STEAM = [MACHINE, ...(PLACED.fx.steam || []).map(p => new THREE.Vector3(...p))];
const PAPER = new THREE.Vector3(...(PLACED.fx.paper?.[0] || [0, 1, 0]));

// LEDs of the server racks and of the espresso machines: tiny glowing voxels that blink (espresso: steady red)
const LED_AT = [...(PLACED.fx.leds || []).map(p => [p, false]), ...(PLACED.fx.led || []).map(p => [p, true])];
const ledGeo = new THREE.BoxGeometry(0.06, 0.04, 0.02), ledMat = new THREE.MeshBasicMaterial({toneMapped: false});
const leds = new THREE.InstancedMesh(ledGeo, ledMat, Math.max(1, LED_AT.length));
LED_AT.forEach(([[x, y, z]], i) => leds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)));
scene.add(leds);
const LED_COLORS = ['#00e676', '#40c4ff', '#ffab40', '#10301c', '#ff5252'].map(c => new THREE.Color(c).multiplyScalar(1.15));   // green, blue, amber, dark, the espresso red
const ledState = new Int8Array(LED_AT.length).fill(-1);

// ------------------------------------------------------------------ particles
const PMAX = 700, pGeo = new THREE.BoxGeometry(1, 1, 1), pMat = new THREE.MeshBasicMaterial({toneMapped: false});
const parts = new THREE.InstancedMesh(pGeo, pMat, PMAX); parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
parts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PMAX * 3), 3);
parts.frustumCulled = false;                    // its bounds would be taken from the empty pool (one point at the origin): particles vanished with the origin out of view
parts.count = 0;
scene.add(parts);
const P = [];
let ambient = 0;                                // how many live particles are only ambience (steam): they keep nothing awake
/** amb: ambience that never stops (steam of the machines and the cups); it does not count as something moving */
function emit(n, at, {color = '#ffffff', speed = 2, up = 2, life = 1.2, size = 0.07, gravity = -6, spread = 0.3, glow = 1, to = null, amb = false} = {}) {
  const c = new THREE.Color(), list = Array.isArray(color) ? color : [color];
  for (let i = 0; i < n && P.length < PMAX; i++) {
    c.set(list[i % list.length]).multiplyScalar(glow);
    P.push({p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)),
            v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed),
            life, age: 0, size: size * (0.6 + Math.random() * 0.8), gravity, c: c.clone(), to, spin: Math.random() * 6, amb});
    if (amb) ambient++;
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function stepParticles(dt) {
  if (!P.length && !parts.count) return;                                   // nothing alive and nothing left drawn
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i]; q.age += dt;
    if (q.age >= q.life) { if (q.amb) ambient--; P.splice(i, 1); continue; }
    if (q.to) q.p.lerp(q.to, Math.min(1, dt * 3.2)); else { q.v.y += q.gravity * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.02) { q.p.y = 0.02; q.v.multiplyScalar(0.4); q.v.y *= -0.3; } }
  }
  for (let i = 0; i < P.length; i++) {                                    // only the live ones: count draws no more than these
    const q = P[i], k = 1 - Math.max(0, (q.age - q.life * 0.7) / (q.life * 0.3));
    _s.setScalar(q.size * k); _q.setFromEuler(_e.set(q.spin * q.age, q.spin * q.age * 0.7, 0));
    _m.compose(q.p, _q, _s); parts.setMatrixAt(i, _m); parts.setColorAt(i, q.c);
  }
  parts.count = P.length;
  parts.instanceMatrix.needsUpdate = true; parts.instanceColor.needsUpdate = true;
}

// paper planes: who writes to whom
const planeGeo = new V.Vox().box(0, 0, 0, 2, 0, 0, '#ffffff').box(1, 0, -1, 1, 0, 1, '#f1f1f1').set(1, 1, 0, '#e9e9e9').geometry({pivot: [1.5, 0, 0], scale: 0.07, jitter: 0});
const planes = [];
function flyPlane(from, to) {
  const m = new THREE.Mesh(planeGeo, V.MAT.solid); m.castShadow = true; scene.add(m);
  planes.push({m, from: from.clone(), to: to.clone(), t: 0});
}
function stepPlanes(dt) {
  for (let i = planes.length - 1; i >= 0; i--) {
    const p = planes[i]; p.t += dt / 1.3;
    if (p.t >= 1) { scene.remove(p.m); planes.splice(i, 1); emit(8, p.to, {color: ['#ffffff', '#ffe082'], speed: 1.2, up: 1, life: 0.6, size: 0.05}); continue; }
    const pos = p.from.clone().lerp(p.to, p.t); pos.y += Math.sin(p.t * Math.PI) * 1.3;
    p.m.lookAt(pos); p.m.position.copy(pos); p.m.rotateY(Math.PI / 2);
  }
}

// ------------------------------------------------------------------ people
const SPOTS = new Map();                // name -> {g, scr, beacon, seat, stand, intern}
const people = new Map();               // name -> Person
const raycastables = [];
let racks = null;                                                          // the rack by each desk (office-rack.js), made once the clickable things exist
// every cubicle desk is furnished from the start, so an office with few agents still looks lived in; an agent takes
// the first free desk in the layout's order: its colour goes on the chair cushion and the mug, its screen comes alive
const chairFor = color => V.officeChair(color);                                   // finer than the pack's chair, cushion in the agent's colour
const DESKS = PLACED.desks.map((d, i) => buildDesk(d, i));
function buildDesk(d, i) {
  const g = new THREE.Group(); g.position.set(d.x, 0, d.z); g.rotation.y = d.rot; scene.add(g);
  const put = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
  put(V.workDesk(), 0, 0, 0);
  put(V.monitor(), 0, 0.7, -0.27); put(V.keyboard(), -0.05, 0.71, 0.12);
  put(V.packModel(i % 3 ? 'Misc/Office_Misc_Papers' : 'Misc/Office_Misc_Organizer', {scale: 0.03}), 0.45, 0.71, -0.1, 0.3);
  if (i % 2) put(V.deskLamp(), -0.62, 0.71, -0.2); else put(V.plant(i + 2, false), -0.62, 0.71, -0.22);
  if (i % 4 === 1) put(V.packModel('Misc/Electronics/Office_Misc_Phone', {scale: 0.03}), -0.35, 0.71, 0.05, -0.3);
  put(V.packModel('Misc/Trashcans/Office_Misc_Trashcan_Small_0' + (1 + i % 3), {scale: 0.04}), 0.66, 0, 0.12);
  for (const m of g.children.slice(2)) m.traverse(o => { o.castShadow = false; });   // the small things on and by the desk: their shadows are too small to see, and cost the shadow pass
  g.userData.kit = new Set(g.children);                                       // what never moves: baked into big meshes (office-merge.js); the chair, screen and beacon stay apart
  const chair = put(chairFor(null), 0, 0, 0.8, Math.PI);
  const scr = board(0.82, 0.5, 192); scr.mesh.position.set(0, 1.2, -0.21); g.add(scr.mesh);
  { const {g: c, canvas: k} = scr; c.fillStyle = '#0b0e15'; c.fillRect(0, 0, k.lw, k.lh); c.fillStyle = '#1b2230'; c.fillRect(k.lw / 2 - 6, k.lh / 2 - 6, 12, 12); scr.tex.needsUpdate = true; }
  const beacon = V.mesh(new V.Vox().box(0, 0, 0, 2, 2, 2, '#ff1744'), {pivot: [1.5, 0, 1.5], glow: 1.5}, true);
  beacon.position.set(0.55, 1.45, -0.3); beacon.visible = false; g.add(beacon);
  const beaconLight = new THREE.PointLight('#ff1744', 0, 3.5, 1.5); beaconLight.position.set(0.55, 1.7, -0.3); g.add(beaconLight);
  g.updateMatrixWorld(true);
  const W = (lx, lz, y = 0) => g.localToWorld(new THREE.Vector3(lx, y, lz));
  return {g, scr, beacon, beaconLight, chair, owner: null,
          seat: {pos: W(0, 0.78, -0.07), rot: d.rot + Math.PI, pose: 'sit', desk: i},
          stand: {pos: W(-0.55, 1.35), rot: d.rot, pose: 'stand', desk: i},
          intern: {pos: W(0.62, 1.1), rot: d.rot + Math.PI, pose: 'stand'}};
}

// more agents than desks: a block of four at the first free pod slot of the layout, else a single workstation where the
// floor is free, nearest to the other desks (neither is saved: furnish it to keep it)
function addPod() {
  for (const [x, z] of LAYOUT.podSlots || []) {
    let free = true;
    for (let dx = -2; dx <= 2 && free; dx += 0.25) for (let dz = -2; dz <= 2; dz += 0.25) if (FLOOR.blocked(x + dx, z + dz, 0.05)) { free = false; break; }
    if (!free) continue;
    const r = resolve({items: [{type: 'pod', x, z}], pods: LAYOUT.pods});
    placeItem({type: 'pod', x, z});
    FLOOR.addBoxes(r.boxes); outCache.clear(); climb = null;
    const fresh = r.desks.map(d => { const k = buildDesk(d, DESKS.length); DESKS.push(k); return k; });
    return fresh[0];
  }
  return null;
}
let noRoom = false;                                                        // the last search found no free floor: not searched again until the floor changes
function addWorkstation() {
  if (noRoom) return null;
  const cx =DESKS.reduce((a, d) => a + d.g.position.x, 0) / Math.max(1, DESKS.length), cz = DESKS.reduce((a, d) => a + d.g.position.z, 0) / Math.max(1, DESKS.length);
  const fits = (x, z) => { for (let dx = -1.0; dx <= 1.0; dx += 0.25) for (let dz = -0.6; dz <= 1.3; dz += 0.25) if (FLOOR.blocked(x + dx, z + dz, 0.05)) return false; return true; };
  let best = null;
  for (let x = -SIZE_X / 2 + 1.5; x < SIZE_X / 2 - 1.5; x += 0.5) for (let z = -SIZE_Z / 2 + 1; z < SIZE_Z / 2 - 1.5; z += 0.5)
    if (fits(x, z) && (!best || Math.hypot(x - cx, z - cz) < best.d)) best = {x, z, d: Math.hypot(x - cx, z - cz)};
  if (!best) { noRoom = true; return null; }
  const out = {boxes: [], desks: []};
  workstation(out, best.x, best.z, 0);
  FLOOR.addBoxes(out.boxes); outCache.clear();
  const d = buildDesk(out.desks[0], DESKS.length); DESKS.push(d); climb = null;
  return d;
}
function deskLayout(names) {
  for (const name of names) {
    if (SPOTS.has(name)) continue;
    // this room's agents take desks from the first, the other session's from the last: both offices agree
    const pick = D.per[name]?.neighbor ? [...DESKS].reverse().find(k => !k.owner) : DESKS.find(k => !k.owner);
    const d = pick || addPod() || addWorkstation();
    if (!d) continue;                                            // ponytail: no free floor left either
    const color = DATA.profile(name).color;
    d.owner = name; racks?.attach(name, d);
    d.g.remove(d.chair); d.chair = chairFor(color); d.chair.position.set(0, 0, 0.8); d.chair.rotation.y = Math.PI; d.g.add(d.chair);
    const mug = V.mug(color); mug.position.set(0.6, 0.71, 0.08); d.g.add(mug); d.mug = mug;
    SPOTS.set(name, d);
  }
  if (DESKS.every(k => k.owner)) addPod() || addWorkstation();      // always one free desk for whoever comes in next
}
/** an agent left the room: its desk is free again (plain chair, no mug, screen off), so it does not stay taken by nobody */
function releaseDesk(name) {
  const d = SPOTS.get(name);
  if (!d) return;
  SPOTS.delete(name); d.owner = null; d.scrKey = null; d.beacon.visible = false;
  if (d.mug) { d.g.remove(d.mug); d.mug = null; }
  d.g.remove(d.chair); d.chair = chairFor(null); d.chair.position.set(0, 0, 0.8); d.chair.rotation.y = Math.PI; d.g.add(d.chair);
  const {g, canvas: k} = d.scr; g.fillStyle = '#0b0e15'; g.fillRect(0, 0, k.lw, k.lh); g.fillStyle = '#1b2230'; g.fillRect(k.lw / 2 - 6, k.lh / 2 - 6, 12, 12); d.scr.tex.needsUpdate = true;
}

const _cupAt = new THREE.Vector3();
let frameT = 0;                                                            // the clock of the frame being drawn (seconds)
class Person {
  constructor(name, kind, spot, spawn, shirt = null, look = null) {
    const p = DATA.profile(name);
    const built = V.person({name, shirt: shirt || p.color, kind, scale: kind === 'intern' ? 0.62 : 1, look});
    this.lookKey = JSON.stringify(look);
    Object.assign(this, built, {name, kind, spot, pos: spot.pos.clone(), rot: spot.rot, path: [], act: 'idle', t: Math.random() * 10,
                                look: null, spawn: spawn ? 0 : 1, bubbleUntil: 0, pose: spot.pose, jumpY: 0, jumpV: 0, jumps: 0, flip: -1, vaulting: 0});
    this.root.position.copy(this.pos); this.root.rotation.y = this.rot;
    this.root.traverse(o => { o.userData.person = name; if (o.isMesh) raycastables.push(o); });
    scene.add(this.root);
    if (spawn) emit(60, this.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), {color: [p.color, '#ffffff', '#9be7ff'], to: this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), life: 0.9, size: 0.09});
  }
  /** Space: up, and once more in the air; false when seated or already used both */
  jump() {
    if (this.pose === 'sit' || this.pose === 'sofa' || this.jumps >= 2) return false;
    this.jumpV = this.jumps === 0 ? 5 : 4.4; this.jumps++;
    if (this.jumps === 2) this.flip = 0;
    return true;
  }
  goTo(spot) {
    if (this.spot === spot || (this.spot.pos.equals(spot.pos) && this.spot.rot === spot.rot)) { this.spot = spot; return; }
    // off the chair to the nearest free floor, around everything to the free floor nearest the spot, then onto it
    const start = this.path.length ? this.pos.clone() : nearestFree(this.pos);
    this.path = [start, ...(route(start, spot.pos) || []), spot.pos.clone()]; this.spot = spot; this.pose = 'walk';
  }
  head() { return this.root.localToWorld(new THREE.Vector3(0, this.pose === 'sit' || this.pose === 'sofa' ? 1.6 : 1.75, 0)); }
  update(dt, now) {
    this.t += dt;
    const P_ = this.parts, t = this.t;
    if (this.spawn < 1) { this.spawn = Math.min(1, this.spawn + dt * 1.3); }
    const s = this.spawn < 1 ? Math.max(0.01, 1 - Math.pow(1 - this.spawn, 3) + Math.sin(this.spawn * Math.PI) * 0.12) : 1;
    this.body.scale.setScalar(s * (this.kind === 'intern' ? 0.62 : 1));
    // walking
    if (this.path.length) {
      const target = this.path[0], d = target.clone().sub(this.pos); d.y = 0;
      const dist = d.length(), step = 1.9 * dt * (this.speed || 1);
      if (dist <= step) { this.pos.x = target.x; this.pos.z = target.z; this.path.shift(); if (!this.path.length) { this.pos.y = this.spot.pos.y; this.pose = this.spot.pose; } }
      else { this.pos.addScaledVector(d.normalize(), step); this.rot = angLerp(this.rot, Math.atan2(d.x, d.z), Math.min(1, dt * 10)); this.pos.y = lerp(this.pos.y, target.y || 0, Math.min(1, dt * 12)); }
    } else this.rot = angLerp(this.rot, this.faceRot ?? this.spot.rot, Math.min(1, dt * 6));
    this.root.position.copy(this.pos); this.root.rotation.y = this.rot;
    // pose targets
    const T = {legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, torso: 0, headX: 0, headY: 0, headZ: 0, bob: 0};
    this.sip = 0;
    const walking = this.pose === 'walk', seated = this.pose === 'sit' || this.pose === 'sofa';
    if (walking) { const w = Math.sin(t * 11); T.legL = w * 0.7; T.legR = -w * 0.7; T.armL = -w * 0.55; T.armR = w * 0.55; T.bob = Math.abs(Math.cos(t * 11)) * 0.05; }
    else {
      if (seated) { T.legL = T.legR = -1.5; }
      const a = this.act, osc = Math.sin(t * 16), osc2 = Math.sin(t * 16 + 1.7);
      if (a === 'code' || a === 'term' || a === 'post' || a === 'other') { const f = a === 'term' ? 1.4 : 1; T.armL = -1.15 + osc * 0.12 * f; T.armR = -1.15 + osc2 * 0.12 * f; T.headX = 0.12 + Math.sin(t * 2) * 0.03; }
      else if (a === 'read') { T.armL = T.armR = -0.75; T.headX = 0.3; T.headY = Math.sin(t * 0.8) * 0.15; }
      else if (a === 'web') { T.armR = -1.1 + Math.sin(t * 5) * 0.08; T.armL = -0.5; T.headY = Math.sin(t * 1.3) * 0.2; }
      else if (a === 'chat') { T.torso = -0.12; T.armR = -1.9; T.armL = -0.3; T.headX = 0.25; }
      else if (a === 'think') { T.armR = -2.45; T.armRz = 0.35; T.headZ = 0.12 + Math.sin(t * 1.2) * 0.04; T.headY = 0.15; }
      else if (a === 'agent') { T.armR = -1.4; T.armRz = -0.6 + Math.sin(t * 3) * 0.3; T.headY = -0.35; }
      else if (a === 'raise') { T.armR = -2.95; T.armRz = 0.25 + Math.sin(t * 9) * 0.35; T.headX = -0.15; T.bob = Math.abs(Math.sin(t * 4.5)) * 0.06; }
      else if (a === 'celebrate') { T.armL = T.armR = -2.9; T.armLz = -0.3; T.armRz = 0.3; T.bob = Math.abs(Math.sin(t * 7)) * 0.32; }
      else if (a === 'play') { T.armL = T.armR = -1.25 + Math.sin(t * 9) * 0.18; T.armLz = -0.2; T.armRz = 0.2; T.headX = 0.3; T.torso = 0.06; }
      else if (a === 'wave') { T.armR = -2.8; T.armRz = 0.35 + Math.sin(t * 11) * 0.4; T.headZ = 0.08; }
      else if (a === 'brew') {                                             // the user at the machine: a press of the button, then watching the cup fill
        const el = frameT - (me.brewStart || 0), tap = el > 0.3 && el < 0.9 ? Math.abs(Math.sin((el - 0.3) * 10)) : 0;
        T.armR = -1.3 + tap * 0.25; T.armL = el > 3 ? -1.45 : -0.35; T.armRz = 0.1; T.headX = 0.25;
      }
      else if (a === 'coffee') {
        const ph = (t % 9) / 9; this.sip = ph > 0.72 && ph < 0.94 ? Math.sin((ph - 0.72) / 0.22 * Math.PI) : 0;
        T.armR = lerp(-1.25, -2.4, this.sip); T.armRz = 0.35 * this.sip; T.headX = 0.05 - 0.3 * this.sip; T.armL = -0.15;
      }
      else if (a === 'speak') { T.armR = -1.5 + Math.sin(t * 6) * 0.25; T.armRz = 0.3; T.headX = -0.1; }
      else if (a === 'meet') { T.armL = T.armR = -0.9; T.headY = Math.sin(t * 0.9) * 0.25; }
      else { T.headX = Math.sin(t * 0.6) * 0.05; T.torso = seated ? -0.05 : 0; T.bob = Math.sin(t * 2) * 0.01; }
      if (this.look) {                                                     // turn the head toward someone
        const d = this.look.clone().sub(this.head()); const want = Math.atan2(d.x, d.z) - this.rot;
        T.headY = Math.max(-1, Math.min(1, ((want + Math.PI * 3) % (Math.PI * 2)) - Math.PI)); T.headX = -0.05;
      }
    }
    if (this.vaulting > 0) {                                               // climbing onto a desk: arms up on the edge, the body leans over it, the legs swing across
      const u = this.vaulting, sw = Math.sin(Math.PI * u);
      T.armL = T.armR = -2.9 + 1.4 * u; T.armLz = -0.12; T.armRz = 0.12; T.torso = 0.45 * sw; T.legL = -1.1 * sw; T.legR = -0.35 * sw; T.headX = 0.2 * sw;
    } else if (this.jumpY > 0.02) { T.armL = T.armR = -2.5; T.armLz = -0.1; T.armRz = 0.1; T.legL = -0.7; T.legR = 0.25; }       // in the air: arms up, legs tucked
    const k = Math.min(1, dt * 10);
    P_.legL.rotation.x = lerp(P_.legL.rotation.x, T.legL, k); P_.legR.rotation.x = lerp(P_.legR.rotation.x, T.legR, k);
    P_.armL.rotation.x = lerp(P_.armL.rotation.x, T.armL, k); P_.armR.rotation.x = lerp(P_.armR.rotation.x, T.armR, k);
    P_.armL.rotation.z = lerp(P_.armL.rotation.z, T.armLz, k); P_.armR.rotation.z = lerp(P_.armR.rotation.z, T.armRz, k);
    P_.torso.rotation.x = lerp(P_.torso.rotation.x, T.torso, k);
    P_.head.rotation.x = lerp(P_.head.rotation.x, T.headX, k); P_.head.rotation.y = lerp(P_.head.rotation.y, T.headY, k * 0.8);
    P_.head.rotation.z = lerp(P_.head.rotation.z, T.headZ, k);
    this.body.position.y = lerp(this.body.position.y, T.bob, Math.min(1, dt * 14));
    // a jump (Space); a second press in the air is a double jump with a somersault, level in first person where the camera follows the head
    if (!this.vaulting && (this.jumpV !== 0 || this.jumpY > 0)) {
      this.jumpV -= 14 * dt; this.jumpY = Math.max(0, this.jumpY + this.jumpV * dt);
      if (this.jumpY === 0) { this.jumpV = 0; this.jumps = 0; }
    }
    if (pov && this === boss && this.pos.y + this.jumpY > 1.1) { this.jumpY = Math.max(0, 1.1 - this.pos.y); if (this.jumpV > 0) this.jumpV = 0; }     // the camera never goes through the ceiling
    this.root.position.y = this.pos.y + this.jumpY + (this.lvl || 0);
    if (this.flip >= 0) {
      this.flip += dt / 0.62;
      const a = this.flip >= 1 || (pov && this === boss) ? 0 : this.flip * Math.PI * 2;
      this.body.rotation.x = a; this.body.position.y = 0.8 * (1 - Math.cos(a)); this.body.position.z = -0.8 * Math.sin(a);
      if (this.flip >= 1) { this.flip = -1; this.body.rotation.x = 0; this.body.position.z = 0; }
    }
    // the mug in the hand of whoever is on a coffee break (the user's own mug is set by tendMe), with a little steam
    if (this !== boss) {
      const hold = !walking && this.act === 'coffee';
      if (hold && !this.cup) { this.cup = V.mug('#f5f5f5'); this.cup.position.set(0, -0.5, 0.12); P_.armR.add(this.cup); }
      if (this.cup) this.cup.visible = hold;
    }
    if (this.cup?.visible) {
      this.cup.rotation.x = -P_.armR.rotation.x + 0.8 * this.sip;
      if (Math.random() < dt * 1.5) { this.cup.getWorldPosition(_cupAt); _cupAt.y += 0.12; emit(1, _cupAt, {color: '#ffffff', speed: 0.04, up: 0.3, life: 1, size: 0.03, gravity: 0.1, glow: 0.9, amb: true}); }
    }
  }
  dispose() { scene.remove(this.root); this.root.traverse(o => { const i = raycastables.indexOf(o); if (i >= 0) raycastables.splice(i, 1); }); ui.remove(this.name); this.release?.(); }     // the figure goes, its tag with it, and its geometries when nobody else shares them
}

/** p looks at a point for ms; a new glance replaces the one before (whose timer would otherwise cut the new one short) */
function glance(p, at, ms) { clearTimeout(p.lookT); p.look = at; p.lookT = setTimeout(() => { p.look = null; }, ms); }

// ------------------------------------------------------------------ data
const NEIGH ={rank: 0, room: null, rooms: [], profiles: {}};               // other sessions' rooms sharing this office
const DATA = {
  all: [], config: {participants: [], profiles: {}, lang: 'it', user_name: 'USER', self_names: []}, state: {agents: {}}, loaded: false,
  profile(name) {
    const p = (this.config.profiles || {})[name] || NEIGH.profiles[name] || {};
    let color = p.color;
    if (!color) { const pal = ['#1fa855', '#027eb5', '#d9730d', '#8e44ad', '#c0392b', '#16a085', '#b7950b', '#6c5ce7']; color = pal[V.hashName(name) % pal.length]; }
    return {color, emoji: p.emoji || name.slice(0, 1), role: p.role || '', model: [p.model, p.effort].filter(Boolean).join(' · ')};
  },
};
window.addEventListener('chatroom:data', e => {
  if (VISIT && visit) { localUser = e.detail.config?.user_name || localUser; DATA.config.lang = e.detail.config?.lang || 'it'; return deriveVisit(); }
  DATA.all = e.detail.all || []; DATA.config = e.detail.config || DATA.config; DATA.loaded = true; derive();
});
// on a visit the people are the friend's: names, colours and working or on a break, nothing else
let localUser = 'USER';
function deriveVisit() {
  const now = Date.now() / 1000, ppl = visit.people || [];
  DATA.config = {...DATA.config, participants: ppl.map(p => p.name), profiles: Object.fromEntries(ppl.map(p => [p.name, {emoji: p.emoji, color: p.color}])),
                 user_name: localUser, self_names: [], title: visit.title, heartbeat: 3600,
                 left: visit.plan && !ppl.some(p => p.name === visit.plan.author) ? [visit.plan.author] : [],      // the plan's author (the owner's lead) is not an agent of the board
                 common: {...DATA.config.common, all: !!visit.common?.all, who: visit.common?.who || []}};   // the owner's rule for the common room, not ours
  DATA.all = ppl.filter(p => p.state === 'break').map((p, i) => ({n: i + 1, from: p.name, kind: 'idle', text: '', ts: now}));
  // the owner's whiteboard: who waits for a permission, the plan and the votes, rebuilt as the chat lines that say them
  let n = 1e6; const plan = visit.plan;              // fixed numbers: a closing is news only when it first shows, not at every refresh
  if (plan) {
    DATA.all.push({n: n++, from: plan.author, text: `PLAN v${plan.v}`, ts: now});
    for (const p of ppl) if (p.vote) DATA.all.push({n: n++, from: p.name, text: `VOTE v${plan.v}: ${p.vote}`, ts: now});
    if (plan.closed) DATA.all.push({n: 2e6, from: plan.author, text: `CLOSED v${plan.v}`, ts: now});
  }
  DATA.state = {agents: Object.fromEntries(ppl.filter(p => p.waiting).map(p => [p.name, {id: '', tool: null, target: '', since: null, waiting: now, error_at: null, done_at: null, text_at: null, seen: now, ctx: 0, window: null, model: '', subagents: 0, recent: [], pulse: []}]))};
  DATA.live = visit.live || [];                       // the owner's last lines, for the TV wall (only if they share the room chat)
  DATA.loaded = true;
  derive();
}
if (VISIT && visit) setInterval(async () => {
  try { const r = await fetch(VISIT_URL, {cache: 'no-store'}); if (r.ok) { const j = await r.json(); visit = {...visit, people: j.people, plan: j.plan, live: j.live}; deriveVisit(); } } catch (e) {}
}, 4000);
let viewScope = window.chatroomScope ? window.chatroomScope() : 'self';
const nLastN = new Map();                                                    // per other room: the last message turned into a bubble
window.addEventListener('chatroom:scope', e => { viewScope = e.detail.scope; });
window.addEventListener('chatroom:neighbor', e => {
  const all = e.detail.all || [], cfg = e.detail.config || {}, title = (cfg.title || cfg.topic || '').slice(0, 16), top = all.length ? all[all.length - 1].n : 0;
  if (!nLastN.has(title)) { nLastN.set(title, top); return; }
  for (const m of all) if (m.n > nLastN.get(title)) {
    const who = people.get(`${m.from}@${title}`) || ((cfg.self_names || []).includes(m.from) ? otherLeads.get(title) : null);
    if (who) who.bubble = {text: m.text, until: Date.now() / 1000 + (m.kind ? 4.5 : 7), kind: m.kind === 'idle' ? 'idle' : m.kind ? 'status' : 'msg'};
  }
  nLastN.set(title, top);
});
let neighborsText = '', neighborsBusy = false;
async function pollNeighbors() {
  if (VISIT || neighborsBusy) return;
  neighborsBusy = true;
  try {
    const r = await fetch('neighbors.json', {cache: 'no-store'});
    if (!r.ok) return;
    const text = await r.text();
    if (text === neighborsText) return;                                   // the same rooms doing the same: nothing to work out again
    neighborsText = text;
    const n = JSON.parse(text), list = n.rooms || (n.room ? [{...n.room, rank: n.rank ? 0 : 1}] : []);
    NEIGH.rank = n.rank || 0;
    NEIGH.rooms = list.map(room => ({...room, agents: room.agents.map(a => ({...a, key: `${a.name}@${room.title.slice(0, 16)}`}))}));
    NEIGH.room = NEIGH.rooms[0] || null;
    NEIGH.profiles = Object.fromEntries(NEIGH.rooms.flatMap(room => room.agents.map(a => [a.key, {emoji: a.emoji, color: a.color, role: '🏢 ' + room.title}])));
    derive();
  } catch (e) {} finally { neighborsBusy = false; }
}
setInterval(pollNeighbors, 2500);
let stateBusy = false;                                                      // a slow answer is never asked for twice at once
async function pollState() {
  if ((VISIT && visit) || stateBusy) return;
  stateBusy = true;
  try { const r = await fetch('state.json?t=' + Date.now(), {cache: 'no-store'}); if (r.ok) { DATA.state = await r.json(); derive(); } } catch (e) {} finally { stateBusy = false; }
}
setInterval(pollState, 1000);
// the timeline of every agent (activity.py, through /timeline.json): a strip in each tag and a chart in the inspector
let TL = null;
async function pollTimeline() {
  if (VISIT || officeUnseen()) return;                                      // the server reads the transcripts for it: not while nobody looks
  try {
    const r = await fetch('timeline.json?span=1800', {cache: 'no-store'});
    if (!r.ok) return;
    TL = await r.json();
    for (const [name, a] of Object.entries(TL.agents || {})) ui.timeline(name, a);
    if (selected) inspect();
  } catch (e) {}
}
setTimeout(pollTimeline, 1500); setInterval(pollTimeline, 5000);

// the room's own commands, from the shell or from the MCP tools (activity.py names both chat:post, chat:wait...), are the chat
const cat = (tool, target = '') => !tool ? null : target === 'chat:post' ? 'post' : target.startsWith('chat:') ? 'chat'
  : /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool) ? 'code' : /^(Read|Grep|Glob|LS)$/.test(tool) ? 'read'
  : tool === 'Bash' || tool === 'PowerShell' ? 'term'
  : /^Web/.test(tool) ? 'web' : tool === 'Agent' || tool === 'Task' ? 'agent' : tool === 'SendMessage' ? 'msg' : 'other';
const pctOf = text => { const n = [...String(text).matchAll(PCT)].map(m => +m[1]).filter(x => x <= 100); return n.length ? Math.min(...n) : null; };
/** the percentage a message states: a JSON status's own pct (its evidence may hold other percentages), else the lowest in the text */
const pctOfMsg = m => Number.isFinite(m?.state?.pct) ? m.state.pct : pctOf(m.text);
const TAG_RE = new Map();                                                  // one RegExp per name, not one per message
const tagsName = (text, name) => {
  let re = TAG_RE.get(name);
  if (!re) { re = new RegExp(`(^|[^\\w@])@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i'); TAG_RE.set(name, re); }
  return re.test(text || '');
};

let D = {names: [], self: new Set(), lead: 'LEAD', user: 'USER', per: {}, plan: null, closed: null, waiting: new Set()};
let lastSeenN = 0, firstDerive = true, lastClosedN = 0;
// what only the chat and the config decide (names, plan, votes, each one's last messages, percentage, tags): worked out again only when one of
// them is a new object (the viewer makes new ones only when they changed), not at every state poll
let chatMemo = {all: null, config: null, base: null};
function chatBase(c, all) {
  const user = c.user_name || 'USER', selfNames = new Set([user, ...(c.user_aliases || []), ...(c.self_names || [])]);
  const byFrom = new Map();                                                // one pass over the chat instead of one per name
  for (const m of all) { let l = byFrom.get(m.from); if (!l) byFrom.set(m.from, l = []); l.push(m); }
  const leadNames = (c.self_names || []).filter(n => byFrom.has(n));
  const lead = leadNames[leadNames.length - 1] || (c.self_names || [])[0] || 'LEAD';
  const names = [...new Set([...(c.participants || []), ...[...byFrom.keys()].filter(n => !selfNames.has(n))])].filter(n => !(c.left || []).includes(n));
  let plan = null, closed = null;
  for (const m of all) {
    if (m.kind) continue;
    const p = firstHead(m.text).match(PLAN); if (p) plan = {v: +p[2], author: m.from, n: m.n};
    const cl = firstHead(m.text).match(CLOSED); if (cl && plan && (!cl[2] || +cl[2] >= plan.v)) closed = {v: cl[2] ? +cl[2] : plan.v, n: m.n, author: m.from, ts: m.ts || 0};
  }
  if (closed && plan && plan.n > closed.n) closed = null;
  const votes = {};
  if (plan) for (const m of all) { const v = voteOf(m.text); if (v && +v[2] === plan.v && m.n > plan.n) votes[m.from] = /no/i.test(v[3]) ? 'no' : 'yes'; }
  const per = {};
  for (const name of names) {
    const mine = byFrom.get(name) || [], last = mine[mine.length - 1];
    let pct = null; for (let i = mine.length - 1; i >= 0 && pct === null; i--) pct = pctOfMsg(mine[i]);
    let real = null; for (let i = mine.length - 1; i >= 0 && !real; i--) if (!mine[i].kind) real = mine[i];
    let tagged = false;                                                    // a message after its last one tags it, tags everyone or comes from the user
    for (let i = all.length - 1; i >= 0 && !tagged; i--) {
      const m = all[i];
      if (m.n <= (last?.n || 0)) break;
      if (m.from !== name && (tagsName(m.text, name) || EVERY.test(m.text) || m.from === user)) tagged = true;
    }
    const msgs = []; for (let i = mine.length - 1; i >= 0 && msgs.length < 3; i--) if (!mine[i].kind) msgs.push(mine[i]);
    per[name] = {pct, last, real, tagged, vote: votes[name] || null, msgs, idle: last?.kind === 'idle'};
  }
  return {user, selfNames, lead, names, plan, closed, per};
}
function derive() {
  const c = DATA.config, all = DATA.all, now = Date.now() / 1000, hb = c.heartbeat || 120;
  if (chatMemo.all !== all || chatMemo.config !== c) chatMemo = {all, config: c, base: chatBase(c, all)};
  const {user, selfNames, lead, plan, closed} = chatMemo.base, names = [...chatMemo.base.names];
  const per = {};
  for (const name of chatMemo.base.names) {                                // the clock and the tools: every time
    const b = chatMemo.base.per[name], silence = b.last ? now - (b.last.ts || now) : null;
    per[name] = {...b, late: !b.idle && silence !== null && silence > hb, silence, a: (DATA.state.agents || {})[name] || null};
  }
  // the other session's agents: names, colours, working or on a break, the tool they run; their chat stays theirs
  for (const room of NEIGH.rooms) for (const a of room.agents) {
    const key = a.key;
    names.push(key);
    per[key] = {pct: a.pct ?? null, idle: !!a.idle, late: false, silence: null, last: null, real: null, tagged: false, vote: null, neighbor: true, room: room.title,
                a: a.tool || a.waiting ? {tool: a.tool, waiting: !!a.waiting, since: now, target: ''} : null, msgs: []};
  }
  const waiting = new Set(names.filter(n => per[n].a?.waiting));
  D = {names, self: selfNames, lead, user, per, plan, closed, waiting, all, hb, now};
  sync(); events();
}

// ------------------------------------------------------------------ cast: build and place the figures
let boss = null, assistant = null;
const otherLeads = new Map();                                             // the lead of each other live room, by its title (16 characters)
const OWNER_SEAT = seatOr('boss', 0, 0);
let fromBridge = false;                                                    // back from a visit: you come in from the bridge
try { fromBridge = sessionStorage.getItem('chatroom.fromBridge') === '1'; sessionStorage.removeItem('chatroom.fromBridge'); } catch (e) {}
const BOSS_SEAT = visit ? (LAYOUT.bridge && STANDS.find(s => s.tag === 'bridgeIn')) || STANDS.find(s => s.tag === 'entrance') || {pos: new THREE.Vector3(0, 0, SIZE_Z / 2 - 1), rot: Math.PI, pose: 'stand'} : (fromBridge && STANDS.find(s => s.tag === 'bridgeIn')) || OWNER_SEAT;
let hostFigure = null;                                                      // on a visit: the friend in their own chair
const interns = new Map();

// ------------------------------------------------------------------ the user's own figure: walk, sit, coffee
// Only the user's figure takes orders (the agents keep doing what their work says): W/A/S/D and E in first person,
// otherwise a click on the floor, on a free chair or on the coffee machine. Walking goes through the layout's floor
// plan (office-layout.js): what blocks, and A* around it.
const v3 = p => new THREE.Vector3(p.x, 0, p.z);
const blocked = (x, z) => level === 'arena' ? arena.world.blocked(x, z) : FLOOR.blocked(x, z);
const onBridge = p => { const B = LAYOUT.bridge; return !!(B && bridgeOpen && Math.abs(p.x - B.x) < B.width / 2 && p.z > B.z && p.z < B.z + B.length + 0.5); };
const mouth = () => new THREE.Vector3(LAYOUT.bridge.x, 0, LAYOUT.bridge.z - 0.5);
function route(from, to) {
  const a = onBridge(from), b = onBridge(to);
  if (a && b) return [v3(to)];
  if (b) { const pts = FLOOR.route(from, mouth()); return pts ? [...pts.map(v3), v3(to)] : null; }
  if (a) { const pts = FLOOR.route(mouth(), to); return pts ? [mouth(), ...pts.map(v3)] : null; }
  return FLOOR.route(from, to)?.map(v3) || null;
}
const nearestFree = p => { const q = FLOOR.nearest(p); return q ? v3(q) : p.clone(); };
const BREW = STANDS.find(s => s.tag === 'brew') || {pos: MACHINE.clone().setY(0), rot: 0, pose: 'stand'};
const USER_SEATS = SEATS.filter(s => s.tag !== 'lead');
const me = {act: 'idle', yaw: 0, pitch: -0.08, then: null, rising: false, cup: null, cupUntil: 0, brewUntil: 0};
const keys = new Set();
const sitSpots = () => [...USER_SEATS, ...DESKS.filter(d => !d.owner).map(d => d.seat)]
  .filter(s => ![...people.values(), ...remote.values()].some(p => p.spot === s));
let running = pref('run', false), shiftHeld = false;                       // x2: the button keeps it, Shift while held
const outCache = new Map();
const outOf = s => { if (!outCache.has(s)) outCache.set(s, nearestFree(s.pos)); return outCache.get(s).clone(); };
const seated = p => !p.path.length && (p.pose === 'sit' || p.pose === 'sofa');
function walkTo(goal, spot, then = null) {
  if (boss.pos.y > 0.01) { boss.jumpY += boss.pos.y; boss.pos.y = 0; }                  // from the top of a desk: down, then walk
  const from = seated(boss) ? outOf(boss.spot) : blocked(boss.pos.x, boss.pos.z) ? nearestFree(boss.pos) : boss.pos;
  const pts = route(from, goal);
  if (!pts) return;
  if (seated(boss)) pts.unshift(from.clone());
  if (spot.rot === null) {                                                     // a spot on the floor: face the way you walked
    if (!pts.length) return;
    const b = pts[pts.length - 1], a = pts.length > 1 ? pts[pts.length - 2] : boss.pos;
    spot.pos = b.clone(); spot.rot = Math.atan2(b.x - a.x, b.z - a.z);
  } else pts.push(spot.pos.clone());
  boss.path = pts; boss.spot = spot; boss.pose = 'walk'; boss.faceRot = null;
  me.then = then; me.rising = false;
  if (me.act === 'brew') me.act = 'idle';
}
function standUp() {
  const out = outOf(boss.spot);
  boss.path = [out.clone()]; boss.spot = {pos: out.clone(), rot: boss.rot, pose: 'stand'}; boss.pose = 'walk';
  me.rising = true; me.then = null;
}
function brew() { me.act = 'brew'; me.brewStart = frameT; me.brewUntil = me.brewStart + 3.8; }
const brewMug = V.mug('#f5f5f5'), _front = new THREE.Vector3(BREW.pos.x - MACHINE.x, 0, BREW.pos.z - MACHINE.z).normalize(), SPOUT = new THREE.Vector3();
SPOUT.set(MACHINE.x + _front.x * 0.2, MACHINE.y - 0.25, MACHINE.z + _front.z * 0.2);
brewMug.position.set(SPOUT.x, MACHINE.y - 0.55, SPOUT.z); brewMug.visible = false; scene.add(brewMug);
/** what E would do now, the nearest thing first: stand up, talk to an agent in front of you, make a coffee, sit on a
 *  free seat, look at the TV or the whiteboard you face */
const _fwd = new THREE.Vector3(), _to = new THREE.Vector3();
function nearby() {
  if (!boss || boss.path.length) return null;
  if (level === 'arena') return arena.nearExit(boss.pos) < 1.6 ? {kind: 'arenaExit', k: 0} : null;
  if (seated(boss)) return loungeTv.near(boss.pos) < 3 ? {kind: 'zap'} : {kind: atMyDesk() ? 'desk' : 'stand'};
  const d = p => Math.hypot(p.x - boss.pos.x, p.z - boss.pos.z);
  _fwd.set(Math.sin(boss.rot + me.yaw), 0, Math.cos(boss.rot + me.yaw));
  const facing = p => _to.set(p.x - boss.pos.x, 0, p.z - boss.pos.z).normalize().dot(_fwd);
  const opts = [];
  for (const [name, p] of people) if (d(p.pos) < 1.9 && facing(p.pos) > 0.3) opts.push({kind: 'talk', name, k: d(p.pos)});
  if (assistant && d(assistant.pos) < 1.9 && facing(assistant.pos) > 0.3) opts.push({kind: 'talk', name: D.lead, k: d(assistant.pos)});
  if (d(BREW.pos) < 1.3) opts.push({kind: 'coffee', k: d(BREW.pos)});
  for (const s of sitSpots()) { const k = Math.min(d(s.pos), d(outOf(s))); if (k < 1.3) opts.push({kind: 'sit', seat: s, k: k + 0.2}); }
  if (loungeTv.near(boss.pos) < 1.4) opts.push({kind: 'zap', k: loungeTv.near(boss.pos)});
  if (radio && radio.near(boss.pos) < 1.3) opts.push({kind: 'radio', k: radio.near(boss.pos)});
  if (lofi && lofi.near(boss.pos) < 1.2) opts.push({kind: 'lofi', k: lofi.near(boss.pos)});
  if (arcade && arcade.near(boss.pos) < 1.1) opts.push({kind: 'arcade', k: arcade.near(boss.pos) - 0.4});
  if (lift && lift.near(boss.pos) < 1.2) opts.push({kind: 'lift', k: lift.near(boss.pos) - 0.3});
  if (github?.enabled() && github.near(boss.pos) < 2.6 && facing(github.mesh.position) > 0.6) opts.push({kind: 'github', k: github.near(boss.pos) + 0.5});
  for (const g of GAME_TABLES) { const k = g.near(boss.pos); if (k < 0.8) opts.push({kind: 'game', game: g.type, k: k + 0.3}); }
  { const p = scoreboard.mesh.position; if (d(p) < 3.2 && facing(p) > 0.6) opts.push({kind: 'scores', k: d(p) + 0.5}); }
  for (const b of [tv, wb]) { const p = b.mesh.position; if (d(p) < 3.5 && facing(p) > 0.6) opts.push({kind: b === tv ? 'tv' : 'board', b, k: d(p) + 0.5}); }
  return opts.sort((a, b) => a.k - b.k)[0] || null;
}
function interact() {
  const t = nearby();
  if (!t) return;
  if (t.kind === 'arenaExit') return paintball.toggle(false);
  if (t.kind === 'lift') return liftMenu();
  if (t.kind === 'github') { document.exitPointerLock?.(); return github.open(); }
  if (t.kind === 'stand' || t.kind === 'desk') return standUp();
  if (t.kind === 'coffee') return walkTo(BREW.pos, BREW, brew);
  if (t.kind === 'sit') return walkTo(outOf(t.seat), t.seat);
  if (t.kind === 'talk') return talkTo(t.name);
  if (t.kind === 'zap' || t.kind === 'game' || t.kind === 'scores') document.exitPointerLock?.();
  if (t.kind === 'scores') return ui.scores();        // a menu needs the mouse back
  if (t.kind === 'zap') return loungeTv.menu();
  if (t.kind === 'radio') return radio.menu();
  if (t.kind === 'arcade') return arcade.open();
  if (t.kind === 'lofi') return lofi.toggle();
  if (t.kind === 'game') return openGame(t.game);
  watching = watching === t.b ? null : t.b;                                    // TV or whiteboard: look closely, E again to stop
}
let watching = null;
/** the agent turns to you and the chat opens with its name tagged */
function talkTo(name) {
  const p = people.get(name) || (name === D.lead ? assistant : null);
  if (p) { glance(p, boss.head(), 4000); }
  if (mode === 'office') { mode = 'split'; setPref('mode', mode); applyMode(); }
  window.chatroom?.tag(name);
}
/** Q: a wave; whoever is near turns to look */
function wave() {
  me.waveUntil = performance.now() / 1000 + 2.2;
  for (const p of [...people.values(), assistant]) if (p && p.pos.distanceTo(boss.pos) < 7) { glance(p, boss.head(), 2500); }
}
/** from the inspector: walk up to an agent and stop a step in front of it */
function walkOver(name) {
  const p = people.get(name) || (name === D.lead ? assistant : null);
  if (!p || !boss) return;
  const goal = nearestFree(p.pos.clone().add(boss.pos.clone().sub(p.pos).setY(0).setLength(1.1)));
  walkTo(goal, {pos: goal, rot: Math.atan2(p.pos.x - goal.x, p.pos.z - goal.z), pose: 'stand'}, () => { glance(p, boss.head(), 3000); });
}
/** a click outside first person: the coffee machine, a free seat, or that spot on the floor */
function goToPoint(p) {
  if (!boss) return;
  if (Math.hypot(p.x - MACHINE.x, p.z - MACHINE.z) < 0.9) return walkTo(BREW.pos, BREW, brew);
  const dist = s => Math.hypot(p.x - s.pos.x, p.z - s.pos.z), reach = p.y > 0.15 ? 0.7 : 0.5;       // the chair itself (its back, its arms) is wider than the floor round the seat
  const seat = sitSpots().filter(s => dist(s) < reach).sort((a, b) => dist(a) - dist(b))[0];
  if (seat) return walkTo(outOf(seat), seat);
  const goal = new THREE.Vector3(p.x, 0, p.z);
  walkTo(goal, {pos: goal, rot: null, pose: 'stand'});
}
let leaving = false, doorToast = 0;
/** W/S walk, A/D turn; looking around with the mouse turns the body once you walk */
let climb = null, small = [], floorN = null;
/** the pieces of furniture you can stand on (desks, tables, sofas, counters: 0.3 to 1.2 m high, at least 0.35 m2), the small things on them
 *  (a monitor, a lamp, a plant: they stop you at any height they reach), and the floor plan of what can NOT be climbed (plants, cabinets, walls) */
function climbList() {
  if (climb) return climb;
  climb = []; small = [];
  const box = new THREE.Box3(), add = o => {
    box.setFromObject(o);
    const w = box.max.x - box.min.x, d = box.max.z - box.min.z, top = box.max.y, e = {x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, y0: box.min.y, top};
    if (top >= 0.3 && top <= 1.2 && w * d >= 0.35 && w < 8 && d < 8) climb.push(e);
    else if (top > 0.15 && w < 3 && d < 3) small.push(e);
  };
  for (const m of ITEM_MESHES) if (!m.isGroup) add(m);
  for (const d of DESKS) for (const o of d.g.userData.kit || []) add(o);
  floorN = floorPlan(LAYOUT, {...PLACED, boxes: PLACED.boxes.filter(k => !climb.some(c => k.x > c.x0 - 0.15 && k.x < c.x1 + 0.15 && k.z > c.z0 - 0.15 && k.z < c.z1 + 0.15))});
  return climb;
}
/** a small thing at (x, z) that a figure whose feet are at `feet` (head 1.7 m higher) would walk into */
const fN = () => level === 'arena' ? arena.world.floorN : floorN;                 // what can not be climbed, on this level
const smallBlocks = (x, z, feet) => { if (level === 'arena') return false; climbList(); return small.some(e => x > e.x0 - 0.12 && x < e.x1 + 0.12 && z > e.z0 - 0.12 && z < e.z1 + 0.12 && e.top > feet + 0.05 && e.y0 < feet + 1.7); };
/** the top of the piece of furniture under (x, z), grown by m metres, that a figure at height alt is above (null: none) */
function climbTop(x, z, alt, m = 0) {
  if (level === 'arena') return arena.world.climbTop(x, z, alt, m);
  let best = null;
  for (const b of climbList()) if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m && alt >= b.top - 0.05 && (best === null || b.top > best)) best = b.top;
  return best;
}
/** your figure stands on the floor or on what it is above: a step of up to 45 cm is climbed smoothly, a jump lands on the top it is above,
 *  walking off an edge it falls */
function settleBoss(dt = 0.02) {
  if (!boss || vault || boss.pose === 'sit' || boss.pose === 'sofa') return;
  const air = boss.jumpY > 0.02, alt = boss.pos.y + boss.jumpY, gh = climbTop(boss.pos.x, boss.pos.z, alt + (air ? 0 : 0.45)) ?? 0;
  if (gh > boss.pos.y) {
    if (air) { boss.jumpY = Math.max(0, alt - gh); boss.pos.y = gh; }
    else boss.pos.y = Math.min(gh, boss.pos.y + Math.max(0.015, (gh - boss.pos.y) * Math.min(1, dt * 14)));
  } else if (gh < boss.pos.y) { boss.jumpY = Math.max(0, alt - gh); boss.pos.y = gh; }
}
let vault = null;
/** Space in front of a desk, a table, a sofa or a counter (up to about a metre above your feet): you climb onto it with your hands on the edge, smoothly */
function tryVault() {
  if (!boss || !pov || vault || boss.pose === 'sit' || boss.pose === 'sofa' || boss.path.length) return false;
  const alt = boss.pos.y + boss.jumpY, dx = Math.sin(boss.rot), dz = Math.cos(boss.rot), at = d => climbTop(boss.pos.x + dx * d, boss.pos.z + dz * d, 99);
  let enter = null;
  for (let d = 0.25; d <= 0.95 && enter === null; d += 0.1) { const top = at(d); if (top !== null && top > alt + 0.12 && top - alt <= 1.15 && top <= 1.1) enter = d; }
  if (enter === null) return false;
  const target = at(enter);
  let land = null;                                                                          // a spot on that top, a little way in and clear of what stands on it
  for (const off of [0, 0.25, -0.25, 0.5, -0.5]) for (let d = enter + 0.15; d <= enter + 0.55 && !land; d += 0.1) {
    const x = boss.pos.x + dx * d + dz * off, z = boss.pos.z + dz * d - dx * off, top = climbTop(x, z, 99);
    if (top !== null && Math.abs(top - target) < 0.05 && !fN().blocked(x, z, 0.1) && !smallBlocks(x, z, top)) land = {x, z, top};
  }
  if (!land) return false;
  vault = {t: 0, dur: 0.62, x0: boss.pos.x, z0: boss.pos.z, y0: alt, x1: land.x, z1: land.z, top: land.top};
  boss.jumpV = 0; boss.jumpY = 0; boss.pos.y = alt; boss.jumps = 0;
  return true;
}
function stepVault(dt) {
  vault.t += dt;
  const u = Math.min(1, vault.t / vault.dur), e = u * u * (3 - 2 * u), rise = 1 - Math.pow(1 - Math.min(1, u * 1.35), 3);
  boss.pos.x = vault.x0 + (vault.x1 - vault.x0) * e; boss.pos.z = vault.z0 + (vault.z1 - vault.z0) * e;
  boss.pos.y = vault.y0 + (vault.top - vault.y0) * rise + 0.08 * Math.sin(Math.PI * u);
  boss.jumpY = 0; boss.jumpV = 0; boss.vaulting = u || 0.001; boss.pose = 'stand';
  if (u >= 1) { boss.pos.y = vault.top; boss.vaulting = 0; boss.spot = {pos: boss.pos.clone(), rot: boss.rot, pose: 'stand'}; vault = null; }
}
function drive(dt) {
  if (vault) return stepVault(dt);
  settleBoss(dt);
  const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), side = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);        // W/S forward and back, A/D a step to the left or right
  if (!pov || !boss || (!f && !side)) { if (boss && boss.pose === 'walk' && !boss.path.length) boss.pose = 'stand'; return; }
  if (seated(boss)) return standUp();
  if (boss.path.length) { if (me.rising) return; boss.path = []; me.then = null; }
  if (me.act === 'brew') me.act = 'idle';
  watching = null;
  boss.rot += me.yaw; me.yaw = 0; boss.faceRot = null; povRot = boss.rot;                // the body follows the view
  // forward is (sin, cos) of the heading, the right hand is (-cos, sin); diagonals are no faster than straight
  let mx = f * Math.sin(boss.rot) - side * Math.cos(boss.rot), mz = f * Math.cos(boss.rot) + side * Math.sin(boss.rot);
  const len = Math.hypot(mx, mz) || 1, step = dt * (f > 0 ? 2.0 : f < 0 ? 1.2 : 1.6) * (boss.speed || 1), nx = boss.pos.x + mx / len * step, nz = boss.pos.z + mz / len * step;
  const lv = boss.pos.y + (boss.lvl || 0), others = [...people.values(), ...remote.values(), assistant, hostFigure].filter(p => p && p !== boss && Math.abs(p.pos.y + (p.lvl || 0) - lv) < 2.5);     // people of the other level do not stand in your way
  const bump = (x, z) => others.some(p => {                                   // people are solid: you cannot walk into them
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    return d < 0.55 && d < Math.hypot(p.pos.x - boss.pos.x, p.pos.z - boss.pos.z);
  });
  climbList();
  const feet = boss.pos.y + boss.jumpY, alt = feet + (boss.jumpY > 0.02 ? 0 : 0.45), up = feet > 0.2;
  const free = (x, z) => !fN().blocked(x, z) && (!blocked(x, z) || climbTop(x, z, alt, 0.3) !== null) && !(up && smallBlocks(x, z, feet));      // above a piece of furniture (or a low step) you may walk over it, never through a plant or a cabinet
  if (free(nx, boss.pos.z) && !bump(nx, boss.pos.z)) boss.pos.x = nx;
  if (free(boss.pos.x, nz) && !bump(boss.pos.x, nz)) boss.pos.z = nz;
  boss.pose = 'walk'; boss.faceRot = null;
  boss.spot = {pos: boss.pos.clone(), rot: boss.rot, pose: 'stand'};
}
/** the far end of the bridge: into the friend's office or back home; as host, into a guest's (choose if several) */
function leaveBy(search) { leaving = true; try { sessionStorage.setItem('chatroom.fromBridge', '1'); } catch (e) {} location.search = search; }
function checkDoor() {
  const B = LAYOUT.bridge;
  if (!B || !bridgeOpen || leaving || boss.pos.z < B.z + B.length - 1.0) return;
  if (visit) return leaveBy('');
  if (commonState?.bridge?.joined) return leaveBy('?visit');
  const guests = commonState?.share?.sharing ? (commonState.share.guests || []).map(g => g.name) : [];
  if (guests.length === 1) return leaveBy('?visit=' + encodeURIComponent(guests[0]));
  if (performance.now() - doorToast < 4000) return;
  doorToast = performance.now();
  if (guests.length > 1) ui.palette(guests.map(n => ({icon: '🚶', name: n, label: ui.t().visit(n)})), c => { ui.palette(null); leaveBy('?visit=' + encodeURIComponent(c.name)); });
  else ui.placeName(ui.t().friendDoor);
}
/** after the figure moved: arrivals, the coffee being made, the cup in hand */
function tendMe(dt, t) {
  if (me.rising && !boss.path.length) me.rising = false;
  if (me.then && !boss.path.length) { const fn = me.then; me.then = null; fn(); }
  if (me.act === 'brew') {
    const el = t - me.brewStart;
    if (boss.spot !== BREW || boss.path.length) { me.act = 'idle'; brewMug.visible = false; }
    else if (t > me.brewUntil) { me.act = 'coffee'; me.cupUntil = t + 120; me.cup.visible = true; }
    else {
      brewMug.visible = el > 0.9 && el < 3.2;                                   // the cup goes under the spout after the button, and into the hand at the end
      if (el > 1.2 && el < 3.2 && Math.random() < dt * 40) emit(1, SPOUT, {color: '#4a2a12', speed: 0.01, up: -0.05, life: 0.3, size: 0.025, gravity: -3, glow: 0.2});
      if (el > 1.6 && Math.random() < dt * 6) emit(1, MACHINE, {color: '#ffffff', speed: 0.15, up: 0.7, life: 1.4, size: 0.06, gravity: 0.25, glow: 0.9});
      if (el > 3.2) me.cup.visible = true;
    }
  }
  if (me.cup.visible && t > me.cupUntil) { me.cup.visible = false; if (me.act === 'coffee') me.act = 'idle'; }
  me.cup.rotation.x = -boss.parts.armR.rotation.x + 0.8 * (boss.sip || 0);     // the cup stays upright in the hand, and tips at a sip
}
// a break place for an idle agent, the same for everyone who looks at this office (you, a friend visiting): chosen by a hash
// of the agent's name and of the clock, not at random. It keeps the place 40 to 130 s, each agent on its own beat, then
// takes another; never the user's seat, never one another agent is heading to
const hash32 = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
// ---- movements with a meaning: an agent that posts a PLAN goes to the whiteboard to write it up; one that tags a colleague walks to the colleague's desk to say it
// (a review stays longer, looking at the screen); at most two walk about at once. Whoever is waiting for a permission, or in a meeting, keeps doing that.
const VISIT_MAX = 2, REVIEW = /\b(review|revisione|revisiono|rivedi|rivedo|rivediamo)\b/i;
/** a free place to stand in front of the whiteboard, facing it (null if everything there is in the way) */
function boardSpot() {
  const at = wb.mesh.position, ry = wb.mesh.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry);
  for (const d of [0.9, 1.2, 1.6, 2.0]) for (const side of [0, 0.6, -0.6]) {
    const x = at.x + fx * d - fz * side, z = at.z + fz * d + fx * side;
    if (!blocked(x, z)) return {pos: new THREE.Vector3(x, 0, z), rot: ry + Math.PI, pose: 'stand'};
  }
  return null;
}
/** make agent `p` walk to `spot` for `secs` seconds, doing `act` and looking at the Person `look` */
function sendVisit(p, spot, secs, act, look = null) {
  if (!p || !spot || (p.visit && p.visit.until > D.now) || [...people.values()].filter(q => q.visit && q.visit.until > D.now).length >= VISIT_MAX) return;
  p.visit = {spot, until: D.now + secs, act, look};
}
function breakSpot(p, desk, list, now) {
  if (p.breakAt && now < p.breakUntil && p.breakAt !== boss?.spot) return p.breakAt;
  const span = 40 + hash32(p.name + '/span') % 90, wall = Date.now() / 1000 + hash32(p.name + '/phase') % span, slot = Math.floor(wall / span);
  const taken = new Set([...people.values()].filter(q => q !== p).map(q => q.breakAt));
  const free = [desk.seat, ...list.filter(s => s !== boss?.spot)];
  let i = hash32(p.name + '/' + slot) % free.length;
  for (let k = 0; k < free.length && taken.has(free[i]); k++) i = (i + 1) % free.length;
  p.breakAt = free[i];
  p.breakUntil = now + (slot + 1) * span - wall;
  return p.breakAt;
}
function sync() {
  deskLayout(D.names);
  if (!boss) {
    boss = new Person(D.user, 'boss', BOSS_SEAT, false, null, myLook);
    me.cup = V.mug('#f5f5f5'); me.cup.position.set(0, -0.5, 0.12); me.cup.visible = false; boss.parts.armR.add(me.cup);
  }
  const mySeat = LEAD_SEATS[NEIGH.rank] || LEAD_SEAT;
  if (!assistant) { assistant = new Person(D.lead, 'lead', mySeat, false); } else assistant.goTo(mySeat);
  const live = new Set();
  for (const room of NEIGH.rooms) {                                          // each other room's lead at the table of its turn
    const title = room.title.slice(0, 16), seat = LEAD_SEATS[room.rank] || LEAD3_SEAT;
    live.add(title);
    if (!otherLeads.has(title)) { const p = new Person(room.lead + '@' + title, 'lead', seat, true); p.room = room; otherLeads.set(title, p); }
    else { otherLeads.get(title).room = room; otherLeads.get(title).goTo(seat); }
  }
  for (const [title, p] of otherLeads) if (!live.has(title)) { p.dispose(); otherLeads.delete(title); }
  if (visit && !hostFigure) { hostFigure = new Person(visit.host, 'boss', OWNER_SEAT, false); hostFigure.act = 'code'; hostFigure.home = OWNER_SEAT; }
  for (const name of D.names) if (!people.has(name) && SPOTS.has(name)) people.set(name, new Person(name, 'agent', SPOTS.get(name).seat, !firstDerive));
  firstDerive = false;
  const now = D.now;
  let meetIdx = 0;
  const free = list => list.filter(s => s !== boss.spot);                 // never the seat the user is in
  const MEET_ = free(MEET), COFFEE_ = free(COFFEE), COMMON_ = free(COMMON), room = commonRoom();
  for (const name of D.names) {
    const p = people.get(name), d = D.per[name], a = d.a, spot = SPOTS.get(name);
    if (!p || !spot) continue;
    const tool = a?.tool && now - (a.since || now) < 900 ? a.tool : null, c = cat(tool, a?.target || '');
    const posted = d.real && now - (d.real.ts || 0) < 6;
    let want = spot.seat, act;
    if (D.closed && !d.neighbor && now - (D.closed.ts || 0) < 90) { want = MEET_[meetIdx++ % MEET_.length]; act = now - (D.closed.ts || 0) < 8 ? 'celebrate' : 'meet'; }
    else if (a?.waiting) { want = spot.stand; act = 'raise'; }
    else if (p.visit && now < p.visit.until) { want = p.visit.spot; act = p.visit.act; if (p.visit.look) p.look = p.visit.look.head(); }          // a visit: to the whiteboard or to a colleague's desk
    else if (d.idle && (!c || c === 'chat')) {                              // a break, somewhere chosen at random
      want = breakSpot(p, spot, room.lets(name) ? COMMON_ : COFFEE_, now);
      act = want === spot.seat ? 'idle' : want.act || 'coffee';
    }
    else if (D.plan && !D.closed && d.vote === 'yes' && (!c || c === 'chat')) { want = MEET_[meetIdx++ % MEET_.length]; act = 'meet'; }
    else act = posted ? 'speak' : c || (a?.text_at && now - a.text_at < 15 ? 'think' : d.silence !== null && d.silence < 25 ? 'think' : 'idle');
    if (p.visit && now >= p.visit.until) { if (p.visit.look) p.look = null; p.visit = null; }
    if (!d.idle) p.breakAt = null;
    racks?.set(name, a?.procs, now);
    p.goTo(want); p.act = act;
    p.faceRot = want === spot.seat && posted ? 0.0 : null;               // turn the chair round to talk
    // a subagent of this agent: an intern beside the desk
    const subs = a?.subagents || 0;
    if (subs > 0 && !interns.has(name)) { const it = new Person(name + '·sub', 'intern', spot.intern, true, DATA.profile(name).color); it.act = 'code'; interns.set(name, it); }
    if (subs === 0 && interns.has(name)) { const it = interns.get(name); emit(25, it.head(), {color: ['#ffffff', DATA.profile(name).color]}); it.dispose(); interns.delete(name); }
    spot.beacon.visible = !!a?.waiting;
  }
  const here = new Set(D.names);
  for (const [name, p] of people) if (!here.has(name)) {
    p.dispose(); people.delete(name); racks?.detach(name); releaseDesk(name);
    const it = interns.get(name); if (it) { it.dispose(); interns.delete(name); }     // its subagent goes with it
  }
}

// what happened since the last update: bubbles, planes, confetti, chimes, notifications
let prevWaiting = new Set();
function events() {
  const fresh = D.all.filter(m => m.n > lastSeenN);
  if (lastSeenN === 0) { lastSeenN = D.all.length ? D.all[D.all.length - 1].n : 0; drawBoards(); return; }
  for (const m of fresh) {
    lastSeenN = Math.max(lastSeenN, m.n);
    const from = m.from === D.user ? boss : m.from === D.lead || D.self.has(m.from) ? assistant : people.get(m.from);
    if (!from) continue;
    if (m.kind) {                                           // a status or an idle: a small grey note, shorter
      from.bubble = {text: m.text, until: Date.now() / 1000 + 4.5, kind: m.kind === 'idle' ? 'idle' : 'status'};
      continue;
    }
    from.bubble = {text: m.text, until: Date.now() / 1000 + 7, kind: PLAN.test(firstHead(m.text)) ? 'plan' : voteOf(m.text) ? 'vote' : m.from === D.user ? 'user' : 'msg'};
    const targets = EVERY.test(m.text) || m.from === D.user ? [...people.values()] : D.names.filter(n => tagsName(m.text, n)).map(n => people.get(n));
    for (const t of targets.slice(0, 6)) if (t && t !== from) flyPlane(from.head(), t.head());
    if (from !== boss && from !== assistant && SPOTS.has(m.from)) {                       // an agent's words send it somewhere
      if (PLAN.test(firstHead(m.text))) sendVisit(from, boardSpot(), 14, 'raise');
      else { const mate = D.names.find(n => n !== m.from && SPOTS.has(n) && tagsName(m.text, n)); if (mate) sendVisit(from, SPOTS.get(mate).stand, REVIEW.test(m.text) ? 12 : 7, REVIEW.test(m.text) ? 'read' : 'speak', people.get(mate)); }
    }
    if (m.from === D.user) for (const p of people.values()) { glance(p, boss.head(), 3500); }
    if (assistant && from !== assistant) { glance(assistant, from.head(), 2500); assistant.act = 'read'; }
    emit(10, from.head(), {color: ['#fff59d', '#ffffff'], speed: 1, up: 1.2, life: 0.7, size: 0.05});
    if (tagsName(m.text, D.user)) notify('tag' + m.n, `💬 ${m.from} → ${D.user}`, m.text.slice(0, 160), false, () => window.chatroom?.jumpTo(m.n));
    if (CLOSED.test(firstHead(m.text)) && m.n > lastClosedN) {
      lastClosedN = m.n;
      emit(260, new THREE.Vector3(0, 2.4, 0), {color: ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'], speed: 5, up: 5, life: 3, size: 0.08, gravity: -4});
      printJob = 3;
      notify('closed', `✅ ${D.closed ? 'CLOSED v' + D.closed.v : 'CLOSED'}`, m.text.slice(0, 160), false);
    }
  }
  for (const n of D.waiting) if (!prevWaiting.has(n)) {
    chime();
    const a = D.per[n].a;
    notify('wait-' + n, `🙋 ${n}`, `${a?.tool || ''} ${a?.target || ''}`.trim(), true, () => select(n));
  }
  unnotify(new Set([...D.waiting].map(n => 'wait-' + n)));
  prevWaiting = new Set(D.waiting);
  drawBoards();
}
let printJob = 0;

// ------------------------------------------------------------------ boards: TV, whiteboard, coffee sign, nameplate, clock
// each board is drawn again only when what it shows changed (a canvas upload of 1-5 MB each, at every state poll before), and not at all
// while nobody can see the office (chat alone, a hidden tab): then it is drawn when the office comes back
const boardSigs = {};
const boardChanged = (k, sig) => boardSigs[k] === sig ? false : (boardSigs[k] = sig, true);
const officeUnseen = () => document.hidden || document.body.classList.contains('mode-chat');
let boardsStale = false;
function drawScoreboard() {
  const {g, canvas: k} = scoreboard, L = ui.t(), data = commonState?.scores || {}, me = myName();
  if (!boardChanged('scores', `${scoresKey}|${me}|${DATA.config.lang}`)) return;
  g.fillStyle = '#10131c'; g.fillRect(0, 0, k.lw, k.lh); g.fillStyle = '#1b2233'; g.fillRect(0, 0, k.lw, 50);
  g.fillStyle = '#ffd54f'; g.font = '800 26px sans-serif'; g.textBaseline = 'alphabetic'; g.fillText('🏆 ' + L.scores.toUpperCase(), 14, 36);
  const games = [['pool', '🎱', L.pool], ['pingpong', '🏓', 'Ping pong'], ['foos', '⚽', L.foosball], ['tris', '⭕', L.tris], ['morra', '✊', L.morra], ['zombie', '🧟', 'Zombie'], ['paintball', '🔫', 'Paintball'],
                 ...Object.keys(data).filter(k2 => k2.startsWith('arc-')).slice(0, 3).map(k2 => [k2, '🕹', k2.slice(4).replace(/-/g, ' ')])];
  const rowH = Math.min(36, (k.lh - 58) / games.length);
  games.forEach(([key, icon, label], i) => {
    const y = 56 + i * rowH, book = data[key], top = book?.rows?.find(r => book.mode === 'best' || r.w > 0), mine = top && top.name === me;
    if (i % 2) { g.fillStyle = '#ffffff08'; g.fillRect(0, y, k.lw, rowH); }
    g.fillStyle = '#9aa4b8'; g.font = '600 17px sans-serif'; g.fillText(`${icon} ${label}`, 14, y + rowH * 0.7);
    if (!top) { g.fillStyle = '#4a5368'; g.fillText('–', 190, y + rowH * 0.7); return; }
    g.fillStyle = mine ? '#4fc3f7' : '#ffd54f'; g.font = '800 18px sans-serif'; g.fillText('👑 ' + top.name.slice(0, 16), 190, y + rowH * 0.7);
    g.fillStyle = '#e8eaf0'; g.font = '700 18px sans-serif'; g.textAlign = 'right'; g.fillText(book.mode === 'best' ? String(top.best) : `${top.w} ${L.colWins}`, k.lw - 14, y + rowH * 0.7); g.textAlign = 'left';
  });
  scoreboard.tex.needsUpdate = true;
}
// the task board (chat.py task / board.json), read every 3 s; the whiteboard shows it when it has tasks
let boardData = null, boardSig = '';
async function pollBoard() {
  if (officeUnseen() && boardData) return;
  try {
    const r = await fetch('board.json', {cache: 'no-store'}); if (!r.ok) return;
    const text = await r.text(); if (text === boardSig) return;
    boardSig = text; boardData = JSON.parse(text); if (DATA.loaded) drawBoards();
  } catch (e) {}
}
if (!VISIT) { pollBoard(); setInterval(pollBoard, 3000); }
function drawBoards() {
  const c = DATA.config, L = ui.t();
  if (LAYOUT.bridge) {                                // the bridge is not a drawing: it opens the way, seen or not
    const shared = VISIT || commonRoom().shared;
    bridge.visible = shared; commonDoor.visible = !shared;
    if (shared !== bridgeOpen) { bridgeOpen = shared; openBridge(shared); }
  }
  if (officeUnseen()) { boardsStale = true; return; }
  boardsStale = false;
  drawScoreboard(); signs?.redraw();
  const visiting = VISIT && visit, liveMsgs = [];
  if (visiting) liveMsgs.push(...(DATA.live || []).slice(-4));
  else for (let i = D.all.length - 1; i >= 0 && liveMsgs.length < 4; i--) if (!D.all[i].kind) liveMsgs.unshift(D.all[i]);
  if (boardChanged('tv', JSON.stringify([c.lang, D.user, !!visiting, liveMsgs.map(m => [m.n, m.from, DATA.profile(m.from).color, m.text])]))) {
    const {g, canvas: k} = tv; g.fillStyle = '#0d1018'; g.fillRect(0, 0, k.lw, k.lh);
    g.fillStyle = '#4fc3f7'; g.font = '700 22px sans-serif'; g.fillText('● LIVE', 14, 30);
    const msgs = liveMsgs; let y = 62;
    if (visiting && !msgs.length) { g.fillStyle = '#6b7280'; g.font = '16px sans-serif'; g.fillText(c.lang === 'en' ? 'the chat is not shared' : 'chat non condivisa', 14, 62); }
    g.font = '17px sans-serif';
    for (const m of msgs) {
      g.fillStyle = m.from === D.user ? '#ff80ab' : DATA.profile(m.from).color; g.font = '700 17px sans-serif'; g.fillText(`#${m.n} ${m.from}`, 14, y);
      g.fillStyle = '#e8eaf0'; g.font = '16px sans-serif'; wrapText(g, String(m.text).replace(/\s+/g, ' '), 14, y + 20, k.lw - 28, 18, 2); y += 64;
    }
    tv.tex.needsUpdate = true;
  }
  const colorsOf = list => list.map(n => DATA.profile(n).color).join();
  const wbSig = boardData?.tasks?.length
    ? JSON.stringify([L.bTodo, boardSig, colorsOf(boardData.tasks.map(t => t.owner || t.by).filter(Boolean))])
    : JSON.stringify([c.lang, D.names.map(n => [n, DATA.profile(n).color, !!D.per[n].a?.waiting, !!D.per[n].idle, D.per[n].vote]), D.plan, D.closed?.v]);
  if (!boardChanged('wb', wbSig)) {}
  else if (boardData?.tasks?.length) {                // the room's task board (chat.py task): to do, in progress, done, and the last fact
    const {g, canvas: k} = wb, f = k.lw / 512; g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, k.lw, k.lh);
    const cols = [[`📝 ${L.bTodo}`, '#f5b400', 'open'], [`⚙️ ${L.bDoing}`, '#1e88e5', 'taken'], [`✅ ${L.bDone}`, '#43a047', 'done']], w = k.lw / 3;
    const fact = boardData.facts?.[boardData.facts.length - 1], foot = fact ? 26 * f : 6 * f;
    const head = 34 * f, cardH = 52 * f, gap = 6 * f, fit = Math.max(1, Math.floor((k.lh - head - 10 * f - foot) / (cardH + gap)));
    cols.forEach(([title, color, st], i) => {
      g.fillStyle = color; g.fillRect(i * w + 5 * f, 6 * f, w - 10 * f, 28 * f); g.fillStyle = '#fff'; g.font = `700 ${17 * f}px sans-serif`; g.fillText(title, i * w + 11 * f, 26 * f);
      const list = boardData.tasks.filter(t => t.state === st), shown = st === 'done' ? list.slice(-fit) : list.slice(0, fit);
      let y = head + 8 * f;
      if (!list.length) { g.fillStyle = '#90a4ae'; g.font = `italic ${14 * f}px sans-serif`; g.fillText(L.bNone, i * w + 12 * f, y + 18 * f); }
      for (const t of shown) {
        const who = t.owner || t.by;
        g.fillStyle = (who ? DATA.profile(who).color : '#90a4ae') + '30'; g.fillRect(i * w + 7 * f, y, w - 14 * f, cardH);
        g.fillStyle = '#222'; g.font = `700 ${14 * f}px sans-serif`; g.fillText(`${t.id}${t.lender && t.state === 'taken' && t.owner !== t.lender ? ' 🤝' : ''}${t.owner ? ' · ' + t.owner : ''}`, i * w + 12 * f, y + 16 * f);
        g.font = `${14 * f}px sans-serif`; wrapText(g, t.title, i * w + 12 * f, y + 33 * f, w - 24 * f, 15 * f, 2);
        y += cardH + gap;
      }
      if (list.length > shown.length) { g.fillStyle = '#607d8b'; g.font = `700 ${13 * f}px sans-serif`; g.fillText(`+${list.length - shown.length}`, i * w + w - 40 * f, head - 2 * f); }
    });
    if (fact) { g.fillStyle = '#e8e6df'; g.fillRect(0, k.lh - foot, k.lw, foot); g.fillStyle = '#37474f'; g.font = `italic ${14 * f}px sans-serif`; wrapText(g, `📌 ${fact.text}`, 10 * f, k.lh - 8 * f, k.lw - 20 * f, 15 * f, 1); }
    wb.tex.needsUpdate = true;
  } else {
    const {g, canvas: k} = wb; g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, k.lw, k.lh);
    const cols = [['🙋', '#e53935', n => D.per[n].a?.waiting], ['⚙️', '#1e88e5', n => !D.per[n].idle && !D.per[n].a?.waiting], ['💤', '#78909c', n => D.per[n].idle], ['🗳', '#43a047', n => D.per[n].vote]];
    const w = k.lw / cols.length;
    cols.forEach(([icon, color, test], i) => {
      g.fillStyle = color; g.fillRect(i * w + 6, 8, w - 12, 30); g.fillStyle = '#fff'; g.font = '700 18px sans-serif'; g.fillText(icon, i * w + 14, 30);
      let y = 50;
      for (const n of D.names.filter(test)) {
        g.fillStyle = DATA.profile(n).color + '33'; g.fillRect(i * w + 8, y, w - 16, 30);
        g.fillStyle = '#222'; g.font = '700 15px sans-serif'; g.fillText(`${n}${D.per[n].vote ? ' ' + (D.per[n].vote === 'yes' ? '✓' : '✗') : ''}`, i * w + 14, y + 20);
        y += 36;
      }
    });
    if (D.plan) { g.fillStyle = D.closed ? '#2e7d32' : '#f5b400'; g.font = '800 20px sans-serif'; g.fillText(D.closed ? `${L.done} v${D.closed.v}` : `PLAN v${D.plan.v} · ${D.plan.author}`, 12, k.lh - 14); }
    wb.tex.needsUpdate = true;
  }
  if (boardChanged('coffee', c.lang)) {
    const {g, canvas: k} = coffeeSign; g.fillStyle = '#2b2f36'; g.fillRect(0, 0, k.lw, k.lh);
    g.font = '700 46px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3e3c3';
    g.fillText(DATA.config.lang === 'en' ? '☕ coffee' : '☕ caffè', k.lw / 2, k.lh / 2 + 3); g.textAlign = 'left';
    coffeeSign.tex.needsUpdate = true;
  }
  if (boardChanged('nameplate', D.user)) {
    const {g, canvas: k} = nameplate; g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, k.lw, k.lh);
    g.fillStyle = '#d4a640'; g.font = '700 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`👑 ${D.user}`, k.lw / 2, k.lh / 2 + 2);
    g.textAlign = 'left'; nameplate.tex.needsUpdate = true;
  }
  if (LAYOUT.bridge && boardChanged('friend', L.friendOffice)) {
    const {g, canvas: k} = friendSign;
    g.fillStyle = '#0f1a24'; g.fillRect(0, 0, k.lw, k.lh); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#80deea'; g.font = '700 22px "Segoe UI", sans-serif'; g.fillText(`🌐 ${L.friendOffice}`, k.lw / 2, k.lh / 2 + 1);
    g.textAlign = 'left'; friendSign.tex.needsUpdate = true;
  }
  if (commonSign && boardChanged('common', JSON.stringify([L.common, commonRoom().all, [...commonRoom().who], commonRoom().shared]))) {
    const {g, canvas: k} = commonSign, room = commonRoom();
    g.fillStyle = '#2b2f36'; g.fillRect(0, 0, k.lw, k.lh); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f3e3c3'; g.font = '700 25px "Segoe UI", sans-serif'; g.fillText(`🛋 ${L.common}`, k.lw / 2, k.lh * 0.36);
    g.fillStyle = room.shared ? '#69f0ae' : '#b0bec5'; g.font = '15px "Segoe UI", sans-serif';
    g.fillText((room.all ? L.commonAll : room.who.size ? L.commonSome(room.who.size) : L.commonClosed) + (room.shared ? ' · 🌐' : ''), k.lw / 2, k.lh * 0.74);
    g.textAlign = 'left'; commonSign.tex.needsUpdate = true;
  }
}
function drawClock() {
  const {g, canvas: k} = clock, d = new Date(), r = k.lw / 2;
  g.clearRect(0, 0, k.lw, k.lw); g.fillStyle = '#fafafa'; g.beginPath(); g.arc(r, r, r - 4, 0, 7); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#37474f'; g.stroke();
  const hand = (a, len, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(r, r); g.lineTo(r + Math.sin(a) * len, r - Math.cos(a) * len); g.stroke(); };
  hand((d.getHours() % 12 + d.getMinutes() / 60) * Math.PI / 6, r * 0.5, 7, '#263238'); hand(d.getMinutes() * Math.PI / 30, r * 0.72, 5, '#263238');
  hand(d.getSeconds() * Math.PI / 30, r * 0.78, 2, '#e53935');
  clock.tex.needsUpdate = true;
}

// the screen of each desk shows what its agent does
// what makes a screen's picture: the act, the colour and the tick its drawing moves at (a chat screen never moves; the web globe, the
// floating icon and the agent turn smoothly, so they always draw)
const SCREEN_TICK = {code: 6, other: 6, term: 6, read: 2, raise: 3, post: 0, chat: 0, speak: 0};
function drawScreen(name, act, t) {
  const spot = SPOTS.get(name); if (!spot) return;
  const color = DATA.profile(name).color, tick = SCREEN_TICK[act];
  const key = tick === undefined ? null : `${act}|${color}|${tick ? Math.floor(t * tick) : 0}`;
  if (key && key === spot.scrKey) return;
  spot.scrKey = key;
  const {g, canvas: k} = spot.scr, W = k.lw, H = k.lh;
  g.fillStyle = '#0e1320'; g.fillRect(0, 0, W, H);
  const r = V.rnd(Math.floor(t * 3) + V.hashName(name));
  if (act === 'code' || act === 'other') {
    const off = Math.floor(t * 6);
    for (let i = 0; i < 9; i++) { const rr = V.rnd(off + i); g.fillStyle = ['#82aaff', '#c3e88d', '#f78c6c', '#c792ea', '#89ddff'][Math.floor(rr() * 5)]; g.fillRect(8 + Math.floor(rr() * 3) * 10, 8 + i * 13, 30 + rr() * 120, 7); }
  } else if (act === 'term') {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#4cff7a'; g.font = '11px monospace';
    for (let i = 0; i < 8; i++) g.fillText('$ ' + Math.floor(r() * 1e9).toString(36).repeat(2).slice(0, 22), 6, 14 + i * 13);
    if (Math.floor(t * 2) % 2) g.fillRect(6, H - 10, 8, 3);
  } else if (act === 'read') {
    g.fillStyle = '#f5f2ea'; g.fillRect(14, 4, W - 28, H - 8); g.fillStyle = '#9aa0a6';
    for (let i = 0; i < 9; i++) g.fillRect(24, 12 + i * 10, (W - 48) * (0.5 + 0.5 * V.rnd(i + 3)()), 4);
    g.fillStyle = color + '66'; g.fillRect(20, 12 + (Math.floor(t * 2) % 9) * 10 - 3, W - 40, 9);
  } else if (act === 'web') {
    g.fillStyle = '#e3f2fd'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(14, 8, W - 28, 16); g.fillStyle = '#1e88e5';
    g.beginPath(); g.arc(W / 2, H / 2 + 12, 28, 0, 7); g.fill(); g.strokeStyle = '#bbdefb'; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(W / 2, H / 2 + 12, Math.abs(Math.cos(t + i)) * 28, 28, 0, 0, 7); g.stroke(); }
  } else if (act === 'post' || act === 'chat' || act === 'speak') {
    for (let i = 0; i < 4; i++) { const right = i % 2; g.fillStyle = right ? color : '#2a3942'; g.fillRect(right ? W - 96 : 10, 8 + i * 24, 86, 18); }
  } else if (act === 'agent') {
    g.fillStyle = '#263238'; g.fillRect(0, 0, W, H); g.font = '42px sans-serif'; g.textAlign = 'center'; g.fillText('🤖', W / 2 + Math.sin(t * 3) * 20, H / 2 + 16); g.textAlign = 'left';
  } else if (act === 'raise') {
    g.fillStyle = Math.floor(t * 3) % 2 ? '#b71c1c' : '#e53935'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = '800 54px sans-serif'; g.textAlign = 'center'; g.fillText('!', W / 2, H / 2 + 20); g.textAlign = 'left';
  } else {
    g.font = '30px sans-serif'; g.fillText(DATA.config.icon || '💬', (Math.sin(t * 0.7) * 0.4 + 0.5) * (W - 40), (Math.cos(t * 0.9) * 0.35 + 0.5) * (H - 10) + 10);
  }
  spot.scr.tex.needsUpdate = true;
}

// ------------------------------------------------------------------ UI, modes, selection, camera
// ?view=chat (or office, split) opens the viewer in that view, once; the buttons change it as usual
const VIEW = new URLSearchParams(location.search).get('view');
let mode = ['split', 'office', 'chat'].includes(VIEW) ? VIEW : pref('mode', window.innerWidth >= 1000 ? 'split' : 'office'), selected = null, follow = false;
// first person: the camera is the user's figure's eyes; leaving it flies back to the overview before the orbit resumes
let pov = pref('pov', false), flyHome = false, povLocked = false, povRot = 0, watchEnd = 0;
let paintball = null;                                                      // office-paintball.js, created at the end; while it is on the view stays in first person
const povLook = HOME.target.clone(), _look = new THREE.Vector3(), _eye = new THREE.Vector3();
controls.enabled = !pov;
function setPov(on) {
  if (!on && paintball?.active()) return paintball.lockMessage();
  if (!on) document.exitPointerLock?.();
  pov = on; setPref('pov', on); povLocked = false; keys.clear(); povRot = boss ? boss.rot : 0;
  if (on) { povLook.copy(controls.target); tween = null; follow = false; flyHome = false; controls.enabled = false; me.yaw = 0; me.pitch = -0.08; }
  else flyHome = true;
}
const atMyDesk = () => boss && seated(boss) && boss.spot === OWNER_SEAT && !visit;
async function openCommands() {
  try {
    const list = await (await fetch('commands.json', {cache: 'no-store'})).json();
    ui.palette(list, async c => { await post(viewScope === 'other' ? 'neighbor/command?n=' + (window.chatroomRoom ? window.chatroomRoom().n : 0) : 'command', {name: c.name}); ui.placeName(ui.t().cmdSent(c.icon + ' ' + c.name)); });
  } catch (e) {}
}
document.addEventListener('keydown', e => {
  if (ui.paletteOpen() && ui.paletteKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (e.key === '/' && atMyDesk() && mode !== 'chat' && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    e.preventDefault(); return openCommands();
  }
}, true);
document.addEventListener('keydown', e => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (!pov || mode === 'chat' || e.ctrlKey || e.metaKey || e.altKey || (typing && typing.offsetParent !== null) || games.active()) return;
  if (typing) typing.blur();                                                // a hidden chat box must not eat the keys
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(k)) { keys.add(k); e.preventDefault(); }
  else if (k === 'e' && !e.repeat) { interact(); e.preventDefault(); }
  else if (k === 'q' && !e.repeat) { wave(); e.preventDefault(); }
});
document.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
let jumpSeq = 0;                                                            // how many jumps you made: a friend's side plays the new ones
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.repeat || !boss || mode === 'chat' || e.ctrlKey || e.metaKey || e.altKey || editor.active() || games.active() || loungeTv.open()) return;
  if (e.target.closest?.('input, textarea, select, button, a, [contenteditable]')) return;
  if (tryVault() || boss.jump()) { jumpSeq++; e.preventDefault(); }
});
window.addEventListener('blur', () => { keys.clear(); shiftHeld = false; });
document.addEventListener('keydown', e => { if (e.key === 'Shift') shiftHeld = true; });
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 't' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || mode === 'chat' || !boss) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (typing && typing.offsetParent !== null) return;
  if (loungeTv.nearTv(boss.pos) < 8) { e.preventDefault(); document.exitPointerLock?.(); loungeTv.menu(); }
});
document.addEventListener('keyup', e => { if (e.key === 'Shift') shiftHeld = false; });
const SENS = [0.0015, 0.0024, 0.0036, 0.0052];                              // mouse sensitivity (radians per pixel): slow, medium, fast, very fast
let sensIdx = Math.max(0, Math.min(SENS.length - 1, +pref('sens', 1) || 0));
const locked = () => document.pointerLockElement === renderer.domElement;
const zoomMul = () => paintball?.zoomFactor?.() ?? 1;                              // a zoomed view turns slower
let lockSkip = 0;                                                             // the first events after the capture can carry a jump of the cursor: dropped
renderer.domElement.addEventListener('pointermove', e => {                    // first person: the mouse looks (captured pointer), or a drag looks around
  if (!pov || !(locked() || (e.buttons & 1))) return;
  if (locked() && lockSkip > 0) { lockSkip--; return; }
  let dx = e.movementX || 0, dy = e.movementY || 0;
  if (!Number.isFinite(dx + dy) || Math.abs(dx) > 1500 || Math.abs(dy) > 1500) return;       // a glitch of the driver, not a hand
  watching = null;
  const sens = locked() ? SENS[sensIdx] * zoomMul() : 0.005;
  if (locked() && povLocked && boss && !seated(boss) && !vault && !boss.path.length) { boss.rot = boss.faceRot = wrapAng(boss.rot - dx * sens); povRot = boss.rot; }   // the body turns with the view
  else me.yaw = wrapAng(me.yaw - dx * sens);
  me.pitch = Math.max(-1.3, Math.min(1.2, me.pitch - dy * (locked() ? sens : 0.004)));
});
document.addEventListener('pointerlockchange', () => { lockSkip = 2; if (!locked()) keys.clear(); });
const mixer = createMixer({root, t: () => ui.t()});                             // the volumes: general, TV, radio, lofi
const ui = createUI(root, {
  onExtra: k => { if (k === 'pingPong' || k === 'foosball' || k === 'poolTable') openGame(k); },
  onMode: m => { mode = m; setPref('mode', m); applyMode(); },
  onPov: () => setPov(!pov),
  onSound: () => mixer.toggle(),
  onLook: () => ui.lookPanel(myLook, V.LOOK, setMyLook),
  onRun: () => { running = !running; setPref('run', running); },
  onEdit: () => { if (VISIT) return; if (pov) setPov(false); ui.commonPanel(null); select(null); editor.toggle(); },
  onCommonOpen: () => ui.commonOpen() ? ui.commonPanel(null) : openCommon(),
  onShare: async (action, extra) => { await post('share', {action, ...extra}); pollCommon(); },
  onJoin: async (url, pin) => { const r = await post('join', url === null ? {leave: true} : {url, pin}); if (r && !r.ok) ui.roomTip(await r.text(), 20, 120); pollCommon(); },
  onCommonWrite: async text => { await post('common/post', {text}); pollCommon(); },
  onGame: async (game, text) => {
    const before = myGameOf(game.type)?.id, r = await post('common/post', {text, game});
    if (r && !r.ok) { ui.roomTip(await r.text(), 20, 120); return pollCommon(); }
    if (['pool', 'pingpong', 'foos'].includes(game.type) && (game.op === 'new' || game.op === 'join')) return openMyGame(game.type, before);   // the panel's button opens the table too
    pollCommon();
  },
  onAnswer: async (id, ok, extra) => { const r = await post('join/answer', {id: +id, ok, ...extra}); if (r && !r.ok) ui.roomTip(await r.text(), 20, 120); pollCommon(); },
  onOpenPool: () => { const g = myPool(); if (g) openPoolTable(g); },
  onOpenGame: type => { const g = myGameOf(type); if (g) openGameTable(g); },
  onCommonDoc: async (name, data, error) => {
    if (error) return ui.roomTip(error, 20, 120);
    const r = await post('common/doc', {name, data}); if (r && !r.ok) ui.roomTip(await r.text(), 20, 120); pollCommon();
  },
  onAsk: async text => { const r = await post('join/ask', {text}); if (r && !r.ok) ui.roomTip(await r.text(), 20, 120); pollCommon(); },
  onVisit: () => { location.search = '?visit'; },
  onCommon: async cfg => {
    DATA.config.common = cfg; openCommon(); drawBoards();
    try { await fetch('config', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({common: cfg})}); } catch (e) {}
  },
  onReset: () => { follow = false; if (pov) setPov(false); else tween = {pos: HOME.pos.clone(), target: HOME.target.clone()}; },
  onFollow: () => { follow = !follow && !!selected; },
  onSens: () => { sensIdx = (sensIdx + 1) % SENS.length; setPref('sens', sensIdx); },
  onQuality: () => { quality = QUALITY[(QUALITY.indexOf(quality) + 1) % QUALITY.length]; setPref('quality', quality); if ((quality === 'bassa') !== DIRECT) location.reload(); else applyQuality(); },
  onSelect: n => select(n),
  onTag: n => { if (mode === 'office') { mode = 'split'; applyMode(); } window.chatroom?.tag(n); },
  onGo: n => walkOver(n),
  onJump: n => { if (n && window.chatroom) { if (mode === 'office') { mode = 'split'; applyMode(); } window.chatroom.jumpTo(n); } },
  onNext: dir => { const list = D.names; if (!list.length) return; const i = list.indexOf(selected); select(list[(i + dir + list.length) % list.length]); },
});
const editor = createEditor({scene, camera, controls, renderer, root, layout: LAYOUT, meshes: ITEM_MESHES, place: placeItem,
                             lang: () => DATA.config.lang === 'en' ? 'en' : 'it'});
document.addEventListener('keydown', e => { if (mode !== 'chat' && !editor.active()) ui.onKey(e); });
// the chat header's 🏢 button: from the chat alone back to the split view, otherwise to the chat alone
window.officeMode = m => { mode = m || (mode === 'chat' ? 'split' : 'chat'); setPref('mode', mode); applyMode(); };
async function post(path, body) {
  try { return await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); } catch (e) { return null; }
}
// ------------------------------------------------------------------ the common room, live: its chat, guests drawn in the office
let commonState = null, lastCommonN = -1;
const askedSeen = new Set();
const remote = new Map();                                                    // name -> Person, figures from the other side
async function pollCommon() {
  try {
    const r = await fetch('common.json', {cache: 'no-store'});
    if (!r.ok) return;
    commonState = await r.json();
    ui.commonState(commonState);
    const sk = JSON.stringify(commonState.scores || {}); if (sk !== scoresKey) { scoresKey = sk; drawScoreboard(); }
    try { reportFinished(); arcadeInvites(); } catch (e) {}
    for (const q of commonState.share?.requests || []) if (q.status === 'pending' && !askedSeen.has(q.id)) {
      askedSeen.add(q.id); chime(); notify('ask' + q.id, `🙋 ${q.guest}`, q.text.slice(0, 160), true, () => openCommon());
    }
    window.dispatchEvent(new CustomEvent('chatroom:common', {detail: commonState}));
    syncRemote();
    if (typeof loungeTv !== 'undefined') tvFromFriends();
    if (typeof games !== 'undefined') poolFromFriends();
  } catch (e) {}
}
setInterval(pollCommon, 2000);
function syncRemote() {
  const s = commonState;
  if (!s || !boss) return;
  const joined = !!(s.bridge && s.bridge.joined);
  const here = 'visit:' + (visit ? visit.host : s.me), person = p => p.host || p.name === p.guest;
  // from the other side: as host, the guests and their agents; as guest, everyone but me and my own agents
  const list = (s.people || []).filter(p => (joined ? p.guest !== s.me : !!p.guest)
                                            && !(visit && (DATA.config.participants || []).includes(p.name)) && !(visit && p.name === visit.host)
                                            && !(visit && p.guest === visit.host)
                                            && !(p.emoji === '🤝' && (DATA.config.participants || []).includes(p.name))   // a lent helper already has a desk here
                                            && (!person(p) || (p.pos && p.pos.where === here)));   // a friend shows only while really in this office
  const names = new Set(list.map(p => p.name));
  for (const [n, p] of remote) if (!names.has(n)) { emit(20, p.head(), {color: ['#80deea', '#ffffff']}); p.dispose(); remote.delete(n); }
  const used = new Set([...people.values()].map(p => p.spot)), free = [...COMMON.filter(s => !used.has(s) && s !== boss.spot).reverse(),
                                                                         ...STANDS.filter(s => s.tag === 'portal')];
  let k = 0;
  for (const p of list) {
    if (!remote.has(p.name)) {
      const seat = person(p) && p.pos ? {pos: new THREE.Vector3(p.pos.x, p.pos.y || 0, p.pos.z), rot: p.pos.rot, pose: p.pos.pose === 'walk' ? 'stand' : p.pos.pose}
        : free[k % Math.max(1, free.length)] || BOSS_SEAT;
      const r = new Person(p.name, person(p) ? 'boss' : 'guest', seat, true, p.color || '#888888', person(p) ? p.pos?.look || null : null);
      r.remoteEmoji = p.emoji; r.act = 'idle'; r.home = seat;
      remote.set(p.name, r);
    }
    k++;
    let r = remote.get(p.name);
    if (person(p) && JSON.stringify(p.pos?.look || null) !== r.lookKey) r = rebuild(r, p.pos?.look || null, rr => remote.set(p.name, rr));
    r.act = r.follow ? 'idle' : p.state === 'work' ? 'think' : 'coffee';
  }
  // new lines in the common room: a bubble over whoever said it
  const msgs = s.messages || [], top = msgs.length ? msgs[msgs.length - 1].n : 0;
  if (lastCommonN < 0) lastCommonN = top;
  for (const m of msgs) if (m.n > lastCommonN) {
    const who = remote.get(m.from) || people.get(m.from) || (m.from === s.me ? boss : null);
    if (who) who.bubble = {text: m.text, until: Date.now() / 1000 + 7, kind: 'msg'};
  }
  lastCommonN = Math.max(lastCommonN, top);
}
// where your figure is goes to the other side while the room is shared or joined, or while you visit
const linked = () => VISIT || !!(commonState?.share?.sharing || commonState?.bridge?.joined);
let presenceSent = '', presence = null, oldServerSaid = false, myPb = null;          // myPb: my paintball snapshot, sent with my position
setInterval(() => {
  if (!boss || !linked()) return;
  const pos = {x: boss.pos.x, y: boss.pos.y + (boss.lvl || 0), z: boss.pos.z, rot: boss.rot, pose: boss.pose, where: visit ? 'visit:' + visit.host : 'home', look: myLook, jump: jumpSeq, pb: myPb};
  const key = JSON.stringify(pos, (k, v) => typeof v === 'number' ? Math.round(v * 20) / 20 : v);
  if (key !== presenceSent && !presencePosting) {                          // one at a time: over a slow tunnel they would cross and land out of order
    presenceSent = key; presencePosting = true;
    post('presence', pos).then(r => { if (r && r.status === 404 && !oldServerSaid) { oldServerSaid = true; ui.roomTip(ui.t().oldServer, 20, 120); } }).finally(() => { presencePosting = false; });
  }
}, 200);
let presencePosting = false, presenceAsking = false;
setInterval(async () => {
  if (!linked() || presenceAsking) return;
  presenceAsking = true;
  try { const r = await fetch('presence.json', {cache: 'no-store'}); if (r.ok) { presence = await r.json(); placeOthers(); } } catch (e) {} finally { presenceAsking = false; }
}, 300);
function placeOthers() {
  const meName = presence.me, here = 'visit:' + (visit ? visit.host : meName);
  for (const p of presence.people || []) {
    if (p.name === meName) continue;
    const owner = visit && p.name === visit.host, fig = owner ? hostFigure : remote.get(p.name);
    if (owner && hostFigure && JSON.stringify(p.pos?.look || null) !== hostFigure.lookKey) rebuild(hostFigure, p.pos?.look || null, rr => { hostFigure = rr; });
    if (owner && hostFigure) hostFigure.root.visible = !!(p.pos && p.pos.where === 'home');
    const now = owner ? hostFigure : fig;                                       // a new look may have rebuilt it
    paintball?.receive(p.name, p.pos && (owner ? p.pos.where === 'home' : p.pos.where === here) ? p.pos.pb : null);   // their paintball, if we are in the same office
    if (now) walkWhere(now, p.pos && (owner ? p.pos.where === 'home' : p.pos.where === here) ? p.pos : null);
  }
}
/** a figure of the other side walks to where its person really is (a long way: it appears there) */
function walkWhere(fig, pos) {
  if (!pos) { if (fig.follow) { fig.follow = null; fig.speed = 1; fig.goTo(fig.home || OWNER_SEAT); } return; }
  const to = new THREE.Vector3(pos.x, pos.y || 0, pos.z), spot = {pos: to, rot: pos.rot, pose: pos.pose === 'walk' ? 'stand' : pos.pose};
  fig.follow = pos; fig.act = 'idle';
  if (pos.jump !== undefined) {                                               // the friend jumped: the same jump here (up to two between two looks)
    const n = pos.jump - (fig.seenJump ?? pos.jump);
    if (n > 0 && n <= 2) { fig.jump(); if (n === 2) setTimeout(() => fig.jump(), 280); }
    fig.seenJump = pos.jump;
  }
  const far = Math.hypot(fig.pos.x - to.x, fig.pos.z - to.z) + (Math.abs(fig.pos.y - to.y) > 1.5 ? 99 : 0);                // a friend who went up (or down) the lift appears there
  if (far > 6) { fig.pos.copy(to); fig.path = []; fig.spot = spot; fig.pose = spot.pose; fig.rot = pos.rot; return; }
  fig.spot = spot;
  if (far < 0.05) { if (!fig.path.length) { fig.pose = spot.pose; fig.pos.y = to.y; } return; }
  fig.path = [to.clone()]; fig.pose = 'walk'; fig.speed = Math.max(1.2, Math.min(4, far / 0.35));      // far behind: faster, so a friend who runs (x2) is not left behind and then thrown forward
}
/** a figure again with another look, where the old one was */
function rebuild(old, look, put) {
  const p = new Person(old.name, old.kind, {pos: old.pos.clone(), rot: old.rot, pose: old.pose}, false, null, look);
  Object.assign(p, {spot: old.spot, path: old.path, act: old.act, home: old.home, follow: old.follow, remoteEmoji: old.remoteEmoji, speed: old.speed, lvl: old.lvl});
  p.root.visible = old.root.visible; old.dispose(); put(p); return p;
}
/** your own look, from the editor: tried on at once, kept when saved */
function setMyLook(look, save) {
  myLook = look;
  if (boss) { const cup = me.cup; boss = rebuild(boss, look, () => {}); if (cup) boss.parts.armR.add(cup); }
  if (save) post('settings', {avatar: look});
}
function openCommon() {
  const r = commonRoom();
  ui.commonPanel({cfg: {all: r.all, shared: r.shared, mirror: !!(DATA.config.common || {}).mirror, who: [...r.who]},
                  names: D.names.map(n => ({name: n, emoji: DATA.profile(n).emoji, color: DATA.profile(n).color}))});
}
function applyMode() {
  document.body.classList.remove('mode-split', 'mode-office', 'mode-chat');
  document.body.classList.add('mode-' + mode);
  resize();
}
let tween = null;
function select(name) {
  selected = name && (people.has(name) || name === D.user || name === D.lead) ? name : null;
  if (!selected) { follow = false; ui.inspect(null); return; }
  const p = people.get(selected) || (selected === D.user ? boss : assistant);
  if (pov || flyHome) { inspect(); return; }                       // in first person the eyes stay where they are
  const h = p.head(), off = camera.position.clone().sub(controls.target).setLength(Math.min(9, camera.position.distanceTo(controls.target)));
  tween = {pos: h.clone().add(off), target: h.clone().add(new THREE.Vector3(0, -0.6, 0))};
  inspect();
}
function inspect() {
  if (!selected) return;
  const L = ui.t(), pr = DATA.profile(selected), d = D.per[selected];
  if (!d) { ui.inspect({name: selected, you: selected === D.user, emoji: selected === D.user ? '👑' : '👓', role: selected === D.user ? L.you : L.lead, model: pr.model, color: pr.color,
                       msgs: D.all.filter(m => m.from === selected && !m.kind).slice(-3).reverse(), lastN: D.all.filter(m => m.from === selected).pop()?.n}); return; }
  const a = d.a;
  ui.inspect({name: selected, emoji: pr.emoji, role: pr.role, model: pr.model, color: pr.color, pct: d.pct, state: people.get(selected)?.act,
              ctx: a?.ctx, window: a?.window, pulse: a?.pulse, tl: TL?.agents?.[selected], lastN: d.last?.n, msgs: d.msgs,
              recent: (a?.recent || []).map(r => ({...r, emoji: EMOJI[cat(r.tool, r.target)] || '🔧'}))});
}
renderer.domElement.addEventListener('pointerdown', e => { unlockAudio(); downAt = [e.clientX, e.clientY]; });
let downAt = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// room names: the one under the mouse shows by the pointer for a moment; in first person, the one you walk into
const roomAt = (x, z) => (LAYOUT.rooms || []).find(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && (!r.shared || commonRoom().shared));
const roomName = r => r ? (DATA.config.lang === 'en' ? r.en : r.it) : '';
const _floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), _hit = new THREE.Vector3();
let hoverRoom = null, hoverAt = 0, povRoom = null, hintAcc = 0;
const hintText = n => { const L = ui.t(); if (n.kind === 'lift' || n.kind === 'arenaExit') return 'E · ' + (ARENA_TEXT[DATA.config.lang] || ARENA_TEXT.en)[n.kind === 'lift' ? 'hintLift' : 'hintExit']; if (n.kind === 'desk') return (pov ? `E · ${L.hint_stand}   ` : '') + `/ · ${L.hint_cmds}`; return 'E · ' + (n.kind === 'talk' ? L.hintTalk(n.name) : n.kind === 'tv' || n.kind === 'board' ? (watching ? L.hintStop : L['hint_' + n.kind]) : L['hint_' + n.kind]); };
renderer.domElement.addEventListener('pointermove', e => {
  const now = performance.now();
  if (pov || e.buttons || now - hoverAt < 80) return;
  hoverAt = now;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const room = ray.ray.intersectPlane(_floor, _hit) ? roomAt(_hit.x, _hit.z) : null;
  if (room && room !== hoverRoom) ui.roomTip(roomName(room), e.clientX - r.left, e.clientY - r.top);
  hoverRoom = room;
});
renderer.domElement.addEventListener('pointerleave', () => { hoverRoom = null; });
renderer.domElement.addEventListener('click', e => {
  if (pov && povLocked && !editor.active() && !locked() && !games.active() && !loungeTv.open()) renderer.domElement.requestPointerLock?.();
  if (editor.active()) return;
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  if (locked()) ndc.set(0, 0);                                                       // a captured mouse has no position (clientX/Y stay where the capture began): the click is where you look
  else ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(raycastables, false)[0];
  if (hit?.object.userData.remote) { document.exitPointerLock?.(); return loungeTv.menu(); }                       // the TV's remote: its menu
  if (hit?.object.userData.radio) return radio.menu();                           // the radio: its stations
  if (hit?.object.userData.lift) return liftMenu();                                  // the lift: up to the arena
  if (hit?.object.userData.rack) return racks?.open(hit.object.userData.rack);                // the rack by a desk: its processes
  if (hit?.object.userData.github) return github?.open();                          // the GitHub window on the wall: its panel
  if (hit?.object.userData.arcade) return arcade?.open();                          // the arcade cabinet: play
  if (hit?.object.userData.lofi) return lofi.toggle();                           // the common room's speakers: music on or off
  if (hit?.object.userData.game) return openGame(hit.object.userData.game);       // a games table: play
  const name = hit?.object.userData.person;
  if (name && !name.endsWith('·sub') && !(pov && name === D.user)) return select(name);
  select(null);
  if (pov) return;
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };       // a mesh under a hidden group (the arena floor, 8 m above) still has visible = true, and the ray would stop on it
  const spot = ray.intersectObjects(scene.children, true).find(h => h.object.isMesh && shown(h.object) && !h.object.material?.transparent && !h.object.userData.person);
  if (spot) goToPoint(spot.point);
});
controls.addEventListener('start', () => { tween = null; });

function resize() {
  const w = root.clientWidth || 1, h = root.clientHeight || 1;
  renderer.setSize(w, h, false); composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio());
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(root);

// ------------------------------------------------------------------ tags over the heads
const _v = new THREE.Vector3();
function placeTags() {
  const L = ui.t(), w = root.clientWidth, h = root.clientHeight, now = Date.now() / 1000;
  const all = [...people.values(), ...remote.values(), boss, assistant, hostFigure, ...otherLeads.values()].filter(Boolean);
  for (const p of all) {
    _v.copy(p.head()); _v.y += 0.25; const dist = camera.position.distanceTo(_v); _v.project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2 && !(p === boss && !boss.parts.head.visible) && p.root.visible;
    ui.place(p.name, (_v.x * 0.5 + 0.5) * w, (-_v.y * 0.5 + 0.5) * h, vis, Math.max(0.72, Math.min(1.12, 14 / dist)));
    const pr = DATA.profile(p.name), d = D.per[p.name], bubble = p.bubble && p.bubble.until > now ? p.bubble : null;
    const flags = [];
    let line = '', title = p.name, sub = pr.model, emoji = pr.emoji, pct = null;
    const theirLead = !!p.room && [...otherLeads.values()].includes(p);
    if (theirLead) { emoji = '👓'; title = p.room.lead || title; sub = '🏢 ' + (p.room.title || ''); }
    else if (D.per[p.name]?.neighbor) { title = p.name.split('@')[0]; sub = '🏢 ' + (D.per[p.name].room || ''); }
    // which room's thoughts and messages show: this one, the other, or both (the figures always do)
    const theirs = theirLead || !!D.per[p.name]?.neighbor, ours = !theirs && p !== boss && p !== hostFigure && p.kind !== 'guest';
    const seen = viewScope === 'other' && window.chatroomRoom ? window.chatroomRoom().title.slice(0, 16) : '';   // the other room shown
    const roomOf = theirLead ? (p.room.title || '').slice(0, 16) : (D.per[p.name]?.room || '').slice(0, 16);
    const muted = (viewScope === 'self' && theirs) || (viewScope === 'other' && (ours || (theirs && seen && roomOf !== seen)));
    if (theirLead) {}
    else if (p === hostFigure) { emoji = '👑'; sub = '🌐 ' + L.guest; }
    else if (p === boss) { emoji = visit ? '🚶' : '👑'; sub = L.you; }
    else if (p.kind === 'guest') { emoji = p.remoteEmoji || '🌐'; sub = '🌐 ' + L.guest; }
    else if (p === assistant) { emoji = '👓'; sub = [L.lead, pr.model].filter(Boolean).join(' · '); line = `👀 #${lastSeenN}`; }
    else if (d) {
      const a = d.a, c = cat(a?.tool, a?.target || '');
      pct = d.pct;
      if (a?.waiting) flags.push(['wait', '🙋 ' + L.wait]);
      if (d.tagged && !d.idle) flags.push(['tag', L.tagged]);
      if (d.late) flags.push(['late', '⏰ ' + L.late]);
      if (racks && racks.count(p.name)) flags.push(['proc', '⚙ ' + racks.count(p.name)]);
      const lent = boardData?.tasks?.find(t => t.lender && t.state === 'taken' && t.owner === p.name && t.lender !== p.name);
      if (lent) flags.push(['help', '🤝 ' + lent.lender]);           // a piece lent by a teammate (task help)
      if (d.idle) flags.push(['idle', '💤 ' + L.idle]);
      if (d.vote) flags.push([d.vote === 'yes' ? 'vote-yes' : 'vote-no', `v${D.plan?.v} ${d.vote === 'yes' ? '✓' : '✗'}`]);
      if (c) line = `${EMOJI[c]} ${L[c]}${a.target && !a.target.startsWith('chat:') ? ': ' + a.target : ''}`;
      else if (d.idle) line = `${EMOJI.coffee} ${L.coffee}`;
      else line = `${EMOJI.think} ${L.think}`;
    }
    if (muted) { line = ''; }
    ui.tag(p.name, {title, sub, emoji, color: pr.color, pct, line, flags, bubble: bubble && !muted ? ({status: '📝 ', idle: '💤 ', vote: '🗳 '}[bubble.kind] || '') + String(bubble.text).replace(/\s+/g, ' ').slice(0, bubble.kind === 'status' || bubble.kind === 'idle' ? 90 : 150) : '', bubbleKind: bubble?.kind});
  }
  const work = D.names.filter(n => !D.per[n].idle && !D.per[n].a?.waiting).length, idle = D.names.filter(n => D.per[n].idle).length;
  const pcts = D.names.map(n => D.per[n].pct).filter(x => x !== null);
  const yes = D.names.filter(n => D.per[n].vote === 'yes').length;
  const st = DATA.state, src = st.mod && Date.now() / 1000 - st.mod < 120 ? L.mod : Object.keys(st.agents || {}).length ? L.tail : L.nodata;
  ui.hud({title: `${DATA.config.icon || '💬'} ${DATA.config.title || DATA.config.topic || 'Chat room'}`, pct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
          waiting: D.waiting.size, working: work, idle, plan: D.closed ? `✅ ${L.done} v${D.closed.v}` : D.plan ? `🗳 ${L.plan(D.plan.v)}: ${L.votes(yes, D.names.length - yes)}` : '',
          src: '📡 ' + src, mode, follow, quality, pov, run: running, edit: editor.active(), sens: sensIdx, mute: mixer.muted()});
  // labels the user gave to pieces of furniture, a little above each
  ui.itemLabels(ITEM_MESHES.filter(m => m.userData.label).map(m => {
    _v.copy(m.position); _v.y += 1.25; _v.project(camera);
    return {key: m.uuid, text: m.userData.label, x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, vis: _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1};
  }));
  window.officeOwnsTitle = true;
  badge(DATA.config.title || DATA.config.topic || 'Chat room', D.waiting.size, DATA.config.icon);
}

// ------------------------------------------------------------------ lights: only the nearest few
// Every point light costs every lit pixel, near or not, and the office has about thirty (lamps, the bridge, a beacon
// on each desk, most of them off). Only the LIGHT_POOL nearest that are on stay in the scene, always that many so the
// shaders never change; the others reach 3-8 m and are too far to show anyway.
const LIGHT_POOL = 8;
let pointLights = [], lightsAt = -1, lightsListedAt = -1;
const _lp = new THREE.Vector3();
function nearestLights(t) {
  if (t - lightsListedAt > 3) { lightsListedAt = t; pointLights = []; scene.traverse(o => { if (o.isPointLight) pointLights.push(o); }); }
  if (t - lightsAt < 0.25 || pointLights.length <= LIGHT_POOL) return;
  lightsAt = t;
  const from = pov ? camera.position : controls.target;
  const lit = l => { if (!(l.intensity > 0)) return false; for (let o = l.parent; o; o = o.parent) if (!o.visible) return false; return true; };   // a light in a hidden group (the bridge while not shared) lights nothing
  for (const l of pointLights) { l.getWorldPosition(_lp); l.userData.k = (lit(l) ? 0 : 1e6) + ((_lp.y > 3.7) !== (level === 'arena') ? 1e6 : 0) + _lp.distanceToSquared(from); }
  pointLights.sort((a, b) => a.userData.k - b.userData.k).forEach((l, i) => { l.visible = i < LIGHT_POOL; });
}

// ------------------------------------------------------------------ cinema
// Sitting in front of the lounge TV in first person opens it big in the middle (office-tv.js); standing up closes it;
// closing it while seated keeps it closed until you stand up.
let cineWas = false, cineDismissed = false;
function watchCinema() {
  const want = pov && boss && seated(boss) && loungeTv.near(boss.pos) < 3;
  if (!want) { cineDismissed = false; if (loungeTv.isCinema?.()) loungeTv.cinema(false); }
  else if (!loungeTv.isCinema?.()) { if (cineWas) cineDismissed = true; else if (!cineDismissed) loungeTv.cinema(true); }
  cineWas = !!loungeTv.isCinema?.();
}

// ------------------------------------------------------------------ dynamic resolution
// Smooth before sharp: when frames come slower than about 48 a second while the office moves, draw fewer pixels (down
// to 60% of the quality's own); when they come back fast, give the pixels back. A slow GPU keeps 60 fps, a fast one
// never notices.
let drawnAt = 0, frameEma = 16.7, dynAt = 0, dynDir = 0;
function steerResolution(now) {
  if (speed === 'idle' || document.hidden) { drawnAt = 0; return; }        // 30 fps on purpose, or not on screen: nothing to learn
  if (drawnAt) frameEma += (now - drawnAt - frameEma) * 0.1;
  drawnAt = now;
  if (now - dynAt < 1500) return;
  const next = frameEma > 21 ? Math.max(0.6, dynScale - 0.1) : frameEma < 17.6 ? Math.min(1, dynScale + 0.05) : dynScale;
  if (next === dynScale) return;
  const dir = Math.sign(next - dynScale);
  if (dir !== dynDir && now - dynAt < 6000) return;                       // turning back so soon would see-saw (and each step reallocates the targets)
  dynScale = next; dynAt = now; dynDir = dir; renderer.setPixelRatio(basePr * dynScale); resize();
}

// ------------------------------------------------------------------ loop
const FORCE = /[?&]force\b/.test(location.search);              // keep drawing in a hidden tab (screenshots, tests)
let last = performance.now(), acc = 0, drewAt = 0, hourDrawn = -1, secDrawn = -1, screenAcc = 0, uiAcc = 0, lastInput = 0, shadowAt = 0, speed = 'idle';
for (const ev of ['pointerdown', 'pointermove', 'wheel']) root.addEventListener(ev, () => { lastInput = performance.now(); }, {passive: true, capture: true});
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const startAt = performance.now();
  if (mode === 'chat' || (document.hidden && !FORCE)) { last = now; return; }
  if (boardsStale && DATA.loaded) drawBoards();                             // the boards skipped while nobody could see them
  // how fast to draw: full speed while you use the office (mouse, keys, your figure walking), calmer while agents work, slow when all is idle
  if (editor.active() !== bakedEditing) { bakedEditing = editor.active(); baked.setEditing(bakedEditing); climb = null; }
  const using = now - lastInput < 4000 || tween || flyHome || (pov && !povLocked) || keys.size || boss?.path.length || me.act === 'brew';
  const working = D.names.some(n => D.per[n] && !D.per[n].idle) || P.length > ambient || planes.length || pov;      // the steam never stops: it alone keeps nothing awake
  const covered = games.active() || arcade?.active() || github?.active() || racks?.active();       // a game, the arcade or a panel covers the office (dimmed): it only needs the calm rate, the game gets the GPU
  speed = covered ? 'idle' : using ? 'use' : working ? 'work' : 'idle';
  // smooth first: 60 while you use it or agents work (a 144 Hz screen would only burn the GPU), 30 when nothing moves
  const fps = {use: 60, work: quality === 'bassa' ? 30 : 60, idle: quality === 'bassa' ? 15 : 30}[speed];
  acc += now - last; last = now;
  if (acc < 1000 / fps - 2) return;                                             // 2 ms slack: a 60 cap on a 60 Hz screen must not drop to 30
  // the time left over goes to the next frame (at most one frame's worth): with acc = 0 a 75-165 Hz screen gave 37-55 frames a second, and the
  // resolution steering read those slow frames as a slow GPU
  const dt = Math.min(0.1, (now - (drewAt || now - 1000 / fps)) / 1000); drewAt = now;           // the real time since the last frame drawn
  acc = Math.max(0, Math.min(acc - 1000 / fps, 1000 / fps)); frameT = now / 1000;
  const t = now / 1000, d = new Date(), hour = d.getHours() + d.getMinutes() / 60;
  if (Math.floor(hour * 4) !== hourDrawn) { hourDrawn = Math.floor(hour * 4); drawSky(hour); }
  if (d.getSeconds() !== secDrawn) { secDrawn = d.getSeconds(); drawClock(); }
  for (const p of people.values()) p.update(dt, t);
  for (const p of interns.values()) p.update(dt, t);
  for (const p of remote.values()) { p.update(dt, t); p.root.visible = (p.pos.y > 2.5) === (level === 'arena'); }
  if (hostFigure) { hostFigure.update(dt, t); if ((hostFigure.pos.y > 2.5) !== (level === 'arena')) hostFigure.root.visible = false; }
  for (const p of otherLeads.values()) { p.act = 'read'; p.update(dt, t); }
  if (level === 'arena') { for (const p of people.values()) p.root.visible = false; for (const p of interns.values()) p.root.visible = false; if (assistant) assistant.root.visible = false; for (const p of otherLeads.values()) p.root.visible = false; }     // the people of the office stay down there, tags and all
  if (boss) {
    drive(dt);
    if (pov && povLocked && level !== 'arena') { const r = roomAt(boss.pos.x, boss.pos.z); if (r !== povRoom) { povRoom = r; if (r) ui.placeName(roomName(r)); } }
    hintAcc += dt;
    if (hintAcc > 0.2) { hintAcc = 0; const n = pov && povLocked ? nearby() : atMyDesk() ? {kind: 'desk'} : null; ui.hint(n ? hintText(n) : ''); }
    boss.act = boss.bubble && boss.bubble.until > Date.now() / 1000 ? 'speak' : t < (me.waveUntil || 0) ? 'wave' : me.act;
    boss.speed = running || shiftHeld ? 2 : 1;
    boss.update(dt, t); tendMe(dt, t); checkDoor(); tendCup(t);
  }
  if (assistant) { assistant.act = assistant.bubble && assistant.bubble.until > Date.now() / 1000 ? 'speak' : 'read'; assistant.update(dt, t); }
  screenAcc += dt;
  if (screenAcc > (speed === 'use' ? 1 / 6 : 1 / 3)) {                       // the monitors, only the ones in view
    screenAcc = 0;
    camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    for (const [n, p] of people) { const sc = SPOTS.get(n)?.scr; if (sc && _fr.containsPoint(sc.mesh.getWorldPosition(_sp))) drawScreen(n, p.act, t); }
  }
  for (const s of SPOTS.values()) if (s.beacon.visible) { s.beacon.rotation.y += dt * 6; s.beaconLight.intensity = 1.6 + Math.sin(t * 9) * 1.2; } else s.beaconLight.intensity = 0;
  let ledsChanged = false;                                                    // a LED is red, lit or dark: only a change is uploaded
  for (let i = 0; i < LED_AT.length; i++) {
    const s = LED_AT[i][1] ? 4 : Math.sin(t * (2 + i % 5) + i) > 0.2 ? i % 3 : 3;
    if (ledState[i] === s) continue;
    ledState[i] = s; leds.setColorAt(i, LED_COLORS[s]); ledsChanged = true;
  }
  if (ledsChanged && leds.instanceColor) leds.instanceColor.needsUpdate = true;
  for (const at of STEAM) if (Math.random() < dt * 3) emit(1, at, {color: '#ffffff', speed: 0.1, up: 0.5, life: 1.6, size: 0.05, gravity: 0.25, glow: 0.9, amb: true});
  if (printJob > 0 && Math.random() < dt * 2) { printJob -= 1; emit(1, PAPER, {color: '#ffffff', speed: 0.2, up: 1.5, life: 2, size: 0.18, gravity: -1.5, glow: 1}); }
  stepParticles(dt); stepPlanes(dt);
  cutWalls();
  if (pov || flyHome) flyCamera(dt);
  else {
    if (tween) {
      camera.position.lerp(tween.pos, Math.min(1, dt * 4)); controls.target.lerp(tween.target, Math.min(1, dt * 4));
      if (camera.position.distanceTo(tween.pos) < 0.05) tween = null;
    } else if (follow && selected) {
      const p = people.get(selected); if (p) { const h = p.head().add(new THREE.Vector3(0, -0.6, 0)); const delta = h.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(delta); camera.position.add(delta); }
    }
    controls.update();
  }
  uiAcc += dt;
  if (uiAcc > 0.06) { uiAcc = 0; placeTags(); }
  if (selected && Math.floor(t) !== Math.floor(t - dt)) inspect();
  if (now - shadowAt > (speed === 'use' ? 33 : speed === 'work' ? 66 : 600)) { shadowAt = now; renderer.shadowMap.needsUpdate = true; }   // figures move, the furniture does not: shadows keep up at 30 a second
  watchCinema();
  nearestLights(t);
  camera.updateMatrixWorld(); loungeTv.update(t); radio?.update(t); lofi?.update(t); arcade?.update(t, boss?.pos); github?.update(); racks?.update(); lift?.update(dt, level === 'office' ? boss?.pos : null); paintball.update(dt);
  const drawAt = performance.now();
  if (quality === 'bassa') renderer.render(scene, camera); else composer.render(dt);
  if (FORCE) window.__officeTimes = {logic: drawAt - startAt, draw: performance.now() - drawAt, scale: dynScale};   // measuring: where a frame's time goes
  steerResolution(now);
}

// the dollhouse view: an outer wall drops to its stub when the camera is outside it; in first person (camera below
// the ceiling) every wall stands and the ceiling shows
const _cw = new THREE.Vector3();
function cutWalls() {
  if (level === 'arena') { ceiling.visible = false; return; }
  const inside = pov && camera.position.y < 2.9;
  for (const w of cutaway) { const show = inside || _cw.copy(camera.position).sub(w.mid).dot(w.out) < 0; w.full.visible = show; w.stub.visible = !show; }
  ceiling.visible = inside;
}

// first person: the camera sits in front of the figure's face and looks where the figure faces (plus where the mouse
// turned the head); it flies there first, then stays locked to the eyes. The figure's own head hides once inside it.
const fpCup = V.mug('#f5f5f5');                                            // the cup as you see it in first person
fpCup.position.set(0.2, -0.24, -0.5); fpCup.visible = false; camera.add(fpCup); scene.add(camera);
function tendCup(t) {
  fpCup.visible = !!(pov && povLocked && me.cup?.visible);
  if (!fpCup.visible) return;
  const sip = Math.max(0, Math.sin(((t % 7) / 7) * Math.PI * 2 - 1.2)) ** 3;   // every 7 s, up to the lips
  fpCup.position.set(0.2 - sip * 0.12, -0.24 + sip * 0.16, -0.5 + sip * 0.18); fpCup.rotation.set(sip * 0.9, 0, -sip * 0.2);
}
/** the eye sits 0.32 m ahead of the middle of the head, but the body keeps only 0.2 m from walls and furniture: near a tall piece (a wall, a cabinet,
 *  a counter at eye height) the eye comes back, until it is 0.2 m clear, so the view never goes through it; it goes forward again at 0.8 m/s */
let lead = 0.32;
function eyeLead(dt) {
  climbList();
  const y = boss.pos.y + boss.jumpY + 1.16, fx = Math.sin(boss.rot), fz = Math.cos(boss.rot);
  const hit = d => { const x = boss.pos.x + fx * d, z = boss.pos.z + fz * d; return fN().blocked(x, z, 0.2) || (level !== 'arena' && [climb, small].some(l => l.some(e => e.top > y - 0.2 && e.y0 < y + 0.2 && x > e.x0 - 0.2 && x < e.x1 + 0.2 && z > e.z0 - 0.2 && z < e.z1 + 0.2))); };
  let want = 0.32;
  while (want > 0 && hit(want)) want -= 0.04;
  return lead = want < lead ? Math.max(want, 0) : Math.min(want, lead + dt * 0.8);
}
function flyCamera(dt) {
  let pos = HOME.pos, look = HOME.target, fov = 30;
  if (pov && boss) {
    boss.root.updateMatrixWorld(true);
    pos = boss.parts.head.localToWorld(_eye.set(0, 0.26, eyeLead(dt)));
    const dr = wrapAng(boss.rot - povRot); povRot = boss.rot;                    // the body turned by itself (walking to a seat, sitting): the view keeps pointing where it was
    if (dr) me.yaw = wrapAng(me.yaw - dr);
    const yaw = boss.rot + me.yaw, c = Math.cos(me.pitch);
    look = _look.set(Math.sin(yaw) * c, Math.sin(me.pitch), Math.cos(yaw) * c).add(pos);
    fov = 68 * (paintball?.zoomFactor?.() ?? 1);                                   // the sniper's zoom
    if (watching) { look = _look.copy(watching.mesh.position); fov = 38; }
  }
  // in first person the view is the mouse, with no smoothing at all (a smoothed look lags, and takes the short way round when you turn far and fast);
  // only looking closely at a board, and coming back from it, glides
  if (watching) watchEnd = performance.now();
  const gliding = !povLocked || watching || performance.now() - watchEnd < 700, k = povLocked ? 1 : Math.min(1, dt * 3), kl = gliding ? (povLocked ? Math.min(1, dt * 7) : k) : 1;
  camera.position.lerp(pos, k); povLook.lerp(look, kl); camera.lookAt(povLook);
  camera.fov = lerp(camera.fov, fov, povLocked ? Math.min(1, dt * 12) : k); camera.updateProjectionMatrix();
  if (pov && boss && camera.position.distanceTo(pos) < 0.03) povLocked = true;
  if (boss) boss.parts.head.visible = !pov || camera.position.distanceTo(pos) > 0.8;
  if (!pov && camera.position.distanceTo(HOME.pos) < 0.05) {
    flyHome = false; camera.fov = 30; camera.updateProjectionMatrix(); controls.target.copy(HOME.target); controls.enabled = true;
  }
}

if (FORCE) window.__officeStep = t => frame(t ?? performance.now());
if (FORCE) Object.assign(window, {                                        // tests: walk by script, see who is where
  __officeWalk: (x, z) => goToPoint(new THREE.Vector3(x, 0, z)),
  __officeMe: () => boss && {x: boss.pos.x, y: boss.pos.y, jumpY: boss.jumpY, z: boss.pos.z, pose: boss.pose, path: boss.path.length, speed: boss.speed},
  __officeVault: () => tryVault(), __officeRt: () => rt,
  __officeClimb: (x, z) => ({climb: climbList().length, small: small.length, top: climbTop(x, z, 99), floorN: floorN.blocked(x, z, 0.1), floor: blocked(x, z), smallB: smallBlocks(x, z, 0.71), pose: boss.pose, path: boss.path.length, rot: boss.rot, pov}),
  __officeKey: (k, on) => { if (on) keys.add(k); else keys.delete(k); },
  __officeJump: () => boss.jump() && jumpSeq++,
  __officeTele: (x, z, rot = 0) => { boss.pos.set(x, 0, z); boss.pose = 'stand'; boss.rot = rot; povRot = rot; me.yaw = 0; boss.path = []; boss.jumpY = 0; boss.jumpV = 0; boss.jumps = 0; boss.spot = {pos: boss.pos.clone(), rot, pose: 'stand'}; },
  __officeOthers: () => [...remote.values(), hostFigure].filter(Boolean).map(p => ({name: p.name, x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), pose: p.pose, follow: !!p.follow})),
  __officeSeats: () => sitSpots().length,
  __officeCam: (x, y, z, tx, ty, tz) => { tween = null; camera.position.set(x, y, z); controls.target.set(tx, ty, tz); controls.update(); },
  __officeBrew: () => brew(),
  __officePoll: () => pollCommon(),
  __officeReport: r => reportResult(r),
  __officeArcade: () => arcade, __officeGithub: () => github, __officeRacks: () => racks,
  __officeLevel: () => ({level, y: boss.pos.y, lvl: boss.lvl || 0, arena: !!arena, lift: !!lift}), __officeArena: () => arena,
  __officeAgents: () => [...people].map(([name, q]) => ({name, x: +q.pos.x.toFixed(2), z: +q.pos.z.toFixed(2), pose: q.pose, act: q.act, walking: q.path.length, visit: q.visit ? {until: q.visit.until, act: q.visit.act} : null})),
  __officeView: () => { const d = camera.getWorldDirection(new THREE.Vector3()); return {pov, locked: povLocked, rot: boss.rot, yaw: me.yaw, pitch: me.pitch, faceRot: boss.faceRot, pose: boss.pose, path: boss.path.length, seated: seated(boss), camYaw: Math.atan2(d.x, d.z), camPitch: Math.asin(d.y)}; },
  __officeOpen: k => openGame(k), __officePaintball: () => paintball,
  __officeScene: scene, __officeRenderer: renderer, __officeMeta: () => ({quality, speed, mode, pov, people: people.size, machine: MACHINE.toArray(), brew: [BREW.pos.x, BREW.pos.z]}),   // measuring: draw calls, who owns them
  __officeFreeDesk: () => { const d = DESKS.find(d => !d.owner); return d && {x: d.seat.pos.x, z: d.seat.pos.z}; },
  __officeSync: async () => { await pollCommon(); const r = await fetch('presence.json', {cache: 'no-store'}); presence = await r.json(); placeOthers(); },
});                 // tests: step the loop by hand in a hidden tab

// ------------------------------------------------------------------ start
ui.setLang(DATA.config.lang);
if (visit) ui.visitBanner(ui.t().visiting(visit.host), () => leaveBy(''));
window.addEventListener('chatroom:data', () => ui.setLang(DATA.config.lang));
// the lounge TV: the first TV on a stand, its remote on the low table nearest to it
const itemOf = m => (LAYOUT.items || [])[m.userData.src];
const tvMesh = ITEM_MESHES.find(m => itemOf(m)?.type === 'tvStand');
const tvTable = tvMesh && ITEM_MESHES.filter(m => itemOf(m)?.type === 'lowTable').sort((a, b) => a.position.distanceTo(tvMesh.position) - b.position.distanceTo(tvMesh.position))[0];
// the TV and the radio sound full in their floor zone (the lounge, the games corner) and fade, from their side, outside it
const grow = z => z && {x0: z.x0 - 0.3, z0: z.z0 - 0.3, x1: z.x1 + 0.3, z1: z.z1 + 0.3};
const zoneAt = p => p && grow(LAYOUT.floor.zones.findLast(z => p.x >= z.x0 && p.x <= z.x1 && p.z >= z.z0 && p.z <= z.z1));
const FAR = {x: 1e4, y: 0, z: 1e4};
const ear = () => level === 'arena' ? FAR : boss?.pos;
const loungeTv = createTV({THREE, scene, camera, renderer, root, tvMesh, table: tvTable, raycastables, say: t => ui.placeName(t), t: ui.t, linked,
  ear, area: zoneAt((tvTable || tvMesh)?.position),
  onTogether: g => post('common/post', {text: `📺 ${commonState?.me || D.user} ${g.op === 'pause' ? '⏸' : g.op === 'seek' ? '⏩ ' + Math.floor(g.pos / 60) + ':' + String(Math.floor(g.pos % 60)).padStart(2, '0') : ui.t().tvPuts + ': ' + (g.title || g.v)}`,
                                       game: {type: 'tv', id: Math.random().toString(16).slice(2, 10), ...g}})});
const gameZone = LAYOUT.floor.zones.find(z => z.kind === 'game');
const radio = gameZone && createRadio({THREE, scene, camera, root, raycastables, say: t => ui.placeName(t), t: ui.t, ear,
  spot: {x: gameZone.x0 + 0.4, z: gameZone.z1 - 1.9}, rot: Math.PI / 2, area: grow(gameZone)});
// lofi from two speakers on the common room's back wall, right of the bridge door
const commonZone = LAYOUT.floor.zones.find(z => z.kind === 'common');
const lofi = commonZone && createLofi({THREE, scene, camera, raycastables, say: t => ui.placeName(t), t: ui.t, ear, Vox: V.Vox, mesh: V.mesh,
  area: grow(commonZone), spots: [{x: commonZone.x0 + 5.4, z: commonZone.z1 - 0.28, rot: Math.PI}, {x: commonZone.x0 + 6.6, z: commonZone.z1 - 0.28, rot: Math.PI}]});
if (FORCE) Object.assign(window, {__officeTv: loungeTv, __officeRadio: radio, __officeLofi: lofi});
let lastTvN = null;
/** a friend chose a video to watch together: our TV plays it from the same second */
function tvFromFriends() {
  const lines = (commonState?.games || []).filter(m => m.game?.type === 'tv'), top = lines.length ? lines[lines.length - 1].n : 0;
  if (lastTvN === null) {
    lastTvN = top;
    const last = lines[lines.length - 1];
    if (last && Date.now() / 1000 - (last.game.at || last.game.t || 0) < 6 * 3600) loungeTv.together(last.game, last.from);
    return;
  }
  for (const m of lines) if (m.n > lastTvN && m.from !== commonState.me) loungeTv.together(m.game, m.from);
  lastTvN = Math.max(lastTvN, top);
}

// ------------------------------------------------------------------ the games corner: ping pong, foosball and pool tables
// E next to a table in first person, or a click on it, opens its game (office-games.js). Pool with a friend goes through
// the common room: a shot line carries where every ball ended, replayGames (office-ui.js) keeps the accepted ones.
const myName = () => commonState?.me || D.user;
const games = createGames({root, t: ui.t, me: myName, onResult: reportResult,
  sendShot: (id, s) => post('common/post', {text: `🎱 ${myName()} ${ui.t().poolShot}`, game: {type: 'pool', op: 'shot', id, ...s}}).then(() => pollCommon())});
/** the arcade cabinet of the common room (office-arcade.js): a click on it, E next to it, or Altro > Arcade opens the player; the scores of a game go to the leaderboards */
/** the arcade's games for two: an invitation is a line of the common room (like a pool table); the buttons go over the real-time channel (office-arcade-net.js) */
const NES_NET = pref('nesnet', true) !== false;                                  // games for two in the arcade (office-arcade-net.js); localStorage chatroom.office.nesnet = false switches the buttons off
const nesNet = {
  state: () => {
    const me = myName(), all = replayGames(commonState?.games || []).games.filter(x => x.type === 'nes' && !x.done), mine = all.find(x => x.players.includes(me));
    return {linked: NES_NET && linked(), friend: friendName(), mine, invites: mine ? [] : all.filter(x => x.players.length === 1)};
  },
  invite: async (rom, sha) => { await post('common/post', {text: `🕹 ${myName()} · 9999 IN 1: ${rom}`, game: {type: 'nes', op: 'new', id: resultId(), rom, sha: sha || ''}}); pollCommon(); },
  join: async id => { await post('common/post', {text: `🕹 ${myName()} ✓`, game: {type: 'nes', op: 'join', id}}); pollCommon(); },
  quit: async id => { await post('common/post', {text: `🕹 ${myName()} ✗`, game: {type: 'nes', op: 'quit', id}}); pollCommon(); },
  send: (id, m) => rt.send({g: id, ...m}),
  on: (id, fn) => rt.on((m, from) => { if (m.g === id) fn(m, from); }),
};
const nesSeen = new Set();
/** a friend opened a game for two: a chime and a line, whether or not the arcade is open */
function arcadeInvites() {
  if (!arcade) return;
  for (const g of nesNet.state().invites) {
    if (nesSeen.has(g.id)) continue;
    nesSeen.add(g.id);
    const text = ui.t().arcadeInvite(g.players[0], String(g.rom).replace(/-/g, ' '));
    chime(); ui.placeName(text); notify('nes' + g.id, '🕹 ' + g.players[0], text, true, () => arcade.open());
  }
}
const arcade = ARC_ON ? createArcade({THREE, scene, camera, raycastables, root, Vox: V.Vox, mesh: V.mesh, lang: () => DATA.config.lang, say: t => ui.placeName(t), report: reportResult, me: myName, net: nesNet,
                                      unlock: unlockAudio, volume: () => mixLevel('arcade'), onOpen: () => document.exitPointerLock?.()}) : null;
if (arcade) ui.addExtra('arcade', '🕹', 'Arcade', () => arcade.open());
racks = visit ? null : createRacks({THREE, V, root, raycastables, lang: () => DATA.config.lang,
                                    tail: (name, id) => fetch(`procs.json?name=${encodeURIComponent(name)}&id=${encodeURIComponent(id)}&n=14`, {cache: 'no-store'}).then(r => r.json())});
if (!visit) github = createGithubWall({board: ghBoard, frame: ghFrame, raycastables, root, lang: () => DATA.config.lang, paused: officeUnseen, onEnabled: () => ui.addExtra('github', '🐙', 'GitHub', () => github.open())});
const GAME_TABLES = ITEM_MESHES.filter(m => CATALOG[itemOf(m)?.type]?.game).map(m => {
  const type = itemOf(m).type, [w, d] = CATALOG[type].foot, c = Math.cos(m.rotation.y), s = Math.sin(m.rotation.y);
  m.userData.game = type; raycastables.push(m);
  /** metres from a point on the floor to the table's edge (0 on top of it) */
  const near = p => { const x = p.x - m.position.x, z = p.z - m.position.z; return Math.hypot(Math.max(Math.abs(x * c - z * s) - w / 2, 0), Math.max(Math.abs(x * s + z * c) - d / 2, 0)); };
  return {type, near};
});
/** the real-time channel for a match: rt.send(msg) goes to the friend's side in about half a round trip of the tunnel, rt.on(fn) gets (msg, from) for everything the others
 *  send (the first request only notes where we are: what was said before is not replayed); the listener is removed by the function on() returns */
const rt = (() => {
  const handlers = new Set();
  let running = false, n = null;
  async function loop() {
    running = true;
    while (handlers.size) {
      try {
        const r = await fetch(`rt/poll?since=${n ?? 0}&wait=${n === null ? 0 : 0.2}`, {cache: 'no-store'});
        if (!r.ok) throw new Error('rt');
        const j = await r.json(), first = n === null;
        n = j.n;
        if (!first) for (const it of j.items) for (const h of [...handlers]) h(it.m, it.from);
      } catch (e) { await new Promise(done => setTimeout(done, 500)); }
    }
    running = false; n = null;
  }
  return {
    send: m => { fetch('rt/post', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(m)}).catch(() => {}); },
    on(h) { handlers.add(h); if (!running) loop(); return () => handlers.delete(h); },
  };
})();
/** the end of a game, for the leaderboards: one line in the common room that every board counts once. A match against a friend is reported by its winner
 *  (for both players), a draw by whoever opened the game, a game against the computer and a run for a score by the player. r: {game, win, draw, mine, theirs, friend} or {game, score, extra} */
const resultId = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0');
function reportResult(r) {
  const L = ui.t(), me = myName(), clampN = (v, hi) => Math.max(0, Math.min(hi, Math.round(+v || 0)));
  const label = {pool: L.pool, pingpong: 'Ping pong', foos: L.foosball, tris: L.tris, morra: L.morra, zombie: 'Zombie', paintball: 'Paintball'}[r.game] || String(r.game).replace(/^arc-/, '');
  let text, game;
  if (r.score !== undefined) {
    text = `🏆 ${me} · ${label}: ${clampN(r.score, 1e9)}${r.extra ? ' · ' + clampN(r.extra, 1e6) : ''}`;
    game = {type: 'result', op: 'add', id: resultId(), g: r.game, score: clampN(r.score, 1e9), ...(r.extra ? {extra: clampN(r.extra, 1e6)} : {})};
  } else {
    if (r.friend && !r.win && !r.draw) return;
    text = `🏆 ${me} · ${label}: ${clampN(r.mine, 1000)}–${clampN(r.theirs, 1000)}${r.friend ? ' · ' + r.friend : ''}`;
    game = {type: 'result', op: 'add', id: resultId(), g: r.game, win: r.draw ? -1 : r.win ? 1 : 0, opp: r.friend || '', pts: [clampN(r.mine, 1000), clampN(r.theirs, 1000)]};
  }
  post('common/post', {text, game}).then(() => pollCommon());
}
const poolPoints = (x, p) => {                                              // the balls of its group a player potted, minus the fouls
  const g = x.groups[x.players.indexOf(p)], list = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : g === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
  return Math.max(0, list.length - list.filter(n => x.balls[n]).length - x.shots.filter(sh => sh.by === p && sh.fl).length);
};
/** games of the common room (tris, morra, pool) that just ended with me in them: the winner reports. The games already over when this first runs are not counted. */
function reportFinished() {
  const s = commonState, me = myName();
  if (!s || !s.games || !me) return;
  const done = replayGames(s.games).games.filter(x => x.done && x.players.length === 2 && x.players.includes(me) && ['tris', 'morra', 'pool'].includes(x.type));
  const seen = new Set(pref('reported', [])), fresh = done.filter(x => !seen.has(x.id)), first = !pref('reportedInit', false);
  if (!fresh.length) { if (first) setPref('reportedInit', true); return; }
  for (const x of fresh) {
    seen.add(x.id);
    if (first) continue;
    const played = x.type === 'pool' ? x.shots.length > 0 : x.type === 'tris' ? x.board.some(Boolean) : Object.keys(x.commits).length > 0;
    const won = x.done.winner === me, draw = !!x.done.draw, opp = x.players.find(p => p !== me);
    if (!played || !(won || (draw && x.players[0] === me))) continue;
    const mine = x.type === 'pool' ? poolPoints(x, me) : won ? 1 : 0, theirs = x.type === 'pool' ? poolPoints(x, opp) : won ? 0 : draw ? 0 : 1;
    reportResult({game: x.type, win: won, draw, mine, theirs, friend: opp});
  }
  setPref('reportedInit', true); setPref('reported', [...seen].slice(-300));
}
const myGameOf = type => replayGames(commonState?.games || []).games.find(x => x.type === type && !x.done && x.players.includes(myName()));
const myPool = () => myGameOf('pool');
/** the friend a table waits for: the guest of our shared room, or the host whose room we joined */
const friendName = () => commonState?.bridge?.joined ? commonState.bridge.host : commonState?.share?.guests?.[0]?.name || null;
/** a table with a friend: open with both players, or waiting for the friend (one player); it turns into the game by itself when the friend comes in */
function openPoolTable(g) {
  games.openPool(g, {friend: friendName(), cancel: () => post('common/post', {text: `🎱 ${myName()} ${ui.t().quits}`, game: {type: 'pool', op: 'quit', id: g.id}}).then(() => pollCommon())});
}
/** ping pong or foosball with a friend: the table waits for the friend, then the match runs on the real-time channel (office-games.js) */
function openNetTable(g) {
  games.openNet(g, {friend: friendName(), cancel: () => post('common/post', {text: `🎮 ${myName()} ${ui.t().quits}`, game: {type: g.type, op: 'quit', id: g.id}}).then(() => pollCommon()),
                    send: m => rt.send({g: g.id, ...m}), on: fn => rt.on((m, from) => { if (m.g === g.id) fn(m, from); })});
}
const openGameTable = g => g.type === 'pool' ? openPoolTable(g) : openNetTable(g);
/** my game of a kind as soon as its line is back: from a guest it goes out and returns through the host, a few seconds at most */
async function openMyGame(type, before = null) {                           // before: the game I had, which the new one must replace (not that table again)
  for (let i = 0; i < 16; i++) {
    await pollCommon();
    const g = myGameOf(type);
    if (g && g.id !== before) return openGameTable(g);
    await new Promise(done => setTimeout(done, 400));
  }
  ui.roomTip(ui.t().poolLate, 20, 120);
}
const openMyPool = before => openMyGame('pool', before);
/** the menu of a ping pong or foosball table: against the computer, or live with a friend */
function matchMenu(kind) {
  const me = myName(), all = replayGames(commonState?.games || []).games, mine = myGameOf(kind);
  const busyOther = all.some(x => !x.done && x.type !== kind && x.players.length === 2 && x.players.includes(me));
  const join = !mine && !busyOther && all.find(x => x.type === kind && !x.done && x.players.length === 1 && x.players[0] !== me);
  const act = async op => {
    if (op === 'open') return openNetTable(mine);
    const r = await post('common/post', {text: `🎮 ${me} ${op === 'new' ? ui.t().poolOpens : ui.t().poolJoins}`, game: {type: kind, op, id: op === 'join' ? join.id : Math.random().toString(16).slice(2, 10)}});
    if (r && !r.ok) return ui.roomTip(await r.text(), 20, 120);
    return openMyGame(kind, mine?.id);
  };
  games.poolMenu({kind, friends: linked() && !busyOther, open: mine?.players.length === 2 ? mine.players.find(p => p !== me) : null, waiting: mine?.players.length === 1, restart: false,
                  friend: friendName(), join: join ? join.players[0] : null, start: k => act(k === 'join' ? 'join' : k === 'new' ? 'new' : 'open')});
}
function openGame(type) {
  if (type === 'pingPong') return matchMenu('pingpong');
  if (type === 'foosball') return matchMenu('foos');
  const me = myName(), all = replayGames(commonState?.games || []).games, mine = myPool();
  const busyOther = all.some(x => !x.done && x.type !== 'pool' && x.players.length === 2 && x.players.includes(me));
  const join = !mine && !busyOther && all.find(x => x.type === 'pool' && !x.done && x.players.length === 1 && x.players[0] !== me);
  const act = async op => {
    if (op === 'open') return openPoolTable(mine);
    const r = await post('common/post', {text: `🎱 ${me} ${op === 'new' ? ui.t().poolOpens : ui.t().poolJoins}`, game: {type: 'pool', op, id: op === 'join' ? join.id : Math.random().toString(16).slice(2, 10)}});
    if (r && !r.ok) return ui.roomTip(await r.text(), 20, 120);
    return openMyPool(mine?.id);
  };
  games.poolMenu({friends: linked() && !busyOther, open: mine?.players.length === 2 ? mine.players.find(p => p !== me) : null, waiting: mine?.players.length === 1, restart: mine?.players.length === 2 && !mine.shots.length,
                  friend: friendName(), join: join ? join.players[0] : null,           // join is false (not undefined) when I already have a game: join?.players[0] threw and the table did nothing
                  start: k => act(k === 'join' ? 'join' : k === 'new' ? 'new' : 'open')});
}
let poolSeen = 0;
/** a friend shot at an open pool table: it plays the shot out (only the shots the replay accepted); a table that waited for the friend becomes the game */
function poolFromFriends() {
  let top = poolSeen;
  const all = replayGames(commonState?.games || []).games;
  for (const x of all) if (x.type === 'pool') for (const s of x.shots) {
    if (s.n > poolSeen && s.by !== myName()) games.shot(x.id, s);
    top = Math.max(top, s.n);
  }
  poolSeen = top;
  const oid = games.openId(), og = oid && all.find(x => x.id === oid);
  if (og?.done?.quit && og.done.quit !== myName()) { games.close(); ui.placeName(ui.t().quitBy(og.done.quit)); }     // the friend left the table
  const wid = games.waitingId(), g = wid && all.find(x => x.id === wid);
  if (g && !g.done && g.players.length === 2) { openGameTable(g); ui.placeName(ui.t().poolStarts); }
}
// fewer draw calls: the furniture, the desks' fixed pieces and the city are baked into a few big meshes while you look at them
// (the editor sees the originals and bakes again when it closes)
const baked = mergeStatic({THREE, scene, items: ITEM_MESHES, extra: () => [...DESKS.map(d => d.g), city, ...(signs ? [signs.group] : [])],
                           skip: o => !!o.userData.person || !!(o.parent?.userData.kit && !o.parent.userData.kit.has(o))});
let bakedEditing = false;
// ------------------------------------------------------------------ the arena (office-arena.js): the floor above, where the paintball and zombie modes are played
const arena = createArena({THREE, scene, lamps}), lift = LIFT_ON ? createElevator({THREE, scene, raycastables}) : null;
const veil = document.createElement('div');                                  // a black veil that clears in half a second: going up and coming down
veil.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40';
root.appendChild(veil);
let hiddenUp = [], cameFrom = null;
const myTeam = () => V.hashName(myName()) % 2 ? 'B' : 'A';
/** put your figure (and the camera, at once) on a place: no flight from the overview */
function putBoss(x, z, rot, lvl) {
  boss.pos.set(x, 0, z); boss.pose = 'stand'; boss.rot = rot; povRot = rot; me.yaw = 0; me.act = 'idle'; boss.path = []; boss.jumpY = 0; boss.jumpV = 0; boss.jumps = 0; boss.vaulting = 0; boss.faceRot = null;
  boss.lvl = lvl; boss.spot = {pos: boss.pos.clone(), rot, pose: 'stand'}; vault = null; watching = null; keys.clear(); me.then = null;
  boss.root.position.set(x, lvl, z); boss.root.rotation.y = rot; boss.root.updateMatrixWorld(true);
  if (pov) { const eye = boss.parts.head.localToWorld(_eye.set(0, 0.26, 0.32)); camera.position.copy(eye); povLook.copy(eye).add(_look.set(Math.sin(rot), -0.08, Math.cos(rot))); camera.lookAt(povLook); povLocked = false; }
}
/** up to the arena or back to the office: the veil, the other level hidden (it costs nothing), the figure on its place */
function setLevel(next) {
  if (next === level || !boss) return;
  lightsAt = -1e9;                                                            // the pool of lights for the new floor before the first frame there, not a quarter of a second later
  veil.style.transition = 'none'; veil.style.opacity = '1'; void veil.offsetWidth; veil.style.transition = 'opacity .55s'; setTimeout(() => { veil.style.opacity = '0'; }, 80);
  if (next === 'arena') {
    cameFrom = {x: boss.pos.x, z: boss.pos.z, rot: boss.rot};
    const keep = new Set([boss.root, hostFigure?.root, arena.group, camera, ...[...remote.values()].map(q => q.root)]);
    hiddenUp = scene.children.filter(o => o.visible && !o.isLight && !keep.has(o) && !o.userData.noShot);
    for (const o of hiddenUp) o.visible = false;                                // the office, below: its meshes, its people (the paint and the zombies stay)
    level = 'arena'; arena.show(true); ceiling.visible = false;
    const s = arena.spawn(myTeam(), V.hashName(myName()) % 3); putBoss(s.x, s.z, s.rot, ARENA_Y); ui.placeName((ARENA_TEXT[DATA.config.lang] || ARENA_TEXT.en).name);
  } else {
    level = 'office'; arena.show(false);
    for (const o of hiddenUp) o.visible = true;
    hiddenUp = [];
    for (const p of [...people.values(), ...interns.values(), assistant, ...otherLeads.values()]) if (p) p.root.visible = true;
    const f = cameFrom || {x: ELEVATOR_AT.out.x, z: ELEVATOR_AT.out.z, rot: ELEVATOR_AT.out.rot}; cameFrom = null;
    putBoss(f.x, f.z, f.rot, 0);
  }
}
/** after a death in the arena: back to a base */
function arenaRespawn() { if (level !== 'arena') return; const s = arena.spawn(myTeam(), (V.hashName(myName()) + deathsHere++) % 3); putBoss(s.x, s.z, s.rot, ARENA_Y); }
let deathsHere = 0;
/** the lift of the office: a choice of what to play, then up */
function liftMenu() {
  document.exitPointerLock?.();
  const T = ARENA_TEXT[DATA.config.lang] || ARENA_TEXT.en;
  ui.palette([{icon: '🔫', name: 'paintball', label: T.paintball}, {icon: '🧟', name: 'zombie', label: T.zombie}], c => { ui.palette(null); if (c.name === 'zombie') paintball.zombies(true); else paintball.toggle(true); });
}
/** what the paintball asks of the floor: the one under it now */
const arenaFloor = {blocked: (x, z, r) => (level === 'arena' ? arena.world.floorAll : FLOOR).blocked(x, z, r), route: (a, b) => (level === 'arena' ? arena.world.floorAll : FLOOR).route(a, b)};
// ------------------------------------------------------------------ paintball and zombies (office-paintball.js), switched on from the "Altro" menu
const drawTarget = () => quality === 'bassa' ? null : composer.readBuffer;      // what the scene is drawn into (shaders differ per target)
paintball = createPaintball({THREE, scene, camera, canvas: renderer.domElement, root, rt, aim: locked, report: reportResult,
  level: () => level === 'arena' ? ARENA_Y : 0, onMode: on => setLevel(on ? 'arena' : 'office'), respawn: arenaRespawn, pov: () => pov && povLocked, me: myName, lang: () => DATA.config.lang,
  players: () => new Map([...remote].filter(([, f]) => f.root.visible).map(([n, f]) => [n, f.root]).concat(hostFigure?.root.visible ? [[hostFigure.name, hostFigure.root]] : [])),
  sink: pb => { myPb = pb; }, say: t => ui.placeName(t), body: () => boss && {x: boss.pos.x, y: boss.pos.y + (boss.jumpY || 0), z: boss.pos.z}, floor: arenaFloor, size: LAYOUT.size || [30, 20], enterPov: () => { if (!pov) setPov(true); }, renderer, drawTarget, atmosphere: {hemi, sun, lamps}});
/** the shaders of the arena and of the zombie fog, built while nobody looks: going up the first time (the lights go from 7 to 8, so
 *  every shader changes) and the first wave (the fog changes them again) froze the picture for a second and a half. One sync block per
 *  state, as setLevel would leave the scene; nothing is drawn in between, and the programs link in the background. */
async function prewarm() {
  if (visit || !boss || !renderer.compileAsync || level !== 'office' || paintball.active()) return;
  const jobs = [];
  for (const fog of [false, true]) {
    const keep = new Set([boss.root, hostFigure?.root, arena.group, camera, ...[...remote.values()].map(q => q.root)]);
    const hide = scene.children.filter(o => o.visible && !o.isLight && !keep.has(o) && !o.userData.noShot);
    for (const o of hide) o.visible = false;
    arena.show(true); level = 'arena'; lightsAt = lightsListedAt = -1e9; nearestLights(frameT);
    const undo = paintball.warm(fog);
    renderer.setRenderTarget(drawTarget());
    try { jobs.push(renderer.compileAsync(scene, camera)); }
    finally { renderer.setRenderTarget(null); undo(); arena.show(false); level = 'office'; for (const o of hide) o.visible = true; lightsAt = lightsListedAt = -1e9; nearestLights(frameT); }
  }
  await Promise.all(jobs);
}
ui.addExtra('paintball', '🔫', 'Paintball', () => paintball.toggle());
ui.addExtra('zombie', '🧟', 'Zombie', () => paintball.zombies());
applyMode(); applyQuality();
drawSky(new Date().getHours()); drawClock();
pollState();
if (window.chatroom?.snapshot) { const s = window.chatroom.snapshot(); DATA.all = s.all; DATA.config = s.config; DATA.loaded = true; derive(); }
requestAnimationFrame(frame);
setTimeout(() => prewarm().catch(() => {}), 4000);
