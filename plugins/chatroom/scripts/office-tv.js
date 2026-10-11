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

// Placed sound: Web Audio fades a sound with distance and puts it left or right. A page can only place a sound it
// serves itself (another site's player is closed to it), so YouTube's sound comes through the viewer (tv/audio/<id>,
// found by yt-dlp) while YouTube's player shows the picture, muted. In the sound's own area it is full and centred.
let ac = null;
/** an audio or video element through a gain and a stereo panner */
function speaker(el) {
  ac ??= new AudioContext();
  const gain = ac.createGain(), pan = ac.createStereoPanner();
  ac.createMediaElementSource(el).connect(gain).connect(pan).connect(ac.destination);
  return {gain, pan};
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => ac?.state === 'suspended' && ac.resume(), true);
/** [gain, side] of a sound at `src` whose area is the rectangle `area`, heard by a figure at `me` looking through
 *  `camera`: inside the area 1 and 0; outside it fades with the distance and comes from where it is (right = +1) */
export function hear(area, src, me, camera) {
  const d = Math.hypot(Math.max(area.x0 - me.x, 0, me.x - area.x1), Math.max(area.z0 - me.z, 0, me.z - area.z1));
  if (d < 0.05) return [1, 0];
  const e = camera.matrixWorld.elements, fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
  const tx = src.x - me.x, tz = src.z - me.z, tl = Math.hypot(tx, tz) || 1;
  const side = (-fz * tx + fx * tz) / fl / tl;                                 // the camera's right is (-fz, fx)
  return [Math.max(0, 1 - d / 30) / (1 + d / 3), Math.max(-0.85, Math.min(0.85, side * 0.85 * Math.min(1, d / 2)))];
}
/** move a speaker's gain and side smoothly */
function steer(nodes, g, p) {
  nodes.gain.gain.setTargetAtTime(g, ac.currentTime, 0.12);
  nodes.pan.pan.setTargetAtTime(p, ac.currentTime, 0.12);
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
.o-tvctl { display: flex; align-items: center; gap: 8px; padding: 10px 14px 0; flex-wrap: wrap; }
.o-tvctl button { background: #222a3a; color: #e8eaf0; border: 1px solid #334058; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; min-width: 44px; }
.o-tvctl button:hover { background: #2f3a52; }
.o-tvctl input[type=range] { width: 120px; accent-color: #e53935; }
.o-tvtime { opacity: .75; font-variant-numeric: tabular-nums; margin-left: auto; }
.o-tvfull { position: fixed; inset: 0; background: #000; z-index: 60; display: flex; align-items: center; justify-content: center; }
.o-tvfull iframe, .o-tvfull video { width: 100%; height: 100%; border: 0; background: #000; }
.o-tvfull button { position: absolute; top: 12px; right: 12px; z-index: 1; background: #000a; color: #fff; border: 1px solid #fff6; border-radius: 8px;
                   padding: 6px 12px; cursor: pointer; font: 14px "Segoe UI", system-ui, sans-serif; }
`;

export function createTV({THREE, scene, camera, renderer, root, tvMesh, table, raycastables, say, t, linked, onTogether, ear, area}) {
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
  area ??= {x0: at.x - 3, z0: at.z - 3, x1: at.x + 3, z1: at.z + 3};       // no floor zone around the TV: 3 m all round

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
  let channels = [], now = {kind: 'off'}, file = 0, seenAt = 0, hidden = true, menuEl = null, playing = null, fullEl = null, sound = false;
  try { sound = localStorage.getItem('chatroom.tv.sound') === '1'; } catch (e) {}
  let off = false;                                   // switched off by the user: stays off (also after a reload) until a channel or video is chosen
  try { off = localStorage.getItem('chatroom.tv.off') === '1'; } catch (e) {}
  let vol = 80, ytTime = 0, ytDur = 0, ytState = -1, ytSeen = 0, holdPause = false;
  try { vol = Math.max(0, Math.min(100, +(localStorage.getItem('chatroom.tv.vol') ?? 80))); } catch (e) {}
  // the sound: the user's files through a placed speaker; YouTube's sound through the viewer, beside the muted picture
  const aud = Object.assign(new Audio(), {preload: 'auto'});
  let vNodes = null, aNodes = null, audOk = true, audId = '', ytVid = '', syncAt = 0, heardAt = 0, flatAt = 0, heard = 1;
  aud.addEventListener('error', () => {              // no yt-dlp here, or YouTube refused: its own sound, fading but without sides
    if (!aud.getAttribute('src') || !audOk) return;
    audOk = false; aud.removeAttribute('src'); audId = ''; audio(); say(t().tvFlat);
  });
  /** the separate sound keeps to YouTube's picture: same video, same second, playing or not */
  function follow() {
    if (!audOk || now.kind === 'off' || isLocal() || !ytVid) return;
    if (audId !== ytVid) { audId = ytVid; aud.src = `tv/audio/${ytVid}`; }
    if (ytState !== 1 || fullEl) { if (!aud.paused) aud.pause(); return; }
    const want = position(), clock = performance.now() / 1000;
    if (aud.readyState >= 1 && !aud.seeking && Math.abs(aud.currentTime - want) > 0.5 && clock - syncAt > 3) { syncAt = clock; aud.currentTime = want; }
    if (aud.paused) aud.play().catch(() => {});
  }
  // YouTube's iframe API: commands go in by postMessage, the time and state come back the same way
  const yt = (func, args = []) => frame.contentWindow?.postMessage(JSON.stringify({event: 'command', func, args}), '*');
  let hello = 0;                                     // ask the player for its news until it answers (it may not be ready at load)
  frame.addEventListener('load', () => {
    clearInterval(hello);
    let tries = 0;
    hello = setInterval(() => { if (++tries > 20) clearInterval(hello); else frame.contentWindow?.postMessage(JSON.stringify({event: 'listening', id: 'tv', channel: 'widget'}), '*'); }, 250);
  });
  const canSound = () => sound && navigator.userActivation?.hasBeenActive !== false;
  addEventListener('message', e => {
    if (e.source !== frame.contentWindow) return;
    let d; try { d = JSON.parse(e.data); } catch (err) { return; }
    const info = d && d.info;
    if (d?.event === 'onReady' || d?.event === 'initialDelivery') { clearInterval(hello); audio(); }
    if (!info || typeof info !== 'object') return;
    if (typeof info.currentTime === 'number') { ytTime = info.currentTime; ytSeen = Date.now() / 1000; }
    if (typeof info.duration === 'number') ytDur = info.duration;
    const vid = info.videoData?.video_id;                                         // a channel's playlist moved on
    if (typeof vid === 'string' && /^[\w-]{11}$/.test(vid)) ytVid = vid;
    if (typeof info.playerState === 'number') {
      ytState = info.playerState;
      if (ytState === 1 && holdPause) { holdPause = false; yt('pauseVideo'); }   // a friend's pause arrived before the video started
    }
    follow();
  });
  /** sound as chosen, as soon as the browser allows it (after the first click or key on the page) */
  function audio() {
    if (isLocal()) { video.muted = !canSound(); return; }
    if (audOk) { yt('mute'); aud.muted = !canSound(); return; }
    yt('setVolume', [Math.round(vol * heard)]);
    yt(canSound() ? 'unMute' : 'mute');
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (sound) setTimeout(audio, 0); }, {capture: true, once: true});
  /** where the video is now, in seconds, and whether it is paused */
  const position = () => isLocal() ? video.currentTime : ytSeen ? ytTime + (ytState === 1 ? Date.now() / 1000 - ytSeen : 0) : playing ? Date.now() / 1000 - playing.at : 0;
  const paused = () => isLocal() ? video.paused : ytState === 2 || holdPause;
  function seek(pos) {
    pos = Math.max(0, pos);
    if (isLocal()) video.currentTime = pos;
    else { yt('seekTo', [pos, true]); ytTime = pos; ytSeen = Date.now() / 1000; if (playing) playing.at = Date.now() / 1000 - pos; }
  }
  /** play or pause; the player's own news corrects the state a moment later */
  function run(on) {
    if (isLocal()) { if (on) video.play().catch(() => {}); else video.pause(); return; }
    ytTime = position(); ytSeen = Date.now() / 1000; ytState = on ? 1 : 2;
    holdPause = !on;                                 // a pause sent while the video is still loading would be lost
    yt(on ? 'playVideo' : 'pauseVideo');
  }
  /** the remote: every action also goes to friends watching together */
  function control(what) {
    const p = position();
    if (what === 'play') { const on = paused(); run(on); share(on ? 'play' : 'pause', p, !on); }
    else {
      const to = what === 'start' ? 0 : p + (what === 'back' ? -10 : 10);
      seek(to); share('seek', Math.max(0, to), paused());
    }
  }
  function share(op, pos, isPaused) {
    if (now.kind !== 'video' || !together || !linked()) return;
    const at = Date.now() / 1000;
    onTogether?.({op, v: now.v, title: now.title, t: at - pos, pos, at, paused: isPaused});
  }

  function local(c) {
    frame.style.display = 'none'; frame.src = 'about:blank'; aud.pause();
    vNodes ??= speaker(video);
    video.loop = c.files.length === 1; video.muted = !canSound();
    video.src = `tv/${encodeURIComponent(c.name)}/${encodeURIComponent(c.files[file % c.files.length])}`;
    video.play().catch(() => {});
    screen.material.map = tex; screen.material.color.set('#ffffff'); screen.material.needsUpdate = true;
  }
  function youtube(ids, start = 0) {
    video.pause(); video.removeAttribute('src'); video.load();
    screen.material.map = null; screen.material.color.set('#050608'); screen.material.needsUpdate = true;
    playing = {ids, at: Date.now() / 1000 - start};
    ytTime = start; ytSeen = 0; ytState = -1;
    aud.pause(); audId = ''; ytVid = ids[0]; audOk = true; aNodes ??= speaker(aud); aud.muted = !canSound();
    frame.src = `https://www.youtube-nocookie.com/embed/${ids[0]}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ids.join(',')}`
              + `&playsinline=1&rel=0&modestbranding=1&vq=hd720&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
              + `${start > 0 ? '&start=' + Math.floor(start) : ''}`;
  }
  /** off: nothing plays, the screen goes black; on: the first channel */
  function power(on) {
    off = !on;
    try { localStorage.setItem('chatroom.tv.off', off ? '1' : '0'); } catch (e) {}
    if (on) return channel(0);
    now = {kind: 'off'}; playing = null;
    frame.src = 'about:blank'; frame.style.display = 'none';
    video.pause(); video.removeAttribute('src'); video.load();
    aud.pause(); aud.removeAttribute('src'); audId = '';
    screen.material.map = null; screen.material.color.set('#050608'); screen.material.needsUpdate = true;
    say('📺 ⏻');
  }
  function channel(i) {
    const c = channels[i];
    if (!c) return;
    if (off) { off = false; try { localStorage.setItem('chatroom.tv.off', '0'); } catch (e) {} }
    now = {kind: 'channel', i, name: c.name}; file = 0;
    if (c.files) local(c); else youtube(c.youtube);
    say(`📺 ${c.name}`);
  }
  /** a YouTube video; `at` is when it started (seconds since 1970), so a friend joins at the same second */
  function watch(v, title, at = Date.now() / 1000, share = false) {
    if (off) { off = false; try { localStorage.setItem('chatroom.tv.off', '0'); } catch (e) {} }
    now = {kind: 'video', v, title};
    youtube([v], Math.max(0, Date.now() / 1000 - at));
    say(`📺 ${title || v}`);
    if (share) onTogether?.({op: 'play', v, title, t: at, pos: Math.max(0, Date.now() / 1000 - at), at: Date.now() / 1000, paused: false});
  }
  video.addEventListener('ended', () => { const c = channels[now.i]; if (now.kind === 'channel' && c?.files?.length > 1) { file++; local(c); } });
  fetch('tv.json', {cache: 'no-store'}).then(r => {
    if (!r.ok) { say(t().oldServer); return {channels: []}; }                // the viewer server predates the TV
    return r.json();
  }).then(d => { channels = d.channels || []; if (channels.length && now.kind === 'off' && !off) channel(0); }).catch(() => {});

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
  const isLocal = () => now.kind === 'channel' && channels[now.i]?.files;
  function fullscreen() {
    if (fullEl || now.kind === 'off') return;
    close();
    fullEl = document.createElement('div'); fullEl.className = 'o-tvfull';
    const back = Object.assign(document.createElement('button'), {textContent: '✕ Esc'});
    fullEl.appendChild(back);
    let inner;
    if (isLocal()) {
      inner = Object.assign(document.createElement('video'), {src: video.src, controls: true, autoplay: true, muted: !sound, loop: video.loop});
      inner.addEventListener('loadedmetadata', () => { inner.currentTime = video.currentTime; }, {once: true});
      video.pause();
    } else {
      const at = Math.floor(Date.now() / 1000 - playing.at);
      inner = Object.assign(document.createElement('iframe'), {allow: 'autoplay; encrypted-media; fullscreen', allowFullscreen: true,
        src: `https://www.youtube-nocookie.com/embed/${playing.ids[0]}?autoplay=1&mute=${sound ? 0 : 1}&controls=1&loop=1&playlist=${playing.ids.join(',')}&rel=0&playsinline=1${at > 0 ? '&start=' + at : ''}`});
      frame.src = 'about:blank';                                            // one player at a time, so the sound is not doubled
    }
    fullEl.appendChild(inner);
    const leave = () => {
      if (!fullEl) return;
      if (inner.tagName === 'VIDEO') { video.currentTime = inner.currentTime; video.play().catch(() => {}); }
      else if (playing) youtube(playing.ids, Date.now() / 1000 - playing.at);
      fullEl.remove(); fullEl = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    back.onclick = leave;
    fullEl.addEventListener('keydown', e => { if (e.key === 'Escape') leave(); e.stopPropagation(); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) leave(); }, {once: true});
    document.body.appendChild(fullEl);
    fullEl.requestFullscreen?.().catch(() => {});
  }
  /** sound on or off, remembered; a YouTube video starts again from where it is, with or without sound */
  function setSound(on) {
    sound = on;
    try { localStorage.setItem('chatroom.tv.sound', on ? '1' : '0'); } catch (e) {}
    if (isLocal()) { video.muted = !on; video.play().catch(() => {}); }
    else audio();
    say(on ? '🔊' : '🔇');
  }
  function menu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    const L = t();
    menuEl = document.createElement('div'); menuEl.className = 'o-tvmenu';
    menuEl.innerHTML = `<div class="o-tvbox"><div class="o-tvhead"><b>📺 ${esc(L.tvTitle)}</b>
        <label class="o-tvtogether"><input type="checkbox"> 👥 ${esc(L.tvTogether)}</label>
        <button data-power title="${esc(L.tvOff)}">⏻</button><button data-full title="${esc(L.tvFull)}">⛶</button><button data-sound title="${esc(L.tvAudio)}">${sound ? '🔊' : '🔇'}</button><button data-x>✕</button></div>
      <div class="o-tvctl"><button data-c="start" title="${esc(L.tvStart)}">⏮</button><button data-c="back">⏪ 10</button>
        <button data-c="play" title="${esc(L.tvPlay)}">⏯</button><button data-c="fwd">10 ⏩</button>
        <label>🔊 <input type="range" min="0" max="100" step="5" value="${vol}" data-vol></label><span class="o-tvtime"></span></div>
      <div class="o-tvtabs"><button data-tab="channels">${esc(L.tvChannels)}</button><button data-tab="search">🔎 ${esc(L.tvYoutube)}</button></div>
      <div class="o-tvbody"></div></div>`;
    menuEl.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === menuEl) close(); });
    menuEl.addEventListener('wheel', e => e.stopPropagation());
    menuEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    menuEl.addEventListener('change', e => { if (e.target.closest('.o-tvtogether')) together = e.target.checked; });
    menuEl.addEventListener('input', e => {
      if (e.target.dataset.vol === undefined) return;
      vol = +e.target.value;
      try { localStorage.setItem('chatroom.tv.vol', String(vol)); } catch (err) {}
      if (vol > 0 && !sound) { setSound(true); menuEl.querySelector('[data-sound]').textContent = '🔊'; } else audio();
    });
    const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const tick = setInterval(() => {
      if (!menuEl) return clearInterval(tick);
      const el = menuEl.querySelector('.o-tvtime'), d = isLocal() ? video.duration : ytDur;
      if (el) el.textContent = now.kind === 'off' ? '' : `${paused() ? '⏸' : '▶'} ${clock(position())}${d ? ' / ' + clock(d) : ''}`;
    }, 500);
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
      if (b.dataset.power !== undefined) { power(now.kind === 'off'); return close(); }
      if (b.dataset.full !== undefined) return fullscreen();
      if (b.dataset.sound !== undefined) { setSound(!sound); b.textContent = sound ? '🔊' : '🔇'; return; }
      if (b.dataset.c) return control(b.dataset.c);
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
    fullscreen,
    /** how far a point is from the screen (T opens the menu within a few metres) */
    nearTv: p => Math.hypot(p.x - at.x, p.z - at.z),
    open: () => !!menuEl,
    /** how far a point is from the remote (for E in first person) */
    near: p => remote ? Math.hypot(p.x - remote.position.x, p.z - remote.position.z) : Infinity,
    /** a friend chose a video to watch together */
    together(line, who) {
      if (!line.v) return;
      if (off) { if (line.op !== 'pause' && line.op !== 'seek' && line.v !== now.v) say(`📺 ${who}: ${line.title || line.v} (⏻ ${t().tvIsOff})`); return; }
      const nowS = Date.now() / 1000, stop = line.op === 'pause' || line.paused;
      const pos = Math.max(0, line.pos !== undefined ? line.pos + (stop ? 0 : nowS - (line.at || nowS)) : nowS - (line.t || nowS));
      if (line.v !== now.v) {
        now = {kind: 'video', v: line.v, title: line.title};
        youtube([line.v], pos); holdPause = stop; if (stop) ytState = 2;
        say(`📺 ${who}: ${line.title || line.v}`);
        return;
      }
      seek(pos); run(!stop);
      say(`📺 ${who} ${stop ? '⏸' : line.op === 'seek' ? '⏩' : '▶'}`);
    },
    /** each frame: YouTube's player follows the screen on the page, and hides when the screen cannot be seen */
    update(time) {
      if (now.kind !== 'off' && time - heardAt > 0.1) {                         // where the user's figure is: how loud, which side
        heardAt = time;
        const me = ear?.();
        let side; [heard, side] = me ? hear(area, at, me, camera) : [1, 0];
        const nodes = isLocal() ? vNodes : audOk ? aNodes : null;
        if (nodes) steer(nodes, heard * vol / 100, side);
        else if (time - flatAt > 0.5) { flatAt = time; yt('setVolume', [Math.round(vol * heard)]); }
        follow();
      }
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

// ------------------------------------------------------------------ the radio in the games corner
// Music from YouTube, sound only (through the viewer, like the TV's, so it is placed: full in the games corner,
// fading and from its side elsewhere). A genre plays a search's results one after the other; the search picks one.
const RADIO_CSS = `
.o-radiogenres { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.o-radiogenres button { background: #222a3a; color: #e8eaf0; border: 1px solid #334058; border-radius: 999px; padding: 5px 12px; cursor: pointer; font: inherit; }
.o-radiogenres button:hover { border-color: #4dd0e1; }
.o-radionow { padding: 8px 14px 0; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.o-radio .o-tvcard.o-on { border-color: #4dd0e1; }
.o-radio .o-meta { opacity: .7; }
`;
const GENRES = [['Lo-fi', 'lofi hip hop mix'], ['Pop', 'pop hits'], ['Rap IT', 'rap italiano'], ['Rock', 'rock classics'],
                ['Chill', 'chill electronic mix'], ['Jazz', 'jazz relax']];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export function createRadio({THREE, scene, camera, root, spot, rot = 0, area, raycastables, say, t, ear}) {
  const style = document.createElement('style'); style.textContent = RADIO_CSS; document.head.appendChild(style);
  // a boombox on the floor: body, two speakers, a handle, and five bars that dance while it plays
  const box = new THREE.Group(), mat = c => new THREE.MeshStandardMaterial({color: c, roughness: 0.55});
  const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); box.add(o); return o; };
  part(new THREE.BoxGeometry(0.62, 0.34, 0.2), mat('#2b2f3a'), 0, 0.17, 0);
  for (const x of [-0.19, 0.19]) part(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), mat('#14161c'), x, 0.17, 0.105).rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(0.44, 0.03, 0.03), mat('#9aa0ad'), 0, 0.4, 0);
  for (const x of [-0.21, 0.21]) part(new THREE.BoxGeometry(0.03, 0.07, 0.03), mat('#9aa0ad'), x, 0.365, 0);
  const lit = new THREE.MeshBasicMaterial({color: '#4dd0e1', toneMapped: false});
  const bars = [0, 1, 2, 3, 4].map(i => part(new THREE.BoxGeometry(0.014, 0.06, 0.006), lit, -0.04 + i * 0.02, 0.17, 0.104));
  box.position.set(spot.x, 0, spot.z); box.rotation.y = rot;
  box.traverse(o => { o.userData.radio = true; if (o.isMesh) raycastables.push(o); });
  scene.add(box);
  area ??= {x0: spot.x - 3, z0: spot.z - 3, x1: spot.x + 3, z1: spot.z + 3};

  const aud = Object.assign(new Audio(), {preload: 'auto'});
  let nodes = null, list = [], idx = -1, vol = 70, menuEl = null, heardAt = 0;
  try { vol = Math.max(0, Math.min(100, +(localStorage.getItem('chatroom.radio.vol') ?? 70))); } catch (e) {}
  aud.addEventListener('ended', () => play(idx + 1));
  aud.addEventListener('error', () => { if (aud.getAttribute('src')) { aud.removeAttribute('src'); idx = -1; say(t().radioNeeds); draw(); } });
  function play(i) {
    if (!list.length) return;
    idx = (i + list.length) % list.length;
    nodes ??= speaker(aud);
    aud.src = `tv/audio/${list[idx].id}`; aud.play().catch(() => {});
    say(`📻 ${list[idx].title}`); draw();
  }
  async function find(q) {
    list = []; idx = -1; draw(t().tvLooking);
    try {
      const r = await fetch('tv/search?q=' + encodeURIComponent(q), {cache: 'no-store'});
      list = r.ok ? (await r.json()).results : [];
      if (!r.ok) say(r.status === 404 ? t().oldServer : await r.text());
    } catch (e) { list = []; }
    draw();
    return list;
  }
  function draw(msg) {
    if (!menuEl) return;
    const L = t();
    menuEl.querySelector('.o-radionow').textContent = idx >= 0 ? `${aud.paused ? '⏸' : '▶'} ${list[idx].title}` : '';
    menuEl.querySelector('.o-tvgrid').innerHTML = msg ? `<div class="o-meta">${esc(msg)}</div>`
      : list.map((r, i) => `<button class="o-tvcard${i === idx ? ' o-on' : ''}" data-i="${i}"><img alt="" src="https://i.ytimg.com/vi/${r.id}/mqdefault.jpg">`
                         + `<div>${esc(r.title)}<small>${esc(r.channel)}</small></div></button>`).join('') || `<div class="o-meta">${esc(L.radioHint)}</div>`;
  }
  function menu() {
    if (menuEl) return close();
    const L = t();
    menuEl = document.createElement('div'); menuEl.className = 'o-tvmenu o-radio';
    menuEl.innerHTML = `<div class="o-tvbox"><div class="o-tvhead"><b>📻 ${esc(L.radio)}</b><button data-x>✕</button></div>
      <div class="o-tvctl"><button data-c="play" title="${esc(L.tvPlay)}">⏯</button><button data-c="next" title="${esc(L.radioNext)}">⏭</button>
        <label>🔊 <input type="range" min="0" max="100" step="5" value="${vol}" data-vol></label></div>
      <div class="o-radionow"></div>
      <div class="o-tvbody"><div class="o-radiogenres">${GENRES.map(([n, q]) => `<button data-q="${esc(q)}">${esc(n)}</button>`).join('')}</div>
        <form class="o-tvsearch"><input name="q" placeholder="${esc(L.radioSearchPh)}" autocomplete="off"><button>🔎 ${esc(L.tvSearch)}</button></form>
        <div class="o-tvgrid"></div></div></div>`;
    menuEl.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === menuEl) close(); });
    menuEl.addEventListener('wheel', e => e.stopPropagation());
    menuEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    menuEl.addEventListener('input', e => {
      if (e.target.dataset.vol === undefined) return;
      vol = +e.target.value;
      try { localStorage.setItem('chatroom.radio.vol', String(vol)); } catch (err) {}
    });
    menuEl.addEventListener('submit', e => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) find(q); });
    menuEl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x !== undefined) return close();
      if (b.dataset.q) return void find(b.dataset.q).then(l => l.length && play(0));
      if (b.dataset.i) return play(+b.dataset.i);
      if (b.dataset.c === 'next') return play(idx + 1);
      if (b.dataset.c === 'play' && idx >= 0) { if (aud.paused) aud.play().catch(() => {}); else aud.pause(); draw(); }
    });
    root.appendChild(menuEl); draw();
  }
  const close = () => { menuEl?.remove(); menuEl = null; };

  return {
    menu,
    open: () => !!menuEl,
    /** how far a point is from the radio (E opens it from close by) */
    near: p => Math.hypot(p.x - spot.x, p.z - spot.z),
    /** each frame: the bars dance while it plays; ten times a second, how loud and from which side */
    update(time) {
      const on = !aud.paused;
      bars.forEach((b, i) => { b.scale.y = on ? 0.4 + Math.abs(Math.sin(time * (5 + i * 1.7) + i)) * 1.6 : 0.3; });
      if (!nodes || time - heardAt < 0.1) return;
      heardAt = time;
      const me = ear?.(), [g, side] = me ? hear(area, spot, me, camera) : [1, 0];
      steer(nodes, g * vol / 100, side);
    },
  };
}

