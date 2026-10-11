"""The GitHub window's data: the open pull requests with the state of their checks, the latest CI runs, the last commits and the open issues of the project,
read with `gh` and `git` run in the project's folder (chat.py serve --repo DIR, or "repo" in the room's config). The viewer serves it at /github.json for the
screen on the wall; it never goes through the relay to friends (a repo can be private).

It is slow and it can fail (gh missing, not logged in, no network), so it never blocks the page: the answer is cached for a minute, a refresh runs in the
background, and each failure is a short message in the answer, not an error in the log. Every command has a time limit."""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

TTL, TIMEOUT = 60, 10
NOWIN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)             # no console window flashing on Windows


def run(cmd, cwd):
    """(stdout, None) or (None, a short reason): the command is looked up, run in `cwd` with a time limit, and never asks anything"""
    exe = shutil.which(cmd[0])
    if not exe:
        return None, f'{cmd[0]} is not installed'
    env = {**os.environ, 'GH_PROMPT_DISABLED': '1', 'NO_COLOR': '1', 'GH_NO_UPDATE_NOTIFIER': '1', 'GIT_TERMINAL_PROMPT': '0'}
    try:
        r = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=TIMEOUT, creationflags=NOWIN, env=env, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return None, 'timed out'
    except OSError as exc:
        return None, str(exc)[:120]
    if r.returncode:
        text = (r.stderr or r.stdout or '').strip()
        return None, (text.splitlines()[0][:160] if text else f'exit {r.returncode}')
    return r.stdout, None


def https(url):
    return url if isinstance(url, str) and url.startswith('https://github.com/') else ''


def epoch(iso):
    """seconds since 1970 of an ISO time from gh (2026-10-11T04:02:00Z), 0 if it is not one"""
    m = re.fullmatch(r'(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z', iso or '')
    if not m:
        return 0
    import calendar
    return calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))


def checks_state(rollup):
    """one word for a pull request's checks: success, failure, pending or none"""
    if not rollup:
        return 'none'
    states = []
    for c in rollup:
        s, k = (c.get('status') or '').upper(), (c.get('conclusion') or c.get('state') or '').upper()
        if s and s != 'COMPLETED' and not k:
            states.append('pending')
        elif k in ('SUCCESS', 'NEUTRAL', 'SKIPPED'):
            states.append('success')
        elif k in ('PENDING', 'EXPECTED', ''):
            states.append('pending')
        else:
            states.append('failure')
    return 'failure' if 'failure' in states else 'pending' if 'pending' in states else 'success'


def run_state(r):
    s, k = (r.get('status') or '').lower(), (r.get('conclusion') or '').lower()
    if s == 'completed':
        return 'success' if k == 'success' else 'cancelled' if k in ('cancelled', 'skipped', 'neutral') else 'failure'
    return 'running' if s == 'in_progress' else 'queued'


def parse(blob, fields):
    try:
        data = json.loads(blob)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, list) else None


