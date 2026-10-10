// The HTML layer over the 3D office: name tags, speech bubbles, progress rings, the top bar, the inspector,
// and what gets your attention when an agent waits for you (tab title, favicon, chime, desktop notification).

const CSS = `
#office { position: fixed; inset: 0 auto 0 0; width: 100vw; background: #1b1d27; z-index: 1; overflow: hidden;
  font: 13px/1.3 "Segoe UI", system-ui, sans-serif; color: #f4f1ea; display: none; }
body.mode-split #office, body.mode-office #office { display: block; }
body.mode-split #office { width: var(--office-w, 62vw); }
body.mode-split { padding-left: var(--office-w, 62vw); }
body.mode-office > :not(#office):not(#panel):not(#scrim):not(#lightbox) { display: none !important; }
#office canvas { display: block; width: 100%; height: 100%; outline: none; }
#office .o-tags { position: absolute; inset: 0; pointer-events: none; }
#office .o-tag { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center;
  gap: 3px; white-space: nowrap; transition: opacity .25s; }
#office .o-name { display: flex; align-items: center; gap: 5px; padding: 2px 7px 2px 4px; background: #14151dd9; border-radius: 3px;
  box-shadow: 2px 2px 0 #0008; font-weight: 700; font-size: 12px; letter-spacing: .02em; pointer-events: auto; cursor: pointer; }
#office .o-name i { font-style: normal; font-size: 13px; }
#office .o-name b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-name small { font-weight: 500; opacity: .7; font-size: 10.5px; }
#office .o-ring { width: 26px; height: 26px; }
#office .o-line { font-size: 11px; padding: 1px 6px; background: #0d0e14b3; border-radius: 3px; max-width: 220px; overflow: hidden;
  text-overflow: ellipsis; }
#office .o-bubble { max-width: 240px; white-space: normal; background: #fffdf6; color: #1b1b22; padding: 6px 9px; border-radius: 4px;
  box-shadow: 3px 3px 0 #0007; font-size: 12px; position: relative; animation: pop .25s ease-out; }
#office .o-bubble:after { content: ""; position: absolute; left: 50%; bottom: -6px; border: 6px solid transparent; border-bottom: 0;
  border-top-color: #fffdf6; transform: translateX(-50%); }
#office .o-bubble.o-plan { background: #fff3c4; } #office .o-bubble.o-user { background: #ffe1ec; }
#office .o-bubble.o-vote { background: #e6f4ea; }
#office .o-bubble.o-status, #office .o-bubble.o-idle { max-width: 190px; padding: 3px 7px; font-size: 10.5px; font-style: italic;
  background: #d9dde3; color: #39404a; box-shadow: 2px 2px 0 #0005; }
#office .o-bubble.o-idle { background: #c9d3da; }
#office .o-bubble.o-status:after { border-top-color: #d9dde3; } #office .o-bubble.o-idle:after { border-top-color: #c9d3da; }
#office .o-bubble.o-plan:after { border-top-color: #fff3c4; } #office .o-bubble.o-user:after { border-top-color: #ffe1ec; }
#office .o-bubble.o-vote:after { border-top-color: #e6f4ea; }
#office .o-flag { font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 3px; box-shadow: 2px 2px 0 #0008; }
#office .o-flag.o-wait { background: #e53935; color: #fff; animation: blink 1s steps(2) infinite; }
#office .o-flag.o-tag { background: #ffca28; color: #222; } #office .o-flag.o-late { background: #ff7043; color: #fff; }
#office .o-flag.o-idle { background: #455a64; color: #e0e0e0; } #office .o-flag.o-vote-yes { background: #43a047; color: #fff; }
#office .o-flag.o-vote-no { background: #c62828; color: #fff; }
#office .o-hud { position: absolute; left: 12px; top: 10px; right: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  pointer-events: none; }
#office .o-hud > * { pointer-events: auto; }
#office .o-chip { background: #14151dd9; padding: 5px 9px; border-radius: 3px; box-shadow: 2px 2px 0 #0008; font-weight: 600; }
#office .o-chip.o-big { font-size: 15px; } #office .o-chip.o-warn { background: #c62828; }
#office .o-btns { position: absolute; right: 12px; bottom: 10px; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
#office button { background: #14151dd9; border: 0; color: #f4f1ea; padding: 5px 9px; border-radius: 3px; box-shadow: 2px 2px 0 #0008;
  cursor: pointer; font: inherit; font-weight: 600; }
#office button.o-on { background: #f5b400; color: #222; }
#office button:focus-visible, #office .o-name:focus-visible { outline: 2px solid #ffd54f; }
#office .o-inspector { position: absolute; right: 12px; bottom: 52px; width: 300px; max-height: 70%; overflow: auto; background: #14151df2;
  border-radius: 4px; box-shadow: 4px 4px 0 #0009; padding: 12px; display: none; }
#office .o-inspector.o-open { display: block; }
#office .o-inspector h3 { margin: 0 0 2px; font-size: 16px; display: flex; gap: 6px; align-items: center; }
#office .o-inspector .o-meta { opacity: .75; font-size: 11.5px; margin-bottom: 8px; }
#office .o-bar { height: 7px; background: #2a2c38; border-radius: 2px; overflow: hidden; margin: 3px 0 8px; }
#office .o-bar > div { height: 100%; background: linear-gradient(90deg, #43a047, #fbc02d, #e53935); }
#office .o-spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; margin: 3px 0 8px; }
#office .o-spark div { flex: 1; background: #4fc3f7; min-height: 1px; border-radius: 1px; }
#office .o-tools div { display: flex; gap: 6px; font-size: 11.5px; padding: 2px 0; border-bottom: 1px solid #ffffff10; }
#office .o-tools span:last-child { margin-left: auto; opacity: .6; }
#office .o-tools .o-err { color: #ff8a80; }
#office .o-msgs div { font-size: 11.5px; padding: 4px 0; border-bottom: 1px solid #ffffff10; cursor: pointer; }
#office .o-row { display: flex; gap: 6px; margin-top: 8px; }
#office .o-common { position: absolute; left: 12px; bottom: 34px; width: 270px; max-height: 60%; overflow: auto; background: #14151df2;
  border-radius: 4px; box-shadow: 4px 4px 0 #0009; padding: 12px; display: none; }
#office .o-common.o-open { display: block; }
#office .o-common h3 { margin: 0 0 4px; font-size: 15px; }
#office .o-common label { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
#office .o-common label b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-common hr { border: 0; border-top: 1px solid #ffffff1a; margin: 8px 0; }
#office .o-common .o-meta { opacity: .7; font-size: 11.5px; }
#office .o-common { width: 300px; }
#office .o-common h4 { margin: 4px 0; font-size: 12.5px; }
#office .o-common input[type=text], #office .o-common select { width: 100%; box-sizing: border-box; margin: 3px 0; background: #22242f; color: #f4f1ea;
  border: 1px solid #ffffff22; border-radius: 3px; padding: 5px 7px; font: inherit; }
#office .o-common .o-copy { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
#office .o-common .o-copy code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
#office .o-common .o-pin { font-size: 20px; letter-spacing: .15em; color: #ffd54f; flex: 1; }
#office .o-common .o-guest { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
#office .o-common .o-guest b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-common .o-guest button { margin-left: auto; }
#office .o-common .o-stop { margin-top: 6px; background: #8e2424; }
#office .o-common textarea { width: 100%; box-sizing: border-box; min-height: 52px; background: #22242f; color: #f4f1ea; border: 1px solid #ffffff22;
  border-radius: 3px; padding: 5px 7px; font: inherit; resize: vertical; }
#office .o-common .o-req { padding: 6px; margin: 4px 0; border: 1px solid #ffd54f66; border-radius: 3px; font-size: 12px; }
#office .o-common .o-reqrow { display: flex; gap: 4px; margin: 4px 0; } #office .o-common .o-reqrow select { margin: 0; padding: 3px; }
#office .o-common .o-lend { background: #2e7d32; } #office .o-common .o-visitbtn { width: 100%; margin: 6px 0; background: #1565c0; }
#office .o-visit { position: absolute; left: 50%; top: 52px; transform: translateX(-50%); padding: 7px 14px; border-radius: 3px; background: #1565c0;
  color: #fff; font-weight: 700; box-shadow: 2px 2px 0 #0008; display: flex; gap: 10px; align-items: center; }
#office .o-common .o-write { display: flex; gap: 6px; align-items: center; } #office .o-common .o-write input { flex: 1; }
#office .o-common .o-attach { cursor: pointer; font-size: 16px; } #office .o-common a { color: #80deea; }
#office .o-common .o-game { padding: 6px; margin: 4px 0; border: 1px solid #ffffff22; border-radius: 3px; }
#office .o-common .o-tris { display: grid; grid-template-columns: repeat(3, 34px); gap: 3px; margin: 5px 0; }
#office .o-common .o-cell { width: 34px; height: 34px; padding: 0; font-size: 18px; font-weight: 800; }
#office .o-common .o-cell.o-win { background: #2e7d32; }
#office .o-common .o-c-msgs { max-height: 150px; overflow: auto; font-size: 12px; }
#office .o-common .o-c-msgs div { padding: 2px 0; border-bottom: 1px solid #ffffff0d; }
#office .o-room { position: absolute; pointer-events: none; padding: 4px 10px; border-radius: 3px; background: #14151de6; color: #f3e3c3;
  font-weight: 700; font-size: 13px; box-shadow: 2px 2px 0 #0008; opacity: 0; transition: opacity .35s; white-space: nowrap; transform: translate(14px, -130%); }
#office .o-room.o-show { opacity: 1; }
#office .o-place { position: absolute; left: 50%; top: 54px; transform: translateX(-50%); pointer-events: none; padding: 6px 16px; border-radius: 3px;
  background: #14151de6; color: #f3e3c3; font-weight: 700; font-size: 16px; letter-spacing: .03em; opacity: 0; transition: opacity .5s; }
#office .o-place.o-show { opacity: 1; }
#office .o-label { position: absolute; transform: translate(-50%, -100%); pointer-events: none; padding: 2px 7px; border-radius: 3px;
  background: #fffdf6e6; color: #1b1b22; font-size: 11px; font-weight: 700; box-shadow: 2px 2px 0 #0006; white-space: nowrap; }
#office .o-palette { position: absolute; left: 50%; bottom: 100px; transform: translateX(-50%); width: 420px; max-width: 90%; background: #14151df2;
  border-radius: 4px; box-shadow: 4px 4px 0 #0009; padding: 8px; display: none; }
#office .o-palette.o-open { display: block; }
#office .o-palette div { padding: 6px 8px; border-radius: 3px; cursor: pointer; display: flex; gap: 8px; }
#office .o-palette div.o-sel, #office .o-palette div:hover { background: #f5b400; color: #222; }
#office .o-palette small { opacity: .75; }
#office .o-hint { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); pointer-events: none; padding: 6px 14px; border-radius: 3px;
  background: #f5b400; color: #222; font-weight: 800; font-size: 14px; box-shadow: 2px 2px 0 #0008; display: none; }
#office .o-help { position: absolute; left: 12px; bottom: 44px; max-width: 58%; font-size: 11px; opacity: .55; pointer-events: none; }
@keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes blink { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { #office .o-bubble, #office .o-flag.o-wait { animation: none; } }
@media (max-width: 900px) { body.mode-split { padding-left: 0; padding-top: 42vh; } body.mode-split #office { width: 100vw; height: 42vh; inset: 0 0 auto 0; } }
`;

