"""The research kernel of the chat room, first step (A8 in docs/integrazioni-research.md): an autoresearch loop.

One file of a git repository may change; the evaluator and the files named in the contract are sealed. A worker edits
the program in the research worktree and calls `chat.py research evaluate`: the kernel (this file, never the agent)
checks the seal and that nothing else changed (tracked or not), commits the attempt, removes every untracked or ignored
file, runs the evaluator with a time limit, reads the metric, keeps the commit when it is strictly better (the first run
is the baseline) and otherwise resets the branch to the best. Every attempt is tagged, so a discarded one can be
restored later, and written to results.tsv by the kernel. A run cut off half way (the tool timed out, the process was
killed) is recorded as a crash at the next call, never left half done.

The metric comes from a result file when the contract says so (--result-file: the sealed evaluator writes
"METRIC: value" to the path in $CHATROOM_RESULT, outside the worktree), otherwise from the evaluator's output, where
it must appear exactly once: a program that prints its own metric line makes the run ambiguous, and a crash.

Layout: ROOM/research/contract.json, state.json, results.tsv, runs/<n>.log and <n>.result, eval.lock, work/ (the git
worktree, branch research/<tag>). Standard library only, like chat.py. Everything here runs as the user: the files are
not protected from an agent that edits them by hand; the seal is a check, not a wall."""
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path

TSV_HEAD = 'n\tcommit\tmetric\tstatus\tseconds\tlines\tby\tdescription\n'
NUMBER = r'([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)'


def _dir(room):
    return (room.dir / 'research').resolve()          # absolute: git commands run in other folders


def _git(cwd, *args, check=True, ident=None):
    """git with file names unquoted (a program called modèle.py stays modèle.py) and, for the kernel's commits, an
    identity of its own and no hooks or signing of the user's repository"""
    pre = ['-c', 'core.quotepath=false']
    if ident:
        pre += ['-c', f'user.name={ident}', '-c', f'user.email={ident.lower()}@chatroom.invalid', '-c', 'commit.gpgsign=false',
                '-c', 'tag.gpgsign=false']
    r = subprocess.run(['git', *pre, *args], cwd=cwd, capture_output=True, stdin=subprocess.DEVNULL, timeout=120)
    out = (r.stdout + r.stderr).decode('utf-8', errors='replace').strip()
    if check and r.returncode != 0:
        raise ValueError(f"git {' '.join(args)} failed: {out[:400]}")
    return out


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _load(room, name):
    path = _dir(room) / name
    if not path.is_file():
        raise ValueError('no research in this room: the lead starts it with chat.py research init')
    return json.loads(path.read_text(encoding='utf-8'))


def _save(room, name, data):
    """state written under the room's lock, like every other shared file of the room"""
    from chat import write_atomic
    room.locked(lambda: write_atomic(_dir(room) / name, json.dumps(data, indent=1, ensure_ascii=False)))


def _rel(top, f):
    p = Path(f)
    return (p if not p.is_absolute() else p.resolve().relative_to(top)).as_posix()