// ------------------------------------------------------------------ lofi in the common room, made on the spot
// No recording: Web Audio plays it live, never the same twice. Soft electric-piano chords from a few lofi progressions,
// a round bass, a lazy swung beat (kick, brushed snare, hats), a sparse melody and vinyl crackle, all through a
// low-pass and a little saturation. Placed like the TV: full in the common room, fading and from its side elsewhere.
// Two speakers on the back wall switch it on and off (remembered).
const PROGS = [[[65, 69, 72, 76], [64, 67, 71, 74], [62, 65, 69, 72], [60, 64, 67, 71]],     // Fmaj7 Em7 Dm7 Cmaj7
               [[62, 65, 69, 72], [67, 71, 74, 77], [60, 64, 67, 71], [57, 60, 64, 67]],     // Dm7 G7 Cmaj7 Am7
               [[57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71]]];    // Am7 Dm7 G7 Cmaj7
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

export function createLofi({THREE, scene, camera, area, spots, raycastables, say, t, ear, Vox, mesh}) {
  let on = true, bus = null, nodes = null, timer = 0, beat = 0, nextAt = 0, prog = PROGS[0], noise = null, heardAt = 0;
  try { on = localStorage.getItem('chatroom.lofi') !== '0'; } catch (e) {}
  const mid = {x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2};
  // the speakers: a cabinet, two cones, a light that breathes while it plays
  const lit = new THREE.MeshBasicMaterial({color: '#ffb74d', toneMapped: false}), leds = [];
  for (const s of spots) {
    const v = new Vox().box(0, 0, 0, 9, 33, 7, '#2b2b30').box(1, 33, 1, 8, 33, 6, '#3a3a41');
    for (const [cy, r] of [[9, 4], [23, 3]]) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
      if (x * x + y * y <= r * r + 0.5) v.set(5 + x, cy + y, 8, x * x + y * y <= 1.5 ? '#55555c' : '#16161a');
    }
    const m = mesh(v, {pivot: [5, 0, 4], scale: 0.025, jitter: 0.03});
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), lit); led.position.set(0, 0.73, 0.21); m.add(led);
    m.position.set(s.x, 0, s.z); m.rotation.y = s.rot || 0;
    m.traverse(o => { o.userData.lofi = true; if (o.isMesh) raycastables.push(o); });
    scene.add(m); leds.push(led);
  }
  function build() {                                   // the chain: instruments -> low-pass -> saturation -> placed speaker
    ac ??= new AudioContext();
    const el = ac.createGain(); el.gain.value = 0.9;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.4;
    const sat = ac.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    sat.curve = curve;
    const gain = ac.createGain(), pan = ac.createStereoPanner();
    el.connect(lp).connect(sat).connect(gain).connect(pan).connect(ac.destination);
    nodes = {gain, pan}; bus = el;
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const crackle = ac.createBufferSource(); crackle.buffer = noise; crackle.loop = true;   // vinyl: hiss and pops
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.3;
    const cg = ac.createGain(); cg.gain.value = 0.012;
    crackle.connect(bp).connect(cg).connect(bus); crackle.start();
  }
  const env = (g, at, peak, attack, decay, sustain = 0) => {
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(Math.max(0.0001, sustain), at + attack, decay);
  };
  function keys(notes, at, len) {                      // electric piano: a sine and a soft octave above
    for (const n of notes) {
      const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain();
      o.type = 'sine'; o.frequency.value = hz(n); o2.type = 'triangle'; o2.frequency.value = hz(n) * 2.001; g2.gain.value = 0.18;
      o.connect(g); o2.connect(g2).connect(g); g.connect(bus);
      env(g, at, 0.07, 0.015, 0.9, 0.025); g.gain.setTargetAtTime(0.0001, at + len, 0.4);
      o.start(at); o2.start(at); o.stop(at + len + 2); o2.stop(at + len + 2);
    }
  }
  function bass(n, at, len) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = hz(n - 24);
    o.connect(g).connect(bus); env(g, at, 0.22, 0.01, 0.35, 0.08); g.gain.setTargetAtTime(0.0001, at + len, 0.1);
    o.start(at); o.stop(at + len + 1);
  }
  function kick(at) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(110, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.25);
    o.connect(g).connect(bus); env(g, at, 0.5, 0.004, 0.12); o.start(at); o.stop(at + 0.6);
  }
  function burst(at, freq, q, peak, dec, type = 'bandpass') {   // snare and hats: filtered noise
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f).connect(g).connect(bus); env(g, at, peak, 0.003, dec);
    s.start(at, Math.random() * 1.5); s.stop(at + 0.5);
  }
  function step() {                                    // schedules what falls in the next 0.3 s
    const spb = 60 / 74 / 2;                             // an eighth note at 74 bpm
    while (nextAt < ac.currentTime + 0.3) {
      const i = beat % 32, bar = Math.floor(beat / 8) % 4, at = nextAt + (beat % 2 ? spb * 0.18 : 0);   // swung
      if (i === 0 && Math.random() < 0.35) prog = PROGS[Math.floor(Math.random() * PROGS.length)];
      if (beat % 8 === 0) { keys(prog[bar], at, spb * 7.5); bass(prog[bar][0], at, spb * 3); }
      if (beat % 8 === 4 && Math.random() < 0.7) bass(prog[bar][0] + (Math.random() < 0.5 ? 7 : 0), at, spb * 2.5);
      if (beat % 8 === 0 || (beat % 8 === 5 && Math.random() < 0.5)) kick(at);
      if (beat % 8 === 4) { burst(at, 1800, 0.8, 0.16, 0.08); burst(at, 200, 1, 0.05, 0.05); }
      burst(at, 8000, 0.7, beat % 2 ? 0.025 : 0.04, 0.03, 'highpass');
      if (Math.random() < 0.12) {                      // now and then a melody note from the chord, an octave up
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = hz(prog[bar][Math.floor(Math.random() * 4)] + 12);
        o.connect(g).connect(bus); env(g, at, 0.05, 0.02, 0.5); o.start(at); o.stop(at + 2);
      }
      nextAt += spb; beat++;
    }
  }
  function start() {
    if (timer) return;
    if (!bus) build();
    nextAt = ac.currentTime + 0.1; beat = 0;
    timer = setInterval(step, 100);
  }
  function stop() { clearInterval(timer); timer = 0; }
  function toggle() {
    on = !on;
    try { localStorage.setItem('chatroom.lofi', on ? '1' : '0'); } catch (e) {}
    if (on) start(); else stop();
    say(`🎵 ${on ? t().lofiOn : t().lofiOff}`);
  }
  // the page's first click or key lets the sound start (browsers forbid sound before)
  if (on) for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (on) start(); }, {capture: true, once: true});
  return {
    toggle,
    near: p => Math.min(...spots.map(s => Math.hypot(p.x - s.x, p.z - s.z))),
    /** ten times a second: how loud and from which side; the speakers' lights breathe while it plays */
    update(time) {
      for (const l of leds) l.visible = !!timer && Math.sin(time * 2.4) > -0.6;
      if (!nodes || time - heardAt < 0.1) return;
      heardAt = time;
      const me = ear?.(), [g, side] = me ? hear(area, mid, me, camera) : [1, 0];
      steer(nodes, timer ? g * 0.55 : 0, side);
    },
  };
}
