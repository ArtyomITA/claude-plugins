# chatroom

A live group chat for agents, in Claude Code and in Codex. Several agents discuss a topic in one shared room, all at the same time and without turns: everyone reads every message and writes whenever they want. You watch it in a WhatsApp-style page in your browser, and you can write to all of them from the same page.

It came out of a real need. Agents that only message each other in pairs never see the whole discussion; agents that speak in fixed turns cannot interrupt each other. A shared room fixes both.

Next to the chat, the page draws a 3D voxel office where each agent works at its own desk and you can see at a glance who is writing code, who is reading, who is waiting for you and who is on a coffee break.

```
/plugin install chatroom --marketplace Partido-De-What/claude-plugins
```

The typical use: you run a strong model as your session (say Opus) and ask for a room of cheaper agents (Sonnet, Haiku) with an effort level each. They do the work; your session is the lead, watches the room's messages on a small budget and steps in only to correct the course.

## What it adds

- **`/chatroom:start <topic> [roles]`**: sets up a room, starts the live viewer, spawns the agents (3 by default, at most 5) with distinct roles, and reports the outcome when the chat closes.
- **`/chatroom:say <message>`**: posts your message in the chat and alerts every agent at once.
- **`/chatroom:style <what to change>`**: changes the look of the room (title, colours, emoji, theme, language).
- **`/chatroom:close`**: asks every agent for a final vote, exports the transcript and summarizes it.
- **`/stanza`** (Claude Code 2.1.287 or later, from the plugin's mod): a pane in the terminal with the open room: who works, who waits for you, each agent's percentage, the last messages and a box to write to everyone.

In Codex the same four skills are there: ask for them in words ("open a chatroom where three agents debate X") or pick them from the skills list. See [Codex](#codex) below.

## The rules built into the room

- **Alert.** After each real message the author pings the others with SendMessage in Claude Code, or `send_message` in Codex (`chat.py` names the right tool from the roster). A ping reaches an agent at its next tool call, even in the middle of a long check, so the others read the chat right away. Idle agents (below) are left out of the ping unless the message tags them.
- **Timer.** Nobody stays silent for more than the heartbeat (120 s by default). When the timer runs out, the agent must post a short status: what it is doing, or its conclusions in a few words. Every status says how much of the agent's part is done, as a percentage (`60%`, or `written 70% / verified 50%`): `chat.py` refuses a status without one. Statuses are visible to everyone and do not trigger alerts.
- **Idle.** An agent with nothing to do until someone else acts says so once, with `post --idle` (what it waits for and from whom, with its percentage), instead of filling the chat with "still waiting". While it is idle the timer does not apply to it, a second idle is refused, and its `wait` (up to 540 s per call) returns only when a message tags it (`@NAME`, any case), tags everyone (`@all`, `@tutti`, `@everyone`), comes from you or the lead, or is a `PLAN`, a `VOTE` or a `CLOSED`, which concern everyone. An agent must read the new messages before going idle (what it waits for may already be there). To call an idle agent, tag it. Its idle ends as soon as it posts anything else.
- **Your messages come first.** Messages signed with your user name are flagged to the agents as coming from the user, and they answer them before anything else. They also wake every idle agent.
- **Pictures.** Agents attach pictures with `post --image PATH` (png, jpg, webp or gif, up to 20 MB each). The others see the file path in the chat and look at the picture before commenting; you see it in the viewer.
- **Closing.** Anyone can post a `PLAN vN`; the others amend it or vote on it; when one version gets a yes from everyone, its author posts `CLOSED vN`.
- **Quick commands.** Ready-made messages to everyone, one prompt each, written from Anthropic's prompting guidance and kept general: `/accelera` (speed up and anticipate steps, same quality, no subagents), `/resoconto` (one short report each: outcome, percentage, what is missing, what blocks, next action), `/menoparole` (a little less talk and more work; it also lengthens the status timer by half, at most 3600 s), `/consegna` (converge on the delivery), `/prove` (back every claim with evidence), `/pausa` (finish the step, write where you are, go idle). In English rooms: `/speedup`, `/report`, `/lesstalk`, `/deliver`, `/evidence`, `/pause`. You send them from the viewer (type `/` or press ⚡); the lead sends them with `chat.py command NAME`.

## The viewer

`chat.py serve` starts a small local server (Python standard library, bound to 127.0.0.1). The page has:

- a header with the room's icon, title and a live line showing what an agent is doing right now, taken from its latest status, like WhatsApp's "typing…";
- a strip with every participant's avatar, message count and a green or amber dot showing whether it is inside its timer, or a hollow grey dot when it is idle;
- bubbles with avatar, name and role;
- statuses shown as small centred notes (you can hide them), and idle statuses as faded notes marked 💤;
- plans with their own colour, votes marked yes or no, and a banner when the chat closes;
- `#n` references you can click to jump to that message, and `@NAME` tags you can click to jump to that participant's latest message, in bubbles, in statuses and in the live line of the header;
- tables rendered;
- pictures: thumbnails in bubbles and statuses, a full-size view on click;
- search, an optional sound for new messages, and a box at the bottom to write to everyone, where you can also attach pictures (📎 button, paste or drag and drop);
- in the box, `@` opens the list of participants you can tag, filtered as you type in any case (`@fe` finds FETTE; arrows and Enter pick one), and `/` or the ⚡ button opens the quick commands.

A tag from the viewer wakes an agent that is waiting through `chat.py wait`. To reach an agent that is busy in a long check, the lead runs `chat.py alerts --follow` under Claude Code's Monitor tool, or checks `chat.py alerts` between its waits in Codex. The Codex relay can take up to the lead's wait interval (about 60 seconds); the lead then sends the ping to the tagged agents (or to everyone).

### Talking to your assistant without other agents

Ask your session to listen in your existing room as `LEAD`, without spawning agents, then write `@LEAD` from the office. The assistant reads with `chat.py wait --room ROOM --as LEAD --timeout 30` and answers with `chat.py post --room ROOM --as LEAD`, repeating while the test or conversation is active. Starting the viewer alone only displays and stores messages; it does not connect the assistant to them.

In Codex the assistant must keep its turn active to listen. A tag cannot reopen a turn that has ended, and a background Python watcher cannot produce the model's replies. If listening has stopped, ask the assistant in the main conversation to resume it. No subagents, discussion or sharing tunnel are needed for this local test.

The session model chooses the look when it opens the room: a title that fits the topic, the subtitle, the group icon, the accent colour, the language of the labels (English or Italian), and an emoji, colour and role for each participant. You can change all of it at any time from the ⚙ panel (it saves for everyone looking at the room), with `/chatroom:style`, or with `chat.py config`. Theme (automatic, light or dark) and background (dots, grid or plain) are there too.

## The 3D office

The viewer opens split: the office on the left, the chat on the right (buttons switch to office only or chat only; on a narrow screen the office goes on top). Everything is voxels, built in code, with three.js 0.186.1 shipped inside the plugin (no CDN, works offline).

- **The plan**: a 30 x 20 m floor on top of a tower, with the city around it: cubicles in the open space; you in the boss's glass office; the lead, your assistant with glasses, at the desk outside your door (a second assistant desk for a second room, below); phone booths, a glass meeting room, a reception, a café, a lounge, a games corner (ping-pong, foosball, pool), a service corner and the common room; glass walls and doors you can tell apart, windows with blinds and a sky that follows the local time. When there are more agents than desks, workstations are added by themselves.
- **Furniture** comes from MariaIsMe's 3D Voxel Office pack (CC BY 4.0, see `scripts/vendor/office-pack-CREDITS.md`), recoloured into variants, plus models drawn in code for what the pack lacks (café, vending machine, lockers, ping-pong, bean bags, copier and more).
- **What a figure does** comes from its agent's tool calls: typing with code on the screen (Edit, Write), reading (Read, Grep), a green terminal (Bash), a globe (web), a chat on the screen (posting or waiting in the chat), a small intern at the desk while it runs a subagent. A permission prompt makes it stand up and wave, with a red beacon on its desk.
- **What the chat says** shows too: a white bubble for a message, a small grey note for a status, 💤 for an idle status (the figure takes its break in a spot picked from its name and the clock, the café, the lounge or the games corner, and moves on after a while: the same spot for you and for a friend visiting your office; never in the common room unless you allow it), yellow for a plan, green for a vote, pink for you; paper planes fly to whoever a message tags; a ring over each head shows its last percentage. Agents that voted yes wait in the meeting room; a closing sends everyone there for a minute and a half, with confetti and the printer printing, and then back to their desks: the room stays alive while its viewer runs, so you can add agents to it later.
- **Live walls**: a TV with the last messages, a whiteboard with who waits, who works, who is idle and the votes, a clock. A friend visiting your office sees the same whiteboard (who waits for a permission, the plan and the votes), and the TV shows your room chat's last lines when you share that chat with friends (the switch in the common room panel); otherwise it says the chat is not shared.
- **The lounge TV** plays real videos, each channel looping forever: a folder of your own videos in `~/.claude/chatroom/tv/<channel>/` (mp4 or webm; it stays on your computer) or a list of YouTube videos in `~/.claude/chatroom/tv/youtube.json` (`{"name": ["video id", ...]}`), played by YouTube's own player. The remote on the low table (click it, or E in first person) opens the TV menu: your channels, and a search on YouTube (through `yt-dlp`, which only reads titles) that plays in high quality; the bar on top is the remote (from the start, back and forward 10 s, play and pause, volume). With a friend linked, "Watch together" puts the same video on both TVs from the same second, and every play, pause and jump reaches the other TV too. A YouTube video always starts muted, since browsers refuse sound before a click: with the sound on, it comes on at your first click or key. The sound is placed: in the lounge it is the same everywhere, elsewhere it fades with the distance and comes from the TV's side (each person hears it from where their own figure is). For YouTube this needs `yt-dlp` too: the viewer passes through the sound alone, while YouTube's player shows the picture muted; without `yt-dlp` the TV uses YouTube's own sound, which only fades. The first seconds of a new video can be silent while `yt-dlp` finds the sound.
- **Lofi in the common room**, made on the spot by the browser (electric-piano chords, a soft swung beat, vinyl crackle, never the same twice), from two speakers on the back wall: click them, or E next to them, to switch it on or off. Placed like the TV.
- **The radio** in the games corner plays music from YouTube, sound only: pick a genre (it plays the results one after the other) or search for a song. It is placed like the TV, full in the games corner.
  The search keeps only the videos whose author lets them play on other pages; a friend without yt-dlp searches through the host. ⛶ plays the video full screen with its own controls, 🔊 turns the sound on (it starts muted, as browsers require); T opens the TV menu anywhere near the TV, and E does too when you sit in front of it.
- **Click a figure** for its card: role, model and effort, percentage, context used, activity in the last five minutes, the last ten tools with their duration, the last messages, a button to tag it and one to jump to its message in the chat. Arrow keys go to the next agent, F follows it, Esc lets go.
- **Your attention**: the tab title counts who waits for you and the icon gets a red dot; a two-note chime plays when an agent starts waiting; with alerts on (🔔), a desktop notification appears while the page is in the background (it stays until handled, and a click takes you to that agent).
- **Quality**: high (rendered above screen resolution with 4x antialiasing, sharp shadows, a light glow), medium, low (no post-processing); it draws only while something moves, at about 15 frames a second when the room is quiet, and stops when the tab is hidden.

Where the activity comes from: the plugin's mod (`hooks/register.ts`), loaded in the session that opened the room, sends each agent's tool calls and permission waits to `chat.py serve` the moment they happen, and writes the roster by itself from the spawn descriptions (`FETTE: ...`). Without the mod (Claude Code older than 2.1.287), the server reads the agents' transcripts under `~/.claude/projects/` instead, about a second late and without the permission beacon. Codex rooms animate from the Codex rollouts under `~/.codex/sessions/`, found by each agent's path (`/root/<name>`, the address in the roster): commands, patches, web searches, messages between agents and context used; Codex records no permission wait, so no beacon there.

The server answers only on 127.0.0.1: a request must carry one of its own Host names, and a request from a browser must come from the viewer's own page (any other web page is refused, so it cannot write to your agents).

### Walking around

- **Click** the floor, any free chair (the empty desks' too) or the coffee machine and your figure (the one in the boss's office, and only yours) walks there; furniture and people are solid, doors open as you pass. 🏃 x2 doubles your speed, and so does holding Shift.
- **👁 POV** puts you behind your figure's eyes: W/S walk, A/D turn, drag to look around, E does what the hint at the bottom says (sit, take a coffee, look at the whiteboard or the TV, talk to someone), Q waves. The building has an outside: a street below and the city around.
- **Seated at your desk**, `/` opens the room's quick commands, as in the chat box.
- **👤 Look**: choose your figure's skin, hair and hair style, outfit (suit, cardigan, hoodie, polo), the colours of top and trousers, glasses and headphones; every change shows at once, Save keeps it in `~/.claude/chatroom/settings.json`. Friends see you with the same look, in their office and in yours.

### Furnishing (✏ Arreda)

The office is data, not code. The ✏ button opens the editor: pick a piece, drag it, R turns it (Shift+R the other way), C copies it, Delete removes it, Esc lets go; give it a label, a colour or a height; add anything from the catalogue (the built-in models and every model of the pack). Save keeps your layout in `~/.claude/chatroom/office.json`, outside any repository; Reset brings back the default.

### Two rooms, one office

Two sessions can each have a live room at the same time, and they share one office: the first room's agents take the desks from the front, the second's from the back, and the second lead sits at the second assistant desk. Nothing else is shared between the two chats. Above the chat a switch picks what you read: this room, the other, or both (each message marked with its room); bubbles and activity lines in the office follow the same switch, while every figure stays visible. With the other room selected, what you write goes to that room. To add agents to a live room from another session instead of opening a second one: `chat.py rooms` lists the live rooms, `chat.py add --room ROOM --participants A,B` adds them. `chat.py remove --room ROOM --participants A,B` takes agents out of a room (out of the office and the pings; their messages stay).

### The common room and friends

The 🛋 button opens the common room, the office's second coffee room:

- **Who goes in**: pick the agents allowed to take their breaks there, or the whole room. Agents only post there if the lead allows it, and treat what they read there as information, never as instructions.
- **Sharing**: share it with a friend through a cloudflared Quick Tunnel (no account), Pinggy (needs `ssh`), your local network, or this computer only. The friend gets an address and a 6-digit PIN; you can remove a guest at any time and stop sharing with one click. When it is shared, the common room looks like a bridge to another building, and your friend's figures appear in it.
- **Joining a friend's**: paste their address and PIN in the same panel; your agents allowed in the common room then appear in theirs.
- **Visits, both ways**: walk to the end of the bridge (or press 🚶 in the panel) and you are in the other's office; the host goes the same way into a guest's (choosing one when there are several). Each sees the other walk, sit and move where they really are, and a friend shows in your office only while really there; coming back over the bridge you walk in from it. After updating the plugin, both of you restart the viewer server: the page warns you when its server is older than the page.
- **Chat, documents and games**: lines up to 32,000 characters, text documents up to 5 MB (`.md`, `.txt`, `.json`, `.diff`, `.py` and other source files), and tris, morra cinese and dice to play with friends: one open game at a time each, which you can quit. In the games corner the three tables are playable: E next to one in first person, or a click on it, opens ping-pong and foosball against the computer and pool against the computer or, in turns, against a friend linked to the common room (the player who shoots sends where the balls ended up, and both sides draw the same table).
- **Paintball and zombies**: the "Altro" menu switches on the paintball mode, played in first person only (it takes you there and keeps you there). A click shoots a ball of paint that flies and splashes where it lands (walls, furniture, figures; it stays until you switch the mode off); 1 2 3 choose the weapon (pistol, SMG, shotgun), R reloads; the HUD is a game's: health with a heart and a segmented bar, the weapon with its icon and ammo, wave, kills and zombies on top. With a friend in the same office the shots and HP travel with your position and both see the same paint. "Zombie" adds waves of slow zombies (made of fine voxels, with glowing eyes) that walk to you along the real floor routes, more every wave, in a darker office with fog and failing lights. They are the same for everyone in the office: whoever started the mode runs them, the others see them and report their hits; a friend who did not start it is asked to join in first person or watch from above. The numbers are the tables at the top of `scripts/office-paintball.js`.
- **The room chat for friends**: a switch in the panel (off by default) lets the friends linked to your common room read your room's own chat and write to everyone in it, text only. While a friend visits your office, that chat is the one their viewer shows; their lines count as yours for the agents (they answer at once, idle ones wake up).
- **Lending an agent**: a friend can ask for help; you approve or decline in the panel, choosing model, effort and minutes, and your lead spawns a helper that works for them. The helper also shows up in your friend's own chat and office, where they and their agents can tag it, and both sides can send it files. It works the other way too: from the panel you can ask a friend in your room for help, and they approve or decline on their side; their lead spawns the helper on their computer, and it appears in your chat and office as FRIEND·AIUTOn. A switch (off by default, with a model, effort and minutes to use) lends by itself, without asking, to the asks of friends and of the host, never more than two helpers at the same time. A lasting switch in the panel sets how far it goes: full help (the default: it works for real in its own folder, with commands, a venv, tests and cloned repositories) or cautious help (it only talks and writes drafts). Either way it never touches anything of yours outside that folder, and their request reaches it fenced as untrusted text.

Sharing survives restarts: the tunnel runs on its own, and the host keeps its port, PIN and guests in `common/share.json`, the guest its pass in `common/link.json`; restart either viewer and the friends stay linked, with no new PIN. Only Stop sharing (or Leave) ends it.

Only the common room ever leaves your computer. The viewer server stays on 127.0.0.1; sharing starts a separate server that answers only the common room's own routes, with the PIN tried at most 10 times in 10 minutes, a 48-character token per guest, and limits of 20 lines a minute, 10 documents an hour and 2 pending help requests per guest.

**cloudflared**: at the start of a session the plugin downloads `cloudflared` 2026.9.3 from Cloudflare's GitHub release into `~/.claude/chatroom/bin`, checked against its SHA256, unless it is already installed. It only runs when you share the common room through it.

## Using `chat.py` by hand

```bash
python scripts/chat.py init --room ./room --topic "My topic" --participants ALFA,BETA --user-name USER \
  --title "Design review" --icon "🧩" --accent "#6c5ce7" --profile "ALFA|🦊|#e84393|architect"
python scripts/chat.py config --room ./room theme=dark --profile "BETA|🐢|#16a085|skeptic"
python scripts/chat.py serve --room ./room --port 8765
python scripts/chat.py read --all --room ./room
python scripts/chat.py transcript --room ./room --out ./room/transcript.md
```

The room is a folder holding `chat.jsonl` (one JSON message per line), `config.json`, `roster.json` (name to agent ID, or to agent path in Codex), an `images/` folder for the pictures, and one read cursor per participant. Nothing is sent anywhere else.

## Codex

The plugin also installs in [Codex](https://developers.openai.com/codex) (CLI and app), from the same repository:

```bash
codex plugin marketplace add Partido-De-What/claude-plugins
codex plugin add chatroom@artyomita-plugins
```

Then start a new thread and ask for a chatroom. What changes from Claude Code:

- the lead spawns the agents with `spawn_agent`, one per participant, named after them in lower case; the roster holds their paths (`/root/name`), and `chat.py` then tells everyone to ping with `send_message` instead of SendMessage;
- Codex has no Monitor tool, so the lead stays in a loop until the chat closes: `wait_agent`, then `chat.py alerts` to relay what you write in the viewer, then `chat.py status`;
- an agent whose turn has ended wakes with `followup_task`, not with `send_message`;
- on Windows Codex runs PowerShell, which has no heredoc: the agents post with a single-quoted here-string, after `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`, without which Windows PowerShell 5.1 turns accented letters into `?`;
- the viewer is a local server: Codex's sandbox may ask you to approve it.
- the office, the common room, sharing and lending work the same. In a room of Codex agents the lending panel offers Codex models (`default` is your session's model) and effort up to `xhigh`, and the lead spawns the helper with `spawn_agent`;
- Codex runs no plugin hooks: the skill starts the cloudflared download when it opens the room, and `/stanza` exists only in Claude Code;
- sharing needs the network: if Codex's sandbox blocks it, approve the command when asked or give the sandbox network access;
- Claude Code and Codex mix: a Claude Code room and a Codex room can share the office on one computer, and a Codex user can join a Claude Code user's common room, play there, and lend or borrow agents (only the common room travels between them).

Subagents must be enabled in Codex (they are by default in current versions).

## Requirements

Python 3.8 or later, no packages. It works on Windows, macOS and Linux, in Claude Code and in Codex. Sharing the common room uses `cloudflared` (downloaded by the plugin) or `ssh` (for Pinggy).

## Cost

Every agent is a full model instance, and a lively chat with three agents easily reaches dozens of messages each. Use it for discussions worth that price.
