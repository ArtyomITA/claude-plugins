"""What each agent of a room is doing right now, for the 3D office and the /stanza pane.

Two sources, merged by time:
- the chatroom mod (hooks/register.ts) POSTs an event to `serve` for every tool call of a roster agent, for every
  permission it waits for, and for every agent spawned: instant and exact;
- the transcripts of the roster's agents, tailed by offset with the half-written last line kept aside: Claude Code
  subagents in `~/.claude/projects/*/*/subagents/agent-<id>.jsonl` (the fallback when the mod is not loaded, and
  the only source of context usage), Codex subagents in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, found by the
  `agent_path` (`/root/<name>`) their first line carries, the same address the roster holds. Codex records no
  permission wait, so its agents never show the beacon.

Background processes (the rack by each desk): the same two transcripts say them, so nothing is asked of the agents.
Claude Code: a Bash/PowerShell call with run_in_background (or a Monitor, or a background Agent) starts one, its result
names the task and the file the output goes to, a task notification in the transcript ends it (with the exit code), a
TaskStop/KillShell kills it. Codex: an exec_command whose output says "Process running with session ID N" starts one,
the "Process exited with code N" of a later write_stdin ends it. The command and the output stay on this computer:
they are served to the local viewer only, never to friends.
"""
import json
import os
import re
import time
from collections import deque
from datetime import datetime
from pathlib import Path

CLAUDE_DIR = Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude')
CODEX_DIR = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex')
REGISTRY = CLAUDE_DIR / 'chatroom' / 'rooms.json'
AGENT_ID = re.compile(r'^(a[0-9a-f]{8,40}|/root/[\w-]+)$')        # a Claude Code agent id, or a Codex agent path
RECENT, PULSE_SECONDS, FIND_EVERY, READ_MAX = 12, 300, 10.0, 4 * 1024 * 1024
HISTORY, TIMELINE_SPAN = 300, 1800                       # the calls kept for the timeline of an agent, and how far back it goes (seconds)
TOOL_LANES = ('read', 'edit', 'run', 'web', 'agent', 'chat', 'other')      # the rows of the timeline: what a tool call is


def lane_of(tool, target=''):
    """the row of the timeline a tool call goes on: reading, editing, running a command, the web, agents and messages, the room's chat, the rest"""
    if str(target).startswith('chat:'):
        return 'chat'
    if tool in ('Read', 'Grep', 'Glob', 'LS', 'NotebookRead'):
        return 'read'
    if tool in ('Edit', 'Write', 'NotebookEdit', 'MultiEdit'):
        return 'edit'
    if tool in ('Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor'):
        return 'run'
    if tool in ('WebFetch', 'WebSearch'):
        return 'web'
    if tool in ('Agent', 'Task', 'SendMessage', 'TaskStop'):
        return 'agent'
    return 'other'
PROC_SHOWN, PROC_KEEP, PROC_QUIET, PROC_MAX = 6, 300, 60, 40       # per agent: shown, seconds a finished one stays, seconds of silence before it is 'quiet', remembered
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')


def window_of(model):
    """context window of a model id: Haiku and the 4.x line have 200k, the 5 family 1M"""
    m = (model or '').lower()
    return 200_000 if 'haiku' in m or '-4-' in m or m.startswith('claude-3') else 1_000_000


def target_of(tool, inp):
    """a short label of what a tool call works on: a file name, a command, a host, a query"""
    inp = inp if isinstance(inp, dict) else {}
    if tool in ('Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit'):
        return os.path.basename(str(inp.get('file_path') or inp.get('notebook_path') or ''))
    if tool in ('Bash', 'PowerShell'):
        cmd = ' '.join(str(inp.get('command', '')).split())
        chat = re.search(r'chat\.py["\']?\s+(post|wait|read|status|roster|alerts|command)', cmd)
        if chat:
            return 'chat:' + chat.group(1)
        return cmd[:70]
    if tool in ('Grep', 'Glob'):
        return str(inp.get('pattern', ''))[:50]
    if tool == 'WebFetch':
        m = re.match(r'https?://([^/]+)', str(inp.get('url', '')))
        return m.group(1) if m else ''
    if tool == 'WebSearch':
        return str(inp.get('query', ''))[:60]
    if tool in ('Agent', 'Task'):
        return str(inp.get('description', ''))[:60]
    if tool == 'SendMessage':
        return str(inp.get('to') or inp.get('recipient') or '')[:40]
    return ''