export const L = {
  en: {code: 'writing code', read: 'reading', term: 'terminal', web: 'on the web', post: 'writing in the chat', chat: 'reading the chat',
       agent: 'delegating', msg: 'messaging', other: 'working', think: 'thinking', idle: 'idle', coffee: 'coffee break',
       wait: 'NEEDS YOU', tagged: '@ for you', late: 'late status', you: 'you', lead: 'assistant', waiting: n => `${n} need you`,
       working: n => `${n} working`, idles: n => `${n} idle`, done: 'CLOSED', plan: v => `plan v${v}`, votes: (y, n) => `${y} yes / ${n} to vote`,
       split: 'Split', office: 'Office', chat: 'Chat', reset: 'View', follow: 'Follow', quality: q => `Quality: ${q}`,
       notify: 'Alerts', help: 'drag: orbit · wheel: zoom · click someone: inspect · click the floor, a chair or the coffee machine: go there · ←→: next agent · F: follow · Esc', tag: '@ Tag',
       povHelp: 'W/S: walk · A/D: turn · drag: look around · E: what the hint says · Q: wave · click someone: inspect · Esc',
       common: 'Common room', commonAll: 'open to the whole room', commonSome: n => `open to ${n}`, commonClosed: 'by invitation',
       commonWho: 'Who may take a break here', commonAllLabel: 'the whole room', commonShare: 'share with connected friends',
       commonShareNote: 'works once friends can connect (coming)', friendOffice: 'Connected office',
       shareTitle: 'Share with friends', shareStart: 'Share', shareStop: 'Stop sharing', shareOpening: 'opening the tunnel…',
       shareGive: 'Give your friend this address and the PIN:', copy: 'Copy', kick: 'Send away', noGuests: 'nobody has joined yet',
       shareBusy: 'You are in a friend\'s room: leave it to share yours.', viaCloudflared: 'Internet (cloudflared, no account)',
       viaPinggy: 'Internet (Pinggy over ssh, 60 min)', viaLan: 'Home network', needCloudflared: 'cloudflared is not on this computer yet.',
       install: 'Download cloudflared (from github.com/cloudflare, checked)', installing: 'downloading cloudflared…',
       joinTitle: 'Join a friend\'s room', joinGo: 'Join', leave: 'Leave', joinedAt: h => `You are in ${h}'s common room`,
       commonChat: 'The room\'s chat', commonWrite: 'Write in the common room…', guest: 'guest', commonMirror: 'show it in the main chat too',
       attach: 'Attach a text document (up to 5 MB)', tooBig: 'a document can be at most 5 MB',
       games: 'Games', tris: 'Tic-tac-toe', morra: 'Rock paper scissors', dice: 'Dice', rolls: 'rolls the dice', opens: g => `opens a game of ${g}`,
       joins: 'joins game', puts: (m, c) => `puts ${m} on ${c}`, chose: 'has chosen', shows: 'shows', joinGame: 'Play', yourTurn: 'your turn',
       theirTurn: n => `${n}'s turn`, won: n => `${n} wins!`, draw: 'draw', waitingPlayer: 'waiting for an opponent',
       quitGame: 'Quit', quits: 'quits game', quitBy: n => `${n} quit`, oneGame: 'Finish or quit your game first',
       run: 'Run', lendFull: 'Full help: a lent agent works for real in its own folder (commands, a venv, tests)',
       lendSafe: 'Cautious help: a lent agent only talks and writes drafts', lendSwitch: 'change',
       chosenWait: 'chosen: waiting for the other', pick: {sasso: 'rock', carta: 'paper', forbici: 'scissors'}, friendDoor: 'Your friend opens this door when you are their guest',
       helpTitle: 'Ask for help', askPlaceholder: 'What do you need? (some research, a plan, a change to your files)', askGo: 'Ask',
       visit: h => `Visit ${h}'s office`, requestsTitle: 'Help requests', lend: 'Lend an agent', decline: 'Decline',
       lent: h => `${h} is on it`, declined: 'declined', pending: 'waiting for an answer', visiting: h => `Visiting ${h}'s office`, back: 'Back to my office',
       hint_stand: 'stand up', hint_sit: 'sit down', hint_coffee: 'make a coffee', hintTalk: n => `talk to ${n}`, hint_tv: 'watch the TV',
       hint_board: 'look at the whiteboard', hintStop: 'stop looking', go: 'Walk over', edit: 'Furnish', cmdTitle: 'quick commands for the room',
       hint_cmds: 'quick commands', cmdSent: c => `${c} sent to the room`,
       jump: 'In the chat', ctx: 'context', pulse: 'activity, last 5 min', tools: 'last tools', msgs: 'last messages',
       mod: 'live (mod)', tail: 'from transcripts', nodata: 'chat only'},
  it: {code: 'scrive codice', read: 'legge', term: 'terminale', web: 'sul web', post: 'scrive in chat', chat: 'legge la chat',
       agent: 'delega', msg: 'messaggio', other: 'lavora', think: 'pensa', idle: 'idle', coffee: 'pausa caffè',
       wait: 'TI ASPETTA', tagged: '@ per te', late: 'status in ritardo', you: 'tu', lead: 'assistente', waiting: n => `${n} ti aspettano`,
       working: n => `${n} lavorano`, idles: n => `${n} idle`, done: 'CHIUSO', plan: v => `piano v${v}`, votes: (y, n) => `${y} sì / ${n} da votare`,
       split: 'Diviso', office: 'Ufficio', chat: 'Chat', reset: 'Vista', follow: 'Segui', quality: q => `Qualità: ${q}`,
       notify: 'Avvisi', help: 'trascina: ruota · rotella: zoom · clic su qualcuno: dettagli · clic sul pavimento, su una sedia o sulla macchinetta: ci vai · ←→: agente dopo · F: segui · Esc', tag: '@ Tagga',
       povHelp: 'W/S: cammina · A/D: gira · trascina: guardati intorno · E: quello che dice il suggerimento · Q: saluta · clic su qualcuno: dettagli · Esc',
       common: 'Sala comune', commonAll: 'aperta a tutta la stanza', commonSome: n => `aperta a ${n}`, commonClosed: 'solo su invito',
       commonWho: 'Chi può fare la pausa qui', commonAllLabel: 'tutta la stanza', commonShare: 'condividi con gli amici collegati',
       commonShareNote: 'funziona quando gli amici potranno collegarsi (in arrivo)', friendOffice: 'Ufficio collegato',
       shareTitle: 'Condividi con gli amici', shareStart: 'Condividi', shareStop: 'Smetti di condividere', shareOpening: 'apro il tunnel…',
       shareGive: 'Dai al tuo amico questo indirizzo e il PIN:', copy: 'Copia', kick: 'Manda via', noGuests: 'non è ancora entrato nessuno',
       shareBusy: 'Sei nella sala di un amico: esci per condividere la tua.', viaCloudflared: 'Internet (cloudflared, senza account)',
       viaPinggy: 'Internet (Pinggy via ssh, 60 min)', viaLan: 'Rete di casa', needCloudflared: 'cloudflared non è ancora su questo computer.',
       install: 'Scarica cloudflared (da github.com/cloudflare, controllato)', installing: 'scarico cloudflared…',
       joinTitle: 'Entra nella sala di un amico', joinGo: 'Entra', leave: 'Esci', joinedAt: h => `Sei nella sala comune di ${h}`,
       commonChat: 'La chat della sala', commonWrite: 'Scrivi nella sala comune…', guest: 'ospite', commonMirror: 'mostrala anche nella chat principale',
       attach: 'Allega un documento di testo (fino a 5 MB)', tooBig: 'un documento può essere al massimo di 5 MB',
       games: 'Giochi', tris: 'Tris', morra: 'Morra cinese', dice: 'Dadi', rolls: 'tira i dadi', opens: g => `apre una partita a ${g}`,
       joins: 'entra nella partita', puts: (m, c) => `mette ${m} in ${c}`, chose: 'ha scelto', shows: 'mostra', joinGame: 'Gioca', yourTurn: 'tocca a te',
       theirTurn: n => `tocca a ${n}`, won: n => `vince ${n}!`, draw: 'pareggio', waitingPlayer: 'aspetta un avversario',
       quitGame: 'Abbandona', quits: 'abbandona la partita', quitBy: n => `${n} ha abbandonato`, oneGame: 'Prima finisci o abbandona la tua partita',
       run: 'Corri', lendFull: "Aiuto completo: l'agente prestato lavora davvero nella sua cartella (comandi, venv, test)",
       lendSafe: "Aiuto prudente: l'agente prestato parla e scrive solo bozze", lendSwitch: 'cambia',
       chosenWait: 'scelto: aspetta l\'altro', pick: {sasso: 'sasso', carta: 'carta', forbici: 'forbici'}, friendDoor: 'Questa porta si apre quando sei tu l\'ospite del tuo amico',
       helpTitle: 'Chiedi aiuto', askPlaceholder: 'Cosa ti serve? (una ricerca, un piano, una modifica ai tuoi file)', askGo: 'Chiedi',
       visit: h => `Visita l'ufficio di ${h}`, requestsTitle: 'Richieste di aiuto', lend: 'Presta un agente', decline: 'Rifiuta',
       lent: h => `${h} è al lavoro`, declined: 'rifiutata', pending: 'in attesa di risposta', visiting: h => `Sei in visita da ${h}`, back: 'Torna nel tuo ufficio',
       hint_stand: 'alzati', hint_sit: 'siediti', hint_coffee: 'fatti un caffè', hintTalk: n => `parla con ${n}`, hint_tv: 'guarda la TV',
       hint_board: 'guarda la lavagna', hintStop: 'smetti di guardare', go: 'Vai da lui', edit: 'Arreda', cmdTitle: 'comandi rapidi per la stanza',
       hint_cmds: 'comandi rapidi', cmdSent: c => `${c} mandato alla stanza`,
       jump: 'Nella chat', ctx: 'contesto', pulse: 'attività, ultimi 5 min', tools: 'ultimi strumenti', msgs: 'ultimi messaggi',
       mod: 'dal vivo (mod)', tail: 'dai transcript', nodata: 'solo chat'},
};
export const EMOJI = {code: '✏️', read: '📖', term: '💻', web: '🌐', post: '💬', chat: '👀', agent: '🤖', msg: '✉️', other: '🔧',
                      think: '💭', idle: '💤', coffee: '☕'};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// ------------------------------------------------------------------ games of the common room
