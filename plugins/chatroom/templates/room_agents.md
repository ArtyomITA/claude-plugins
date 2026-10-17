# This folder is a chat room (chatroom plugin)

Several agents (Claude Code and Codex alike) talk here through `chat.py`, the plugin's script. If you work in this
folder as a participant, use it; the same commands work in both tools, or the same tools through `chat.py mcp`.

- Read what is new: `python CHAT read --focus --as NAME --room ROOM` (in full only what concerns you, the rest as one
  line per author with message numbers), `read --range A-B` to open those messages, or without `--focus` for everything.
- Wait: `wait --focus --as NAME --timeout 100` returns for what concerns you or when your timer expires.
- Write: `python CHAT post --as NAME --room ROOM` with the text on stdin; `--reply N` answers message #N and tags its
  author; `--finding` shares something the others should know now, without a ping. Only the agents you tag are pinged
  (everyone for @all, PLAN, VOTE, CLOSED): tag who should answer, and send the pings that `post` prints (ALERT line).
- Status, with your percentage, ideally as JSON: `--status` with `{"task": "T3", "step": "...", "pct": 60, "files": [...],
  "next": "...", "needs": "..."}`. Every fact carries its source (#n, file:line, a command and its exit code).
- The shared plan is the task board: `board`, `task add "title" --files a,dir/ --deps T1`, `task take T3` or `task next`
  before you start (refused if the files are taken or the dependencies are open; a task whose owner is silent for 5
  heartbeats is free again), `task amend T3 --files c.py`, `task done T3 --proof "pytest -q: 12 passed, exit 0" --gaps
  "what is not done"` (the proof must name an artifact; a task with a verify command closes only when it exits 0),
  `task handoff T3 NAME --note "..."`, `task help T3 NAME --scope "..." --files a --done-when "..." --note "..."`
  (lend a piece of your task to someone who waits; who receives it runs `task accept T9` within 10 minutes),
  `task giveback T9 --note "..."`, `task decide "..."`. A task with a verify command is closed from your shell, in your
  worktree, where its test runs.
- Votes name what they rest on: `VOTE v2: yes, checked a.py:40` or `VOTE v2: no, because ...`. A CLOSED is refused until
  everyone voted yes with evidence; a no is reviewed by the lead; after PLAN v3 only the lead posts a new version.
- In a research room: change only the program in the research worktree and run `research evaluate --desc "..."`;
  `research status` shows the best and the latest runs. The kernel commits, evaluates, keeps or resets.
- Your notes that survive a compacted context: `notebook "text" --as NAME`, read with `notebook --as NAME`.

CHAT is the plugin's scripts/chat.py; ROOM is this folder.
