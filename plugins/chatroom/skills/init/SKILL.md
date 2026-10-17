---
name: init
description: Start the chat room in one step - create the room, open the live viewer on the chat, and let the user choose in the chat between a normal room (the lead sets it up with them) and a research room (contract first, then fixed research roles). Use when the user runs /chatroom:init or wants to start the chat room and decide its mode from the viewer.
argument-hint: "[optional: topic or title]"
---

# Start the chat room and let the user choose its mode

The user asked for: $ARGUMENTS (in Codex this stays as written: the request is the user's message)

You are the lead. CHAT is `${CLAUDE_PLUGIN_ROOT}/scripts/chat.py`. In Codex, which leaves that variable unfilled, CHAT is the absolute path of this SKILL.md with `skills/init/SKILL.md` replaced by `scripts/chat.py`. In PowerShell, pipe the text to `post` with `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); @'` ... `'@ | python "CHAT" post ...` instead of the heredoc.

Every text the room shows for the choice, and every agent prompt, is written by chat.py: you never rewrite them. Once agents work in the room, read section 6b of the chatroom start skill ("The lead's guide"): what chat.py enforces by itself (pings, focus, closing with evidence, proof of done, leases, checks, budget) and what is left to you, mainly reviewing a split vote (`VOTE-NO (LEAD REVIEW)`) and acting on CHECK lines without reading the whole chat into your context. You only fill the data they read (the config with `chat.py config`/`add`, the brief with `chat.py brief`).

## 1. Create the room, asking for the mode

Run `python "CHAT" rooms` first: if the user means a room that is already live, use it instead: open its viewer if it is not running (step 2), then go on from step 4a or 4b by its config (`mode` is `normal` or `research`; in a room opened without the choice ask the user in the room which one).

Put the room in your scratchpad directory when you have one, otherwise in `.chatroom/<short-slug>` under the project. Use the user's language for `--lang` (`it` or `en`); a title from the request if there is one, otherwise a neutral one you can change later.

```bash
python "CHAT" init --room "ROOM" --ask-mode --lang <it|en> --topic "<the topic in the user's words, or a placeholder>" --title "<title>" --icon "🧪" \
  --user-name <USER or the user's word for it> --profile "LEAD|👓|#6c5ce7|<your role>|<your model>|<your effort>"
```

`--ask-mode` posts the choice card in the chat: two buttons, **Normal** and **Research**; the user can also type `/normale` (`/normal`) or `/research`. The choice is taken once: chat.py refuses a second one.

## 2. Open the viewer on the chat

Start the viewer as in the chatroom start skill (step 3: a preview or launch configuration if one exists, otherwise a background process, never in the foreground):

```bash
python "CHAT" serve --room "ROOM" --port 8765
```

Give the user the address with the chat view: `http://127.0.0.1:<port>/?view=chat`. The office is one click away (the 🏢 and ◫ buttons).

## 3. Wait for the choice

Tell the user in one line that the room is open and waits for their choice in the chat. Then listen: repeatedly run `python "CHAT" wait --room "ROOM" --as LEAD --timeout 100` and read what arrives. A timeout with no message is not the end. The choice arrives as a message of the user that starts with `@LEAD MODALITÀ:` / `@LEAD MODE:`. chat.py hands you, with it, the command of the guide for that mode (`python "CHAT" guide normal` or `guide research`): run it and follow it before anything else. Answer any other message of the user in the room (`post --as LEAD`) while you wait.

## 4a. Normal

The lead's guide for this mode: `python "CHAT" guide normal`.

Keep the room as it is and set it up with the user, in the room: ask the topic, the goal, the participants (roles, models, effort) and the look; wait for their answer before spawning anyone. Then follow the chatroom start skill from "Decide the setup" with these differences:

- the room exists: never run `init` again (it would rewrite the config); set the real topic first if init had a placeholder (`python "CHAT" config --room "ROOM" --topic "..." --subtitle "<the goal>"`: the prompts read it); add the participants with `python "CHAT" add --room "ROOM" --participants A,B,C --profile "A|<emoji>|#rrggbb|<role>|<model>|<effort>" ...` and change the look with `python "CHAT" config --room "ROOM" --title ... --subtitle ...`;
- write the brief once: `python "CHAT" brief --room "ROOM" goal="..." style="..." materials="ROOM/DOSSIER.md" constraints="..." closing="..." max=45` (left out: the room's defaults);
- each prompt is `python "CHAT" prompt NAME --room "ROOM" --out "ROOM/prompts/NAME.md"`: pass that file's text unchanged to the Agent tool (or spawn_agent). If something in it is wrong, change the brief or the config and generate it again; do not edit the prompt.

## 4b. Research

The lead's guide for this mode, with the contract template and what the kernel does at every run: `python "CHAT" guide research`. The steps below are its short form.

A research room runs the research kernel: an autoresearch loop (one file changes, a sealed evaluator, keep if strictly better or reset). Several roles, phases and an audit are not part of it yet; say so to the user if they ask for them.

1. **Phase 0, the contract**, in the room with the user. Ask the task, then write `ROOM/research/task.md` together: Goal; the repository and the ONE file that may change (the program); the evaluator command and the metric it prints as `NAME: value` (lower or higher is better); the files that are sealed (the evaluator, the data loader, anything that measures); the time per run and the number of runs; what is held out for a final check and never used before it; the simplicity rule (at equal results the shorter program wins). The repository must be committed and clean. Post each draft in the room and change it until the user writes that they approve it.
2. **Open the research** with the approved terms (only you or the user can):

```bash
python "CHAT" research init --room "ROOM" --as LEAD --repo "<repository>" --program <file> --evaluate "<command>"   --metric <NAME> --direction <min|max> --budget-min <minutes per run> --max-evals <runs> --sealed <a.py,b.py> --tag <short-name> [--result-file] [--keep data/]
```

   Sealed files must be committed (the worktree holds only committed files). Before each run the kernel removes every untracked or ignored file of the worktree: data the evaluator needs and that is not committed goes in a folder named with `--keep data/` (never cleaned, and not counted as a new file), or outside the repository by absolute path. Use an absolute ROOM. Prefer `--result-file` when the evaluator can write its metric to the file named in `$CHATROOM_RESULT` (and runs the program in its own process): then nothing the program prints can count. Without it the metric is read from the output and must appear there exactly once; `research status` reminds you of the difference. Save the approved contract as `ROOM/research/task.md`: the worker's prompt points to it. It creates a git worktree `ROOM/research/work` on a new branch `research/<tag>`: the user's own checkout is never touched. Attempts are tagged `research/<tag>/att-N`, the results go to `ROOM/research/results.tsv`, each run's output to `ROOM/research/runs/N.log`, and one line per run to the chat.
3. **One worker** (the research loop is serial). Set the topic from the contract first (`config --topic "..." --subtitle "<goal>"`). Then add it (`python "CHAT" add --room "ROOM" --participants WORKER --profile "WORKER|🔬|#0984e3|research worker|<model>|<effort>"`), write the brief (`brief goal=... style=...`), then `python "CHAT" prompt WORKER --room "ROOM" --template research_worker.md --out "ROOM/prompts/WORKER.md"` and spawn it with that text unchanged.
4. **What the kernel does by itself**, so you do not check it by hand: it refuses a first run that is not the unchanged baseline, a run where the program equals the best, a run where a sealed file or any other tracked file changed (the message names the file and the `git checkout` that restores it), any new untracked file, a second evaluation while one runs, and any run past `--max-evals`; before each run it removes ignored files, so only the committed program runs. A call cut off half way (a tool timeout, a killed process) is recorded as a crash at the next call and the program goes back to the best. The worker's prompt tells it the shell timeout a run needs; via MCP a Codex client is refused when a run could outlast its tool timeout. A broken evaluator or a crashed baseline is fixed with `python "CHAT" research amend --room "ROOM" --as LEAD --evaluate "<command>"` (before a baseline is kept; `--budget-min` and `--max-evals` can change at any time). A run longer than twice `--budget-min` is killed and recorded as a crash; a crash shows the last 30 lines of its log. A worse or crashed run resets the program to the best, but its tag `research/<tag>/att-N` stays, so it can be inspected or restored later (`git checkout research/<tag>/att-N -- <program>` in the worktree, then a new evaluate).
5. **While it runs**: follow the room as in the chatroom start skill (relay, WATCH lines). `python "CHAT" research status --room "ROOM"` shows the best and the latest runs. Step in when the worker only retunes numbers, repeats a failed idea, or a crash repeats; never suggest the idea itself, say what not to repeat or which trade-off the best has.
6. **At the end** (budget used up or the user stops it): report from `results.tsv` and the chat only: the baseline and the best (run, metric, what changed), the kept runs in order, the most useful failures, and the best commit (`research/<tag>/att-N`) the user can merge. Never merge it yourself.

## 5. When it ends

As in the chatroom start skill (step 7) and the chatroom close skill.
