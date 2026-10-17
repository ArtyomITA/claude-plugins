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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from i18n import say  # noqa: E402

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
        raise ValueError(say('kernel._git.git_ran_over_s', args=' '.join(args)))
    out = (r.stdout + r.stderr).decode('utf-8', errors='replace').strip()
    if check and r.returncode != 0:
        raise ValueError(say('kernel._git.git_failed', args=' '.join(args), out=out[:400]))
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
        raise ValueError(say('kernel._load.no_research_in_this'))
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
            raise ValueError(say('kernel.run.this_research_is_run', map='.'.join(map(str, st['kernel'])), map_='.'.join(map(str, KERNEL)), resolve=Path(__file__).resolve()))
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
        raise ValueError(say('kernel._check_kernel.this_research_is_run', map='.'.join(map(str, k)), map_='.'.join(map(str, KERNEL)), resolve=Path(__file__).resolve()))


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
            raise ValueError(say('kernel.parse_guards.guard_name_min_max', v1=repr(item)))
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
        raise ValueError(say('kernel._need.is_this_is_for', name=name, v2=have or 'not given a research role', roles=' or '.join(roles)))


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
        raise ValueError(say('kernel.init.only_the_lead_or'))
    if (_dir(room) / 'contract.json').exists():
        raise ValueError(say('kernel.init.this_room_already_has', v1=_dir(room) / "contract.json"))
    if direction not in ('min', 'max'):
        raise ValueError(say('kernel.init.direction_is_min_lower'))
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', metric or ''):
        raise ValueError(say('kernel.init.metric_is_the_name'))
    if not (0 < float(budget_min) <= 1440):
        raise ValueError(say('kernel.init.budget_min_the_minutes'))
    if not (1 <= int(max_evals) <= 100000):
        raise ValueError(say('kernel.init.max_evals_how_many'))
    if not (1 <= int(repeats or 1) <= 50):
        raise ValueError(say('kernel.init.repeats_how_many_times'))
    if min_gain is not None and not re.fullmatch(r'\d+(\.\d+)?%?', str(min_gain)):
        raise ValueError(say('kernel.init.min_gain_a_number'))
    if build_min is not None and not (0 < float(build_min) <= 1440):
        raise ValueError(say('kernel.init.build_min_the_minutes'))
    guards = parse_guards(guards)
    task = _dir(room) / 'task.md'
    if not task.is_file() or not task.read_text(encoding='utf-8', errors='replace').strip():
        raise ValueError(say('kernel.init.write_the_contract_first', task=task))
    top = Path(_git(repo, 'rev-parse', '--show-toplevel')).resolve()
    if _git(top, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError(say('kernel.init.has_uncommitted_changes_commit', top=top))
    rel_prog = _rel(top, program)
    if not (top / rel_prog).is_file() or not _git(top, 'ls-files', '--', rel_prog):
        raise ValueError(say('kernel.init.is_not_a_tracked', rel_prog=rel_prog, top=top))
    seals = {}
    for f in sealed:
        rel = _rel(top, f)
        if rel == rel_prog:
            raise ValueError(say('kernel.init.is_the_program_it', rel=rel))
        if not (top / rel).is_file():
            raise ValueError(say('kernel.init.is_not_a_file', rel=rel))
        if not _git(top, 'ls-files', '--', rel):
            raise ValueError(say('kernel.init.sealed_file_is_not', rel=rel, top=top))
        seals[rel] = _git(top, 'rev-parse', f'HEAD:{rel}')
    if not draft and not evaluate:
        raise ValueError(say('kernel.init.evaluate_is_needed_or'))
    keep = [k.strip().replace('\\', '/').strip('/') + '/' for k in keep if k.strip().strip('/.')]
    if any(k.split('/')[0] in ('..', '.git') or k == rel_prog + '/' for k in keep):
        raise ValueError(say('kernel.init.keep_names_folders_inside'))
    tag = tag or time.strftime('r%m%d-%H%M')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', tag):
        raise ValueError(say('kernel.init.tag_letters_digits_dot'))
    branch = f'research/{tag}'
    if _git(top, 'branch', '--list', branch):
        raise ValueError(say('kernel.init.the_branch_already_exists', branch=branch))
    d = _dir(room)
    work = d / 'work'
    if work.exists():
        raise ValueError(say('kernel.init.already_exists_a_research', work=work))
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
    noise = (say('kernel.init.median_of_measures', repeats=contract['repeats']) if contract['repeats'] > 1 else '') + \
            (say('kernel.init.a_keep_must_beat', min_gain=contract['min_gain']) if contract['min_gain'] else '') + \
            (say('kernel.init.guards_median_vs_baseline', v1=', '.join(g['name'] + ' ' + g['direction'] + ' ' + g['tol'] for g in guards)) if guards else '')
    return (say('kernel.init.research_open_at_phase', tag=tag, phase=st['phase'], PHASES=PHASES[st['phase']], rel_prog=rel_prog, work=work, branch=branch) + (say('kernel.init.build', build=build) if build else '') + (say('kernel.init.evaluator', evaluate=evaluate) if evaluate else say('kernel.init.evaluator_to_be_written'))
            + say('kernel.init.metric_is_better_read', metric=metric, v2='lower' if direction == 'min' else 'higher', v3='the result file $CHATROOM_RESULT' if result_file else 'the output (exactly one line per measure)', noise=noise, budget_s=contract['budget_s'], max_evals=max_evals) + (say('kernel.init.sealed', seals=', '.join(seals)) if seals else '')
            + (say('kernel.init.kept_untouched_data', keep=', '.join(keep)) if keep else '')
            + (say('kernel.init.a_build_may_take', v1=contract['build_s'] or 2 * contract['budget_s']) if build else '')
            + (say('kernel.init.warning_the_build_output')
               if build and not keep else '') + subs
            + say('kernel.init.one_evaluate_call_can', max_run_seconds=max_run_seconds(contract))
            + (say('kernel.init.phase_write_and_smoke') if draft else say('kernel.init.the_first_run_is')))


def amend(room, by, evaluate=None, budget_min=None, max_evals=None, result_file=None, build=None, build_min=None,
          repeats=None, min_gain=None, final=None, guards=None):
    """the lead changes the contract: budgets at any time; what is measured and how only before a baseline is kept (a
    crashed baseline is fixed this way, not by starting over)"""
    if by not in room.user_names():
        raise ValueError(say('kernel.amend.only_the_lead_or'))
    c, st = _state(room)
    said = []
    measured = any(x is not None for x in (evaluate, result_file, build, repeats, min_gain, guards))
    if measured and st['best'] is not None:
        raise ValueError(say('kernel.amend.how_runs_are_measured'))
    for key, value, label in (('evaluate', evaluate, 'evaluator'), ('build', build, 'build'), ('final', final, 'final evaluator')):
        if value is not None:
            c[key] = value
            said.append(f'{label} `{value}`')
    if result_file is not None:
        c['metric_source'] = 'file' if result_file else 'output'
        said.append(say('kernel.amend.metric_from', v1=say('kernel.word.result_file') if result_file else say('kernel.word.output')))
    if repeats is not None:
        if not (1 <= int(repeats) <= 50):
            raise ValueError(say('kernel.amend.repeats_to'))
        c['repeats'] = int(repeats)
        said.append(say('kernel.amend.median_of_measures', repeats=repeats))
    if guards is not None:
        c['guards'] = parse_guards(guards)
        said.append('guards ' + (', '.join(g['name'] for g in c['guards']) or 'none'))
    if min_gain is not None:
        if not re.fullmatch(r'\d+(\.\d+)?%?', str(min_gain)):
            raise ValueError(say('kernel.amend.min_gain_a_number'))
        c['min_gain'] = str(min_gain)
        said.append(say('kernel.amend.minimal_gain', min_gain=min_gain))
    if budget_min is not None:
        if not (0 < float(budget_min) <= 1440):
            raise ValueError(say('kernel.amend.budget_min_more_than'))
        c['budget_s'] = max(1, int(float(budget_min) * 60))
        said.append(say('kernel.amend.s_per_run', budget_s=c['budget_s']))
    if build_min is not None:
        if not (0 < float(build_min) <= 1440):
            raise ValueError(say('kernel.amend.build_min_more_than'))
        c['build_s'] = max(1, int(float(build_min) * 60))
        said.append(say('kernel.amend.s_per_build', build_s=c['build_s']))
    if max_evals is not None:
        if not (st['evals'] < int(max_evals) <= 100000):
            raise ValueError(say('kernel.amend.max_evals_must_be', evals=st['evals']))
        c['max_evals'] = int(max_evals)
        said.append(say('kernel.amend.runs_in_all', max_evals=max_evals))
    if not said:
        raise ValueError(say('kernel.amend.research_amend_evaluate_build'))
    _save(room, 'contract.json', c)
    if measured:
        _edit(room, lambda c2, s2: s2.update(protocol=None))   # the next baseline (or smoke) records the protocol anew
    _log(room, by, 'amend', said)
    return say('kernel.amend.research_contract_changed_by', tag=c['tag'], by=by) + ', '.join(said)


def roles(room, by, pairs):
    """the lead names who plays which research role: PROPOSER=P WORKER=W1,W2 REGISTRAR=R AUDITOR=A SEARCHER=S1,S2"""
    if by not in room.user_names():
        raise ValueError(say('kernel.roles.only_the_lead_or'))
    c, _ = _state(room)
    out = dict(c.get('roles', {}))
    for pair in pairs:
        role, _, names = pair.partition('=')
        role = role.strip().upper()
        if role not in ROLES:
            raise ValueError(say('kernel.roles.unknown_role_one_of', role=role, ROLES=", ".join(ROLES)))
        out[role] = [n.strip() for n in names.split(',') if n.strip()]
    seen = {}
    for role, names in out.items():
        for n in names:
            if n in seen and seen[n] != role:
                raise ValueError(say('kernel.roles.cannot_be_both_and', n=n, seen=seen[n], role=role))
            seen[n] = role
    c['roles'] = out
    _save(room, 'contract.json', c)
    _log(room, by, 'roles', out)
    return say('kernel.roles.research_roles') + '; '.join(f"{r} {', '.join(n)}" for r, n in out.items() if n)


# ---------------------------------------------------------------------------------------------------------- worktrees
def _check_work(c, wk):
    """the worktree is there and is this worker's own (its top folder and branch), so no git command ever lands in the
    user's checkout"""
    work = Path(wk['work'])
    if not work.is_dir():
        raise ValueError(say('kernel._check_work.the_research_worktree_is', work=work))
    top = _git(work, 'rev-parse', '--show-toplevel', check=False)
    if not top or Path(top).resolve() != work.resolve():
        raise ValueError(say('kernel._check_work.is_not_the_research', work=work, v2=top or "nothing"))
    branch = _git(work, 'rev-parse', '--abbrev-ref', 'HEAD', check=False)
    if branch != wk['branch']:
        raise ValueError(say('kernel._check_work.the_research_worktree_is2', branch=branch, branch_=wk['branch']))
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
        raise ValueError(say('kernel.assign.only_the_lead_or'))
    if kind not in ('explorer', 'optimizer'):
        raise ValueError(say('kernel.assign.type_explorer_or_optimizer'))
    _check_kernel(room)
    c, st = _state(room)
    if st['phase'] != 2:
        raise ValueError(say('kernel.assign.cycles_are_assigned_in', phase=st['phase'], PHASES=PHASES[st['phase']]))
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', worker or ''):
        raise ValueError(say('kernel.assign.a_worker_name_letters'))
    if c.get('roles') and _role_of(c, worker) != 'WORKER':
        raise ValueError(say('kernel.assign.is_not_a_worker', worker=worker))
    if idea and not any(i['id'] == idea and i['status'] in ('accepted', 'tried') for i in st['ideas']):
        raise ValueError(say('kernel.assign.no_accepted_idea', idea=idea))
    parent = parent or 'best'
    if parent == 'best':
        parent = f"att-{st['best']['n']}" if st['best'] else 'base'
    if parent != 'base':
        if not re.fullmatch(r'att-\d+', parent):
            raise ValueError(say('kernel.assign.parent_base_best_or'))
        pa = next((x for x in st['attempts'] if f"att-{x['n']}" == parent), None)
        if not pa or pa['state'] == 'revoked' or pa['status'] != 'keep' or pa['kind'] != 'attempt':
            raise ValueError(say('kernel.assign.cannot_be_a_parent', parent=parent))
    if st.get('pending') and st['pending'].get('worker') in (worker, '_main'):
        if _run_alive(room):
            raise ValueError(say('kernel.assign.has_a_run_in', worker=worker))
        _reconcile(room, c, st)                        # a run cut off half way: recorded as a crash first
        c, st = _state(room)
    family = 'base' if parent in ('base', f"att-{(st.get('baseline') or {}).get('n')}") else _family(st, int(parent[4:]))
    recent = [a['family'] for a in st['assigns'][-4:]]
    if not force and len(recent) == 4 and family != 'base' and len(set(recent + [family])) == 1:
        raise ValueError(say('kernel.assign.the_last_four_cycles', family=family))
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
    return (say('kernel.assign.cycle_for_from', worker=worker, kind=kind, parent=parent) + (say('kernel.assign.on_idea', idea=idea) if idea else '') + say('kernel.assign.worktree', work=work) + subs
            + (say('kernel.assign.its_own_copies_of', keep=', '.join(keep))
               if keep and fresh else '')
            + (say('kernel.assign.crashes_in_a_row', get=old.get('crashes')) if old.get('crashes') else '')
            + (say('kernel.assign.still_paused_research_resume') + worker if old.get('paused') else ''))


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
    raise ValueError(say('kernel._worker.has_no_worktree_the', name=name))


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
            return None, (say('kernel._measure.build_over_s_killed', v1=c.get('build_s') or 2 * c['budget_s']) if code is None else say('kernel._measure.build_exit', code=code)), \
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
            return None, say('kernel._measure.lines_ambiguous_only_the', len_found=len(found), metric=c['metric']), secs, '', protocol, text
        if not found:
            return None, (say('kernel._measure.no_value_in_the', metric=c['metric']) if c.get('metric_source') == 'file'
                          else f"no \"{c['metric']}:\" line"), secs, '', protocol, text
        v = float(found[0])
        if v != v or abs(v) == float('inf'):
            return None, say('kernel._measure.the_metric_is_not'), secs, '', protocol, text
        values.append(v)
        for g in gvals:
            got = re.findall(rf"^\s*{re.escape(g)}\s*:\s*{NUMBER}\s*$", source, re.MULTILINE)
            if len(got) != 1:
                return None, say('kernel._measure.guard_lines_exactly_one', g=g, len_got=len(got)), secs, '', protocol, text
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
        raise ValueError(say('kernel.evaluate.kind_attempt_fix_smoke', AUX_KINDS=", ".join(AUX_KINDS)))
    _need(room, c, name, 'WORKER')
    held = _gpu_hold(room)
    if held and held['by'] != name:
        raise ValueError(say('kernel.evaluate.the_gpu_is_held', by=held['by'], reason=held['reason'], strftime=time.strftime('%H:%M', time.localtime(held['until'])), v4=' or its build ends' if held.get('pid') else ''))
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
                raise ValueError(say('kernel._locked.another_evaluation_is_running', who=who, v2=format(age, '.0f'), lock=lock))
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
        raise ValueError(say('kernel._locked.could_not_take_the', lock=lock))
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
                                   'desc': say('kernel.lost.interrupted_worktree_lost') + p.get('desc', ''), 'ts': time.time()})
            s2['pending'] = None
        _edit(room, lost)
        _row(room, p['n'], p.get('commit') or '', None, 'crash', 0, '', p.get('by', '?'), say('kernel._reconcile.interrupted_worktree_lost') + p.get('desc', ''),
             p.get('kind', 'attempt'), p.get('idea') or '')
        line = say('kernel._reconcile.att_by_was_interrupted', n=p['n'], get=p.get('by', '?'), exc=exc, key=key)
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
    what = say('kernel._reconcile.the_drafted_files') if p.get('kind') == 'smoke' else c['program']
    line = (say('kernel._reconcile.att_by_was_interrupted2', n=p['n'], get=p.get('by', '?'), what=what) + (say('kernel._reconcile.its_code_stays_in', tag=tag) if has_tag else say('kernel._reconcile.its_code_is_in', commit=commit))
            + (say('kernel._reconcile.git_checkout_brings_the', tag=tag) if p.get('kind') == 'smoke' else ''))
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
            raise ValueError(line + say('kernel._evaluate.edit_the_program_again'))
        c, st = _state(room)                             # another worker's cut-off run: recorded, and this run goes on
    phase = st['phase']
    if kind == 'attempt' and phase != 2:
        raise ValueError(say('kernel._evaluate.attempts_run_in_the', phase=phase, PHASES=PHASES[phase])
                         + ('; in phase 1 use --kind smoke' if phase == 1 else '; in phase 3 use --kind ablation|baseline|control|repeat' if phase == 3 else ''))
    if kind in AUX_KINDS and phase != 3:
        raise ValueError(say('kernel._evaluate.runs_belong_to_the', kind=kind, phase=phase, PHASES=PHASES[phase]))
    if kind == 'smoke' and phase != 1:
        raise ValueError(say('kernel._evaluate.smoke_runs_belong_to'))
    if not c.get('evaluate'):
        raise ValueError(say('kernel._evaluate.the_contract_has_no'))
    key, wk = _worker(st, name)
    work = _check_work(c, wk)
    if not (work / c['program']).is_file():
        raise ValueError(say('kernel._evaluate.is_missing_from_restore', program=c['program'], work=work, head=wk['head']))
    if kind == 'attempt' and seed is not None:
        raise ValueError(say('kernel._evaluate.attempts_use_the_evaluator'))
    if kind == 'attempt':
        if st['evals'] >= c['max_evals']:
            raise ValueError(say('kernel._evaluate.the_budget_of_runs', max_evals=c['max_evals']))
        if wk.get('paused'):
            raise ValueError(say('kernel._evaluate.is_paused_after_crashes', name=name, CRASH_MAX=CRASH_MAX))
        if fix and not wk.get('fix_ok'):
            raise ValueError(say('kernel._evaluate.a_fix_run_needs', name=name))
        if fix and not wk.get('best'):
            raise ValueError(say('kernel._evaluate.a_fix_corrects_a'))
        if wk.get('since_evidence', 0) >= S_MAX and c.get('roles'):
            raise ValueError(say('kernel._evaluate.attempts_without_any_evidence', S_MAX=S_MAX))
    if phase >= 2:
        for rel, sha in c['sealed'].items():
            if not _seal_holds(work, rel, sha):
                raise ValueError(say('kernel._evaluate.the_sealed_file_changed', rel=rel, head=wk["head"]))
    tracked = [x for x in _git(work, 'diff', '--name-only', wk['head']).splitlines() if x.strip()]
    if phase >= 2:
        others = [f for f in tracked if f != c['program']]
        if others:
            raise ValueError(say('kernel._evaluate.only_may_change_also', program=c['program'], others=', '.join(others[:10]), head=wk['head']))
    kept = tuple(c.get('keep', []))
    untracked = [x[3:].strip('"') for x in _git(work, 'status', '--porcelain', '--untracked-files=all').splitlines() if x.startswith('??')]
    untracked = [f for f in untracked if '__pycache__/' not in f and not f.endswith(('.pyc', '.pyo')) and not f.startswith(kept)]
    if untracked and phase >= 2:
        raise ValueError(say('kernel._evaluate.only_may_change_new', program=c['program'], untracked=', '.join(untracked[:10])))
    first = st.get('baseline') is None and kind == 'attempt'
    if kind == 'attempt':
        if first and c['program'] in tracked:
            raise ValueError(say('kernel._evaluate.the_first_run_is', program=c['program'], head=wk['head']))
        if not first and c['program'] not in tracked and wk.get('best'):
            raise ValueError(say('kernel._evaluate.is_the_same_as', program=c['program'], n=wk['best']['n']))
        program_sha = _sha(work / c['program'])
        seen = next((p for p in wk.get('programs', []) if p['sha'] == program_sha), None)
        if seen and not first:
            raise ValueError(say('kernel._evaluate.this_exact_program_already', n=seen['n']))
    if kind in AUX_KINDS:
        if not of or not any(f"att-{a['n']}" == of and a['state'] != 'revoked' for a in st['attempts']):
            raise ValueError(say('kernel._evaluate.a_run_says_what', kind=kind))
    idea = idea or wk.get('idea')
    if idea and not any(i['id'] == idea for i in st['ideas']):
        raise ValueError(say('kernel._evaluate.no_idea', idea=idea))
    desc = ' '.join((desc or ('baseline' if first else '')).split())[:200]
    if not desc:
        raise ValueError(say('kernel._evaluate.say_what_this_run'))
    n = (st['evals'] + 1) if kind == 'attempt' else (AUX_BASE + st['aux'] + 1) if kind in AUX_KINDS else (SMOKE_BASE + st['aux'] + 1)
    tag = f"{c['branch']}/att-{n}"
    if _git(work, 'tag', '--list', tag):
        raise ValueError(say('kernel._evaluate.tag_already_exists_while', tag=tag))
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
    room.append(name, say('kernel._evaluate.att_running_s_budget', n=n, kind=kind, budget_s=c['budget_s']) + (f" x{c['repeats']}" if c.get('repeats', 1) > 1 else '')
                + f"): {desc[:100]}", 'board')
    value, why, secs, spread, protocol, text = _measure(c, work, d, n, env, log, started)
    guards = c.pop('_guards', {}) if value is not None else {}
    base_g = (st.get('baseline') or {}).get('guards') or {}
    if value is not None and kind == 'attempt' and not first:
        for g in c.get('guards', []):
            if g['name'] in base_g and _guard_broken(g, guards[g['name']], base_g[g['name']]):
                value, why = None, (say('kernel._evaluate.guard_median_worse_than', name=g['name'], v2=format(guards[g['name']], '.6g'), v3=format(base_g[g['name']], '.6g'), tol=g['tol']))
                break
    proto = ' | '.join(protocol)
    if value is not None and kind == 'attempt' and st.get('protocol') is not None and proto != st['protocol']:
        value, why = None, say('kernel._evaluate.the_evaluation_protocol_changed', proto=proto[:120], protocol=st['protocol'][:120])
    if value is None:
        status = 'crash'
    elif kind == 'smoke':
        status, why = 'smoke', say('kernel._evaluate.the_evaluator_runs_and')
    elif kind in AUX_KINDS:
        status, why = kind, say('kernel._evaluate.measured_against', of=of)
    else:
        best = wk.get('best') or st.get('baseline')     # a line without a keep yet competes with the baseline
        if fix and best:
            if _not_worse(c, value, best['metric']):
                status, why = 'keep', say('kernel._evaluate.fix_not_worse_than', n=best['n'], v2=format(best['metric'], '.6g')) + \
                    (f" within {c['min_gain']}" if c.get('min_gain') else '')
            else:
                status, why = 'discard', say('kernel._evaluate.fix_worse_than_att', n=best['n'], v2=format(best['metric'], '.6g')) + \
                    (say('kernel._evaluate.by_more_than', min_gain=c['min_gain']) if c.get('min_gain') else '')
        elif first or _better(c, value, best['metric'] if best else None):
            status = 'keep'
            why = 'baseline' if first else (say('kernel._evaluate.better_than_att', n=best['n'], v2=format(best['metric'], '.6g')) if best else say('kernel._evaluate.first_of_this_line'))
        else:
            status, why = 'discard', say('kernel._evaluate.not_better_than_att', n=best['n'], v2=format(best['metric'], '.6g')) + \
                (say('kernel._evaluate.by_more_than', min_gain=c['min_gain']) if c.get('min_gain') else '')
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
    flags = (say('kernel._evaluate.only_numbers_changed_tuning') if tuning and kind == 'attempt' else '') + \
            (say('kernel._evaluate.line_s_put_back', readded=readded) if readded else '')
    line = (say('kernel._evaluate.att_by', n=n, kind=kind, name=name, desc=desc[:100], metric=c['metric'], v6='—' if value is None else f'{value:.6g}')
            + (f' ({spread})' if spread else '') + say('kernel._evaluate.lines', upper=status.upper(), why=why, lines=lines) + flags
            + (say('kernel._evaluate.runs', n=n, max_evals=c['max_evals']) if kind == 'attempt' else ''))
    room.append(name, line, 'board')
    tail = '\n'.join(text.strip().splitlines()[-30:]) if status == 'crash' else ''
    warn = say('kernel._evaluate.warning_some_files_could', held=held[:300]) if held else ''
    c3, s3 = _state(room)
    nudge = ''
    if kind == 'attempt' and s3['workers'][key].get('paused'):
        nudge = say('kernel._evaluate.is_now_paused_after', name=name, CRASH_MAX=CRASH_MAX)
    return line + (say('kernel._evaluate.log_last_lines', log=log, tail=tail) if tail else f'\nlog: {log}') + warn + nudge


