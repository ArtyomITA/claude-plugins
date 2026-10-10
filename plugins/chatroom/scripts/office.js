// The 3D voxel office of the chatroom viewer. One desk per agent; the user sits in the boss chair, and the lead
// (the session that opened the room) is the assistant with glasses beside the boss, who reads every chat message.
// What each figure does comes from the chat (statuses, idle, plans, votes, tags) and from /state.json (the tool
// each agent is running, permissions it waits for, its context), fed by the chatroom mod or the transcripts.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as V from './office-voxel.js';
import {createUI, EMOJI, unlockAudio, chime, notify, unnotify, badge} from './office-ui.js';

const pref = (k, d) => { try { const v = localStorage.getItem('chatroom.office.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('chatroom.office.' + k, JSON.stringify(v)); } catch (e) {} };
const lerp = (a, b, k) => a + (b - a) * k;
const angLerp = (a, b, k) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
const PCT = /(\d{1,3})\s?%/g, PLAN = /^\s*(PLAN|PIANO)\s*v(\d+)/i, CLOSED = /^\s*(CLOSED|CHIUSO)\s*v?(\d+)?/i;
const VOTE = /(VOTE|VOTO)\s*v?(\d+)\s*:\s*(yes|no|sì|si)/i, EVERY = /(^|[^\w@])@(all|tutti|everyone)\b/i;

// ------------------------------------------------------------------ renderer, scene, camera
const root = document.getElementById('office') || document.body.appendChild(Object.assign(document.createElement('div'), {id: 'office'}));
document.body.classList.add('has-office');
const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
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
const HOME = {pos: new THREE.Vector3(1.0, 19.5, 22.5), target: new THREE.Vector3(0, 0.2, 0.3)};
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
Object.assign(controls, {enableDamping: true, dampingFactor: 0.08, minDistance: 6, maxDistance: 42, minPolarAngle: 0.3,
                         maxPolarAngle: 1.3, minAzimuthAngle: -1.3, maxAzimuthAngle: 1.3, screenSpacePanning: true});

const hemi = new THREE.HemisphereLight('#fff3df', '#5b4632', 0.9);
const sun = new THREE.DirectionalLight('#ffe8c4', 2.1);
sun.position.set(-13, 15, 7); sun.castShadow = true;
Object.assign(sun.shadow.camera, {left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 50});
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 1.5;
scene.add(hemi, sun);
const lamps = [];
for (const [x, z, model] of [[-7.45, -1.3, true], [4.3, -5.45, true], [6.0, 4.1, false], [-6.0, 4.3, false]]) {
  if (model) { const g = V.floorLamp(); g.position.set(x, 0, z); scene.add(g); }
  const l = new THREE.PointLight('#ffcf8a', 1, 7, 1.6); l.position.set(x, model ? 1.85 : 2.5, z); scene.add(l); lamps.push(l);
}

// ------------------------------------------------------------------ quality and post-processing
// sharp: 4x MSAA in the composer's own target (the canvas antialias does not reach post-processing), rendering
// above the screen resolution on high, crisp shadows, and no blur pass at all
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: 4}));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.25, 0.97);
composer.addPass(bloom); composer.addPass(new OutputPass());
const QUALITY = ['alta', 'media', 'bassa'];
let quality = pref('quality', 'alta');
function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(quality === 'alta' ? Math.min(2, Math.max(1.5, dpr)) : quality === 'media' ? Math.min(dpr, 1.25) : 1);
  renderer.shadowMap.enabled = quality !== 'bassa';
  sun.shadow.mapSize.setScalar(quality === 'alta' ? 4096 : 2048);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
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

// ------------------------------------------------------------------ the room
// Plan (x right, z toward the camera): open space with pods of four desks in the middle; the boss's glass office
// in the back right corner, the assistant's desk outside its door; a glass meeting room front right; kitchen
// front left and a lounge under the left windows; server rack and printer back left.
const BOSS_ROOM = {x0: 3.8, z1: -2.6}, MEET_ROOM = {x0: 3.8, z0: 2.2}, CORRIDOR = 1.9;
scene.add(V.zoneFloor(32, 24, (i, j) => {
  if (i >= 24 && j <= 6) return j % 2 ? '#a87443' : '#9c6a3d';                          // boss office: parquet
  if (i >= 24 && j >= 17) return j % 2 ? '#b98b5f' : '#ad7f53';                         // meeting room: parquet
  if (i <= 6 && j >= 17) return (i + j) % 2 ? '#e3dfd6' : '#d6d1c6';                    // kitchen: tiles
  if (i >= 1 && i <= 5 && j >= 9 && j <= 14) return i === 1 || i === 5 || j === 9 || j === 14 ? '#574a5e' : '#6b5b73';  // lounge rug
  return (Math.floor(i / 2) + Math.floor(j / 2)) % 2 ? '#5b626d' : '#555c67';            // carpet tiles
}));
const back = V.blindWall(64, 12); back.position.set(-8, 0, -6); scene.add(back);
const left = V.blindWall(48, 12, [[20, 29], [34, 43]]); left.position.set(-8, 0, 6); left.rotation.y = Math.PI / 2; scene.add(left);

const sky = board(30, 9, 512); sky.mat.color.setScalar(0.72); sky.mesh.position.set(-15, 1.9, 0); sky.mesh.rotation.y = Math.PI / 2; scene.add(sky.mesh);
const city = new THREE.Group(), cityLights = [];
{
  const r = V.rnd(77);
  for (let i = 0; i < 16; i++) {
    const h = 6 + Math.floor(r() * 16), w = 3 + Math.floor(r() * 3), b = V.building(w, h, 3, ['#2c3446', '#343c52', '#262d3d'][i % 3]);
    b.position.set(-10 - r() * 3.5, -1.5, -6.5 + i * 0.85); b.castShadow = false; city.add(b);
    for (let k = 0; k < 6; k++) cityLights.push([b.position.x + w * 0.25 + 0.01, -1 + r() * h * 0.5, b.position.z - 0.5 + r()]);
  }
  scene.add(city);
}
const winGeo = new THREE.PlaneGeometry(0.16, 0.2), winMat = new THREE.MeshBasicMaterial({color: '#e0b56a'});
const winLights = new THREE.InstancedMesh(winGeo, winMat, cityLights.length);
cityLights.forEach(([x, y, z], i) => { const m = new THREE.Matrix4().makeRotationY(Math.PI / 2); m.setPosition(x, y, z); winLights.setMatrixAt(i, m); });
scene.add(winLights);

