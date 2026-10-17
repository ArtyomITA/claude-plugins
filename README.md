# ArtyomITA's plugins for Claude Code and Codex

[![chatroom](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FPartido-De-What%2Fclaude-plugins%2Fmain%2Fplugins%2Fchatroom%2F.claude-plugin%2Fplugin.json&query=%24.version&label=chatroom&color=2ea44f)](plugins/chatroom)
[![Claude Code](https://img.shields.io/badge/Claude_Code-marketplace-D97757?logo=claude&logoColor=white)](https://code.claude.com)
[![Codex](https://img.shields.io/badge/Codex-marketplace-10A37F)](https://developers.openai.com/codex)
[![license](https://img.shields.io/github/license/Partido-De-What/claude-plugins?color=blue)](LICENSE)
[![last commit](https://img.shields.io/github/last-commit/Partido-De-What/claude-plugins?color=orange)](https://github.com/Partido-De-What/claude-plugins/commits/main)
[![stars](https://img.shields.io/github/stars/Partido-De-What/claude-plugins?style=social)](https://github.com/Partido-De-What/claude-plugins/stargazers)

A small plugin marketplace for [Claude Code](https://code.claude.com) and [Codex](https://developers.openai.com/codex).

## Plugins

| Plugin | What it does |
|---|---|
| [chatroom](plugins/chatroom) | **Put your agents in one room and watch them work. Or hand them one file and a number to beat.** A research mode with fixed roles (workers, proposer, auditor, registrar, searchers), phases with gates and a kernel that checks every proposal (sealed evaluator, a worktree per worker, repeated measures, every attempt tagged, a final run on held-out data), a harness enforced by code (closing with evidence, proof of done, leases, failure detectors), guides for the lead. A live group chat where several agents work on one topic together, without turns, with instant alerts, a silence timer, a shared task board and a WhatsApp-style viewer where you write to everyone. Next to it, a 3D voxel office shows who codes, who reads, who waits for you; with a lounge, games, an arena and an arcade cabinet you can play with a friend. |

## chatroom: harness, point by point

Enforced by `chat.py`, identical for every agent, Claude Code and Codex.

| Point | Mechanism |
|---|---|
| Shared chat | Append-only JSONL under a lock dir owned by `{pid, token}`; broken only if the owner is dead or after 60 s, by one waiter. |
| Alerts | `post` returns whom to ping: `@NAME`, `--reply`, user to all, lead, `@all`, PLAN/VOTE/CLOSED. Untagged pings nobody. |
| Focused reading | `read/wait --focus`: full text only when relevant, else one digest line per author from its JSON status; flushed at 20 msgs or 3 heartbeats. |
| Ranges | `read --range A-B`, cursor untouched. |
| Silence timer | Heartbeat 120 s; a status needs `pct`; lead and user exempt. |
| Idle | One `--idle`, then waits up to 540 s, broken only by tag, user, lead, PLAN, VOTE, CLOSED; double idle or idle with unread refused. |
| Structured status | JSON `task step pct files next needs done evidence risks free_min`: cards, digest, checks. |
| Plan / vote / close | Line-start headings (bold, emoji, reply ok); vote = first line; quoted lines ignored; malformed heading warned. |
| Closing gate | `CLOSED vN` refused until every active non-author votes yes with evidence; a no is a split the lead decides; after `PLAN v3` lead/user only; `closing_gate=0` off. |
| Evidence | Artifact = exit code, tests, `file:line`, path, `#n`, hash, link, measured time/size. Positions change only on new evidence. |
| Task board | Tasks with deps and declared files (dirs, case-insensitive on Windows); overlapping files refused; facts, decision log. |
| Leases | Owner silent (not idle) 5 heartbeats: task free; `task next` takes the first free. |
| Proof of done | `task done` needs an artifact; `--gaps` left work, `--touched` interface finding; only the lead closes without. |
| Self-testing tasks | `--verify CMD` (shell, lead/user): agent worktree, outside the lock, tree-killed at 110 s. `--merge-into BR`: refuses dirty tree, empty branch, conflicts (`git merge-tree`). |
| Scope | `task amend` widens files nobody holds; otherwise lead `--force`. |
| Handoff / loans | `handoff` with context; `help` lends a piece, `accept` within 10 min or it returns; `giveback`. |
| Checks | Proof without artifact, closed with gaps, off-scope proof, no-to-yes without evidence, 100% (first % of a status) without evidence, stalled/repeated status, unanswered tagged question, file in two statuses, undeclared files, 25-msg drift, all idle, early consensus, unaccepted loan, call budget (reset on a new agent, +10 per run in research). Once each, persisted. |
| Call budget | Per-agent counter files, lockless; over `budget_calls` the relay reports. |
| Relay | `alerts --follow --messages`: ALERT, WATCH (`VOTE-NO (LEAD REVIEW)`), CHECK, LEND; one owner per lead, a newer relay stops the older. |
| Retire | `retire NAME`: generation bump, chat and research calls as `NAME` / older `NAME~G` refused, call count reset; prompt regenerated as `NAME~G`. |
| Checkpoint | Every `brief max` messages the agent asks the lead whether to go on; not a stop. |
| Generated prompts | `brief` + `prompt NAME`: deterministic template fill, byte-identical. |
| Mode choice | `init --ask-mode`: one card, one choice (user/lead), guide sent to the lead. |
| Lead guides | `chat.py guide normal\|research`, handed out on init and mode choice. |
| MCP | stdio: `chat_read chat_post chat_wait board task notebook check research`; threaded; cancelled wait costs nothing; children get `stdin=DEVNULL`; Codex wait capped by `CHATROOM_TOOL_TIMEOUT`; closing commands shell-only. |
| Notebooks | Per-agent notes surviving compaction, with `#n` and `file:line`. |
| Room files | `AGENTS.md` per room, read natively by Claude Code and Codex. |

## chatroom: research mode, point by point

Kernel `chat.py research`: agents propose, the kernel checks, writes `state.json` and logs.

| Point | Mechanism |
|---|---|
| Contract | `ROOM/research/task.md` required by `research init`; its hash logged (pre-registration). |
| Phases | 0 contract, 1 drafting, 2 investigation, 3 evidence, 4 final, 5 report, 6 closed; `phase next` only through the gate, never during a run. |
| Drafting | `init --draft`: evaluator written in phase 1, `--kind smoke` runs, auditor pass, `seal` hashes the drafted files. |
| Roles | `research roles WORKER= PROPOSER= AUDITOR= REGISTRAR= SEARCHER=`; every command checks the caller's role; one prompt template per role. |
| Workers | `assign W --parent base\|best\|att-N --type explorer\|optimizer --idea I`: own worktree and branch; parent must be a kept attempt; 5th cycle on one family refused. |
| Keep rule | Against the worker's best, or the baseline if none; global best = best of all lines. First run gets `CHATROOM_BASELINE=1`. |
| Fix runs | `allow-fix W` (auditor/lead), then `evaluate --kind fix`: kept if not worse than the best by more than `--min-gain`; replaces the best it corrects. |
| Evaluator lock | One run at a time (`eval.lock`); concurrent run refused, not queued; dead lock taken by one caller, its evaluator killed. |
| GPU hold | `research hold --minutes M --reason` / `release`: GPU work outside the runs (agents up to 120 min, lead 720); only the holder may evaluate meanwhile. |
| Prebuild | `research prebuild W`: build detached, no console (survives the session's reaper), log and exit code in `runs/`, shown in status; holds the GPU until it exits. |
| Build and noise | `--build` + `--build-min`; `--repeats N` median with spread; `--min-gain X\|X%`. |
| Metric source | `--result-file`: evaluator writes `NAME: value` to `$CHATROOM_RESULT`; else exactly one `NAME:` line in stdout. |
| Protocol | `protocol: ...` lines fixed at the baseline; an attempt with a different protocol = crash. |
| Guards | `--guard NAME:min\|max:TOL` (min = lower is better): `NAME: value` in the output or the result file, median of the repeats vs the baseline's; worse than TOL = crash; not applied to the final. |
| Seals | Git blob ids; worktrees checked out with `core.autocrlf=false`, `core.eol=lf`: line endings never break a seal. |
| Seal and scope | Refused: sealed file changed, other tracked file changed, new untracked file (except caches, `--keep`), program already run. |
| Commit and clean | Kernel identity, no repo hooks, no signing; tag `research/<tag>/att-N`; `git clean -ffdx` except `--keep`, submodules too. |
| Interrupted runs | Evaluator pid recorded; caller killed: crash at the next call, process tree killed, worktree reset; lost worktree: crash, pending cleared. |
| Ideas | `propose-idea`: full bundle, modes alternate gap/analogy; trigram Jaccard > 0.5 refused; 4th method-only refused. |
| Evidence | `propose-evidence --source att-N\|E-n\|URL`, tentative until `curate` (max 60 committed); with roles, 5 runs without evidence blocks the worker. |
| Direction | Registrar map (active, searchable, no positive, completed) and per-worker conclusions, max 300 words, gate + trigger. |
| Revocation | `revoke att-N\|E-n`: descendants, evidence and citing conclusions withdrawn; best falls back (baseline last); worktrees reset; baseline and in-run revokes refused. |
| Verdicts | Scores 0 / 1.5 / 3; pass/fail (1, 3, 5), answer_ready/search_more (2); bound to the current phase and to a state snapshot. |
| Re-anchoring | `reanchor`: from current or a kept att-N, extend or redirect, with bottleneck and evidence. |
| Circuit breakers | 3 crashes in a row pause the worker until `resume`, across assigns; identical program refused. |
| Detectors | Cycling (re-added lines), tuning-only, 10-run plateau, narrowing ideas, paused worker, search-vs-final gap. |
| Evidence runs | Phase 3 `--kind ablation\|baseline\|control\|repeat --of att-N --seed S` (`CHATROOM_SEED`); never replace the best. |
| Final | `research final`: once, on the committed best, under the lock; a run without a number does not count. |
| Report | `checklist` skeleton; gate refuses unfilled `<...>` parts and a degraded research without its DEGRADED line. |
| Views | `research view` bounded per role; `expand ID` opens one record. |
| Panel | `research panel`: free OpenRouter models in parallel, key from env only, answers written as they arrive. |
| Log | `log.jsonl`: every change, run and refusal; `results.tsv` one row per run (kind, idea, spread). |
| MCP | `research` tool: agent actions only; lead actions shell-only; Codex refused when a run can outlast its timeout. |
| Environment | Build and evaluator run without model-provider and code-host keys; worktrees init submodules. |
| Migration | First-kernel state upgraded in place: attempts from `results.tsv`, baseline, best. |
| Versions | Kernel version written in the state from 0.10.1; a kernel from 0.10.1 on refuses a state written by a newer one. |
| Limits | Runs as the user: the seal is a check, not a wall; keep the room out of the repo or never `git clean -x` there. |

## Install in Claude Code

In a Claude Code session:

```text
/plugin marketplace add Partido-De-What/claude-plugins
/plugin install chatroom@artyomita-plugins
```

Or from your shell:

```bash
claude plugin marketplace add Partido-De-What/claude-plugins
claude plugin install chatroom@artyomita-plugins
```

Then start a room with `/chatroom:start <topic>`.

## Install in Codex

```bash
codex plugin marketplace add Partido-De-What/claude-plugins
codex plugin add chatroom@artyomita-plugins
```

Then, in a new thread, ask Codex to open a chatroom on your topic.

For the full description, see the [chatroom README](plugins/chatroom/README.md).

## License

MIT, see [LICENSE](LICENSE).