def resume(room, by, worker):
    if by not in room.user_names():
        raise ValueError(say('kernel.resume.only_the_lead_or'))
    key = _edit(room, lambda c, st: (_worker(st, worker)[1].update(paused=False, crashes=0, since_evidence=0), _worker(st, worker)[0])[1])
    _log(room, by, 'resume', worker)
    return say('kernel.resume.resumed_by', worker=worker, by=by)


def reanchor(room, by, data):
    """a worker at the end of a segment chooses where its line goes on: from its current state or from an earlier attempt
    (anchor), extending that route or redirecting from it, with the bottleneck, the evidence and the next focus. The
    kernel checks it and restores the worktree to the anchor"""
    c, st = _state(room)
    _need(room, c, by, 'WORKER')
    if st['phase'] != 2:
        raise ValueError(say('kernel.reanchor.re_anchoring_belongs_to'))
    keys = ('anchor', 'direction', 'bottleneck', 'supporting_evidence', 'decision_reason', 'next_search_focus')
    if not isinstance(data, dict) or any(k not in data for k in keys):
        raise ValueError(say('kernel.reanchor.a_re_anchoring_is') + ', '.join(keys))
    if data['direction'] not in ('extend', 'redirect'):
        raise ValueError(say('kernel.reanchor.direction_extend_or_redirect'))
    if not isinstance(data['supporting_evidence'], list):
        raise ValueError(say('kernel.reanchor.supporting_evidence_is_a'))
    known = {f"att-{a['n']}" for a in st['attempts'] if a['state'] != 'revoked'} | {e['id'] for e in st['evidence'] if e['state'] in ('tentative', 'committed')}
    bad = [x for x in data['supporting_evidence'] if x not in known]
    if bad:
        raise ValueError(say('kernel.reanchor.unknown_or_revoked_evidence', bad=', '.join(bad)))
    key, wk = _worker(st, by)
    if st.get('pending') and st['pending'].get('worker') == key:
        raise ValueError(say('kernel.reanchor.a_run_of_yours'))
    anchor = data['anchor']
    if anchor == 'current':
        commit, best = wk['head'], wk.get('best')
    else:
        a = next((x for x in st['attempts'] if f"att-{x['n']}" == anchor), None)
        if not a or a['state'] == 'revoked' or a['status'] != 'keep' or a['kind'] != 'attempt':
            raise ValueError(say('kernel.reanchor.is_not_a_state', anchor=anchor))
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
    return (say('kernel.reanchor.re_anchors_at_and', by=by, anchor=anchor, direction=data['direction'], str_bottleneck=str(data['bottleneck'])[:120], str_next_search_focus=str(data['next_search_focus'])[:120]))


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
        raise ValueError(say('kernel.propose_idea.ideas_are_proposed_in'))
    if not isinstance(data, dict):
        raise ValueError(say('kernel.propose_idea.an_idea_is_a'))
    missing = [k for k in ('title', 'hypothesis', 'plan', 'changes', 'prior_work', 'mode') if not str(data.get(k, '')).strip()]
    rub = data.get('rubrics') if isinstance(data.get('rubrics'), dict) else {}
    if not rub.get('metric') or not rub.get('implementation'):
        missing.append(say('kernel.propose_idea.rubrics_metric_and_rubrics'))
    if missing:
        raise ValueError(say('kernel.propose_idea.the_idea_lacks') + ', '.join(missing) + say('kernel.propose_idea.prior_work_may_be'))
    if data['changes'] not in ('question', 'method', 'both'):
        raise ValueError(say('kernel.propose_idea.changes_question_method_or'))
    if data['mode'] != st['next_mode']:
        raise ValueError(say('kernel.propose_idea.the_next_idea_is', next_mode=st['next_mode']) + (
            say('kernel.propose_idea.what_is_missing_or') if st['next_mode'] == 'gap'
            else say('kernel.propose_idea.a_solution_taken_from')))
    text = _idea_text(data)
    near = max(((_similarity(text, _idea_text(i)), i['id']) for i in st['ideas']), default=(0.0, None))
    if near[0] > SIMILAR:
        raise ValueError(say('kernel.propose_idea.too_close_to_similarity', near=near[1], v2=format(near[0], '.2f')))
    recent = [i['changes'] for i in st['ideas'] if i['status'] != 'rejected'][-3:]
    if len(recent) == 3 and all(x == 'method' for x in recent) and data['changes'] == 'method':
        raise ValueError(say('kernel.propose_idea.three_ideas_in_a'))

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
    return say('kernel.propose_idea.idea_changes_the', iid=iid, mode=data['mode'], changes=data['changes'], str_title=str(data['title'])[:140])


