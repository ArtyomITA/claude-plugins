// The lounge TV with real videos. A channel is a folder of the user's own videos (~/.claude/chatroom/tv/<channel>/,
// served by the viewer) played on the screen as a texture, or a list of YouTube videos played by YouTube's own player
// laid over the screen. Every channel loops forever; the remote control on the low table zaps to the next one.

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

export function createTV({THREE, scene, camera, renderer, root, tvMesh, table, raycastables, say}) {
  if (!tvMesh) return {update() {}, next() {}, near: () => Infinity, remote: null};
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

  // what plays: a video element for the user's files, YouTube's player for the YouTube lists
  const video = Object.assign(document.createElement('video'), {muted: true, playsInline: true, preload: 'auto'});
  const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace;
  const frame = Object.assign(document.createElement('iframe'), {allow: 'autoplay; encrypted-media', title: 'TV', tabIndex: -1});
  const FW = 640, FH = 360;
  Object.assign(frame.style, {position: 'absolute', left: '0', top: '0', width: FW + 'px', height: FH + 'px', border: '0', transformOrigin: '0 0',
                              pointerEvents: 'none', display: 'none', zIndex: '1', background: '#000'});
  root.appendChild(frame);
  let channels = [], ch = -1, file = 0, seenAt = 0, hidden = true;

  function play() {
    const c = channels[ch];
    if (!c) return;
    if (c.files) {
      frame.style.display = 'none'; frame.src = 'about:blank';
      video.loop = c.files.length === 1;
      video.src = `tv/${encodeURIComponent(c.name)}/${encodeURIComponent(c.files[file % c.files.length])}`;
      video.play().catch(() => {});
      screen.material.map = tex; screen.material.color.set('#ffffff'); screen.material.needsUpdate = true;
    } else {
      video.pause(); video.removeAttribute('src'); video.load();
      screen.material.map = null; screen.material.color.set('#050608'); screen.material.needsUpdate = true;
      const ids = c.youtube;
      frame.src = `https://www.youtube-nocookie.com/embed/${ids[0]}?autoplay=1&mute=1&controls=0&loop=1&playlist=${ids.join(',')}&playsinline=1&rel=0&modestbranding=1`;
    }
  }
  video.addEventListener('ended', () => { const c = channels[ch]; if (c?.files?.length > 1) { file++; play(); } });
  fetch('tv.json', {cache: 'no-store'}).then(r => r.ok ? r.json() : {channels: []}).then(d => { channels = d.channels || []; if (channels.length) { ch = 0; play(); } }).catch(() => {});

  const _p = new THREE.Vector3(), _ray = new THREE.Raycaster(), corners = [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]];
  return {
    remote,
    /** how far a point is from the remote (for E in first person) */
    near: p => remote ? Math.hypot(p.x - remote.position.x, p.z - remote.position.z) : Infinity,
    next() {
      if (!channels.length) return say('📺 —');
      ch = (ch + 1) % channels.length; file = 0; play();
      say(`📺 ${ch + 1}/${channels.length} · ${channels[ch].name}`);
    },
    /** each frame: YouTube's player follows the screen on the page, and hides when the screen cannot be seen */
    update(now) {
      const c = channels[ch];
      if (!c || c.files) return;
      const rect = renderer.domElement.getBoundingClientRect(), rr = root.getBoundingClientRect();
      const facing = _p.copy(camera.position).sub(at).dot(n) > 0.05;
      const q = corners.map(([x, y]) => { _p.set(x, y, 0); screen.localToWorld(_p); _p.project(camera);
                                          return [(_p.x * 0.5 + 0.5) * rect.width + rect.left - rr.left, (-_p.y * 0.5 + 0.5) * rect.height + rect.top - rr.top, _p.z]; });
      let show = facing && q.every(p => p[2] < 1) && q.some(p => p[0] > 0 && p[0] < rect.width && p[1] > 0 && p[1] < rect.height);
      if (show && now - seenAt > 0.25) {                                     // something in front of the screen hides it
        seenAt = now;
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
