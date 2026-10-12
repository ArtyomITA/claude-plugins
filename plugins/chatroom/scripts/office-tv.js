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
 *  `camera`: inside the area 1 and 0; outside it fades with the distance and comes from where it is (right = +1).
 *  `reach` (metres): music stays in its room and is gone this far outside it; without it, the TV's long fade */
export function hear(area, src, me, camera, reach = 0) {
  const d = Math.hypot(Math.max(area.x0 - me.x, 0, me.x - area.x1), Math.max(area.z0 - me.z, 0, me.z - area.z1));
  if (d < 0.05) return [1, 0];
  const e = camera.matrixWorld.elements, fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
  const tx = src.x - me.x, tz = src.z - me.z, tl = Math.hypot(tx, tz) || 1;
  const side = (-fz * tx + fx * tz) / fl / tl;                                 // the camera's right is (-fz, fx)
  const g = reach ? Math.max(0, 1 - d / reach) ** 2 : Math.max(0, 1 - d / 30) / (1 + d / 3);
  return [g, Math.max(-0.85, Math.min(0.85, side * 0.85 * Math.min(1, d / 2)))];
}
// the mixer: a general level and one per source (tv, radio, lofi), each with its own mute, remembered
const MIX = {master: 1, tv: 1, radio: 1, lofi: 1, mute: {}};
try { Object.assign(MIX, JSON.parse(localStorage.getItem('chatroom.mix') || '{}')); } catch (e) {}
export const mixLevel = kind => (MIX.mute.master ? 0 : MIX.master) * (MIX.mute[kind] ? 0 : MIX[kind] ?? 1);
/** move a speaker's gain and side smoothly; the mixer's level for its kind applies on top */
function steer(nodes, g, p, kind) {
  nodes.gain.gain.setTargetAtTime(g * mixLevel(kind), ac.currentTime, 0.12);
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
.o-tvcine { position: absolute; inset: 0; background: rgba(4,6,10,.84); z-index: 25; display: flex; flex-direction: column; align-items: center;
            justify-content: center; gap: 12px; font: 13px/1.4 "Segoe UI", system-ui, sans-serif; color: #e8eaf0; }
.o-tvcine .o-tvscreen { width: min(88%, 1400px, calc((100% - 90px) * 16 / 9)); aspect-ratio: 16 / 9; background: #000; border-radius: 10px;
            box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; }
.o-tvcine .o-tvscreen video { width: 100%; height: 100%; display: block; background: #000; }
.o-tvcine .o-tvctl { background: #10131bd9; border-radius: 12px; padding: 8px 12px; }
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
  const bad = new Set();                             // YouTube videos the player refused to show
  let vNodes = null, aNodes = null, audOk = true, audId = '', ytVid = '', syncAt = 0, heardAt = 0, flatAt = 0, heard = 1;
  aud.addEventListener('error', async () => {        // no yt-dlp here, or YouTube refused: its own sound, fading but without sides
    const src = aud.getAttribute('src');
    if (!src || !audOk) return;
    audOk = false; aud.removeAttribute('src'); audId = ''; audio();
    if (bad.has(ytVid)) return;                      // the picture is refused too: that message says it
    let why = '';                                    // the viewer's server knows what yt-dlp complained about (an age limit, a bot check, an old version...)
    try { const r = await fetch(src, {headers: {Range: 'bytes=0-0'}, cache: 'no-store'}); if (r.ok) r.body?.cancel(); else why = (await r.text()).slice(0, 200); } catch (e) {}
    say(why ? t().tvFlatWhy(why) : t().tvFlat);
  });
  /** the separate sound keeps to YouTube's picture: same video, same second, playing or not */
  function follow() {
    if (!audOk || now.kind === 'off' || isLocal() || !ytVid || bad.has(ytVid)) return;
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
    if (d?.event === 'onError') return refused(+d.info);
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
  /** the player cannot show this video here (101 or 150: its author forbids other pages, or an age limit; 100: removed or private): say why,
   *  and go on with the next one of the search list when there is one */
  function refused(code) {
    if (now.kind === 'off' || isLocal() || !ytVid) return;
    const id = now.kind === 'video' ? now.v : ytVid;
    if (bad.has(id)) return;
    bad.add(id); aud.removeAttribute('src'); audId = '';
    const i = results.findIndex(r => r.id === id), next = i >= 0 ? results.slice(i + 1).find(r => !bad.has(r.id)) : null;
    if (next) watch(next.id, next.title);
    say(t().tvRefused(code, results[i]?.title || now.title || now.name || '', next?.title));
  }
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
  // cinema: sitting in front of the TV, the picture comes up centred and big over the office (not the browser's full
  // screen), with our remote on it; YouTube's player is moved over the box (moving an iframe in the page would reload it)
  let cineEl = null, cineTick = 0;
  const cineKey = e => { if (e.key === 'Escape' && cineEl) { e.stopPropagation(); e.preventDefault(); cinema(false); } };
  function cinema(on) {
    if (!on) {
      if (!cineEl) return;
      const was = isLocal() && !video.paused;                                 // taking a playing video out of the page pauses it, a moment later: it goes on
      clearInterval(cineTick); removeEventListener('keydown', cineKey, true);
      cineEl.remove(); cineEl = null; video.style.cssText = ''; video.remove(); frame.style.zIndex = '1';
      if (was) setTimeout(() => video.play().catch(() => {}), 0);
      return;
    }
    if (cineEl || now.kind === 'off' || fullEl) return;
    close();
    const L = t();
    cineEl = document.createElement('div'); cineEl.className = 'o-tvcine';
    cineEl.innerHTML = `<div class="o-tvscreen"></div><div class="o-tvctl"><button data-c="start" title="${esc(L.tvStart)}">⏮</button><button data-c="back">⏪ 10</button>
      <button data-c="play" title="${esc(L.tvPlay)}">⏯</button><button data-c="fwd">10 ⏩</button>
      <label>🔊 <input type="range" min="0" max="100" step="5" value="${vol}" data-vol></label><span class="o-tvtime"></span>
      <button data-m>☰ ${esc(L.tvChannels)}</button><button data-power title="${esc(L.tvOff)}">⏻</button><button data-x>✕ Esc</button></div>`;
    if (isLocal()) { video.style.cssText = 'width:100%;height:100%;display:block'; cineEl.querySelector('.o-tvscreen').appendChild(video); }
    for (const ev of ['pointerdown', 'wheel', 'keydown']) cineEl.addEventListener(ev, e => e.stopPropagation());
    cineEl.addEventListener('input', e => {
      if (e.target.dataset.vol === undefined) return;
      vol = +e.target.value;
      try { localStorage.setItem('chatroom.tv.vol', String(vol)); } catch (err) {}
      if (vol > 0 && !sound) setSound(true); else audio();
    });
    cineEl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) return control(b.dataset.c);
      if (b.dataset.x !== undefined) return cinema(false);
      if (b.dataset.power !== undefined) { cinema(false); return power(false); }
      if (b.dataset.m !== undefined) { cinema(false); menu(); }
    });
    const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    cineTick = setInterval(() => {
      const el = cineEl?.querySelector('.o-tvtime'), d = isLocal() ? video.duration : ytDur;
      if (el) el.textContent = `${paused() ? '⏸' : '▶'} ${clock(position())}${d ? ' / ' + clock(d) : ''}`;
    }, 500);
    addEventListener('keydown', cineKey, true);
    root.appendChild(cineEl);
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
    cinema,
    isCinema: () => !!cineEl,
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
        if (nodes) steer(nodes, heard * vol / 100, side, 'tv');
        else if (time - flatAt > 0.5) { flatAt = time; yt('setVolume', [Math.round(vol * heard * mixLevel('tv'))]); }
        follow();
      }
      if (now.kind === 'off' || (now.kind === 'channel' && channels[now.i]?.files)) return;
      if (cineEl) {                                                           // in cinema the player sits on the big box
        const b = cineEl.querySelector('.o-tvscreen').getBoundingClientRect(), r0 = root.getBoundingClientRect();
        Object.assign(frame.style, {display: '', zIndex: '26', transform: `translate(${b.left - r0.left}px, ${b.top - r0.top}px) scale(${b.width / FW}, ${b.height / FH})`});
        return;
      }
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
      const r = await fetch('tv/search?audio=1&q=' + encodeURIComponent(q), {cache: 'no-store'});
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
      const me = ear?.(), [g, side] = me ? hear(area, spot, me, camera, 4) : [1, 0];
      steer(nodes, g * vol / 100, side, 'radio');
    },
  };
}