# ---------------------------------------------------------------------------------------------------------- evidence
def propose_evidence(room, by, text, source):
    """what was learned, with where it comes from: att-N, an evidence id, or a link. Tentative until the registrar curates it"""
    c, st = _state(room)
    _need(room, c, by, 'WORKER', 'SEARCHER', 'REGISTRAR', 'PROPOSER')
    text = ' '.join((text or '').split())
    if not text:
        raise ValueError(say('kernel.propose_evidence.evidence_needs_a_text'))
    if not source:
        raise ValueError(say('kernel.propose_evidence.evidence_needs_its_source'))
    srcs = [s.strip() for s in source.split(',') if s.strip()]
    for s in srcs:
        if re.fullmatch(r'att-\d+', s):
            a = next((x for x in st['attempts'] if f"att-{x['n']}" == s), None)
            if not a:
                raise ValueError(say('kernel.propose_evidence.no_attempt', s=s))
            if a['state'] == 'revoked':
                raise ValueError(say('kernel.propose_evidence.was_revoked_it_cannot', s=s))
        elif re.fullmatch(r'E\d+', s):
            if not any(e['id'] == s and e['state'] in ('tentative', 'committed') for e in st['evidence']):
                raise ValueError(say('kernel.propose_evidence.no_live_evidence', s=s))
        elif not re.fullmatch(r'https?://\S{4,}', s):
            raise ValueError(say('kernel.propose_evidence.source_att_n_e', s=s))

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
    return say('kernel.propose_evidence.evidence_tentative_from', eid=eid, srcs=", ".join(srcs), text=text[:160])