// Every move is a common room line with a `game` field; each viewer replays the lines. A player is the name the server
// put on the line, never something written inside it. Morra: each choice travels first as a sha256 of choice and salt,
// and is shown only once both have chosen (honour system: friends play).
const TRIS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const BEATS = {sasso: 'forbici', carta: 'sasso', forbici: 'carta'}, PICK = {sasso: '✊', carta: '✋', forbici: '✌️'};
export function replayGames(lines) {
  const games = new Map(), dice = [];
  for (const m of lines) {
    const g = m.game, who = m.from;
    if (!g) continue;
    if (g.type === 'dadi') { dice.push({by: who, roll: g.roll, n: m.n}); continue; }
    let x = games.get(g.id);
    const busy = p => [...games.values()].some(y => !y.done && y.players.includes(p));   // one open game at a time
    if (g.op === 'new') { if (!x && !busy(who)) games.set(g.id, {id: g.id, type: g.type, players: [who], n: m.n, board: Array(9).fill(''), turn: 0, commits: {}, reveals: {}}); continue; }
    if (!x || x.done) continue;
    x.n = m.n;
    if (g.op === 'join') { if (x.players.length === 1 && x.players[0] !== who && !busy(who)) x.players.push(who); continue; }
    if (g.op === 'quit') { if (x.players.includes(who)) x.done = {quit: who, winner: x.players.find(p => p !== who) || null}; continue; }
    if (x.players.length < 2 || !x.players.includes(who)) continue;
    if (x.type === 'tris' && g.op === 'move' && who === x.players[x.turn] && !x.board[g.cell]) {
      x.board[g.cell] = x.turn ? 'O' : 'X'; x.turn = 1 - x.turn;
      const w = TRIS.find(([a, b, c]) => x.board[a] && x.board[a] === x.board[b] && x.board[a] === x.board[c]);
      if (w) x.done = {winner: x.board[w[0]] === 'X' ? x.players[0] : x.players[1], line: w}; else if (x.board.every(Boolean)) x.done = {draw: true};
    }
    if (x.type === 'morra') {
      if (g.op === 'commit' && !x.commits[who]) x.commits[who] = g.hash;
      if (g.op === 'reveal' && x.commits[who] && Object.keys(x.commits).length === 2 && !x.reveals[who]) x.reveals[who] = g.pick;
      if (Object.keys(x.reveals).length === 2) {
        const [a, b] = x.players, pa = x.reveals[a], pb = x.reveals[b];
        x.done = pa === pb ? {draw: true} : {winner: BEATS[pa] === pb ? a : b};
      }
    }
  }
  return {games: [...games.values()].sort((a, b) => b.n - a.n), dice: dice.slice(-3).reverse()};
}
async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const revealed = new Set();