def init(room, by, program, evaluate, metric, direction='min', budget_min=5.0, max_evals=100, repo='.', sealed=(), tag=None,
         result_file=False, keep=()):
    """the lead or the user writes the contract: which file changes, how it is evaluated, what is sealed, the budget"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user starts a research (they write the contract)')
    if (_dir(room) / 'contract.json').exists():
        raise ValueError(f'this room already has a research: {_dir(room) / "contract.json"}')
    if direction not in ('min', 'max'):
        raise ValueError('--direction is min (lower is better) or max')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', metric or ''):
        raise ValueError('--metric is the name the evaluator prints before the colon, for example val_bpb (it prints "val_bpb: 0.99")')
    if not (0 < float(budget_min) <= 1440):
        raise ValueError('--budget-min: the minutes of one run, more than 0 and at most 1440')
    if not (1 <= int(max_evals) <= 100000):
        raise ValueError('--max-evals: how many runs in all, at least 1')
    top = Path(_git(repo, 'rev-parse', '--show-toplevel')).resolve()
    if _git(top, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError(f'{top} has uncommitted changes: commit or stash them first (the research starts from a clean commit)')
    rel_prog = _rel(top, program)
    if not _git(top, 'ls-files', '--', rel_prog):
        raise ValueError(f'{rel_prog} is not a tracked file of {top}: the program must be committed')
    seals = {}
    for f in sealed:
        rel = _rel(top, f)
        if rel == rel_prog:
            raise ValueError(f'{rel} is the program: it cannot also be sealed')
        if not _git(top, 'ls-files', '--', rel):
            raise ValueError(f'sealed file {rel} is not tracked in {top}: only committed files can be sealed (the research '
                             f'worktree holds only them). Commit it, or keep it outside the repository, read-only')
        seals[rel] = _sha(top / rel)
    keep = [k.strip().replace('\\', '/').strip('/') + '/' for k in keep if k.strip().strip('/.')]
    if any(k.split('/')[0] in ('..', '.git') or k == rel_prog + '/' for k in keep):
        raise ValueError('--keep names folders inside the worktree for data the evaluator needs (not .git, not ..)')
    tag = tag or time.strftime('r%m%d-%H%M')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', tag):
        raise ValueError('--tag: letters, digits, dot, dash or underscore')
    branch = f'research/{tag}'
    if _git(top, 'branch', '--list', branch):
        raise ValueError(f'the branch {branch} already exists: pick another --tag')
    d = _dir(room)
    work = d / 'work'
    if work.exists():
        raise ValueError(f'{work} already exists: a research left half made? remove it (git worktree remove --force "{work}") first')
    (d / 'runs').mkdir(parents=True, exist_ok=True)
    _git(top, 'worktree', 'add', '-b', branch, str(work), 'HEAD')   # its own folder: the user's checkout is never touched
    base = _git(work, 'rev-parse', 'HEAD')
    contract = {'program': rel_prog, 'evaluate': evaluate, 'metric': metric, 'direction': direction,
                'budget_s': max(1, int(float(budget_min) * 60)), 'max_evals': int(max_evals), 'repo': str(top), 'work': str(work),
                'branch': branch, 'tag': tag, 'base_commit': base, 'sealed': seals, 'by': by,
                'metric_source': 'file' if result_file else 'output', 'keep': keep, 'created': time.strftime('%Y-%m-%d %H:%M:%S')}
    _save(room, 'contract.json', contract)
    _save(room, 'state.json', {'evals': 0, 'best': None, 'head': base, 'pending': None})
    (d / 'results.tsv').write_text(TSV_HEAD, encoding='utf-8')
    return (f"🔬 research {tag} open: only {rel_prog} changes, in {work} (branch {branch}); evaluator `{evaluate}`, metric "
            f"{metric} ({'lower' if direction == 'min' else 'higher'} is better) read from "
            f"{'the result file $CHATROOM_RESULT' if result_file else 'the output (exactly one line)'}, {contract['budget_s']} s "
            f"per run, {max_evals} runs" + (f"; sealed: {', '.join(seals)}" if seals else '')
            + (f"; kept untouched (data): {', '.join(keep)}" if keep else '') + '. The first run is the baseline.')


def amend(room, by, evaluate=None, budget_min=None, max_evals=None, result_file=None):
    """the lead changes the contract: the budget at any time; the evaluator and where the metric comes from only before a
    baseline is kept (a crashed baseline is fixed this way, not by starting over)"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user changes the contract')
    c, st = _load(room, 'contract.json'), _load(room, 'state.json')
    said = []
    if (evaluate or result_file is not None) and st['best'] is not None:
        raise ValueError('the evaluator cannot change after a baseline is kept: the runs would not compare')
    if evaluate:
        c['evaluate'] = evaluate
        said.append(f'evaluator `{evaluate}`')
    if result_file is not None:
        c['metric_source'] = 'file' if result_file else 'output'
        said.append(f"metric from {'the result file' if result_file else 'the output'}")
    if budget_min is not None:
        if not (0 < float(budget_min) <= 1440):
            raise ValueError('--budget-min: more than 0 and at most 1440')
        c['budget_s'] = max(1, int(float(budget_min) * 60))
        said.append(f"{c['budget_s']} s per run")
    if max_evals is not None:
        if not (st['evals'] < int(max_evals) <= 100000):
            raise ValueError(f"--max-evals must be more than the {st['evals']} runs already made")
        c['max_evals'] = int(max_evals)
        said.append(f'{max_evals} runs in all')
    if not said:
        raise ValueError('research amend: --evaluate, --result-file/--no-result-file, --budget-min or --max-evals')
    _save(room, 'contract.json', c)
    return f"🔬 research {c['tag']} contract changed by {by}: " + ', '.join(said)


