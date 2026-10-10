// The lounge TV with real videos. A channel is a folder of the user's own videos (~/.claude/chatroom/tv/<channel>/,
// served by the viewer) played on the screen as a texture, or a list of YouTube videos played by YouTube's own player
// laid over the screen. The remote opens a menu: the channels, and a search on YouTube. With a friend linked, a YouTube
// video can be watched together: the choice goes through the common room and both TVs play it from the same second.

/** the projective transform taking the rectangle w x h onto the quad q (4 points, clockwise from top left), as CSS */
function quadMatrix(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {                                             // Gaussian elimination with pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const [a, bb, c, d, e, f, g, hh] = b.map((v, i) => v / A[i][i]);
  return `matrix3d(${[a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1].join(',')})`;
}

const CSS = `
.o-tvmenu { position: absolute; inset: 0; background: rgba(6,8,14,.66); display: flex; align-items: center; justify-content: center; z-index: 30; }
.o-tvbox { width: min(760px, 94vw); max-height: 86%; display: flex; flex-direction: column; background: #10131b; color: #e8eaf0; border-radius: 14px;
           box-shadow: 0 18px 50px rgba(0,0,0,.55); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; overflow: hidden; }
.o-tvhead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: linear-gradient(90deg, #1d2333, #151a26); }
.o-tvhead b { font-size: 16px; flex: 1; }
.o-tvtabs { display: flex; gap: 6px; padding: 10px 14px 0; }
.o-tvtabs button, .o-tvhead button, .o-tvsearch button { background: #222a3a; color: #e8eaf0; border: 1px solid #334058; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; }
.o-tvtabs button.o-on { background: #e53935; border-color: #e53935; }
.o-tvbody { padding: 12px 14px 14px; overflow: auto; }
.o-tvgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.o-tvcard { background: #1a2030; border: 1px solid #263048; border-radius: 10px; overflow: hidden; cursor: pointer; text-align: left; color: inherit; font: inherit; padding: 0; }
.o-tvcard:hover, .o-tvcard:focus-visible { border-color: #e53935; outline: none; }
.o-tvcard.o-on { border-color: #ffd54f; }
.o-tvcard img, .o-tvcard .o-tvicon { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #0b0e15; }
.o-tvcard .o-tvicon { display: flex; align-items: center; justify-content: center; font-size: 34px; }
.o-tvcard div { padding: 6px 8px 8px; }
.o-tvcard small { display: block; opacity: .6; margin-top: 2px; }
.o-tvsearch { display: flex; gap: 8px; margin-bottom: 10px; }
.o-tvsearch input { flex: 1; background: #0b0e15; color: #e8eaf0; border: 1px solid #334058; border-radius: 8px; padding: 7px 10px; font: inherit; }
.o-tvtogether { display: flex; align-items: center; gap: 6px; opacity: .9; }
`;

export function createTV({THREE, scene, camera, renderer, root, tvMesh, table, raycastables, say, t, linked, onTogether}) {
  if (!tvMesh) return {update() {}, menu() {}, near: () => Infinity, remote: null, together() {}, open: () => false};
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  // the screen: on the TV's front, near its top, 16:9
  tvMesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(tvMesh), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const rot = tvMesh.rotation.y, n = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const alongX = Math.abs(n.z) > Math.abs(n.x), w = (alongX ? size.x : size.z) * 0.86, h = w * 9 / 16;
  const at = mid.clone();
  if (alongX) at.z = (n.z > 0 ? box.max.z : box.min.z) + n.z * 0.012; else at.x = (n.x > 0 ? box.max.x : box.min.x) + n.x * 0.012;
  at.y = box.max.y - h / 2 - size.y * 0.05;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color: '#050608', toneMapped: false}));
  screen.position.copy(at); screen.rotation.y = rot; scene.add(screen);

  // the remote, on the low table in front of the TV
  let remote = null;
  if (table) {
    const tb = new THREE.Box3().setFromObject(table), tc = tb.getCenter(new THREE.Vector3());
    remote = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.17), new THREE.MeshStandardMaterial({color: '#1d1f24', roughness: 0.6}));
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.02), new THREE.MeshStandardMaterial({color: '#e53935', emissive: '#e53935', emissiveIntensity: 0.6}));
    red.position.set(0, 0.016, -0.055); remote.add(body, red);
    remote.position.set(tc.x + 0.15, tb.max.y + 0.013, tc.z); remote.rotation.y = rot + 0.3;
    remote.traverse(o => { o.userData.remote = true; if (o.isMesh) raycastables.push(o); });
    scene.add(remote);
  }

  // what plays: a video element for the user's files, YouTube's player (big, so it sends high quality) for YouTube
  const video = Object.assign(document.createElement('video'), {muted: true, playsInline: true, preload: 'auto'});
  const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace;
  const frame = Object.assign(document.createElement('iframe'), {allow: 'autoplay; encrypted-media', title: 'TV', tabIndex: -1});
  const FW = 1280, FH = 720;
  Object.assign(frame.style, {position: 'absolute', left: '0', top: '0', width: FW + 'px', height: FH + 'px', border: '0', transformOrigin: '0 0',
                              pointerEvents: 'none', display: 'none', zIndex: '1', background: '#000'});
  root.appendChild(frame);
  let channels = [], now = {kind: 'off'}, file = 0, seenAt = 0, hidden = true, menuEl = null;

  function local(c) {
    frame.style.display = 'none'; frame.src = 'about:blank';
    video.loop = c.files.length === 1;
    video.src = `tv/${encodeURIComponent(c.name)}/${encodeURIComponent(c.files[file % c.files.length])}`;
    video.play().catch(() => {});
    screen.material.map = tex; screen.material.color.set('#ffffff'); screen.material.needsUpdate = true;
  }
  function youtube(ids, start = 0) {
    video.pause(); video.removeAttribute('src'); video.load();
    screen.material.map = null; screen.material.color.set('#050608'); screen.material.needsUpdate = true;
    frame.src = `https://www.youtube-nocookie.com/embed/${ids[0]}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ids.join(',')}`
              + `&playsinline=1&rel=0&modestbranding=1&vq=hd720${start > 0 ? '&start=' + Math.floor(start) : ''}`;
  }
  function channel(i) {
    const c = channels[i];
    if (!c) return;
    now = {kind: 'channel', i, name: c.name}; file = 0;
    if (c.files) local(c); else youtube(c.youtube);
    say(`📺 ${c.name}`);
  }
  /** a YouTube video; `at` is when it started (seconds since 1970), so a friend joins at the same second */
  function watch(v, title, at = Date.now() / 1000, share = false) {
    now = {kind: 'video', v, title};
    youtube([v], Math.max(0, Date.now() / 1000 - at));
    say(`📺 ${title || v}`);
    if (share) onTogether?.(v, title, at);
  }
  video.addEventListener('ended', () => { const c = channels[now.i]; if (now.kind === 'channel' && c?.files?.length > 1) { file++; local(c); } });
  fetch('tv.json', {cache: 'no-store'}).then(r => {
    if (!r.ok) { say(t().oldServer); return {channels: []}; }                // the viewer server predates the TV
    return r.json();
  }).then(d => { channels = d.channels || []; if (channels.length && now.kind === 'off') channel(0); }).catch(() => {});

  // the menu: channels and a YouTube search, with "watch together" when a friend is linked
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const dur = s => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';
  let tab = 'channels', results = [], query = '', together = true;
  function drawMenu() {
    if (!menuEl) return;
    const L = t();
    const cards = tab === 'channels'
      ? channels.map((c, i) => `<button class="o-tvcard${now.kind === 'channel' && now.i === i ? ' o-on' : ''}" data-ch="${i}">${c.youtube
          ? `<img alt="" src="https://i.ytimg.com/vi/${c.youtube[0]}/mqdefault.jpg">` : '<span class="o-tvicon">🎞️</span>'}<div>${esc(c.name)}<small>${c.youtube ? 'YouTube' : L.tvLocal(c.files.length)}</small></div></button>`).join('')
        || `<div class="o-meta">${esc(L.tvNoChannels)}</div>`
      : results.map(r => `<button class="o-tvcard${now.v === r.id ? ' o-on' : ''}" data-v="${r.id}" data-title="${esc(r.title)}"><img alt="" src="https://i.ytimg.com/vi/${r.id}/mqdefault.jpg">`
          + `<div>${esc(r.title)}<small>${esc(r.channel)} ${dur(r.duration)}</small></div></button>`).join('') || `<div class="o-meta">${esc(query ? L.tvNothing : L.tvSearchHint)}</div>`;
    menuEl.querySelector('.o-tvbody').innerHTML = (tab === 'search'
      ? `<form class="o-tvsearch"><input name="q" value="${esc(query)}" placeholder="${esc(L.tvSearchPh)}" autocomplete="off"><button>🔎 ${esc(L.tvSearch)}</button></form>` : '')
      + `<div class="o-tvgrid">${cards}</div>`;
    menuEl.querySelectorAll('.o-tvtabs button').forEach(b => b.classList.toggle('o-on', b.dataset.tab === tab));
    const tg = menuEl.querySelector('.o-tvtogether'); tg.style.display = linked() ? '' : 'none'; tg.querySelector('input').checked = together;
    const input = menuEl.querySelector('.o-tvsearch input'); if (input && !query) input.focus();
  }
  function menu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    const L = t();
    menuEl = document.createElement('div'); menuEl.className = 'o-tvmenu';
    menuEl.innerHTML = `<div class="o-tvbox"><div class="o-tvhead"><b>📺 ${esc(L.tvTitle)}</b>
        <label class="o-tvtogether"><input type="checkbox"> 👥 ${esc(L.tvTogether)}</label><button data-x>✕</button></div>
      <div class="o-tvtabs"><button data-tab="channels">${esc(L.tvChannels)}</button><button data-tab="search">🔎 ${esc(L.tvYoutube)}</button></div>
      <div class="o-tvbody"></div></div>`;
    menuEl.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === menuEl) close(); });
    menuEl.addEventListener('wheel', e => e.stopPropagation());
    menuEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    menuEl.addEventListener('change', e => { if (e.target.closest('.o-tvtogether')) together = e.target.checked; });
    menuEl.addEventListener('submit', async e => {
      e.preventDefault(); query = e.target.q.value.trim(); if (!query) return;
      results = []; menuEl.querySelector('.o-tvgrid').innerHTML = `<div class="o-meta">${esc(t().tvLooking)}</div>`;
      try {
        const r = await fetch('tv/search?q=' + encodeURIComponent(query), {cache: 'no-store'});
        results = r.ok ? (await r.json()).results : [];
        if (!r.ok) say(r.status === 404 ? t().oldServer : await r.text());
      } catch (err) { results = []; }
      drawMenu();
    });
    menuEl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x !== undefined) return close();
      if (b.dataset.tab) { tab = b.dataset.tab; return drawMenu(); }
      if (b.dataset.ch) { channel(+b.dataset.ch); return close(); }
      if (b.dataset.v) { watch(b.dataset.v, b.dataset.title, Date.now() / 1000, together && linked()); return close(); }
    });
    root.appendChild(menuEl);
    drawMenu();
  }
  const close = () => { if (menuEl) { menuEl.remove(); menuEl = null; } };

  const _p = new THREE.Vector3(), _ray = new THREE.Raycaster(), corners = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]];
  return {
    remote,
    menu,
    open: () => !!menuEl,
    /** how far a point is from the remote (for E in first person) */
    near: p => remote ? Math.hypot(p.x - remote.position.x, p.z - remote.position.z) : Infinity,
    /** a friend chose a video to watch together */
    together(line, who) { if (line.v && line.v !== now.v) { watch(line.v, line.title, line.t, false); say(`📺 ${who}: ${line.title || line.v}`); } },
    /** each frame: YouTube's player follows the screen on the page, and hides when the screen cannot be seen */
    update(time) {
      if (now.kind === 'off' || (now.kind === 'channel' && channels[now.i]?.files)) return;
      const rect = renderer.domElement.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const facing = _p.copy(camera.position).sub(at).dot(n) > 0.05;
      const q = corners.map(([x, y]) => { _p.set(x, y, 0); screen.localToWorld(_p); _p.project(camera);
                                          return [(_p.x * 0.5 + 0.5) * rect.width + rect.left - rr.left, (-_p.y * 0.5 + 0.5) * rect.height + rect.top - rr.top, _p.z]; });
      let show = facing && q.every(p => p[2] < 1) && q.some(p => p[0] > 0 && p[0] < rect.width && p[1] > 0 && p[1] < rect.height);
      if (show && time - seenAt > 0.25) {                                    // something in front of the screen hides it
        seenAt = time;
        const dist = camera.position.distanceTo(at);
        _ray.set(camera.position, _p.copy(at).sub(camera.position).normalize());
        const hit = _ray.intersectObjects(scene.children, true).find(x => x.object.visible && x.object !== screen && !x.object.isSprite && !x.object.userData.person
                                                                       && x.object.material && !x.object.material.transparent);
        hidden = !!hit && hit.distance < dist - 0.08;
      }
      show = show && !hidden;
      frame.style.display = show ? '' : 'none';
      if (show) frame.style.transform = quadMatrix(FW, FH, q.map(p => [p[0], p[1]]));
    },
  };
}