def fetch(repo, runner=run):
    """everything the window shows, from the commands; a part that failed is None with its reason in `errors`"""
    jobs = {
        'branch': ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
        'log': ['git', 'log', '-8', '--format=%h%x1f%an%x1f%ct%x1f%s'],
        'remote': ['git', 'config', '--get', 'remote.origin.url'],
        'prs': ['gh', 'pr', 'list', '--state', 'open', '--limit', '12', '--json', 'number,title,author,isDraft,updatedAt,url,headRefName,reviewDecision,statusCheckRollup'],
        'runs': ['gh', 'run', 'list', '--limit', '6', '--json', 'databaseId,displayTitle,status,conclusion,headBranch,createdAt,updatedAt,url,workflowName'],
        'issues': ['gh', 'issue', 'list', '--state', 'open', '--limit', '8', '--json', 'number,title,author,labels,url,createdAt'],
    }
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {k: pool.submit(runner, cmd, repo) for k, cmd in jobs.items()}
        got = {k: f.result() for k, f in futures.items()}
    out, errors = {'commits': None, 'prs': None, 'runs': None, 'issues': None}, {}
    for k, (text, err) in got.items():
        if err:
            errors[k] = err
    gh_err = next((errors[k] for k in ('prs', 'runs', 'issues') if k in errors), None)
    gh = 'ok' if not gh_err else 'missing' if 'not installed' in gh_err else 'not logged in' if re.search(r'auth login|not logged|authenticat', gh_err, re.I) else 'error'
    if 'log' not in errors:
        commits = []
        for line in got['log'][0].splitlines():
            p = line.split('\x1f')
            if len(p) == 4:
                commits.append({'sha': p[0], 'author': p[1][:40], 'at': int(p[2] or 0), 'subject': p[3][:140]})
        out['commits'] = commits
    prs = parse(got['prs'][0], None) if 'prs' not in errors else None
    if prs is not None:
        out['prs'] = [{'n': p.get('number'), 'title': str(p.get('title', ''))[:140], 'author': (p.get('author') or {}).get('login', ''), 'draft': bool(p.get('isDraft')), 'branch': str(p.get('headRefName', ''))[:60],
                       'checks': checks_state(p.get('statusCheckRollup')), 'review': str(p.get('reviewDecision') or '').lower(), 'url': https(p.get('url')), 'at': epoch(p.get('updatedAt'))} for p in prs]
    runs = parse(got['runs'][0], None) if 'runs' not in errors else None
    if runs is not None:
        out['runs'] = [{'id': r.get('databaseId'), 'title': str(r.get('displayTitle', ''))[:120], 'workflow': str(r.get('workflowName', ''))[:40], 'branch': str(r.get('headBranch', ''))[:60], 'state': run_state(r),
                        'secs': max(0, epoch(r.get('updatedAt')) - epoch(r.get('createdAt'))), 'url': https(r.get('url')), 'at': epoch(r.get('createdAt'))} for r in runs]
    issues = parse(got['issues'][0], None) if 'issues' not in errors else None
    if issues is not None:
        out['issues'] = [{'n': i.get('number'), 'title': str(i.get('title', ''))[:140], 'author': (i.get('author') or {}).get('login', ''), 'labels': [str(x.get('name', ''))[:24] for x in (i.get('labels') or [])][:4],
                          'url': https(i.get('url')), 'at': epoch(i.get('createdAt'))} for i in issues]
    remote = (got['remote'][0] or '').strip()
    m = re.search(r'github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?$', remote)
    return {'enabled': True, 'repo': m[1] if m else os.path.basename(os.path.normpath(repo)), 'branch': (got['branch'][0] or '').strip() if 'branch' not in errors else '', 'gh': gh,
            'errors': errors if errors else None, **out, 'at': int(time.time())}


class GitHub:
    """the window's data for one project folder: cached for TTL seconds; a stale answer is returned at once while a fresh one is fetched in the background"""
    def __init__(self, repo, runner=run):
        self.repo, self.runner, self.data, self.at, self.busy, self.lock = repo, runner, None, 0, False, threading.Lock()

    def _refresh(self):
        try:
            data = fetch(self.repo, self.runner)
        except Exception as exc:                          # whatever happens in there must not take the viewer down
            data = {'enabled': True, 'repo': os.path.basename(os.path.normpath(self.repo)), 'gh': 'error', 'errors': {'fetch': str(exc)[:120]}, 'commits': None, 'prs': None, 'runs': None, 'issues': None, 'at': int(time.time())}
        with self.lock:
            self.data, self.at, self.busy = data, time.time(), False

    def get(self, wait=12):
        with self.lock:
            fresh = self.data is not None and time.time() - self.at < TTL
            start = not fresh and not self.busy
            if start:
                self.busy = True
            data = self.data
        if start:
            t = threading.Thread(target=self._refresh, daemon=True)
            t.start()
            if data is None:                              # the first answer: wait for it, a little
                t.join(wait)
                with self.lock:
                    data = self.data
        if data is None:
            return {'enabled': True, 'repo': os.path.basename(os.path.normpath(self.repo)), 'gh': 'loading', 'commits': None, 'prs': None, 'runs': None, 'issues': None, 'at': 0}
        return {**data, 'stale': time.time() - self.at >= TTL}


