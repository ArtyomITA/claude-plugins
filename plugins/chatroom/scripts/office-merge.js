// Draw calls are what the office costs: every mesh is one call, and the shadow pass draws them all again (about 540
// calls in the view plus about 360 for the shadows). Furniture and the city never move while you look at them, so their
// meshes are baked into a few big ones: one per material, shadow flags and square of the floor. The originals stay in
// the scene, only hidden, so clicks, labels, the editor and every other piece of code keep working on them. The editor
// calls setEditing(true) to see the originals (it moves them) and setEditing(false) to bake again.
//
// mergeStatic({THREE, scene, items, extra, skip}) -> {setEditing(on), stats}
//   items: the furniture groups (an array, or a function returning the current one); extra: more groups to bake (the city);
//   skip: a Set of objects, or a function(object) -> true, that must not be touched (moving, animated, textured by code).
// A mesh is baked only if it is visible, plain (one material, no map, not transparent, not instanced or skinned) and its
// geometry is made of position, normal and optionally color, uv and vox.

const CELL = 10;                                       // metres: a baked piece covers at most this much floor, so it can still leave the view
const NAMES = ['position', 'normal', 'color', 'uv', 'vox'];         // vox: voxel coordinates for the grain, copied as they are

export function mergeStatic({THREE, scene, items = [], extra = [], skip = () => false}) {
  const isSkipped = typeof skip === 'function' ? skip : o => skip.has(o);
  const holder = new THREE.Group(); holder.name = 'merged-static'; scene.add(holder);
  let hidden = [];                                     // the originals hidden by the last bake
  const stats = {meshes: 0, pieces: 0};

  function candidates(roots) {
    const out = [];
    const walk = o => {
      if (!o.visible || isSkipped(o)) return;
      if (o.isMesh) {
        const m = o.material, g = o.geometry;
        if (o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(m) || !m || m.transparent || m.map || m.alphaMap || o.renderOrder || !g?.attributes.position || !g.attributes.normal) return;
        if (Object.keys(g.attributes).some(k => !NAMES.includes(k))) return;
        if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
        out.push(o);
      }
      for (const c of o.children) walk(c);
    };
    for (const r of roots) walk(r);
    return out;
  }

  const _p = new THREE.Vector3(), _m3 = new THREE.Matrix3();
  /** one baked mesh out of the meshes of a bucket (same material, flags and attribute layout) */
  function bake(list, names) {
    const geos = list.map(o => o.geometry.index ? o.geometry.toNonIndexed() : o.geometry);
    const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const out = {};
    for (const n of names) {
      const a = geos[0].attributes[n];
      out[n] = {itemSize: a.itemSize, array: new a.array.constructor(total * a.itemSize), normalized: a.normalized};
    }
    let at = 0;
    list.forEach((o, k) => {
      const g = geos[k], count = g.attributes.position.count, mat = o.matrixWorld, flip = mat.determinant() < 0;
      _m3.getNormalMatrix(mat);
      // a mirrored object turns its triangles inside out: swap the 2nd and 3rd vertex of each to keep them facing out
      const src = i => (flip ? i - (i % 3) + [0, 2, 1][i % 3] : i);
      for (const n of names) {
        const a = g.attributes[n], dst = out[n].array, s = a.itemSize;
        for (let i = 0; i < count; i++) {
          const j = src(i), base = (at + i) * s;
          if (n === 'position' || n === 'normal') {
            _p.fromBufferAttribute(a, j);
            if (n === 'position') _p.applyMatrix4(mat); else _p.applyMatrix3(_m3).normalize();
            dst[base] = _p.x; dst[base + 1] = _p.y; dst[base + 2] = _p.z;
          } else {
            for (let c = 0; c < s; c++) dst[base + c] = a.array[j * s + c];
          }
        }
      }
      at += count;
    });
    const geo = new THREE.BufferGeometry();
    for (const n of names) geo.setAttribute(n, new THREE.BufferAttribute(out[n].array, out[n].itemSize, out[n].normalized));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    geos.forEach((g, k) => { if (g !== list[k].geometry) g.dispose(); });
    return geo;
  }

  function build() {
    const roots = [...(typeof items === 'function' ? items() : items), ...(typeof extra === 'function' ? extra() : extra)];
    scene.updateMatrixWorld(true);
    const list = candidates(roots), buckets = new Map();
    for (const o of list) {
      const g = o.geometry, names = NAMES.filter(n => g.attributes[n]);
      o.getWorldPosition(_p);
      const key = [o.material.uuid, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, names.map(n => n + g.attributes[n].itemSize + g.attributes[n].array.constructor.name).join(), Math.floor(_p.x / CELL), Math.floor(_p.z / CELL)].join('|');
      if (!buckets.has(key)) buckets.set(key, {names, list: []});
      buckets.get(key).list.push(o);
    }
    let pieces = 0;
    for (const {names, list: group} of buckets.values()) {
      if (group.length < 2) continue;                  // one mesh alone gains nothing
      const first = group[0], mesh = new THREE.Mesh(bake(group, names), first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.matrixAutoUpdate = false; mesh.userData.merged = true;
      // clicks and the TV's line of sight ray-cast the scene: do it on the small originals (as before), not on every triangle of the big piece
      mesh.raycast = (rc, hits) => { const found = []; for (const o of group) o.raycast(rc, found); for (const h of found) { const o = h.object; if (h.face) h.face = {...h.face, normal: h.face.normal.clone().transformDirection(o.matrixWorld)}; h.object = mesh; hits.push(h); } };   // the face normal now in world space: the baked piece has no transform of its own
      holder.add(mesh);
      for (const o of group) { o.visible = false; hidden.push(o); }
      pieces++;
    }
    stats.meshes = hidden.length; stats.pieces = pieces;
  }

  function clear() {
    for (const o of hidden) o.visible = true;
    hidden = [];
    for (const m of [...holder.children]) { holder.remove(m); m.geometry.dispose(); }   // the materials are the originals': never disposed here
    stats.meshes = stats.pieces = 0;
  }

  build();
  return {
    stats,
    /** true: show the originals (the editor moves them); false: bake again from what the furniture is now */
    setEditing(on) { clear(); if (!on) build(); },
  };
}