def _clean(work, c):
    """remove every untracked or ignored file but the kept data folders and caches of the program; never stops a run:
    a file still held by a leftover process (Windows) is reported, not fatal"""
    args = ['clean', '-ffdxq'] + [x for k in c.get('keep', []) for x in ('-e', '/' + k)]
    out = _git(work, *args, check=False)
    return out if 'failed to remove' in out or 'error' in out.lower() else ''


def _check_work(c, st):
    """the worktree is there and is the research's own (its top folder and branch), so no git command ever lands in the
    user's checkout"""
    work = Path(c['work'])
    if not work.is_dir():
        raise ValueError(f'the research worktree is missing ({work}): the research cannot go on. Tell the lead.')
    top = _git(work, 'rev-parse', '--show-toplevel', check=False)
    if not top or Path(top).resolve() != work.resolve():
        raise ValueError(f'{work} is not the research worktree any more (git sees {top or "nothing"}): stop and tell the lead.')
    branch = _git(work, 'rev-parse', '--abbrev-ref', 'HEAD', check=False)
    if branch != c['branch']:
        raise ValueError(f"the research worktree is on {branch}, not on {c['branch']}: switch back (git switch {c['branch']}).")
    return work


def _run(cmd, cwd, log, limit, env):
    """run the evaluator with its output in a file (never in anyone's context); kill the whole tree past the limit"""
    start = time.time()
    with open(log, 'wb') as out:
        kw = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
        p = subprocess.Popen(cmd, shell=True, cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=env, **kw)
        try:
            code = p.wait(timeout=limit)
        except subprocess.TimeoutExpired:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(p.pid)], capture_output=True, stdin=subprocess.DEVNULL)
            else:
                import signal
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    p.kill()
            p.wait()
            code = None
    return code, time.time() - start


def _lines(stat):
    """'+added -removed' from git diff --shortstat (either part may be missing)"""
    add = re.search(r'(\d+) insertion', stat or '')
    rem = re.search(r'(\d+) deletion', stat or '')
    return f"+{add.group(1) if add else 0} -{rem.group(1) if rem else 0}"


def _row(room, n, commit, value, status, secs, lines, name, desc):
    with open(_dir(room) / 'results.tsv', 'a', encoding='utf-8') as f:
        f.write('\t'.join([str(n), commit, '' if value is None else f'{value:.6g}', status, f'{secs:.0f}', lines, name,
                           ' '.join(desc.split())]) + '\n')


