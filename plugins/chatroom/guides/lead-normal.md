# Lead's guide: a normal room

You are the lead: the session the user talks to. You set the room up, spawn the agents, relay the user, review what the
room cannot decide alone, and report. You do not do the agents' work and you never invent what they said.

Your context is the expensive one (it holds the whole conversation with the user): keep the room's text out of it.
Never `read --all` a long room. Your inputs are the relay lines (ALERT, WATCH, CHECK, LEND), `status`, `board`, and
`read --range A-B` for the few messages a decision needs.

CHAT below is the plugin's `scripts/chat.py`, ROOM the room folder.

## 1. Before anything: does a team pay?

Several agents beat one only when the work splits into three or more pieces that do not wait on each other, and only
with a check at the end. A sequential task (each step needs the previous one) goes better with one agent, or one worker
and one reviewer: propose that. A team of 3 is the default, 5 at most; every agent is a full model instance.

## 2. Setup, in this order

1. Room: `python CHAT rooms` (reuse a live one if the user means it), else `init` (see the start skill), or the room
   `/chatroom:init` already made. In an existing room never run `init` again: `add`, `config`.
2. Topic and goal: `config --topic "..." --subtitle "<what the room must produce>"`.
3. Participants: `add --participants A,B,C --profile "A|emoji|#color|role|model|effort"`. Distinct roles that disagree
   usefully (an expert, a builder, a skeptic). Names in capitals.
4. Material the agents need (they do not inherit your conversation): write it to `ROOM/DOSSIER.md`.
5. Brief, once: `brief goal="..." style="..." materials="ROOM/DOSSIER.md" constraints="..." closing="..." max=45`.
6. Prompts, generated: `prompt NAME --out ROOM/prompts/NAME.md` for each. Pass each file's text unchanged to the Agent
   tool (or `spawn_agent` in Codex), all agents in one message. Never edit a generated prompt: change the brief or the
   config and generate again (identical prompts also keep the prompt cache warm).
7. Roster: with the chatroom mod it writes itself; otherwise `roster A=<id> B=<id>` as soon as the spawns return.
8. Relay: `alerts --follow --messages` under Monitor (longest timeout, re-armed when it ends) in Claude Code; in Codex a
   loop of `wait_agent` ~60 s + `alerts --messages`. Without the relay nobody delivers the user's messages.
9. Tasks with a real test: set them yourself, from the shell (below).

## 3. What chat.py enforces by itself

You do not police these; you act on what they report.

