# Lead's guide: a research room

A research room improves one file of a git repository against an evaluator nobody may touch, one attempt at a time.
The kernel (`chat.py research`) does all the bookkeeping the same way every time: it commits, runs, measures, keeps or
resets, and writes the results. You write the contract with the user, open the research, spawn one worker, watch, and
report. You never edit the program yourself and you never merge the result: the user does.

Your context is the expensive one: follow the room through the relay and `research status`, not by reading logs.

CHAT below is the plugin's `scripts/chat.py`, ROOM the room folder (use an absolute path).

## 1. Is it a research task?

It is when there is one file to improve, a command that measures it with one number, and a time per measurement small
enough for tens of runs (seconds to a few minutes). Kernels, solvers, training scripts, prompts in a file, configs all
fit. It is not when there is no number, or when several files must change together: then use a normal room.

## 2. Phase 0: the contract, with the user, in the room

Write `ROOM/research/task.md` together; post each draft and change it until the user writes that they approve it.

```markdown
# Contract
Goal: <what gets better, in one sentence>
Repository: <absolute path>   (committed and clean; the kernel works in its own worktree)
Program (the ONLY file that changes): <path in the repo>
Evaluator: <command, run from the repo root>
Metric: <NAME>, <lower|higher> is better
  printed by the evaluator as "NAME: value" exactly once, or
  written to the file in $CHATROOM_RESULT (preferred: then nothing the program prints counts)
Sealed (must not change, committed): <evaluator, data loader, anything that measures>
Data folders kept between runs (not committed): <data/> or none
Time per run: <minutes>   (a run past twice this is killed: a crash)
Runs in all: <N>
Held out: <what is never used before the final check, if any>
Simplicity: at equal results the shorter program wins
```

Check before approving: the evaluator runs the program in its own process when it can (then use the result file); the
metric line cannot be printed by the program (otherwise the run is "ambiguous" and a crash); the sealed files are
committed; the time per run fits the number of runs the user is willing to wait for.

## 3. Open it

```bash
python CHAT research init --room ROOM --as LEAD --repo <repository> --program <file> --evaluate "<command>" \
  --metric <NAME> --direction <min|max> --budget-min <minutes> --max-evals <runs> --sealed <a.py,b.py> \
  --tag <short-name> [--result-file] [--keep data/]
```

It makes the worktree `ROOM/research/work` on a new branch `research/<tag>` (the user's checkout is never touched),
`results.tsv`, `runs/`, and posts the contract to the chat. Then `config --topic "..." --subtitle "<goal>"` so the
prompts name the task.

## 4. One worker

The loop is serial: one worker. Add it, write the brief, generate its prompt, spawn it with that text unchanged:

```bash
python CHAT add --room ROOM --participants WORKER --profile "WORKER|🔬|#0984e3|research worker|<model>|<effort>"
python CHAT brief --room ROOM goal="..." style="..."
python CHAT prompt WORKER --room ROOM --template research_worker.md --out ROOM/prompts/WORKER.md
```

The prompt already holds the contract, `task.md` as material, the evaluate command, the shell timeout a run needs (or,
past 600 s, how to run it in the background), and the rules below. Start the relay as in a normal room.

## 5. What the kernel does at every `research evaluate`

| Step | Effect |
|---|---|
| Worktree check | it is the research's own folder and branch, or nothing runs |
| Interrupted run | a run cut off half way last time (tool timeout, killed process) is recorded as a crash and the program goes back to the best; an attempt that never got committed is dropped without counting |
| Budget | refused past `--max-evals` |
| Seal | refused if a sealed file changed (the message gives the `git checkout` that restores it) |
| Scope | refused if any other tracked file changed or a new file appeared (Python caches and `--keep` folders excepted) |
| Baseline | the first run must be the unchanged program; later runs must change it |
| Commit and tag | the attempt is committed with the kernel's own identity (no hooks, no signing) and tagged `research/<tag>/att-N` |
| Clean | every untracked or ignored file is removed except `--keep` folders: only the committed tree runs |
| Run | the evaluator runs with `CHATROOM_RUN=N` (and `CHATROOM_RESULT` with `--result-file`), output to `runs/N.log`, killed with its children past twice the time per run |
| Metric | read once from the result file, or from the output where it must appear exactly once; not finite = crash |
| Decision | KEEP only if strictly better (the first run is the baseline); otherwise reset to the best; the tag stays |
| Record | one row in `results.tsv`, one "running" and one result line in the chat |

`research status` shows the best, the counts, and whether a run is in progress.

## 6. Your part while it runs

- Read the result lines in the relay; `research status` when you need the table.
- Step in (one short message to the worker) only when: the last runs only retune numbers (ask for a change of
  approach); a failed idea comes back; the same crash repeats; the worker is silent past its heartbeat. Never suggest the
  idea itself: say what not to repeat, or which trade-off the best has.
- The contract needs a change: `research amend --as LEAD` with `--evaluate` or `--result-file` (only before a baseline is
  kept, for example when the baseline crashed because the command was wrong), `--budget-min` or `--max-evals` (any time).
- The worker asks for something the contract forbids (another file, a dependency): ask the user; the answer is a new
  contract, not an exception.

## 7. Limits to tell the user plainly

The kernel runs as the user: an agent that edits the research files by hand can bypass it; the seal is a check, not a
wall. Without `--result-file` a program could print a false metric line (a second line makes the run a crash, so it
shows). A held-out check, several seeds and an audit of the best attempt are not done by the kernel: say so when they
matter.

## 8. The end

When the runs are used up or the user stops: report from `results.tsv` and the chat only: the baseline and the best
(run, metric, what changed), the kept runs in order, the most useful failures, and the best tag
`research/<tag>/att-N` with how to look at it (`git show research/<tag>/att-N`). The user decides whether to merge.
