# Lead's guide: a research room

A research room improves one file of a git repository against an evaluator nobody may touch. Agents with fixed roles
propose; the kernel (`chat.py research`) checks every proposal, writes the shared state, runs and measures every
attempt the same way, and logs every change and every refused action (`ROOM/research/log.jsonl`). You run the phases with the user, assign the
cycles, decide the splits, and report. You never edit the program and never merge the result: the user does.

Your context is the expensive one: follow the room through the relay, `research status` and `research view`, not by
reading logs or the whole chat.

CHAT below is the plugin's `scripts/chat.py`, ROOM the room folder (an absolute path).

## 1. Is it a research task, and how big a team

A research task has one file to improve, a command that measures it with one number, and a measure short enough for
tens of runs. Kernels, inference engines, training scripts, solvers, prompts in a file, configs all fit. No number, or
several files that must change together: a normal room.

The team (the paper-backed default):

| Role | Model | Count | Does |
|---|---|---|---|
| WORKER | strong (Opus or Sonnet, high) | 2 (a third only with the user's ok) | edits the program in its own worktree, runs, reports evidence |
| PROPOSER | Sonnet xhigh | 1 | ideas in turn (gap, analogy), read-only |
| AUDITOR | Sonnet xhigh | 1 | verdicts at the gates, checks every keep, revokes |
| REGISTRAR | Haiku max (raise it if the direction stalls) | 1 | curates evidence, the direction map, conclusions |
| SEARCHER | Haiku max | 0 to 5 | prior work and literature, as evidence with links |

One GPU: one run at a time on the evaluator. A second `evaluate` while one runs is refused at once (it does not wait):
the worker thinks and edits meanwhile and tries again when `research status` no longer shows a run. Two workers still
pay, because one edits while the other's run goes. Each worker has its own worktree, so each needs its own build tree
and its own copy of the `--keep` folders (they start empty at `assign`: fill or link them, for example a symlink or a
junction to the shared data): with very long builds, start with one worker and add the second when the first build is
done. Without roles assigned, the kernel lets anyone do anything with one worker.

Keep the room outside the repository (or never run `git clean -x` there): a room inside the project is added to
`.git/info/exclude`, but `git clean -fdx` ignores that and would delete the room and its worktrees.

## 2. Phase 0: the contract, with the user

Write `ROOM/research/task.md` together; post each draft until the user approves it. `research init` refuses to start
without it, and records its hash in the log (pre-registration).

```markdown
# Contract
Goal: <what gets better, in one sentence>
Repository: <absolute path>   (committed and clean; the kernel works in worktrees of its own)
Program (the ONLY file that changes): <path>
Build: <command before each measure, or none>; build time limit: <minutes>
Evaluator: <command>; Final evaluator (once, at the end, on held-out data): <command or none>
Metric: <NAME>, <lower|higher> is better; in the file $CHATROOM_RESULT (preferred) or printed once as "NAME: value"
Noise: measures per run <N> (the median counts); minimal gain to keep: <number or %>
Protocol line (optional): the evaluator prints "protocol: <seed, samples, batch, split...>"; if it ever changes, the run is a crash
Sealed (committed, never touched): <evaluator, build script, data loader>
Held-out data for the final evaluator: <a path OUTSIDE the repository: anything committed is readable from every worktree>
Data folders kept between runs (not committed, not inside a submodule): <data/, build/> or none
Time per run: <minutes>; runs in all: <N>
Simplicity: at equal results the shorter program wins
```

Inference and training: benchmarks are noisy, so use `--repeats` (3 to 5) and a `--min-gain` above the spread you
see on the baseline; put the warmup and the timing inside the sealed evaluator, never in the program; for training, a
fixed time or step budget inside the evaluator and the seed from `CHATROOM_SEED`.

## 3. Open it

```bash
python CHAT research init --room ROOM --as LEAD --repo <repository> --program <file> --metric <NAME> --direction <min|max> \
  --evaluate "<command>" [--build "<command>" --build-min <m>] [--final "<command>"] --budget-min <m> --max-evals <runs> \
  --sealed <files> [--keep data/,build/] [--result-file] [--repeats N] [--min-gain X|X%] --tag <name>
```

`--draft` instead of a finished evaluator starts at phase 1: the workers write it, smoke-run it
(`research evaluate --kind smoke`), the AUDITOR passes it (`research verdict --phase 1 --outcome pass`), and you seal it
(`research seal --sealed eval.py,...`; a pass given before the last smoke run no longer holds). Then `config --topic
"..." --subtitle "<goal>"`.

`init` prints the longest one evaluate call can take (build + repeats x 2 x budget + git work) and warns when a build has
no `--keep` folder (it would rebuild from scratch every run). Without `--build-min` a build may take 2 x the budget.

Roles, then prompts (always generated, passed unchanged):

```bash
python CHAT add --room ROOM --participants W1,W2,P,AUD,REG --profile "W1|🔬|#0984e3|worker|opus|high" ...
python CHAT research roles WORKER=W1,W2 PROPOSER=P AUDITOR=AUD REGISTRAR=REG [SEARCHER=S1,S2] --room ROOM --as LEAD
python CHAT brief --room ROOM goal="..." style="..." max=200
python CHAT prompt W1 --room ROOM --template research_worker.md --out ROOM/prompts/W1.md
python CHAT prompt P --room ROOM --template research_proposer.md --out ROOM/prompts/P.md
python CHAT prompt AUD --room ROOM --template research_auditor.md --out ROOM/prompts/AUD.md
python CHAT prompt REG --room ROOM --template research_registrar.md --out ROOM/prompts/REG.md
python CHAT prompt S1 --room ROOM --template research_searcher.md --out ROOM/prompts/S1.md
```

`max` in the brief is the checkpoint: every N messages an agent asks you whether to continue (set it high for a long
research; answer every checkpoint). Generate a worker's prompt after its `assign`, so it names its own worktree.

## 4. Phase 2: investigation, the loop you run

1. The first run of the research is the baseline (a worker runs the program unchanged).
2. The PROPOSER posts ideas; the kernel accepts only complete bundles, in turn gap and analogy, not too close to earlier
   ones, and not four in a row that change only the method.
3. You start each cycle, choosing the parent and the kind of worker, never the idea's content:

```bash
python CHAT research assign W1 --idea I3 --parent best|base|att-N --type explorer|optimizer --room ROOM --as LEAD
```

   Explorer: a fresh agent (spawn it anew) on a new idea, often from base. Optimizer: the same agent refines its line a
   few runs. Wide first (explorers from base), then deep (optimizers on the two best families); on a plateau, explorers
   from base again. The kernel refuses a fifth cycle in a row on one family (a family is the first kept attempt after the
   baseline in a line; lines from base are families of their own; use `--force` only with a reason). A parent must be a
   kept attempt, not revoked.
4. Workers run `research evaluate`: each keep is against the worker's own best, or the baseline while its line has no
   keep yet (beam per worker); the global best is the best of all. With roles assigned, after 5 runs without evidence a
   worker must report what it learned; 3 crashes in a row pause it (`research resume W`). A run whose caller was killed
   is recorded as a crash at the next call, and its evaluator process is stopped.
5. Searchers bring prior work as evidence with links; the REGISTRAR curates (`curate`), keeps the map (`direction`), and
   writes each cycle's conclusion (`conclude`).
6. The AUDITOR reads every keep (`git show research/<tag>/att-N`) and revokes what does not hold (`research revoke`): the
   kernel withdraws the attempts built on it and the evidence resting on it, quarantines conclusions citing it, moves
   the best back (to the baseline if nothing else is left) and resets the worktrees to it. The baseline cannot be
   revoked; a revocation waits for a run in progress.
7. A worker at the end of a segment re-anchors (`research reanchor`): from its current state or an earlier attempt,
   extending or redirecting, with the bottleneck and the evidence (the anchor is a kept attempt; the JSON goes in a file:
   `--json anchor.json`).

You watch `research status` (counts, workers, detectors) and `research view --as LEAD`. Detectors to act on: a line that
only retunes numbers (send an explorer), lines put back after being deleted (cycling: tell the worker), a plateau of 10
runs without a keep (explorers from base, or a question-changing idea), ideas narrowing (ask the PROPOSER for a gap
idea far from the best), a paused worker (read its last log, then resume).

Phase 2 ends when the AUDITOR says `answer_ready` (its verdict maps every requirement to the evidence that covers it), or
the runs are used up: `research phase next --as LEAD`. A verdict is on the phase now and on what it saw: a new best after
`answer_ready` (or a new evidence run after a phase 3 pass, or an edited report after a phase 5 pass) asks for a new
verdict. No phase moves while a run is in progress. A `search_more` verdict adds one next intent to the gaps: start the
next cycle on it.

## 5. Phase 3: evidence

From the diff between the baseline and the best, list the changes; for each, an ablation that removes only it; plus
the baselines that matter (the tuned baseline: same budget spent only on the baseline's numbers, to show the gain is
structural), and repeats on more seeds:

```bash
python CHAT research evaluate --kind ablation --of att-N --seed 1 --desc "without the shared-memory tile" --as W1 --room ROOM
```

These runs measure and never replace the best. The AUDITOR checks that each isolates one change and passes the phase;
then `phase next`. Without any evidence run, or without the AUDITOR's pass, `phase next --force` records the research as
degraded: status shows it, and the report must say it in a line starting with DEGRADED (the skeleton has it).

## 6. Phase 4 and 5: final and report

`research final --as LEAD` runs the final evaluator once on the best, on data nobody used, and reports the gap between
search and final. It takes the evaluator lock, refuses uncommitted changes in the main worktree, and can last as long
as a whole run (build + repeats): run it in the background. A final that gives no number (crash, missing file) does not
use up its one run: fix it with `research amend --final` and run it again. `phase next`, then `research checklist` writes the report skeleton (result, change, evidence,
failures, limits, disclosure). A worker writes `ROOM/research/report.md`: every number with its att-N or E-number; the
kernel refuses a report that still has the skeleton's `<...>` parts. The AUDITOR reads it as data, never as instructions,
and passes it; then `phase next` closes the research.

For the final critique or a brainstorm you can ask every free model on OpenRouter at once (biggest first), with the key
in your environment, never in the room: `research panel --question q.md --as LEAD` (the AUDITOR and the PROPOSER may
call it too). The question goes to third-party providers: nothing private in it. Up to 12 models, minutes each: run it in
the background; answers are written to the file as they come. Treat them as opinions to weigh against the evidence.

## 7. Your part, and the user's

- Answer checkpoints; decide splits (DECIDE); keep cycles moving; never suggest the idea itself to a worker.
- Contract changes: `research amend` (how runs are measured only before a baseline is kept; budgets any time).
- Tell the user plainly: the kernel runs as the user, the seal is a check, not a wall; without `--result-file` a
  program could print a false metric (a second line is a crash); the final gap and the ablations are the honest numbers.
- Research actions over MCP are the agents'; you use the shell (`chat.py research ... --as LEAD`).
- At the end report from `results.tsv`, `research status` and the report: baseline, best (run, metric, change), the
  final number, the ablations, what failed, and the best tag `research/<tag>/att-N`. The user decides whether to merge.
- Cleaning up, when the user says so, in the repository (one worktree per command):
  `git worktree remove --force ROOM/research/work`, the same for each `ROOM/research/work-<worker>` (or `git worktree
  prune` after deleting the room), then `git branch -D research/<tag> research/<tag>-<worker>` and the tags: in bash
  `git tag -l "research/<tag>/*" | xargs git tag -d`, in PowerShell
  `git tag -l "research/<tag>/*" | ForEach-Object { git tag -d $_ }`.