def codex_call(p):
    """a Codex tool call (function_call or custom_tool_call payload) as the Claude Code tool it is closest to, and its
    input, so the office animates both alike: exec_command -> Bash, apply_patch -> Edit, web__run -> WebSearch"""
    if p.get('type') == 'function_call':
        name = p.get('name', '')
        try:
            args = json.loads(p.get('arguments') or '{}')
        except ValueError:
            args = {}
        args = args if isinstance(args, dict) else {}
        if name in ('wait_agent', 'wait'):
            return 'Bash', {'command': 'chat.py wait'}
        if name in ('send_message', 'followup_task'):
            return 'SendMessage', {'to': args.get('target') or args.get('agent_path') or ''}
        if name == 'spawn_agent':
            return 'Agent', {'description': args.get('task_name', '')}
        if name in ('shell', 'shell_command', 'local_shell', 'exec_command'):
            cmd = args.get('cmd') or args.get('command') or ''
            return 'Bash', {'command': ' '.join(cmd) if isinstance(cmd, list) else str(cmd)}
        return name, {}
    code = str(p.get('input') or '')                       # custom 'exec': JavaScript calling tools.<name>(...)
    used = re.search(r'tools\.(\w+)\(', code)
    name = used.group(1) if used else str(p.get('name') or '')
    if name in ('exec_command', 'shell_command', 'shell'):
        cmd = re.search(r'(?:cmd|command)\s*:\s*"((?:[^"\\]|\\.)*)"', code)
        if cmd:
            return 'Bash', {'command': cmd.group(1).replace('\\\\', '\\').replace('\\"', '"')}
        cmd = re.search(r'(?:cmd|command)\s*:\s*(?:@\'|`|\')([\s\S]{0,400})', code)     # here-strings, templates
        return 'Bash', {'command': cmd.group(1) if cmd else ''}
    if name == 'apply_patch' or '*** Begin Patch' in code:
        f = re.search(r'\*\*\* (?:Update|Add|Delete) File: ([^\n\\]+)', code)
        return 'Edit', {'file_path': f.group(1).strip() if f else ''}
    if name.startswith('web'):
        q = re.search(r'(?:q|query|ref_id)"?\s*:\s*"([^"]+)"', code)
        return 'WebSearch', {'query': q.group(1) if q else ''}
    return name or 'exec', {}


