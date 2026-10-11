// The arcade cabinet of the common room and the player inside it.
//
// The cabinet is a voxel piece with a live screen: while somebody plays it shows the game, the rest of the time a "9999 IN 1" attract screen. A click on it, or E
// next to it, opens the player over the office: a menu with the free homebrew NES games of the plugin's arcade folder (arcade/games.json: each is its author's work,
// shared under its own licence) and a button to play a .nes of your own. A file of your own is chosen with the browser's file picker and stays in the page: no route
// of the server serves it, nothing sends it anywhere. The emulator is jsnes (Apache-2.0, vendor/jsnes; it is the core only: the picture, the sound, the keys and the
// timing are drawn here, so that a game can be stepped one frame at a time with the inputs it is given).

/** where the cabinet stands: against the south wall of the common room, facing into it (hw, hd: half its width and depth, for the floor plan) */
export const ARCADE_AT = {x: 4.1, z: 9.58, rot: Math.PI, hw: 0.42, hd: 0.38};

const S = {
  en: {title: '9999 IN 1', menu: 'Menu', close: 'Close', ownGame: 'Play a .nes of your own', ownGameTip: 'the file stays on this computer', loading: 'Loading…', noList: 'The game list could not be read.',
       keys: 'Arrows move · X = A · Z = B · Enter = Start · Shift = Select · Esc = menu', saveScore: 'Save my score', scorePlaceholder: 'score', saved: 'Score saved', players: n => n > 1 ? `${n} players` : '1 player',
       crashed: 'This game stopped (the emulator hit something it cannot run).', badRom: 'This is not a NES game file (.nes).', pressStart: 'PRESS START', free: 'FREE GAMES · NO COIN NEEDED', hint: 'use the arcade',
       sha: 'this copy differs from the one in the plugin: scores may not match'},
  it: {title: '9999 IN 1', menu: 'Menu', close: 'Chiudi', ownGame: 'Gioca un tuo .nes', ownGameTip: 'il file resta su questo computer', loading: 'Carico…', noList: 'Non riesco a leggere la lista dei giochi.',
       keys: 'Frecce muovi · X = A · Z = B · Invio = Start · Maiusc = Select · Esc = menu', saveScore: 'Salva il mio punteggio', scorePlaceholder: 'punti', saved: 'Punteggio salvato', players: n => n > 1 ? `${n} giocatori` : '1 giocatore',
       crashed: 'Il gioco si e fermato (l\'emulatore ha trovato qualcosa che non sa eseguire).', badRom: 'Questo non e un file di gioco NES (.nes).', pressStart: 'PREMI START', free: 'GIOCHI LIBERI · NIENTE GETTONI', hint: 'usa il videogioco',
       sha: 'questa copia e diversa da quella del plugin: i punteggi potrebbero non combaciare'},
};