def curate(room, by, accept=(), reject=(), drop=()):
    """the registrar decides: tentative evidence accepted (committed) or rejected, committed evidence dropped to make room.
    At most CURATED_MAX committed at once"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    accept, reject, drop = (list(dict.fromkeys(x)) for x in (accept, reject, drop))
    both = (set(accept) & set(reject)) | (set(accept) & set(drop)) | (set(reject) & set(drop))
    if both:
        raise ValueError(say('kernel.curate.one_decision_per_piece', sorted=', '.join(sorted(both))))

    def apply(c2, s2):
        ev = {e['id']: e for e in s2['evidence']}
        for eid in [*accept, *reject]:
            if eid not in ev or ev[eid]['state'] != 'tentative':
                raise ValueError(say('kernel.apply.is_not_tentative_evidence', eid=eid))
        for eid in drop:
            if eid not in ev or ev[eid]['state'] != 'committed':
                raise ValueError(say('kernel.apply.is_not_committed_evidence', eid=eid))
        live = sum(1 for e in s2['evidence'] if e['state'] == 'committed') - len(drop) + len(accept)
        if live > CURATED_MAX:
            raise ValueError(say('kernel.apply.committed_pieces_of_evidence', live=live, CURATED_MAX=CURATED_MAX))
        for eid in accept:
            ev[eid]['state'] = 'committed'
        for eid in reject:
            ev[eid]['state'] = 'rejected'
        for eid in drop:
            ev[eid]['state'] = 'superseded'
        return live
    live = _edit(room, apply)
    _log(room, by, 'curate', {'accept': list(accept), 'reject': list(reject), 'drop': list(drop)})
    return say('kernel.curate.curated_by_accepted_rejected', by=by, v2=', '.join(accept) or '-', v3=', '.join(reject) or '-', v4=', '.join(drop) or '-', live=live)


def direction(room, by, data):
    """the registrar's map of the search: the direction now, those still open, those that gave nothing, those finished"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    keys = ('active', 'searchable', 'no_positive', 'completed', 'change_summary')
    if not isinstance(data, dict) or set(data) - set(keys) or not data.get('active') or not data.get('change_summary'):
        raise ValueError(say('kernel.direction.a_direction_is_json'))
    for k in ('searchable', 'no_positive', 'completed'):
        if k in data and not isinstance(data[k], list):
            raise ValueError(f'{k} is a list')

    new = {k: data.get(k, [] if k in ('searchable', 'no_positive', 'completed') else '') for k in keys}
    if new == st.get('direction'):
        raise ValueError(say('kernel.direction.the_direction_is_the'))

    def apply(c2, s2):
        s2['direction'] = new
        s2['history'].append({'ts': time.time(), 'by': by, **s2['direction']})
    _edit(room, apply)
    _log(room, by, 'direction', data)
    return say('kernel.direction.direction_by_change', by=by, _words=_words(data['active'], 200), _words_=_words(data['change_summary'], 200))