def ts_of(rec):
    try:
        return datetime.fromisoformat(str(rec.get('timestamp')).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return time.time()


class Agent:
    def __init__(self, name, agent_id):
        self.name, self.id = name, agent_id
        self.tool, self.target, self.since = None, '', None      # the tool running now
        self.calls = {}                                            # tool_use_id -> (tool, target, start)
        self.waiting = None                                        # since when it waits for a permission
        self.error_at = self.done_at = self.text_at = self.seen = None
        self.ctx = self.model = self.win = None                    # win: a window the transcript states (Codex)
        self.subagents = 0
        self.procs = {}                                            # background processes: id -> {id, kind, cmd, state, started, last, code, out}
        self.cx_sess = {}                                          # Codex write_stdin call id -> the session it writes to
        self.recent = deque(maxlen=RECENT)
        self.pulse = deque(maxlen=400)
        self.history = deque(maxlen=HISTORY)                       # every finished call: (start, ms, lane, ok), for the timeline
        self.waits = deque(maxlen=60)                              # the permission waits that ended: (from, to)
        self.ctxs = deque(maxlen=120)                              # how full the context was: (time, tokens)

    def note_ctx(self, ts):
        if self.ctx and (not self.ctxs or abs(self.ctx - self.ctxs[-1][1]) >= 1000 or ts - self.ctxs[-1][0] >= 30):
            self.ctxs.append((ts, self.ctx))

    def start(self, call_id, tool, target, ts):
        if call_id in self.calls:
            return                                                 # the same call from both sources
        self.calls[call_id] = (tool, target, ts)
        self.tool, self.target, self.since, self.seen = tool, target, ts, ts
        self.pulse.append(ts)
        if tool in ('Agent', 'Task'):
            self.subagents += 1

    def finish(self, call_id, ok, ts):
        call = self.calls.pop(call_id, None)
        if call is None:
            return
        tool, target, start = call
        self.recent.append({'tool': tool, 'target': target, 'ts': start, 'ms': int((ts - start) * 1000), 'ok': ok})
        self.history.append((start, int((ts - start) * 1000), lane_of(tool, target), bool(ok)))
        if tool in ('Agent', 'Task'):
            self.subagents = max(0, self.subagents - 1)
        if not ok:
            self.error_at = ts
        self.done_at, self.seen = ts, ts
        if self.waiting and not self.calls:
            self.waits.append((self.waiting, ts))
            self.waiting = None
        if self.calls:                                             # another call still runs (parallel tools)
            self.tool, self.target, self.since = next(iter(self.calls.values()))
        else:
            self.tool, self.target, self.since = None, '', None

    # ------------------------------------------------------------------ background processes
    def proc_new(self, pid, kind, cmd, ts, out=None):
        if pid in self.procs:
            return self.procs[pid]
        self.procs[pid] = {'id': pid, 'kind': kind, 'cmd': ' '.join(str(cmd or '').split())[:200], 'state': 'running', 'started': ts, 'last': ts, 'code': None, 'out': out}
        if len(self.procs) > PROC_MAX:                              # forget the oldest finished one
            done = sorted((q for q in self.procs.values() if q['state'] != 'running'), key=lambda q: q['last'])
            if done:
                self.procs.pop(done[0]['id'], None)
        return self.procs[pid]

    def proc_rekey(self, old, new, out, ts):
        q = self.procs.pop(old, None)
        if q is None:
            return
        q['id'], q['last'] = new, ts
        if out:
            q['out'] = out
        self.procs[new] = q

    def proc_end(self, pid, state, code, ts):
        q = self.procs.get(str(pid))
        if q is not None and q['state'] == 'running':
            q['state'], q['code'], q['last'] = state, code, ts

    def procs_view(self, now):
        """the processes to show: running first, then the quiet ones, then the latest finished; a finished one leaves after PROC_KEEP seconds; 'quiet' = running but silent for a minute"""
        out = []
        for q in self.procs.values():
            last = q['last']
            if q['state'] == 'running' and q.get('out'):
                try:
                    last = max(last, os.stat(q['out']).st_mtime)
                except OSError:
                    pass
            if q['state'] != 'running' and now - last > PROC_KEEP:
                continue
            state = 'quiet' if q['state'] == 'running' and now - last > PROC_QUIET else q['state']
            out.append({'id': q['id'], 'kind': q['kind'], 'cmd': q['cmd'], 'state': state, 'started': q['started'], 'last': last, 'code': q['code'], 'tail': bool(q.get('out'))})
        out.sort(key=lambda x: ({'running': 0, 'quiet': 1}.get(x['state'], 2), -x['last']))
        return out[:PROC_SHOWN]

    def view(self, now):
        win = self.win or window_of(self.model)
        if self.ctx and self.ctx > win:
            win = self.ctx                                         # never read a context fuller than it can be
        return {'id': self.id, 'tool': self.tool, 'target': self.target, 'since': self.since,
                'waiting': self.waiting, 'error_at': self.error_at, 'done_at': self.done_at, 'text_at': self.text_at,
                'seen': self.seen, 'ctx': self.ctx, 'window': win if self.ctx else None, 'model': self.model,
                'subagents': self.subagents, 'procs': self.procs_view(now), 'recent': list(self.recent)[::-1],
                'pulse': [round(now - t, 1) for t in self.pulse if now - t <= PULSE_SECONDS]}


class Activity:
    def __init__(self, room):
        self.room = room
        self.agents = {}                    # agent id -> Agent
        self.tails = {}                     # agent id -> [path, offset, partial] or [None, next_search_time]
        self.last_poll = 0.0
        self.mod_at = None                  # when the mod last sent an event

    # ------------------------------------------------------------------ roster
    def ids(self):
        """name -> address for the roster's agents: Claude Code agent ids and Codex agent paths"""
        return {n: v for n, v in self.room.roster().items() if AGENT_ID.match(str(v))}

    def agent(self, agent_id):
        for name, aid in self.ids().items():
            if aid == agent_id:
                if agent_id not in self.agents:
                    self.agents[agent_id] = Agent(name, agent_id)
                return self.agents[agent_id]
        return None

    def name_in(self, description):
        """the participant a spawn's description starts with ('FETTE: checks the parser' -> FETTE)"""
        d = (description or '').strip().lower()
        for name in self.room.config().get('participants', []):
            if re.match(re.escape(name.lower()) + r'(?![\w-])', d):
                return name
        return None

    # ------------------------------------------------------------------ the mod
    def hook(self, ev):
        """one event from the mod: {kind: tool|done|ask|spawn, agentId, id, tool, input, ok, description}"""
        kind, now = ev.get('kind'), time.time()
        self.mod_at = now
        aid = str(ev.get('agentId') or '')
        if kind == 'spawn':
            name = self.name_in(ev.get('description'))
            roster = self.room.roster()
            if name and AGENT_ID.match(aid) and name not in roster:
                roster[name] = aid                 # the roster writes itself: pings work without a manual roster
                (self.room.dir / 'roster.json').write_text(json.dumps(roster, indent=2), encoding='utf-8')
            return
        a = self.agent(aid)
        if a is None:
            return
        call = str(ev.get('id') or ev.get('tool') or '')
        if kind == 'tool':
            a.start(call, str(ev.get('tool') or ''), target_of(ev.get('tool'), ev.get('input')), now)
        elif kind == 'done':
            a.finish(call, bool(ev.get('ok', True)), now)
        elif kind == 'ask':
            a.waiting = a.waiting or now
            a.seen = now

    # ------------------------------------------------------------------ the transcripts
    def find(self, agent_id):
        if agent_id.startswith('/root/'):
            return self.find_codex(agent_id)
        hits = list((CLAUDE_DIR / 'projects').glob(f'*/*/subagents/agent-{agent_id}.jsonl'))
        return max(hits, key=lambda p: p.stat().st_mtime) if hits else None

    def find_codex(self, path):
        """the newest Codex rollout of the last two days whose first line names this agent path"""
        best = None
        for day in sorted((CODEX_DIR / 'sessions').glob('*/*/*'))[-2:]:
            for f in day.glob('rollout-*.jsonl'):
                try:
                    with f.open(encoding='utf-8') as fh:
                        meta = json.loads(fh.readline()).get('payload') or {}
                except (OSError, ValueError):
                    continue
                if meta.get('agent_path') == path and (best is None or f.stat().st_mtime > best.stat().st_mtime):
                    best = f
        return best

    def poll(self):
        now = time.time()
        if now - self.last_poll < 1.0:
            return
        self.last_poll = now
        for name, aid in self.ids().items():
            tail = self.tails.get(aid)
            if tail is None or (tail[0] is None and now >= tail[1]):
                path = self.find(aid)
                tail = self.tails[aid] = [path, 0, b''] if path else [None, now + FIND_EVERY]
            if tail[0] is None:
                continue
            a = self.agent(aid)
            try:
                size = tail[0].stat().st_size
                if size < tail[1]:
                    tail[1], tail[2] = 0, b''
                if size == tail[1]:
                    continue
                with tail[0].open('rb') as f:
                    f.seek(tail[1])
                    data = f.read(READ_MAX)
            except OSError:
                continue
            tail[1] += len(data)
            lines = (tail[2] + data).split(b'\n')
            tail[2] = lines.pop()                  # the last line may still be half written
            for line in lines:
                try:
                    self.record(a, json.loads(line))
                except (ValueError, AttributeError, TypeError):
                    pass

    def record(self, a, rec):
        if 'payload' in rec:
            return self.record_codex(a, rec)
        ts, msg = ts_of(rec), rec.get('message') or {}
        content = msg.get('content') if isinstance(msg.get('content'), list) else []
        if rec.get('type') == 'assistant':
            usage = msg.get('usage') or {}
            ctx = sum(int(usage.get(k) or 0) for k in ('input_tokens', 'cache_creation_input_tokens',
                                                        'cache_read_input_tokens', 'output_tokens'))
            if ctx:                                # all zeros = an error or an interrupt: no news
                a.ctx, a.model = ctx, msg.get('model') or a.model
                a.note_ctx(ts)
            for c in content:
                if c.get('type') == 'tool_use':
                    a.start(str(c.get('id')), str(c.get('name')), target_of(c.get('name'), c.get('input')), ts)
                    self.record_proc_use(a, c, ts)
                elif c.get('type') == 'text' and c.get('text'):
                    a.text_at = a.seen = ts
        elif rec.get('type') == 'user':
            res = rec.get('toolUseResult') if isinstance(rec.get('toolUseResult'), dict) else {}
            for c in content:
                if c.get('type') == 'tool_result':
                    a.finish(str(c.get('tool_use_id')), not c.get('is_error'), ts)
                    self.record_proc_result(a, c, res, ts)
        elif rec.get('type') == 'attachment':
            self.record_proc_note(a, rec.get('attachment') or {}, ts)

    def record_proc_use(self, a, c, ts):
        """a tool call that starts a background process, or kills one"""
        name, inp, key = str(c.get('name')), c.get('input') if isinstance(c.get('input'), dict) else {}, 'use:' + str(c.get('id'))
        if name in ('Bash', 'PowerShell') and inp.get('run_in_background'):
            a.proc_new(key, 'shell', inp.get('command'), ts)
        elif name == 'Monitor':
            a.proc_new(key, 'monitor', inp.get('command') or inp.get('description'), ts)
        elif name in ('Agent', 'Task') and inp.get('run_in_background'):
            a.proc_new(key, 'agent', inp.get('description') or str(inp.get('prompt') or '')[:80], ts)
        elif name in ('TaskStop', 'KillShell', 'KillBash', 'TaskKill'):
            a.proc_end(inp.get('task_id') or inp.get('shell_id') or inp.get('id'), 'killed', None, ts)

    def record_proc_result(self, a, c, res, ts):
        """the result of that call names the task (and the file its output goes to)"""
        key = 'use:' + str(c.get('tool_use_id'))
        if key not in a.procs:
            return
        text = c.get('content')
        text = ' '.join(x.get('text', '') for x in text if isinstance(x, dict)) if isinstance(text, list) else str(text or '')
        tid = res.get('backgroundTaskId') or res.get('taskId')
        if not tid:
            m = re.search(r'(?:with ID|task)[: ]+([a-z][0-9a-z]{6,16})\b', text)
            tid = m[1] if m else None
        out = re.search(r'written to: (\S+?\.output)', text)
        if tid:
            a.proc_rekey(key, str(tid), out[1] if out else None, ts)
        elif c.get('is_error'):
            a.proc_end(key, 'failed', None, ts)

    def record_proc_note(self, a, att, ts):
        """a task notification: the process ended (completed, failed, killed), or a monitor said something"""
        prompt = str(att.get('prompt') or '')
        if att.get('type') != 'queued_command' or '<task-notification>' not in prompt:
            return
        tid = re.search(r'<task-id>([^<]+)</task-id>', prompt)
        if not tid or tid[1] not in a.procs:
            return
        q, status = a.procs[tid[1]], (re.search(r'<status>([^<]+)</status>', prompt) or [None, ''])[1].strip().lower()
        summary = (re.search(r'<summary>([\s\S]*?)</summary>', prompt) or [None, ''])[1]
        code = re.search(r'exit(?:ed)? (?:with )?code (-?\d+)', summary + ' ' + prompt)
        n = int(code[1]) if code else None
        if status in ('completed', 'failed', 'killed', 'stopped') or (q['kind'] == 'monitor' and re.search(r'\[exited with code', prompt)):
            a.proc_end(tid[1], 'killed' if status in ('killed', 'stopped') else 'failed' if status == 'failed' or (n not in (None, 0)) else 'done', n, ts)
        else:
            q['last'] = ts                                          # a monitor event: still alive, and talking

    def record_codex(self, a, rec):
        ts, p, kind = ts_of(rec), rec.get('payload') or {}, rec.get('type')
        t = p.get('type')
        if kind == 'response_item' and t in ('function_call', 'custom_tool_call'):
            tool, inp = codex_call(p)
            a.start(str(p.get('call_id')), tool, target_of(tool, inp), ts)
            if p.get('name') == 'write_stdin':
                try:
                    args = json.loads(p.get('arguments') or '{}')
                except ValueError:
                    args = {}
                a.cx_sess[str(p.get('call_id'))] = str((args if isinstance(args, dict) else {}).get('session_id', ''))
        elif kind == 'response_item' and t in ('function_call_output', 'custom_tool_call_output'):
            out = json.dumps(p.get('output'))[:600]
            call_id, raw = str(p.get('call_id')), p.get('output')
            raw = raw if isinstance(raw, str) else json.dumps(raw)
            sess = a.cx_sess.pop(call_id, None)
            running = re.search(r'Process running with session ID (\d+)', raw)
            if running and call_id in a.calls:                      # a command that is still going on after its first answer: a background process
                a.proc_new('cx:' + running[1], 'shell', a.calls[call_id][1], ts)
            elif running:
                q = a.procs.get('cx:' + running[1])
                if q:
                    q['last'] = ts
            exited = re.search(r'Process exited with code (-?\d+)', raw)
            if exited and sess:
                a.proc_end('cx:' + sess, 'done' if exited[1] == '0' else 'failed', int(exited[1]), ts)
            a.finish(str(p.get('call_id')), not re.search(r'Exit code: [1-9]|exited with code [1-9]|"status": ?"rejected"', out), ts)
        elif kind == 'response_item' and (t == 'agent_message' or (t == 'message' and p.get('role') == 'assistant')):
            a.text_at = a.seen = ts
        elif kind == 'event_msg' and t == 'token_count':
            last = ((p.get('info') or {}).get('last_token_usage') or {})
            ctx = int(last.get('input_tokens') or 0) + int(last.get('output_tokens') or 0)
            if ctx:
                a.ctx = ctx
                a.note_ctx(ts)
        elif kind == 'event_msg' and t == 'task_started' and p.get('model_context_window'):
            a.win = int(p['model_context_window'])
        elif kind == 'event_msg' and t == 'thread_settings_applied':
            a.model = (p.get('thread_settings') or {}).get('model') or a.model

    def tail(self, name, pid, n=12):
        """the last lines of a background process's output, for the local viewer: only a task output file of Claude Code (…/tasks/<id>.output) is ever read"""
        a = next((x for x in self.agents.values() if x.name == name), None)
        q = a.procs.get(str(pid)) if a else None
        if not q:
            return None
        lines = []
        out = q.get('out')
        if out:
            path = Path(out)
            if path.suffix == '.output' and path.parent.name == 'tasks':
                try:
                    with path.open('rb') as f:
                        f.seek(max(0, path.stat().st_size - 16384))
                        text = f.read().decode('utf-8', errors='replace')
                    lines = [ANSI.sub('', l)[:300] for l in text.replace('\r', '').split('\n') if l.strip()][-n:]
                except OSError:
                    pass
        return {'cmd': q['cmd'], 'kind': q['kind'], 'state': q['state'], 'code': q['code'], 'started': q['started'], 'lines': lines}

    def timeline(self, span=TIMELINE_SPAN):
        """what the timelines draw, per agent, with times as seconds ago (so a clock that is not ours does not matter): ev = [age, ms, lane, ok] of the finished
        calls, run = what is running now [age, lane], wt = the permission waits [age from, age to], cx = [age, tokens, window]"""
        self.poll()
        now = time.time()
        out = {}
        for a in self.agents.values():
            v = a.view(now)
            out[a.name] = {'ev': [[round(now - t, 1), ms, TOOL_LANES.index(lane), 1 if ok else 0] for t, ms, lane, ok in a.history if now - t <= span],
                           'run': [round(now - a.since, 1), TOOL_LANES.index(lane_of(a.tool, a.target))] if a.tool and a.since else None,
                           'wt': [[round(now - f, 1), round(now - (e if e else now), 1)] for f, e in [*a.waits, (a.waiting, None)] if f and now - (e or now) <= span],
                           'cx': [[round(now - t, 1), c, v['window']] for t, c in a.ctxs if now - t <= span]}
        return {'now': now, 'span': span, 'lanes': list(TOOL_LANES), 'agents': out}

    def state(self):
        self.poll()
        now = time.time()
        return {'now': now, 'agents': {a.name: a.view(now) for a in self.agents.values()}, 'mod': self.mod_at}


def register_room(room, port, host):
    """note the served room in ~/.claude/chatroom/rooms.json, so the mod knows where to send events; call it again
    every few seconds: the stamp is the heartbeat (a room not stamped for 60 s is dropped, no pid checks: on Windows
    os.kill(pid, 0) would terminate the process). Returns a function that removes the room."""
    key = str(room.dir.resolve())

    def edit(fn):
        REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        try:
            rooms = json.loads(REGISTRY.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            rooms = {}
        rooms = {k: v for k, v in rooms.items() if time.time() - float(v.get('ts', 0)) < 60}
        fn(rooms)
        tmp = REGISTRY.with_name(f'rooms.{os.getpid()}.tmp')
        tmp.write_text(json.dumps(rooms, indent=2, ensure_ascii=False), encoding='utf-8')
        for attempt in range(20):                     # Windows refuses the swap while another server is swapping it
            try:
                return os.replace(tmp, REGISTRY)
            except PermissionError:
                time.sleep(0.05 + 0.05 * attempt)
        tmp.unlink(missing_ok=True)                    # ponytail: give up this stamp, the next one (5 s) tries again

    started = time.time()                             # the older of two rooms keeps its desks in the shared office

    def add(rooms):
        c = room.config()
        rooms[key] = {'url': f'http://{host}:{port}', 'ts': time.time(), 'ids': list(Activity(room).ids().values()),
                      'participants': c.get('participants', []), 'user': c.get('user_name', 'USER'),
                      'title': c.get('title') or c.get('topic', ''), 'since': rooms.get(key, {}).get('since', started)}
    edit(add)
    return lambda: edit(lambda rooms: rooms.pop(key, None))


def _prova():
    """self-check: tool start/end from the mod and from a transcript, permission wait, auto roster, partial lines"""
    import tempfile
    global CLAUDE_DIR, CODEX_DIR

    class FakeRoom:
        def __init__(self, d):
            self.dir = Path(d)
            self.dir.joinpath('roster.json').write_text(json.dumps({'FETTE': 'a1111111111111111', 'CODEX': '/root/x'}))

        def roster(self):
            return json.loads(self.dir.joinpath('roster.json').read_text())

        def config(self):
            return {'participants': ['FETTE', 'LUCE', 'CODEX']}

    with tempfile.TemporaryDirectory() as tmp:
        room = FakeRoom(tmp)
        act = Activity(room)
        assert set(act.ids()) == {'FETTE', 'CODEX'}                               # Claude ids and Codex paths
        assert target_of('Bash', {'command': 'python "C:/x/chat.py" post --as A'}) == 'chat:post'
        assert target_of('Read', {'file_path': 'D:/a/b/parser.py'}) == 'parser.py'
        act.hook({'kind': 'tool', 'agentId': 'a1111111111111111', 'id': 't1', 'tool': 'Edit', 'input': {'file_path': 'x/y.py'}})
        act.hook({'kind': 'ask', 'agentId': 'a1111111111111111', 'id': 't1'})
        v = act.state()['agents']['FETTE']
        assert v['tool'] == 'Edit' and v['target'] == 'y.py' and v['waiting']
        act.hook({'kind': 'done', 'agentId': 'a1111111111111111', 'id': 't1', 'ok': False})
        v = act.state()['agents']['FETTE']
        assert v['tool'] is None and not v['waiting'] and v['error_at'] and v['recent'][0]['ok'] is False
        tl = act.timeline()['agents']['FETTE']                                       # the timeline: the failed edit is a call on the edit row, the wait is a span
        assert [e[2:] for e in tl['ev']] == [[TOOL_LANES.index('edit'), 0]] and tl['run'] is None and len(tl['wt']) == 1 and tl['ev'][0][0] < 5, tl
        act.hook({'kind': 'tool', 'agentId': 'a1111111111111111', 'id': 't2', 'tool': 'Bash', 'input': {'command': 'python x/chat.py post --as A'}})
        tl = act.timeline()['agents']['FETTE']
        assert tl['run'][1] == TOOL_LANES.index('chat'), tl                           # a chat command is on its own row
        act.hook({'kind': 'done', 'agentId': 'a1111111111111111', 'id': 't2', 'ok': True})
        assert lane_of('Grep') == 'read' and lane_of('WebSearch') == 'web' and lane_of('Agent') == 'agent' and lane_of('Zzz') == 'other'
        assert all(e[0] <= TIMELINE_SPAN for e in act.timeline(60)['agents']['FETTE']['ev'])
        act.hook({'kind': 'spawn', 'agentId': 'a2222222222222222', 'description': 'LUCE: lights and shadows'})
        assert room.roster()['LUCE'] == 'a2222222222222222'                       # the roster wrote itself
        act.hook({'kind': 'spawn', 'agentId': 'a3333333333333333', 'description': 'LUCENTE: other'})
        assert 'LUCENTE' not in room.roster() and list(room.roster()).count('LUCE') == 1
        # transcript of LUCE, with its last line half written
        CLAUDE_DIR = Path(tmp)
        sub = Path(tmp, 'projects', 'p', 's', 'subagents'); sub.mkdir(parents=True)
        rec = {'type': 'assistant', 'timestamp': '2026-10-10T10:00:00Z', 'message': {'model': 'claude-sonnet-5-5',
               'usage': {'input_tokens': 5, 'cache_read_input_tokens': 40000, 'output_tokens': 300},
               'content': [{'type': 'tool_use', 'id': 'u1', 'name': 'WebSearch', 'input': {'query': 'voxel ao'}}]}}
        line = json.dumps(rec)
        (sub / 'agent-a2222222222222222.jsonl').write_text(line + '\n' + line[:20])
        act.last_poll = 0
        v = act.state()['agents']['LUCE']
        assert v['tool'] == 'WebSearch' and v['ctx'] == 40305 and v['window'] == 1_000_000
        with (sub / 'agent-a2222222222222222.jsonl').open('a') as f:
            f.write(line[20:] + '\n' + json.dumps({'type': 'user', 'timestamp': '2026-10-10T10:00:03Z',
                    'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u1'}]}}) + '\n')
        act.last_poll = 0
        v = act.state()['agents']['LUCE']
        assert v['tool'] is None and v['recent'][0]['ms'] == 3000
        # a Codex subagent, found by the agent path in its rollout's first line
        CODEX_DIR = Path(tmp, 'codex')
        day = CODEX_DIR / 'sessions' / '2026' / '10' / '10'; day.mkdir(parents=True)
        rows = [
            {'timestamp': '2026-10-10T10:00:00Z', 'type': 'session_meta', 'payload': {'agent_path': '/root/x'}},
            {'timestamp': '2026-10-10T10:00:00Z', 'type': 'event_msg', 'payload': {'type': 'task_started', 'model_context_window': 258400}},
            {'timestamp': '2026-10-10T10:00:01Z', 'type': 'response_item', 'payload': {'type': 'custom_tool_call', 'call_id': 'c1', 'name': 'exec',
             'input': 'await tools.exec_command({cmd:"python \\"E:/x/chat.py\\" post --as CODEX"})'}},
            {'timestamp': '2026-10-10T10:00:02Z', 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'last_token_usage': {'input_tokens': 9000, 'output_tokens': 120}}}},
        ]
        (day / 'rollout-2026-10-10T10-00-00-abc.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
        act.last_poll = 0
        act.tails.pop('/root/x', None)                       # an earlier miss waits 10 s before searching again
        v = act.state()['agents']['CODEX']
        assert v['tool'] == 'Bash' and v['target'] == 'chat:post' and v['ctx'] == 9120 and v['window'] == 258400
        assert codex_call({'type': 'custom_tool_call', 'input': 'tools.apply_patch("*** Begin Patch\\n*** Update File: src/a.py\\n")'}) == ('Edit', {'file_path': 'src/a.py'})
        # background processes: Claude Code (a shell, a monitor, a kill, an exit code) and Codex (a session id that runs, then exits)
        b = Agent('B', 'a9999999999999999')
        out = Path(tmp, 'p', 's', 'tasks'); out.mkdir(parents=True)
        (out / 'bfoo12345.output').write_text('\x1b[32mlistening\x1b[0m on 8000\nGET /a\n')
        rows = [
            {'type': 'assistant', 'timestamp': '2026-10-10T11:00:00Z', 'message': {'content': [{'type': 'tool_use', 'id': 'u1', 'name': 'Bash', 'input': {'command': 'python -m http.server 8000', 'run_in_background': True}},
                                                                                     {'type': 'tool_use', 'id': 'u2', 'name': 'Bash', 'input': {'command': 'ls'}},
                                                                                     {'type': 'tool_use', 'id': 'u3', 'name': 'Monitor', 'input': {'command': 'tail -f x.log', 'description': 'watch the log'}}]}},
            {'type': 'user', 'timestamp': '2026-10-10T11:00:01Z', 'toolUseResult': {'backgroundTaskId': 'bfoo12345'},
             'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u1', 'content': 'Command running in background with ID: bfoo12345. Output is being written to: ' + str(out / 'bfoo12345.output') + '. You will be notified'}]}},
            {'type': 'user', 'timestamp': '2026-10-10T11:00:01Z', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u3', 'content': 'Monitor started (task bmon98765, timeout 300000ms).'}]}},
            {'type': 'attachment', 'timestamp': '2026-10-10T11:00:30Z', 'attachment': {'type': 'queued_command', 'prompt': '<task-notification>\n<task-id>bmon98765</task-id>\n<summary>Monitor event: "x"</summary>\n<event>line</event>\n</task-notification>'}},
        ]
        for r in rows:
            act.record(b, r)
        assert set(b.procs) == {'bfoo12345', 'bmon98765'} and b.procs['bfoo12345']['cmd'] == 'python -m http.server 8000' and b.procs['bmon98765']['kind'] == 'monitor' and b.procs['bmon98765']['last'] > b.procs['bmon98765']['started']
        v = b.procs_view(time.time())
        assert [x['state'] for x in v] == ['running', 'quiet'] and v[0]['id'] == 'bfoo12345' and v[0]['tail'] is True      # the shell's file was just written: running; the monitor said its last word long ago: quiet
        act.agents['a9999999999999999'] = b
        t = act.tail('B', 'bfoo12345')
        assert t['lines'] == ['listening on 8000', 'GET /a'] and t['cmd'].startswith('python -m') and act.tail('B', 'nope') is None
        act.record(b, {'type': 'attachment', 'timestamp': '2026-10-10T11:05:00Z', 'attachment': {'type': 'queued_command', 'prompt': '<task-notification>\n<task-id>bfoo12345</task-id>\n<status>completed</status>\n<summary>Background command "x" completed (exit code 0)</summary>\n</task-notification>'}})
        act.record(b, {'type': 'assistant', 'timestamp': '2026-10-10T11:05:01Z', 'message': {'content': [{'type': 'tool_use', 'id': 'u4', 'name': 'TaskStop', 'input': {'task_id': 'bmon98765'}}]}})
        assert b.procs['bfoo12345']['state'] == 'done' and b.procs['bfoo12345']['code'] == 0 and b.procs['bmon98765']['state'] == 'killed'
        act.record(b, {'type': 'assistant', 'timestamp': '2026-10-10T11:06:00Z', 'message': {'content': [{'type': 'tool_use', 'id': 'u5', 'name': 'Bash', 'input': {'command': 'make', 'run_in_background': True}}]}})
        act.record(b, {'type': 'attachment', 'timestamp': '2026-10-10T11:06:09Z', 'attachment': {'type': 'queued_command', 'prompt': '<task-notification><task-id>u5x</task-id></task-notification>'}})
        act.record(b, {'type': 'user', 'timestamp': '2026-10-10T11:06:01Z', 'toolUseResult': {'backgroundTaskId': 'bmake0001'}, 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'u5', 'content': 'x'}]}})
        act.record(b, {'type': 'attachment', 'timestamp': '2026-10-10T11:06:30Z', 'attachment': {'type': 'queued_command', 'prompt': '<task-notification><task-id>bmake0001</task-id><status>failed</status><summary>Background command "make" failed with exit code 2</summary></task-notification>'}})
        assert b.procs['bmake0001']['state'] == 'failed' and b.procs['bmake0001']['code'] == 2
        c = Agent('C', '/root/c')
        cx = [
            {'timestamp': '2026-10-10T12:00:00Z', 'type': 'response_item', 'payload': {'type': 'function_call', 'call_id': 'k1', 'name': 'exec_command', 'arguments': json.dumps({'cmd': 'npm run dev'})}},
            {'timestamp': '2026-10-10T12:00:02Z', 'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'k1', 'output': 'Chunk ID: a\nWall time: 1.0 seconds\nProcess running with session ID 77\nOutput:\nready'}},
            {'timestamp': '2026-10-10T12:01:00Z', 'type': 'response_item', 'payload': {'type': 'function_call', 'call_id': 'k2', 'name': 'write_stdin', 'arguments': json.dumps({'session_id': 77, 'chars': ''})}},
            {'timestamp': '2026-10-10T12:01:01Z', 'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'k2', 'output': 'Process exited with code 1\nOutput:\nboom'}},
        ]
        for r in cx[:2]:
            act.record(c, r)
        assert c.procs['cx:77']['state'] == 'running' and c.procs['cx:77']['cmd'] == 'npm run dev'
        for r in cx[2:]:
            act.record(c, r)
        assert c.procs['cx:77']['state'] == 'failed' and c.procs['cx:77']['code'] == 1 and not c.calls
        # a hostile transcript cannot make the viewer read other files
        b.procs['bfoo12345']['out'] = str(Path(tmp, 'secret.txt')); Path(tmp, 'secret.txt').write_text('x')
        assert act.tail('B', 'bfoo12345')['lines'] == []
    print('activity.py: prova ok')


if __name__ == '__main__':
    _prova()
