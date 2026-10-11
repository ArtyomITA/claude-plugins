// Two friends, one NES game: lockstep. Both computers run the same emulator on the same game, and a frame is only run when the inputs of both players for that
// frame are known on both sides, so the two games stay identical and nothing but the buttons has to travel. Every player's own buttons count a few frames late
// (`delay`, enough to cover the one-way trip), which is what hides the time the message takes: while a frame waits for the friend's buttons, the buttons of the
// frames after it are already on their way.
//
// What goes over the wire: {t, a, d}. t: "my buttons are known up to this frame"; a: "yours are known up to this frame here" (what I have received so far);
// d: the changes of my buttons since the last frame you told me you have, as "frame:mask,frame:mask". Every packet carries all the changes you have not
// acknowledged yet, so a lost or late packet never leaves a hole: the next one fills it. A packet is sent when the buttons change, every few frames anyway, and
// again and again while the game waits.
//
// The engine knows nothing about the emulator or the page: it is given `run(maskP1, maskP2)` (set the buttons, run one frame), `localMask()` (the buttons held
// now) and `send(message)`. step() is called once per frame time and says whether a frame ran.

export function createLockstep({role, send, run, localMask, delay = 6, checksum = null, onDesync = () => {}, every = 4, sumEvery = 120}) {
  const own = new Map(), rem = new Map();          // frame -> mask, mine and the friend's
  const log = [];                                  // my changes not yet acknowledged: [frame, mask]
  const remChanges = new Map();                    // the friend's changes received: frame -> mask
  let F = 0, D = delay, ownThrough = -1, remThrough = -1, lastOwn = 0, peerAck = -1, lastSend = 0, lastSentFrame = -99, dirty = true;
  const myHash = new Map(), theirHash = new Map();
  let stalls = 0, ran = 0, resends = 0, desync = null, waitingSince = 0;

  function sample() {                              // the buttons held now count for the frame `delay` ahead; frames skipped when the delay grows repeat them
    const target = F + D;
    while (ownThrough < target) {
      ownThrough++;
      const m = ownThrough < D ? 0 : localMask();
      own.set(ownThrough, m);
      if (m !== lastOwn) { log.push([ownThrough, m]); lastOwn = m; dirty = true; }
    }
  }
  function packet(now) {
    while (log.length && log[0][0] <= peerAck) log.shift();
    send({k: 'n', t: ownThrough, a: remThrough < 0 ? 0 : remThrough + 1, d: log.map(([f, m]) => `${f}:${m}`).join(',')});     // a: the first frame of yours I still miss (0: none yet)
    lastSend = now; lastSentFrame = F; dirty = false;
  }
  function receive(m, now = 0) {
    if (m.k === 'z') { theirHash.set(m.f, m.h); compare(m.f); return; }
    if (m.k !== 'n') return;
    if (typeof m.a === 'number' && m.a - 1 > peerAck) peerAck = m.a - 1;
    if (typeof m.d === 'string' && m.d) for (const part of m.d.split(',')) { const [f, mask] = part.split(':').map(Number); if (Number.isFinite(f) && Number.isFinite(mask) && f > remThrough) remChanges.set(f, mask & 255); }
    const t = Number(m.t);
    if (Number.isFinite(t)) while (remThrough < t) {   // the friend's buttons known through t: each frame keeps the mask of the one before unless a change says otherwise
      const f = remThrough + 1, prev = f === 0 ? 0 : rem.get(f - 1) ?? 0;
      rem.set(f, remChanges.has(f) ? remChanges.get(f) : prev); remChanges.delete(f); remThrough = f;
    }
  }
  function compare(f) {
    if (myHash.has(f) && theirHash.has(f) && !desync && myHash.get(f) !== theirHash.get(f)) { desync = f; onDesync(f); }
    myHash.delete(f - sumEvery * 4); theirHash.delete(f - sumEvery * 4);
  }
  /** one frame time has passed: run a frame if both sides' buttons for it are known; returns true if it ran */
  function step(now = 0) {
    sample();
    if (dirty || F - lastSentFrame >= every) packet(now);
    if (remThrough < F) {                          // waiting for the friend's buttons: say it again from time to time
      if (!waitingSince) waitingSince = now;
      stalls++;
      if (now - lastSend > 120) { packet(now); resends++; }
      return false;
    }
    waitingSince = 0;
    const mine = own.get(F) ?? 0, theirs = rem.get(F) ?? 0;
    run(role === 0 ? mine : theirs, role === 0 ? theirs : mine);
    ran++;
    if (checksum && F % sumEvery === sumEvery - 1) { const h = checksum(); myHash.set(F, h); send({k: 'z', f: F, h}); compare(F); }
    own.delete(F - 8); rem.delete(F - 8);
    F++;
    return true;
  }
  return {step, receive, setDelay: d => { D = Math.max(2, Math.min(20, Math.round(d))); }, frame: () => F, delay: () => D, waiting: () => waitingSince ? 1 : 0,
          stats: () => ({frame: F, stalls, ran, resends, desync, ownThrough, remThrough, delay: D})};
}

/** how many frames of delay a one-way trip of `ms` needs: the trip, a frame of jitter and a frame of safety, between 3 and 14 */
export const delayFor = ms => Math.max(3, Math.min(14, Math.ceil(ms / (1000 / 60.0988)) + 2));