def _words(value, limit):
    """a text cut at a word, with … when cut"""
    text = ' '.join(str(value).split())
    return text if len(text) <= limit else text[:limit].rsplit(' ', 1)[0].rstrip(',;:(') + ' …'


def conclude(room, by, worker, gate, trigger, text):
    """the registrar's distilled conclusion for a worker's line: at most 300 words, and whether it changed what we believe"""
    c, st = _state(room)
    _need(room, c, by, 'REGISTRAR')
    if gate not in ('updated', 'kept', 'skipped'):
        raise ValueError(say('kernel.conclude.gate_updated_kept_or'))
    if trigger not in ('a', 'b', 'c', 'd', 'none'):
        raise ValueError(say('kernel.conclude.trigger_a_new_best'))
    if len((text or '').split()) > 300 or not (text or '').strip():
        raise ValueError(say('kernel.conclude.a_conclusion_is_to'))
    refs = re.findall(r'\b(att-\d+|E\d+)\b', text)
    _edit(room, lambda c2, s2: s2['conclusions'].update({worker: {'gate': gate, 'trigger': trigger, 'text': text.strip(),
                                                                    'refs': refs, 'state': 'committed', 'by': by, 'ts': time.time()}}))
    _log(room, by, 'conclude', {'worker': worker, 'gate': gate})
    return say('kernel.conclude.conclusion_for_by_gate', worker=worker, by=by, gate=gate, trigger=trigger)


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
        raise ValueError(say('kernel._revoke.a_revocation_says_why'))
    if not re.fullmatch(r'att-\d+|E\d+', target or ''):
        raise ValueError(say('kernel._revoke.revoke_att_n_or'))
    if target.startswith('att-'):
        if st.get('baseline') and target == f"att-{st['baseline']['n']}":
            raise ValueError(say('kernel._revoke.the_baseline_cannot_be'))
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
                        x['state'], x['revoked_why'] = 'revoked', (reason if f"att-{x['n']}" == target else say('kernel.apply.built_on', target=target, reason=reason))
                        gone.add(f"att-{x['n']}")
                        changed = True
        elif not any(e['id'] == target for e in s2['evidence']):
            raise ValueError(f'no {target}')
        changed = True
        while changed:
            changed = False
            for e in s2['evidence']:
                if e['state'] in ('tentative', 'committed') and (e['id'] in gone or any(s in gone for s in e['source'])):
                    e['state'], e['revoked_why'] = 'revoked', say('kernel.apply.rests_on', target=target, reason=reason)
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
    return say('kernel._revoke.revoked_by_also_withdrawn', target=target, by=by, reason=reason[:120], v4=', '.join(x for x in gone if x != target) or 'nothing')


def verdict(room, by, phase, outcome, scores=None, coverage=None, missing=None, next_intent=None, notes=''):
    """the auditor at a gate: pass or fail (drafting, report), answer_ready or search_more (investigation), with scores
    0, 1.5 or 3 on the items it chose, the coverage of each requirement and, when it asks for more, one next intent"""
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    allowed = {1: ('pass', 'fail'), 2: ('answer_ready', 'search_more'), 3: ('pass', 'fail'), 5: ('pass', 'fail')}
    if int(phase) not in allowed or outcome not in allowed[int(phase)]:
        raise ValueError(say('kernel.verdict.verdicts_phase_pass_fail'))
    if int(phase) != st['phase']:
        raise ValueError(say('kernel.verdict.the_research_is_in', phase=st['phase'], PHASES=PHASES[st['phase']]))
    scores = scores or {}
    if not isinstance(scores, dict) or any(v not in (0, 1.5, 3, '0', '1.5', '3') for v in scores.values()):
        raise ValueError(say('kernel.verdict.scores_item_missing_or'))
    if outcome == 'search_more' and not next_intent:
        raise ValueError(say('kernel.verdict.search_more_needs_one'))
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
    return say('kernel.verdict.verdict_at_phase_by', phase=phase, by=by, upper=outcome.upper(), score=score) + (f' · next: {next_intent[:160]}' if next_intent else '')


def allow_fix(room, by, worker, reason):
    """the auditor (or the lead) lets a worker's next run be a fix: kept if not worse than its best by more than the
    minimal gain, because it corrects something (safety, a race, a wrong result) rather than gaining speed"""
    c, st = _state(room)
    _need(room, c, by, 'AUDITOR')
    if not reason:
        raise ValueError(say('kernel.allow_fix.say_what_it_corrects'))
    key, wk = _worker(st, worker)
    _edit(room, lambda c2, s2: s2['workers'][key].update(fix_ok={'by': by, 'reason': reason, 'ts': time.time()}))
    _log(room, by, 'allow-fix', {'worker': key, 'reason': reason})
    return say('kernel.allow_fix.allows_one_fix_run', by=by, worker=worker, reason=reason[:160])


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
        raise ValueError(say('kernel.hold.as_name_who_holds'))
    if not reason:
        raise ValueError(say('kernel.hold.say_what_for_reason'))
    minutes = float(minutes or 0)
    top = 720 if by in room.user_names() else 120
    if not (0 < minutes <= top):
        raise ValueError(say('kernel.hold.minutes_how_long_more', top=top))
    other = _gpu_hold(room)
    if other and other['by'] != by:
        raise ValueError(say('kernel.hold.the_gpu_is_already', by=other['by'], reason=other['reason']))
    if _run_alive(room):
        raise ValueError(say('kernel.hold.a_run_is_in'))
    h = {'by': by, 'reason': reason, 'until': time.time() + minutes * 60, 'pid': None}
    from chat import write_atomic
    write_atomic(_dir(room) / 'gpu.hold', json.dumps(h))
    _log(room, by, 'hold', h)
    return say('kernel.hold.gpu_held_by_for', by=by, v2=format(minutes, 'g'), reason=reason[:160])