function drawSky(hour) {
  const {g, canvas: c} = sky, night = hour < 6.5 || hour >= 20, dusk = !night && (hour < 8 || hour >= 18);
  const grad = g.createLinearGradient(0, 0, 0, c.lh);
  const stops = night ? ['#0a1030', '#1b2350', '#2b2f5e'] : dusk ? ['#3b4a8c', '#e07e57', '#f2b072'] : ['#4f97d1', '#8cc3ea', '#c9e6f7'];
  stops.forEach((s, i) => grad.addColorStop(i / 2, s));
  g.fillStyle = grad; g.fillRect(0, 0, c.lw, c.lh);
  if (night) { const r = V.rnd(5); g.fillStyle = '#fff'; for (let i = 0; i < 90; i++) g.fillRect(r() * c.lw, r() * c.lh * 0.7, 2, 2); }
  sky.tex.needsUpdate = true;
  winLights.visible = night || dusk;
  sun.color.set(night ? '#8ea4ff' : dusk ? '#ffb27a' : '#ffe8c4'); sun.intensity = night ? 0.45 : dusk ? 1.3 : 1.9;
  hemi.intensity = night ? 0.45 : 0.85;
  for (const l of lamps) l.intensity = night ? 4.5 : dusk ? 2.5 : 1.0;
  scene.background.set(night ? '#11131d' : '#1c1f2c');
}

const add = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m; };

// back wall of the open space: whiteboard (kanban) and TV with the live chat
const tv = board(2.2, 1.25, 512); tv.mesh.position.set(0.9, 1.7, -5.83); scene.add(tv.mesh);
const wb = board(2.6, 1.4, 512); wb.mesh.position.set(-2.6, 1.6, -5.83); scene.add(wb.mesh);
for (const [b, w, h, col] of [[tv, 2.36, 1.4, '#16181f'], [wb, 2.76, 1.56, '#cfd3da']]) {
  const f = V.mesh(new V.Vox().box(0, 0, 0, Math.round(w * 10) - 1, Math.round(h * 10) - 1, 0, col), {pivot: [w * 5, h * 5, 1]});
  f.position.copy(b.mesh.position); f.position.z -= 0.02; scene.add(f);
}
add(V.rack(), -7.25, 0, -5.3);
const printerG = add(V.printer(), -6.3, 0, -5.35);
add(V.shelf(11), -4.85, 0, -5.65);

// the boss's glass office
const clock = board(0.7, 0.7, 128); clock.mesh.position.set(4.7, 2.3, -5.84); scene.add(clock.mesh);
add(V.bossDesk(), 5.6, 0, -4.5, Math.PI);
add(V.bossChair(), 5.6, 0, -5.35, Math.PI);
add(V.laptop(), 5.95, 0.8, -4.6, Math.PI - 0.25);
add(V.shelf(23), 7.2, 0, -5.65);
const nameplate = board(0.55, 0.16, 256); nameplate.mesh.position.set(5.6, 0.95, -3.99); scene.add(nameplate.mesh);
add(V.glassFrame(3.4), BOSS_ROOM.x0, 0, -6, -Math.PI / 2);
add(V.glassFrame(4.2, [0.6, 1.4]), BOSS_ROOM.x0, 0, BOSS_ROOM.z1);
add(V.glassPane(3.4), BOSS_ROOM.x0, 1.25, -4.3, Math.PI / 2);
add(V.glassPane(0.6), BOSS_ROOM.x0 + 0.3, 1.25, BOSS_ROOM.z1);
add(V.glassPane(2.8), BOSS_ROOM.x0 + 2.8, 1.25, BOSS_ROOM.z1);

// the assistant, outside the boss's door, facing the open space
const LEAD_ROT = -0.8;
const LEAD_SEAT = {pos: new THREE.Vector3(5.6, 0.1, -1.95), rot: LEAD_ROT, pose: 'sit'};
add(V.smallDesk(), 5.6 + Math.sin(LEAD_ROT) * 0.62, 0, -1.95 + Math.cos(LEAD_ROT) * 0.62, LEAD_ROT);
add(V.chair('#2d5b56'), 5.6, 0, -1.95, LEAD_ROT + Math.PI);

// the glass meeting room
add(V.glassFrame(4.2, [0.6, 1.4]), MEET_ROOM.x0, 0, MEET_ROOM.z0);
add(V.glassFrame(3.8), MEET_ROOM.x0, 0, 6, -Math.PI / 2 + Math.PI);
add(V.glassPane(0.6), MEET_ROOM.x0 + 0.3, 1.25, MEET_ROOM.z0);
add(V.glassPane(2.8), MEET_ROOM.x0 + 2.8, 1.25, MEET_ROOM.z0);
add(V.glassPane(3.8), MEET_ROOM.x0, 1.25, 4.1, Math.PI / 2);
add(V.confTable(), 6.0, 0, 4.1);
const MEET = [];
const meetRoute = approach => [new THREE.Vector3(4.8, 0, CORRIDOR), new THREE.Vector3(4.8, 0, 2.7), approach];
for (const [x, z, ry, ax, az] of [[5.0, 3.1, 0, 5.0, 2.65], [6.0, 3.1, 0, 6.0, 2.65], [7.0, 3.1, 0, 7.0, 2.65], [5.0, 5.15, Math.PI, 5.0, 5.6],
                                   [6.0, 5.15, Math.PI, 6.0, 5.6], [7.0, 5.15, Math.PI, 7.0, 5.6], [4.3, 4.1, Math.PI / 2, 4.3, 2.7], [7.7, 4.1, -Math.PI / 2, 7.7, 2.7]]) {
  add(V.meetChair(), x, 0, z, ry + Math.PI);
  MEET.push({pos: new THREE.Vector3(x, 0.1, z), rot: ry, pose: 'sit', route: meetRoute(new THREE.Vector3(ax, 0, az))});
}