export function createUI(root, {onMode, onPov, onRun, onReset, onFollow, onQuality, onSelect, onTag, onJump, onNext, onCommonOpen, onCommon, onGo, onEdit,
                                onShare, onJoin, onCommonWrite, onAsk, onVisit, onCommonDoc, onGame}) {
  let lastCommon = null;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  root.insertAdjacentHTML('beforeend', `<div class="o-tags"></div>
    <div class="o-hud"><span class="o-chip o-big" data-k="title"></span><span class="o-chip" data-k="pct"></span><span class="o-chip o-warn" data-k="wait" hidden></span>
      <span class="o-chip" data-k="work"></span><span class="o-chip" data-k="idle"></span><span class="o-chip" data-k="plan" hidden></span><span class="o-chip" data-k="src"></span>
</div>
    <div class="o-btns"><button data-b="split"></button><button data-b="office"></button><button data-b="chat"></button>
      <button data-b="edit"></button><button data-b="common"></button><button data-b="pov"></button><button data-b="run"></button><button data-b="reset"></button><button data-b="follow"></button><button data-b="quality"></button><button data-b="notify"></button></div>
    <div class="o-inspector" tabindex="-1"></div><div class="o-common"></div><div class="o-room"></div><div class="o-place"></div><div class="o-hint"></div><div class="o-palette" role="listbox"></div><div class="o-help"></div>`);
  const tags = root.querySelector('.o-tags'), hud = root.querySelector('.o-hud'), insp = root.querySelector('.o-inspector'), btns = root.querySelector('.o-btns');
  const cp = root.querySelector('.o-common');
  const chip = k => hud.querySelector(`[data-k="${k}"]`), btn = b => btns.querySelector(`[data-b="${b}"]`);
  let lang = 'it';
  const t = () => L[lang] || L.en;
  btns.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.b;
    if (['split', 'office', 'chat'].includes(k)) onMode(k);
    else if (k === 'edit') onEdit(); else if (k === 'common') onCommonOpen(); else if (k === 'pov') onPov(); else if (k === 'run') onRun(); else if (k === 'reset') onReset(); else if (k === 'follow') onFollow(); else if (k === 'quality') onQuality();
    else if (k === 'notify') askNotify();
  });
  const labels = new Map(), itemLabels = new Map();

  function label(name) {
    let l = labels.get(name);
    if (l) return l;
    const el = document.createElement('div'); el.className = 'o-tag';
    el.innerHTML = `<div class="o-bub"></div><div class="o-flags"></div><svg class="o-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#14151dd9" stroke="#ffffff22" stroke-width="5"/><circle class="o-arc" cx="18" cy="18" r="15" fill="none" stroke-width="5" stroke-dasharray="0 100" transform="rotate(-90 18 18)" pathLength="100"/><text x="18" y="22" text-anchor="middle" font-size="11" font-weight="700" fill="#fff"></text></svg><div class="o-line"></div><div class="o-name" tabindex="0" role="button"></div>`;
    el.querySelector('.o-name').addEventListener('click', () => onSelect(name));
    el.querySelector('.o-name').addEventListener('keydown', e => { if (e.key === 'Enter') onSelect(name); });
    tags.appendChild(el);
    l = {el, bub: el.querySelector('.o-bub'), flags: el.querySelector('.o-flags'), ring: el.querySelector('.o-ring'), arc: el.querySelector('.o-arc'),
         pct: el.querySelector('text'), line: el.querySelector('.o-line'), name: el.querySelector('.o-name'), key: ''};
    labels.set(name, l);
    return l;
  }

  return {
    setLang(x) { lang = x === 'en' ? 'en' : 'it'; },
    t,
    /** place a tag at screen x, y (CSS pixels); visible false hides it */
    place(name, x, y, visible, scale = 1) {
      const l = label(name);
      l.el.style.opacity = visible ? '1' : '0';
      l.el.style.left = x + 'px'; l.el.style.top = y + 'px';
      l.el.style.transform = `translate(-50%, -100%) scale(${scale})`;
    },
    /** what a tag shows; only touches the DOM when something changed */
    tag(name, d) {
      const l = label(name), key = JSON.stringify(d);
      if (key === l.key) return;
      l.key = key;
      l.name.innerHTML = `<b style="background:${esc(d.color)}"></b><i>${esc(d.emoji)}</i>${esc(d.title)}${d.sub ? ` <small>${esc(d.sub)}</small>` : ''}`;
      l.line.textContent = d.line || ''; l.line.style.display = d.line ? '' : 'none';
      l.ring.style.display = d.pct == null ? 'none' : '';
      if (d.pct != null) { l.arc.setAttribute('stroke', d.color); l.arc.setAttribute('stroke-dasharray', `${d.pct} ${100 - d.pct}`); l.pct.textContent = d.pct; }
      l.flags.innerHTML = (d.flags || []).map(([cls, text]) => `<span class="o-flag o-${cls}">${esc(text)}</span>`).join(' ');
      l.bub.innerHTML = d.bubble ? `<div class="o-bubble o-${esc(d.bubbleKind || 'x')}">${esc(d.bubble)}</div>` : '';
    },
    hud(d) {
      chip('title').textContent = d.title; chip('pct').textContent = d.pct == null ? '–' : `${d.pct}%`;
      chip('wait').style.display = d.waiting ? '' : 'none'; chip('wait').textContent = `🙋 ${t().waiting(d.waiting)}`;
      chip('work').textContent = `⚙️ ${t().working(d.working)}`; chip('idle').textContent = `💤 ${t().idles(d.idle)}`;
      chip('plan').style.display = d.plan ? '' : 'none'; chip('plan').textContent = d.plan || '';
      chip('src').textContent = d.src;
      for (const k of ['split', 'office', 'chat']) { btn(k).textContent = t()[k]; btn(k).classList.toggle('o-on', d.mode === k); }
      btn('pov').textContent = '👁 POV'; btn('pov').classList.toggle('o-on', !!d.pov);
      btn('run').textContent = '🏃 x2'; btn('run').title = t().run + ' (Shift)'; btn('run').classList.toggle('o-on', !!d.run);
      btn('edit').textContent = '🛠 ' + t().edit; btn('edit').classList.toggle('o-on', !!d.edit);
      btn('common').textContent = '🛋 ' + t().common; btn('common').classList.toggle('o-on', cp.classList.contains('o-open'));
      btn('reset').textContent = '🎥 ' + t().reset; btn('follow').textContent = '🎯 ' + t().follow; btn('follow').classList.toggle('o-on', !!d.follow);
      btn('quality').textContent = t().quality(d.quality); btn('notify').textContent = '🔔 ' + t().notify;
      btn('notify').classList.toggle('o-on', notifyOn());
      root.querySelector('.o-help').textContent = d.pov ? t().povHelp : t().help;
    },
    inspect(d) {
      if (!d) { insp.classList.remove('o-open'); return; }
      insp.classList.add('o-open');
      const bins = new Array(30).fill(0);
      for (const age of d.pulse || []) bins[Math.max(0, 29 - Math.floor(age / 10))]++;
      const max = Math.max(1, ...bins);
      const ctx = d.ctx && d.window ? Math.min(100, Math.round(100 * d.ctx / d.window)) : null;
      insp.innerHTML = `<h3><span>${esc(d.emoji)}</span>${esc(d.name)}</h3>
        <div class="o-meta">${esc([d.role, d.model, d.state].filter(Boolean).join(' · '))}</div>
        ${d.pct != null ? `<div>${d.pct}%</div><div class="o-bar"><div style="width:${d.pct}%;background:${esc(d.color)}"></div></div>` : ''}
        ${ctx != null ? `<div>${t().ctx}: ${Math.round(d.ctx / 1000)}k / ${Math.round(d.window / 1000)}k (${ctx}%)</div><div class="o-bar"><div style="width:${ctx}%"></div></div>` : ''}
        ${d.pulse ? `<div>${t().pulse}</div><div class="o-spark">${bins.map(b => `<div style="height:${Math.round(100 * b / max)}%"></div>`).join('')}</div>` : ''}
        ${(d.recent || []).length ? `<div>${t().tools}</div><div class="o-tools">${d.recent.slice(0, 10).map(r => `<div class="${r.ok ? '' : 'o-err'}"><span>${esc(r.emoji)}</span><span>${esc(r.tool)} ${esc(r.target || '')}</span><span>${r.ms < 1000 ? r.ms + ' ms' : Math.round(r.ms / 1000) + ' s'}</span></div>`).join('')}</div>` : ''}
        ${(d.msgs || []).length ? `<div style="margin-top:8px">${t().msgs}</div><div class="o-msgs">${d.msgs.map(m => `<div data-n="${m.n}">#${m.n} ${esc(m.text.slice(0, 140))}</div>`).join('')}</div>` : ''}
        <div class="o-row"><button data-x="tag">${t().tag}</button><button data-x="jump">${t().jump}</button>${d.you ? '' : `<button data-x="go">🚶 ${t().go}</button>`}</div>`;
      insp.querySelector('[data-x="tag"]').onclick = () => onTag(d.name);
      insp.querySelector('[data-x="jump"]').onclick = () => onJump(d.lastN);
      if (!d.you) insp.querySelector('[data-x="go"]').onclick = () => onGo(d.name);
      insp.querySelectorAll('.o-msgs [data-n]').forEach(el => el.onclick = () => onJump(+el.dataset.n));
    },
    /** the common room panel: who may take breaks there, the whole room, sharing with friends; null closes it */
    /** the common room panel: who may take breaks there, sharing it with friends, joining a friend's, its chat;
     *  d opens it (null closes it); commonState(s) then keeps the live parts up to date without touching the inputs */
    commonPanel(d) {
      if (!d) { cp.classList.remove('o-open'); return; }
      cp.classList.add('o-open');
      const L = t();
      cp.innerHTML = `<h3>🛋 ${esc(L.common)}</h3><div class="o-meta">${esc(L.commonWho)}</div>
        <label><input type="checkbox" data-c="all" ${d.cfg.all ? 'checked' : ''}> ${esc(L.commonAllLabel)}</label>
        ${d.names.map(n => `<label><input type="checkbox" data-n="${esc(n.name)}" ${d.cfg.who.includes(n.name) ? 'checked' : ''} ${d.cfg.all ? 'disabled' : ''}> <b style="background:${esc(n.color)}"></b>${esc(n.emoji)} ${esc(n.name)}</label>`).join('')}
        <label><input type="checkbox" data-c="mirror" ${d.cfg.mirror ? 'checked' : ''}> 💬 ${esc(L.commonMirror)}</label>
        <hr><h4>🌐 ${esc(L.shareTitle)}</h4><div class="o-c-share"></div>
        <hr><h4>🚪 ${esc(L.joinTitle)}</h4><div class="o-c-join">
          <input type="text" data-j="url" placeholder="https://….trycloudflare.com"><input type="text" data-j="pin" placeholder="PIN" maxlength="6" inputmode="numeric">
          <button data-j="go">${esc(L.joinGo)}</button></div><div class="o-c-jstat o-meta"></div>
        <div class="o-c-guest" style="display:none"><button data-j="visit" class="o-visitbtn"></button>
          <h4>🙋 ${esc(L.helpTitle)}</h4><textarea data-ask maxlength="1500" placeholder="${esc(L.askPlaceholder)}"></textarea>
          <button data-j="ask">${esc(L.askGo)}</button><div class="o-c-gstat o-meta"></div></div>
        <hr><h4>🎮 ${esc(L.games)}</h4><div class="o-grid"><button data-g="tris">⭕ ${esc(L.tris)}</button><button data-g="morra">✊ ${esc(L.morra)}</button>
          <button data-g="dadi">🎲 ${esc(L.dice)}</button></div><div class="o-c-games"></div>
        <hr><h4>💬 ${esc(L.commonChat)}</h4><div class="o-c-msgs"></div>
        <div class="o-write"><input type="text" data-w="text" placeholder="${esc(L.commonWrite)}" maxlength="32000">
          <label class="o-attach" title="${esc(L.attach)}">📎<input type="file" data-w="file" accept=".md,.txt,.json,.diff,.patch,.py,.js,.ts,.csv,.yaml,.yml,.toml,.sh,.ps1" hidden></label></div>`;
      const cfg = () => ({all: cp.querySelector('[data-c="all"]').checked, shared: d.cfg.shared, mirror: cp.querySelector('[data-c="mirror"]').checked,
                          who: [...cp.querySelectorAll('[data-n]:checked')].map(e => e.dataset.n)});
      cp.querySelectorAll('[data-c], [data-n]').forEach(el => el.onchange = () => onCommon(cfg()));
      const write = cp.querySelector('[data-w="text"]'), file = cp.querySelector('[data-w="file"]');
      file.onchange = () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { file.value = ''; return onCommonDoc(null, null, t().tooBig); }
        const r = new FileReader();
        r.onload = () => { onCommonDoc(f.name, String(r.result).split(',')[1]); file.value = ''; };
        r.readAsDataURL(f);
      };
      write.onkeydown = e => { if (e.key === 'Enter' && write.value.trim()) { onCommonWrite(write.value.trim()); write.value = ''; } };
      cp.onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.j === 'go') onJoin(cp.querySelector('[data-j="url"]').value.trim(), cp.querySelector('[data-j="pin"]').value.trim());
        else if (b.dataset.j === 'leave') onJoin(null);
        else if (b.dataset.j === 'visit') onVisit();
        else if (b.dataset.j === 'ask') { const a = cp.querySelector('[data-ask]'); if (a.value.trim()) { onAsk(a.value.trim()); a.value = ''; } }
        else if (b.dataset.s === 'lend') { const c = b.closest('.o-req'); onShare('lend', {id: +c.dataset.id, model: c.querySelector('[data-m]').value,
                                             effort: c.querySelector('[data-e]').value, minutes: +c.querySelector('[data-min]').value}); }
        else if (b.dataset.s === 'decline') onShare('decline', {id: +b.closest('.o-req').dataset.id});
        else if (b.dataset.s === 'start') onShare('start', {via: cp.querySelector('[data-s="via"]').value});
        else if (b.dataset.s === 'lendmode') onShare('lend_mode', {mode: b.dataset.mode});
        else if (b.dataset.s) onShare(b.dataset.s, {name: b.dataset.name});
        else if (b.dataset.copy) navigator.clipboard?.writeText(b.dataset.copy);
        else if (b.dataset.g) {                                                    // a new game, or a roll of the dice
          const me = lastCommon?.me || '?', id = randomHex(4);
          if (b.dataset.g === 'dadi') {
            const roll = [...crypto.getRandomValues(new Uint8Array(2))].map(v => 1 + v % 6);
            onGame({type: 'dadi', op: 'roll', id, roll}, `🎲 ${me} ${L.rolls}: ${roll.join(' + ')} = ${roll[0] + roll[1]}`);
          } else onGame({type: b.dataset.g, op: 'new', id}, `🎮 ${me} ${L.opens(b.dataset.g === 'tris' ? L.tris : L.morra)} (#${id})`);
        }
        else if (b.dataset.gm === 'join') onGame({type: b.dataset.type, op: 'join', id: b.dataset.id}, `🎮 ${lastCommon?.me} ${L.joins} #${b.dataset.id}`);
        else if (b.dataset.gm === 'quit') onGame({type: b.dataset.type, op: 'quit', id: b.dataset.id}, `🎮 ${lastCommon?.me} ${L.quits} #${b.dataset.id}`);
        else if (b.dataset.gm === 'move') onGame({type: 'tris', op: 'move', id: b.dataset.id, cell: +b.dataset.cell},
                                                 `🎮 ${lastCommon?.me} ${L.puts(b.dataset.mark, +b.dataset.cell + 1)}`);
        else if (b.dataset.gm === 'pick') {
          const salt = randomHex(16), id = b.dataset.id, pick = b.dataset.pick;
          try { localStorage.setItem('chatroom.morra.' + id, JSON.stringify({pick, salt})); } catch (e) {}
          sha256hex(`${pick}:${salt}`).then(hash => onGame({type: 'morra', op: 'commit', id, hash}, `🎮 ${lastCommon?.me} ${L.chose}`));
        }
      };
      if (lastCommon) this.commonState(lastCommon);
    },
    commonState(s) {
      // a Codex host lends a Codex agent: 'default' is the session's own model, the others are the ones Codex documents
      const CODEX_MODELS = ['default', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'];
      lastCommon = s;
      if (!cp.classList.contains('o-open') || !s) return;
      const L = t(), sh = s.share || {}, br = s.bridge, box = cp.querySelector('.o-c-share');
      let html;
      if (br && br.joined) html = `<div class="o-meta">${esc(L.shareBusy)}</div>`;
      else if (sh.sharing) {
        html = sh.url
          ? `<div class="o-meta">${esc(L.shareGive)}</div><div class="o-copy"><code>${esc(sh.url)}</code><button data-copy="${esc(sh.url)}">${esc(L.copy)}</button></div>
             <div class="o-copy"><span>PIN</span><b class="o-pin">${esc(sh.pin)}</b><button data-copy="${esc(sh.pin)}">${esc(L.copy)}</button></div>`
          : `<div class="o-meta">${esc(sh.error || L.shareOpening)}</div>`;
        html += sh.guests.length ? sh.guests.map(g => `<div class="o-guest"><b style="background:${esc(g.color)}"></b>${esc(g.emoji)} ${esc(g.name)}
            <span class="o-meta">${g.agents ? '+' + g.agents : ''}</span><button data-s="kick" data-name="${esc(g.name)}">${esc(L.kick)}</button></div>`).join('')
          : `<div class="o-meta">${esc(L.noGuests)}</div>`;
        const reqs = sh.requests || [];
        if (reqs.length) html += `<h4>🙋 ${esc(L.requestsTitle)}</h4>` + reqs.slice(-6).reverse().map(r => r.status === 'pending'
          ? `<div class="o-req" data-id="${r.id}"><b>${esc(r.guest)}</b>: ${esc(r.text)}<div class="o-reqrow">
              <select data-m>${(s.codex ? CODEX_MODELS : ['sonnet', 'haiku', 'opus']).map(m => `<option>${m}</option>`).join('')}</select>
              <select data-e>${(s.codex ? ['medium', 'low', 'high', 'xhigh'] : ['medium', 'low', 'high', 'xhigh', 'max']).map(e => `<option>${e}</option>`).join('')}</select>
              <select data-min><option value="30">30 min</option><option value="15">15 min</option><option value="60">60 min</option></select></div>
              <button data-s="lend" class="o-lend">🤝 ${esc(L.lend)}</button> <button data-s="decline">${esc(L.decline)}</button></div>`
          : `<div class="o-meta">${esc(r.guest)}: ${esc(r.text.slice(0, 60))} · ${esc(r.status === 'approved' ? L.lent(r.helper) : L.declined)}</div>`).join('');
        html += `<button data-s="stop" class="o-stop">${esc(L.shareStop)}</button>`;
      } else {
        html = `<select data-s="via"><option value="cloudflared">${esc(L.viaCloudflared)}</option><option value="pinggy">${esc(L.viaPinggy)}</option>
                <option value="lan">${esc(L.viaLan)}</option></select><button data-s="start">${esc(L.shareStart)}</button>
                ${s.cloudflared ? '' : s.installing ? `<div class="o-meta">${esc(L.installing)}</div>` : `<div class="o-meta">${esc(L.needCloudflared)}</div><button data-s="install">${esc(L.install)}</button>`}
                ${s.install_error ? `<div class="o-meta">${esc(s.install_error)}</div>` : ''}`;
      }
      if (!(br && br.joined)) {
        const full = s.lend_mode !== 'safe';
        html += `<div class="o-meta">🤝 ${esc(full ? L.lendFull : L.lendSafe)} <button data-s="lendmode" data-mode="${full ? 'safe' : 'full'}">${esc(L.lendSwitch)}</button></div>`;
      }
      if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
      const js = cp.querySelector('.o-c-jstat'), jhtml = br && br.joined
        ? `${esc(L.joinedAt(br.host || '?'))} <button data-j="leave">${esc(L.leave)}</button>${br.error ? '<br>' + esc(br.error) : ''}` : '';
      if (js.dataset.html !== jhtml) { js.innerHTML = jhtml; js.dataset.html = jhtml; }
      cp.querySelector('.o-c-join').style.display = (br && br.joined) || sh.sharing ? 'none' : '';
      const gb = cp.querySelector('.o-c-guest');
      gb.style.display = br && br.joined ? '' : 'none';
      if (br && br.joined) {
        gb.querySelector('.o-visitbtn').textContent = '🚶 ' + L.visit(br.host || '?');
        const gs = gb.querySelector('.o-c-gstat'), ghtml = (br.requests || []).map(r => `<div>${esc(r.text.slice(0, 70))} · ${esc(r.status === 'approved' ? L.lent(r.helper) : r.status === 'declined' ? L.declined : L.pending)}</div>`).join('');
        if (gs.dataset.html !== ghtml) { gs.innerHTML = ghtml; gs.dataset.html = ghtml; }
      }
      // the games: the latest ones first, with what you can do now
      const {games, dice} = replayGames(s.games || []), me = s.me, gbox = cp.querySelector('.o-c-games');
      const busy = games.some(x => !x.done && x.players.includes(me));
      for (const b of cp.querySelectorAll('[data-g="tris"], [data-g="morra"]')) { b.disabled = busy; b.title = busy ? L.oneGame : ''; }
      const ghtml = games.slice(0, 4).map(x => {
        const vs = x.players.map(esc).join(' – ') || '?', mine = x.players.includes(me), status = x.done
          ? (x.done.quit ? L.quitBy(x.done.quit) : x.done.draw ? L.draw : L.won(x.done.winner)) : x.players.length < 2 ? L.waitingPlayer : '';
        const join = (!x.done && x.players.length === 1 && !mine && !busy ? `<button data-gm="join" data-type="${x.type}" data-id="${esc(x.id)}">${esc(L.joinGame)}</button>` : '')
          + (!x.done && mine ? ` <button data-gm="quit" data-type="${x.type}" data-id="${esc(x.id)}">🏳 ${esc(L.quitGame)}</button>` : '');
        if (x.type === 'tris') {
          const myTurn = !x.done && x.players.length === 2 && x.players[x.turn] === me, mark = x.turn ? 'O' : 'X';
          const cells = x.board.map((v, i) => `<button class="o-cell${x.done?.line?.includes(i) ? ' o-win' : ''}" ${myTurn && !v ? `data-gm="move" data-id="${esc(x.id)}" data-cell="${i}" data-mark="${mark}"` : 'disabled'}>${v || ''}</button>`).join('');
          const turn = !x.done && x.players.length === 2 ? (myTurn ? L.yourTurn : L.theirTurn(x.players[x.turn])) : '';
          return `<div class="o-game"><b>⭕ ${esc(L.tris)}</b> <span class="o-meta">${vs}</span><div class="o-tris">${cells}</div><div class="o-meta">${esc(status || turn)}</div>${join}</div>`;
        }
        const chosen = !!x.commits[me], picks = x.done ? x.players.map(p => `${esc(p)} ${PICK[x.reveals[p]] || '?'}`).join(' · ') : '';
        const buttons = mine && x.players.length === 2 && !chosen && !x.done
          ? Object.entries(PICK).map(([k, e]) => `<button data-gm="pick" data-id="${esc(x.id)}" data-pick="${k}">${e} ${esc(L.pick[k])}</button>`).join(' ') : '';
        const wait = mine && chosen && !x.done ? L.chosenWait : '';
        return `<div class="o-game"><b>✊ ${esc(L.morra)}</b> <span class="o-meta">${vs}</span><div>${buttons}</div><div class="o-meta">${esc(picks)} ${esc(status || wait)}</div>${join}</div>`;
      }).join('') + dice.map(d => `<div class="o-meta">🎲 ${esc(d.by)}: ${d.roll.join(' + ')} = ${d.roll.reduce((a, b) => a + b, 0)}</div>`).join('');
      if (gbox.dataset.html !== ghtml) { gbox.innerHTML = ghtml; gbox.dataset.html = ghtml; }
      for (const x of games) if (x.type === 'morra' && !x.done && x.commits[me] && Object.keys(x.commits).length === 2 && !x.reveals[me] && !revealed.has(x.id)) {
        let kept = null; try { kept = JSON.parse(localStorage.getItem('chatroom.morra.' + x.id)); } catch (e) {}
        if (kept) { revealed.add(x.id); onGame({type: 'morra', op: 'reveal', id: x.id, pick: kept.pick, salt: kept.salt}, `🎮 ${me} ${L.shows} ${PICK[kept.pick]} ${L.pick[kept.pick]}`); }
      }
      const msgs = cp.querySelector('.o-c-msgs'), mh = (s.messages || []).slice(-12).map(m => `<div><b>${esc(m.from)}</b> ${m.doc
        ? `<a href="common/doc/${+m.doc.id}" target="_blank" rel="noopener">📎 ${esc(m.doc.name)}</a> <span class="o-meta">${Math.max(1, Math.round((m.doc.size || 0) / 1024))} KB</span>`
        : esc(m.text.length > 400 ? m.text.slice(0, 400) + '…' : m.text)}</div>`).join('') || `<div class="o-meta">—</div>`;
      if (msgs.dataset.html !== mh) { msgs.innerHTML = mh; msgs.dataset.html = mh; msgs.scrollTop = msgs.scrollHeight; }
    },
    commonOpen: () => cp.classList.contains('o-open'),
    /** labels of furniture: [{key, text, x, y, vis}]; the ones not listed are removed */
    itemLabels(list) {
      const seen = new Set();
      for (const l of list) {
        seen.add(l.key);
        let el = itemLabels.get(l.key);
        if (!el) { el = document.createElement('div'); el.className = 'o-label'; tags.appendChild(el); itemLabels.set(l.key, el); }
        if (el.textContent !== l.text) el.textContent = l.text;
        el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; el.style.display = l.vis ? '' : 'none';
      }
      for (const [k, el] of itemLabels) if (!seen.has(k)) { el.remove(); itemLabels.delete(k); }
    },
    /** the banner while visiting a friend's office, with the way back */
    visitBanner(text, onBack) {
      root.insertAdjacentHTML('beforeend', `<div class="o-visit">🚶 ${esc(text)} <button>${esc(t().back)}</button></div>`);
      root.querySelector('.o-visit button').onclick = onBack;
    },
    /** the quick commands, sitting at your desk: arrows to pick, Enter to send, Esc to close; null closes it */
    palette(list, onPick) {
      const el = root.querySelector('.o-palette');
      if (!list) { el.classList.remove('o-open'); el.onkeydown = null; return; }
      let on = 0;
      const draw = () => {
        el.innerHTML = `<div class="o-meta" style="cursor:default">/ ${esc(t().cmdTitle)}</div>` + list.map((c, k) =>
          `<div data-k="${k}" class="${k === on ? 'o-sel' : ''}"><b>${esc(c.icon)} ${esc(c.name)}</b><small>${esc(c.label)}</small></div>`).join('');
      };
      draw();
      el.classList.add('o-open');
      el.onclick = e => { const d = e.target.closest('[data-k]'); if (d) { onPick(list[+d.dataset.k]); this.palette(null); } };
      this.paletteKey = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { on = (on + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; draw(); }
        else if (e.key === 'Enter') { onPick(list[on]); this.palette(null); }
        else if (e.key === 'Escape') this.palette(null);
        else return false;
        return true;
      };
    },
    paletteOpen: () => root.querySelector('.o-palette').classList.contains('o-open'),
    /** the E hint in first person; '' hides it */
    hint(text) { const el = root.querySelector('.o-hint'); if (el.textContent !== text) el.textContent = text; el.style.display = text ? 'block' : 'none'; },
    /** the name of the room under the mouse, near it, for a moment */
    roomTip(text, x, y) {
      const el = root.querySelector('.o-room');
      el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px'; el.classList.add('o-show');
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('o-show'), 1600);
    },
    /** the room you walked into, in first person, for a moment */
    placeName(text) {
      const el = root.querySelector('.o-place');
      el.textContent = '📍 ' + text; el.classList.add('o-show');
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('o-show'), 2200);
    },
    remove(name) { const l = labels.get(name); if (l) { l.el.remove(); labels.delete(name); } },
    onKey: e => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { onNext(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
      else if (e.key === 'Escape') onSelect(null);
      else if (e.key === 'f' || e.key === 'F') onFollow();
    },
  };
}