def release(room, by):
    h = _gpu_hold(room)
    if not h:
        (_dir(room) / 'gpu.hold').unlink(missing_ok=True)
        return say('kernel.release.the_gpu_is_free')
    if h['by'] != by and by not in room.user_names():
        raise ValueError(say('kernel.release.the_gpu_is_held', by=h['by']))
    (_dir(room) / 'gpu.hold').unlink(missing_ok=True)
    _log(room, by, 'release', {'held_by': h['by']})
    return say('kernel.release.gpu_released_by_held', by=by, by_=h['by'], reason=h['reason'][:120])


def prebuild(room, by, worker):
    """the lead builds a worker's worktree before its first run, outside the run budget: the build runs detached (a
    session's background reaper cannot kill it), logs to runs/prebuild-WORKER.log, and holds the GPU until it exits"""
    if by not in room.user_names():
        raise ValueError(say('kernel.prebuild.only_the_lead_or'))
    c, st = _state(room)
    if not c.get('build'):
        raise ValueError(say('kernel.prebuild.the_contract_has_no'))
    key, wk = _worker(st, worker)
    work = _check_work(c, wk)
    other = _gpu_hold(room)
    if other:
        raise ValueError(say('kernel.prebuild.the_gpu_is_held', by=other['by'], reason=other['reason']))
    if _run_alive(room):
        raise ValueError(say('kernel.prebuild.a_run_is_in'))
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
    h = {'by': by, 'reason': say('kernel.prebuild.prebuild_of', key=key), 'until': time.time() + limit, 'pid': proc.pid, 'log': str(log), 'exit': str(done)}
    from chat import write_atomic
    write_atomic(_dir(room) / 'gpu.hold', json.dumps(h))
    _log(room, by, 'prebuild', h)
    return (say('kernel.prebuild.prebuild_of_started_pid', key=key, pid=proc.pid, log=log))


# ---------------------------------------------------------------------------------------------------------- phases
def _last_verdict(st, phase):
    return next((v for v in reversed(st['verdicts']) if v['phase'] == phase), None)


def _settle(room, c, st, locked=False):
    """no phase moves while a run is in progress; a run cut off half way is recorded (as a crash) first. locked: the
    caller holds eval.lock, so a pending run can only be a dead one"""
    if st.get('pending'):
        if not locked and _run_alive(room):
            raise ValueError(say('kernel._settle.att_is_running_wait', n=st['pending']['n']))
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
        raise ValueError(say('kernel.seal.only_the_lead_or'))
    c, st = _state(room)
    return _locked(room, c, by, lambda: _seal(room, by, sealed))


def _seal(room, by, sealed):
    c, st = _state(room)
    if st['phase'] != 1:
        raise ValueError(say('kernel._seal.seal_belongs_to_the'))
    c, st = _settle(room, c, st, locked=True)
    if not st.get('smoke_ok'):
        raise ValueError(say('kernel._seal.no_smoke_run_has'))
    if c.get('roles', {}).get('AUDITOR') and not _verdict_holds(room, st, 1, 'pass'):
        raise ValueError(say('kernel._seal.the_auditor_has_not'))
    work = _check_work(c, {'work': c['work'], 'branch': c['branch']})
    smoke = next(a for a in st['attempts'] if a['n'] == st['smoke_ok'])
    later = [a['n'] for a in st['attempts'] if a['kind'] == 'smoke' and a['n'] > smoke['n']]
    if later:
        raise ValueError(say('kernel._seal.the_last_good_smoke', n=smoke['n'], later=later[-1]))
    commit = _git(work, 'rev-parse', smoke['commit'])
    _git(work, 'reset', '-q', '--hard', commit)
    _clean(work, c)
    seals = {}
    for rel in c['sealed']:                               # the drafted evaluator is what gets sealed, not the empty start
        if not (work / rel).is_file():
            raise ValueError(say('kernel._seal.sealed_file_is_not', rel=rel))
        seals[rel] = _git(work, 'rev-parse', f'{commit}:{rel}')
    for f in sealed:
        rel = _rel(Path(c['repo']), f) if Path(f).is_absolute() else Path(f).as_posix()
        if rel == c['program']:
            raise ValueError(say('kernel._seal.is_the_program_it', rel=rel))
        if not (work / rel).is_file() or not _git(work, 'ls-files', '--', rel):
            raise ValueError(say('kernel._seal.sealed_file_is_not2', rel=rel))
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
    return say('kernel._seal.sealed_by_at_phase', by=by, commit=commit[:7], v3=', '.join(seals) or 'no files')


def phase_next(room, by, force=''):
    """one step forward, when its gate holds: 2 to 3 needs the auditor's answer_ready (or the budget used up); 3 to 4 needs
    evidence runs (ablation, baseline...) or a forced "degraded"; 5 to 6 needs a report and the auditor's pass"""
    if by not in room.user_names():
        raise ValueError(say('kernel.phase_next.only_the_lead_or'))
    return _locked(room, _state(room)[0], by, lambda: _phase_next(room, by, force))


def _phase_next(room, by, force):
    c, st = _settle(room, *_state(room), locked=True)
    p = st['phase']
    auditor = bool(c.get('roles', {}).get('AUDITOR'))
    why, aux = '', []
    if p == 1:
        why = say('kernel._phase_next.phase_ends_with_research')
    elif p == 2:
        ready = _verdict_holds(room, st, 2, 'answer_ready') or not auditor
        why = '' if ready or st['evals'] >= c['max_evals'] else say('kernel._phase_next.the_auditor_has_not')
        if st['best'] is None:
            why = say('kernel._phase_next.there_is_no_kept')
    elif p == 3:
        aux = [a for a in st['attempts'] if a['kind'] in AUX_KINDS and a['status'] != 'crash']
        why = '' if aux or force == 'degraded' else say('kernel._phase_next.no_ablation_baseline_or')
        if auditor and not _verdict_holds(room, st, 3, 'pass') and force != 'degraded':
            why = why or say('kernel._phase_next.the_auditor_has_not2')
    elif p == 4:
        why = '' if st.get('final') or not c.get('final') else say('kernel._phase_next.run_the_final_evaluator')
    elif p == 5:
        report = _dir(room) / 'report.md'
        why = '' if report.is_file() else say('kernel._phase_next.write_room_research_report')
        if not why:
            text = report.read_text(encoding='utf-8', errors='replace')
            left = [h for h in re.findall(r'<[^<>\n]+>', CHECKLIST + DEGRADED_LINE) if h in text]
            why = say('kernel._phase_next.the_report_still_has', len_set=len(set(left)), sorted=sorted(set(left))[0][:60]) if left else ''
            if not why and st.get('degraded') and 'DEGRADED' not in text:
                why = say('kernel._phase_next.the_research_is_degraded')
        if not why and auditor and not _verdict_holds(room, st, 5, 'pass'):
            why = say('kernel._phase_next.the_auditor_has_not3')
    else:
        why = say('kernel._phase_next.the_research_is_closed')
    if why:
        raise ValueError(say('kernel._phase_next.phase_cannot_end_yet', p=p, PHASES=PHASES[p], why=why))
    skipped = p == 3 and force == 'degraded' and (not aux or (auditor and not _verdict_holds(room, st, 3, 'pass')))
    _edit(room, lambda c2, s2: s2.update(phase=p + 1, degraded=skipped or s2.get('degraded', False)))
    _log(room, by, 'phase', {'from': p, 'to': p + 1, 'force': force})
    return say('kernel._phase_next.research_phase', v1=p + 1, PHASES=PHASES[p + 1]) + (say('kernel._phase_next.degraded_evidence_not_run') if skipped else '')