// kitchen and lounge
add(V.kitchen(28), -7.6, 0, 4.25, Math.PI / 2);
add(V.upperCabinets(28), -7.72, 1.55, 4.25, Math.PI / 2);
add(V.fridge(), -7.6, 0, 2.45, Math.PI / 2);
add(V.barTable(), -5.5, 0, 4.3);
const coffeeSign = board(1.1, 0.36, 256); coffeeSign.mesh.position.set(-7.86, 2.55, 4.25); coffeeSign.mesh.rotation.y = Math.PI / 2; scene.add(coffeeSign.mesh);
add(V.sofa('#3f6f73'), -7.25, 0, 0.1, Math.PI / 2);
add(V.coffeeTable(), -6.15, 0, 0.1, Math.PI / 2);
const kitchenIn = new THREE.Vector3(-4.4, 0, CORRIDOR);
const COFFEE = [
  {pos: new THREE.Vector3(-6.85, 0, 3.55), rot: -Math.PI / 2, pose: 'stand', route: [kitchenIn, new THREE.Vector3(-6.3, 0, 3.55)]},
  {pos: new THREE.Vector3(-5.5, 0.4, 3.6), rot: 0, pose: 'sit', route: [kitchenIn, new THREE.Vector3(-5.5, 0, 3.1)]},
  {pos: new THREE.Vector3(-6.85, 0, 5.0), rot: -Math.PI / 2, pose: 'stand', route: [kitchenIn, new THREE.Vector3(-6.2, 0, 5.0)]},
  {pos: new THREE.Vector3(-7.05, 0.05, -0.4), rot: Math.PI / 2, pose: 'sofa', route: [kitchenIn, new THREE.Vector3(-5.5, 0, -0.4)]},
  {pos: new THREE.Vector3(-4.8, 0.4, 4.3), rot: -Math.PI / 2, pose: 'sit', route: [kitchenIn, new THREE.Vector3(-4.4, 0, 4.3)]},
  {pos: new THREE.Vector3(-7.05, 0.05, 0.6), rot: Math.PI / 2, pose: 'sofa', route: [kitchenIn, new THREE.Vector3(-5.5, 0, 0.6)]},
];
for (const c of COFFEE) if (c.pose === 'sit') add(V.barStool(), c.pos.x, 0, c.pos.z);
for (const [x, z, s] of [[-4.6, -4.6, 3], [3.35, 3.2, 4], [7.6, 0.6, 5], [-7.5, -2.0, 6], [-4.6, 5.6, 7], [7.5, -3.25, 8]]) add(V.planter(s), x, 0, z);


// LEDs of the server rack and of the espresso machine: tiny glowing voxels that blink
const ledGeo = new THREE.BoxGeometry(0.06, 0.04, 0.02), ledMat = new THREE.MeshBasicMaterial({toneMapped: false});
const leds = new THREE.InstancedMesh(ledGeo, ledMat, 28);
for (let i = 0; i < 27; i++) { const m = new THREE.Matrix4().makeTranslation(-7.5 + (i % 3) * 0.18, 0.28 + Math.floor(i / 3) * 0.2, -4.94); leds.setMatrixAt(i, m); }
leds.setMatrixAt(27, new THREE.Matrix4().makeTranslation(-7.38, 1.05, 4.05));
scene.add(leds);
const ledColor = new THREE.Color();

// ------------------------------------------------------------------ particles
const PMAX = 700, pGeo = new THREE.BoxGeometry(1, 1, 1), pMat = new THREE.MeshBasicMaterial({toneMapped: false});
const parts = new THREE.InstancedMesh(pGeo, pMat, PMAX); parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
parts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PMAX * 3), 3);
scene.add(parts);
const P = [];
function emit(n, at, {color = '#ffffff', speed = 2, up = 2, life = 1.2, size = 0.07, gravity = -6, spread = 0.3, glow = 1, to = null} = {}) {
  const c = new THREE.Color(), list = Array.isArray(color) ? color : [color];
  for (let i = 0; i < n && P.length < PMAX; i++) {
    c.set(list[i % list.length]).multiplyScalar(glow);
    P.push({p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)),
            v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * up, (Math.random() - 0.5) * speed),
            life, age: 0, size: size * (0.6 + Math.random() * 0.8), gravity, c: c.clone(), to, spin: Math.random() * 6});
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function stepParticles(dt) {
  for (let i = P.length - 1; i >= 0; i--) {
    const q = P[i]; q.age += dt;
    if (q.age >= q.life) { P.splice(i, 1); continue; }
    if (q.to) q.p.lerp(q.to, Math.min(1, dt * 3.2)); else { q.v.y += q.gravity * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.02) { q.p.y = 0.02; q.v.multiplyScalar(0.4); q.v.y *= -0.3; } }
  }
  for (let i = 0; i < PMAX; i++) {
    const q = P[i];
    if (!q) { _m.makeScale(0, 0, 0); parts.setMatrixAt(i, _m); continue; }
    const k = 1 - Math.max(0, (q.age - q.life * 0.7) / (q.life * 0.3));
    _s.setScalar(q.size * k); _q.setFromEuler(_e.set(q.spin * q.age, q.spin * q.age * 0.7, 0));
    _m.compose(q.p, _q, _s); parts.setMatrixAt(i, _m); parts.setColorAt(i, q.c);
  }
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
// pods of four desks facing each other across a fabric divider; the far row faces the camera. As many pods as the
// room needs: one centred pod up to four agents, two side by side up to eight, then more pods in a back row.
const SLOTS = [], podsBuilt = new Set();
const pod = (cx, z0, front) => ({cx, z0, front, aisles: [cx - 1.95, Math.min(cx + 1.95, 3.65)]});
function addPod(p) { for (const [row, side] of [['far', -1], ['far', 1], ['near', -1], ['near', 1]]) SLOTS.push({pod: p, row, side}); }
function planDesks(n) {
  if (!SLOTS.length) {
    if (n <= 4) addPod(pod(-0.3, -0.9, true));
    else { addPod(pod(-2.2, -0.9, true)); addPod(pod(1.9, -0.9, true)); }
  }
  for (let k = 0; SLOTS.length < n; k++) addPod(pod(k % 2 ? 1.9 : -2.2, -4.0 - Math.floor(k / 2) * 2.9, false));
}