// ------------------------------------------------------------------ lofi in the common room, made on the spot
// No recording: Web Audio plays it live, never the same twice. An FM electric piano (a tine that blooms and fades,
// two voices a few cents apart, tremolo) on jazzy voicings that move by small steps, a warm bass, a swung and
// humanised beat (kick with a click, snare with body, hats, ghost notes), a pentatonic melody with a dotted echo,
// tape wobble, a room reverb, the beat pumping the rest a little, vinyl hiss and pops, all through a soft low-pass.
// Placed like the TV, but it stays in its room. Two speakers on the back wall switch it on and off (remembered).
const PROGS = [
  [[0, 4, 7, 11, 14], [5, 9, 12, 16, 19], [2, 5, 9, 12, 16], [7, 11, 14, 17, 21]],     // Imaj9 IVmaj9 ii9 V9
  [[9, 12, 16, 19, 23], [2, 5, 9, 12, 16], [7, 11, 14, 17, 21], [0, 4, 7, 11, 14]],    // vi9 ii9 V9 Imaj9
  [[2, 5, 9, 12, 16], [7, 10, 14, 17, 21], [0, 4, 7, 11, 14], [9, 12, 16, 19, 22]],    // ii9 V7#9-ish Imaj9 VI7
  [[4, 7, 11, 14, 17], [9, 12, 16, 19, 23], [2, 5, 9, 12, 16], [7, 11, 14, 17, 21]]];  // iii7 vi9 ii9 V9
