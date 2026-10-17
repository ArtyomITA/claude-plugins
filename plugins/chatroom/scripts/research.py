"""The research kernel of the chat room.

A research improves one file of a git repository against an evaluator nobody may touch. Agents propose; this kernel
decides and writes. Every change of the shared state goes through a command here, is checked, and is logged.

Phases: 0 contract (task.md, written with the user), 1 drafting (the evaluator and the program are written, smoke-run,
reviewed, then sealed), 2 investigation (ideas, attempts, evidence), 3 evidence (ablations, baselines, repeats on the
best), 4 final (the final evaluator, once, on the best), 5 report (written, audited), 6 closed. Each step forward is a
gate the kernel checks.

Roles (when the lead assigns them; without roles anyone may do anything, one worker at a time):
  PROPOSER  ideas only (research propose-idea), read-only on code
  WORKER    edits the program in its own worktree and runs research evaluate
  REGISTRAR curates evidence, sets the direction, writes conclusions
  AUDITOR   verdicts at the gates, revocations, the report check
  SEARCHER  literature and prior work as evidence with a link

Every attempt is committed with the kernel's identity and tagged research/<tag>/att-N, kept or not. One run at a time
holds the evaluation lock (one GPU): another is refused, not queued. A run cut off half way is recorded as a crash at
the next call and its evaluator process is stopped. Before each run every
untracked or ignored file is removed except the --keep folders, so only the committed program runs. With --repeats the
evaluator runs N times and the median counts; with --min-gain a change must beat the best by more than the noise.

Layout: ROOM/research/contract.json, state.json, log.jsonl (every change, run and refusal), results.tsv, runs/, findings-<worker>.md,
task.md, report.md, work/ (the main worktree, branch research/<tag>) and work-<worker>/ (one per worker). Standard
library only, like chat.py. Everything here runs as the user: the files are not protected from an agent that edits them
by hand; the seal is a check, not a wall."""
import hashlib
import json
import os
import re
import secrets
import statistics
import subprocess
import sys
import time
from pathlib import Path

TSV_HEAD = 'n\tcommit\tmetric\tstatus\tseconds\tlines\tby\tdescription\tkind\tidea\tspread\n'
NUMBER = r'([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)'
PHASES = ('contract', 'drafting', 'investigation', 'evidence', 'final', 'report', 'closed')
ROLES = ('PROPOSER', 'WORKER', 'REGISTRAR', 'AUDITOR', 'SEARCHER')
S_MAX = 5                 # attempts of one worker without any evidence proposed: then it proposes evidence or redirects
CRASH_MAX = 3             # crashes in a row of one worker: it pauses until the lead resumes it
CURATED_MAX = 60          # committed evidence kept at once (the registrar drops some to add more)
SIMILAR = 0.5             # an idea this close to an earlier one (word trigrams, Jaccard) is refused
VIEW_MAX = 3000           # characters of a role's view; research expand ID opens one record
AUX_KINDS = ('ablation', 'baseline', 'control', 'repeat')
KERNEL = (0, 10, 1)      # written into the state: an older kernel (another install, an MCP server not restarted) refuses it
AUX_BASE, SMOKE_BASE = 100000, 200000   # numbers of evidence and smoke runs: never the same as an attempt's (at most 100000)
NO_HOOKS = str(Path(__file__).resolve().parent / '.no-git-hooks')   # a folder that does not exist: git finds no hooks there
SECRET_ENV = ('OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN')


def _dir(room):
    return (room.dir / 'research').resolve()          # absolute: git commands run in other folders


def _git(cwd, *args, check=True, ident=None):
    """git with file names unquoted (modèle.py stays modèle.py), none of the repository's hooks (pre-commit, post-commit,
    post-checkout...) and, for the kernel's commits, an identity of its own and no signing"""
    pre = ['-c', 'core.quotepath=false', '-c', f'core.hooksPath={NO_HOOKS}', '-c', 'core.safecrlf=false']
    if args[:1] and args[0] in ('worktree', 'reset', 'checkout', 'submodule'):   # files written byte for byte: no CRLF from core.autocrlf
        pre += ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf']
    if ident:
        pre += ['-c', f'user.name={ident}', '-c', f'user.email={re.sub(r"[^A-Za-z0-9]", "", ident).lower() or "kernel"}@chatroom.invalid',
                '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false']
    try:
        r = subprocess.run(['git', *pre, *args], cwd=cwd, capture_output=True, stdin=subprocess.DEVNULL, timeout=600)
    except subprocess.TimeoutExpired:
        raise ValueError(f"git {' '.join(args)} ran over 600 s")
    out = (r.stdout + r.stderr).decode('utf-8', errors='replace').strip()
    if check and r.returncode != 0:
        raise ValueError(f"git {' '.join(args)} failed: {out[:400]}")
    return out


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _seal_holds(work, rel, want):
    """a sealed file is unchanged: its git blob id matches the one sealed (as on disk, or after the line-ending
    conversion git would apply); a 64-character seal is the SHA-256 of the bytes, from a contract before blob ids"""
    path = Path(work) / rel
    if not path.is_file():
        return False
    if len(want) == 64:
        data = path.read_bytes()
        lf = data.replace(b'\r\n', b'\n')
        return want in (hashlib.sha256(data).hexdigest(), hashlib.sha256(lf).hexdigest(),
                        hashlib.sha256(lf.replace(b'\n', b'\r\n')).hexdigest())
    return want in (_git(work, 'hash-object', '--no-filters', '--', rel, check=False),
                    _git(work, '-c', 'core.autocrlf=true', 'hash-object', '--', rel, check=False))


def _load(room, name):
    """a research file, read with the retries a file being replaced needs on Windows"""
    from chat import read_json
    path = _dir(room) / name
    if not path.is_file():
        raise ValueError('no research in this room: the lead starts it with chat.py research init')
    return read_json(path, {})


def _write(room, name, data):
    from chat import write_atomic
    write_atomic(_dir(room) / name, json.dumps(data, indent=1, ensure_ascii=False))


def _save(room, name, data):
    """a whole file written under the room's lock"""
    room.locked(lambda: _write(room, name, data))