function deskLayout(names) {
  planDesks(Math.max(names.length, (DATA.config.participants || []).length));
  names.forEach((name, i) => {
    if (SPOTS.has(name)) return;
    const {pod, row, side} = SLOTS[i];
    if (!podsBuilt.has(pod)) { podsBuilt.add(pod); add(V.divider(34), pod.cx, 0, pod.z0); }
    const color = DATA.profile(name).color, near = row === 'near';
    const x = pod.cx + side * 0.85, zc = pod.z0 + (near ? 0.45 : -0.45), ry = near ? 0 : Math.PI;
    const g = new THREE.Group(); g.position.set(x, 0, zc); g.rotation.y = ry; scene.add(g);
    g.add(V.workDesk());
    const mon = V.monitor(); mon.position.set(0, 0.7, -0.27); g.add(mon);
    const kb = V.keyboard(); kb.position.set(-0.05, 0.71, 0.12); g.add(kb);
    const mug = V.mug(color); mug.position.set(0.6, 0.71, 0.08); g.add(mug);
    if (i % 2) { const lamp = V.deskLamp(); lamp.position.set(-0.62, 0.71, -0.2); g.add(lamp); }
    else { const pl = V.plant(i + 2, false); pl.position.set(-0.62, 0.71, -0.22); g.add(pl); }
    const ch = V.chair('#33373f', color); ch.position.set(0, 0, 0.8); g.add(ch);
    const scr = board(0.82, 0.5, 192); scr.mesh.position.set(0, 1.2, -0.21); g.add(scr.mesh);
    const beacon = V.mesh(new V.Vox().box(0, 0, 0, 2, 2, 2, '#ff1744'), {pivot: [1.5, 0, 1.5], glow: 1.5}, true);
    beacon.position.set(0.55, 1.45, -0.3); beacon.visible = false; g.add(beacon);
    const beaconLight = new THREE.PointLight('#ff1744', 0, 3.5, 1.5); beaconLight.position.set(0.55, 1.7, -0.3); g.add(beaconLight);
    g.updateMatrixWorld(true);
    const W = (lx, lz, y = 0) => g.localToWorld(new THREE.Vector3(lx, y, lz));
    const behind = W(0, 1.4), aisle = pod.aisles[side < 0 ? 0 : 1];
    const route = near && pod.front ? [new THREE.Vector3(behind.x, 0, CORRIDOR), behind]
                       : [new THREE.Vector3(aisle, 0, CORRIDOR), new THREE.Vector3(aisle, 0, behind.z), behind];
    SPOTS.set(name, {g, scr, beacon, beaconLight,
      seat: {pos: W(0, 0.78, 0.1), rot: ry + Math.PI, pose: 'sit', route, desk: name},
      stand: {pos: W(-0.55, 1.35), rot: 0, pose: 'stand', route, desk: name},
      intern: {pos: W(0.95, 0.5), rot: ry + Math.PI, pose: 'stand'}});
  });
}