const PENTA = [0, 2, 4, 7, 9];
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

export function createLofi({THREE, scene, camera, area, spots, raycastables, say, t, ear, Vox, mesh}) {
  let on = true, timer = 0, beat = 0, nextAt = 0, heardAt = 0, prog = PROGS[0], last = null;
  let out = null, nodes = null, keysBus = null, drumBus = null, rev = null, echo = null, wow = null, noise = null;
  const key = 57 + Math.floor(Math.random() * 6), bpm = 70 + Math.floor(Math.random() * 12);   // a key and a tempo per visit
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
  function build() {
    ac ??= new AudioContext();
    // master: soft low-pass, gentle saturation, then the placed speaker
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
    const sat = ac.createWaveShaper(), curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3); }
    sat.curve = curve; sat.oversample = '2x';
    const gain = ac.createGain(), pan = ac.createStereoPanner();
    out = ac.createGain(); out.gain.value = 0.85;
    out.connect(lp).connect(sat).connect(gain).connect(pan).connect(ac.destination);
    nodes = {gain, pan};
    // the room: a reverb from a decaying noise burst
    const ir = ac.createBuffer(2, ac.sampleRate * 2.4, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    rev = ac.createConvolver(); rev.buffer = ir;
    const revBack = ac.createGain(); revBack.gain.value = 0.32; rev.connect(revBack).connect(out);
    // a dotted-eighth echo for the melody
    echo = ac.createDelay(1.5); echo.delayTime.value = 60 / bpm * 0.75;
    const fb = ac.createGain(); fb.gain.value = 0.32; const etone = ac.createBiquadFilter(); etone.type = 'lowpass'; etone.frequency.value = 2200;
    echo.connect(etone).connect(fb).connect(echo); etone.connect(out); etone.connect(rev);
    // busses: keys and bass pump a little on every kick, drums go straight
    keysBus = ac.createGain(); keysBus.connect(out); keysBus.connect(rev);
    drumBus = ac.createGain(); drumBus.gain.value = 0.9; drumBus.connect(out);
    const snareSend = ac.createGain(); snareSend.gain.value = 0.25; drumBus.connect(snareSend).connect(rev);
    // tape wobble: one slow wave bends every note a few cents
    wow = ac.createOscillator(); wow.frequency.value = 0.35; const wowDepth = ac.createGain(); wowDepth.gain.value = 7;
    wow.connect(wowDepth); wow.start(); wow.depth = wowDepth;
    // vinyl: a bed of hiss and the odd pop
    noise = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5 + (Math.random() < 0.00012 ? (Math.random() < 0.5 ? -1 : 1) * 4 : 0);
    const vinyl = ac.createBufferSource(); vinyl.buffer = noise; vinyl.loop = true;
    const vbp = ac.createBiquadFilter(); vbp.type = 'bandpass'; vbp.frequency.value = 3200; vbp.Q.value = 0.4;
    const vg = ac.createGain(); vg.gain.value = 0.016;
    vinyl.connect(vbp).connect(vg).connect(out); vinyl.start();
  }
  const env = (g, at, peak, attack, decay, sustain = 0) => {
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setTargetAtTime(Math.max(0.0001, sustain), at + attack, decay);
  };
  const osc = (type, f, at, stop) => {                // every note bends with the tape wobble, and lets go of it when it ends
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f; wow.depth.connect(o.detune);
    o.onended = () => { try { wow.depth.disconnect(o.detune); } catch (e) {} };
    o.start(at); o.stop(stop); return o;
  };
  /** one electric-piano note: an FM tine (the modulator's depth blooms then fades), two voices apart, tremolo */
  function tine(n, at, len, vel) {
    const g = ac.createGain(), trem = ac.createGain(), lfo = ac.createOscillator(), lfoG = ac.createGain();
    lfo.frequency.value = 4.6; lfoG.gain.value = 0.12; lfo.connect(lfoG).connect(trem.gain); trem.gain.value = 0.88;
    g.connect(trem).connect(keysBus);
    for (const cents of [-5, 5]) {
      const c = osc('sine', hz(n), at, at + len + 2.5), m = osc('sine', hz(n), at, at + len + 2.5), idx = ac.createGain();
      c.detune.value = cents; m.detune.value = cents;
      idx.gain.setValueAtTime(hz(n) * 2.2, at); idx.gain.setTargetAtTime(hz(n) * 0.25, at, 0.35);   // the bark, then the warm tone
      m.connect(idx).connect(c.frequency); c.connect(g);
    }
    env(g, at, 0.045 * vel, 0.006, 1.1, 0.012); g.gain.setTargetAtTime(0.0001, at + len, 0.35);
    lfo.start(at); lfo.stop(at + len + 2.5);
  }
  /** the next chord, voiced near the last one (small steps sound smooth) */
  function voice(ch) {
    const base = key + 12, notes = ch.map(i => base + i).map(n => { while (n > base + 17) n -= 12; return n; }).sort((a, b) => a - b);
    if (last) { const avg = last.reduce((a, b) => a + b) / last.length, now_ = notes.reduce((a, b) => a + b) / notes.length; if (now_ - avg > 6) notes.forEach((_, i) => notes[i] -= 12); }
    last = notes; return notes;
  }
  function bass(n, at, len) {
    const g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const a = osc('sine', hz(n), at, at + len + 1), b = osc('triangle', hz(n), at, at + len + 1), bg = ac.createGain(); bg.gain.value = 0.35;
    a.connect(g); b.connect(bg).connect(g); g.connect(f).connect(keysBus);
    env(g, at, 0.24, 0.012, 0.4, 0.1); g.gain.setTargetAtTime(0.0001, at + len, 0.08);
  }
  function kick(at, vel = 1) {
    const g = ac.createGain(), o = ac.createOscillator();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(46, at + 0.12);
    o.connect(g).connect(drumBus); env(g, at, 0.62 * vel, 0.002, 0.13); o.start(at); o.stop(at + 0.6);
    noiseHit(at, 2500, 1.2, 0.08 * vel, 0.006, 'bandpass');                  // the click of the beater
    keysBus.gain.cancelScheduledValues(at); keysBus.gain.setValueAtTime(0.72, at); keysBus.gain.setTargetAtTime(1, at + 0.02, 0.12);   // pump
  }
  function noiseHit(at, freq, q, peak, dec, type) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f).connect(g).connect(drumBus); env(g, at, peak, 0.002, dec);
    s.start(at, Math.random() * 2); s.stop(at + 0.6);
  }
  function snare(at, vel = 1) {
    noiseHit(at, 1900, 0.9, 0.2 * vel, 0.07, 'bandpass');
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(210, at); o.frequency.exponentialRampToValueAtTime(160, at + 0.08);
    o.connect(g).connect(drumBus); env(g, at, 0.1 * vel, 0.002, 0.05); o.start(at); o.stop(at + 0.3);
  }
  function lead(n, at, len) {                          // a soft triangle with a slow attack, into the echo
    const g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
    osc('triangle', hz(n), at, at + len + 1).connect(f).connect(g);
    g.connect(echo); g.connect(keysBus); env(g, at, 0.05, 0.03, 0.4, 0.02); g.gain.setTargetAtTime(0.0001, at + len, 0.2);
  }
  function step() {                                    // schedules what falls in the next 0.35 s, in sixteenths
    const s16 = 60 / bpm / 4;
    while (nextAt < ac.currentTime + 0.35) {
      const i = beat % 64, bar = Math.floor(beat / 16) % 4, pos = beat % 16;
      const swing = pos % 2 ? s16 * 0.28 : 0, human = (Math.random() - 0.5) * 0.012, at = nextAt + swing + human;
      if (i === 0 && Math.random() < 0.4) prog = PROGS[Math.floor(Math.random() * PROGS.length)];
      if (pos === 0) {
        const notes = voice(prog[bar]);
        notes.forEach((n, k) => tine(n, at + k * 0.012, s16 * 14, 0.8 + Math.random() * 0.3));   // a slight strum
        bass(key - 12 + prog[bar][0], at, s16 * 6);
      }
      if (pos === 8 && Math.random() < 0.6) bass(key - 12 + prog[bar][0] + (Math.random() < 0.5 ? 7 : 12), at, s16 * 4);
      if (pos === 10 && Math.random() < 0.35) voice(prog[bar]).slice(1, 4).forEach(n => tine(n, at, s16 * 4, 0.55));   // a push
      if (pos === 0 || pos === 7 && Math.random() < 0.4 || pos === 10) kick(at, pos === 0 ? 1 : 0.8);
      if (pos === 4 || pos === 12) snare(at);
      if ((pos === 15 || pos === 6) && Math.random() < 0.25) snare(at, 0.3);                     // ghost notes
      if (pos % 2 === 0) noiseHit(at, 8200, 0.7, pos % 4 === 2 ? 0.045 : 0.03, 0.025, 'highpass');
      if (pos === 14 && Math.random() < 0.3) noiseHit(at, 7500, 0.6, 0.035, 0.16, 'highpass');   // an open hat
      if (bar % 2 === 1 && pos % 4 === 0 && Math.random() < 0.45) {                              // the melody answers every other bar
        lead(key + 24 + PENTA[Math.floor(Math.random() * PENTA.length)], at, s16 * (Math.random() < 0.5 ? 2 : 4));
      }
      nextAt += s16; beat++;
    }
  }
  function start() {
    if (timer) return;
    if (!out) build();
    if (ac.state === 'suspended') ac.resume();
    nextAt = ac.currentTime + 0.1; beat = 0;
    timer = setInterval(step, 90);
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
      const me = ear?.(), [g, side] = me ? hear(area, mid, me, camera, 4) : [1, 0];
      steer(nodes, timer ? g * 0.6 : 0, side, 'lofi');
    },
  };
}

