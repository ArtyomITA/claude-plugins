// The office editor: move, turn, add, remove, recolour and label the furniture of your own office, then save it to
// ~/.claude/chatroom/office.json through the viewer's server (never into a repository). Walls, glass rooms and the
// cubicle blocks stay as the layout draws them; seats, spots and the walking plan follow the saved pieces after the
// reload that saving does.
import * as THREE from 'three';
import * as V from './office-voxel.js';
import {CATALOG} from './office-layout.js';

const CSS = `
#office .o-edit { position: absolute; left: 12px; top: 52px; bottom: 70px; width: 300px; overflow: auto; background: #14151df2; border-radius: 4px;
  box-shadow: 4px 4px 0 #0009; padding: 12px; display: none; }
#office .o-edit.o-open { display: block; }
#office .o-edit h3 { margin: 0 0 6px; font-size: 15px; }
#office .o-edit h4 { margin: 10px 0 4px; font-size: 12.5px; opacity: .8; text-transform: uppercase; letter-spacing: .05em; }
#office .o-edit .o-meta { opacity: .7; font-size: 11.5px; }
#office .o-edit input[type=text], #office .o-edit input[type=search], #office .o-edit input[type=number] { width: 100%; box-sizing: border-box;
  background: #22242f; color: #f4f1ea; border: 1px solid #ffffff22; border-radius: 3px; padding: 5px 7px; font: inherit; }
#office .o-edit .o-grid { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; }
#office .o-edit .o-field { display: flex; align-items: center; gap: 6px; margin: 5px 0; }
#office .o-edit .o-field > span { width: 70px; opacity: .8; font-size: 12px; }
#office .o-edit .o-list { max-height: 260px; overflow: auto; margin-top: 5px; }
#office .o-edit .o-list div { padding: 4px 6px; border-bottom: 1px solid #ffffff0d; cursor: pointer; font-size: 12px; }
#office .o-edit .o-list div:hover, #office .o-edit .o-list div:focus-visible { background: #ffffff14; }
#office .o-edit .o-danger { background: #8e2424; }
#office .o-edit .o-primary { background: #f5b400; color: #222; }
`;