// ------------------------------------------------------------------ attention
let audio = null;
export function unlockAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
}
/** the two-note chime (E5 then E6) when someone starts waiting for you */
export function chime() {
  if (!audio || audio.state !== 'running') return;
  for (const [f, at] of [[659.25, 0], [1318.5, 0.16]]) {
    const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.4);
  }
}
const notifyOn = () => 'Notification' in window && Notification.permission === 'granted';
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
const shown = new Map();
/** desktop notification only while the page is hidden; a wait stays until handled, clicking focuses the agent */
export function notify(id, title, body, sticky, onClick) {
  if (!notifyOn() || (!document.hidden && document.hasFocus())) return;
  shown.get(id)?.close();
  try {
    const n = new Notification(title, {body, tag: 'chatroom-' + id, requireInteraction: !!sticky});
    n.onclick = () => { window.focus(); n.close(); onClick?.(); };
    shown.set(id, n);
  } catch (e) {}
}
export function unnotify(keep) { for (const [id, n] of shown) if (!keep.has(id)) { n.close(); shown.delete(id); } }
window.addEventListener('focus', () => { for (const n of shown.values()) n.close(); shown.clear(); });

/** the tab title counts who waits for you; the favicon gets a red dot */
let lastIcon = '';
export function badge(baseTitle, waiting, icon) {
  document.title = (waiting ? `(${waiting}) 🙋 ` : '') + baseTitle;
  const keyIcon = icon + waiting;
  if (keyIcon === lastIcon) return;
  lastIcon = keyIcon;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon || '💬', 32, 36);
  if (waiting) { g.fillStyle = '#e53935'; g.beginPath(); g.arc(50, 14, 13, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText(String(waiting), 50, 15); }
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = c.toDataURL();
}