def _prova():
    """the parsing, with the commands faked: a healthy repo, one without gh, one that is not logged in, one that is slow"""
    def healthy(cmd, cwd):
        c = ' '.join(cmd)
        if c.startswith('git rev-parse'):
            return 'main\n', None
        if c.startswith('git log'):
            return 'abc1234\x1fAda\x1f1791684000\x1ffeat: a thing\nbad\n', None
        if c.startswith('git config'):
            return 'https://github.com/owner/proj.git\n', None
        if cmd[1:3] == ['pr', 'list']:
            return json.dumps([{'number': 7, 'title': 'T' * 300, 'author': {'login': 'ada'}, 'isDraft': False, 'updatedAt': '2026-10-11T04:02:00Z', 'url': 'https://github.com/owner/proj/pull/7', 'headRefName': 'f',
                                'reviewDecision': 'APPROVED', 'statusCheckRollup': [{'status': 'COMPLETED', 'conclusion': 'SUCCESS'}, {'status': 'IN_PROGRESS', 'conclusion': ''}]},
                               {'number': 8, 'title': 'x', 'author': None, 'url': 'javascript:alert(1)', 'statusCheckRollup': [{'status': 'COMPLETED', 'conclusion': 'FAILURE'}]}]), None
        if cmd[1:3] == ['run', 'list']:
            return json.dumps([{'databaseId': 1, 'displayTitle': 'ci', 'status': 'completed', 'conclusion': 'success', 'headBranch': 'main', 'createdAt': '2026-10-11T04:00:00Z', 'updatedAt': '2026-10-11T04:02:30Z', 'url': 'https://github.com/o/p/actions/runs/1', 'workflowName': 'CI'},
                               {'databaseId': 2, 'status': 'in_progress'}]), None
        if cmd[1:3] == ['issue', 'list']:
            return json.dumps([{'number': 3, 'title': 'bug', 'author': {'login': 'bob'}, 'labels': [{'name': 'bug'}], 'url': 'https://github.com/o/p/issues/3', 'createdAt': '2026-10-10T10:00:00Z'}]), None
        return None, 'unknown'
    d = fetch('/x', healthy)
    assert d['gh'] == 'ok' and d['repo'] == 'owner/proj' and d['branch'] == 'main' and d['errors'] is None, d
    assert d['commits'] == [{'sha': 'abc1234', 'author': 'Ada', 'at': 1791684000, 'subject': 'feat: a thing'}], d['commits']
    assert d['prs'][0]['checks'] == 'pending' and d['prs'][0]['review'] == 'approved' and len(d['prs'][0]['title']) == 140 and d['prs'][0]['at'] > 1.7e9
    assert d['prs'][1]['checks'] == 'failure' and d['prs'][1]['url'] == '' and d['prs'][1]['author'] == '', d['prs'][1]       # a link that is not GitHub's is dropped
    assert d['runs'][0]['state'] == 'success' and d['runs'][0]['secs'] == 150 and d['runs'][1]['state'] == 'running', d['runs']
    assert d['issues'][0]['labels'] == ['bug'] and d['issues'][0]['author'] == 'bob'

    def no_gh(cmd, cwd):
        return (None, 'gh is not installed') if cmd[0] == 'gh' else healthy(cmd, cwd)
    d = fetch('/x', no_gh)
    assert d['gh'] == 'missing' and d['prs'] is None and d['commits'] and 'prs' in d['errors'], d

    def logged_out(cmd, cwd):
        return (None, 'To get started with GitHub CLI, please run:  gh auth login') if cmd[0] == 'gh' else healthy(cmd, cwd)
    assert fetch('/x', logged_out)['gh'] == 'not logged in'
    # the cache: one fetch serves everyone for a minute, and a stale answer comes back at once
    calls = []

    def counting(cmd, cwd):
        calls.append(cmd[0]); return healthy(cmd, cwd)
    g = GitHub('/x', counting)
    a = g.get()
    n = len(calls)
    assert a['gh'] == 'ok' and n == 6 and g.get()['gh'] == 'ok' and len(calls) == n
    g.at -= TTL + 1
    b = g.get()
    assert b['stale'] is True
    time.sleep(0.3)
    assert len(calls) == 2 * n and g.get()['stale'] is False
    # a command that raises does not escape
    def boom(cmd, cwd):
        raise RuntimeError('x' * 500)
    assert GitHub('/x', boom).get()['gh'] == 'error'
    print('github ok')


if __name__ == '__main__':
    if '--prova' in sys.argv:
        _prova()
    else:
        print(json.dumps(fetch(sys.argv[1] if len(sys.argv) > 1 else '.'), indent=1)[:6000])
