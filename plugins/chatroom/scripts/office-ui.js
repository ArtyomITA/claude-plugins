// The HTML layer over the 3D office: name tags, speech bubbles, progress rings, the top bar, the inspector,
// and what gets your attention when an agent waits for you (tab title, favicon, chime, desktop notification).

import {poolRack} from './office-games.js';
import {drawStrip, drawChart, summary} from './office-timeline.js';

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
#office .o-flag.o-idle { background: #455a64; color: #e0e0e0; } #office .o-flag.o-help { background: #26a69a; color: #fff; } #office .o-flag.o-vote-yes { background: #43a047; color: #fff; }
#office .o-flag.o-vote-no { background: #c62828; color: #fff; }
#office .o-hud { position: absolute; left: 12px; top: 10px; right: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  pointer-events: none; }
#office .o-hud > * { pointer-events: auto; }
#office .o-chip { background: #14151de6; padding: 5px 10px; border-radius: 8px; box-shadow: 0 2px 0 #0007, 0 6px 16px #0004; font-weight: 600; }
#office .o-chip.o-big { font-size: 15px; } #office .o-chip.o-warn { background: #c62828; }
#office { container-type: inline-size; scrollbar-width: thin; }
#office * { scrollbar-width: thin; scrollbar-color: #ffffff33 transparent; }
#office .o-btns { position: absolute; right: 12px; bottom: 10px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
#office .o-grp { display: flex; gap: 2px; padding: 3px; background: #14151de6; border-radius: 10px; box-shadow: 0 2px 0 #0007, 0 6px 16px #0004; }
#office button { background: #2b2e3d; border: 1px solid #ffffff1c; color: #f4f1ea; padding: 5px 10px; border-radius: 7px; cursor: pointer; font: inherit; font-weight: 600;
  transition: background .12s, color .12s, transform .08s; }
#office button:hover { background: #3a3f55; }
#office button:active { transform: translateY(1px); }
#office button:disabled { opacity: .45; cursor: default; transform: none; }
#office .o-tvcard, #office .o-tvcard:hover { padding: 0; background: #1a2030; border: 1px solid #263048; border-radius: 10px; font-weight: 400; }
#office .o-tvcard:hover, #office .o-tvcard:focus-visible { border-color: #e53935; }
#office .o-tvcard.o-on { border-color: #ffd54f; }
#office .o-grp button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; background: transparent; border-color: transparent; color: #e9e6df; padding: 4px 9px; }
#office .o-grp button:hover { background: #ffffff1f; color: #fff; }
#office button.o-on { background: #f5b400; border-color: #f5b400; color: #1b1b22; box-shadow: inset 0 -2px 0 #0003; }
#office button.o-on:hover { background: #ffc720; }
#office button .o-ic { font-size: 15px; line-height: 1; }
#office button:focus-visible, #office .o-name:focus-visible { outline: 2px solid #ffd54f; outline-offset: 1px; }
#office input:focus-visible, #office select:focus-visible, #office textarea:focus-visible { outline: 2px solid #ffd54f88; border-color: #ffd54f; }
@container (max-width: 820px) { #office .o-grp:not(.o-seg) .o-lbl { display: none; } #office .o-grp:not(.o-seg) button { padding: 4px 8px; } }
#office .o-inspector { position: absolute; right: 12px; bottom: 56px; width: 300px; max-height: 70%; overflow: auto; background: #14151df2;
  border: 1px solid #ffffff14; border-radius: 12px; box-shadow: 0 10px 28px #0007; padding: 12px; display: none; }
#office .o-inspector.o-open, #office .o-common.o-open { display: block; animation: o-in .14s ease-out; }
#office .o-inspector h3 { margin: 0 0 2px; font-size: 16px; display: flex; gap: 6px; align-items: center; }
#office .o-inspector .o-meta { opacity: .75; font-size: 11.5px; margin-bottom: 8px; }
#office .o-bar { height: 7px; background: #2a2c38; border-radius: 2px; overflow: hidden; margin: 3px 0 8px; }
#office .o-bar > div { height: 100%; background: linear-gradient(90deg, #43a047, #fbc02d, #e53935); }
#office .o-spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; margin: 3px 0 8px; }
#office .o-spark div { flex: 1; background: #4fc3f7; min-height: 1px; border-radius: 1px; }
#office .o-tl { width: 140px; height: 22px; border-radius: 3px; pointer-events: auto; cursor: pointer; box-shadow: 0 0 0 1px #ffffff1a; }
#office .o-chart { display: block; width: 272px; max-width: 100%; height: 150px; margin: 3px 0 4px; border-radius: 4px; }
#office .o-tools div { display: flex; gap: 6px; font-size: 11.5px; padding: 2px 0; border-bottom: 1px solid #ffffff10; }
#office .o-tools span:last-child { margin-left: auto; opacity: .6; }
#office .o-tools .o-err { color: #ff8a80; }
#office .o-msgs div { font-size: 11.5px; padding: 4px 0; border-bottom: 1px solid #ffffff10; cursor: pointer; }
#office .o-row { display: flex; gap: 6px; margin-top: 8px; }
#office .o-common { position: absolute; left: 12px; bottom: 34px; width: 270px; max-height: 60%; overflow: auto; background: #14151df2;
  border: 1px solid #ffffff14; border-radius: 12px; box-shadow: 0 10px 28px #0007; padding: 12px; display: none; }
#office .o-common h3 { margin: 0 0 4px; font-size: 15px; }
#office .o-common label { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
#office .o-common label b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-common hr { border: 0; border-top: 1px solid #ffffff1a; margin: 8px 0; }
#office .o-common .o-meta { opacity: .7; font-size: 11.5px; }
#office .o-common { width: 300px; }
#office .o-look { left: auto; right: 12px; width: 260px; }
#office .o-lb { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(480px, 94%); max-height: 82%; overflow: auto; background: #14151df5;
  border: 1px solid #ffffff1c; border-radius: 14px; box-shadow: 0 14px 40px #000a; padding: 14px; display: none; z-index: 7; }
#office .o-lb.o-open { display: block; }
#office .o-lb h3 { margin: 0 0 8px; font-size: 16px; display: flex; align-items: center; gap: 8px; }
#office .o-lb h3 button { margin-left: auto; }
#office .o-lb .o-lbtabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
#office .o-lb .o-lbtabs button { padding: 4px 9px; border-radius: 8px; background: #ffffff12; border: 1px solid transparent; }
#office .o-lb .o-lbtabs button.o-on { background: #f5b40033; border-color: #f5b400; }
#office .o-lb table { width: 100%; border-collapse: collapse; font-size: 13px; }
#office .o-lb th { font-size: 11px; opacity: .6; font-weight: 600; text-align: right; padding: 2px 6px; }
#office .o-lb td { padding: 5px 6px; text-align: right; border-bottom: 1px solid #ffffff10; }
#office .o-lb th:nth-child(2), #office .o-lb td:nth-child(2) { text-align: left; width: 100%; }
#office .o-lb td:first-child { text-align: center; width: 28px; }
#office .o-lb tr.o-first td { color: #ffd54f; font-weight: 700; }
#office .o-lb tr.o-me td { background: #4fc3f722; }
#office .o-lb tr.o-me td:nth-child(2) { font-weight: 700; }
#office .o-lb .o-lbgap td { text-align: center; opacity: .5; padding: 1px; border: 0; }
#office .o-sws { display: flex; flex-wrap: wrap; gap: 5px; margin: 3px 0 8px; }
#office .o-sw { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #ffffff33; padding: 0; cursor: pointer; }
#office .o-sw.o-on { border-color: #fff; box-shadow: 0 0 0 2px #ffffff55; }
#office .o-common h4 { margin: 4px 0; font-size: 12.5px; }
#office .o-common input[type=text], #office .o-common select { width: 100%; box-sizing: border-box; margin: 3px 0; background: #22242f; color: #f4f1ea;
  border: 1px solid #ffffff22; border-radius: 3px; padding: 5px 7px; font: inherit; }
#office .o-common .o-copy { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
#office .o-common .o-copy code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
#office .o-common .o-pin { font-size: 20px; letter-spacing: .15em; color: #ffd54f; flex: 1; }
#office .o-common .o-guest { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
#office .o-common .o-guest b { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
#office .o-common .o-guest button { margin-left: auto; }
#office .o-common .o-stop { margin-top: 6px; background: #8e2424; border-color: #b23a3a; }
#office .o-common textarea { width: 100%; box-sizing: border-box; min-height: 52px; background: #22242f; color: #f4f1ea; border: 1px solid #ffffff22;
  border-radius: 3px; padding: 5px 7px; font: inherit; resize: vertical; }