def _log(room, by, action, detail, ok=True):
    """one line per change of the research, refused ones too: who, what, and why not"""
    line = json.dumps({'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'by': by, 'action': action, 'ok': ok, 'detail': detail},
                      ensure_ascii=False)
    with open(_dir(room) / 'log.jsonl', 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def _old_rows(c):
    """the attempts of a first-kernel research, from its results.tsv (n, commit, metric, status, seconds, lines, by, desc)"""
    path = Path(c['work']).parent / 'results.tsv'
    rows = []
    try:
        for line in path.read_text(encoding='utf-8').splitlines()[1:]:
            f = line.split('\t')
            if len(f) >= 8 and f[0].isdigit():
                rows.append({'n': int(f[0]), 'worker': '_main', 'commit': f[1], 'metric': float(f[2]) if f[2] else None,
                             'status': f[3], 'kind': 'attempt', 'idea': None, 'state': 'committed', 'parent_n': None,
                             'desc': f[7], 'lines': f[5], 'ts': 0})
    except (OSError, ValueError):
        pass
    return rows


def _migrate(c, st):
    """a state written by the first kernel (one worker, no phases) read as the current one, its runs and baseline included"""
    st.setdefault('phase', 2)
    st.setdefault('pending', None)
    if 'workers' not in st:
        st['workers'] = {'_main': {'work': c['work'], 'branch': c['branch'], 'head': st.get('head', c['base_commit']),
                                   'best': st.get('best'), 'since_evidence': 0, 'crashes': 0, 'paused': False,
                                   'programs': [], 'idea': None, 'type': 'explorer', 'parent': 'base'}}
        old = _old_rows(c)
        st.setdefault('attempts', old)
        first_keep = next((a for a in old if a['status'] == 'keep'), None)
        if first_keep and 'baseline' not in st:
            st['baseline'] = {'n': first_keep['n'], 'commit': first_keep['commit'], 'metric': first_keep['metric']}
    st.setdefault('best', None)
    if st['best'] is not None:
        st['best'].setdefault('worker', '_main')
    st.setdefault('baseline', st.get('best'))          # a first-kernel research with a best already has its baseline
    for key, default in (('ideas', []), ('evidence', []), ('history', []), ('gaps', []), ('verdicts', []),
                         ('attempts', []), ('assigns', []), ('conclusions', {}), ('direction', {}), ('aux', 0),
                         ('next_mode', 'gap'), ('final', None), ('seq', {'I': 0, 'E': 0}), ('protocol', None)):
        st.setdefault(key, default)
    return st


def _edit(room, fn):
    """read, change and write the research state under the room's lock: fn(contract, state) changes it in place and
    returns a value; nothing a long run computed overwrites what others wrote meanwhile"""
    def run():
        c = _load(room, 'contract.json')
        st = _migrate(c, _load(room, 'state.json'))
        if tuple(st.get('kernel') or (0,)) > KERNEL:
            raise ValueError(f"this research is run by kernel {'.'.join(map(str, st['kernel']))}, newer than this one "
                             f"({'.'.join(map(str, KERNEL))}, {Path(__file__).resolve()}): use the chat.py of the newer install "
                             f"(an MCP server keeps its version until the session restarts)")
        st['kernel'] = list(KERNEL)
        out = fn(c, st)
        _write(room, 'state.json', st)
        return out
    return room.locked(run)


def _check_kernel(room):
    """refuse before any git work when the state was written by a newer kernel"""
    try:
        k = tuple(_load(room, 'state.json').get('kernel') or (0,))
    except ValueError:
        return
    if k > KERNEL:
        raise ValueError(f"this research is run by kernel {'.'.join(map(str, k))}, newer than this one "
                         f"({'.'.join(map(str, KERNEL))}, {Path(__file__).resolve()}): use the chat.py of the newer install")


def _state(room):
    c = _load(room, 'contract.json')
    return c, _migrate(c, _load(room, 'state.json'))


def max_run_seconds(c):
    """the longest one evaluate call can take: the build, then every repeated measure at its limit, plus the git work"""
    build = (c.get('build_s') or 2 * c['budget_s']) if c.get('build') else 0
    return build + 2 * c['budget_s'] * max(1, int(c.get('repeats') or 1)) + 120


def _env(**extra):
    """the environment a build or an evaluator gets: the user's, without the keys of model providers and code hosts"""
    env = {k: v for k, v in os.environ.items() if k not in SECRET_ENV}
    env.pop('CHATROOM_RESULT', None)
    env.update({k: str(v) for k, v in extra.items()})
    return env


def _submodules(work):
    """a worktree gets the repository's submodules too (CUTLASS, third-party kernels...): '' or a warning"""
    if not (Path(work) / '.gitmodules').is_file():
        return ''
    out = _git(work, 'submodule', 'update', '--init', '--recursive', check=False)
    return '' if 'fatal' not in out.lower() and 'error' not in out.lower() else f' (submodules: {out[:200]})'


def parse_guards(text):
    """--guard prefill_tps:max:3%,vram_mb:min:200 -> [{name, direction, tol}]: a secondary number the evaluator prints
    ("NAME: value") on every measure; its median may not be worse than the baseline's by more than tol"""
    out = []
    for item in [x.strip() for x in (text or '').split(',') if x.strip()]:
        m = re.fullmatch(r'([A-Za-z0-9_.-]+):(min|max):(\d+(?:\.\d+)?%?)', item)
        if not m:
            raise ValueError(f'--guard {item!r}: NAME:min|max:TOL (min = lower is better; TOL a number or N%)')
        out.append({'name': m.group(1), 'direction': m.group(2), 'tol': m.group(3)})
    return out


def _guard_broken(g, value, base):
    """value is worse than base by more than the guard's tolerance"""
    tol = abs(base) * float(g['tol'][:-1]) / 100 if g['tol'].endswith('%') else float(g['tol'])
    return value > base + tol if g['direction'] == 'min' else value < base - tol


def _rel(top, f):
    p = Path(f)
    return (p if not p.is_absolute() else p.resolve().relative_to(top)).as_posix()


def _role_of(c, name):
    for role, names in c.get('roles', {}).items():
        if name in names:
            return role
    return None


def _need(room, c, name, *roles):
    """a command for these roles (and always for the lead and the user); without roles assigned in the room, anyone"""
    if name in room.user_names():
        return
    if not c.get('roles'):
        return
    have = _role_of(c, name)
    if have not in roles:
        raise ValueError(f"{name} is {have or 'not given a research role'}: this is for {' or '.join(roles)}")


def _not_worse(c, value, than):
    """value is at most the contract's minimal gain worse than than (a fix keeps a correction that costs nothing)"""
    gain = str(c.get('min_gain') or '0')
    margin = abs(than) * float(gain[:-1]) / 100 if gain.endswith('%') else float(gain)
    return value <= than + margin if c['direction'] == 'min' else value >= than - margin


def _better(c, value, than):
    """value beats than by more than the contract's minimal gain (absolute, or relative when it ends with %)"""
    if than is None:
        return True
    gain = str(c.get('min_gain') or '0')
    margin = abs(than) * float(gain[:-1]) / 100 if gain.endswith('%') else float(gain)
    return value < than - margin if c['direction'] == 'min' else value > than + margin


# ---------------------------------------------------------------------------------------------------------- contract
def init(room, by, program, evaluate, metric, direction='min', budget_min=5.0, max_evals=100, repo='.', sealed=(), tag=None,
         result_file=False, keep=(), draft=False, final=None, build=None, build_min=None, repeats=1, min_gain=None, guards=None):
    """the lead or the user writes the contract: which file changes, how it is built and evaluated, what is sealed, the
    budget, how noise is handled. --draft starts at phase 1 (the evaluator is still being written, sealed later)"""
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
    if not (1 <= int(repeats or 1) <= 50):
        raise ValueError('--repeats: how many times each run measures (the median counts), 1 to 50')
    if min_gain is not None and not re.fullmatch(r'\d+(\.\d+)?%?', str(min_gain)):
        raise ValueError('--min-gain: a number (absolute) or a percentage like 1.5%')
    if build_min is not None and not (0 < float(build_min) <= 1440):
        raise ValueError('--build-min: the minutes a build may take, more than 0 and at most 1440')
    guards = parse_guards(guards)
    task = _dir(room) / 'task.md'
    if not task.is_file() or not task.read_text(encoding='utf-8', errors='replace').strip():
        raise ValueError(f'write the contract first, with the user, in {task} (phase 0; chat.py guide research has the template)')
    top = Path(_git(repo, 'rev-parse', '--show-toplevel')).resolve()
    if _git(top, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError(f'{top} has uncommitted changes: commit or stash them first (the research starts from a clean commit)')
    rel_prog = _rel(top, program)
    if not (top / rel_prog).is_file() or not _git(top, 'ls-files', '--', rel_prog):
        raise ValueError(f'{rel_prog} is not a tracked file of {top}: the program must be one committed file (not a folder)')
    seals = {}
    for f in sealed:
        rel = _rel(top, f)
        if rel == rel_prog:
            raise ValueError(f'{rel} is the program: it cannot also be sealed')
        if not (top / rel).is_file():
            raise ValueError(f'{rel} is not a file: seal each file (a folder of data goes in --keep, or outside the repository)')
        if not _git(top, 'ls-files', '--', rel):
            raise ValueError(f'sealed file {rel} is not tracked in {top}: only committed files can be sealed (the research '
                             f'worktree holds only them). Commit it, or keep it outside the repository, read-only')
        seals[rel] = _git(top, 'rev-parse', f'HEAD:{rel}')
    if not draft and not evaluate:
        raise ValueError('--evaluate is needed (or --draft, to write the evaluator in phase 1 and seal it later)')
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
    subs = _submodules(work)
    try:                                                  # a room inside the project: out of the user's git status and git add
        inside = Path(room.dir).resolve().relative_to(top).as_posix()
        exclude = Path(_git(top, 'rev-parse', '--git-path', 'info/exclude'))
        exclude = exclude if exclude.is_absolute() else top / exclude
        if f'/{inside}/' not in (exclude.read_text(encoding='utf-8') if exclude.is_file() else ''):
            exclude.parent.mkdir(parents=True, exist_ok=True)
            with open(exclude, 'a', encoding='utf-8') as f:
                f.write(f'\n/{inside}/\n')
    except ValueError:
        pass
    base = _git(work, 'rev-parse', 'HEAD')
    contract = {'program': rel_prog, 'evaluate': evaluate or '', 'metric': metric, 'direction': direction,
                'budget_s': max(1, int(float(budget_min) * 60)), 'max_evals': int(max_evals), 'repo': str(top), 'work': str(work),
                'branch': branch, 'tag': tag, 'base_commit': base, 'sealed': seals, 'by': by,
                'metric_source': 'file' if result_file else 'output', 'keep': keep, 'final': final or '',
                'build': build or '', 'build_s': max(1, int(float(build_min) * 60)) if build_min else 0,
                'repeats': int(repeats or 1), 'min_gain': str(min_gain) if min_gain is not None else '', 'roles': {}, 'guards': guards,
                'task_sha': _sha(task), 'created': time.strftime('%Y-%m-%d %H:%M:%S')}
    _save(room, 'contract.json', contract)
    st = _migrate(contract, {'evals': 0, 'best': None, 'head': base, 'pending': None, 'phase': 1 if draft else 2})
    _save(room, 'state.json', st)
    (d / 'results.tsv').write_text(TSV_HEAD, encoding='utf-8')
    _log(room, by, 'init', {'program': rel_prog, 'phase': st['phase'], 'task_sha': contract['task_sha'], 'contract': contract})
    noise = (f", median of {contract['repeats']} measures" if contract['repeats'] > 1 else '') + \
            (f", a keep must beat the best by more than {contract['min_gain']}" if contract['min_gain'] else '') + \
            (f", guards {', '.join(g['name'] + ' ' + g['direction'] + ' ' + g['tol'] for g in guards)} (median vs baseline)" if guards else '')
    return (f"🔬 research {tag} open at phase {st['phase']} ({PHASES[st['phase']]}): only {rel_prog} changes, in {work} (branch "
            f"{branch}); " + (f"build `{build}`, " if build else '') + (f"evaluator `{evaluate}`, " if evaluate else 'evaluator to be written, ')
            + f"metric {metric} ({'lower' if direction == 'min' else 'higher'} is better) read from "
            f"{'the result file $CHATROOM_RESULT' if result_file else 'the output (exactly one line per measure)'}{noise}, "
            f"{contract['budget_s']} s per run, {max_evals} runs" + (f"; sealed: {', '.join(seals)}" if seals else '')
            + (f"; kept untouched (data): {', '.join(keep)}" if keep else '')
            + (f"; a build may take {contract['build_s'] or 2 * contract['budget_s']} s" if build else '')
            + ('; WARNING: the build output is removed before every run unless its folder is in --keep (a full rebuild each time)'
               if build and not keep else '') + subs
            + f"; one evaluate call can take up to {max_run_seconds(contract)} s"
            + ('. Phase 1: write and smoke-run the evaluator, then the lead seals it.' if draft else '. The first run is the baseline.'))


def amend(room, by, evaluate=None, budget_min=None, max_evals=None, result_file=None, build=None, build_min=None,
          repeats=None, min_gain=None, final=None, guards=None):
    """the lead changes the contract: budgets at any time; what is measured and how only before a baseline is kept (a
    crashed baseline is fixed this way, not by starting over)"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user changes the contract')
    c, st = _state(room)
    said = []
    measured = any(x is not None for x in (evaluate, result_file, build, repeats, min_gain, guards))
    if measured and st['best'] is not None:
        raise ValueError('how runs are measured cannot change after a baseline is kept: the runs would not compare')
    for key, value, label in (('evaluate', evaluate, 'evaluator'), ('build', build, 'build'), ('final', final, 'final evaluator')):
        if value is not None:
            c[key] = value
            said.append(f'{label} `{value}`')
    if result_file is not None:
        c['metric_source'] = 'file' if result_file else 'output'
        said.append(f"metric from {'the result file' if result_file else 'the output'}")
    if repeats is not None:
        if not (1 <= int(repeats) <= 50):
            raise ValueError('--repeats: 1 to 50')
        c['repeats'] = int(repeats)
        said.append(f'median of {repeats} measures')
    if guards is not None:
        c['guards'] = parse_guards(guards)
        said.append('guards ' + (', '.join(g['name'] for g in c['guards']) or 'none'))
    if min_gain is not None:
        if not re.fullmatch(r'\d+(\.\d+)?%?', str(min_gain)):
            raise ValueError('--min-gain: a number or a percentage like 1.5%')
        c['min_gain'] = str(min_gain)
        said.append(f'minimal gain {min_gain}')
    if budget_min is not None:
        if not (0 < float(budget_min) <= 1440):
            raise ValueError('--budget-min: more than 0 and at most 1440')
        c['budget_s'] = max(1, int(float(budget_min) * 60))
        said.append(f"{c['budget_s']} s per run")
    if build_min is not None:
        if not (0 < float(build_min) <= 1440):
            raise ValueError('--build-min: more than 0 and at most 1440')
        c['build_s'] = max(1, int(float(build_min) * 60))
        said.append(f"{c['build_s']} s per build")
    if max_evals is not None:
        if not (st['evals'] < int(max_evals) <= 100000):
            raise ValueError(f"--max-evals must be more than the {st['evals']} runs already made")
        c['max_evals'] = int(max_evals)
        said.append(f'{max_evals} runs in all')
    if not said:
        raise ValueError('research amend: --evaluate, --build, --final, --result-file/--no-result-file, --repeats, '
                         '--min-gain, --guard, --budget-min, --build-min or --max-evals')
    _save(room, 'contract.json', c)
    if measured:
        _edit(room, lambda c2, s2: s2.update(protocol=None))   # the next baseline (or smoke) records the protocol anew
    _log(room, by, 'amend', said)
    return f"🔬 research {c['tag']} contract changed by {by}: " + ', '.join(said)


def roles(room, by, pairs):
    """the lead names who plays which research role: PROPOSER=P WORKER=W1,W2 REGISTRAR=R AUDITOR=A SEARCHER=S1,S2"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user assigns research roles')
    c, _ = _state(room)
    out = dict(c.get('roles', {}))
    for pair in pairs:
        role, _, names = pair.partition('=')
        role = role.strip().upper()
        if role not in ROLES:
            raise ValueError(f'unknown role {role}: one of {", ".join(ROLES)}')
        out[role] = [n.strip() for n in names.split(',') if n.strip()]
    seen = {}
    for role, names in out.items():
        for n in names:
            if n in seen and seen[n] != role:
                raise ValueError(f'{n} cannot be both {seen[n]} and {role}')
            seen[n] = role
    c['roles'] = out
    _save(room, 'contract.json', c)
    _log(room, by, 'roles', out)
    return '🔬 research roles: ' + '; '.join(f"{r} {', '.join(n)}" for r, n in out.items() if n)


# ---------------------------------------------------------------------------------------------------------- worktrees
def _check_work(c, wk):
    """the worktree is there and is this worker's own (its top folder and branch), so no git command ever lands in the
    user's checkout"""
    work = Path(wk['work'])
    if not work.is_dir():
        raise ValueError(f'the research worktree is missing ({work}): the research cannot go on there. Tell the lead.')
    top = _git(work, 'rev-parse', '--show-toplevel', check=False)
    if not top or Path(top).resolve() != work.resolve():
        raise ValueError(f'{work} is not the research worktree any more (git sees {top or "nothing"}): stop and tell the lead.')
    branch = _git(work, 'rev-parse', '--abbrev-ref', 'HEAD', check=False)
    if branch != wk['branch']:
        raise ValueError(f"the research worktree is on {branch}, not on {wk['branch']}: switch back (git switch {wk['branch']}).")
    return work


def _clean(work, c):
    """remove every untracked or ignored file but the kept data folders; never stops a run: a file still held by a
    leftover process (Windows) is reported, not fatal"""
    args = ['clean', '-ffdxq'] + [x for k in c.get('keep', []) for x in ('-e', '/' + k)]
    out = _git(work, *args, check=False)
    if (Path(work) / '.gitmodules').is_file():         # nothing a run leaves inside a submodule reaches the next one
        sm = _git(work, 'submodule', 'foreach', '--quiet', '--recursive', 'git reset -q --hard && git clean -ffdxq', check=False)
        out += sm if 'failed to remove' in sm or 'fatal' in sm else ''
    return out if 'failed to remove' in out or 'error' in out.lower() else ''


def _commit_of(c, ref):
    """the commit of base, best (global), att-N, or a worker's best"""
    main = Path(c['work'])
    if ref in (None, '', 'base'):
        return c['base_commit']
    m = re.fullmatch(r'att-(\d+)', ref)
    if m:
        return _git(main, 'rev-list', '-n', '1', f"{c['branch']}/att-{m.group(1)}")
    return _git(main, 'rev-parse', ref)


def assign(room, by, worker, idea=None, parent='best', kind='explorer', force=False):
    """the lead starts a cycle for a worker: from which state (base, best, att-N) and as an explorer (a fresh agent, one new
    idea) or an optimizer (the same agent, a few refinements). Each worker gets its own worktree and branch; the lead
    chooses the parent, never the idea"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user assigns cycles')
    if kind not in ('explorer', 'optimizer'):
        raise ValueError('--type explorer or optimizer')
    _check_kernel(room)
    c, st = _state(room)
    if st['phase'] != 2:
        raise ValueError(f"cycles are assigned in the investigation (phase 2); now phase {st['phase']} ({PHASES[st['phase']]})")
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', worker or ''):
        raise ValueError('a worker name: letters, digits, - or _')
    if c.get('roles') and _role_of(c, worker) != 'WORKER':
        raise ValueError(f'{worker} is not a WORKER of this research (research roles WORKER=...)')
    if idea and not any(i['id'] == idea and i['status'] in ('accepted', 'tried') for i in st['ideas']):
        raise ValueError(f'no accepted idea {idea}')
    parent = parent or 'best'
    if parent == 'best':
        parent = f"att-{st['best']['n']}" if st['best'] else 'base'
    if parent != 'base':
        if not re.fullmatch(r'att-\d+', parent):
            raise ValueError('--parent base, best or att-N')
        pa = next((x for x in st['attempts'] if f"att-{x['n']}" == parent), None)
        if not pa or pa['state'] == 'revoked' or pa['status'] != 'keep' or pa['kind'] != 'attempt':
            raise ValueError(f'{parent} cannot be a parent: it must be a kept attempt, not revoked')
    if st.get('pending') and st['pending'].get('worker') in (worker, '_main'):
        if _run_alive(room):
            raise ValueError(f'{worker} has a run in progress: wait for it')
        _reconcile(room, c, st)                        # a run cut off half way: recorded as a crash first
        c, st = _state(room)
    family = 'base' if parent in ('base', f"att-{(st.get('baseline') or {}).get('n')}") else _family(st, int(parent[4:]))
    recent = [a['family'] for a in st['assigns'][-4:]]
    if not force and len(recent) == 4 and family != 'base' and len(set(recent + [family])) == 1:
        raise ValueError(f'the last four cycles all grew family {family}: start one from base (an explorer on a fresh idea), '
                         f'or --force')
    commit = _commit_of(c, parent)
    d = _dir(room)
    work = d / f'work-{worker}'
    branch = f"{c['branch']}-{worker.lower()}"
    fresh = not work.exists()
    if not fresh:
        _check_work(c, {'work': str(work), 'branch': branch})
        _git(work, 'reset', '-q', '--hard', commit)
        _clean(work, c)
    else:
        _git(Path(c['repo']), 'worktree', 'add', '-B', branch, str(work), commit)
    subs = _submodules(work)

    def apply(c, st):
        old = st['workers'].get(worker, {})
        best = st.get('baseline')                          # from base, a line competes with the baseline
        if parent != 'base':
            n = int(parent[4:])
            a = next((x for x in st['attempts'] if x['n'] == n), None)
            if a and a.get('metric') is not None and a['state'] != 'revoked':
                best = {'n': n, 'commit': a['commit'], 'metric': a['metric']}
        st['workers'][worker] = {'work': str(work), 'branch': branch, 'head': commit, 'best': best,
                                 'since_evidence': 0, 'crashes': old.get('crashes', 0), 'paused': old.get('paused', False),
                                 'programs': old.get('programs', []),
                                 'deleted': old.get('deleted', []), 'idea': idea, 'type': kind, 'parent': parent}
        st['assigns'].append({'worker': worker, 'parent': parent, 'family': family, 'type': kind, 'idea': idea,
                              'ts': time.time()})
        if idea:
            for i in st['ideas']:
                if i['id'] == idea:
                    i['status'] = 'tried'
    _edit(room, apply)
    _log(room, by, 'assign', {'worker': worker, 'parent': parent, 'type': kind, 'idea': idea})
    keep = c.get('keep') or []
    old = st['workers'].get(worker, {})
    return (f"🔬 cycle for {worker}: {kind} from {parent}" + (f" on idea {idea}" if idea else '') + f", worktree {work}" + subs
            + (f"; its own copies of {', '.join(keep)} (data, build) start empty: fill or link them before the first run"
               if keep and fresh else '')
            + (f"; {old.get('crashes')} crashes in a row so far" if old.get('crashes') else '')
            + ('; still PAUSED: research resume ' + worker if old.get('paused') else ''))


def _family(st, n):
    """the first kept attempt after the baseline in the line an attempt grew from: the family of its approach (lines that
    start from base are families of their own)"""
    seen = set()
    root = (st.get('baseline') or {}).get('n')
    a = next((x for x in st['attempts'] if x['n'] == n), None)
    while a and a.get('parent_n') and a['parent_n'] != root and a['parent_n'] not in seen:
        seen.add(a['parent_n'])
        nxt = next((x for x in st['attempts'] if x['n'] == a['parent_n']), None)
        if not nxt:
            break
        a = nxt
    return f"att-{a['n']}" if a else f'att-{n}'


def _worker(st, name):
    """the worktree record of a worker: its own, or the main one when the research has a single worker"""
    if name in st['workers']:
        return name, st['workers'][name]
    if list(st['workers']) == ['_main']:
        return '_main', st['workers']['_main']
    raise ValueError(f'{name} has no worktree: the lead starts its cycle with research assign {name}')


# ---------------------------------------------------------------------------------------------------------- running
def _kill_tree(pid):
    """end a process and everything it started"""
    if os.name == 'nt':
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)], capture_output=True, stdin=subprocess.DEVNULL)
    else:
        import signal
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


def _run(cmd, cwd, log, limit, env, mode='wb', on_start=None):
    """run a command with its output in a file (never in anyone's context); kill the whole tree past the limit. on_start
    gets the process id, recorded so that a run whose caller was killed can still be stopped"""
    start = time.time()
    with open(log, mode) as out:
        kw = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
        p = subprocess.Popen(cmd, shell=True, cwd=cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=env, **kw)
        if on_start:
            on_start(p.pid)
        try:
            code = p.wait(timeout=limit)
        except subprocess.TimeoutExpired:
            _kill_tree(p.pid)
            p.wait()
            code = None
    return code, time.time() - start


def _run_alive(room):
    """a live evaluation holds eval.lock with a live owner, within the longest a run can take"""
    from chat import lock_owner_alive
    lock = _dir(room) / 'eval.lock'
    try:
        age = time.time() - float((lock.read_text(errors='replace').split() + ['0', '0'])[1])
        return lock_owner_alive(lock) and age < max_run_seconds(_load(room, 'contract.json')) + 300
    except (OSError, ValueError, KeyError):
        return False


def _lines(stat):
    add = re.search(r'(\d+) insertion', stat or '')
    rem = re.search(r'(\d+) deletion', stat or '')
    return f"+{add.group(1) if add else 0} -{rem.group(1) if rem else 0}"


def _row(room, n, commit, value, status, secs, lines, name, desc, kind='attempt', idea='', spread=''):
    with open(_dir(room) / 'results.tsv', 'a', encoding='utf-8') as f:
        f.write('\t'.join([str(n), commit, '' if value is None else f'{value:.6g}', status, f'{secs:.0f}', lines, name,
                           ' '.join(desc.split()), kind, idea or '', spread]) + '\n')


def _measure(c, work, d, n, env, log, on_start=None):
    """build once (its own limit), then evaluate --repeats times; the median counts. Returns (value, why, secs, spread,
    protocol lines, all output)"""
    secs, text = 0.0, ''
    if c.get('build'):
        code, s = _run(c['build'], work, log, c.get('build_s') or 2 * c['budget_s'], env, on_start=on_start)
        secs += s
        text = log.read_text(encoding='utf-8', errors='replace')
        if code != 0:
            return None, (f"build over {c.get('build_s') or 2 * c['budget_s']} s: killed" if code is None else f'build exit {code}'), \
                secs, '', [], text
    values, protocol, gvals = [], [], {g['name']: [] for g in c.get('guards', [])}
    pattern = rf"^\s*{re.escape(c['metric'])}\s*:\s*{NUMBER}\s*$"
    for k in range(c.get('repeats', 1)):
        result = d / 'runs' / f'{n}.result'
        result.unlink(missing_ok=True)
        run_env = dict(env, CHATROOM_REPEAT=str(k + 1))
        if c.get('metric_source') == 'file':
            run_env['CHATROOM_RESULT'] = str(result)
        start = len(text)
        code, s = _run(c['evaluate'], work, log, 2 * c['budget_s'], run_env, mode='ab' if (c.get('build') or k) else 'wb',
                       on_start=on_start)
        secs += s
        text = log.read_text(encoding='utf-8', errors='replace')
        out = text[start:] if len(text) >= start else text
        for line in re.findall(r'^\s*protocol\s*:\s*(.+?)\s*$', out, re.MULTILINE | re.IGNORECASE):
            if line not in protocol:                          # the same protocol in every repeat counts once
                protocol.append(line)
        if code is None:
            return None, f"over {2 * c['budget_s']} s: killed", secs, '', protocol, text
        if code != 0:
            return None, f'exit {code}', secs, '', protocol, text
        source = (result.read_text(encoding='utf-8', errors='replace') if result.is_file() else '') if c.get('metric_source') == 'file' else out
        found = re.findall(pattern, source, re.MULTILINE)
        if len(found) > 1:
            return None, f"{len(found)} \"{c['metric']}:\" lines: ambiguous (only the evaluator may print it, once)", secs, '', protocol, text
        if not found:
            return None, (f"no \"{c['metric']}: value\" in the result file" if c.get('metric_source') == 'file'
                          else f"no \"{c['metric']}:\" line"), secs, '', protocol, text
        v = float(found[0])
        if v != v or abs(v) == float('inf'):
            return None, 'the metric is not a finite number', secs, '', protocol, text
        values.append(v)
        for g in gvals:
            got = re.findall(rf"^\s*{re.escape(g)}\s*:\s*{NUMBER}\s*$", source, re.MULTILINE)
            if len(got) != 1:
                return None, f'guard {g}: {len(got)} "{g}:" lines (exactly one per measure)', secs, '', protocol, text
            gvals[g].append(float(got[0]))
    value = statistics.median(values)
    spread = f'{min(values):.6g}..{max(values):.6g}' if len(values) > 1 else ''
    c['_guards'] = {g: statistics.median(v) for g, v in gvals.items()}   # read by the caller right after
    return value, '', secs, spread, protocol, text


def _diff_kinds(work, parent, head, program):
    """what an attempt's change is made of: lines added that the line had deleted before (cycling), and whether it only
    changed numbers (tuning)"""
    diff = _git(work, 'diff', '-U0', parent, head, '--', program, check=False)
    added = [l[1:] for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++')]
    removed = [l[1:] for l in diff.splitlines() if l.startswith('-') and not l.startswith('---')]
    num = lambda x: re.sub(r'\d+(\.\d+)?([eE][-+]?\d+)?', '#', x.strip())
    tuning = bool(added) and sorted(map(num, added)) == sorted(map(num, removed))
    return added, removed, tuning


def evaluate(room, name, desc, idea=None, kind='attempt', of=None, seed=None):
    """one run: seal and scope checks, commit, build, measure, keep or reset; the result goes to results.tsv and to the
    chat. kind=attempt (phase 2) competes for the best; ablation, baseline, control, repeat (phase 3) only measure;
    smoke (phase 1) checks the evaluator runs"""
    c, st = _state(room)
    if kind not in ('attempt', 'fix', 'smoke', *AUX_KINDS):
        raise ValueError(f'--kind attempt, fix, smoke, {", ".join(AUX_KINDS)}')
    _need(room, c, name, 'WORKER')
    held = _gpu_hold(room)
    if held and held['by'] != name:
        raise ValueError(f"the GPU is held by {held['by']} ({held['reason']}) until {time.strftime('%H:%M', time.localtime(held['until']))}"
                         f"{' or its build ends' if held.get('pid') else ''}: try again then (research status shows it)")
    return _locked(room, c, name, lambda: _evaluate(room, name, desc, idea, kind, of, seed))


def _locked(room, c, name, fn):
    """fn under eval.lock: one run at a time on the evaluator (the GPU); a lock whose owner died is broken, its
    evaluator stopped"""
    lock = _dir(room) / 'eval.lock'
    mine = f'{os.getpid()} {time.time():.0f} {name} {secrets.token_hex(4)}'
    budget = max_run_seconds(c)
    for _ in range(3):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, mine.encode())
            os.close(fd)
            break
        except FileExistsError:
            from chat import pid_alive
            try:
                seen = lock.read_text(errors='replace')   # one reading: the decision and the comparison below use it
            except OSError:
                continue
            pid, ts, who = (seen.split() + ['0', '0', '?'])[:3]
            try:
                age, alive = time.time() - float(ts), pid_alive(int(pid))
            except ValueError:
                age, alive = 0, True
            if alive and age < budget + 300:
                raise ValueError(f'another evaluation is running (by {who}, {age:.0f} s ago; lock {lock}): one run at a time on '
                                 f'the evaluator; try again when it ends (research status shows it)')
            tomb = lock.with_name(f'eval.lock.dead.{secrets.token_hex(4)}')
            try:
                os.rename(lock, tomb)                 # its owner is dead, or it ran far over any run's limit: one taker only
                same = tomb.read_text(errors='replace') == seen
            except OSError:
                continue
            if not same:                              # another caller broke it first and took a fresh lock: give it back
                try:
                    os.rename(tomb, lock)
                except OSError:
                    pass
                continue
            try:
                tomb.unlink()
            except OSError:
                pass
            _stop_child(room)                         # the owner is gone: its evaluator must not keep the GPU
    else:
        raise ValueError(f'could not take the evaluation lock {lock}: try again')
    try:
        return fn()
    finally:
        try:
            if lock.read_text(errors='replace') == mine:
                lock.unlink()
        except OSError:
            pass


def _stop_child(room):
    """a run whose caller was killed leaves its build or evaluator running: stop it before anything else uses the GPU"""
    try:
        st = _load(room, 'state.json')
    except ValueError:
        return
    from chat import pid_alive
    try:
        limit = max_run_seconds(_load(room, 'contract.json')) + 300
    except (ValueError, KeyError):
        return
    pend = st.get('pending') or {}
    # shortcut: a pid is trusted only within one run's limit of its start (no process start time check), enough
    # against a pid reused hours later; a pid reused within minutes would still be hit
    fc = st.get('final_child')
    fc = fc if isinstance(fc, (list, tuple)) and len(fc) == 2 else (None, None)
    for pid, ts in ((pend.get('child'), pend.get('child_ts')), fc):
        if pid and ts and time.time() - float(ts) < limit and pid_alive(int(pid)):
            _kill_tree(int(pid))


def _reconcile(room, c, st):
    """a run cut off half way (pending in the state). Committed: a crash, and the worker's program back to its best. Not
    committed: nothing ran, nothing is counted, the worker's edit stays"""
    p = st['pending']
    _stop_child(room)
    key, wk = _worker(st, p.get('worker') or '_main')
    try:
        work = _check_work(c, wk)
    except ValueError as exc:                             # its worktree is gone or moved: record the crash, touch nothing
        def lost(c2, s2):
            if p.get('kind', 'attempt') == 'attempt':
                s2['evals'] = max(s2['evals'], p['n'])
            else:
                s2['aux'] += 1
            s2['attempts'].append({'n': p['n'], 'worker': key, 'commit': p.get('commit') or '', 'metric': None, 'status': 'crash',
                                   'kind': p.get('kind', 'attempt'), 'idea': p.get('idea'), 'state': 'committed', 'parent_n': None,
                                   'desc': 'INTERRUPTED (worktree lost): ' + p.get('desc', ''), 'ts': time.time()})
            s2['pending'] = None
        _edit(room, lost)
        _row(room, p['n'], p.get('commit') or '', None, 'crash', 0, '', p.get('by', '?'), 'INTERRUPTED (worktree lost): ' + p.get('desc', ''),
             p.get('kind', 'attempt'), p.get('idea') or '')
        line = f"🔬 att-{p['n']} by {p.get('by', '?')} was interrupted and its worktree is not usable ({exc}): recorded as CRASH; the lead re-assigns {key}"
        room.append(p.get('by', 'LEAD'), line, 'board')
        return line
    head = _git(work, 'rev-parse', 'HEAD', check=False)
    committed = bool(p.get('commit')) or (head and head != wk['head']
                                          and _git(work, 'log', '-1', '--format=%s', check=False).startswith(f"att-{p['n']}:"))
    if not committed:
        _edit(room, lambda c2, s2: s2.update(pending=None))
        return None
    commit = p.get('commit') or _git(work, 'rev-parse', '--short=7', 'HEAD')
    tag = f"{c['branch']}/att-{p['n']}"
    if not _git(work, 'tag', '--list', tag):
        _git(work, 'tag', tag, commit, ident=p.get('by', 'LEAD'), check=False)
    _git(work, 'reset', '-q', '--hard', wk['head'])
    _clean(work, c)

    def apply(c2, s2):
        if p.get('kind', 'attempt') == 'attempt':
            s2['evals'] = max(s2['evals'], p['n'])
        else:
            s2['aux'] += 1                                # smoke and evidence runs: the next number moves on
        s2['attempts'].append({'n': p['n'], 'worker': key, 'commit': commit, 'metric': None, 'status': 'crash', 'kind': p.get('kind', 'attempt'),
                               'idea': p.get('idea'), 'state': 'committed', 'parent_n': (s2['workers'][key].get('best') or {}).get('n'),
                               'desc': 'INTERRUPTED: ' + p.get('desc', ''), 'ts': time.time()})
        s2['pending'] = None
    _edit(room, apply)
    _row(room, p['n'], commit, None, 'crash', 0, p.get('lines', ''), p.get('by', '?'), 'INTERRUPTED: ' + p.get('desc', ''),
         p.get('kind', 'attempt'), p.get('idea') or '')
    has_tag = bool(_git(work, 'tag', '--list', tag))
    what = 'the drafted files' if p.get('kind') == 'smoke' else c['program']
    line = (f"🔬 att-{p['n']} by {p.get('by', '?')} was interrupted half way (the call ended before the result): recorded as "
            f"CRASH, {what} back to the last good state" + (f"; its code stays in tag {tag}" if has_tag else f"; its code is in commit {commit}")
            + (f" (git checkout {tag} -- . brings the drafted files back)" if p.get('kind') == 'smoke' else ''))
    room.append(p.get('by', 'LEAD'), line, 'board')
    return line


def _evaluate(room, name, desc, idea, kind, of, seed):
    d = _dir(room)
    c, st = _state(room)
    fix = kind == 'fix'                                   # an attempt kept at equal metric: a correction, not a gain
    kind = 'attempt' if fix else kind
    if st.get('pending'):
        mine = st['pending'].get('worker') in (name, '_main') or (st['pending'].get('worker') not in st['workers'])
        line = _reconcile(room, c, st)
        if line and mine:
            raise ValueError(line + '. Edit the program again (git checkout <that tag> -- <program> brings it back) and evaluate.')
        c, st = _state(room)                             # another worker's cut-off run: recorded, and this run goes on
    phase = st['phase']
    if kind == 'attempt' and phase != 2:
        raise ValueError(f"attempts run in the investigation (phase 2); now phase {phase} ({PHASES[phase]})"
                         + ('; in phase 1 use --kind smoke' if phase == 1 else '; in phase 3 use --kind ablation|baseline|control|repeat' if phase == 3 else ''))
    if kind in AUX_KINDS and phase != 3:
        raise ValueError(f'{kind} runs belong to the evidence phase (3); now phase {phase} ({PHASES[phase]})')
    if kind == 'smoke' and phase != 1:
        raise ValueError('smoke runs belong to the drafting phase (1)')
    if not c.get('evaluate'):
        raise ValueError('the contract has no evaluator yet: the lead sets it with research amend --evaluate')
    key, wk = _worker(st, name)
    work = _check_work(c, wk)
    if not (work / c['program']).is_file():
        raise ValueError(f"{c['program']} is missing from {work}: restore it (git checkout {wk['head']} -- {c['program']}). Nothing ran.")
    if kind == 'attempt' and seed is not None:
        raise ValueError('attempts use the evaluator\'s own seed; --seed is for repeats, ablations and baselines (phase 3)')
    if kind == 'attempt':
        if st['evals'] >= c['max_evals']:
            raise ValueError(f"the budget of {c['max_evals']} runs is used up: the research is over, tell the lead")
        if wk.get('paused'):
            raise ValueError(f'{name} is paused after {CRASH_MAX} crashes in a row: the lead looks at the logs and resumes it '
                             f'(research resume {name})')
        if fix and not wk.get('fix_ok'):
            raise ValueError('a fix run needs the AUDITOR (or the lead) to allow it first: research allow-fix '
                             f'{name} --reason "what it corrects" (a fix is kept at equal metric, so it must be a real correction)')
        if fix and not wk.get('best'):
            raise ValueError('a fix corrects a kept state: your line has no keep yet')
        if wk.get('since_evidence', 0) >= S_MAX and c.get('roles'):
            raise ValueError(f'{S_MAX} attempts without any evidence proposed: propose what you learned (research '
                             f'propose-evidence --source att-N) or ask the lead for a redirect, then run again')
    if phase >= 2:
        for rel, sha in c['sealed'].items():
            if not _seal_holds(work, rel, sha):
                raise ValueError(f'the sealed file {rel} changed: restore it (git checkout {wk["head"]} -- {rel}). Nothing ran.')
    tracked = [x for x in _git(work, 'diff', '--name-only', wk['head']).splitlines() if x.strip()]
    if phase >= 2:
        others = [f for f in tracked if f != c['program']]
        if others:
            raise ValueError(f"only {c['program']} may change; also changed: {', '.join(others[:10])}. Restore them "
                             f"(git checkout {wk['head']} -- <file>). Nothing ran.")
    kept = tuple(c.get('keep', []))
    untracked = [x[3:].strip('"') for x in _git(work, 'status', '--porcelain', '--untracked-files=all').splitlines() if x.startswith('??')]
    untracked = [f for f in untracked if '__pycache__/' not in f and not f.endswith(('.pyc', '.pyo')) and not f.startswith(kept)]
    if untracked and phase >= 2:
        raise ValueError(f"only {c['program']} may change; new files are not allowed: {', '.join(untracked[:10])}. Delete them "
                         f"(the program must stand alone). Nothing ran.")
    first = st.get('baseline') is None and kind == 'attempt'
    if kind == 'attempt':
        if first and c['program'] in tracked:
            raise ValueError(f"the first run is the baseline: run it with {c['program']} unchanged "
                             f"(git checkout {wk['head']} -- {c['program']}), then try your idea. Nothing ran.")
        if not first and c['program'] not in tracked and wk.get('best'):
            raise ValueError(f"{c['program']} is the same as your best (att-{wk['best']['n']}): change it first. Nothing ran.")
        program_sha = _sha(work / c['program'])
        seen = next((p for p in wk.get('programs', []) if p['sha'] == program_sha), None)
        if seen and not first:
            raise ValueError(f"this exact program already ran as att-{seen['n']}: change it. Nothing ran.")
    if kind in AUX_KINDS:
        if not of or not any(f"att-{a['n']}" == of and a['state'] != 'revoked' for a in st['attempts']):
            raise ValueError(f'a {kind} run says what it measures against: --of att-N, an attempt that exists (usually the best)')
    idea = idea or wk.get('idea')
    if idea and not any(i['id'] == idea for i in st['ideas']):
        raise ValueError(f'no idea {idea}')
    desc = ' '.join((desc or ('baseline' if first else '')).split())[:200]
    if not desc:
        raise ValueError('say what this run tries: --desc "one line"')
    n = (st['evals'] + 1) if kind == 'attempt' else (AUX_BASE + st['aux'] + 1) if kind in AUX_KINDS else (SMOKE_BASE + st['aux'] + 1)
    tag = f"{c['branch']}/att-{n}"
    if _git(work, 'tag', '--list', tag):
        raise ValueError(f'tag {tag} already exists while the state counts otherwise: the research state and the repository '
                         f'disagree; tell the lead')
    pending = {'n': n, 'by': name, 'worker': key, 'desc': desc, 'ts': time.time(), 'kind': kind, 'idea': idea}
    _edit(room, lambda c2, s2: s2.update(pending=pending))  # from here a cut-off run is a crash at the next call
    try:
        if phase == 1:                                    # the drafted files, never the kept data or build folders
            _git(work, 'add', '-A', '--', '.', *[f':(exclude){k}' for k in c.get('keep', [])])
        else:
            _git(work, 'add', '--', c['program'])
        _git(work, 'commit', '--allow-empty', '--no-verify', '-q', '-m', f'att-{n}: [{kind}] {desc}', ident=name)
    except ValueError:
        _edit(room, lambda c2, s2: s2.update(pending=None))
        raise
    commit = _git(work, 'rev-parse', '--short=7', 'HEAD')
    head_full = _git(work, 'rev-parse', 'HEAD')
    pending['commit'] = commit
    _edit(room, lambda c2, s2: s2.update(pending=dict(pending)))
    _git(work, 'tag', tag, ident=name)
    lines = _lines(_git(work, 'diff', '--shortstat', wk['head'], 'HEAD', '--', c['program']))
    added, removed, tuning = _diff_kinds(work, wk['head'], 'HEAD', c['program'])
    pending['lines'] = lines
    _edit(room, lambda c2, s2: s2.update(pending=dict(pending)))
    held = _clean(work, c)
    log = d / 'runs' / f'{n}.log'
    env = _env(CHATROOM_RUN=n, CHATROOM_KIND=kind, **({'CHATROOM_SEED': seed} if seed is not None else {}),
               **({'CHATROOM_BASELINE': 1} if first else {}))

    def started(pid):                                     # recorded: a caller killed now leaves a process the kernel can stop
        pending['child'], pending['child_ts'] = pid, time.time()
        _edit(room, lambda c2, s2: s2.update(pending=dict(pending)))
    room.append(name, f"🔬 att-{n} [{kind}] running ({c['budget_s']} s budget" + (f" x{c['repeats']}" if c.get('repeats', 1) > 1 else '')
                + f"): {desc[:100]}", 'board')
    value, why, secs, spread, protocol, text = _measure(c, work, d, n, env, log, started)
    guards = c.pop('_guards', {}) if value is not None else {}
    base_g = (st.get('baseline') or {}).get('guards') or {}
    if value is not None and kind == 'attempt' and not first:
        for g in c.get('guards', []):
            if g['name'] in base_g and _guard_broken(g, guards[g['name']], base_g[g['name']]):
                value, why = None, (f"guard {g['name']} = {guards[g['name']]:.6g} (median), worse than the baseline's "
                                    f"{base_g[g['name']]:.6g} by more than {g['tol']}")
                break
    proto = ' | '.join(protocol)
    if value is not None and kind == 'attempt' and st.get('protocol') is not None and proto != st['protocol']:
        value, why = None, f"the evaluation protocol changed (protocol: {proto[:120]} instead of {st['protocol'][:120]})"
    if value is None:
        status = 'crash'
    elif kind == 'smoke':
        status, why = 'smoke', 'the evaluator runs and reports the metric'
    elif kind in AUX_KINDS:
        status, why = kind, f'measured against {of}'
    else:
        best = wk.get('best') or st.get('baseline')     # a line without a keep yet competes with the baseline
        if fix and best:
            if _not_worse(c, value, best['metric']):
                status, why = 'keep', f"fix: not worse than att-{best['n']} ({best['metric']:.6g})" + \
                    (f" within {c['min_gain']}" if c.get('min_gain') else '')
            else:
                status, why = 'discard', f"fix: worse than att-{best['n']} ({best['metric']:.6g})" + \
                    (f" by more than {c['min_gain']}" if c.get('min_gain') else '')
        elif first or _better(c, value, best['metric'] if best else None):
            status = 'keep'
            why = 'baseline' if first else (f"better than att-{best['n']} ({best['metric']:.6g})" if best else 'first of this line')
        else:
            status, why = 'discard', f"not better than att-{best['n']} ({best['metric']:.6g})" + \
                (f" by more than {c['min_gain']}" if c.get('min_gain') else '')
    if status != 'keep' or kind != 'attempt':
        if kind != 'smoke':
            _git(work, 'reset', '-q', '--hard', wk['head'])   # back to the best: the attempt keeps its tag
    held = _clean(work, c) or held
    readded = 0

    def apply(c2, s2):
        nonlocal readded
        w = s2['workers'][key]
        deleted = set(w.get('deleted', []))
        readded = sum(1 for l in added if l.strip() and l in deleted)
        w['deleted'] = list((deleted | {l for l in removed if l.strip()}))[-2000:]
        rec = {'n': n, 'worker': key, 'commit': commit, 'metric': value, 'status': status, 'kind': kind, 'idea': idea,
               'state': 'committed', 'parent_n': (w.get('best') or {}).get('n'), 'desc': desc, 'lines': lines,
               'added': len(added), 'readded': readded, 'tuning': tuning, 'spread': spread, 'of': of, 'seed': seed,
               'guards': guards, 'fix': fix, 'ts': time.time()}
        s2['attempts'].append(rec)
        if kind == 'attempt':
            s2['evals'] = n
            w['programs'] = (w.get('programs', []) + [{'n': n, 'sha': program_sha}])[-500:]
            w['since_evidence'] = w.get('since_evidence', 0) + 1
            w['crashes'] = w.get('crashes', 0) + 1 if status == 'crash' else 0
            if w['crashes'] >= CRASH_MAX:
                w['paused'] = True
            if fix:
                w['fix_ok'] = None                         # one allowed fix, one run
            was_global = bool(s2['best'] and w.get('best') and s2['best']['n'] == w['best']['n'])
            if status == 'keep':
                w['best'] = {'n': n, 'commit': commit, 'metric': value}
                w['head'] = head_full
                if fix and was_global:                     # the corrected code replaces the best it corrects
                    s2['best'] = {'n': n, 'worker': key, 'commit': commit, 'metric': value}
                if first:
                    s2['baseline'] = {'n': n, 'commit': commit, 'metric': value, 'guards': guards}
                    s2['protocol'] = proto
                if _better(c2, value, (s2['best'] or {}).get('metric')) or s2['best'] is None:
                    s2['best'] = {'n': n, 'worker': key, 'commit': commit, 'metric': value}
        elif kind == 'smoke':
            s2['aux'] += 1
            w['head'] = head_full                          # drafting moves forward: the next smoke starts from here
            if value is not None:
                s2['smoke_ok'] = n
                s2['protocol'] = proto
        else:
            s2['aux'] += 1
        s2['pending'] = None
    _edit(room, apply)
    _row(room, n, commit, value, status, secs, lines, name, desc + (f' (seed {seed})' if seed is not None else ''), kind, idea or '', spread)
    _log(room, name, 'run', {'n': n, 'kind': kind, 'status': status, 'metric': value, 'why': why, 'commit': commit, 'idea': idea,
                             'of': of, 'seed': seed, 'spread': spread})
    with open(d / f'findings-{key}.md', 'a', encoding='utf-8') as f:     # the line's own log: facts only, no advice
        f.write(f"- att-{n} [{kind}] {desc} | {c['metric']} = {'—' if value is None else f'{value:.6g}'} | {status}"
                + (f' ({why})' if status in ('crash', 'discard') else '') + '\n')
    flags = (' · only numbers changed (tuning)' if tuning and kind == 'attempt' else '') + \
            (f' · {readded} line(s) put back that this line had deleted' if readded else '')
    line = (f"🔬 att-{n} [{kind}] by {name}: {desc[:100]} · {c['metric']} = {'—' if value is None else f'{value:.6g}'}"
            + (f' ({spread})' if spread else '') + f" · {status.upper()} ({why}) · {lines} lines" + flags
            + (f" · {n}/{c['max_evals']} runs" if kind == 'attempt' else ''))
    room.append(name, line, 'board')
    tail = '\n'.join(text.strip().splitlines()[-30:]) if status == 'crash' else ''
    warn = f'\nwarning: some files could not be removed (a process still holds them?): {held[:300]}' if held else ''
    c3, s3 = _state(room)
    nudge = ''
    if kind == 'attempt' and s3['workers'][key].get('paused'):
        nudge = f'\n{name} is now paused after {CRASH_MAX} crashes in a row: the lead resumes it after a look at the logs.'
    return line + (f'\nlog: {log}\nlast lines:\n{tail}' if tail else f'\nlog: {log}') + warn + nudge


def resume(room, by, worker):
    if by not in room.user_names():
        raise ValueError('only the lead or the user resumes a paused worker')
    key = _edit(room, lambda c, st: (_worker(st, worker)[1].update(paused=False, crashes=0, since_evidence=0), _worker(st, worker)[0])[1])
    _log(room, by, 'resume', worker)
    return f'🔬 {worker} resumed by {by}'


def reanchor(room, by, data):
    """a worker at the end of a segment chooses where its line goes on: from its current state or from an earlier attempt
    (anchor), extending that route or redirecting from it, with the bottleneck, the evidence and the next focus. The
    kernel checks it and restores the worktree to the anchor"""
    c, st = _state(room)
    _need(room, c, by, 'WORKER')
    if st['phase'] != 2:
        raise ValueError('re-anchoring belongs to the investigation (phase 2)')
    keys = ('anchor', 'direction', 'bottleneck', 'supporting_evidence', 'decision_reason', 'next_search_focus')
    if not isinstance(data, dict) or any(k not in data for k in keys):
        raise ValueError('a re-anchoring is JSON with ' + ', '.join(keys))
    if data['direction'] not in ('extend', 'redirect'):
        raise ValueError('direction: extend or redirect')
    if not isinstance(data['supporting_evidence'], list):
        raise ValueError('supporting_evidence is a list of att-N and E-numbers')
    known = {f"att-{a['n']}" for a in st['attempts'] if a['state'] != 'revoked'} | {e['id'] for e in st['evidence'] if e['state'] in ('tentative', 'committed')}
    bad = [x for x in data['supporting_evidence'] if x not in known]
    if bad:
        raise ValueError(f"unknown or revoked evidence: {', '.join(bad)}")
    key, wk = _worker(st, by)
    if st.get('pending') and st['pending'].get('worker') == key:
        raise ValueError('a run of yours is in progress')
    anchor = data['anchor']
    if anchor == 'current':
        commit, best = wk['head'], wk.get('best')
    else:
        a = next((x for x in st['attempts'] if f"att-{x['n']}" == anchor), None)
        if not a or a['state'] == 'revoked' or a['status'] != 'keep' or a['kind'] != 'attempt':
            raise ValueError(f'{anchor} is not a state to start from: a kept attempt, not revoked (a discarded one would leave '
                             f'your line below its own best)')
        commit = _commit_of(c, anchor)
        best = {'n': a['n'], 'commit': a['commit'], 'metric': a['metric']} if a['status'] == 'keep' else wk.get('best')
    work = _check_work(c, wk)
    _git(work, 'reset', '-q', '--hard', commit)
    _clean(work, c)

    def apply(c2, s2):
        w = s2['workers'][key]
        w['head'], w['best'] = commit, best
        w['since_evidence'] = 0
        s2['history'].append({'ts': time.time(), 'by': by, 'reanchor': {k: data[k] for k in keys}})
    _edit(room, apply)
    _log(room, by, 'reanchor', data)
    return (f"⚓ {by} re-anchors at {anchor} and will {data['direction']}: bottleneck {str(data['bottleneck'])[:120]} · next "
            f"{str(data['next_search_focus'])[:120]}")


# ---------------------------------------------------------------------------------------------------------- ideas
def _trigrams(text):
    words = re.findall(r'\w+', (text or '').lower())
    return {tuple(words[i:i + 3]) for i in range(max(0, len(words) - 2))} or {tuple(words)}


def _similarity(a, b):
    ta, tb = _trigrams(a), _trigrams(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _idea_text(i):
    return ' '.join(str(i.get(k, '')) for k in ('title', 'hypothesis', 'plan'))


def propose_idea(room, by, data):
    """an idea bundle from the PROPOSER: title, hypothesis, plan, rubrics (metric and implementation), what it changes
    (question, method or both), prior work, and the mode the kernel asks for (gap or analogy, in turn). Refused when it
    is too close to an idea already there, or when it would be the fourth in a row that only changes the method"""
    c, st = _state(room)
    _need(room, c, by, 'PROPOSER')
    if st['phase'] != 2:
        raise ValueError('ideas are proposed in the investigation (phase 2)')
    if not isinstance(data, dict):
        raise ValueError('an idea is a JSON object')
    missing = [k for k in ('title', 'hypothesis', 'plan', 'changes', 'prior_work', 'mode') if not str(data.get(k, '')).strip()]
    rub = data.get('rubrics') if isinstance(data.get('rubrics'), dict) else {}
    if not rub.get('metric') or not rub.get('implementation'):
        missing.append('rubrics.metric and rubrics.implementation')
    if missing:
        raise ValueError('the idea lacks: ' + ', '.join(missing) + ' (prior_work may be "none known")')
    if data['changes'] not in ('question', 'method', 'both'):
        raise ValueError('changes: question, method or both')
    if data['mode'] != st['next_mode']:
        raise ValueError(f"the next idea is a \"{st['next_mode']}\" idea: " + (
            'what is missing or wrong in what was tried (a gap in the results, a bottleneck nobody attacked)' if st['next_mode'] == 'gap'
            else 'a solution taken from another field or another kind of program, applied here'))
    text = _idea_text(data)
    near = max(((_similarity(text, _idea_text(i)), i['id']) for i in st['ideas']), default=(0.0, None))
    if near[0] > SIMILAR:
        raise ValueError(f'too close to {near[1]} (similarity {near[0]:.2f}): what is new in it? Propose something farther away')
    recent = [i['changes'] for i in st['ideas'] if i['status'] != 'rejected'][-3:]
    if len(recent) == 3 and all(x == 'method' for x in recent) and data['changes'] == 'method':
        raise ValueError('three ideas in a row changed only the method: the next one must change the question (what is '
                         'measured, assumed or optimised), or both')

    def apply(c2, s2):
        s2['seq']['I'] += 1
        iid = f"I{s2['seq']['I']}"
        s2['ideas'].append({'id': iid, 'title': str(data['title'])[:200], 'hypothesis': str(data['hypothesis'])[:1000],
                            'plan': str(data['plan'])[:2000], 'rubrics': {k: str(v)[:500] for k, v in rub.items()},
                            'changes': data['changes'], 'prior_work': str(data['prior_work'])[:500], 'mode': data['mode'],
                            'by': by, 'status': 'accepted', 'ts': time.time()})
        s2['next_mode'] = 'analogy' if s2['next_mode'] == 'gap' else 'gap'
        return iid
    iid = _edit(room, apply)
    _log(room, by, 'idea', {**data, 'id': iid})
    return f"💡 idea {iid} ({data['mode']}, changes the {data['changes']}): {str(data['title'])[:140]}"


# ---------------------------------------------------------------------------------------------------------- evidence
def propose_evidence(room, by, text, source):
    """what was learned, with where it comes from: att-N, an evidence id, or a link. Tentative until the registrar curates it"""
    c, st = _state(room)
    _need(room, c, by, 'WORKER', 'SEARCHER', 'REGISTRAR', 'PROPOSER')
    text = ' '.join((text or '').split())
    if not text:
        raise ValueError('evidence needs a text: what was learned, in one or two sentences')
    if not source:
        raise ValueError('evidence needs its source: --source att-N, E3 or a link (https://...)')
    srcs = [s.strip() for s in source.split(',') if s.strip()]
    for s in srcs:
        if re.fullmatch(r'att-\d+', s):
            a = next((x for x in st['attempts'] if f"att-{x['n']}" == s), None)
            if not a:
                raise ValueError(f'no attempt {s}')
            if a['state'] == 'revoked':
                raise ValueError(f'{s} was revoked: it cannot back new evidence')
        elif re.fullmatch(r'E\d+', s):
            if not any(e['id'] == s and e['state'] in ('tentative', 'committed') for e in st['evidence']):
                raise ValueError(f'no live evidence {s}')
        elif not re.fullmatch(r'https?://\S{4,}', s):
            raise ValueError(f'source {s}: att-N, E-number or an http(s) link')

    def apply(c2, s2):
        s2['seq']['E'] += 1
        eid = f"E{s2['seq']['E']}"
        s2['evidence'].append({'id': eid, 'text': text[:600], 'source': srcs, 'by': by, 'state': 'tentative', 'ts': time.time()})
        if by in s2['workers']:
            s2['workers'][by]['since_evidence'] = 0
        elif list(s2['workers']) == ['_main'] and _role_of(c2, by) in (None, 'WORKER'):
            s2['workers']['_main']['since_evidence'] = 0
        return eid
    eid = _edit(room, apply)
    _log(room, by, 'evidence', {'id': eid, 'source': srcs})
    return f'📎 evidence {eid} (tentative, from {", ".join(srcs)}): {text[:160]}'


def curate(room, by, accept=(), reject=(), drop=()):
    """the registrar decides: tentative evidence accepted (committed) or rejected, committed evidence dropped to make room.
    At most CURATED_MAX committed at once"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    accept, reject, drop = (list(dict.fromkeys(x)) for x in (accept, reject, drop))
    both = (set(accept) & set(reject)) | (set(accept) & set(drop)) | (set(reject) & set(drop))
    if both:
        raise ValueError(f"{', '.join(sorted(both))}: one decision per piece of evidence")

    def apply(c2, s2):
        ev = {e['id']: e for e in s2['evidence']}
        for eid in [*accept, *reject]:
            if eid not in ev or ev[eid]['state'] != 'tentative':
                raise ValueError(f'{eid} is not tentative evidence')
        for eid in drop:
            if eid not in ev or ev[eid]['state'] != 'committed':
                raise ValueError(f'{eid} is not committed evidence')
        live = sum(1 for e in s2['evidence'] if e['state'] == 'committed') - len(drop) + len(accept)
        if live > CURATED_MAX:
            raise ValueError(f'{live} committed pieces of evidence would pass the limit of {CURATED_MAX}: drop some first (--drop)')
        for eid in accept:
            ev[eid]['state'] = 'committed'
        for eid in reject:
            ev[eid]['state'] = 'rejected'
        for eid in drop:
            ev[eid]['state'] = 'superseded'
        return live
    live = _edit(room, apply)
    _log(room, by, 'curate', {'accept': list(accept), 'reject': list(reject), 'drop': list(drop)})
    return f"📎 curated by {by}: accepted {', '.join(accept) or '-'}, rejected {', '.join(reject) or '-'}, dropped {', '.join(drop) or '-'} · {live} committed"


def direction(room, by, data):
    """the registrar's map of the search: the direction now, those still open, those that gave nothing, those finished"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    keys = ('active', 'searchable', 'no_positive', 'completed', 'change_summary')
    if not isinstance(data, dict) or set(data) - set(keys) or not data.get('active') or not data.get('change_summary'):
        raise ValueError(f'a direction is JSON with active and change_summary, and optionally searchable, no_positive, completed (lists)')
    for k in ('searchable', 'no_positive', 'completed'):
        if k in data and not isinstance(data[k], list):
            raise ValueError(f'{k} is a list')

    new = {k: data.get(k, [] if k in ('searchable', 'no_positive', 'completed') else '') for k in keys}
    if new == st.get('direction'):
        raise ValueError('the direction is the same as the last one: nothing to record')

    def apply(c2, s2):
        s2['direction'] = new
        s2['history'].append({'ts': time.time(), 'by': by, **s2['direction']})
    _edit(room, apply)
    _log(room, by, 'direction', data)
    return f"🧭 direction by {by}: {_words(data['active'], 200)} · change: {_words(data['change_summary'], 200)}"


def _words(value, limit):
    """a text cut at a word, with … when cut"""
    text = ' '.join(str(value).split())
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0].rstrip(',;:(') + ' …'


def conclude(room, by, worker, gate, trigger, text):
    """the registrar's distilled conclusion for a worker's line: at most 300 words, and whether it changed what we believe"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    if gate not in ('updated', 'kept', 'skipped'):
        raise ValueError('--gate updated, kept or skipped')
    if trigger not in ('a', 'b', 'c', 'd', 'none'):
        raise ValueError('--trigger a (new best), b (a direction exhausted), c (a contradiction), d (the budget), or none')
    if len((text or '').split()) > 300 or not (text or '').strip():
        raise ValueError('a conclusion is 1 to 300 words')
    refs = re.findall(r'\b(att-\d+|E\d+)\b', text)
    _edit(room, lambda c2, s2: s2['conclusions'].update({worker: {'gate': gate, 'trigger': trigger, 'text': text.strip(),
                                                                    'refs': refs, 'state': 'committed', 'by': by, 'ts': time.time()}}))
    _log(room, by, 'conclude', {'worker': worker, 'gate': gate})
    return f'📝 conclusion for {worker} by {by}: gate={gate}; trigger={trigger}'


def revoke(room, by, target, reason):
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    if str(target).startswith('att-'):                  # worktrees move: not while a run uses them
        return _locked(room, c, by, lambda: _revoke(room, by, target, reason))
    return _revoke(room, by, target, reason)


def _revoke(room, by, target, reason):
    """the auditor (or the lead) withdraws an attempt or a piece of evidence; it cascades: evidence that rests on it is
    revoked, conclusions that cite it are quarantined, and a revoked best gives way to the best that remains"""
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    if not reason:
        raise ValueError('a revocation says why: --reason "..."')
    if not re.fullmatch(r'att-\d+|E\d+', target or ''):
        raise ValueError('revoke att-N or E-number')
    if target.startswith('att-'):
        if st.get('baseline') and target == f"att-{st['baseline']['n']}":
            raise ValueError('the baseline cannot be revoked: everything is measured against it (a wrong baseline means a new '
                             'research, or research amend and a new baseline)')
        c, st = _settle(room, c, st, locked=True)        # the worktrees about to move must not be in a run

    def apply(c2, s2):
        gone = {target}
        if target.startswith('att-'):
            a = next((x for x in s2['attempts'] if f"att-{x['n']}" == target), None)
            if not a:
                raise ValueError(f'no {target}')
            changed = True
            while changed:                                 # attempts built on it go with it
                changed = False
                for x in s2['attempts']:
                    if x['state'] != 'revoked' and (f"att-{x['n']}" == target or f"att-{x.get('parent_n')}" in gone):
                        x['state'], x['revoked_why'] = 'revoked', (reason if f"att-{x['n']}" == target else f'built on {target}: {reason}')
                        gone.add(f"att-{x['n']}")
                        changed = True
        elif not any(e['id'] == target for e in s2['evidence']):
            raise ValueError(f'no {target}')
        changed = True
        while changed:
            changed = False
            for e in s2['evidence']:
                if e['state'] in ('tentative', 'committed') and (e['id'] in gone or any(s in gone for s in e['source'])):
                    e['state'], e['revoked_why'] = 'revoked', f'rests on {target}: {reason}'
                    gone.add(e['id'])
                    changed = True
        for w, cc in s2['conclusions'].items():
            if any(r in gone for r in cc.get('refs', [])):
                cc['state'] = 'quarantined'
        moved = []
        for key, w in s2['workers'].items():
            if w.get('best') and f"att-{w['best']['n']}" in gone:
                alive = [x for x in s2['attempts'] if x['worker'] == key and x['status'] == 'keep' and x['state'] != 'revoked'
                         and x['kind'] == 'attempt']
                nb = alive[-1] if alive else None
                w['best'] = {'n': nb['n'], 'commit': nb['commit'], 'metric': nb['metric']} if nb else None
                moved.append((key, nb['commit'] if nb else (s2.get('baseline') or {}).get('commit') or c2['base_commit']))
        if s2['best'] and f"att-{s2['best']['n']}" in gone:
            alive = [x for x in s2['attempts'] if x['status'] == 'keep' and x['state'] != 'revoked' and x['kind'] == 'attempt']
            pick = None
            for x in alive:
                if pick is None or _better(dict(c2, min_gain=''), x['metric'], pick['metric']):
                    pick = x
            s2['best'] = ({'n': pick['n'], 'worker': pick['worker'], 'commit': pick['commit'], 'metric': pick['metric']} if pick
                          else s2.get('baseline'))
        return sorted(gone), moved
    import copy
    for key, commit in apply(copy.deepcopy(c), copy.deepcopy(st))[1]:   # every worktree that will move is usable, before any write
        _check_work(c, st['workers'][key])
    gone, moved = _edit(room, apply)
    for key, commit in moved:                              # the worktree follows its new best (or the baseline)
        c, st = _state(room)
        w = st['workers'][key]
        work = _check_work(c, w)
        full = _git(work, 'rev-parse', commit)
        _git(work, 'reset', '-q', '--hard', full)
        _clean(work, c)
        _edit(room, lambda c2, s2, k=key, f=full: s2['workers'][k].update(head=f))
    _log(room, by, 'revoke', {'target': target, 'reason': reason, 'cascade': gone})
    return f"⛔ {target} revoked by {by} ({reason[:120]}); also withdrawn: {', '.join(x for x in gone if x != target) or 'nothing'}"


def verdict(room, by, phase, outcome, scores=None, coverage=None, missing=None, next_intent=None, notes=''):
    """the auditor at a gate: pass or fail (drafting, report), answer_ready or search_more (investigation), with scores
    0, 1.5 or 3 on the items it chose, the coverage of each requirement and, when it asks for more, one next intent"""
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    allowed = {1: ('pass', 'fail'), 2: ('answer_ready', 'search_more'), 3: ('pass', 'fail'), 5: ('pass', 'fail')}
    if int(phase) not in allowed or outcome not in allowed[int(phase)]:
        raise ValueError('verdicts: phase 1/3/5 pass|fail, phase 2 answer_ready|search_more')
    if int(phase) != st['phase']:
        raise ValueError(f"the research is in phase {st['phase']} ({PHASES[st['phase']]}): a verdict is on the phase now")
    scores = scores or {}
    if not isinstance(scores, dict) or any(v not in (0, 1.5, 3, '0', '1.5', '3') for v in scores.values()):
        raise ValueError('scores: {"item": 0 | 1.5 | 3, ...} (0 missing or wrong, 1.5 mentioned without support, 3 right and needed)')
    if outcome == 'search_more' and not next_intent:
        raise ValueError('search_more needs one concrete --next-intent')
    rec = {'phase': int(phase), 'outcome': outcome, 'scores': {k: float(v) for k, v in scores.items()}, 'coverage': coverage or {},
           'missing': missing or [], 'next_intent': next_intent or '', 'notes': notes, 'by': by, 'ts': time.time(),
           'snap': _snap(room, st)}

    def apply(c2, s2):
        s2['verdicts'].append(rec)
        if next_intent:
            s2['gaps'].append({'text': next_intent, 'by': by, 'ts': time.time()})
    _edit(room, apply)
    _log(room, by, 'verdict', rec)
    score = f" · score {sum(rec['scores'].values()):.1f}/{3 * len(rec['scores'])}" if rec['scores'] else ''
    return f"⚖️ verdict at phase {phase} by {by}: {outcome.upper()}{score}" + (f' · next: {next_intent[:160]}' if next_intent else '')


def allow_fix(room, by, worker, reason):
    """the auditor (or the lead) lets a worker's next run be a fix: kept if not worse than its best by more than the
    minimal gain, because it corrects something (safety, a race, a wrong result) rather than gaining speed"""
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    if not reason:
        raise ValueError('say what it corrects: --reason "..."')
    key, wk = _worker(st, worker)
    _edit(room, lambda c2, s2: s2['workers'][key].update(fix_ok={'by': by, 'reason': reason, 'ts': time.time()}))
    _log(room, by, 'allow-fix', {'worker': key, 'reason': reason})
    return f"🩹 {by} allows one fix run for {worker}: {reason[:160]} (research evaluate --kind fix)"


# ---------------------------------------------------------------------------------------------------------- the GPU
def _gpu_hold(room):
    """the GPU hold in force: by, reason, until (and the pid of a prebuild, which ends it when it exits), or None"""
    try:
        h = json.loads((_dir(room) / 'gpu.hold').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if time.time() > float(h.get('until', 0)):
        return None
    if h.get('pid'):
        from chat import pid_alive
        if not pid_alive(int(h['pid'])):
            return None
    return h


def hold(room, by, minutes, reason):
    """anyone takes the GPU for work outside the runs (a profile, a microbenchmark, the auditor's check, a build): no
    evaluate starts while it holds, except the holder's own. It ends at release or after the minutes"""
    c, st = _state(room)
    if not by:
        raise ValueError('--as NAME: who holds the GPU')
    if not reason:
        raise ValueError('say what for: --reason "..."')
    minutes = float(minutes or 0)
    top = 720 if by in room.user_names() else 120
    if not (0 < minutes <= top):
        raise ValueError(f'--minutes: how long, more than 0 and at most {top}')
    other = _gpu_hold(room)
    if other and other['by'] != by:
        raise ValueError(f"the GPU is already held by {other['by']} ({other['reason']})")
    if _run_alive(room):
        raise ValueError('a run is in progress: hold the GPU when it ends (research status)')
    h = {'by': by, 'reason': reason, 'until': time.time() + minutes * 60, 'pid': None}
    from chat import write_atomic
    write_atomic(_dir(room) / 'gpu.hold', json.dumps(h))
    _log(room, by, 'hold', h)
    return f"⏸️ GPU held by {by} for {minutes:g} min: {reason[:160]} (research release when done)"


def release(room, by):
    h = _gpu_hold(room)
    if not h:
        (_dir(room) / 'gpu.hold').unlink(missing_ok=True)
        return 'the GPU is free'
    if h['by'] != by and by not in room.user_names():
        raise ValueError(f"the GPU is held by {h['by']}: only they or the lead release it")
    (_dir(room) / 'gpu.hold').unlink(missing_ok=True)
    _log(room, by, 'release', {'held_by': h['by']})
    return f"▶️ GPU released by {by} (held by {h['by']}: {h['reason'][:120]})"


def prebuild(room, by, worker):
    """the lead builds a worker's worktree before its first run, outside the run budget: the build runs detached (a
    session's background reaper cannot kill it), logs to runs/prebuild-WORKER.log, and holds the GPU until it exits"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user starts a prebuild')
    c, st = _state(room)
    if not c.get('build'):
        raise ValueError('the contract has no build (research amend --build "CMD")')
    key, wk = _worker(st, worker)
    work = _check_work(c, wk)
    other = _gpu_hold(room)
    if other:
        raise ValueError(f"the GPU is held by {other['by']} ({other['reason']}): one thing at a time")
    if _run_alive(room):
        raise ValueError('a run is in progress: start the prebuild when it ends')
    log = _dir(room) / 'runs' / f'prebuild-{key}.log'
    done = _dir(room) / 'runs' / f'prebuild-{key}.exit'
    done.unlink(missing_ok=True)
    wrap = ('import subprocess, sys, time\n'
            'with open(sys.argv[2], "wb") as out:\n'
            '    code = subprocess.call(sys.argv[1], shell=True, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT)\n'
            'open(sys.argv[3], "w").write(str(code))\n')
    argv = [sys.executable, '-c', wrap, c['build'], str(log), str(done)]
    kw = dict(cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=_env(CHATROOM_KIND='prebuild'))
    if os.name == 'nt':
        flags = 0x08000000 | 0x00000200                # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP: no console to close by mistake
        try:
            proc = subprocess.Popen(argv, creationflags=flags | 0x01000000, **kw)   # out of the caller's job, where allowed
        except OSError:
            proc = subprocess.Popen(argv, creationflags=flags, **kw)
    else:
        proc = subprocess.Popen(argv, start_new_session=True, **kw)
    limit = (c.get('build_s') or 2 * c['budget_s']) * 3 + 600   # a reused pid cannot hold the GPU past this
    h = {'by': by, 'reason': f'prebuild of {key}', 'until': time.time() + limit, 'pid': proc.pid, 'log': str(log), 'exit': str(done)}
    from chat import write_atomic
    write_atomic(_dir(room) / 'gpu.hold', json.dumps(h))
    _log(room, by, 'prebuild', h)
    return (f"🔨 prebuild of {key} started (pid {proc.pid}, log {log}): no evaluate starts until it exits; the build output "
            f"must be in a --keep folder to survive the runs' cleaning")


# ---------------------------------------------------------------------------------------------------------- phases
def _last_verdict(st, phase):
    return next((v for v in reversed(st['verdicts']) if v['phase'] == phase), None)


def _settle(room, c, st, locked=False):
    """no phase moves while a run is in progress; a run cut off half way is recorded (as a crash) first. locked: the
    caller holds eval.lock, so a pending run can only be a dead one"""
    if st.get('pending'):
        if not locked and _run_alive(room):
            raise ValueError(f"att-{st['pending']['n']} is running: wait for it (research status)")
        _reconcile(room, c, st)
        c, st = _state(room)
    return c, st


def _snap(room, st):
    """what a verdict was given on: if any of it changes, the verdict no longer holds"""
    report = _dir(room) / 'report.md'
    return {'smoke_ok': st.get('smoke_ok'), 'best': (st.get('best') or {}).get('n'), 'aux': st.get('aux', 0),
            'report': _sha(report) if report.is_file() else ''}


def _verdict_holds(room, st, phase, outcome):
    """the auditor's last verdict at this phase says outcome, on the state as it is now"""
    v = _last_verdict(st, phase)
    if not v or v['outcome'] != outcome:
        return False
    snap, now = v.get('snap'), _snap(room, st)
    if snap is None:
        return True                                       # a verdict from before snapshots existed
    keys = {1: ('smoke_ok',), 2: ('best',), 3: ('best', 'aux'), 5: ('report',)}[phase]
    return all(snap.get(k) == now[k] for k in keys)


def seal(room, by, sealed=()):
    """phase 1 to 2: the drafted evaluator and program are committed and sealed, after a smoke run that reported the
    metric and, when the room has an auditor, its pass"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user seals the contract')
    c, st = _state(room)
    return _locked(room, c, by, lambda: _seal(room, by, sealed))


def _seal(room, by, sealed):
    c, st = _state(room)
    if st['phase'] != 1:
        raise ValueError('seal belongs to the drafting phase (1)')
    c, st = _settle(room, c, st, locked=True)
    if not st.get('smoke_ok'):
        raise ValueError('no smoke run has reported the metric yet: a WORKER runs research evaluate --kind smoke first')
    if c.get('roles', {}).get('AUDITOR') and not _verdict_holds(room, st, 1, 'pass'):
        raise ValueError('the AUDITOR has not passed the drafting as it is now (research verdict --phase 1 pass, after the last smoke run)')
    work = _check_work(c, {'work': c['work'], 'branch': c['branch']})
    smoke = next(a for a in st['attempts'] if a['n'] == st['smoke_ok'])
    later = [a['n'] for a in st['attempts'] if a['kind'] == 'smoke' and a['n'] > smoke['n']]
    if later:
        raise ValueError(f"the last good smoke run is att-{smoke['n']}, but att-{later[-1]} came after it and failed: fix the "
                         f"drafting and smoke it again (sealing now would drop the later edits)")
    commit = _git(work, 'rev-parse', smoke['commit'])
    _git(work, 'reset', '-q', '--hard', commit)
    _clean(work, c)
    seals = {}
    for rel in c['sealed']:                               # the drafted evaluator is what gets sealed, not the empty start
        if not (work / rel).is_file():
            raise ValueError(f'sealed file {rel} is not in the smoke-run commit')
        seals[rel] = _git(work, 'rev-parse', f'{commit}:{rel}')
    for f in sealed:
        rel = _rel(Path(c['repo']), f) if Path(f).is_absolute() else Path(f).as_posix()
        if rel == c['program']:
            raise ValueError(f'{rel} is the program: it cannot also be sealed')
        if not (work / rel).is_file() or not _git(work, 'ls-files', '--', rel):
            raise ValueError(f'sealed file {rel} is not committed in the research worktree')
        seals[rel] = _git(work, 'rev-parse', f'{commit}:{rel}')
    c['sealed'], c['base_commit'] = seals, commit
    _save(room, 'contract.json', c)

    def apply(c2, s2):
        s2['phase'] = 2
        for w in s2['workers'].values():
            w['head'] = commit
            w['best'] = None
        s2['protocol'] = s2.get('protocol')
    _edit(room, apply)
    _log(room, by, 'seal', {'commit': commit, 'sealed': list(seals)})
    return f"🔒 sealed by {by} at {commit[:7]}: {', '.join(seals) or 'no files'}; phase 2 (investigation): the first attempt is the baseline"


def phase_next(room, by, force=''):
    """one step forward, when its gate holds: 2 to 3 needs the auditor's answer_ready (or the budget used up); 3 to 4 needs
    evidence runs (ablation, baseline...) or a forced "degraded"; 5 to 6 needs a report and the auditor's pass"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user moves the research to the next phase')
    return _locked(room, _state(room)[0], by, lambda: _phase_next(room, by, force))


def _phase_next(room, by, force):
    c, st = _settle(room, *_state(room), locked=True)
    p = st['phase']
    auditor = bool(c.get('roles', {}).get('AUDITOR'))
    why, aux = '', []
    if p == 1:
        why = 'phase 1 ends with research seal'
    elif p == 2:
        ready = _verdict_holds(room, st, 2, 'answer_ready') or not auditor
        why = '' if ready or st['evals'] >= c['max_evals'] else 'the AUDITOR has not said answer_ready (research verdict --phase 2 answer_ready)'
        if st['best'] is None:
            why = 'there is no kept attempt to build evidence on'
    elif p == 3:
        aux = [a for a in st['attempts'] if a['kind'] in AUX_KINDS and a['status'] != 'crash']
        why = '' if aux or force == 'degraded' else 'no ablation, baseline or repeat run yet (or --force degraded, said in the report)'
        if auditor and not _verdict_holds(room, st, 3, 'pass') and force != 'degraded':
            why = why or 'the AUDITOR has not passed the evidence (research verdict --phase 3 pass)'
    elif p == 4:
        why = '' if st.get('final') or not c.get('final') else 'run the final evaluator first (research final)'
    elif p == 5:
        report = _dir(room) / 'report.md'
        why = '' if report.is_file() else 'write ROOM/research/report.md (research checklist gives its skeleton)'
        if not why:
            text = report.read_text(encoding='utf-8', errors='replace')
            left = [h for h in re.findall(r'<[^<>\n]+>', CHECKLIST + DEGRADED_LINE) if h in text]
            why = f'the report still has {len(set(left))} parts of the skeleton to fill ({sorted(set(left))[0][:60]}...)' if left else ''
            if not why and st.get('degraded') and 'DEGRADED' not in text:
                why = 'the research is degraded: the report says so in a line starting with DEGRADED (research checklist shows it)'
        if not why and auditor and not _verdict_holds(room, st, 5, 'pass'):
            why = 'the AUDITOR has not passed the report as it is now (research verdict --phase 5 pass)'
    else:
        why = 'the research is closed'
    if why:
        raise ValueError(f'phase {p} ({PHASES[p]}) cannot end yet: {why}')
    skipped = p == 3 and force == 'degraded' and (not aux or (auditor and not _verdict_holds(room, st, 3, 'pass')))
    _edit(room, lambda c2, s2: s2.update(phase=p + 1, degraded=skipped or s2.get('degraded', False)))
    _log(room, by, 'phase', {'from': p, 'to': p + 1, 'force': force})
    return f'🚦 research phase {p + 1}: {PHASES[p + 1]}' + (' (degraded: evidence not run or not passed)' if skipped else '')


def final(room, by):
    """phase 4: the final evaluator, once, on the best program, on data nobody used before"""
    if by not in room.user_names():
        raise ValueError('only the lead or the user runs the final evaluation')
    c, st = _state(room)
    if st['phase'] != 4:
        raise ValueError('the final evaluation belongs to phase 4')
    if st.get('final'):
        raise ValueError('the final evaluation ran already: it runs once')
    if not c.get('final'):
        raise ValueError('the contract has no final evaluator (research amend --final "cmd"); without it, move on with phase next')
    if not st['best']:
        raise ValueError('no best program to evaluate')
    held = _gpu_hold(room)
    if held and held['by'] != by:
        raise ValueError(f"the GPU is held by {held['by']} ({held['reason']}): run the final when it is released")
    return _locked(room, c, by, lambda: _final(room, by))


def _final(room, by):
    _check_kernel(room)
    c, st = _state(room)
    if st.get('pending'):                                 # under the lock: a pending run was cut off, record it first
        _reconcile(room, c, st)
        c, st = _state(room)
    if st.get('final'):
        raise ValueError('the final evaluation ran already: it runs once')
    work = _check_work(c, {'work': c['work'], 'branch': c['branch']})
    if _git(work, 'status', '--porcelain', '--untracked-files=no', check=False):
        raise ValueError(f'{work} has uncommitted changes: the final evaluation runs on the committed best only (commit or '
                         f'git checkout -- . there first)')
    commit = _git(work, 'rev-parse', st['best']['commit'])
    _git(work, 'checkout', '-q', '--detach', commit)
    _clean(work, c)
    log = _dir(room) / 'runs' / 'final.log'
    env = _env(CHATROOM_RUN='final', CHATROOM_KIND='final')
    fc = dict(c, evaluate=c['final'], repeats=c.get('repeats', 1), guards=[])
    try:
        value, why, secs, spread, _, text = _measure(fc, work, _dir(room), 'final', env, log,
                                                     lambda pid: _edit(room, lambda c2, s2: s2.update(final_child=[pid, time.time()])))
    finally:
        _git(work, 'checkout', '-q', '-f', c['branch'])
        _clean(work, c)
    rec = {'metric': value, 'why': why, 'spread': spread, 'search_metric': st['best']['metric'], 'commit': st['best']['commit'],
           'ts': time.time()}
    if value is None:                                     # no number came out: nothing was seen, the one run is still there
        _edit(room, lambda c2, s2: s2.update(final_child=None))
        _log(room, by, 'final', rec, ok=False)
        line = f"🏁 final evaluation did not give a number ({why}): fix the final evaluator (research amend --final) and run it again; log {log}"
        room.append(by, line, 'board')
        return line
    _edit(room, lambda c2, s2: s2.update(final=rec, final_child=None))
    _log(room, by, 'final', rec)
    gap = ''
    if value is not None:
        gap = f" · search {st['best']['metric']:.6g} → final {value:.6g} (Δ {value - st['best']['metric']:+.6g})"
    line = f"🏁 final evaluation of att-{st['best']['n']}: {c['metric']} = {'—' if value is None else f'{value:.6g}'}" + \
           (f' ({why})' if why else '') + gap
    room.append(by, line, 'board')
    return line


DEGRADED_LINE = ('\n- DEGRADED: phase 3 was closed by force, without evidence runs or without the auditor\'s pass: <why, and what '
                 'it leaves unproven>\n')
CHECKLIST = '''# Report

## Result
<the best attempt (att-N, tag), its metric in search and in the final evaluation, against the baseline>

## What changed
<the change from the baseline, mechanism, why it works; every number with its att-N or E-number>

## Evidence
<ablations and baselines with their runs, repeats and spread; what each one isolates>

## What did not work
<the main failures, with their runs>

## Limits
<what the evidence does not show; noise; held-out results; what an auditor would still check>

## Disclosure
- Human interventions: <when and how the user or the lead stepped in>
- Code: <branch and best tag>
- Runs and traces: results.tsv, runs/, log.jsonl
- Novelty check: <how prior work was searched, which sources>
- Attempts and selection: <how many runs, how the best was chosen>
- Baseline: <source and how much it was tuned>
- Reviewer independence: <who audited, and that the evaluator decided the numbers>
- Pre-registration: task.md and the idea bundles, timestamped in log.jsonl before their runs
'''


def checklist(room):
    path = _dir(room) / 'report.md'
    c, st = _state(room)
    text = CHECKLIST + (DEGRADED_LINE if st.get('degraded') else '')
    if not path.exists():
        path.write_text(text, encoding='utf-8')
        return f'report skeleton written to {path}'
    return f'{path} exists; its sections:\n' + text


# ---------------------------------------------------------------------------------------------------------- views
def _cut(text, limit=VIEW_MAX):
    return text if len(text) <= limit else text[:limit - 60] + f'\n... ({len(text) - limit + 60} more characters: research expand ID)'


def view(room, name):
    """what a role needs to see, bounded: a worker its contract, its line and what not to repeat; the proposer the ideas
    and their outcomes; the registrar the evidence to curate; the auditor what to check. research expand ID opens one record"""
    c, st = _state(room)
    role = _role_of(c, name) or ('LEAD' if name in room.user_names() else 'WORKER')
    att = st['attempts']
    head = (f"research {c['tag']} · phase {st['phase']} ({PHASES[st['phase']]}) · {st['evals']}/{c['max_evals']} runs · best "
            + (f"att-{st['best']['n']} {st['best']['metric']:.6g} ({st['best'].get('worker', '?')})" if st['best'] else 'none')
            + (' · DEGRADED (no evidence runs)' if st.get('degraded') else '') + f' · you: {role}')
    out = [head]
    tried = lambda xs: '; '.join(f"att-{a['n']} {a['desc'][:50]} → {a['status']}" for a in xs)
    key = None
    if role == 'WORKER':
        try:
            key, wk = _worker(st, name)
            out.append(f"your worktree {wk['work']} · from {wk.get('parent')} as {wk.get('type')} · your best "
                       + (f"att-{wk['best']['n']} {wk['best']['metric']:.6g}" if wk.get('best') else 'none')
                       + (f" · idea {wk['idea']}" if wk.get('idea') else '') + (' · PAUSED' if wk.get('paused') else ''))
            if wk.get('idea'):
                i = next((x for x in st['ideas'] if x['id'] == wk['idea']), None)
                if i:
                    out.append(f"idea {i['id']}: {i['title']} — {i['hypothesis'][:300]} — plan: {i['plan'][:400]} — rubrics: {i['rubrics']}")
            mine = [a for a in att if a['worker'] == key][-8:]
            out.append('your line: ' + (tried(mine) or 'nothing yet'))
            cc = st['conclusions'].get(key)
            if cc:
                out.append(f"registrar's conclusion on your line ({cc['state']}): {cc['text'][:500]}")
            path = _dir(room) / f'findings-{key}.md'
            if path.is_file():
                out.append('findings of your line:\n' + '\n'.join(path.read_text(encoding='utf-8').splitlines()[-10:]))
        except ValueError as exc:
            out.append(str(exc))
        fails = [a for a in att if a['status'] in ('discard', 'crash') and a['worker'] != key][-6:]
        if fails:
            out.append('do not repeat (other lines): ' + tried(fails))
    elif role == 'PROPOSER':
        out.append(f"next idea mode: {st['next_mode']} · direction: {st['direction'].get('active', '-')}")
        for i in st['ideas'][-12:]:
            res = [a for a in att if a.get('idea') == i['id']]
            out.append(f"{i['id']} [{i['mode']}/{i['changes']}] {i['title'][:80]} → " + (', '.join(f"att-{a['n']} {a['status']}" for a in res) or i['status']))
        if st['gaps']:
            out.append('open gaps: ' + '; '.join(g['text'][:120] for g in st['gaps'][-4:]))
        if st['direction'].get('no_positive'):
            out.append('gave nothing: ' + '; '.join(map(str, st['direction']['no_positive']))[:400])
    elif role == 'REGISTRAR':
        tent = [e for e in st['evidence'] if e['state'] == 'tentative']
        live = [e for e in st['evidence'] if e['state'] == 'committed']
        out.append(f'{len(live)}/{CURATED_MAX} committed · to curate: ' + ('; '.join(f"{e['id']} ({','.join(e['source'])}) {e['text'][:100]}" for e in tent) or 'none'))
        out.append('latest runs: ' + tried(att[-8:]))
        out.append('direction: ' + json.dumps(st['direction'], ensure_ascii=False)[:500])
        out.append('conclusions: ' + ('; '.join(f"{k} ({cc['gate']}, {cc['state']}) {cc['text'][:120]}" for k, cc in st['conclusions'].items()) or 'none'))
        idle = [k for k, w in st['workers'].items() if w.get('since_evidence', 0) >= S_MAX - 1]
        if idle:
            out.append('workers near the evidence limit: ' + ', '.join(idle))
    elif role in ('AUDITOR', 'LEAD'):
        keeps = [a for a in att if a['status'] == 'keep' and a['state'] != 'revoked'][-6:]
        out.append('keeps to check (git show <tag>): ' + ('; '.join(f"att-{a['n']} {c['branch']}/att-{a['n']} {a['desc'][:60]}" for a in keeps) or 'none'))
        flags = detectors(c, st)
        if flags:
            out.append('detectors: ' + ' | '.join(flags))
        quar = [k for k, cc in st['conclusions'].items() if cc['state'] == 'quarantined']
        if quar:
            out.append('quarantined conclusions (they cite revoked records): ' + ', '.join(quar))
        last = st['verdicts'][-1] if st['verdicts'] else None
        if last:
            out.append(f"last verdict: phase {last['phase']} {last['outcome']}")
        out.append('live evidence: ' + ('; '.join(f"{e['id']} {e['text'][:80]}" for e in st['evidence'] if e['state'] == 'committed')[:900] or 'none'))
    elif role == 'SEARCHER':
        out.append(f"task: {c['program']} · metric {c['metric']} · direction: {st['direction'].get('active', '-')}")
        out.append('evidence so far: ' + ('; '.join(f"{e['id']} {e['text'][:80]}" for e in st['evidence'] if e['state'] in ('tentative', 'committed'))[:1200] or 'none'))
        if st['gaps']:
            out.append('open questions: ' + '; '.join(g['text'][:120] for g in st['gaps'][-4:]))
    return _cut('\n'.join(out))


def expand(room, rid):
    c, st = _state(room)
    for coll in ('ideas', 'evidence'):
        for x in st[coll]:
            if x['id'] == rid:
                return json.dumps(x, indent=1, ensure_ascii=False)
    m = re.fullmatch(r'att-(\d+)', rid or '')
    if m:
        a = next((x for x in st['attempts'] if x['n'] == int(m.group(1))), None)
        if a:
            return json.dumps(a, indent=1, ensure_ascii=False) + f"\ncode: git show {c['branch']}/att-{a['n']}\nlog: {_dir(room) / 'runs' / (str(a['n']) + '.log')}"
    if rid in st['workers']:
        return json.dumps(st['workers'][rid], indent=1, ensure_ascii=False)[:4000]
    raise ValueError(f'no record {rid} (ideas I-n, evidence E-n, attempts att-N, worker names)')


def detectors(c, st):
    """the research's own warnings: lines put back, retuning only, stalls, a protocol that moved, search against final"""
    out = []
    for key, w in st['workers'].items():
        mine = [a for a in st['attempts'] if a['worker'] == key and a['kind'] == 'attempt'][-10:]
        added = sum(a.get('added', 0) for a in mine)
        readded = sum(a.get('readded', 0) for a in mine)
        if added >= 10 and readded / added > 0.3:
            out.append(f'{key}: {readded} of {added} added lines were deleted before in its line (cycling)')
        tun = [a for a in mine[-8:] if a.get('tuning')]
        if len(mine) >= 4 and len(tun) > len(mine[-8:]) / 2:
            out.append(f'{key}: {len(tun)} of its last {len(mine[-8:])} attempts only changed numbers (send an explorer)')
        if w.get('paused'):
            out.append(f'{key}: paused after {CRASH_MAX} crashes')
    runs = [a for a in st['attempts'] if a['kind'] == 'attempt']
    keeps = [a for a in runs if a['status'] == 'keep']
    if len(runs) >= 10 and keeps and runs[-1]['n'] - keeps[-1]['n'] >= 10:
        out.append(f"no keep in the last {runs[-1]['n'] - keeps[-1]['n']} runs: plateau (explorers from base, or a new question)")
    ideas = st['ideas']
    if len(ideas) >= 4:
        sims = [_similarity(_idea_text(a), _idea_text(b)) for i, a in enumerate(ideas) for b in ideas[i + 1:]]
        if sum(sims) / len(sims) > 0.25:
            out.append(f'ideas are narrowing (mean similarity {sum(sims) / len(sims):.2f})')
    if st.get('final') and st['final'].get('metric') is not None and st['best']:
        out.append(f"search {st['final']['search_metric']:.6g} vs final {st['final']['metric']:.6g}")
    return out


def status(room):
    c, st = _state(room)
    rows = (_dir(room) / 'results.tsv').read_text(encoding='utf-8').splitlines()[1:]
    counts = {k: sum(1 for r in rows if r.split('\t')[3] == k) for k in ('keep', 'discard', 'crash')}
    best = st['best']
    head = (f"research {c['tag']} · phase {st['phase']} ({PHASES[st['phase']]}) · {c['program']} · metric {c['metric']} "
            f"({c['direction']}, from {'the result file' if c.get('metric_source') == 'file' else 'the output: a program could print a false one, prefer --result-file'}"
            + (f", median of {c['repeats']}" if c.get('repeats', 1) > 1 else '') + (f", min gain {c['min_gain']}" if c.get('min_gain') else '') + ') · '
            f"{st['evals']}/{c['max_evals']} runs of {c['budget_s']} s · keep {counts['keep']}, discard {counts['discard']}, crash {counts['crash']} · "
            + (f"best att-{best['n']} {best['metric']:.6g} ({best['commit']}, {best.get('worker', '')})" if best else 'no baseline yet')
            + (f" · att-{st['pending']['n']} in progress or cut off" if st.get('pending') else '')
            + (' · DEGRADED: phase 3 closed without evidence runs' if st.get('degraded') else ''))
    for f in sorted((_dir(room) / 'runs').glob('prebuild-*.exit')):
        code = f.read_text(errors='replace').strip()
        head += f"\nprebuild of {f.stem[9:]}: " + ('done (exit 0)' if code == '0' else f'FAILED (exit {code}), log {f.with_suffix(".log")}')
    held = _gpu_hold(room)
    if held:
        head += (f"\nGPU held by {held['by']}: {held['reason']}" + (f" (pid {held['pid']}, log {held.get('log')})" if held.get('pid')
                 else f" until {time.strftime('%H:%M', time.localtime(held['until']))}"))
    lines = [head]
    if len(st['workers']) > 1 or '_main' not in st['workers']:
        lines.append('workers: ' + '; '.join(f"{k} " + (f"best att-{w['best']['n']} {w['best']['metric']:.6g}" if w.get('best') else 'no best')
                                             + f" ({w.get('type')} from {w.get('parent')})" + (' PAUSED' if w.get('paused') else '')
                                             + (f" {w['crashes']} crashes in a row" if w.get('crashes') else '')
                                             + (' fix allowed' if w.get('fix_ok') else '')
                                             for k, w in st['workers'].items() if k != '_main'))
    if st['ideas']:
        lines.append(f"ideas: {len(st['ideas'])} (next: {st['next_mode']}) · evidence: "
                     f"{sum(1 for e in st['evidence'] if e['state'] == 'committed')} committed, {sum(1 for e in st['evidence'] if e['state'] == 'tentative')} tentative")
    flags = detectors(c, st)
    if flags:
        lines.append('detectors: ' + ' | '.join(flags))
    return '\n'.join(lines) + '\n' + TSV_HEAD.rstrip('\n') + '\n' + '\n'.join(rows[-12:])


# ---------------------------------------------------------------------------------------------------------- panel
def panel(room, by, question, out=None, limit=12):
    """critiques or ideas from every free model on OpenRouter at once (the biggest first), for the auditor's final review
    or a brainstorm. The key stays in the environment (OPENROUTER_API_KEY), never in the room"""
    import urllib.request
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR', 'PROPOSER')
    key = os.environ.get('OPENROUTER_API_KEY')
    if not key:
        raise ValueError('set OPENROUTER_API_KEY in the environment of this shell (never in the room or in the chat)')
    if not question or not question.strip():
        raise ValueError('a panel needs a question (--question FILE, the text to critique and what to answer)')
    req = urllib.request.Request('https://openrouter.ai/api/v1/models', headers={'Authorization': f'Bearer {key}'})
    models = json.loads(urllib.request.urlopen(req, timeout=60).read())['data']
    free = [m for m in models if str(m.get('pricing', {}).get('prompt')) in ('0', '0.0') and str(m.get('pricing', {}).get('completion')) in ('0', '0.0')]
    size = lambda m: (int(m.get('context_length') or 0), m.get('id', ''))
    free.sort(key=lambda m: ('stealth' not in (m.get('name', '') + m.get('description', '')).lower(), -size(m)[0]))
    path = Path(out) if out else _dir(room) / f"panel-{time.strftime('%m%d-%H%M')}.md"
    head = (f'# Panel (free models on OpenRouter)\n\nThe question below was sent to third-party providers, which may keep it.\n\n'
            f'## Question\n\n{question.strip()}\n\n')
    path.write_text(head, encoding='utf-8')
    answers = []
    for m in free[:limit]:
        body = json.dumps({'model': m['id'], 'messages': [{'role': 'user', 'content': question}],
                           'reasoning': {'effort': 'high'}}).encode()
        r = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=body,
                                   headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
        try:
            data = json.loads(urllib.request.urlopen(r, timeout=300).read())
            text = data['choices'][0]['message'].get('content') or ''
        except Exception as exc:                          # one model failing never stops the panel
            text = f'(no answer: {type(exc).__name__}: {str(exc)[:200]})'
        answers.append(f"## {m['id']}\n\n{text.strip()}\n")
        with open(path, 'a', encoding='utf-8') as f:     # each answer saved as it comes: a stopped panel keeps what it got
            f.write(answers[-1] + '\n')
        time.sleep(3.2)                                   # 20 requests a minute on free models
    _log(room, by, 'panel', {'models': [m['id'] for m in free[:limit]], 'file': str(path)})
    return (f'🗣️ panel of {len(answers)} free models written to {path}: these are opinions, to weigh against the evidence '
            f'(the question went to third-party providers)')


# ---------------------------------------------------------------------------------------------------------- cli
def _json_arg(a):
    raw = getattr(a, 'json', None)
    if raw and Path(raw).is_file():
        raw = Path(raw).read_text(encoding='utf-8')
    if not raw and not getattr(a, 'mcp', False) and sys.stdin is not None and not sys.stdin.isatty():
        raw = sys.stdin.buffer.read().decode('utf-8', errors='replace')    # the MCP server's stdin is its protocol: never read
    try:
        return json.loads(raw or '')
    except ValueError as exc:
        raise ValueError(f'not valid JSON ({exc})')


def cmd(room, a):
    """chat.py research <action>: see the module's docstring. A refused action is logged too (log.jsonl, ok false)"""
    try:
        return _cmd(room, a)
    except ValueError as exc:
        act = a.pairs[0] if a.pairs else 'status'
        if act == 'assign':
            room.append(a.name or 'LEAD', f"⛔ assign {' '.join(a.pairs[1:2])} refused: {str(exc)[:300]}", 'board')
        if act not in ('status', 'view', 'expand', 'checklist') and (act != 'phase' or a.pairs[1:2] == ['next']) and (_dir(room) / 'log.jsonl').parent.is_dir():
            _log(room, a.name, act, {'refused': str(exc)[:400], 'args': a.pairs[1:]}, ok=False)
        raise


def _cmd(room, a):
    act = a.pairs[0] if a.pairs else 'status'
    rest = a.pairs[1:]
    split = lambda v: [x.strip() for x in (v or '').split(',') if x.strip()]
    post = lambda line: (room.append(a.name or 'LEAD', line, 'board'), print(line))
    if act == 'init':
        if not (a.program and a.metric and (a.evaluate or getattr(a, 'draft', False))):
            sys.exit('research init --program FILE --metric NAME (--evaluate "CMD" | --draft) [--direction min|max] [--budget-min 5] '
                     '[--max-evals 100] [--repo DIR] [--sealed a.py,b.py] [--tag NAME] [--result-file] [--keep data/] '
                     '[--build "CMD" --build-min M] [--repeats N] [--min-gain X|X%] [--guard NAME:min|max:TOL,...] [--final "CMD"] --as LEAD')
        return post(init(room, a.name, a.program, a.evaluate, a.metric, a.direction or 'min',
                         5 if a.budget_min is None else a.budget_min, 100 if a.max_evals is None else a.max_evals,
                         a.repo or '.', split(a.sealed), a.tag, bool(a.result_file), split(getattr(a, 'keep', None)),
                         bool(getattr(a, 'draft', False)), getattr(a, 'final', None), getattr(a, 'build', None),
                         getattr(a, 'build_min', None), getattr(a, 'repeats', None) or 1, getattr(a, 'min_gain', None),
                         getattr(a, 'guard', None)))
    if act == 'amend':
        return post(amend(room, a.name, a.evaluate, a.budget_min, a.max_evals, a.result_file, getattr(a, 'build', None),
                          getattr(a, 'build_min', None), getattr(a, 'repeats', None), getattr(a, 'min_gain', None),
                          getattr(a, 'final', None), getattr(a, 'guard', None)))
    if act == 'roles':
        return post(roles(room, a.name, rest))
    if act == 'allow-fix' and rest:
        return post(allow_fix(room, a.name, rest[0], getattr(a, 'reason', None)))
    if act == 'hold':
        return post(hold(room, a.name, getattr(a, 'minutes', None), getattr(a, 'reason', None)))
    if act == 'release':
        return post(release(room, a.name))
    if act == 'prebuild' and rest:
        return post(prebuild(room, a.name, rest[0]))
    if act == 'assign' and rest:
        return post(assign(room, a.name, rest[0], getattr(a, 'idea', None), getattr(a, 'parent', None) or 'best',
                           getattr(a, 'type', None) or 'explorer', a.force))
    if act == 'evaluate':
        if not a.name:
            sys.exit('--as NAME required')
        return print(evaluate(room, a.name, a.desc, getattr(a, 'idea', None), getattr(a, 'kind', None) or ('smoke' if _state(room)[1]['phase'] == 1 else 'attempt'),
                              getattr(a, 'of', None), getattr(a, 'seed', None)))
    if act == 'reanchor':
        return post(reanchor(room, a.name, _json_arg(a)))
    if act == 'resume' and rest:
        return post(resume(room, a.name, rest[0]))
    if act == 'propose-idea':
        return post(propose_idea(room, a.name, _json_arg(a)))
    if act == 'propose-evidence':
        return post(propose_evidence(room, a.name, a.text or ' '.join(rest), getattr(a, 'source', None)))
    if act == 'curate':
        return post(curate(room, a.name, split(getattr(a, 'accept', None)), split(getattr(a, 'reject', None)), split(getattr(a, 'drop', None))))
    if act == 'direction':
        return post(direction(room, a.name, _json_arg(a)))
    if act == 'conclude' and rest:
        return post(conclude(room, a.name, rest[0], getattr(a, 'gate', None), getattr(a, 'trigger', None) or 'none', a.text))
    if act == 'revoke' and rest:
        return post(revoke(room, a.name, rest[0], getattr(a, 'reason', None)))
    if act == 'verdict':
        data = _json_arg(a) if getattr(a, 'json', None) else {}
        return post(verdict(room, a.name, getattr(a, 'phase', None) or data.get('phase', 0), getattr(a, 'outcome', None) or data.get('outcome'),
                            data.get('scores'), data.get('coverage'), data.get('missing'), getattr(a, 'next_intent', None) or data.get('next_intent'),
                            data.get('notes', '')))
    if act == 'seal':
        return post(seal(room, a.name, split(a.sealed)))
    if act == 'phase':
        if rest and rest[0] == 'next':
            return post(phase_next(room, a.name, 'degraded' if a.force else ''))
        c, st = _state(room)
        return print(f"phase {st['phase']} ({PHASES[st['phase']]})")
    if act == 'final':
        return print(final(room, a.name))
    if act == 'checklist':
        return print(checklist(room))
    if act == 'view':
        return print(view(room, a.name or 'LEAD'))
    if act == 'expand' and rest:
        return print(expand(room, rest[0]))
    if act == 'panel':
        q = Path(a.question).read_text(encoding='utf-8') if getattr(a, 'question', None) and Path(a.question).is_file() else getattr(a, 'question', None)
        return post(panel(room, a.name or 'LEAD', q, a.out))
    if act == 'status':
        return print(status(room))
    sys.exit('research: init | amend | roles | assign WORKER | prebuild WORKER | hold | release | allow-fix WORKER | evaluate '
             '| resume WORKER | propose-idea | propose-evidence | curate '
             '| direction | conclude WORKER | revoke ID | verdict | reanchor | seal | phase [next] | final | checklist | view | expand ID '
             '| panel | status')