const NAMES = {
  bossDesk: ['Scrivania del boss', "Boss's desk"], bossChair: ['Poltrona del boss', "Boss's chair"], laptop: ['Portatile', 'Laptop'],
  shelf: ['Libreria', 'Bookshelf'], smallDesk: ['Scrivanietta', 'Small desk'], chair: ['Sedia da ufficio', 'Office chair'],
  confTable: ['Tavolo riunioni', 'Meeting table'], meetChair: ['Sedia riunioni', 'Meeting chair'], kitchen: ['Cucina', 'Kitchen run'],
  upperCabinets: ['Pensili', 'Wall cabinets'], fridge: ['Frigo', 'Fridge'], waterCooler: ["Distributore d'acqua", 'Water cooler'],
  barTable: ['Tavolo alto', 'High table'], barStool: ['Sgabello', 'Bar stool'], sofa: ['Divano voxel', 'Voxel sofa'], armchair: ['Poltrona', 'Armchair'],
  coffeeTable: ['Tavolino', 'Coffee table'], rack: ['Server rack', 'Server rack'], printer: ['Stampante', 'Printer'], planter: ['Pianta in vaso', 'Potted plant'],
  floorLamp: ['Lampada', 'Floor lamp'], foosball: ['Biliardino', 'Table football'], deskChair: ['Sedia girevole', 'Swivel chair'],
  execChair: ['Poltrona direzionale', 'Executive chair'], sideChair: ['Sedia', 'Chair'], couch: ['Divano', 'Couch'], lowTable: ['Tavolino basso', 'Low table'],
  table: ['Tavolo', 'Table'], cabinet: ['Schedario', 'Filing cabinet'], plantTall: ['Pianta alta', 'Tall plant'], plantPot: ['Pianta piccola', 'Small plant'],
  trash: ['Cestino', 'Bin'], recycle: ['Differenziata', 'Recycling bin'], tvWall: ['TV a parete', 'Wall TV'], tvStand: ['TV su mobile', 'TV on a stand'],
  console: ['Console', 'Console'], espresso: ['Macchina espresso', 'Espresso machine'], coffeeMaker: ['Macchina del caffè', 'Coffee maker'],
  corkboard: ['Bacheca', 'Corkboard'], wallGraph: ['Grafico', 'Wall chart'], cafeTable: ['Tavolino bar', 'Café table'], cafeChair: ['Sedia bar', 'Café chair'],
  barCounter: ['Bancone', 'Bar counter'], vending: ['Distributore bibite', 'Vending machine'], lockers: ['Armadietti', 'Lockers'],
  pingPong: ['Ping-pong', 'Table tennis'], beanBag: ['Pouf', 'Bean bag'], reception: ['Reception', 'Reception desk'],
  binders: ['Libreria raccoglitori', 'Binder shelf'], copier: ['Fotocopiatrice', 'Copier'],
};
const T = {
  it: {title: '🛠 Arreda il tuo ufficio', help: 'trascina un oggetto per spostarlo (Maiusc: senza griglia) · R ruota · C duplica · Canc elimina · Esc',
       none: 'Clicca un oggetto per sceglierlo.', label: 'Etichetta', color: 'Colore', hue: 'Tinta', original: 'originale', height: 'Altezza',
       turn: 'Ruota', dup: 'Duplica', del: 'Elimina', add: 'Aggiungi', search: 'cerca un oggetto…', ours: 'nostro', pack: 'pacchetto',
       save: 'Salva e ricarica', discard: 'Annulla modifiche', reset: 'Ufficio di default', saved: 'Salvato', unsaved: 'modifiche non salvate'},
  en: {title: '🛠 Furnish your office', help: 'drag a piece to move it (Shift: no grid) · R turn · C duplicate · Del remove · Esc',
       none: 'Click a piece to pick it.', label: 'Label', color: 'Colour', hue: 'Hue', original: 'original', height: 'Height',
       turn: 'Turn', dup: 'Duplicate', del: 'Remove', add: 'Add', search: 'search a piece…', ours: 'ours', pack: 'pack',
       save: 'Save and reload', discard: 'Discard changes', reset: 'Default office', saved: 'Saved', unsaved: 'unsaved changes'},
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const packLabel = name => name.split('/').pop().replace(/^Office_(Misc_)?/, '').replace('Traschcan', 'Trashcan').replace(/_/g, ' ');

/** ctx: scene, camera, controls, renderer, root, layout, meshes (the live list of editable meshes, userData.src = index
 *  into layout.items), place(item) -> a mesh already in the scene, lang() -> 'it' | 'en' */
export function createEditor({scene, camera, controls, renderer, root, layout, meshes, place, lang}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement('div'); panel.className = 'o-edit'; root.appendChild(panel);
  const items = (layout.items || []).map(it => ({...it}));          // the working copy; a removed piece becomes null
  const t = () => T[lang()] || T.en, nm = type => (NAMES[type] || [type, type])[lang() === 'en' ? 1 : 0];
  const helper = new THREE.BoxHelper(new THREE.Object3D(), 0xffd54f); helper.visible = false; scene.add(helper);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let on = false, sel = null, drag = null, dirty = false, query = '';

  const meshOf = i => meshes.find(m => m.userData.src === i);
  function pickAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObjects(meshes, true)) {
      let o = h.object;
      while (o && o.userData.src === undefined) o = o.parent;
      if (o) return o.userData.src;
    }
    return null;
  }
  function floorAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(floor, hit) ? hit.clone() : null;
  }
  /** rebuild one piece's mesh after a change of model, colour or height */
  function rebuild(i) {
    const old = meshOf(i);
    if (old) { scene.remove(old); meshes.splice(meshes.indexOf(old), 1); }
    if (!items[i]) return;
    const m = place(items[i]); m.userData.src = i; m.userData.label = items[i].label || ''; meshes.push(m);
  }
  function select(i) {
    sel = i;
    const m = i === null ? null : meshOf(i);
    helper.visible = !!m;
    if (m) { helper.setFromObject(m); }
    draw();
  }
  function touch() { dirty = true; if (sel !== null && meshOf(sel)) helper.setFromObject(meshOf(sel)); }
  function turn(deg) { const it = items[sel]; if (!it) return; it.rot = ((it.rot || 0) + deg * Math.PI / 180) % (Math.PI * 2); meshOf(sel).rotation.y = it.rot; touch(); }
  function remove() { if (sel === null) return; items[sel] = null; rebuild(sel); select(null); dirty = true; }
  function duplicate() {
    const it = items[sel]; if (!it) return;
    items.push({...it, x: it.x + 0.6, z: it.z + 0.6}); rebuild(items.length - 1); select(items.length - 1); dirty = true;
  }
  function add(type, pack = null) {
    const c = controls.target, it = {type, x: Math.round(c.x * 4) / 4, z: Math.round(c.z * 4) / 4, rot: 0};
    if (pack) it.pack = pack;
    items.push(it); rebuild(items.length - 1); select(items.length - 1); dirty = true;
  }

  // dragging a piece: a capture listener runs before the orbit controls and keeps the camera still
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!on || e.button !== 0) return;
    const i = pickAt(e);
    if (i === null) return;
    e.stopImmediatePropagation();
    select(i);
    const p = floorAt(e), it = items[i];
    drag = p ? {i, dx: it.x - p.x, dz: it.z - p.z, moved: false} : null;
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  }, true);
  renderer.domElement.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = floorAt(e), it = items[drag.i], m = meshOf(drag.i);
    if (!p || !it || !m) return;
    const snap = e.shiftKey ? v => v : v => Math.round(v * 10) / 10;
    it.x = snap(p.x + drag.dx); it.z = snap(p.z + drag.dz); m.position.x = it.x; m.position.z = it.z;
    drag.moved = true; touch();
  });
  const end = () => { if (drag) { drag = null; controls.enabled = true; draw(); } };
  renderer.domElement.addEventListener('pointerup', end);
  renderer.domElement.addEventListener('pointercancel', end);
  renderer.domElement.addEventListener('click', e => { if (on && pickAt(e) === null && !drag) select(null); });
  document.addEventListener('keydown', e => {
    if (!on || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') turn(e.shiftKey ? -90 : 90);
    else if (k === 'c') duplicate();
    else if (k === 'delete' || k === 'backspace') remove();
    else if (k === 'escape') select(null);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  async function save(reset = false) {
    const body = reset ? {reset: true} : {items: items.filter(Boolean)};
    const r = await fetch('office', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (!r.ok) { alertText(await r.text()); return; }
    location.reload();
  }
  function alertText(text) { const el = panel.querySelector('.o-msg'); if (el) el.textContent = text; }

  function draw() {
    if (!on) return;
    const L = t(), it = sel !== null ? items[sel] : null, c = it && CATALOG[it.type];
    const colorField = it && c && (c.args || []).includes('color')
      ? `<label class="o-field"><span>${esc(L.color)}</span><input type="color" data-k="color" value="${esc(it.color || '#888888')}"></label>`
      : it && (it.pack || c?.pack) ? `<label class="o-field"><span>${esc(L.hue)}</span><input type="range" data-k="hue" min="0" max="1" step="0.01" value="${it.tint?.hue ?? 0.5}" ${it.tint ? '' : 'disabled'}>
          <label><input type="checkbox" data-k="orig" ${it.tint ? '' : 'checked'}> ${esc(L.original)}</label></label>` : '';
    const list = [...Object.keys(CATALOG).filter(k => !['cubicle', 'pack'].includes(k)).map(k => ({type: k, text: nm(k), tag: L.ours})),
                  ...V.packNames().map(p => ({type: 'pack', pack: p, text: packLabel(p), tag: L.pack}))]
      .filter(o => !query || o.text.toLowerCase().includes(query.toLowerCase())).slice(0, 80);
    panel.innerHTML = `<h3>${esc(L.title)}</h3><div class="o-meta">${esc(L.help)}</div>
      <h4>${it ? esc(it.pack ? packLabel(it.pack) : nm(it.type)) : '—'}</h4>
      ${it ? `<label class="o-field"><span>${esc(L.label)}</span><input type="text" data-k="label" maxlength="60" value="${esc(it.label || '')}"></label>
        ${colorField}
        <label class="o-field"><span>${esc(L.height)}</span><input type="number" data-k="y" step="0.05" min="0" max="3" value="${it.y ?? 0}"></label>
        <div class="o-grid"><button data-a="l">⟲ 15°</button><button data-a="r">⟳ 15°</button><button data-a="q">↻ 90°</button>
          <button data-a="dup">${esc(L.dup)}</button><button data-a="del" class="o-danger">${esc(L.del)}</button></div>` : `<div class="o-meta">${esc(L.none)}</div>`}
      <h4>${esc(L.add)}</h4><input type="search" data-k="q" placeholder="${esc(L.search)}" value="${esc(query)}">
      <div class="o-list">${list.map((o, k) => `<div tabindex="0" data-i="${k}">${esc(o.text)} <span class="o-meta">· ${esc(o.tag)}</span></div>`).join('')}</div>
      <div class="o-grid" style="margin-top:10px"><button data-a="save" class="o-primary">${esc(L.save)}</button><button data-a="discard">${esc(L.discard)}</button>
        <button data-a="reset">${esc(L.reset)}</button></div><div class="o-meta o-msg">${dirty ? esc(L.unsaved) : ''}</div>`;
    panel.querySelectorAll('.o-list [data-i]').forEach(el => {
      const o = list[+el.dataset.i], go = () => add(o.type, o.pack || null);
      el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
    const q = panel.querySelector('[data-k="q"]');
    q.oninput = () => { query = q.value; draw(); const again = panel.querySelector('[data-k="q"]'); again.focus(); again.setSelectionRange(query.length, query.length); };
    const field = k => panel.querySelector(`[data-k="${k}"]`);
    if (it) {
      field('label').onchange = e => { it.label = e.target.value.trim(); const m = meshOf(sel); if (m) m.userData.label = it.label; dirty = true; draw(); };
      field('y').onchange = e => { it.y = Math.max(0, Math.min(3, +e.target.value || 0)); meshOf(sel).position.y = it.y; touch(); };
      if (field('color')) field('color').onchange = e => { it.color = e.target.value; rebuild(sel); select(sel); dirty = true; };
      if (field('hue')) field('hue').onchange = e => { it.tint = {hue: +e.target.value}; rebuild(sel); select(sel); dirty = true; };
      if (field('orig')) field('orig').onchange = e => { if (e.target.checked) delete it.tint; else it.tint = {hue: 0.5}; rebuild(sel); select(sel); dirty = true; };
      panel.querySelector('[data-a="l"]').onclick = () => turn(15);
      panel.querySelector('[data-a="r"]').onclick = () => turn(-15);
      panel.querySelector('[data-a="q"]').onclick = () => turn(90);
      panel.querySelector('[data-a="dup"]').onclick = duplicate;
      panel.querySelector('[data-a="del"]').onclick = remove;
    }
    panel.querySelector('[data-a="save"]').onclick = () => save(false);
    panel.querySelector('[data-a="discard"]').onclick = () => location.reload();
    panel.querySelector('[data-a="reset"]').onclick = () => save(true);
  }

  return {
    active: () => on,
    toggle() {
      on = !on;
      panel.classList.toggle('o-open', on);
      if (!on) { select(null); drag = null; controls.enabled = true; }
      else draw();
      return on;
    },
  };
}
