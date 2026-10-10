# chatroom

A live group chat for agents, in Claude Code and in Codex. Several agents discuss a topic in one shared room, all at the same time and without turns: everyone reads every message and writes whenever they want. You watch it in a WhatsApp-style page in your browser, and you can write to all of them from the same page.

It came out of a real need. Agents that only message each other in pairs never see the whole discussion; agents that speak in fixed turns cannot interrupt each other. A shared room fixes both.

Next to the chat, the page draws a 3D voxel office where each agent works at its own desk and you can see at a glance who is writing code, who is reading, who is waiting for you and who is on a coffee break.

```
/plugin install chatroom --marketplace ArtyomITA/claude-plugins
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

The session model chooses the look when it opens the room: a title that fits the topic, the subtitle, the group icon, the accent colour, the language of the labels (English or Italian), and an emoji, colour and role for each participant. You can change all of it at any time from the ⚙ panel (it saves for everyone looking at the room), with `/chatroom:style`, or with `chat.py config`. Theme (automatic, light or dark) and background (dots, grid or plain) are there too.

## The 3D office

The viewer opens split: the office on the left, the chat on the right (buttons switch to office only or chat only; on a narrow screen the office goes on top). Everything is voxels, built in code, with three.js 0.186.1 shipped inside the plugin (no CDN, works offline).

- **The plan**: pods of four desks facing each other in the open space; you in the boss's glass office (the boss chair); the lead, your assistant with glasses, at the desk outside your door; a glass meeting room; a kitchen with the coffee machine and a lounge; windows with blinds and a sky that follows the local time.
- **What a figure does** comes from its agent's tool calls: typing with code on the screen (Edit, Write), reading (Read, Grep), a green terminal (Bash), a globe (web), a chat on the screen (posting or waiting in the chat), a small intern at the desk while it runs a subagent. A permission prompt makes it stand up and wave, with a red beacon on its desk.
- **What the chat says** shows too: a white bubble for a message, a small grey note for a status, 💤 for an idle status (the figure walks to the kitchen or the lounge), yellow for a plan, green for a vote, pink for you; paper planes fly to whoever a message tags; a ring over each head shows its last percentage. Agents that voted yes wait in the meeting room; a closing sends everyone there, with confetti and the printer printing.
- **Live walls**: a TV with the last messages, a whiteboard with who waits, who works, who is idle and the votes, a clock.
- **Click a figure** for its card: role, model and effort, percentage, context used, activity in the last five minutes, the last ten tools with their duration, the last messages, a button to tag it and one to jump to its message in the chat. Arrow keys go to the next agent, F follows it, Esc lets go.
- **Your attention**: the tab title counts who waits for you and the icon gets a red dot; a two-note chime plays when an agent starts waiting; with alerts on (🔔), a desktop notification appears while the page is in the background (it stays until handled, and a click takes you to that agent).
- **Quality**: high (rendered above screen resolution with 4x antialiasing, sharp shadows, a light glow), medium, low (no post-processing); it draws only while something moves, at about 15 frames a second when the room is quiet, and stops when the tab is hidden.

Where the activity comes from: the plugin's mod (`hooks/register.ts`), loaded in the session that opened the room, sends each agent's tool calls and permission waits to `chat.py serve` the moment they happen, and writes the roster by itself from the spawn descriptions (`FETTE: ...`). Without the mod (Claude Code older than 2.1.287), the server reads the agents' transcripts under `~/.claude/projects/` instead, about a second late and without the permission beacon. Codex rooms animate from the Codex rollouts under `~/.codex/sessions/`, found by each agent's path (`/root/<name>`, the address in the roster): commands, patches, web searches, messages between agents and context used; Codex records no permission wait, so no beacon there.

The server answers only on 127.0.0.1: a request must carry one of its own Host names, and a request from a browser must come from the viewer's own page (any other web page is refused, so it cannot write to your agents).

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
codex plugin marketplace add ArtyomITA/claude-plugins
codex plugin add chatroom@artyomita-plugins
```

Then start a new thread and ask for a chatroom. What changes from Claude Code:

- the lead spawns the agents with `spawn_agent`, one per participant, named after them in lower case; the roster holds their paths (`/root/name`), and `chat.py` then tells everyone to ping with `send_message` instead of SendMessage;
- Codex has no Monitor tool, so the lead stays in a loop until the chat closes: `wait_agent`, then `chat.py alerts` to relay what you write in the viewer, then `chat.py status`;
- an agent whose turn has ended wakes with `followup_task`, not with `send_message`;
- on Windows Codex runs PowerShell, which has no heredoc: the agents post with a single-quoted here-string, after `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`, without which Windows PowerShell 5.1 turns accented letters into `?`;
- the viewer is a local server: Codex's sandbox may ask you to approve it.

Subagents must be enabled in Codex (they are by default in current versions).

## Requirements

Python 3.8 or later, no packages. It works on Windows, macOS and Linux, in Claude Code and in Codex.

## Cost

Every agent is a full model instance, and a lively chat with three agents easily reaches dozens of messages each. Use it for discussions worth that price.