class Person {
  constructor(name, kind, spot, spawn, shirt = null) {
    const p = DATA.profile(name);
    const built = V.person({name, shirt: shirt || p.color, kind, scale: kind === 'intern' ? 0.62 : 1});
    Object.assign(this, built, {name, kind, spot, pos: spot.pos.clone(), rot: spot.rot, path: [], act: 'idle', t: Math.random() * 10,
                                look: null, spawn: spawn ? 0 : 1, bubbleUntil: 0, pose: spot.pose});
    this.root.position.copy(this.pos); this.root.rotation.y = this.rot;
    this.root.traverse(o => { o.userData.person = name; if (o.isMesh) raycastables.push(o); });
    scene.add(this.root);
    if (spawn) emit(60, this.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), {color: [p.color, '#ffffff', '#9be7ff'], to: this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), life: 0.9, size: 0.09});
  }
  goTo(spot) {
    if (this.spot === spot || (this.spot.pos.equals(spot.pos) && this.spot.rot === spot.rot)) { this.spot = spot; return; }
    // out along the current spot's route to the corridor, along the corridor, then in along the new spot's route
    const same = spot.desk && spot.desk === this.spot.desk;
    const out = same ? [] : [...(this.spot.route || [])].reverse(), inn = same ? [] : spot.route || [];
    this.path = [...out, ...inn, spot.pos].map(p => p.clone()); this.spot = spot; this.pose = 'walk';
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
      const dist = d.length(), step = 1.9 * dt;
      if (dist <= step) { this.pos.x = target.x; this.pos.z = target.z; this.path.shift(); if (!this.path.length) { this.pos.y = this.spot.pos.y; this.pose = this.spot.pose; } }
      else { this.pos.addScaledVector(d.normalize(), step); this.rot = angLerp(this.rot, Math.atan2(d.x, d.z), Math.min(1, dt * 10)); this.pos.y = 0; }
    } else this.rot = angLerp(this.rot, this.faceRot ?? this.spot.rot, Math.min(1, dt * 6));
    this.root.position.copy(this.pos); this.root.rotation.y = this.rot;
    // pose targets
    const T = {legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, torso: 0, headX: 0, headY: 0, headZ: 0, bob: 0};
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
      else if (a === 'coffee') { T.armR = -1.3 - (Math.sin(t * 0.7) > 0.85 ? 0.6 : 0); T.headX = Math.sin(t * 0.7) > 0.85 ? -0.2 : 0.05; }
      else if (a === 'speak') { T.armR = -1.5 + Math.sin(t * 6) * 0.25; T.armRz = 0.3; T.headX = -0.1; }
      else if (a === 'meet') { T.armL = T.armR = -0.9; T.headY = Math.sin(t * 0.9) * 0.25; }
      else { T.headX = Math.sin(t * 0.6) * 0.05; T.torso = seated ? -0.05 : 0; T.bob = Math.sin(t * 2) * 0.01; }
      if (this.look) {                                                     // turn the head toward someone
        const d = this.look.clone().sub(this.head()); const want = Math.atan2(d.x, d.z) - this.rot;
        T.headY = Math.max(-1, Math.min(1, ((want + Math.PI * 3) % (Math.PI * 2)) - Math.PI)); T.headX = -0.05;
      }
    }
    const k = Math.min(1, dt * 10);
    P_.legL.rotation.x = lerp(P_.legL.rotation.x, T.legL, k); P_.legR.rotation.x = lerp(P_.legR.rotation.x, T.legR, k);
    P_.armL.rotation.x = lerp(P_.armL.rotation.x, T.armL, k); P_.armR.rotation.x = lerp(P_.armR.rotation.x, T.armR, k);
    P_.armL.rotation.z = lerp(P_.armL.rotation.z, T.armLz, k); P_.armR.rotation.z = lerp(P_.armR.rotation.z, T.armRz, k);
    P_.torso.rotation.x = lerp(P_.torso.rotation.x, T.torso, k);
    P_.head.rotation.x = lerp(P_.head.rotation.x, T.headX, k); P_.head.rotation.y = lerp(P_.head.rotation.y, T.headY, k * 0.8);
    P_.head.rotation.z = lerp(P_.head.rotation.z, T.headZ, k);
    this.body.position.y = lerp(this.body.position.y, T.bob, Math.min(1, dt * 14));
  }
  dispose() { scene.remove(this.root); this.root.traverse(o => { const i = raycastables.indexOf(o); if (i >= 0) raycastables.splice(i, 1); }); }
}

// ------------------------------------------------------------------ data
const DATA = {
  all: [], config: {participants: [], profiles: {}, lang: 'it', user_name: 'USER', self_names: []}, state: {agents: {}}, loaded: false,
  profile(name) {
    const p = (this.config.profiles || {})[name] || {};
    let color = p.color;
    if (!color) { const pal = ['#1fa855', '#027eb5', '#d9730d', '#8e44ad', '#c0392b', '#16a085', '#b7950b', '#6c5ce7']; color = pal[V.hashName(name) % pal.length]; }
    return {color, emoji: p.emoji || name.slice(0, 1), role: p.role || '', model: [p.model, p.effort].filter(Boolean).join(' · ')};
  },
};
window.addEventListener('chatroom:data', e => { DATA.all = e.detail.all || []; DATA.config = e.detail.config || DATA.config; DATA.loaded = true; derive(); });
async function pollState() {
  try { const r = await fetch('state.json?t=' + Date.now(), {cache: 'no-store'}); if (r.ok) { DATA.state = await r.json(); derive(); } } catch (e) {}
}
setInterval(pollState, 1000);

const cat = (tool, target = '') => !tool ? null : /^(Edit|Write|NotebookEdit|MultiEdit)$/.test(tool) ? 'code' : /^(Read|Grep|Glob|LS)$/.test(tool) ? 'read'
  : tool === 'Bash' || tool === 'PowerShell' ? (target === 'chat:post' ? 'post' : target.startsWith('chat:') ? 'chat' : 'term')
  : /^Web/.test(tool) ? 'web' : tool === 'Agent' || tool === 'Task' ? 'agent' : tool === 'SendMessage' ? 'msg' : 'other';