const CSS = `
.o-arc-ov { position: absolute; inset: 0; z-index: 9; background: #05050cdd; display: flex; align-items: center; justify-content: center; font-family: "Courier New", monospace; color: #e8eaf6; }
.o-arc { width: min(96%, 880px); max-height: 96%; background: linear-gradient(#1b1740, #101028); border: 3px solid #5e35b1; border-radius: 16px; box-shadow: 0 0 44px #7c4dff66, 0 14px 44px #000; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
.o-arc-top { display: flex; align-items: center; gap: 12px; }
.o-arc-title { font: 900 22px "Courier New", monospace; letter-spacing: 3px; color: #ffeb3b; text-shadow: 0 0 10px #ff6f00, 2px 2px 0 #c2185b; }
.o-arc-game { flex: 1; text-align: center; font-size: 13px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o-arc button { font: inherit; cursor: pointer; }
.o-arc-x { background: #ffffff14; color: #fff; border: 1px solid #ffffff30; border-radius: 8px; padding: 3px 9px; }
.o-arc-screen { position: relative; background: #000; border: 7px solid #23233a; border-radius: 20px; overflow: hidden; aspect-ratio: 4 / 3; max-height: 66vh; margin: 0 auto; width: 100%; box-shadow: inset 0 0 30px #000; }
.o-arc-screen canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; background: #000; }
.o-arc-screen::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.20) 0, rgba(0,0,0,.20) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,.5) 100%); }
.o-arc-menu { position: absolute; inset: 0; z-index: 1; background: #0a0a1c; padding: 10px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 9px; align-content: start; }
.o-arc-menu h2 { grid-column: 1 / -1; margin: 0; text-align: center; font: 900 26px "Courier New", monospace; letter-spacing: 4px; color: #00e5ff; text-shadow: 0 0 12px #00e5ff, 3px 3px 0 #d500f9; }
.o-arc-menu h2 small { display: block; font-size: 11px; letter-spacing: 2px; color: #ffeb3b; text-shadow: none; animation: o-arc-blink 1s steps(2, jump-none) infinite; }
@keyframes o-arc-blink { 50% { opacity: .15; } }
.o-arc-card { background: #16163a; border: 2px solid #3949ab; border-radius: 10px; padding: 7px; color: #e8eaf6; text-align: left; display: flex; flex-direction: column; gap: 4px; }
.o-arc-card:hover, .o-arc-card.o-sel { border-color: #ffeb3b; background: #20205a; box-shadow: 0 0 14px #ffeb3b55; }
.o-arc-card canvas { width: 100%; aspect-ratio: 1; image-rendering: pixelated; border-radius: 6px; background: #000; }
.o-arc-card b { font-size: 12px; line-height: 1.2; }
.o-arc-card small { font-size: 10.5px; opacity: .7; }
.o-arc-load { justify-content: center; align-items: center; text-align: center; border-style: dashed; cursor: pointer; font-size: 12px; }
.o-arc-load span { font-size: 30px; }
.o-arc-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; opacity: .95; min-height: 24px; }
.o-arc-bar .o-arc-keys { flex: 1; opacity: .75; }
.o-arc-bar input { width: 80px; background: #0c0c20; color: #fff; border: 1px solid #5e35b1; border-radius: 6px; padding: 3px 6px; font: inherit; }
.o-arc-bar button { background: #5e35b1; color: #fff; border: 0; border-radius: 6px; padding: 4px 9px; }
.o-arc-msg { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px; background: #000c; color: #ffab91; font-size: 15px; }
`;

