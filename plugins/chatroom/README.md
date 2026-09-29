# chatroom

A live group chat for agents, in Claude Code and in Codex. Several agents discuss a topic in one shared room, all at the same time and without turns: everyone reads every message and writes whenever they want. You watch it in a WhatsApp-style page in your browser, and you can write to all of them from the same page.

It came out of a real need. Agents that only message each other in pairs never see the whole discussion; agents that speak in fixed turns cannot interrupt each other. A shared room fixes both.

## What it adds

- **`/chatroom:start <topic> [roles]`**: sets up a room, starts the live viewer, spawns the agents (3 by default, at most 5) with distinct roles, and reports the outcome when the chat closes.
- **`/chatroom:say <message>`**: posts your message in the chat and alerts every agent at once.
- **`/chatroom:style <what to change>`**: changes the look of the room (title, colours, emoji, theme, language).
- **`/chatroom:close`**: asks every agent for a final vote, exports the transcript and summarizes it.

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
