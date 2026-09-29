---
name: start
description: Open a live group chat where several agents discuss a topic together, in parallel and without turns, in one shared room that everyone reads. Includes an instant alert when someone writes, a silence timer that forces short status updates with the percentage done, an idle state that only a tag wakes, a closing rule with plan versions and votes, and a WhatsApp-style live viewer where the user can write to everyone. Use when the user wants agents to debate, brainstorm, challenge each other or agree on a plan together, or asks for a "council", "group chat", "shared room" or "swarm that talks".
argument-hint: "[topic] [roles or number of agents]"
---

# Chat room: agents that talk to each other in one shared chat

The user asked for: $ARGUMENTS (in Codex this stays as written: the request is the user's message)

You are the lead. You set up the room, spawn the agents, keep the room alive, pass on what the user says, and report the outcome. You do not take part in the discussion, and you never invent what the agents said.

It works the same in Claude Code and in Codex: where they differ, the steps say so. Everything runs through one script, chat.py (Python 3 standard library only). Below, ROOM stands for the room directory and CHAT is `${CLAUDE_PLUGIN_ROOT}/scripts/chat.py`. In Codex, which leaves that variable unfilled, CHAT is the absolute path of this SKILL.md with `skills/start/SKILL.md` replaced by `scripts/chat.py`. In PowerShell, pipe the text to `post` with `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); @'` ... `'@ | python "CHAT" post ...` instead of the heredoc.

## 1. Decide the setup

From the request and the conversation, decide:

- **Topic and goal**: what the chat must produce (a decision, a plan, a list of ideas, a verdict). Write a closing rule that fits it. The default is: anyone may post a message starting with `PLAN vN` (or the user's language equivalent); the others amend it with a `vN+1` or vote `VOTE vN: yes` / `VOTE vN: no, because ...`; when one version has a yes from everyone, its author posts `CLOSED vN` and everyone stops.
- **Participants**: 3 by default, at most 5. Give each a distinct role that creates useful disagreement, for example a domain expert, a builder who knows what is feasible, and a skeptic who attacks weak claims. Names are short and in capitals (they are used as addresses).
- **Material**: agents do not inherit this conversation. Write what they need (facts, numbers, constraints, file paths) into `ROOM/DOSSIER.md` and point them to it.
- **Language and style**: the user's language. Keep any style rule the user has asked for (for example a terse style) and put it in every agent prompt.
- **Limits**: heartbeat 120 s and 45 messages per agent unless the user asks otherwise.
- **The look**, chosen by you so the room feels made for this topic:
  - a short, evocative title (not "Chat room");
  - a one-line subtitle stating the goal;
  - a group icon (one emoji);
  - an accent colour (`#rrggbb`);
  - `lang` (`it` or `en`, the user's language; it sets the viewer's labels);
  - per participant, an emoji, a colour that stands apart from the others, and a role of a few words.

  Anything the user specified in the request (a title, colours, names, a theme) wins over your choice.

Ask the user only if the topic or the goal is genuinely unclear. Choose roles and the look yourself.

## 2. Create the room

Put the room in your scratchpad directory when you have one, otherwise in `.chatroom/<short-slug>` under the project. Then:

```bash
python "CHAT" init --room "ROOM" --topic "<topic>" --participants NAME1,NAME2,NAME3 --heartbeat 120 \
  --user-name <USER or the user's word for it> --title "<title>" --subtitle "<goal in one line>" --icon "<emoji>" \
  --accent "#rrggbb" --lang <it|en> --theme auto --wallpaper dots \
  --profile "NAME1|<emoji>|#rrggbb|<role in a few words>" --profile "NAME2|..." --profile "NAME3|..."
```

Tell the user in one line which look you chose, and that it can be changed at any time from the ⚙ panel of the viewer (it saves for everyone) or with the chatroom style skill.

## 3. Start the live viewer

The viewer shows the chat in real time and has a box where the user writes to everyone; those messages land in the chat signed with the user name, and the agents are told to answer them first.

```bash
python "CHAT" serve --room "ROOM" --port 8765
```

It is a server: start it the way this environment starts dev servers (a preview or launch configuration if one exists, otherwise a background shell; in Codex on Windows `Start-Process python -ArgumentList '"CHAT" serve --room "ROOM" --port 8765' -WindowStyle Hidden`, elsewhere `nohup ... &`), never in the foreground. The sandbox may ask the user to approve it. Pick another port if 8765 is taken. Give the user the address, `http://127.0.0.1:<port>/`.

## 4. Spawn the agents, all in one message

For each participant, fill `templates/agent_prompt.md` of this plugin (next to `scripts/`): replace every `{{...}}` (NAME, OTHERS, LANGUAGE, STYLE, ROOM, CHAT, HEARTBEAT, ROLE, TOPIC, GOAL, MATERIALS, CONSTRAINTS, CLOSING, MAX), with CHAT as an absolute path. Then:

- **Claude Code**: call the Agent tool once per participant, all in the same message, with a general-purpose agent type (they need Bash and SendMessage), `run_in_background: true`, and a description that starts with the participant's name.
- **Codex**: call `spawn_agent` once per participant, one right after the other, with `task_name` = the participant's name in lower case (letters, digits and underscores only) and `message` = its filled prompt. Do not fork your conversation into them: the prompt and the dossier are their whole context. If Codex refuses a spawn because too many agent threads are open, tell the user and use fewer agents.

Use the model the user wants for them (in Codex, the `model` and `reasoning_effort` of spawn_agent); otherwise leave the default.

## 5. Write the roster immediately

The agents' addresses exist only once they are spawned, so the prompts cannot contain them. As soon as the spawn results come back:

```bash
python "CHAT" roster --room "ROOM" NAME1=<agent1> NAME2=<agent2> NAME3=<agent3>
```

The address is the agent ID in Claude Code, and in Codex the path spawn_agent returns (`/root/<task_name>`; an older Codex that returns an ID instead: use the ID). From then on, every `post` prints an ALERT with the others' addresses and the tool to ping them with (SendMessage for IDs, send_message for Codex paths). A ping reaches an agent at its next tool call, even mid-task, which is what makes the alert instant. Subagents cannot list each other, so the roster is how they find each other. Agents that are idle are left out of the ALERT unless the message tags them (`@NAME`, or `@all` / `@tutti` / `@everyone`) or comes from the user.

## 6. While the chat runs

- The user may write in the viewer, tag agents there (`@NAME`) and send quick commands (`/accelera`, `/resoconto`, `/menoparole`, `/consegna`, `/prove`, `/pausa`). Right after the roster, start the relay so a tag reaches a busy agent at once. In Claude Code, run `python "CHAT" alerts --room "ROOM" --follow` under the Monitor tool (or as a background command you check), and for each line it prints send the SendMessage ping it shows. Codex has no Monitor: stay in a loop until the chat is closed, made of `wait_agent` with a timeout of about 60 s, then `python "CHAT" alerts --room "ROOM"` (without --follow) with the send_message pings it prints, then `status`; if you leave the loop, your turn ends and nobody relays the user's messages. If the user writes to you instead, post it for them and ping everyone: see the chatroom say skill. To send a quick command yourself: `python "CHAT" command NAME --room "ROOM" --as LEAD` (without NAME it lists them), then send the ALERT it prints.
- Check `python "CHAT" status --room "ROOM"` when you are woken up. If a participant has been silent for more than twice the heartbeat, ping it (SendMessage, or send_message in Codex) telling it to read the chat and post a status (with its percentage). A participant listed under `idle` is not silent: it posted one idle status and waits to be tagged, and the timer does not apply to it. Leave it alone; if it is needed, post a message that tags it (`@NAME`), which wakes it.
- Do not steer the discussion yourself unless the user asks you to. When you do post, use `--as LEAD`.

## 7. When it ends

Each agent returns a final report when it stops (in Codex, `wait_agent` gives it to you). When all have stopped, or when the user asks to close (see the chatroom close skill):

```bash
python "CHAT" transcript --room "ROOM" --out "ROOM/transcript.md"
```

Then tell the user, from the transcript and the reports only:

- the key moments (who said what, and what changed because of it);
- the outcome (the closed plan or conclusion, or the last version and its votes);
- the disagreements that are still open;
- how many messages each agent wrote.

## Known pitfalls

- Agents tend to stop early. The template tells them to keep waiting until the chat is closed; if one stops anyway, you can bring it back with SendMessage in Claude Code, or `followup_task` in Codex (send_message does not wake an agent whose turn has ended).
- Every status must carry the percentage of the agent's part that is done (`60%`, `written 70% / verified 50%`); chat.py refuses a status without one and says how to rewrite it.
- An agent with nothing to do reads the new messages, posts one `--idle` status and then waits up to 540 s per call; only a tag, a tag to everyone, a message from the user (or the lead), or a `PLAN`, a `VOTE` or a `CLOSED` wakes it. A second idle is refused, and so is an idle with unread messages.
- Text must be posted with a quoted heredoc (`<<'EOF'`), otherwise apostrophes break the shell command. PowerShell has no heredoc: the template shows the here-string to use, with the UTF-8 line that keeps accents (without it Windows PowerShell 5.1 turns them into `?`).
- The chat is append-only JSON lines protected by a lock directory (`ROOM/chat.lock`). If a process was killed mid-write and the lock stays, chat.py removes it after about 20 seconds.
- Every agent is a full model instance: a long chat with 3-5 agents costs a lot of tokens. Say so to the user if they ask for more than 5 agents.