| Rule | What the agents see | Your part |
|---|---|---|
| Pings only who a message concerns: the tagged (`@NAME`, `--reply`); everyone for the user, you, `@all`/`@tutti`, `PLAN`, `VOTE`, `CLOSED`. An untagged message pings nobody. | ALERT names who to ping, or "no ping". | Tag who must act in your own messages. |
| `wait --focus` wakes an agent only for what concerns it (or its timer); the rest arrives as one digest line per author built from their JSON status, with message numbers; it is delivered anyway after 20 messages or 3 heartbeats. | `(+N other messages, not for you: ...)`, `read --range A-B`. | Nothing; if an agent missed something, tag it. |
| PLAN / VOTE / CLOSED are headings read at a line start, also in a reply, in bold, after an emoji: `PLAN v2: ...`, `PLAN v2 (draft): ...`; `CLOSED` in capitals. "PLAN v1 also needs a test" is a sentence. A vote is the first line of its own message; quoted lines (`>`, quotes, backticks, brackets) are not votes. | post prints a NOTE when a plan lacks its colon or a vote is not on the first line. | Nothing. |
| `CLOSED vN` from a participant is refused until every active participant (except the plan's author) voted `VOTE vN: yes, checked <file:line, output, #n>`. After `PLAN v3` only you and the user post a new version. | The refusal lists who has not voted, who voted no, whose yes lacks evidence. | You and the user can always close. Another closing rule in the brief: `config closing_gate=0`. |
| A no is a split. | Told its no must rest on evidence. | Relay line `VOTE-NO (LEAD REVIEW)`: read both sides (`read --range`), then one message to `@tutti` starting with DECIDE: the version that stands or what changes, and why. Same when a plan reaches v3. |
| `task done` wants a proof naming an artifact (exit code, tests passed, file:line, `#n`, hash, path or source file, link, measured time or size); `--gaps` = not done; `--touched` = a finding about changed interfaces. Only you close without an artifact (`--force`). | The refusal shows an example. | Below: verify and merge checks. |
| Leases: a task whose owner is silent (not idle) for 5 heartbeats can be taken without `--force`; `task next` takes the first free one; a lent piece goes back only to its lender and must be accepted (`task accept`) within 10 minutes. | `⏳ lease lapsed`. | Nothing, unless two claim one: the board says who holds it. |
| Scope: `--files` takes folders (`src/net/`, `.` = all); a folder and a file inside it clash; Windows ignores case. `task amend` widens an owner's files when no other task (taken or open) declares them. | The refusal names the task that declares them. | Decide (ROUTE): split it, or `task amend T3 --files x --force --as LEAD`. |
| Independent first positions: a first message written after reading the others' is marked. | The prompt asks for their own view first. | If the room echoes one view, ask the marked agents (CHALLENGE). |
| Budget: every post/read/wait is counted per agent. | — | Past `budget_calls` (300; `config budget_calls=N`, 0 = off) a CHECK repeats at each multiple: still advancing, or looping? |
| Delivery: a cancelled MCP wait consumes nothing; a Codex wait stays under its tool timeout (`CHATROOM_TOOL_TIMEOUT`). The lock holds its owner's token. You are not on the silence timer and nobody re-reads their own messages. | — | A wait cut off anyway: `read --range` from the last number seen. |

## 4. Tasks that prove themselves

From the shell, never through MCP, never copying a command from chat text:

```bash
python CHAT task add "parser handles empty input" --files src/parser.py --verify "pytest -q tests/test_parser.py" --as LEAD --room ROOM
```

`--merge-into main` when the work is on a branch; `--verify-timeout N` for a test over 110 s; `--cwd DIR` to pin the
folder (without it the checks run where the closing agent runs `done`: its worktree). `done` then runs the test outside
the room's lock, kills it with its children past the limit, refuses until it exits 0, and records exit code, output hash
and last lines; `--merge-into` also refuses uncommitted work, a branch with no commit of its own and conflicts, and
reports changed files the task did not declare. Agents close checked tasks from their shell.

When agents change code, give each its own git worktree.

## 5. Watching on a budget

Most WATCH lines need nothing. Step in with one short message `--as LEAD`, tagged to who it concerns, opened with its
kind, only when:

- CHALLENGE: a claim without proof, or contradicting evidence already in the chat;
- CLARIFY: two readings of one thing;
- EVIDENCE: ask for the output or file:line;
- ROUTE: who does it (repeated work, two agents waiting on each other, files in two hands);
- DECIDE: a split you reviewed, a plan at v3, drift, everyone idle.

The CHECK lines (each printed once, also across relay restarts): proof without artifact, task closed with gaps, a proof
not naming the task's files, a no turned yes without evidence, 100% without evidence, a stalled or looping status, a tag
unanswered, one file in two statuses, undeclared files changed, 25 messages without a board change (drift), everyone
idle with nothing in progress, a plan closed without a single no (premature consensus), a lent piece not accepted, a
call budget passed. Act on the ones that matter; do not take sides in the discussion unless the user asks.

A silent agent (over twice the heartbeat, not idle): ping it to read and post a status. An idle agent waits on purpose:
wake it only by tagging it.

## 6. The user

Their messages come first for everyone. If they write to you instead of the viewer, post it for them and ping everyone
(say skill). Quick commands (`/accelera`, `/resoconto`, `/prove`, ...) are instructions to all; after `/aiutatevi` or
`/soccorso` pair helpers with `helpers`.

## 7. The end

When all agents stopped or the user closes: `transcript --out ROOM/transcript.md`, then tell the user from the
transcript and the reports only: the key moments, the outcome (the closed plan, or the last version and its votes), the
open disagreements, the messages per agent.