#office .o-common .o-req { padding: 6px; margin: 4px 0; border: 1px solid #ffd54f66; border-radius: 3px; font-size: 12px; }
#office .o-common .o-reqrow { display: flex; gap: 4px; margin: 4px 0; } #office .o-common .o-reqrow select { margin: 0; padding: 3px; }
#office .o-common .o-lend { background: #2e7d32; border-color: #43a047; } #office .o-common .o-visitbtn { width: 100%; margin: 6px 0; background: #1565c0; border-color: #1e88e5; }
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
#office .o-help { position: absolute; left: 12px; bottom: 60px; max-width: min(400px, 46%); padding: 7px 11px; border-radius: 9px; background: #14151de6; box-shadow: 0 6px 16px #0004;
  font-size: 11.5px; line-height: 1.45; pointer-events: none; opacity: 0; transform: translateY(4px); transition: opacity .35s, transform .35s; z-index: 2; }
#office .o-help.o-show { opacity: 1; transform: none; }
#office .o-more { position: relative; }
#office .o-menu { position: absolute; right: 0; bottom: calc(100% + 8px); min-width: 220px; display: none; flex-direction: column; gap: 2px; padding: 8px; background: #14151df2;
  border: 1px solid #ffffff14; border-radius: 12px; box-shadow: 0 10px 28px #0007; z-index: 3; }
