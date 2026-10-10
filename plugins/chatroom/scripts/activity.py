"""What each agent of a room is doing right now, for the 3D office and the /stanza pane.

Two sources, merged by time:
- the chatroom mod (hooks/register.ts) POSTs an event to `serve` for every tool call of a roster agent, for every
  permission it waits for, and for every agent spawned: instant and exact;
- the Claude Code transcripts of the roster's agents (`~/.claude/projects/*/*/subagents/agent-<id>.jsonl`), tailed
  by offset with the half-written last line kept aside: the fallback when the mod is not loaded, and the only
  source of context usage.
Codex agents have neither: their room animates from the chat alone.
"""
import json
import os
import re
import time
from collections import deque
from datetime import datetime
from pathlib import Path

CLAUDE_DIR = Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude')
REGISTRY = CLAUDE_DIR / 'chatroom' / 'rooms.json'
AGENT_ID = re.compile(r'^a[0-9a-f]{8,40}$')
RECENT, PULSE_SECONDS, FIND_EVERY, READ_MAX = 12, 300, 10.0, 4 * 1024 * 1024


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
        self.ctx = self.model = None
        self.subagents = 0
        self.recent = deque(maxlen=RECENT)
        self.pulse = deque(maxlen=400)

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
        if tool in ('Agent', 'Task'):
            self.subagents = max(0, self.subagents - 1)
        if not ok:
            self.error_at = ts
        self.done_at, self.seen = ts, ts
        if self.waiting and not self.calls:
            self.waiting = None
        if self.calls:                                             # another call still runs (parallel tools)
            self.tool, self.target, self.since = next(iter(self.calls.values()))
        else:
            self.tool, self.target, self.since = None, '', None

    def view(self, now):
        win = window_of(self.model)
        if self.ctx and self.ctx > win:
            win = self.ctx                                         # never read a context fuller than it can be
        return {'id': self.id, 'tool': self.tool, 'target': self.target, 'since': self.since,
                'waiting': self.waiting, 'error_at': self.error_at, 'done_at': self.done_at, 'text_at': self.text_at,
                'seen': self.seen, 'ctx': self.ctx, 'window': win if self.ctx else None, 'model': self.model,
                'subagents': self.subagents, 'recent': list(self.recent)[::-1],
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
        """name -> agent id for the roster's Claude Code agents (Codex paths have no transcript here)"""
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
        hits = list((CLAUDE_DIR / 'projects').glob(f'*/*/subagents/agent-{agent_id}.jsonl'))
        return max(hits, key=lambda p: p.stat().st_mtime) if hits else None

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
        ts, msg = ts_of(rec), rec.get('message') or {}
        content = msg.get('content') if isinstance(msg.get('content'), list) else []
        if rec.get('type') == 'assistant':
            usage = msg.get('usage') or {}
            ctx = sum(int(usage.get(k) or 0) for k in ('input_tokens', 'cache_creation_input_tokens',
                                                        'cache_read_input_tokens', 'output_tokens'))
            if ctx:                                # all zeros = an error or an interrupt: no news
                a.ctx, a.model = ctx, msg.get('model') or a.model
            for c in content:
                if c.get('type') == 'tool_use':
                    a.start(str(c.get('id')), str(c.get('name')), target_of(c.get('name'), c.get('input')), ts)
                elif c.get('type') == 'text' and c.get('text'):
                    a.text_at = a.seen = ts
        elif rec.get('type') == 'user':
            for c in content:
                if c.get('type') == 'tool_result':
                    a.finish(str(c.get('tool_use_id')), not c.get('is_error'), ts)

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
        os.replace(tmp, REGISTRY)

    def add(rooms):
        c = room.config()
        rooms[key] = {'url': f'http://{host}:{port}', 'ts': time.time(), 'ids': list(Activity(room).ids().values()),
                      'participants': c.get('participants', []), 'user': c.get('user_name', 'USER'),
                      'title': c.get('title') or c.get('topic', '')}
    edit(add)
    return lambda: edit(lambda rooms: rooms.pop(key, None))


def _prova():
    """self-check: tool start/end from the mod and from a transcript, permission wait, auto roster, partial lines"""
    import tempfile
    global CLAUDE_DIR

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
        assert set(act.ids()) == {'FETTE'}                                        # Codex paths have no transcript
        assert target_of('Bash', {'command': 'python "C:/x/chat.py" post --as A'}) == 'chat:post'
        assert target_of('Read', {'file_path': 'D:/a/b/parser.py'}) == 'parser.py'
        act.hook({'kind': 'tool', 'agentId': 'a1111111111111111', 'id': 't1', 'tool': 'Edit', 'input': {'file_path': 'x/y.py'}})
        act.hook({'kind': 'ask', 'agentId': 'a1111111111111111', 'id': 't1'})
        v = act.state()['agents']['FETTE']
        assert v['tool'] == 'Edit' and v['target'] == 'y.py' and v['waiting']
        act.hook({'kind': 'done', 'agentId': 'a1111111111111111', 'id': 't1', 'ok': False})
        v = act.state()['agents']['FETTE']
        assert v['tool'] is None and not v['waiting'] and v['error_at'] and v['recent'][0]['ok'] is False
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
    print('activity.py: prova ok')


if __name__ == '__main__':
    _prova()