def evaluate(room, name, desc):
    """one attempt: seal and scope checks, commit, run, keep or reset; the result goes to results.tsv and to the chat"""
    c = _load(room, 'contract.json')
    d = _dir(room)
    lock = d / 'eval.lock'
    mine = f'{os.getpid()} {time.time():.0f} {name} {secrets.token_hex(4)}'
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, mine.encode())
            os.close(fd)
            break
        except FileExistsError:
            from chat import lock_owner_alive
            try:
                pid, ts, who = (lock.read_text(errors='replace').split() + ['0', '0', '?'])[:3]
                age = time.time() - float(ts)
            except (OSError, ValueError):
                who, age = '?', 0
            if lock_owner_alive(lock) and age < 2 * c['budget_s'] + 300:
                raise ValueError(f'another evaluation is running (by {who}, {age:.0f} s ago; lock {lock}): one at a time, wait for it')
            tomb = lock.with_name(f'eval.lock.dead.{secrets.token_hex(4)}')
            try:
                os.rename(lock, tomb)                 # its owner is dead, or it ran far over any run's limit: one taker only
                tomb.unlink()
            except OSError:
                pass
    else:
        raise ValueError(f'could not take the evaluation lock {lock}: try again')
    try:
        return _evaluate(room, name, desc, c, _load(room, 'state.json'), d)
    finally:
        try:
            if lock.read_text(errors='replace') == mine:
                lock.unlink()
        except OSError:
            pass


def _reconcile(room, c, st, work):
    """a run that was cut off half way (pending in the state). Committed: record it as a crash and put the program back to
    the best (its code stays in its commit, and in its tag when the tag was made). Not committed yet: nothing ran, so
    nothing is counted and the worker's edit is left as it is"""
    p = st['pending']
    head = _git(work, 'rev-parse', 'HEAD', check=False)
    committed = bool(p.get('commit')) or (head and head != st['head']
                                          and _git(work, 'log', '-1', '--format=%s', check=False).startswith(f"att-{p['n']}:"))
    if not committed:
        st['pending'] = None
        _save(room, 'state.json', st)
        return None
    commit = p.get('commit') or _git(work, 'rev-parse', '--short=7', 'HEAD')
    tag = f"{c['branch']}/att-{p['n']}"
    if not _git(work, 'tag', '--list', tag):
        _git(work, 'tag', tag, commit, ident=p.get('by', 'LEAD'), check=False)
    _git(work, 'reset', '-q', '--hard', st['head'])
    _clean(work, c)
    st['evals'], st['pending'] = p['n'], None
    _save(room, 'state.json', st)
    _row(room, p['n'], commit, None, 'crash', 0, p.get('lines', ''), p.get('by', '?'), 'INTERRUPTED: ' + p.get('desc', ''))
    has_tag = bool(_git(work, 'tag', '--list', tag))
    line = (f"🔬 att-{p['n']} by {p.get('by', '?')} was interrupted half way (the call ended before the result): recorded as "
            f"CRASH, {c['program']} back to the best" + (f"; its code stays in tag {tag}" if has_tag else f"; its code is in commit {commit}"))
    room.append(p.get('by', 'LEAD'), line, 'board')
    return line