#office .o-menu.o-open { display: flex; animation: o-in .14s ease-out; }
#office .o-menu h5 { margin: 6px 6px 2px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; opacity: .55; }
#office .o-menu h5:first-child { margin-top: 2px; }
#office .o-menu button { display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; background: transparent; border-color: transparent; padding: 6px 9px; }
#office .o-menu button:hover { background: #ffffff1f; }
#office .o-menu button.o-on { background: #f5b400; color: #1b1b22; }
@keyframes o-in { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes blink { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { #office .o-bubble, #office .o-flag.o-wait, #office .o-inspector.o-open, #office .o-common.o-open { animation: none; } #office button { transition: none; } }
@media (max-width: 900px) { body.mode-split { padding-left: 0; padding-top: 42vh; } body.mode-split #office { width: 100vw; height: 42vh; inset: 0 0 auto 0; } }
`;

export const L = {
  en: {code: 'writing code', read: 'reading', term: 'terminal', web: 'on the web', post: 'writing in the chat', chat: 'reading the chat',
       agent: 'delegating', msg: 'messaging', other: 'working', think: 'thinking', idle: 'idle', coffee: 'coffee break',
       wait: 'NEEDS YOU', tagged: '@ for you', late: 'late status', you: 'you', lead: 'assistant', waiting: n => `${n} need you`,
       working: n => `${n} working`, idles: n => `${n} idle`, done: 'CLOSED', plan: v => `plan v${v}`, votes: (y, n) => `${y} yes / ${n} to vote`,
       split: 'Split', office: 'Office', chat: 'Chat', reset: 'View', follow: 'Follow', quality: q => `Quality: ${q}`,
       notify: 'Alerts', help: 'drag: orbit · wheel: zoom · click someone: inspect · click the floor, a chair or the coffee machine: go there · ←→: next agent · F: follow · Esc', tag: '@ Tag',
       povHelp: 'WASD: walk (A/D sideways) · mouse: look (click to capture it, Esc frees it) · Shift: run · Space: jump, or climb a desk · E: what the hint says · Q: wave · Esc',
       sensName: i => 'Mouse: ' + ['slow', 'medium', 'fast', 'very fast'][i || 0],
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
       quitGame: 'Quit', quits: 'quits game', quitBy: n => `${n} quit`, oneGame: 'Finish or quit your game first', more: 'More', gamesTitle: 'Games', toolsTitle: 'Tools', pingPong: 'Ping pong', helpBtn: 'Help',
       poolWaiting: n => `Waiting for ${n}...`, poolWaitAny: 'a friend', poolCancel: 'Cancel', pingpong: 'Ping pong', foos: 'Foosball', theyWin: n => `${n} wins`, newMatch: 'Play with a friend, live', joinMatch: n => `Play with ${n}`,
       matchFriends: 'Link with a friend to play together', liveMatch: 'live match', poolFouls: 'fouls: -1 point each', cue_classic: 'Classic', cue_power: 'Power', cue_precise: 'Precise', cue_spin: 'Spin', cue_classic_tip: 'The cue as it is', cue_power_tip: '+40% force, but the aim trembles ', cue_precise_tip: '-20% force, a long aim line with the bounce', cue_spin_tip: 'The cue ball curves (press 4 again to turn the other way)', goal: 'GOAL!', points: 'pts', poolQuit: 'Forfeit', poolRestart: 'New game', poolYourTurn: 'Your turn: aim with the mouse, hold to load the shot, let go to shoot', poolTheirTurn: n => `${n} is playing...`, poolLate: 'The table is not ready yet: try again in a moment', poolStarts: 'Your friend is here: play!',
       askFriend: 'Ask a friend for help', autoLend: 'Lend by itself', autoOn: 'ON', autoOff: 'off',
       pool: 'Pool', foosball: 'Foosball', scores: 'Leaderboard', hint_scores: 'see the leaderboard', hint_arcade: 'play the arcade', hint_github: 'open the GitHub window', arcadeInvite: (n, g) => `🕹 ${n} invites you to play ${g}: open the arcade`, noScores: 'no games played yet', colWins: 'W', colLoss: 'L', colPts: 'pts', colBest: 'best', colRuns: 'runs',
       foosHint: 'Mouse: slide the rod (its position picks the rod, or keys 1-4) · hold the button to wind up, let go to kick', vsCpu: 'against the computer', youWin: 'You win!', cpuWins: 'The computer wins', clickAgain: 'click to play again',
       turnOf: n => `${n}'s turn`, solids: 'solids', stripes: 'stripes', openTable: 'Open the table', openGame: n => `Open the table (with ${n})`,
       joinPool: n => `Play pool with ${n}`, newPool: 'Play pool with a friend, in turns', poolFriends: 'Link with a friend to play pool together',
       poolShot: 'takes a shot', poolOpens: 'sets up the pool table', poolJoins: 'joins the pool table', hint_game: 'play at this table',
       run: 'Run', lendFull: 'Full help: a lent agent works for real in its own folder (commands, a venv, tests)',
       lendSafe: 'Cautious help: a lent agent only talks and writes drafts', lendSwitch: 'change', roomChatOn: 'Friends read the room chat and write to everyone in it', roomChatOff: 'The room chat stays yours (friends only see the common room)',
       chosenWait: 'chosen: waiting for the other', pick: {sasso: 'rock', carta: 'paper', forbici: 'scissors'}, oldServer: 'This viewer server started before the update: restart it (and your friend restarts theirs) to see each other move.', friendDoor: 'Your friend opens this door when you are their guest',
       helpTitle: 'Ask for help', askPlaceholder: 'What do you need? (some research, a plan, a change to your files)', askGo: 'Ask',
       visit: h => `Visit ${h}'s office`, requestsTitle: 'Help requests', lend: 'Lend an agent', decline: 'Decline',
       lent: h => `${h} is on it`, declined: 'declined', pending: 'waiting for an answer', visiting: h => `Visiting ${h}'s office`, back: 'Back to my office',
       hint_stand: 'stand up', hint_sit: 'sit down', hint_coffee: 'make a coffee', hintTalk: n => `talk to ${n}`, hint_tv: 'watch the TV', hint_zap: 'remote: channels and YouTube (T anywhere near the TV)', tvFull: 'Full screen', tvAudio: 'Sound on or off', tvStart: 'From the start', tvPlay: 'Play or pause', bTodo: 'To do', bDoing: 'Doing', bDone: 'Done', bNone: 'none yet', mixTitle: 'Volumes', mixAll: 'All', lofiOn: 'lofi on', lofiOff: 'lofi off', hint_lofi: 'music on or off', tvOff: 'Turn the TV on or off', tvIsOff: 'your TV is off: turn it on from the remote', tvFlat: "Placed sound not available (is yt-dlp installed and up to date? python -m pip install -U yt-dlp): YouTube's own sound for now",
       tvFlatWhy: why => `Placed sound not available (${why}): YouTube's own sound for now`,
       tvRefused: (why, title, next) => `YouTube will not play ${title ? '"' + title + '" ' : 'this video '}here (${why})${next ? ': next, "' + next + '"' : ''}`,
       tvWhy: code => code === 100 ? 'removed or private' : code === 101 || code === 150 ? 'its author forbids other pages, or an age limit' : 'player error ' + code,
       tvDirect: title => `The player refuses ${title ? '"' + title + '"' : 'this video'}: playing its stream instead (picture from the viewer, sound beside it)`, radio: 'Radio', radioNext: 'Next song', radioSearchPh: 'A song, an artist, a genre...', radioHint: 'Pick a genre or search for music', radioNeeds: 'The radio needs yt-dlp, up to date: python -m pip install -U yt-dlp', hint_radio: 'radio: music', tvTitle: 'TV', tvTogether: 'Watch together', tvChannels: 'Channels', tvYoutube: 'YouTube',
       tvLocal: n => `your videos · ${n}`, tvNoChannels: 'No channels yet: put videos in ~/.claude/chatroom/tv/<channel>/', tvNothing: 'Nothing found.',
       tvSearchHint: 'Search any video on YouTube: it plays in high quality on the TV.', tvSearchPh: 'Search YouTube…', tvSearch: 'Search',
       tvLooking: 'Looking…', tvPuts: 'puts on the TV', look: 'Look', lookSkin: 'Skin', lookHair: 'Hair', lookTop: 'Top', lookPants: 'Trousers', save: 'Save', close: 'Close',
       lookNames: {short: 'short', spiky: 'spiky', bob: 'bob', bun: 'bun', long: 'long', cap: 'cap', beanie: 'beanie', bald: 'bald', suit: 'suit', cardigan: 'cardigan', hoodie: 'hoodie', polo: 'polo'},
       hint_board: 'look at the whiteboard', hintStop: 'stop looking', go: 'Walk over', edit: 'Furnish', cmdTitle: 'quick commands for the room',
       hint_cmds: 'quick commands', cmdSent: c => `${c} sent to the room`,
       jump: 'In the chat', ctx: 'context', pulse: 'activity, last 5 min', tools: 'last tools', msgs: 'last messages',
       tl: 'timeline, last 30 min', tlHint: 'red: failed call · yellow: waiting for a permission · white: the % it stated · green: context',
       tlTip: s => `${s.calls} calls, ${s.errors} failed${s.running ? ', one running' : ''}: click for the chart`, lanes: ['read', 'edit', 'run', 'web', 'agents', 'chat', 'other'], now: 'now',
       mod: 'live (mod)', tail: 'from transcripts', nodata: 'chat only'},
  it: {code: 'scrive codice', read: 'legge', term: 'terminale', web: 'sul web', post: 'scrive in chat', chat: 'legge la chat',
       agent: 'delega', msg: 'messaggio', other: 'lavora', think: 'pensa', idle: 'idle', coffee: 'pausa caffè',
       wait: 'TI ASPETTA', tagged: '@ per te', late: 'status in ritardo', you: 'tu', lead: 'assistente', waiting: n => `${n} ti aspettano`,
       working: n => `${n} lavorano`, idles: n => `${n} idle`, done: 'CHIUSO', plan: v => `piano v${v}`, votes: (y, n) => `${y} sì / ${n} da votare`,
       split: 'Diviso', office: 'Ufficio', chat: 'Chat', reset: 'Vista', follow: 'Segui', quality: q => `Qualità: ${q}`,
       notify: 'Avvisi', help: 'trascina: ruota · rotella: zoom · clic su qualcuno: dettagli · clic sul pavimento, su una sedia o sulla macchinetta: ci vai · ←→: agente dopo · F: segui · Esc', tag: '@ Tagga',
       povHelp: 'WASD: cammina (A/D di lato) · mouse: guarda (clic per catturarlo, Esc lo libera) · Maiusc: corri · Spazio: salta o sali sulla scrivania · E: quello che dice il suggerimento · Q: saluta · Esc',
       sensName: i => 'Mouse: ' + ['lento', 'medio', 'veloce', 'rapidissimo'][i || 0],
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
       quitGame: 'Abbandona', quits: 'abbandona la partita', quitBy: n => `${n} ha abbandonato`, oneGame: 'Prima finisci o abbandona la tua partita', more: 'Altro', gamesTitle: 'Giochi', toolsTitle: 'Strumenti', pingPong: 'Ping pong', helpBtn: 'Aiuto',
       poolWaiting: n => `Aspetto ${n}...`, poolWaitAny: 'un amico', poolCancel: 'Annulla', pingpong: 'Ping pong', foos: 'Biliardino', theyWin: n => `Vince ${n}`, newMatch: 'Gioca con un amico, in diretta', joinMatch: n => `Gioca con ${n}`,
       matchFriends: 'Collegati a un amico per giocare insieme', liveMatch: 'partita in diretta', poolFouls: 'falli: -1 punto ciascuno', cue_classic: 'Classica', cue_power: 'Potente', cue_precise: 'Precisa', cue_spin: 'Effetto', cue_classic_tip: 'La stecca di sempre', cue_power_tip: '+40% di forza, ma la mira trema ', cue_precise_tip: '-20% di forza, linea di mira lunga con il rimbalzo', cue_spin_tip: 'La bianca curva (premi di nuovo 4 per girare dall altra parte)', goal: 'GOL!', points: 'punti', poolQuit: 'Abbandona', poolRestart: 'Nuova partita', poolYourTurn: 'Tocca a te: mira col mouse, tieni premuto per caricare, rilascia per tirare', poolTheirTurn: n => `Tira ${n}...`, poolLate: "Il tavolo non e' ancora pronto: riprova tra poco", poolStarts: "L'amico e' entrato: si gioca!",
       askFriend: 'Chiedi aiuto a un amico', autoLend: 'Presta da solo', autoOn: 'ACCESO', autoOff: 'spento',
       pool: 'Biliardo', foosball: 'Biliardino', scores: 'Classifica', hint_scores: 'apri la classifica', hint_arcade: 'gioca al videogioco', hint_github: 'apri la finestra GitHub', arcadeInvite: (n, g) => `🕹 ${n} ti invita a giocare a ${g}: apri il videogioco`, noScores: 'nessuna partita ancora', colWins: 'V', colLoss: 'S', colPts: 'punti', colBest: 'record', colRuns: 'partite',
       foosHint: 'Mouse: sposta la barra (la sua posizione sceglie la barra, o tasti 1-4) · tieni premuto per caricare, rilascia per calciare', vsCpu: 'contro il computer', youWin: 'Hai vinto!', cpuWins: 'Vince il computer', clickAgain: 'clicca per rigiocare',
       turnOf: n => `tocca a ${n}`, solids: 'piene', stripes: 'mezze', openTable: 'Apri tavolo', openGame: n => `Apri il tavolo (con ${n})`,
       joinPool: n => `Gioca a biliardo con ${n}`, newPool: 'Gioca a biliardo con un amico, a turni', poolFriends: 'Collegati a un amico per giocare a biliardo insieme',
       poolShot: 'tira', poolOpens: 'prepara il tavolo da biliardo', poolJoins: 'entra al tavolo da biliardo', hint_game: 'gioca a questo tavolo',
       run: 'Corri', lendFull: "Aiuto completo: l'agente prestato lavora davvero nella sua cartella (comandi, venv, test)",
       lendSafe: "Aiuto prudente: l'agente prestato parla e scrive solo bozze", lendSwitch: 'cambia', roomChatOn: 'Gli amici leggono la chat della stanza e scrivono a tutti', roomChatOff: 'La chat della stanza resta tua (gli amici vedono solo la sala comune)',
       chosenWait: 'scelto: aspetta l\'altro', pick: {sasso: 'sasso', carta: 'carta', forbici: 'forbici'}, oldServer: 'Il server del viewer e\' partito prima dell\'aggiornamento: riavvialo (e il tuo amico il suo) per vedervi muovere.', friendDoor: 'Questa porta si apre quando sei tu l\'ospite del tuo amico',
       helpTitle: 'Chiedi aiuto', askPlaceholder: 'Cosa ti serve? (una ricerca, un piano, una modifica ai tuoi file)', askGo: 'Chiedi',
       visit: h => `Visita l'ufficio di ${h}`, requestsTitle: 'Richieste di aiuto', lend: 'Presta un agente', decline: 'Rifiuta',
       lent: h => `${h} è al lavoro`, declined: 'rifiutata', pending: 'in attesa di risposta', visiting: h => `Sei in visita da ${h}`, back: 'Torna nel tuo ufficio',
       hint_stand: 'alzati', hint_sit: 'siediti', hint_coffee: 'fatti un caffè', hintTalk: n => `parla con ${n}`, hint_tv: 'guarda la TV', hint_zap: 'telecomando: canali e YouTube (T ovunque vicino alla TV)', tvFull: 'Schermo intero', tvAudio: 'Audio sì o no', tvStart: 'Da capo', tvPlay: 'Play o pausa', bTodo: 'Da fare', bDoing: 'In corso', bDone: 'Fatto', bNone: 'nessuno ancora', mixTitle: 'Volumi', mixAll: 'Generale', lofiOn: 'lofi accesa', lofiOff: 'lofi spenta', hint_lofi: 'musica sì o no', tvOff: 'Accendi o spegni la TV', tvIsOff: 'la tua TV è spenta: accendila dal telecomando', tvFlat: "Audio spaziale non disponibile (yt-dlp è installato e aggiornato? python -m pip install -U yt-dlp): per ora audio di YouTube",
       tvFlatWhy: why => `Audio spaziale non disponibile (${why}): per ora audio di YouTube`,
       tvRefused: (why, title, next) => `YouTube non fa vedere ${title ? '«' + title + '» ' : 'questo video '}qui (${why})${next ? ': passo a «' + next + '»' : ''}`,
       tvWhy: code => code === 100 ? 'rimosso o privato' : code === 101 || code === 150 ? "l'autore vieta le altre pagine, o limite di età" : 'errore del lettore ' + code,
       tvDirect: title => `Il lettore rifiuta ${title ? '«' + title + '»' : 'questo video'}: lo riproduco dal flusso diretto (immagine dal viewer, audio a parte)`, radio: 'Radio', radioNext: 'Canzone dopo', radioSearchPh: 'Una canzone, un artista, un genere...', radioHint: 'Scegli un genere o cerca la musica', radioNeeds: 'La radio vuole yt-dlp aggiornato: python -m pip install -U yt-dlp', hint_radio: 'radio: musica', tvTitle: 'TV', tvTogether: 'Guarda insieme', tvChannels: 'Canali', tvYoutube: 'YouTube',
       tvLocal: n => `video tuoi · ${n}`, tvNoChannels: 'Ancora nessun canale: metti dei video in ~/.claude/chatroom/tv/<canale>/', tvNothing: 'Nessun risultato.',
       tvSearchHint: 'Cerca qualsiasi video su YouTube: parte in alta qualità sulla TV.', tvSearchPh: 'Cerca su YouTube…', tvSearch: 'Cerca',
       tvLooking: 'Cerco…', tvPuts: 'mette in TV', look: 'Aspetto', lookSkin: 'Pelle', lookHair: 'Capelli', lookTop: 'Maglia', lookPants: 'Pantaloni', save: 'Salva', close: 'Chiudi',
       lookNames: {short: 'corti', spiky: 'a punta', bob: 'caschetto', bun: 'chignon', long: 'lunghi', cap: 'cappellino', beanie: 'berretto', bald: 'calvo', suit: 'giacca', cardigan: 'cardigan', hoodie: 'felpa', polo: 'polo'},
       hint_board: 'guarda la lavagna', hintStop: 'smetti di guardare', go: 'Vai da lui', edit: 'Arreda', cmdTitle: 'comandi rapidi per la stanza',
       hint_cmds: 'comandi rapidi', cmdSent: c => `${c} mandato alla stanza`,
       jump: 'Nella chat', ctx: 'contesto', pulse: 'attività, ultimi 5 min', tools: 'ultimi strumenti', msgs: 'ultimi messaggi',
       tl: 'linea del tempo, ultimi 30 min', tlHint: 'rosso: chiamata fallita · giallo: attesa di un permesso · bianco: la % dichiarata · verde: contesto',
       tlTip: s => `${s.calls} chiamate, ${s.errors} fallite${s.running ? ', una in corso' : ''}: clic per il grafico`, lanes: ['legge', 'scrive', 'esegue', 'web', 'agenti', 'chat', 'altro'], now: 'adesso',
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
    if (g.op === 'new') {
      if (x) continue;
      // a game of mine that nobody joined, or where nobody has played a move yet, gives way to the new one (it would block every new game for ever)
      const untouched = y => y.type === 'pool' ? !y.shots.length : y.type === 'tris' ? y.board.every(c => !c) : !Object.keys(y.commits).length;
      for (const y of games.values()) if (!y.done && y.players.includes(who) && (y.players.length === 1 || untouched(y))) y.done = {quit: who, winner: null};
      if (busy(who)) continue;
      // someone else of the same kind is already waiting alone: both clicked "play with a friend" together, so this is the answer
      const waiting = [...games.values()].find(y => !y.done && y.type === g.type && y.players.length === 1 && y.players[0] !== who && (g.type !== 'nes' || y.rom === g.rom));
      if (waiting) { waiting.players.push(who); waiting.n = m.n; continue; }
      games.set(g.id, {id: g.id, type: g.type, players: [who], n: m.n, board: Array(9).fill(''), turn: 0, commits: {}, reveals: {}, ...(g.type === 'nes' ? {rom: g.rom, sha: g.sha} : {}),
                       ...(g.type === 'pool' ? {balls: poolRack(), groups: [null, null], shots: []} : {})});
      continue;
    }
    if (!x || x.done) continue;
    x.n = m.n;
    if (g.op === 'join') { if (x.players.length === 1 && x.players[0] !== who && !busy(who)) x.players.push(who); continue; }
    if (g.op === 'quit') { if (x.players.includes(who)) x.done = {quit: who, winner: x.players.find(p => p !== who) || null}; continue; }
    if (x.players.length < 2 || !x.players.includes(who)) continue;
    if (x.type === 'pool' && g.op === 'shot' && who === x.players[x.turn] && Array.isArray(g.end) && (g.turn === 0 || g.turn === 1)) {
      x.balls = g.end; x.groups = g.groups; x.turn = g.turn; x.shots.push({...g, n: m.n, by: who});      // the shooter's result is the truth
      if (g.win === 0 || g.win === 1) x.done = {winner: x.players[g.win]};
    }
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

export function createUI(root, {onMode, onPov, onRun, onSound, onLook, onReset, onFollow, onQuality, onSelect, onTag, onJump, onNext, onCommonOpen, onCommon, onGo, onEdit,
                                onShare, onJoin, onCommonWrite, onAsk, onVisit, onCommonDoc, onGame, onOpenPool, onOpenGame, onAnswer, onExtra, onSens}) {
  let lastCommon = null;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  root.insertAdjacentHTML('beforeend', `<div class="o-tags"></div>
    <div class="o-hud"><span class="o-chip o-big" data-k="title"></span><span class="o-chip" data-k="pct"></span><span class="o-chip o-warn" data-k="wait" hidden></span>
      <span class="o-chip" data-k="work"></span><span class="o-chip" data-k="idle"></span><span class="o-chip" data-k="plan" hidden></span><span class="o-chip" data-k="src"></span>
</div>
    <div class="o-btns"><div class="o-grp o-seg"><button data-b="split"></button><button data-b="office"></button><button data-b="chat"></button></div>
      <div class="o-grp"><button data-b="edit"></button><button data-b="common"></button></div>
      <div class="o-grp"><button data-b="pov"></button><button data-b="run"></button><button data-b="sound"></button></div>
      <div class="o-more"><div class="o-grp"><button data-b="more"></button></div><div class="o-menu"><h5 data-k="games"></h5><div data-k="games-list"></div>
        <h5 data-k="tools"></h5><button data-b="look"></button><button data-b="follow"></button><button data-b="reset"></button><button data-b="quality"></button><button data-b="sens"></button>
        <button data-b="notify"></button><button data-b="help"></button></div></div></div>
    <div class="o-inspector" tabindex="-1"></div><div class="o-common"></div><div class="o-lb"></div><div class="o-room"></div><div class="o-place"></div><div class="o-hint"></div><div class="o-palette" role="listbox"></div><div class="o-help"></div>`);
  const tags = root.querySelector('.o-tags'), hud = root.querySelector('.o-hud'), insp = root.querySelector('.o-inspector'), btns = root.querySelector('.o-btns');
  const cp = root.querySelector('.o-common'), lbEl = root.querySelector('.o-lb');
  // the leaderboards: a tab for each game, the first ten with the crown for the first, your own row marked; kept up to date from the common room's state
  const SCORE_TABS = [['pool', '🎱'], ['pingpong', '🏓'], ['foos', '⚽'], ['tris', '⭕'], ['morra', '✊'], ['zombie', '🧟'], ['paintball', '🔫']];
  let lbTab = 'pool';
  function renderScores() {
    const L = t(), data = (lastCommon && lastCommon.scores) || {}, me = lastCommon && lastCommon.me;
    const name = k => ({pool: L.pool, pingpong: L.pingpong, foos: L.foosball, tris: L.tris, morra: L.morra, zombie: 'Zombie', paintball: 'Paintball'}[k] || k.replace(/^arc-/, '').replace(/-/g, ' '));
    const tabs = [...SCORE_TABS, ...Object.keys(data).filter(k => k.startsWith('arc-')).map(k => [k, '🕹'])];
    if (!tabs.some(([k]) => k === lbTab)) lbTab = tabs[0][0];
    const book = data[lbTab], rows = book ? book.rows : [], wins = !book || book.mode === 'wins', mine = rows.findIndex(r => r.name === me);
    const row = (r, i) => `<tr class="${r.name === me ? 'o-me' : ''}${i === 0 ? ' o-first' : ''}"><td>${i === 0 ? '👑' : i + 1}</td><td>${esc(r.name)}</td>`
      + (wins ? `<td>${r.w}</td><td>${r.l}</td><td>${r.pts}</td>` : `<td>${r.best}${r.extra ? ' · ' + r.extra : ''}</td><td>${r.n}</td>`) + '</tr>';
    const head = wins ? `<th></th><th></th><th>${esc(L.colWins)}</th><th>${esc(L.colLoss)}</th><th>${esc(L.colPts)}</th>` : `<th></th><th></th><th>${esc(L.colBest)}</th><th>${esc(L.colRuns)}</th>`;
    const html = `<h3>🏆 ${esc(L.scores)} <button data-lb-close>✕</button></h3><div class="o-lbtabs">`
      + tabs.map(([k, ic]) => `<button data-lb="${esc(k)}" class="${k === lbTab ? 'o-on' : ''}">${ic} ${esc(name(k))}</button>`).join('') + '</div>'
      + (rows.length ? `<table><tr>${head}</tr>${rows.slice(0, 10).map(row).join('')}${mine >= 10 ? `<tr class="o-lbgap"><td colspan="5">…</td></tr>${row(rows[mine], mine)}` : ''}</table>` : `<div class="o-meta">${esc(L.noScores)}</div>`);
    if (lbEl.dataset.html !== html) { lbEl.innerHTML = html; lbEl.dataset.html = html; }
  }
  lbEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lb) { lbTab = b.dataset.lb; renderScores(); } else if ('lbClose' in b.dataset) lbEl.classList.remove('o-open');
  });
  lbEl.addEventListener('pointerdown', e => e.stopPropagation()); lbEl.addEventListener('wheel', e => e.stopPropagation());
  addEventListener('keydown', e => { if (e.key === 'Escape' && lbEl.classList.contains('o-open')) { lbEl.classList.remove('o-open'); e.stopImmediatePropagation(); } }, true);
  const openScores = tab => { if (tab) lbTab = tab; lbEl.classList.toggle('o-open', tab ? true : !lbEl.classList.contains('o-open')); if (lbEl.classList.contains('o-open')) { lbEl.dataset.html = ''; renderScores(); } };
  const chip = k => hud.querySelector(`[data-k="${k}"]`), btn = b => btns.querySelector(`[data-b="${b}"]`);
  let lang = 'it';
  const t = () => L[lang] || L.en;
  btns.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x === 'scores') { closeMenu(); return openScores(); }
    if (b.dataset.x) { closeMenu(); const f = extras.get(b.dataset.x)?.fn; return f ? f() : onExtra?.(b.dataset.x); }
    const k = b.dataset.b;
    if (k === 'more') return menuEl.classList.toggle('o-open');
    if (k === 'sens') return onSens();
    if (b.closest('.o-menu')) closeMenu();
    if (['split', 'office', 'chat'].includes(k)) onMode(k);
    else if (k === 'edit') onEdit(); else if (k === 'common') onCommonOpen(); else if (k === 'pov') onPov(); else if (k === 'sound') onSound?.(); else if (k === 'run') onRun(); else if (k === 'look') onLook(); else if (k === 'reset') onReset(); else if (k === 'follow') onFollow(); else if (k === 'quality') onQuality();
    else if (k === 'notify') askNotify();
    else if (k === 'help') showHelp(10000);
  });
  /** a bar button: an icon and a label (the label folds away on a narrow office), a tip, and whether it is switched on; touches the DOM only when it changed */
  const setBtn = (k, icon, text, tip = '', on = null) => {
    const b = btn(k), key = `${icon}|${text}|${tip}|${on}`;
    if (b._key === key) return;
    b._key = key;
    b.innerHTML = `<span class="o-ic">${icon}</span><span class="o-lbl">${esc(text)}</span>`;
    b.title = tip || text; b.setAttribute('aria-label', text);
    b.classList.toggle('o-on', !!on);
    if (on !== null) b.setAttribute('aria-pressed', String(!!on)); else b.removeAttribute('aria-pressed');
  };
  // the help line: shown for a few seconds at the start, gone at the first click in the office, back with the Help button; never a fixture over the panels
  const helpEl = root.querySelector('.o-help'); let helpTimer = 0;
  const showHelp = ms => { helpEl.classList.add('o-show'); clearTimeout(helpTimer); helpTimer = setTimeout(() => helpEl.classList.remove('o-show'), ms); };
  root.addEventListener('pointerdown', e => { if (!e.target.closest('.o-btns')) { clearTimeout(helpTimer); helpEl.classList.remove('o-show'); } }, true);
  setTimeout(() => showHelp(14000), 1500);
  // "More": the games and the less used tools in one drop-down; a game or mode that arrives later adds itself with addExtra
  const menuEl = btns.querySelector('.o-menu'), extras = new Map();
  const closeMenu = () => menuEl.classList.remove('o-open');
  root.addEventListener('pointerdown', e => { if (!e.target.closest('.o-more')) closeMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  const labels = new Map(), itemLabels = new Map(), tlData = new Map();
  /** the strip over the head of an agent: its calls of the last ten minutes (office-timeline.js), only when there is something to show */
  function drawTl(name) {
    const l = labels.get(name), a = tlData.get(name);
    if (!l || !a) return;
    const key = JSON.stringify(a);
    if (key === l.tlKey) return;
    l.tlKey = key;
    const s = summary(a), live = s.calls || s.running || s.waits;
    l.tl.style.display = live ? '' : 'none';
    if (!live) return;
    const g = l.tl.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0); drawStrip(g, 140, 22, a, 600);
    l.tl.title = t().tlTip(s);
  }

  function label(name) {
    let l = labels.get(name);
    if (l) return l;
    const el = document.createElement('div'); el.className = 'o-tag';
    el.innerHTML = `<div class="o-bub"></div><div class="o-flags"></div><svg class="o-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#14151dd9" stroke="#ffffff22" stroke-width="5"/><circle class="o-arc" cx="18" cy="18" r="15" fill="none" stroke-width="5" stroke-dasharray="0 100" transform="rotate(-90 18 18)" pathLength="100"/><text x="18" y="22" text-anchor="middle" font-size="11" font-weight="700" fill="#fff"></text></svg><div class="o-line"></div><canvas class="o-tl" width="280" height="44" style="display:none"></canvas><div class="o-name" tabindex="0" role="button"></div>`;
    el.querySelector('.o-name').addEventListener('click', () => onSelect(name));
    el.querySelector('.o-tl').addEventListener('click', () => onSelect(name));
    el.querySelector('.o-name').addEventListener('keydown', e => { if (e.key === 'Enter') onSelect(name); });
    tags.appendChild(el);
    l = {el, bub: el.querySelector('.o-bub'), flags: el.querySelector('.o-flags'), ring: el.querySelector('.o-ring'), arc: el.querySelector('.o-arc'),
         pct: el.querySelector('text'), line: el.querySelector('.o-line'), name: el.querySelector('.o-name'), tl: el.querySelector('.o-tl'), key: '', tlKey: ''};
    labels.set(name, l);
    drawTl(name);
    return l;
  }

  return {
    /** a game or mode that adds itself to the "More" menu: key, icon, text, and what to do when chosen */
    addExtra(key, icon, text, fn) { extras.set(key, {icon, text, fn}); },
    setLang(x) { lang = x === 'en' ? 'en' : 'it'; },
    t,
    /** place a tag at screen x, y (CSS pixels); visible false hides it */
    place(name, x, y, visible, scale = 1) {
      const l = label(name);
      l.el.style.opacity = visible ? '1' : '0';
      l.el.style.left = x + 'px'; l.el.style.top = y + 'px';
      l.el.style.transform = `translate(-50%, -100%) scale(${scale})`;
    },
    /** the timeline of an agent (what /timeline.json says): the strip in its tag and, when it is selected, the chart of the inspector */
    timeline(name, a) { tlData.set(name, a); drawTl(name); },
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
      const L = t();
      for (const [k, icon] of [['split', '◫'], ['office', '🏢'], ['chat', '💬']]) setBtn(k, icon, L[k], '', d.mode === k);
      setBtn('edit', '🛠', L.edit, '', !!d.edit); setBtn('common', '🛋', L.common, '', cp.classList.contains('o-open')); setBtn('look', '👤', L.look);
      setBtn('pov', '👁', 'POV', '', !!d.pov); setBtn('run', '🏃', 'x2', L.run + ' (Shift)', !!d.run); setBtn('sound', d.mute ? '🔇' : '🔊', '', L.mixTitle);
      setBtn('follow', '🎯', L.follow, '', !!d.follow); setBtn('reset', '🎥', L.reset);
      setBtn('more', '⋯', L.more + ' ▾', '', menuEl.classList.contains('o-open'));
      const hk = k => menuEl.querySelector(`[data-k="${k}"]`); hk('games').textContent = L.gamesTitle; hk('tools').textContent = L.toolsTitle;
      const gl = hk('games-list'), items = [['pingPong', '🏓', L.pingPong], ['foosball', '⚽', L.foosball], ['poolTable', '🎱', L.pool], ['scores', '🏆', L.scores], ...[...extras].map(([k, v]) => [k, v.icon, v.text])];
      const gkey = items.map(i => i.join()).join('|');
      if (gl.dataset.key !== gkey) { gl.dataset.key = gkey; gl.innerHTML = items.map(([k, ic, tx]) => `<button data-x="${esc(k)}"><span class="o-ic">${ic}</span><span>${esc(tx)}</span></button>`).join(''); }
      setBtn('quality', '✨', L.quality(d.quality)); setBtn('sens', '🖱', L.sensName(d.sens)); setBtn('notify', '🔔', L.notify, '', notifyOn()); setBtn('help', '❓', L.helpBtn);
      const ht = d.pov ? t().povHelp : t().help; if (helpEl.textContent !== ht) helpEl.textContent = ht;
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
        ${d.tl ? `<div>${t().tl}</div><canvas class="o-chart" width="544" height="300"></canvas><div class="o-meta">${t().tlHint}</div>` : ''}
        ${(d.recent || []).length ? `<div>${t().tools}</div><div class="o-tools">${d.recent.slice(0, 10).map(r => `<div class="${r.ok ? '' : 'o-err'}"><span>${esc(r.emoji)}</span><span>${esc(r.tool)} ${esc(r.target || '')}</span><span>${r.ms < 1000 ? r.ms + ' ms' : Math.round(r.ms / 1000) + ' s'}</span></div>`).join('')}</div>` : ''}
        ${(d.msgs || []).length ? `<div style="margin-top:8px">${t().msgs}</div><div class="o-msgs">${d.msgs.map(m => `<div data-n="${m.n}">#${m.n} ${esc(m.text.slice(0, 140))}</div>`).join('')}</div>` : ''}
        <div class="o-row"><button data-x="tag">${t().tag}</button><button data-x="jump">${t().jump}</button>${d.you ? '' : `<button data-x="go">🚶 ${t().go}</button>`}</div>`;
      insp.querySelector('[data-x="tag"]').onclick = () => onTag(d.name);
      insp.querySelector('[data-x="jump"]').onclick = () => onJump(d.lastN);
      if (!d.you) insp.querySelector('[data-x="go"]').onclick = () => onGo(d.name);
      insp.querySelectorAll('.o-msgs [data-n]').forEach(el => el.onclick = () => onJump(+el.dataset.n));
      const cv = insp.querySelector('.o-chart');
      if (cv) { const g = cv.getContext('2d'); g.setTransform(2, 0, 0, 2, 0, 0); drawChart(g, 272, 150, d.tl, 1800, t().lanes, {now: t().now}); }
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
          <button data-g="pool">🎱 ${esc(L.pool)}</button><button data-g="pingpong">🏓 ${esc(L.pingpong)}</button><button data-g="foos">⚽ ${esc(L.foos)}</button><button data-g="dadi">🎲 ${esc(L.dice)}</button></div><div class="o-c-games"></div>
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
      cp.onchange = e => {                                                   // new defaults of the automatic lending, while it is on
        if (e.target.matches('[data-am], [data-ae], [data-amin]') && lastCommon?.lend_auto?.on) onShare('lend_auto', {on: true, model: cp.querySelector('[data-am]').value,
                                                                effort: cp.querySelector('[data-ae]').value, minutes: +cp.querySelector('[data-amin]').value});
      };
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
        else if (b.dataset.s === 'askguest') {
          const t = cp.querySelector('[data-agt]');
          if (t.value.trim()) { onShare('ask_guest', {name: cp.querySelector('[data-ag]').value, text: t.value.trim()}); t.value = ''; }
        }
        else if (b.dataset.s === 'lendin') { const c = b.closest('.o-req'); onAnswer(c.dataset.id, true, {model: c.querySelector('[data-m]').value,
                                              effort: c.querySelector('[data-e]').value, minutes: +c.querySelector('[data-min]').value}); }
        else if (b.dataset.s === 'declinein') onAnswer(b.closest('.o-req').dataset.id, false, {});
        else if (b.dataset.s === 'autotoggle') onShare('lend_auto', {on: b.dataset.on === '1', model: cp.querySelector('[data-am]').value,
                                                      effort: cp.querySelector('[data-ae]').value, minutes: +cp.querySelector('[data-amin]').value});
        else if (b.dataset.s === 'start') onShare('start', {via: cp.querySelector('[data-s="via"]').value});
        else if (b.dataset.s === 'lendmode') onShare('lend_mode', {mode: b.dataset.mode});
        else if (b.dataset.s === 'friendschat') onShare('friends_chat', {on: !!b.dataset.on});
        else if (b.dataset.s) onShare(b.dataset.s, {name: b.dataset.name});
        else if (b.dataset.copy) navigator.clipboard?.writeText(b.dataset.copy);
        else if (b.dataset.g) {                                                    // a new game, or a roll of the dice
          const me = lastCommon?.me || '?', id = randomHex(4);
          if (b.dataset.g === 'dadi') {
            const roll = [...crypto.getRandomValues(new Uint8Array(2))].map(v => 1 + v % 6);
            onGame({type: 'dadi', op: 'roll', id, roll}, `🎲 ${me} ${L.rolls}: ${roll.join(' + ')} = ${roll[0] + roll[1]}`);
          } else onGame({type: b.dataset.g, op: 'new', id}, `🎮 ${me} ${L.opens(L[b.dataset.g])} (#${id})`);
        }
        else if (b.dataset.gm === 'join') onGame({type: b.dataset.type, op: 'join', id: b.dataset.id}, `🎮 ${lastCommon?.me} ${L.joins} #${b.dataset.id}`);
        else if (b.dataset.gm === 'openpool') onOpenPool();
        else if (b.dataset.gm === 'opengame') onOpenGame(b.dataset.type);
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
      if (lbEl.classList.contains('o-open')) renderScores();
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
        if (sh.guests.length) html += `<div class="o-ask"><h4>🙋 ${esc(L.askFriend)}</h4><select data-ag>${sh.guests.map(g => `<option>${esc(g.name)}</option>`).join('')}</select>
            <input data-agt placeholder="${esc(L.askPlaceholder)}" maxlength="1500"><button data-s="askguest">${esc(L.askGo)}</button></div>`;
        html += (sh.asks || []).slice(-4).reverse().map(a => `<div class="o-meta">🙋 ${esc(a.to)}: ${esc(a.text.slice(0, 60))} · ${esc(a.status === 'approved' ? L.lent(a.helper) : a.status === 'declined' ? L.declined : L.pending)}</div>`).join('');
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
        if (sh.sharing) html += `<div class="o-meta">💬 ${esc(s.friends_chat ? L.roomChatOn : L.roomChatOff)} <button data-s="friendschat" data-on="${s.friends_chat ? '' : '1'}">${esc(L.lendSwitch)}</button></div>`;
        html += `<div class="o-meta">🤝 ${esc(full ? L.lendFull : L.lendSafe)} <button data-s="lendmode" data-mode="${full ? 'safe' : 'full'}">${esc(L.lendSwitch)}</button></div>`;
      }
      const au = s.lend_auto || {on: false, model: 'sonnet', effort: 'medium', minutes: 30}, opt = (list, v) => list.map(x => `<option${String(x) === String(v) ? ' selected' : ''}>${x}</option>`).join('');
      html += `<div class="o-meta o-auto">⚡ ${esc(L.autoLend)} <button data-s="autotoggle" data-on="${au.on ? 0 : 1}">${esc(au.on ? L.autoOn : L.autoOff)}</button>
        <select data-am>${opt(s.codex ? CODEX_MODELS : ['sonnet', 'haiku', 'opus'], au.model)}</select>
        <select data-ae>${opt(s.codex ? ['medium', 'low', 'high', 'xhigh'] : ['medium', 'low', 'high', 'xhigh', 'max'], au.effort)}</select>
        <select data-amin>${opt([15, 30, 60], au.minutes)}</select></div>`;
      if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
      const js = cp.querySelector('.o-c-jstat'), jhtml = br && br.joined
        ? `${esc(L.joinedAt(br.host || '?'))} <button data-j="leave">${esc(L.leave)}</button>${br.error ? '<br>' + esc(br.error) : ''}` : '';
      if (js.dataset.html !== jhtml) { js.innerHTML = jhtml; js.dataset.html = jhtml; }
      cp.querySelector('.o-c-join').style.display = (br && br.joined) || sh.sharing ? 'none' : '';
      const gb = cp.querySelector('.o-c-guest');
      gb.style.display = br && br.joined ? '' : 'none';
      if (br && br.joined) {
        gb.querySelector('.o-visitbtn').textContent = '🚶 ' + L.visit(br.host || '?');
        const gs = gb.querySelector('.o-c-gstat'), ghtml = (br.asks || []).map(a => a.status === 'pending'
          ? `<div class="o-req" data-id="${esc(a.id)}"><b>${esc(br.host || '?')}</b>: ${esc(a.text)}<div class="o-reqrow">
              <select data-m>${(s.codex ? CODEX_MODELS : ['sonnet', 'haiku', 'opus']).map(m => `<option>${m}</option>`).join('')}</select>
              <select data-e>${(s.codex ? ['medium', 'low', 'high', 'xhigh'] : ['medium', 'low', 'high', 'xhigh', 'max']).map(e => `<option>${e}</option>`).join('')}</select>
              <select data-min><option value="30">30 min</option><option value="15">15 min</option><option value="60">60 min</option></select></div>
              <button data-s="lendin" class="o-lend">🤝 ${esc(L.lend)}</button> <button data-s="declinein">${esc(L.decline)}</button></div>`
          : `<div class="o-meta">${esc(br.host || '?')}: ${esc(a.text.slice(0, 60))} · ${esc(a.status === 'approved' ? L.lent(a.helper) : L.declined)}</div>`).join('') + (br.requests || []).map(r => `<div>${esc(r.text.slice(0, 70))} · ${esc(r.status === 'approved' ? L.lent(r.helper) : r.status === 'declined' ? L.declined : L.pending)}</div>`).join('');
        if (gs.dataset.html !== ghtml) { gs.innerHTML = ghtml; gs.dataset.html = ghtml; }
      }
      // the games: the latest ones first, with what you can do now
      const {games, dice} = replayGames(s.games || []), me = s.me, gbox = cp.querySelector('.o-c-games');
      const busy = games.some(x => !x.done && x.players.includes(me));
      for (const b of cp.querySelectorAll('[data-g="tris"], [data-g="morra"], [data-g="pool"], [data-g="pingpong"], [data-g="foos"]')) { b.disabled = busy; b.title = busy ? L.oneGame : ''; }
      const ghtml = games.filter(x => x.type !== 'nes').slice(0, 4).map(x => {
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
        if (x.type === 'pingpong' || x.type === 'foos') {
          const open = !x.done && mine ? `<button data-gm="opengame" data-type="${x.type}">${x.players.length === 2 ? '▶' : '⏳'} ${esc(L.openTable)}</button> ` : '';
          return `<div class="o-game"><b>${x.type === 'foos' ? '⚽ ' + esc(L.foosball) : '🏓 Ping pong'}</b> <span class="o-meta">${vs}</span><div class="o-meta">${esc(status || (x.players.length === 2 ? L.liveMatch : ''))}</div>${open}${join}</div>`;
        }
        if (x.type === 'pool') {
          const myTurn = !x.done && x.players.length === 2 && x.players[x.turn] === me;
          const turn = !x.done && x.players.length === 2 ? (myTurn ? L.yourTurn : L.theirTurn(x.players[x.turn])) : '';
          const open = !x.done && mine ? `<button data-gm="openpool">${x.players.length === 2 ? '🎱' : '⏳'} ${esc(L.openTable)}</button> ` : '';
          return `<div class="o-game"><b>🎱 ${esc(L.pool)}</b> <span class="o-meta">${vs}</span><div class="o-meta">${esc(status || turn)}</div>${open}${join}</div>`;
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
    /** your figure's look: colours, hair, outfit; every change shows at once, Save keeps it (and friends see it) */
    lookPanel(look, opts, onChange) {
      let el = root.querySelector('.o-look');
      if (el) { el.remove(); return; }
      const L = t(), cur = {skin: opts.skins[0], hair: opts.hairs[0], style: 'short', outfit: 'suit', top: '#262a3a', pants: '#1f2230', glasses: false, headphones: false, ...(look || {})};
      el = document.createElement('div'); el.className = 'o-look o-common o-open';
      const sw = (k, list) => list.map(c => `<button data-k="${k}" data-v="${c}" class="o-sw${cur[k] === c ? ' o-on' : ''}" style="background:${c}"></button>`).join('');
      const sel = (k, list) => `<select data-k="${k}">${list.map(v => `<option value="${v}"${cur[k] === v ? ' selected' : ''}>${esc(L.lookNames[v] || v)}</option>`).join('')}</select>`;
      el.innerHTML = `<h3>👤 ${esc(L.look)}</h3>
        <div class="o-meta">${esc(L.lookSkin)}</div><div class="o-sws">${sw('skin', opts.skins)}</div>
        <div class="o-meta">${esc(L.lookHair)}</div><div class="o-sws">${sw('hair', opts.hairs)}</div>
        <div class="o-reqrow">${sel('style', opts.styles)} ${sel('outfit', opts.outfits)}</div>
        <div class="o-reqrow"><label>${esc(L.lookTop)} <input type="color" data-k="top" value="${cur.top}"></label>
          <label>${esc(L.lookPants)} <input type="color" data-k="pants" value="${cur.pants}"></label></div>
        <div class="o-reqrow"><label><input type="checkbox" data-k="glasses"${cur.glasses ? ' checked' : ''}> 👓</label>
          <label><input type="checkbox" data-k="headphones"${cur.headphones ? ' checked' : ''}> 🎧</label></div>
        <div class="o-reqrow"><button data-act="save">💾 ${esc(L.save)}</button> <button data-act="close">${esc(L.close)}</button></div>`;
      const changed = () => onChange({...cur}, false);
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.act === 'save') { onChange({...cur}, true); el.remove(); return; }
        if (b.dataset.act === 'close') { onChange(look, false); el.remove(); return; }
        if (b.dataset.k) { cur[b.dataset.k] = b.dataset.v; el.querySelectorAll(`[data-k="${b.dataset.k}"]`).forEach(x => x.classList.toggle('o-on', x === b)); changed(); }
      });
      el.addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return; cur[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; changed(); });
      el.addEventListener('pointerdown', e => e.stopPropagation());
      root.appendChild(el);
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
    /** the leaderboards: open (or close) them, on the tab of a game */
    scores: openScores,
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
