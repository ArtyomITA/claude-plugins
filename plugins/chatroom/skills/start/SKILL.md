---
name: start
description: Open a live group chat where several agents discuss a topic together, in parallel and without turns, in one shared room that everyone reads. Includes an instant alert when someone writes, a silence timer that forces short status updates, a closing rule with plan versions and votes, and a WhatsApp-style live viewer where the user can write to everyone. Use when the user wants agents to debate, brainstorm, challenge each other or agree on a plan together, or asks for a "council", "group chat", "shared room" or "swarm that talks".
argument-hint: "[topic] [roles or number of agents]"
---

# Chat room: agents that talk to each other in one shared chat

The user asked for: $ARGUMENTS

You are the lead. You set up the room, spawn the agents, keep the room alive, pass on what the user says, and report the outcome. You do not take part in the discussion, and you never invent what the agents said.

Everything runs through one script: `${CLAUDE_PLUGIN_ROOT}/scripts/chat.py` (Python 3 standard library only). Below, CHAT stands for that path and ROOM for the room directory.

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

Tell the user in one line which look you chose, and that it can be changed at any time from the ⚙ panel of the viewer (it saves for everyone) or with `/chatroom:style`.

## 3. Start the live viewer

The viewer shows the chat in real time and has a box where the user writes to everyone; those messages land in the chat signed with the user name, and the agents are told to answer them first.

```bash
python "CHAT" serve --room "ROOM" --port 8765
```

It is a server: start it the way this environment starts dev servers (a preview or launch configuration if one exists, otherwise a background shell), never in the foreground. Pick another port if 8765 is taken. Give the user the address, `http://127.0.0.1:<port>/`.

## 4. Spawn the agents, all in one message

For each participant, fill `${CLAUDE_PLUGIN_ROOT}/templates/agent_prompt.md`: replace every `{{...}}` (NAME, OTHERS, LANGUAGE, STYLE, ROOM, CHAT, HEARTBEAT, ROLE, TOPIC, GOAL, MATERIALS, CONSTRAINTS, CLOSING, MAX). Then call the Agent tool once per participant, all in the same message, with:

- a general-purpose agent type (they need Bash and SendMessage),
- `run_in_background: true`,
- a description that starts with the participant's name.

Use the model the user wants for them; otherwise leave the default.

## 5. Write the roster immediately

The agent IDs exist only once the agents are spawned, so the prompts cannot contain them. As soon as the spawn results come back:

```bash
python "CHAT" roster --room "ROOM" NAME1=<agentId1> NAME2=<agentId2> NAME3=<agentId3>
```

From then on, every `post` prints an ALERT with the others' IDs, and the author pings them with SendMessage. A SendMessage reaches an agent at its next tool call, even mid-task, which is what makes the alert instant. Subagents have no ListAgents, so the roster is how they find each other.

## 6. While the chat runs

- The user may write in the viewer. If the user writes to you instead, post it for them and ping everyone: see `/chatroom:say`.
- Check `python "CHAT" status --room "ROOM"` when you are woken up. If a participant has been silent for more than twice the heartbeat, send it a SendMessage telling it to read the chat and post a status.
- Do not steer the discussion yourself unless the user asks you to. When you do post, use `--as LEAD`.

## 7. When it ends

Each agent returns a final report when it stops. When all have stopped, or when the user asks to close (see `/chatroom:close`):

```bash
python "CHAT" transcript --room "ROOM" --out "ROOM/transcript.md"
```

Then tell the user, from the transcript and the reports only:

- the key moments (who said what, and what changed because of it);
- the outcome (the closed plan or conclusion, or the last version and its votes);
- the disagreements that are still open;
- how many messages each agent wrote.

## Known pitfalls

- Agents tend to stop early. The template tells them to keep waiting until the chat is closed; if one stops anyway, you can bring it back with SendMessage.
- Text must be posted with a quoted heredoc (`<<'EOF'`), otherwise apostrophes break the shell command.
- The chat is append-only JSON lines protected by a lock directory (`ROOM/chat.lock`). If a process was killed mid-write and the lock stays, chat.py removes it after about 20 seconds.
- Every agent is a full model instance: a long chat with 3-5 agents costs a lot of tokens. Say so to the user if they ask for more than 5 agents.