// ------------------------------------------------------------------ the mixer panel
const MIX_CSS = `
.o-mixer { position: absolute; right: 14px; bottom: 64px; z-index: 31; width: 250px; background: #10131bf2; color: #e8eaf0; border-radius: 12px;
           box-shadow: 0 14px 40px rgba(0,0,0,.5); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; padding: 10px 12px; }
.o-mixer b { display: block; margin-bottom: 6px; }
.o-mixer .o-mixrow { display: grid; grid-template-columns: 34px 1fr 38px; align-items: center; gap: 8px; padding: 3px 0; }
.o-mixer button { background: #222a3a; color: #e8eaf0; border: 1px solid #334058; border-radius: 8px; padding: 3px 0; cursor: pointer; font: inherit; }
.o-mixer input[type=range] { width: 100%; accent-color: #4dd0e1; }
.o-mixer small { opacity: .7; text-align: right; font-variant-numeric: tabular-nums; }
`;
/** the volumes: a general one and TV, radio, lofi, each with a mute; opens over the button bar */
export function createMixer({root, t, onChange}) {
  const style = document.createElement('style'); style.textContent = MIX_CSS; document.head.appendChild(style);
  let el = null;
  const save = () => { try { localStorage.setItem('chatroom.mix', JSON.stringify(MIX)); } catch (e) {} onChange?.(); };
  function draw() {
    const L = t(), rows = [['master', L.mixAll], ['tv', 'TV'], ['radio', L.radio], ['lofi', 'Lofi']];
    el.innerHTML = `<b>🔊 ${esc(L.mixTitle)}</b>` + rows.map(([k, name]) => `<div class="o-mixrow"><button data-mute="${k}" title="${esc(name)}">${MIX.mute[k] ? '🔇' : '🔊'}</button>`
      + `<input type="range" min="0" max="100" step="5" value="${Math.round(MIX[k] * 100)}" data-k="${k}" aria-label="${esc(name)}"><small>${esc(name)}</small></div>`).join('');
  }
  function toggle() {
    if (el) { el.remove(); el = null; return; }
    el = document.createElement('div'); el.className = 'o-mixer';
    for (const ev of ['pointerdown', 'wheel', 'keydown']) el.addEventListener(ev, e => e.stopPropagation());
    el.addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return; MIX[k] = +e.target.value / 100; save(); });
    el.addEventListener('click', e => { const k = e.target.closest('button')?.dataset.mute; if (!k) return; MIX.mute[k] = !MIX.mute[k]; save(); draw(); });
    draw(); root.appendChild(el);
  }
  return {toggle, open: () => !!el, muted: () => !!MIX.mute.master};
}