def final(room, by):
    """phase 4: the final evaluator, once, on the best program, on data nobody used before"""
    if by not in room.user_names():
        raise ValueError(say('kernel.final.only_the_lead_or'))
    c, st = _state(room)
    if st['phase'] != 4:
        raise ValueError(say('kernel.final.the_final_evaluation_belongs'))
    if st.get('final'):
        raise ValueError(say('kernel.final.the_final_evaluation_ran'))
    if not c.get('final'):
        raise ValueError(say('kernel.final.the_contract_has_no'))
    if not st['best']:
        raise ValueError(say('kernel.final.no_best_program_to'))
    held = _gpu_hold(room)
    if held and held['by'] != by:
        raise ValueError(say('kernel.final.the_gpu_is_held', by=held['by'], reason=held['reason']))
    return _locked(room, c, by, lambda: _final(room, by))


def _final(room, by):
    _check_kernel(room)
    c, st = _state(room)
    if st.get('pending'):                                 # under the lock: a pending run was cut off, record it first
        _reconcile(room, c, st)
        c, st = _state(room)
    if st.get('final'):
        raise ValueError(say('kernel._final.the_final_evaluation_ran'))
    work = _check_work(c, {'work': c['work'], 'branch': c['branch']})
    if _git(work, 'status', '--porcelain', '--untracked-files=no', check=False):
        raise ValueError(say('kernel._final.has_uncommitted_changes_the', work=work))
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
    line = say('kernel._final.final_evaluation_of_att', n=st['best']['n'], metric=c['metric'], v3='—' if value is None else f'{value:.6g}') + \
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
        return say('kernel.checklist.report_skeleton_written_to', path=path)
    return say('kernel.checklist.exists_its_sections', path=path) + text


# ---------------------------------------------------------------------------------------------------------- views
def _cut(text, limit=VIEW_MAX):
    return text if len(text) <= limit else text[:limit - 60] + say('kernel._cut.more_characters_research_expand', v1=len(text) - limit + 60)


def view(room, name):
    """what a role needs to see, bounded: a worker its contract, its line and what not to repeat; the proposer the ideas
    and their outcomes; the registrar the evidence to curate; the auditor what to check. research expand ID opens one record"""
    c, st = _state(room)
    role = _role_of(c, name) or ('LEAD' if name in room.user_names() else 'WORKER')
    att = st['attempts']
    head = (say('kernel.view.research_phase_runs_best', tag=c['tag'], phase=st['phase'], PHASES=PHASES[st['phase']], evals=st['evals'], max_evals=c['max_evals'])
            + (f"att-{st['best']['n']} {st['best']['metric']:.6g} ({st['best'].get('worker', '?')})" if st['best'] else 'none')
            + (say('kernel.view.degraded_no_evidence_runs') if st.get('degraded') else '') + say('kernel.view.you', role=role))
    out = [head]
    tried = lambda xs: '; '.join(f"att-{a['n']} {a['desc'][:50]} → {a['status']}" for a in xs)
    key = None
    if role == 'WORKER':
        try:
            key, wk = _worker(st, name)
            out.append(say('kernel.view.your_worktree_from_as', work=wk['work'], get=wk.get('parent'), get_=wk.get('type'))
                       + (f"att-{wk['best']['n']} {wk['best']['metric']:.6g}" if wk.get('best') else 'none')
                       + (f" · idea {wk['idea']}" if wk.get('idea') else '') + (' · PAUSED' if wk.get('paused') else ''))
            if wk.get('idea'):
                i = next((x for x in st['ideas'] if x['id'] == wk['idea']), None)
                if i:
                    out.append(say('kernel.view.idea_plan_rubrics', id=i['id'], title=i['title'], hypothesis=i['hypothesis'][:300], plan=i['plan'][:400], rubrics=i['rubrics']))
            mine = [a for a in att if a['worker'] == key][-8:]
            out.append(say('kernel.view.your_line') + (tried(mine) or say('kernel.view.nothing_yet')))
            cc = st['conclusions'].get(key)
            if cc:
                out.append(say('kernel.view.registrar_s_conclusion_on', state=cc['state'], text=cc['text'][:500]))
            path = _dir(room) / f'findings-{key}.md'
            if path.is_file():
                out.append(say('kernel.view.findings_of_your_line') + '\n'.join(path.read_text(encoding='utf-8').splitlines()[-10:]))
        except ValueError as exc:
            out.append(str(exc))
        fails = [a for a in att if a['status'] in ('discard', 'crash') and a['worker'] != key][-6:]
        if fails:
            out.append(say('kernel.view.do_not_repeat_other') + tried(fails))
    elif role == 'PROPOSER':
        out.append(say('kernel.view.next_idea_mode_direction', next_mode=st['next_mode'], get=st['direction'].get('active', '-')))
        for i in st['ideas'][-12:]:
            res = [a for a in att if a.get('idea') == i['id']]
            out.append(f"{i['id']} [{i['mode']}/{i['changes']}] {i['title'][:80]} → " + (', '.join(f"att-{a['n']} {a['status']}" for a in res) or i['status']))
        if st['gaps']:
            out.append(say('kernel.view.open_gaps') + '; '.join(g['text'][:120] for g in st['gaps'][-4:]))
        if st['direction'].get('no_positive'):
            out.append(say('kernel.view.gave_nothing') + '; '.join(map(str, st['direction']['no_positive']))[:400])
    elif role == 'REGISTRAR':
        tent = [e for e in st['evidence'] if e['state'] == 'tentative']
        live = [e for e in st['evidence'] if e['state'] == 'committed']
        out.append(say('kernel.view.committed_to_curate', len_live=len(live), CURATED_MAX=CURATED_MAX) + ('; '.join(f"{e['id']} ({','.join(e['source'])}) {e['text'][:100]}" for e in tent) or 'none'))
        out.append(say('kernel.view.latest_runs') + tried(att[-8:]))
        out.append('direction: ' + json.dumps(st['direction'], ensure_ascii=False)[:500])
        out.append('conclusions: ' + ('; '.join(f"{k} ({cc['gate']}, {cc['state']}) {cc['text'][:120]}" for k, cc in st['conclusions'].items()) or 'none'))
        idle = [k for k, w in st['workers'].items() if w.get('since_evidence', 0) >= S_MAX - 1]
        if idle:
            out.append(say('kernel.view.workers_near_the_evidence') + ', '.join(idle))
    elif role in ('AUDITOR', 'LEAD'):
        keeps = [a for a in att if a['status'] == 'keep' and a['state'] != 'revoked'][-6:]
        out.append(say('kernel.view.keeps_to_check_git') + ('; '.join(f"att-{a['n']} {c['branch']}/att-{a['n']} {a['desc'][:60]}" for a in keeps) or 'none'))
        flags = detectors(c, st)
        if flags:
            out.append('detectors: ' + ' | '.join(flags))
        quar = [k for k, cc in st['conclusions'].items() if cc['state'] == 'quarantined']
        if quar:
            out.append(say('kernel.view.quarantined_conclusions_they_cite') + ', '.join(quar))
        last = st['verdicts'][-1] if st['verdicts'] else None
        if last:
            out.append(say('kernel.view.last_verdict_phase', phase=last['phase'], outcome=last['outcome']))
        out.append(say('kernel.view.live_evidence') + ('; '.join(f"{e['id']} {e['text'][:80]}" for e in st['evidence'] if e['state'] == 'committed')[:900] or 'none'))
    elif role == 'SEARCHER':
        out.append(say('kernel.view.task_metric_direction', program=c['program'], metric=c['metric'], get=st['direction'].get('active', '-')))
        out.append(say('kernel.view.evidence_so_far') + ('; '.join(f"{e['id']} {e['text'][:80]}" for e in st['evidence'] if e['state'] in ('tentative', 'committed'))[:1200] or 'none'))
        if st['gaps']:
            out.append(say('kernel.view.open_questions') + '; '.join(g['text'][:120] for g in st['gaps'][-4:]))
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
            return json.dumps(a, indent=1, ensure_ascii=False) + say('kernel.expand.code_git_show_att', branch=c['branch'], n=a['n'], v3=_dir(room) / 'runs' / (str(a['n']) + '.log'))
    if rid in st['workers']:
        return json.dumps(st['workers'][rid], indent=1, ensure_ascii=False)[:4000]
    raise ValueError(say('kernel.expand.no_record_ideas_i', rid=rid))