// ---------------------------------------------------------------- small drawings: the thumbnails, the attract screen, the marquee
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const NES_COLOURS = ['#fcfcfc', '#f83800', '#fcb800', '#00b800', '#0078f8', '#6844fc', '#d800cc', '#00e8d8', '#fc7460', '#a4e4fc'];
/** a little symmetrical sprite for a game, the same on every computer (made from its id): a stand-in for the box art the games do not ship */
function thumb(id) {
  const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d');
  let h = hash(id); const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
  g.fillStyle = '#0a0a1c'; g.fillRect(0, 0, 16, 16);
  const body = NES_COLOURS[next() % NES_COLOURS.length], eye = NES_COLOURS[next() % NES_COLOURS.length], alt = NES_COLOURS[next() % NES_COLOURS.length];
  for (let y = 2; y < 14; y++) for (let x = 0; x < 4; x++) {
    const r = next() % 10; if (r < 5) continue;
    g.fillStyle = r < 8 ? body : alt; g.fillRect(4 + x, y, 1, 1); g.fillRect(11 - x, y, 1, 1);
  }
  g.fillStyle = eye; g.fillRect(5, 5, 2, 2); g.fillRect(9, 5, 2, 2); g.fillStyle = '#000'; g.fillRect(6, 6, 1, 1); g.fillRect(10, 6, 1, 1);
  return c;
}
/** the cabinet's screen when nobody plays: the title, a blinking prompt, a few stars */
function drawAttract(g, t, L) {
  g.fillStyle = '#05051a'; g.fillRect(0, 0, 256, 240);
  for (let i = 0; i < 40; i++) { const h = hash('star' + i); if ((t * 2 + i) % 3 < 2) { g.fillStyle = i % 3 ? '#9fa8da' : '#ffffff'; g.fillRect(h % 256, (h >>> 8) % 240, 1, 1); } }
  const hue = (t * 60) % 360;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 38px "Courier New", monospace'; g.fillStyle = '#d500f9'; g.fillText(L.title, 130, 86); g.fillStyle = `hsl(${hue},100%,62%)`; g.fillText(L.title, 127, 83);
  g.font = '700 11px "Courier New", monospace'; g.fillStyle = '#00e5ff'; g.fillText('NES · HOMEBREW · ARCADE', 128, 120);
  if (Math.floor(t * 2) % 2 === 0) { g.font = '900 17px "Courier New", monospace'; g.fillStyle = '#ffeb3b'; g.fillText(L.pressStart, 128, 160); }
  g.font = '700 9px "Courier New", monospace'; g.fillStyle = '#9fa8da'; g.fillText(L.free, 128, 214);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
function drawMarquee(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2a1055'); gr.addColorStop(1, '#14052e'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#00e5ff'; g.shadowBlur = 22; g.fillStyle = '#e0ffff';
  g.font = `900 ${h * 0.62}px "Courier New", monospace`; g.fillText('9999 IN 1', w / 2, h * 0.5);
  g.shadowColor = '#ff00c8'; g.shadowBlur = 16; g.strokeStyle = '#ff40d8'; g.lineWidth = 3; g.strokeText('9999 IN 1', w / 2, h * 0.5);
  g.shadowBlur = 0; g.fillStyle = '#ffeb3b'; for (let i = 0; i < 14; i++) g.fillRect(8 + i * (w - 16) / 13, 4, 6, 4), g.fillRect(8 + i * (w - 16) / 13, h - 8, 6, 4);
}

// ---------------------------------------------------------------- the player
export function createArcade({THREE, scene, camera, raycastables, root, lang = () => 'en', say = () => {}, Vox, mesh, report = () => {}, at = ARCADE_AT, unlock = () => {}, onOpen = () => {}, volume = () => 1}) {
  const L = () => S[lang()] || S.en;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  // ------------------------------------------------ the cabinet in the room
  const cab = new THREE.Group(); cab.position.set(at.x, 0, at.z); cab.rotation.y = at.rot; scene.add(cab);
  const P = (x, y, z) => new THREE.Vector3((x - 8) * 0.05, y * 0.05, (z - 7) * 0.05);        // voxel corner -> metres from the cabinet's pivot; the front is +z
  {
    const v = new Vox(), body = '#1f1b45', dark = '#12102c', trim = '#3949ab';
    const zFront = () => 8;                                                                       // the screen housing: a flat front, the screen on it
    v.box(0, 0, 0, 15, 13, 13, (x, y, z) => (x < 2 || x > 13) && y > 1 ? ((y + z) % 6 < 3 ? '#d81b60' : '#00acc1') : body);   // lower cabinet, side art
    v.box(0, 0, 0, 15, 1, 13, dark);
    v.box(0, 14, 0, 15, 16, 13, (x, y, z) => y === 16 && z > 9 ? '#3a3a6a' : (x < 2 || x > 13) ? ((y + z) % 6 < 3 ? '#d81b60' : '#00acc1') : body);   // control deck
    v.box(0, 14, 13, 15, 14, 13, '#cfd8dc');
    for (let y = 17; y <= 30; y++) v.box(0, y, 0, 15, y, zFront(y), (x, yy, z) => (x < 2 || x > 13) ? ((yy + z) % 6 < 3 ? '#d81b60' : '#00acc1') : body);   // housing
    v.box(2, 19, zFront(19), 13, 29, zFront(29), (x, y, z) => z === zFront(y) ? '#0a0a14' : null);                                            // the bezel: only the front face is repainted
    v.box(0, 31, 0, 15, 35, 8, (x) => x < 2 || x > 13 ? '#d81b60' : '#2a1a4a');                                                                 // marquee box
    v.box(0, 35, 0, 15, 35, 8, dark);
    v.box(5, 5, 13, 10, 10, 13, '#455a64').box(6, 6, 14, 9, 9, 14, '#263238').box(7, 7, 14, 8, 8, 14, '#90a4ae');                           // coin door
    v.box(2, 17, 10, 6, 17, 12, '#101018');                                                                                                      // the plate under the stick
    cab.add(mesh(v, {pivot: [8, 0, 7], scale: 0.05, jitter: 0.04}));
  }
  const piece = (fn, pivot) => { const v = new Vox(); fn(v); return mesh(v, {pivot, scale: 0.05, jitter: 0.02}); };
  const stick = piece(v => { v.box(0, 0, 0, 0, 1, 0, '#cfd8dc').box(0, 2, 0, 1, 3, 1, '#e53935').set(0, 3, 0, '#ef9a9a'); }, [0, 0, 0]);
  stick.position.copy(P(4.5, 18, 11.5)); cab.add(stick);
  const btnA = piece(v => v.box(0, 0, 0, 1, 0, 1, '#e53935').set(0, 1, 0, '#ff8a80'), [1, 0, 1]), btnB = piece(v => v.box(0, 0, 0, 1, 0, 1, '#fdd835').set(0, 1, 0, '#fff59d'), [1, 0, 1]);
  btnA.position.copy(P(10, 17, 11.5)); btnB.position.copy(P(13, 17, 10.5)); cab.add(btnA, btnB);
  { const lv = new Vox().box(0, 0, 0, 1, 0, 0, '#ffd740'); const l = mesh(lv, {pivot: [1, 0, 0], scale: 0.05}, true); l.position.copy(P(8, 11, 14)); cab.add(l); cab.userData.led = l; }
  // the screen and the marquee: canvases drawn live
  const scr = document.createElement('canvas'); scr.width = 256; scr.height = 240; const sg = scr.getContext('2d');
  const scrTex = new THREE.CanvasTexture(scr); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.magFilter = THREE.NearestFilter; scrTex.minFilter = THREE.LinearFilter; scrTex.generateMipmaps = false;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.435), new THREE.MeshBasicMaterial({map: scrTex, toneMapped: false}));
  screen.position.set(0, 24.5 * 0.05, (9 - 7) * 0.05 + 0.003); cab.add(screen);
  const mq = document.createElement('canvas'); mq.width = 512; mq.height = 128; drawMarquee(mq.getContext('2d'), 512, 128);
  const mqTex = new THREE.CanvasTexture(mq); mqTex.colorSpace = THREE.SRGBColorSpace;
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.18), new THREE.MeshBasicMaterial({map: mqTex, toneMapped: false}));
  marquee.position.set(0, 33.4 * 0.05, (9 - 7) * 0.05 + 0.004); cab.add(marquee);
  cab.traverse(o => { if (o.isMesh) { o.userData.arcade = true; raycastables.push(o); } });
  const floorBox = {x: at.x, z: at.z, hw: at.hw, hd: at.hd, rot: at.rot};
  /** metres from a point on the floor to the cabinet's front edge (0 right in front of it) */
  const near = p => {
    const c = Math.cos(at.rot), s = Math.sin(at.rot), dx = p.x - at.x, dz = p.z - at.z, lx = dx * c - dz * s, lz = dx * s + dz * c;      // into the cabinet's frame
    return Math.hypot(Math.max(Math.abs(lx) - at.hw, 0), Math.max(lz - at.hd, 0, -(lz + at.hd)));
  };

  // ------------------------------------------------ the emulator
  let ov = null, nes = null, jsnes = null, ac = null, node = null, raf = 0, playing = null, frames = 0, view = null, gamesList = null, keysDown = new Set(), pad = [0, 0], shaOk = true;
  const emu = document.createElement('canvas'); emu.width = 256; emu.height = 240; const eg = emu.getContext('2d'), img = eg.createImageData(256, 240), px = new Uint32Array(img.data.buffer);
  const MASK = 16383, bufL = new Float32Array(MASK + 1), bufR = new Float32Array(MASK + 1); let wr = 0, rd = 0;
  const BTN = {A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7};
  const KEYS = {ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyW: 4, KeyS: 5, KeyA: 6, KeyD: 7, KeyX: 0, KeyK: 0, Space: 0, KeyZ: 1, KeyJ: 1, Enter: 3, NumpadEnter: 3, ShiftLeft: 2, ShiftRight: 2, Backspace: 2, Tab: 2};
  const maskOfKeys = () => { let m = 0; for (const k of keysDown) if (KEYS[k] !== undefined) m |= 1 << KEYS[k]; return m; };
  const maskOfGamepad = () => {
    let m = 0; const gp = navigator.getGamepads?.()[0]; if (!gp) return 0;
    const b = i => gp.buttons[i]?.pressed;
    if (b(12) || gp.axes[1] < -0.5) m |= 1 << 4; if (b(13) || gp.axes[1] > 0.5) m |= 1 << 5; if (b(14) || gp.axes[0] < -0.5) m |= 1 << 6; if (b(15) || gp.axes[0] > 0.5) m |= 1 << 7;
    if (b(1) || b(3)) m |= 1; if (b(0) || b(2)) m |= 2; if (b(8)) m |= 4; if (b(9)) m |= 8;
    return m;
  };
  const setPad = (n, m) => { for (let i = 0; i < 8; i++) { const was = (pad[n - 1] >> i) & 1, is = (m >> i) & 1; if (was !== is) (is ? nes.buttonDown : nes.buttonUp)(n, i); } pad[n - 1] = m; };

  async function ensureJsnes() {
    if (jsnes) return jsnes;
    if (!globalThis.jsnes) await import('./vendor/jsnes/jsnes.min.js');
    jsnes = globalThis.jsnes; return jsnes;
  }
  function startAudio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; return; }
      node = ac.createScriptProcessor(1024, 0, 2);
      node.onaudioprocess = e => {
        const l = e.outputBuffer.getChannelData(0), r = e.outputBuffer.getChannelData(1), vol = volume() * 0.9;
        for (let i = 0; i < l.length; i++) { if (rd !== wr) { l[i] = bufL[rd] * vol; r[i] = bufR[rd] * vol; rd = (rd + 1) & MASK; } else l[i] = r[i] = 0; }
      };
      node.connect(ac.destination);
    }
    try { node.connect(ac.destination); } catch (e) {}
    ac.resume?.();
  }
  const pushSample = (l, r) => { bufL[wr] = l; bufR[wr] = r; wr = (wr + 1) & MASK; if (wr === rd) rd = (rd + 1) & MASK; if (((wr - rd) & MASK) > 6144) rd = (wr - 2048) & MASK; };

  async function start(game) {                      // game: {id, title, url?, sha256?} from the list, or {file, title} for a file of the player's own
    const J = await ensureJsnes();
    stopGame();
    const msg = ov.querySelector('.o-arc-msg'); if (msg) msg.remove();
    unlock(); startAudio();
    let data;
    try {
      if (game.file) data = new Uint8Array(await game.file.arrayBuffer());
      else { const r = await fetch(`arcade/${game.id}.nes`, {cache: 'force-cache'}); if (!r.ok) throw new Error('arcade ' + r.status); data = new Uint8Array(await r.arrayBuffer()); }
      if (data.length < 16 || data[0] !== 78 || data[1] !== 69 || data[2] !== 83 || data[3] !== 26) throw new Error(L().badRom);
      shaOk = true;
      if (game.sha256 && crypto.subtle) { const d = await crypto.subtle.digest('SHA-256', data); shaOk = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('') === game.sha256; }
      nes = new J.NES({onFrame: buf => { for (let i = 0; i < 61440; i++) px[i] = 0xff000000 | buf[i]; eg.putImageData(img, 0, 0); }, onAudioSample: pushSample, sampleRate: ac ? ac.sampleRate : 44100});
      nes.loadROM(data);
    } catch (e) { nes = null; showMessage(String(e.message || e)); return; }
    playing = game; frames = 0; pad = [0, 0]; wr = rd = 0;
    ov.querySelector('.o-arc-menu').style.display = 'none'; ov.querySelector('.o-arc-game').textContent = game.title;
    drawBar(); run();
  }
  function showMessage(text) {
    const box = ov.querySelector('.o-arc-screen'); let m = box.querySelector('.o-arc-msg');
    if (!m) { m = document.createElement('div'); m.className = 'o-arc-msg'; box.appendChild(m); }
    m.textContent = text; ov.querySelector('.o-arc-menu').style.display = '';
  }
  function run() {
    let last = performance.now(), acc = 0; const step = 1000 / 60.0988;
    const tick = now => {
      raf = requestAnimationFrame(tick);
      acc += Math.min(100, now - last); last = now;
      let n = 0;
      while (acc >= step && n < 3) {
        acc -= step; n++;
        try { setPad(1, maskOfKeys() | maskOfGamepad()); nes.frame(); frames++; }
        catch (e) { stopGame(); showMessage(L().crashed); return; }
      }
      if (n === 3) acc = 0;
      view = {frames, acc, n, now, last, step};
    };
    raf = requestAnimationFrame(tick);
  }
  function stopGame() { cancelAnimationFrame(raf); raf = 0; nes = null; playing = null; keysDown.clear(); wr = rd = 0; try { node?.disconnect(); } catch (e) {} }

  // ------------------------------------------------ the overlay: menu, screen, bar
  async function loadList() {
    if (gamesList) return gamesList;
    try { const r = await fetch('arcade/games.json', {cache: 'no-store'}); if (r.ok) gamesList = (await r.json()).games || []; } catch (e) {}
    return gamesList;
  }
  function drawMenu() {
    const T = L(), menu = ov.querySelector('.o-arc-menu'); menu.style.display = '';
    menu.innerHTML = `<h2>${T.title}<small>${T.pressStart}</small></h2>`;
    const list = gamesList || [];
    if (!list.length) menu.insertAdjacentHTML('beforeend', `<div style="grid-column:1/-1;text-align:center;opacity:.7">${T.noList}</div>`);
    for (const g of list) {
      const b = document.createElement('button'); b.className = 'o-arc-card'; b.dataset.id = g.id;
      b.innerHTML = `<b></b><small></small>`; b.querySelector('b').textContent = g.title; b.querySelector('small').textContent = `${T.players(g.players)} · ${g.kind || ''}`;
      b.title = `${g.author || ''} · ${g.license || ''}`; b.prepend(thumb(g.id)); menu.appendChild(b);
    }
    const own = document.createElement('label'); own.className = 'o-arc-card o-arc-load'; own.title = T.ownGameTip;
    own.innerHTML = `<span>📂</span><b>${T.ownGame}</b><small>${T.ownGameTip}</small><input type="file" accept=".nes" hidden>`;
    menu.appendChild(own);
    sel = 0; markSel();
  }
  let sel = 0;
  const cards = () => [...ov.querySelectorAll('.o-arc-menu .o-arc-card')];
  const markSel = () => { const c = cards(); c.forEach((e, i) => e.classList.toggle('o-sel', i === sel)); c[sel]?.scrollIntoView?.({block: 'nearest'}); };
  function drawBar() {
    const T = L(), bar = ov.querySelector('.o-arc-bar');
    bar.innerHTML = `<span class="o-arc-keys">${T.keys}</span>`
      + (playing && playing.id ? `<span>🏆 <input type="number" min="0" max="999999999" class="o-arc-score" placeholder="${T.scorePlaceholder}"> <button data-act="save">${T.saveScore}</button></span>` : '')
      + (playing && playing.id && !shaOk ? `<span style="color:#ffab91">⚠ ${T.sha}</span>` : '') + (playing ? `<button data-act="menu">${T.menu} (Esc)</button>` : '');
  }
  function open() {
    if (ov) return;
    onOpen();
    ov = document.createElement('div'); ov.className = 'o-arc-ov'; ov.tabIndex = -1;
    ov.innerHTML = `<div class="o-arc"><div class="o-arc-top"><b class="o-arc-title">🕹 ${L().title}</b><span class="o-arc-game"></span><button class="o-arc-x">✕ Esc</button></div>
      <div class="o-arc-screen"></div><div class="o-arc-bar"></div></div>`;
    const box = ov.querySelector('.o-arc-screen'); emu.style.cssText = ''; box.appendChild(emu);
    const menu = document.createElement('div'); menu.className = 'o-arc-menu'; box.appendChild(menu);
    for (const ev of ['pointerdown', 'wheel', 'keydown']) ov.addEventListener(ev, e => e.stopPropagation());
    ov.addEventListener('click', onClick);
    ov.addEventListener('change', e => { const f = e.target.files?.[0]; if (f && e.target.type === 'file') start({file: f, title: f.name.replace(/\.nes$/i, '')}); });
    root.appendChild(ov); addEventListener('keydown', onKey, true); addEventListener('keyup', onKeyUp, true);
    drawBar(); drawMenu(); loadList().then(l => { if (ov && !playing && l) drawMenu(); }); ov.focus();
  }
  function close() {
    if (!ov) return;
    stopGame(); removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKeyUp, true);
    ov.remove(); ov = null;
  }
  function backToMenu() { stopGame(); ov.querySelector('.o-arc-game').textContent = ''; ov.querySelector('.o-arc-msg')?.remove(); drawBar(); drawMenu(); }
  function onClick(e) {
    if (e.target.closest('.o-arc-x')) return close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'menu') return backToMenu();
    if (act === 'save') {
      const inp = ov.querySelector('.o-arc-score'), n = Math.round(+inp.value);
      if (playing?.id && n >= 0 && Number.isFinite(n)) { report({game: 'arc-' + playing.id, score: n}); inp.value = ''; say(L().saved); }
      return;
    }
    const card = e.target.closest('.o-arc-card[data-id]');
    if (card) { const g = (gamesList || []).find(x => x.id === card.dataset.id); if (g) start({...g}); }
  }
  function onKey(e) {
    if (!ov) return;
    const typing = e.target?.matches?.('input[type="number"], input[type="text"], textarea');
    if (typing) { if (e.key === 'Escape') e.target.blur(); e.stopImmediatePropagation(); return; }
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); return playing || ov.querySelector('.o-arc-msg') ? backToMenu() : close(); }
    if (playing) { if (KEYS[e.code] !== undefined) { e.preventDefault(); keysDown.add(e.code); } return; }
    const c = cards(); if (!c.length) return;
    if (e.key === 'ArrowRight') sel = Math.min(c.length - 1, sel + 1);
    else if (e.key === 'ArrowLeft') sel = Math.max(0, sel - 1);
    else if (e.key === 'ArrowDown') sel = Math.min(c.length - 1, sel + 4);
    else if (e.key === 'ArrowUp') sel = Math.max(0, sel - 4);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const k = c[sel]; return k.classList.contains('o-arc-load') ? k.querySelector('input').click() : k.click(); }
    else return;
    e.preventDefault(); markSel();
  }
  function onKeyUp(e) { if (!ov) return; if (!e.target?.matches?.('input')) e.stopImmediatePropagation(); keysDown.delete(e.code); }

  // ------------------------------------------------ each frame of the office: the cabinet's screen, lights and controls
  let lastDraw = 0;
  function update(t, from) {
    if (cab.userData.led) cab.userData.led.visible = (t % 1.2) < 0.6;
    const d = from ? Math.hypot(from.x - at.x, from.z - at.z) : 99;
    if (d > 10 && !playing) return;
    if (playing) { if (frames % 2 === 0) { sg.drawImage(emu, 0, 0); scrTex.needsUpdate = true; } }
    else if (t - lastDraw > 0.25) { lastDraw = t; drawAttract(sg, t, L()); scrTex.needsUpdate = true; }
    const m = playing ? pad[0] : 0, x = (m & 128 ? 1 : 0) - (m & 64 ? 1 : 0), z = (m & 32 ? 1 : 0) - (m & 16 ? 1 : 0);
    stick.rotation.z = -x * 0.3; stick.rotation.x = z * 0.3;
    btnA.position.y = 17 * 0.05 - (m & 1 ? 0.02 : 0); btnB.position.y = 17 * 0.05 - (m & 2 ? 0.02 : 0);
  }

  return {stats: () => ({frames, nes: !!nes, raf, wr, rd, pad: pad.slice(), view}), open, close, active: () => !!ov, near, update, box: floorBox, mesh: cab, playing: () => playing, hint: () => L().hint};
}