def _evaluate(room, name, desc, c, st, d):
    work = _check_work(c, st)
    if st.get('pending'):
        line = _reconcile(room, c, st, work)
        if line:
            raise ValueError(line + '. Edit the program again (git checkout <that tag> -- <program> brings it back) and evaluate.')
    if st['evals'] >= c['max_evals']:
        raise ValueError(f"the budget of {c['max_evals']} runs is used up: the research is over, tell the lead")
    for rel, sha in c['sealed'].items():
        if not (work / rel).is_file() or _sha(work / rel) != sha:
            raise ValueError(f'the sealed file {rel} changed: restore it (git checkout {st["head"]} -- {rel}). Nothing ran.')
    tracked = [x for x in _git(work, 'diff', '--name-only', st['head']).splitlines() if x.strip()]
    others = [f for f in tracked if f != c['program']]
    if others:
        raise ValueError(f"only {c['program']} may change; also changed: {', '.join(others[:10])}. Restore them "
                         f"(git checkout {st['head']} -- <file>). Nothing ran.")
    kept = tuple(c.get('keep', []))
    untracked = [x[3:].strip('"') for x in _git(work, 'status', '--porcelain', '--untracked-files=all').splitlines() if x.startswith('??')]
    untracked = [f for f in untracked if '__pycache__/' not in f and not f.endswith(('.pyc', '.pyo')) and not f.startswith(kept)]
    if untracked:
        raise ValueError(f"only {c['program']} may change; new files are not allowed: {', '.join(untracked[:10])}. Delete them "
                         f"(the program must stand alone). Nothing ran.")
    first = st['best'] is None
    if first and c['program'] in tracked:
        raise ValueError(f"the first run is the baseline: run it with {c['program']} unchanged "
                         f"(git checkout {st['head']} -- {c['program']}), then try your idea. Nothing ran.")
    if not first and c['program'] not in tracked:
        raise ValueError(f"{c['program']} is the same as the best (att-{st['best']['n']}): change it first. Nothing ran.")
    n = st['evals'] + 1
    desc = ' '.join((desc or ('baseline' if first else '')).split())[:200]
    if not desc:
        raise ValueError('say what this attempt tries: --desc "one line"')
    tag = f"{c['branch']}/att-{n}"
    if _git(work, 'tag', '--list', tag):
        raise ValueError(f'tag {tag} already exists while the state counts {st["evals"]} runs: the research state and the '
                         f'repository disagree; tell the lead')
    st['pending'] = {'n': n, 'by': name, 'desc': desc, 'ts': time.time()}
    _save(room, 'state.json', st)                         # from here a cut-off run is recorded as a crash at the next call
    try:
        _git(work, 'add', '--', c['program'])
        _git(work, 'commit', '--allow-empty', '--no-verify', '-q', '-m', f'att-{n}: {desc}', ident=name)
    except ValueError:
        st['pending'] = None                              # nothing was committed: no run, the worker's edit stays as it is
        _save(room, 'state.json', st)
        raise
    commit = _git(work, 'rev-parse', '--short=7', 'HEAD')
    st['pending'].update(commit=commit)
    _save(room, 'state.json', st)
    _git(work, 'tag', tag, ident=name)                    # every attempt stays recoverable, kept or not
    lines = _lines(_git(work, 'diff', '--shortstat', st['head'], 'HEAD', '--', c['program']))
    st['pending'].update(lines=lines)
    _save(room, 'state.json', st)
    held = _clean(work, c)                                # nothing untracked or ignored rides along: only the committed tree runs
    log, result = d / 'runs' / f'{n}.log', d / 'runs' / f'{n}.result'
    result.unlink(missing_ok=True)
    env = dict(os.environ, CHATROOM_RUN=str(n))
    env.pop('CHATROOM_RESULT', None)
    if c.get('metric_source') == 'file':
        env['CHATROOM_RESULT'] = str(result)
    room.append(name, f"🔬 att-{n} running ({c['budget_s']} s budget): {desc[:100]}", 'board')   # the run counts as activity: no lease lapses
    code, secs = _run(c['evaluate'], work, log, 2 * c['budget_s'], env)
    text = log.read_text(encoding='utf-8', errors='replace')
    pattern = rf"^\s*{re.escape(c['metric'])}\s*:\s*{NUMBER}\s*$"
    if c.get('metric_source') == 'file':
        source = result.read_text(encoding='utf-8', errors='replace') if result.is_file() else ''
        found = re.findall(pattern, source, re.MULTILINE)
        missing = f"no \"{c['metric']}: value\" in the result file"
    else:
        found = re.findall(pattern, text, re.MULTILINE)
        missing = f"no \"{c['metric']}:\" line"
    value = None
    if code == 0 and len(found) == 1:
        try:
            value = float(found[0])
            value = value if value == value and abs(value) != float('inf') else None
        except ValueError:
            value = None
    if code is None:
        status, why = 'crash', f"over {2 * c['budget_s']} s: killed"
    elif code != 0:
        status, why = 'crash', f'exit {code}'
    elif len(found) > 1:
        status, why = 'crash', f"{len(found)} \"{c['metric']}:\" lines: ambiguous (only the evaluator may print it, once)"
    elif value is None:
        status, why = 'crash', missing if not found else 'the metric is not a finite number'
    else:
        best = st['best']
        better = first or (value < best['metric'] if c['direction'] == 'min' else value > best['metric'])
        status, why = ('keep', 'baseline' if first else f"better than att-{best['n']} ({best['metric']:.6g})") if better \
            else ('discard', f"not better than att-{best['n']} ({best['metric']:.6g})")
    if status == 'keep':
        st['best'] = {'n': n, 'commit': commit, 'metric': value}
        st['head'] = _git(work, 'rev-parse', 'HEAD')
    else:
        _git(work, 'reset', '-q', '--hard', st['head'])       # back to the best: the attempt keeps its tag
    held = _clean(work, c) or held
    st['evals'], st['pending'] = n, None
    _save(room, 'state.json', st)
    _row(room, n, commit, value, status, secs, lines, name, desc)
    line = (f"🔬 att-{n} by {name}: {desc[:100]} · {c['metric']} = {'—' if value is None else f'{value:.6g}'} · {status.upper()} "
            f"({why}) · {lines} lines · {n}/{c['max_evals']} runs")
    room.append(name, line, 'board')
    tail = '\n'.join(text.strip().splitlines()[-30:]) if status == 'crash' else ''
    warn = f'\nwarning: some files could not be removed (a process still holds them?): {held[:300]}' if held else ''
    return line + (f'\nlog: {log}\nlast lines:\n{tail}' if tail else f'\nlog: {log}') + warn