def detectors(c, st):
    """the research's own warnings: lines put back, retuning only, stalls, a protocol that moved, search against final"""
    out = []
    for key, w in st['workers'].items():
        mine = [a for a in st['attempts'] if a['worker'] == key and a['kind'] == 'attempt'][-10:]
        added = sum(a.get('added', 0) for a in mine)
        readded = sum(a.get('readded', 0) for a in mine)
        if added >= 10 and readded / added > 0.3:
            out.append(say('kernel.detectors.of_added_lines_were', key=key, readded=readded, added=added))
        tun = [a for a in mine[-8:] if a.get('tuning')]
        if len(mine) >= 4 and len(tun) > len(mine[-8:]) / 2:
            out.append(say('kernel.detectors.of_its_last_attempts', key=key, len_tun=len(tun), len_mine=len(mine[-8:])))
        if w.get('paused'):
            out.append(say('kernel.detectors.paused_after_crashes', key=key, CRASH_MAX=CRASH_MAX))
    runs = [a for a in st['attempts'] if a['kind'] == 'attempt']
    keeps = [a for a in runs if a['status'] == 'keep']
    if len(runs) >= 10 and keeps and runs[-1]['n'] - keeps[-1]['n'] >= 10:
        out.append(say('kernel.detectors.no_keep_in_the', v1=runs[-1]['n'] - keeps[-1]['n']))
    ideas = st['ideas']
    if len(ideas) >= 4:
        sims = [_similarity(_idea_text(a), _idea_text(b)) for i, a in enumerate(ideas) for b in ideas[i + 1:]]
        if sum(sims) / len(sims) > 0.25:
            out.append(say('kernel.detectors.ideas_are_narrowing_mean', v1=format(sum(sims) / len(sims), '.2f')))
    if st.get('final') and st['final'].get('metric') is not None and st['best']:
        out.append(say('kernel.detectors.search_vs_final', v1=format(st['final']['search_metric'], '.6g'), v2=format(st['final']['metric'], '.6g')))
    return out


def status(room):
    c, st = _state(room)
    rows = (_dir(room) / 'results.tsv').read_text(encoding='utf-8').splitlines()[1:]
    counts = {k: sum(1 for r in rows if r.split('\t')[3] == k) for k in ('keep', 'discard', 'crash')}
    best = st['best']
    head = (say('kernel.status.research_phase_metric_from', tag=c['tag'], phase=st['phase'], PHASES=PHASES[st['phase']], program=c['program'], metric=c['metric'], direction=c['direction'], v7=say('kernel.word.result_file') if c.get('metric_source') == 'file' else say('kernel.word.output_unsafe'))
            + (say('kernel.status.median_of', repeats=c['repeats']) if c.get('repeats', 1) > 1 else '') + (say('kernel.status.min_gain', min_gain=c['min_gain']) if c.get('min_gain') else '') + say('kernel.status.runs_of_s_keep', evals=st['evals'], max_evals=c['max_evals'], budget_s=c['budget_s'], keep=counts['keep'], discard=counts['discard'], crash=counts['crash'])
            + (say('kernel.status.best_att', n=best['n'], v2=format(best['metric'], '.6g'), commit=best['commit'], get=best.get('worker', '')) if best else say('kernel.status.no_baseline_yet'))
            + (say('kernel.status.att_in_progress_or', n=st['pending']['n']) if st.get('pending') else '')
            + (say('kernel.status.degraded_phase_closed_without') if st.get('degraded') else ''))
    for f in sorted((_dir(room) / 'runs').glob('prebuild-*.exit')):
        code = f.read_text(errors='replace').strip()
        head += say('kernel.status.prebuild_of', stem=f.stem[9:]) + (say('kernel.status.done_exit') if code == '0' else say('kernel.status.failed_exit_log', code=code, with_suffix=f.with_suffix(".log")))
    held = _gpu_hold(room)
    if held:
        head += (say('kernel.status.gpu_held_by', by=held['by'], reason=held['reason']) + (say('kernel.status.pid_log', pid=held['pid'], get=held.get('log')) if held.get('pid')
                 else f" until {time.strftime('%H:%M', time.localtime(held['until']))}"))
    lines = [head]
    if len(st['workers']) > 1 or '_main' not in st['workers']:
        lines.append('workers: ' + '; '.join(f"{k} " + (say('kernel.status.best_att2', n=w['best']['n'], v2=format(w['best']['metric'], '.6g')) if w.get('best') else say('kernel.status.no_best'))
                                             + say('kernel.status.from', get=w.get('type'), get_=w.get('parent')) + (' PAUSED' if w.get('paused') else '')
                                             + (say('kernel.status.crashes_in_a_row', crashes=w['crashes']) if w.get('crashes') else '')
                                             + (say('kernel.status.fix_allowed') if w.get('fix_ok') else '')
                                             for k, w in st['workers'].items() if k != '_main'))
    if st['ideas']:
        lines.append(say('kernel.status.ideas_next_evidence_committed', len_ideas=len(st['ideas']), next_mode=st['next_mode'], sum=sum(1 for e in st['evidence'] if e['state'] == 'committed'), sum_=sum(1 for e in st['evidence'] if e['state'] == 'tentative')))
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
        raise ValueError(say('kernel.panel.set_openrouter_api_key'))
    if not question or not question.strip():
        raise ValueError(say('kernel.panel.a_panel_needs_a'))
    req = urllib.request.Request('https://openrouter.ai/api/v1/models', headers={'Authorization': f'Bearer {key}'})
    models = json.loads(urllib.request.urlopen(req, timeout=60).read())['data']
    free = [m for m in models if str(m.get('pricing', {}).get('prompt')) in ('0', '0.0') and str(m.get('pricing', {}).get('completion')) in ('0', '0.0')]
    size = lambda m: (int(m.get('context_length') or 0), m.get('id', ''))
    free.sort(key=lambda m: ('stealth' not in (m.get('name', '') + m.get('description', '')).lower(), -size(m)[0]))
    path = Path(out) if out else _dir(room) / f"panel-{time.strftime('%m%d-%H%M')}.md"
    head = (say('kernel.panel.panel_free_models_on', strip=question.strip()))
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
            text = say('kernel.panel.no_answer', __name__=type(exc).__name__, str_exc=str(exc)[:200])
        answers.append(f"## {m['id']}\n\n{text.strip()}\n")
        with open(path, 'a', encoding='utf-8') as f:     # each answer saved as it comes: a stopped panel keeps what it got
            f.write(answers[-1] + '\n')
        time.sleep(3.2)                                   # 20 requests a minute on free models
    _log(room, by, 'panel', {'models': [m['id'] for m in free[:limit]], 'file': str(path)})
    return (say('kernel.panel.panel_of_free_models', len_answers=len(answers), path=path))


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
        raise ValueError(say('kernel._json_arg.not_valid_json', exc=exc))


def cmd(room, a):
    """chat.py research <action>: see the module's docstring. A refused action is logged too (log.jsonl, ok false)"""
    try:
        return _cmd(room, a)
    except ValueError as exc:
        act = a.pairs[0] if a.pairs else 'status'
        if act == 'assign':
            room.append(a.name or 'LEAD', say('kernel.cmd.assign_refused', pairs=' '.join(a.pairs[1:2]), str_exc=str(exc)[:300]), 'board')
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
            sys.exit(say('kernel._cmd.research_init_program_file'))
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
            sys.exit(say('kernel._cmd.as_name_required'))
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
    sys.exit(say('kernel._cmd.research_init_amend_roles'))