const pctOf = text => { const n = [...String(text).matchAll(PCT)].map(m => +m[1]).filter(x => x <= 100); return n.length ? Math.min(...n) : null; };
const tagsName = (text, name) => new RegExp(`(^|[^\\w@])@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text || '');

let D = {names: [], self: new Set(), lead: 'LEAD', user: 'USER', per: {}, plan: null, closed: null, waiting: new Set()};
let lastSeenN = 0, firstDerive = true, lastClosedN = 0;
function derive() {
  const c = DATA.config, all = DATA.all, now = Date.now() / 1000, hb = c.heartbeat || 120;
  const user = c.user_name || 'USER', selfNames = new Set([user, ...(c.self_names || [])]);
  const leadNames = (c.self_names || []).filter(n => all.some(m => m.from === n));
  const lead = leadNames[leadNames.length - 1] || (c.self_names || [])[0] || 'LEAD';
  const names = [...new Set([...(c.participants || []), ...all.map(m => m.from).filter(n => !selfNames.has(n))])];
  let plan = null, closed = null;
  for (const m of all) {
    if (m.kind) continue;
    const p = String(m.text).match(PLAN); if (p) plan = {v: +p[2], author: m.from, n: m.n};
    const cl = String(m.text).match(CLOSED); if (cl && plan && (!cl[2] || +cl[2] >= plan.v)) closed = {v: cl[2] ? +cl[2] : plan.v, n: m.n, author: m.from, ts: m.ts || 0};
  }
  if (closed && plan && plan.n > closed.n) closed = null;
  const votes = {};
  if (plan) for (const m of all) { const v = String(m.text).match(VOTE); if (v && +v[2] === plan.v && m.n > plan.n) votes[m.from] = /no/i.test(v[3]) ? 'no' : 'yes'; }
  const per = {};
  for (const name of names) {
    const mine = all.filter(m => m.from === name), last = mine[mine.length - 1];
    let pct = null; for (let i = mine.length - 1; i >= 0 && pct === null; i--) pct = pctOf(mine[i].text);
    const real = [...mine].reverse().find(m => !m.kind);
    const idle = last?.kind === 'idle', silence = last ? now - (last.ts || now) : null;
    const after = all.filter(m => m.n > (last?.n || 0) && m.from !== name);
    const tagged = after.some(m => tagsName(m.text, name) || EVERY.test(m.text) || m.from === user);
    per[name] = {pct, idle, late: !idle && silence !== null && silence > hb, silence, last, real, tagged, vote: votes[name] || null,
                 a: (DATA.state.agents || {})[name] || null, msgs: mine.filter(m => !m.kind).slice(-3).reverse()};
  }
  const waiting = new Set(names.filter(n => per[n].a?.waiting));
  D = {names, self: selfNames, lead, user, per, plan, closed, waiting, all, hb, now};
  sync(); events();
}

// ------------------------------------------------------------------ cast: build and place the figures
let boss = null, assistant = null;
const BOSS_SEAT = {pos: new THREE.Vector3(5.6, 0.2, -5.28), rot: 0, pose: 'sit'};
const interns = new Map();
function sync() {
  deskLayout(D.names);
  if (!boss) { boss = new Person(D.user, 'boss', BOSS_SEAT, false); }
  if (!assistant) { assistant = new Person(D.lead, 'lead', LEAD_SEAT, false); }
  for (const name of D.names) if (!people.has(name)) people.set(name, new Person(name, 'agent', SPOTS.get(name).seat, !firstDerive));
  firstDerive = false;
  const now = D.now;
  let meetIdx = 0, coffeeIdx = 0;
  for (const name of D.names) {
    const p = people.get(name), d = D.per[name], a = d.a, spot = SPOTS.get(name);
    const tool = a?.tool && now - (a.since || now) < 900 ? a.tool : null, c = cat(tool, a?.target || '');
    const posted = d.real && now - (d.real.ts || 0) < 6;
    let want = spot.seat, act;
    if (D.closed) { want = MEET[meetIdx++ % MEET.length]; act = now - (D.closed.ts || 0) < 8 ? 'celebrate' : 'meet'; }
    else if (a?.waiting) { want = spot.stand; act = 'raise'; }
    else if (d.idle && (!c || c === 'chat')) { want = COFFEE[coffeeIdx++ % COFFEE.length]; act = 'coffee'; }
    else if (D.plan && d.vote === 'yes' && (!c || c === 'chat')) { want = MEET[meetIdx++ % MEET.length]; act = 'meet'; }
    else act = posted ? 'speak' : c || (a?.text_at && now - a.text_at < 15 ? 'think' : d.silence !== null && d.silence < 25 ? 'think' : 'idle');
    p.goTo(want); p.act = act;
    p.faceRot = want === spot.seat && posted ? 0.0 : null;               // turn the chair round to talk
    // a subagent of this agent: an intern beside the desk
    const subs = a?.subagents || 0;
    if (subs > 0 && !interns.has(name)) { const it = new Person(name + '·sub', 'intern', spot.intern, true, DATA.profile(name).color); it.act = 'code'; interns.set(name, it); }
    if (subs === 0 && interns.has(name)) { const it = interns.get(name); emit(25, it.head(), {color: ['#ffffff', DATA.profile(name).color]}); it.dispose(); interns.delete(name); }
    spot.beacon.visible = !!a?.waiting;
  }
  for (const [name, p] of people) if (!D.names.includes(name)) { p.dispose(); people.delete(name); }
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
    from.bubble = {text: m.text, until: Date.now() / 1000 + 7, kind: PLAN.test(m.text) ? 'plan' : VOTE.test(m.text) ? 'vote' : m.from === D.user ? 'user' : 'msg'};
    const targets = EVERY.test(m.text) || m.from === D.user ? [...people.values()] : D.names.filter(n => tagsName(m.text, n)).map(n => people.get(n));
    for (const t of targets.slice(0, 6)) if (t && t !== from) flyPlane(from.head(), t.head());
    if (m.from === D.user) for (const p of people.values()) { p.look = boss.head(); setTimeout(() => { p.look = null; }, 3500); }
    if (assistant && from !== assistant) { assistant.look = from.head(); assistant.act = 'read'; setTimeout(() => { assistant.look = null; }, 2500); }
    emit(10, from.head(), {color: ['#fff59d', '#ffffff'], speed: 1, up: 1.2, life: 0.7, size: 0.05});
    if (tagsName(m.text, D.user)) notify('tag' + m.n, `💬 ${m.from} → ${D.user}`, m.text.slice(0, 160), false, () => window.chatroom?.jumpTo(m.n));
    if (CLOSED.test(m.text) && m.n > lastClosedN) {
      lastClosedN = m.n;
      emit(260, new THREE.Vector3(0, 2.4, 4.4), {color: ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'], speed: 5, up: 5, life: 3, size: 0.08, gravity: -4});
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
function drawBoards() {
  const c = DATA.config, L = ui.t();
  {
    const {g, canvas: k} = tv; g.fillStyle = '#0d1018'; g.fillRect(0, 0, k.lw, k.lh);
    g.fillStyle = '#4fc3f7'; g.font = '700 22px sans-serif'; g.fillText('● LIVE', 14, 30);
    const msgs = D.all.filter(m => !m.kind).slice(-4); let y = 62;
    g.font = '17px sans-serif';
    for (const m of msgs) {
      g.fillStyle = m.from === D.user ? '#ff80ab' : DATA.profile(m.from).color; g.font = '700 17px sans-serif'; g.fillText(`#${m.n} ${m.from}`, 14, y);
      g.fillStyle = '#e8eaf0'; g.font = '16px sans-serif'; wrapText(g, String(m.text).replace(/\s+/g, ' '), 14, y + 20, k.lw - 28, 18, 2); y += 64;
    }
    tv.tex.needsUpdate = true;
  }
  {
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
  {
    const {g, canvas: k} = coffeeSign; g.fillStyle = '#2b2f36'; g.fillRect(0, 0, k.lw, k.lh);
    g.font = '700 46px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3e3c3';
    g.fillText(DATA.config.lang === 'en' ? '☕ coffee' : '☕ caffè', k.lw / 2, k.lh / 2 + 3); g.textAlign = 'left';
    coffeeSign.tex.needsUpdate = true;
  }
  {
    const {g, canvas: k} = nameplate; g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, k.lw, k.lh);
    g.fillStyle = '#d4a640'; g.font = '700 40px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`👑 ${D.user}`, k.lw / 2, k.lh / 2 + 2);
    g.textAlign = 'left'; nameplate.tex.needsUpdate = true;
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
function drawScreen(name, act, t) {
  const spot = SPOTS.get(name); if (!spot) return;
  const {g, canvas: k} = spot.scr, W = k.lw, H = k.lh, color = DATA.profile(name).color;
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
let mode = pref('mode', window.innerWidth >= 1000 ? 'split' : 'office'), selected = null, follow = false;
const ui = createUI(root, {
  onMode: m => { mode = m; setPref('mode', m); applyMode(); },
  onReset: () => { follow = false; tween = {pos: HOME.pos.clone(), target: HOME.target.clone()}; },
  onFollow: () => { follow = !follow && !!selected; },
  onQuality: () => { quality = QUALITY[(QUALITY.indexOf(quality) + 1) % QUALITY.length]; setPref('quality', quality); applyQuality(); },
  onSelect: n => select(n),
  onTag: n => { if (mode === 'office') { mode = 'split'; applyMode(); } window.chatroom?.tag(n); },
  onJump: n => { if (n && window.chatroom) { if (mode === 'office') { mode = 'split'; applyMode(); } window.chatroom.jumpTo(n); } },
  onNext: dir => { const list = D.names; if (!list.length) return; const i = list.indexOf(selected); select(list[(i + dir + list.length) % list.length]); },
});
document.addEventListener('keydown', e => { if (mode !== 'chat') ui.onKey(e); });
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
  const h = p.head(), off = camera.position.clone().sub(controls.target).setLength(Math.min(9, camera.position.distanceTo(controls.target)));
  tween = {pos: h.clone().add(off), target: h.clone().add(new THREE.Vector3(0, -0.6, 0))};
  inspect();
}
function inspect() {
  if (!selected) return;
  const L = ui.t(), pr = DATA.profile(selected), d = D.per[selected];
  if (!d) { ui.inspect({name: selected, emoji: selected === D.user ? '👑' : '👓', role: selected === D.user ? L.you : L.lead, model: pr.model, color: pr.color,
                       msgs: D.all.filter(m => m.from === selected && !m.kind).slice(-3).reverse(), lastN: D.all.filter(m => m.from === selected).pop()?.n}); return; }
  const a = d.a;
  ui.inspect({name: selected, emoji: pr.emoji, role: pr.role, model: pr.model, color: pr.color, pct: d.pct, state: people.get(selected)?.act,
              ctx: a?.ctx, window: a?.window, pulse: a?.pulse, lastN: d.last?.n, msgs: d.msgs,
              recent: (a?.recent || []).map(r => ({...r, emoji: EMOJI[cat(r.tool, r.target)] || '🔧'}))});
}
renderer.domElement.addEventListener('pointerdown', e => { unlockAudio(); downAt = [e.clientX, e.clientY]; });
let downAt = null;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
renderer.domElement.addEventListener('click', e => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(raycastables, false)[0];
  const name = hit?.object.userData.person;
  select(name && !name.endsWith('·sub') ? name : null);
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
  const all = [...people.values(), boss, assistant].filter(Boolean);
  for (const p of all) {
    _v.copy(p.head()); _v.y += 0.25; const dist = camera.position.distanceTo(_v); _v.project(camera);
    const vis = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
    ui.place(p.name, (_v.x * 0.5 + 0.5) * w, (-_v.y * 0.5 + 0.5) * h, vis, Math.max(0.72, Math.min(1.12, 14 / dist)));
    const pr = DATA.profile(p.name), d = D.per[p.name], bubble = p.bubble && p.bubble.until > now ? p.bubble : null;
    const flags = [];
    let line = '', title = p.name, sub = pr.model, emoji = pr.emoji, pct = null;
    if (p === boss) { emoji = '👑'; sub = L.you; }
    else if (p === assistant) { emoji = '👓'; sub = [L.lead, pr.model].filter(Boolean).join(' · '); line = `👀 #${lastSeenN}`; }
    else if (d) {
      const a = d.a, c = cat(a?.tool, a?.target || '');
      pct = d.pct;
      if (a?.waiting) flags.push(['wait', '🙋 ' + L.wait]);
      if (d.tagged && !d.idle) flags.push(['tag', L.tagged]);
      if (d.late) flags.push(['late', '⏰ ' + L.late]);
      if (d.idle) flags.push(['idle', '💤 ' + L.idle]);
      if (d.vote) flags.push([d.vote === 'yes' ? 'vote-yes' : 'vote-no', `v${D.plan?.v} ${d.vote === 'yes' ? '✓' : '✗'}`]);
      if (c) line = `${EMOJI[c]} ${L[c]}${a.target && !a.target.startsWith('chat:') ? ': ' + a.target : ''}`;
      else if (d.idle) line = `${EMOJI.coffee} ${L.coffee}`;
      else line = `${EMOJI.think} ${L.think}`;
    }
    ui.tag(p.name, {title, sub, emoji, color: pr.color, pct, line, flags, bubble: bubble ? ({status: '📝 ', idle: '💤 ', vote: '🗳 '}[bubble.kind] || '') + String(bubble.text).replace(/\s+/g, ' ').slice(0, bubble.kind === 'status' || bubble.kind === 'idle' ? 90 : 150) : '', bubbleKind: bubble?.kind});
  }
  const work = D.names.filter(n => !D.per[n].idle && !D.per[n].a?.waiting).length, idle = D.names.filter(n => D.per[n].idle).length;
  const pcts = D.names.map(n => D.per[n].pct).filter(x => x !== null);
  const yes = D.names.filter(n => D.per[n].vote === 'yes').length;
  const st = DATA.state, src = st.mod && Date.now() / 1000 - st.mod < 120 ? L.mod : Object.keys(st.agents || {}).length ? L.tail : L.nodata;
  ui.hud({title: `${DATA.config.icon || '💬'} ${DATA.config.title || DATA.config.topic || 'Chat room'}`, pct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
          waiting: D.waiting.size, working: work, idle, plan: D.closed ? `✅ ${L.done} v${D.closed.v}` : D.plan ? `🗳 ${L.plan(D.plan.v)}: ${L.votes(yes, D.names.length - yes)}` : '',
          src: '📡 ' + src, mode, follow, quality});
  window.officeOwnsTitle = true;
  badge(DATA.config.title || DATA.config.topic || 'Chat room', D.waiting.size, DATA.config.icon);
}

// ------------------------------------------------------------------ loop
const FORCE = /[?&]force\b/.test(location.search);              // keep drawing in a hidden tab (screenshots, tests)
let last = performance.now(), acc = 0, hourDrawn = -1, secDrawn = -1, screenAcc = 0, uiAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (mode === 'chat' || (document.hidden && !FORCE)) { last = now; return; }
  const busy = D.names.some(n => D.per[n] && !D.per[n].idle) || P.length || planes.length;
  const fps = quality === 'bassa' ? 24 : busy ? (quality === 'alta' ? 45 : 30) : 15;
  acc += now - last; last = now;
  if (acc < 1000 / fps) return;
  const dt = Math.min(0.1, acc / 1000); acc = 0;
  const t = now / 1000, d = new Date(), hour = d.getHours() + d.getMinutes() / 60;
  if (Math.floor(hour * 4) !== hourDrawn) { hourDrawn = Math.floor(hour * 4); drawSky(hour); }
  if (d.getSeconds() !== secDrawn) { secDrawn = d.getSeconds(); drawClock(); }
  for (const p of people.values()) p.update(dt, t);
  for (const p of interns.values()) p.update(dt, t);
  if (boss) { boss.act = boss.bubble && boss.bubble.until > Date.now() / 1000 ? 'speak' : 'idle'; boss.update(dt, t); }
  if (assistant) { assistant.act = assistant.bubble && assistant.bubble.until > Date.now() / 1000 ? 'speak' : 'read'; assistant.update(dt, t); }
  screenAcc += dt;
  if (screenAcc > 1 / 6) { screenAcc = 0; for (const [n, p] of people) drawScreen(n, p.act, t); }
  for (const s of SPOTS.values()) if (s.beacon.visible) { s.beacon.rotation.y += dt * 6; s.beaconLight.intensity = 1.6 + Math.sin(t * 9) * 1.2; } else s.beaconLight.intensity = 0;
  for (let i = 0; i < 28; i++) { ledColor.set(i === 27 ? '#ff5252' : (Math.sin(t * (2 + i % 5) + i) > 0.2 ? ['#00e676', '#40c4ff', '#ffab40'][i % 3] : '#10301c')).multiplyScalar(1.15); leds.setColorAt(i, ledColor); }
  leds.instanceColor.needsUpdate = true;
  if (Math.random() < dt * 3) emit(1, new THREE.Vector3(-7.5, 1.6, 4.05), {color: '#ffffff', speed: 0.1, up: 0.5, life: 1.6, size: 0.05, gravity: 0.25, glow: 0.9});
  if (printJob > 0 && Math.random() < dt * 2) { printJob -= 1; emit(1, printerG.position.clone().add(new THREE.Vector3(0, 1.1, 0.2)), {color: '#ffffff', speed: 0.2, up: 1.5, life: 2, size: 0.18, gravity: -1.5, glow: 1}); }
  stepParticles(dt); stepPlanes(dt);
  if (tween) {
    camera.position.lerp(tween.pos, Math.min(1, dt * 4)); controls.target.lerp(tween.target, Math.min(1, dt * 4));
    if (camera.position.distanceTo(tween.pos) < 0.05) tween = null;
  } else if (follow && selected) {
    const p = people.get(selected); if (p) { const h = p.head().add(new THREE.Vector3(0, -0.6, 0)); const delta = h.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(delta); camera.position.add(delta); }
  }
  controls.update();
  uiAcc += dt;
  if (uiAcc > 0.06) { uiAcc = 0; placeTags(); }
  if (selected && Math.floor(t) !== Math.floor(t - dt)) inspect();
  if (quality === 'bassa') renderer.render(scene, camera); else composer.render(dt);
}

if (FORCE) window.__officeStep = t => frame(t);                 // tests: step the loop by hand in a hidden tab

// ------------------------------------------------------------------ start
ui.setLang(DATA.config.lang);
window.addEventListener('chatroom:data', () => ui.setLang(DATA.config.lang));
applyMode(); applyQuality();
drawSky(new Date().getHours()); drawClock();
pollState();
if (window.chatroom?.snapshot) { const s = window.chatroom.snapshot(); DATA.all = s.all; DATA.config = s.config; DATA.loaded = true; derive(); }
requestAnimationFrame(frame);