def status(room):
    c, st = _load(room, 'contract.json'), _load(room, 'state.json')
    rows = (_dir(room) / 'results.tsv').read_text(encoding='utf-8').splitlines()[1:]
    counts = {k: sum(1 for r in rows if r.split('\t')[3] == k) for k in ('keep', 'discard', 'crash')}
    best = st['best']
    head = (f"research {c['tag']}: {c['program']} in {c['work']} · metric {c['metric']} ({c['direction']}, from "
            f"{'the result file' if c.get('metric_source') == 'file' else 'the output: a program could print a false one, prefer --result-file'}) · "
            f"{st['evals']}/{c['max_evals']} runs of {c['budget_s']} s · keep {counts['keep']}, discard {counts['discard']}, "
            f"crash {counts['crash']} · " + (f"best att-{best['n']} {best['metric']:.6g} ({best['commit']})" if best else 'no baseline yet')
            + (f" · att-{st['pending']['n']} in progress or cut off" if st.get('pending') else ''))
    return head + '\n' + TSV_HEAD.rstrip('\n') + '\n' + '\n'.join(rows[-12:])


def cmd(room, a):
    """chat.py research init|amend|evaluate|status"""
    act = a.pairs[0] if a.pairs else 'status'
    if act == 'init':
        if not (a.program and a.evaluate and a.metric):
            sys.exit('research init --program FILE --evaluate "CMD" --metric NAME [--direction min|max] [--budget-min 5] '
                     '[--max-evals 100] [--repo DIR] [--sealed a.py,b.py] [--tag NAME] [--result-file] [--keep data/] --as LEAD')
        line = init(room, a.name, a.program, a.evaluate, a.metric, a.direction or 'min',
                    5 if a.budget_min is None else a.budget_min, 100 if a.max_evals is None else a.max_evals,
                    a.repo or '.', [x.strip() for x in (a.sealed or '').split(',') if x.strip()], a.tag, bool(a.result_file),
                    [x.strip() for x in (getattr(a, 'keep', None) or '').split(',') if x.strip()])
        room.append(a.name, line, 'board')
        return print(line)
    if act == 'amend':
        line = amend(room, a.name, a.evaluate, a.budget_min, a.max_evals, a.result_file)
        room.append(a.name, line, 'board')
        return print(line)
    if act == 'evaluate':
        if not a.name:
            sys.exit('--as NAME required')
        return print(evaluate(room, a.name, a.desc))
    if act == 'status':
        return print(status(room))
    sys.exit('research: init | amend | evaluate --desc "what this attempt tries" | status')
