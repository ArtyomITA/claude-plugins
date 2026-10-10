"""The common room shared between friends. Standard library only.

Host: Share.start(via) makes a 6-digit PIN and a small HTTP server of its own that answers /share/* and nothing else,
then exposes that server: a cloudflared Quick Tunnel (no account), Pinggy over ssh (no install, 60-minute sessions),
or the local network. The viewer's server stays on 127.0.0.1 and is never reachable through the tunnel. A guest trades
the PIN for a token; ten wrong PINs in ten minutes close the door for ten minutes. Everything ends with Share.stop().

Guest: Bridge(url, pin) joins and, every two seconds, pulls the common room's new messages into ROOM/common (a mirror),
pushes the lines the guest's side wrote (ROOM/common/outbox.jsonl) and tells who of the guest's agents is there.

Only the common room's own messages and a coarse presence (name, emoji, colour, working or on a break) cross; never
the main room, files, tools or paths."""
import base64
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

BIN = Path.home() / '.claude' / 'chatroom' / 'bin'
CLOUDFLARED = '2026.9.3'                                    # pinned, with the checksums from its release page
SUMS = {
    ('windows', 'amd64'): ('cloudflared-windows-amd64.exe', 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'),
    ('linux', 'amd64'): ('cloudflared-linux-amd64', '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2'),
    ('linux', 'arm64'): ('cloudflared-linux-arm64', 'aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d'),
    ('darwin', 'amd64'): ('cloudflared-darwin-amd64.tgz', 'ab588b3b4db9cdb4476c30a3db2a72635b1d8327d44741fee6799a0f37b0ec07'),
    ('darwin', 'arm64'): ('cloudflared-darwin-arm64.tgz', '5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32'),
}
VIAS = ('cloudflared', 'pinggy', 'lan', 'local')
LINE_MAX = 32000                                         # a common room line: about ten pages
DOC_MAX = 5 * 1024 * 1024                                # a document: a text file up to 5 MB
DOC_EXT = {'.md', '.txt', '.json', '.diff', '.patch', '.py', '.js', '.ts', '.csv', '.yaml', '.yml', '.toml', '.sh', '.ps1'}
NAME = re.compile(r'^[A-Za-z0-9_-]{1,24}$')
COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
MAX_BODY = 128 * 1024
DOC_BODY = DOC_MAX * 4 // 3 + 64 * 1024                  # a document travels as base64


def person(d):
    """a coarse presence entry, checked: name, emoji, colour and working/break"""
    name = str(d.get('name', '')).strip()
    if not NAME.match(name):
        raise ValueError('names are letters, digits, _ and -, up to 24')
    return {'name': name, 'emoji': str(d.get('emoji', ''))[:8], 'color': d['color'] if COLOR.match(str(d.get('color', ''))) else '#888888',
            'state': 'break' if d.get('state') == 'break' else 'work'}


GONE = 15                                                   # seconds without a word: a guest (or the host) is gone
GAMES = {'tris': ('new', 'join', 'move', 'quit'), 'morra': ('new', 'join', 'commit', 'reveal', 'quit'), 'dadi': ('roll',), 'tv': ('play',),
         'pool': ('new', 'join', 'shot', 'quit')}
POOL_W, POOL_H = 800, 440                                   # the pool table's canvas (office-games.js)


def num(x, lo, hi):
    """a number in lo..hi (NaN and infinity are out: they would break the JSON of the room)"""
    try:
        v = float(x)
    except (TypeError, ValueError, OverflowError):
        raise ValueError('a number was expected')
    if not lo <= v <= hi:
        raise ValueError('a number out of its range')
    return v


def clean_game(g):
    """a game move, checked: the game and its id, the kind of move, and only the fields that move needs"""
    try:
        return _clean_game(g)
    except (OverflowError, TypeError):                 # int(infinity), int([]): a bad number is a bad move, not a crash
        raise ValueError('a game move has a bad number')


def _clean_game(g):
    if not isinstance(g, dict):
        raise ValueError('a game move must be an object')
    kind, op, gid = str(g.get('type', '')), str(g.get('op', '')), re.sub(r'[^a-z0-9]', '', str(g.get('id', '')))[:12]
    if kind not in GAMES or op not in GAMES[kind] or not gid:
        raise ValueError('unknown game move')
    out = {'type': kind, 'op': op, 'id': gid}
    if op == 'move':
        out['cell'] = int(g.get('cell', -1))
        if not 0 <= out['cell'] <= 8:
            raise ValueError('a tris cell goes from 0 to 8')
    if op == 'commit':
        out['hash'] = str(g.get('hash', ''))
        if not re.fullmatch(r'[0-9a-f]{64}', out['hash']):
            raise ValueError('a commit is a sha256 in hex')
    if op == 'reveal':
        out['pick'], out['salt'] = str(g.get('pick', '')), str(g.get('salt', ''))
        if out['pick'] not in ('sasso', 'carta', 'forbici') or not re.fullmatch(r'[0-9a-f]{8,32}', out['salt']):
            raise ValueError('a reveal is sasso, carta or forbici with its salt')
    if kind == 'tv':                                  # watch together: a YouTube video, from when it started
        out['v'] = str(g.get('v', ''))
        try:
            out['t'] = float(g.get('t') or 0)
        except OverflowError:
            out['t'] = 0.0
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', out['v']):
            raise ValueError('a YouTube video id has 11 letters, digits, - or _')
        if not 1e9 <= out['t'] < 4e9:                 # seconds since 1970; also false for NaN and infinity, which would break the JSON
            raise ValueError('the start time is seconds since 1970')
        out['title'] = re.sub(r'[\x00-\x1f<>]', '', str(g.get('title', '')))[:120]
    if op == 'shot':                                  # pool: the angle and power of the shot, where the 16 balls ended, whose turn, the winner
        end = g.get('end')
        if not isinstance(end, list) or len(end) != 16:
            raise ValueError('a pool shot ends with 16 balls')
        out['a'], out['p'] = round(num(g.get('a'), -10, 10), 5), round(num(g.get('p'), 0, 1), 4)
        try:
            out['end'] = [None if b is None else [round(num(b[0], 0, POOL_W), 1), round(num(b[1], 0, POOL_H), 1)] for b in end]
        except (IndexError, KeyError, TypeError):
            raise ValueError('a ball is null or [x, y]')
        groups = g.get('groups')
        if not isinstance(groups, list) or len(groups) != 2 or any(x not in (None, 'solids', 'stripes') for x in groups):
            raise ValueError('pool groups are solids, stripes or nothing, for the two players')
        out['groups'] = groups
        out['turn'] = int(num(g.get('turn'), 0, 1))
        if g.get('win') is not None:
            out['win'] = int(num(g.get('win'), 0, 1))
    if op == 'roll':
        out['roll'] = [int(x) for x in (g.get('roll') or [])][:5]
        if not out['roll'] or not all(1 <= x <= 6 for x in out['roll']):
            raise ValueError('dice go from 1 to 6')
    return out


def doc_name(name):
    """a safe file name for a shared document: letters, digits, dot, dash, underscore; a known text extension"""
    base = re.sub(r'[^A-Za-z0-9._-]', '_', Path(str(name or 'doc.md')).name)[:80].lstrip('.') or 'doc.md'
    if Path(base).suffix.lower() not in DOC_EXT:
        base += '.txt'
    return base


def add_doc(common, author, name, data):
    """store a text document in the common room (ROOM/common/docs) and post a line pointing to it"""
    if len(data) > DOC_MAX:
        raise ValueError('a document can be at most 5 MB')
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('only text documents (UTF-8)')
    docs = Path(common.dir) / 'docs'
    docs.mkdir(exist_ok=True)
    did = 1 + sum(1 for _ in docs.iterdir())
    safe = doc_name(name)
    (docs / f'{did}-{safe}').write_bytes(data)
    return common.append(author, f'📎 {safe} ({max(1, len(data) // 1024)} KB)', doc={'id': did, 'name': safe, 'size': len(data)})


def doc_path(common_dir, doc):
    """the local file of a document line, or None"""
    try:
        p = Path(common_dir) / 'docs' / f"{int(doc['id'])}-{doc_name(doc['name'])}"
    except (KeyError, TypeError, ValueError):
        return None
    return p if p.is_file() else None


# ------------------------------------------------------------------ the host
class Share:
    def __init__(self, common, title, host, port_hint=0, people=lambda: [], office=lambda: {}, room=None, search=None, state=None):
        """common: the Room of the common room; host: the host's user name; people(): the host's agents in the room;
        office(): the host's plan and everyone's coarse presence, for visits"""
        self.common, self.title, self.host, self.people_fn, self.office_fn = common, title, host, people, office
        self.search = search                                 # the TV's YouTube search, lent to guests that cannot search
        self.state = state                                   # share.json: port, PIN, tunnel, guests, kept across restarts
        self.room = room                                     # the room's own chat for friends: allowed(), read(since), config(), post(name, text)
        self.requests = []                                   # help asked by guests: {id, guest, text, ts, status, ...}
        self.asks = []                                       # help the host asks a guest for: {id, to, text, ts, status, helper, ...}
        self.on_ask = self.on_line = None                    # chat.py hooks: a request came in (lend it by itself?), a guest line came in
        self.me_pos = None                                   # where the host's own figure is, from the viewer
        self.lock = threading.Lock()
        self.fails = deque()
        self.server, self.tunnel_pid, self.port = None, None, None
        self._clear()

    def _clear(self):
        self.pin = self.via = self.url = self.error = None
        self.guests = {}                                    # token -> {name, emoji, color, agents, seen, posts}
        self.requests = []
        self.asks = []

    def start(self, via):
        if via not in VIAS:
            raise ValueError(f'via must be one of {VIAS}')
        self.stop()
        handler = make_handler(self)
        self.server = ThreadingHTTPServer(('0.0.0.0' if via == 'lan' else '127.0.0.1', 0), handler)
        port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.pin, self.via = f'{secrets.randbelow(1_000_000):06d}', via
        self.fails.clear()                                    # a new PIN: old wrong guesses mean nothing now
        self.port = port
        if via == 'lan':
            self.url = f'http://{lan_ip()}:{port}'
        elif via == 'local':
            self.url = f'http://127.0.0.1:{port}'
        else:
            start_tunnel(via, port, self, (self.state.parent if self.state else Path.home() / '.claude' / 'chatroom') / 'tunnel.log')
        self.save()

    def save(self):
        """keep the sharing for a restart of the viewer (only 'stop' forgets it)"""
        if not self.state or not self.pin:
            return
        with self.lock:
            data = {'via': self.via, 'port': self.port, 'pin': self.pin, 'url': self.url, 'pid': self.tunnel_pid,
                    'guests': [{'token': t, **{k: g[k] for k in ('name', 'emoji', 'color')}} for t, g in self.guests.items()]}
        tmp = self.state.with_suffix('.tmp')
        tmp.write_text(json.dumps(data), encoding='utf-8')
        os.replace(tmp, self.state)

    def resume(self):
        """after a restart of the viewer: the same port, PIN, tunnel and guests, as long as the tunnel still runs"""
        try:
            s = json.loads(self.state.read_text(encoding='utf-8')) if self.state and self.state.exists() else None
        except (OSError, ValueError):
            s = None
        if not s or s.get('via') not in VIAS or not s.get('pin') or not s.get('port'):
            return False
        tunnel = s['via'] in TUNNEL_URL
        if tunnel and not alive(s.get('pid')):
            self.state.unlink(missing_ok=True)
            return False
        try:
            self.server = ThreadingHTTPServer(('0.0.0.0' if s['via'] == 'lan' else '127.0.0.1', int(s['port'])), make_handler(self))
        except OSError:
            end(s.get('pid'))
            self.state.unlink(missing_ok=True)
            return False
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        now = time.time()
        self.pin, self.via, self.url, self.port = str(s['pin']), s['via'], s.get('url'), int(s['port'])
        for x in s.get('guests', []):
            try:
                self.guests[str(x['token'])[:100]] = {**person(x), 'agents': [], 'seen': now, 'posts': deque(), 'cids': deque(maxlen=400), 'me': None, 'office': None}
            except (KeyError, TypeError, ValueError):
                pass
        if tunnel:
            self.tunnel_pid = s['pid']
            watch_tunnel(self, self.tunnel_pid, self.state.parent / 'tunnel.log', TUNNEL_URL[self.via])
        return True

    def stop(self):
        """stop sharing: the tunnel ends and the kept sharing is forgotten"""
        end(self.tunnel_pid)
        self.tunnel_pid = None
        if self.state:
            self.state.unlink(missing_ok=True)
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        self._clear()

    def join(self, pin, guest):
        now = time.time()
        with self.lock:
            while self.fails and now - self.fails[0] > 600:
                self.fails.popleft()
            if not self.pin:
                raise ValueError('the room is not shared right now')
            if len(self.fails) >= 10:
                raise ValueError('too many wrong PINs: try again in a few minutes')
            if not hmac.compare_digest(str(pin), self.pin):
                self.fails.append(now)
                raise ValueError('wrong PIN')
            g = person(guest)
            if any(x['name'] == g['name'] for x in self.guests.values()) or g['name'] == self.host:
                raise ValueError('that name is taken in this room')
            token = secrets.token_hex(24)
            self.guests[token] = {**g, 'agents': [], 'seen': now, 'posts': deque(), 'cids': deque(maxlen=400), 'me': None, 'office': None}
        self.save()                                          # a restart of the viewer keeps this guest in
        return token

    def guest(self, token):
        with self.lock:
            g = self.guests.get(str(token or ''))
            if g:
                g['seen'] = time.time()
            return g

    def kick(self, name):
        with self.lock:
            for t, g in list(self.guests.items()):
                if g['name'] == name:
                    del self.guests[t]
        self.save()

    def post(self, g, author, text, game=None, cid=None):
        """a line from a guest's side, as GUEST or GUEST·AGENT; at most 20 a minute per guest. A line sent again
        after a timeout (same cid) is taken once."""
        cid = re.sub(r'[^0-9a-f]', '', str(cid or ''))[:32]
        if cid and cid in g.setdefault('cids', deque(maxlen=400)):
            return 0
        now = time.time()
        while g['posts'] and now - g['posts'][0] > 60:
            g['posts'].popleft()
        if len(g['posts']) >= 20:
            raise ValueError('slow down: 20 lines a minute')
        g['posts'].append(now)
        author = str(author or '').strip()
        name = g['name'] if not author or author == g['name'] else f"{g['name']}·{person({'name': author})['name']}"
        n = self.common.append(name, str(text).strip()[:LINE_MAX], game=clean_game(game) if game else None)
        if cid:
            g['cids'].append(cid)
        self._line({'from': name, 'text': str(text).strip()[:LINE_MAX]})
        return n

    def _line(self, line):
        """tell chat.py about a line a guest side wrote (a lent helper's words go to the main chat); never breaks the post"""
        if self.on_line:
            try:
                self.on_line(line)
            except Exception:
                pass

    def doc(self, g, author, name, data, cid=None):
        """a document from a guest's side: at most 10 an hour per guest (taken once per cid)"""
        cid = re.sub(r'[^0-9a-f]', '', str(cid or ''))[:32]
        if cid and cid in g.setdefault('cids', deque(maxlen=400)):
            return 0
        now = time.time()
        g.setdefault('docs', deque())
        while g['docs'] and now - g['docs'][0] > 3600:
            g['docs'].popleft()
        if len(g['docs']) >= 10:
            raise ValueError('slow down: 10 documents an hour')
        g['docs'].append(now)
        author = str(author or '').strip()
        who = g['name'] if not author or author == g['name'] else f"{g['name']}·{person({'name': author})['name']}"
        n = add_doc(self.common, who, name, data)
        if cid:
            g['cids'].append(cid)
        line = next((m for m in self.common.messages() if m['n'] == n), None)
        if line:
            self._line({'from': who, 'text': line['text'], 'doc': line.get('doc')})
        return n

    def room_post(self, g, text, cid=None):
        """a friend writes in the room's own chat: same limits as the common room, taken once per cid"""
        cid = re.sub(r'[^0-9a-f]', '', str(cid or ''))[:32]
        if cid and cid in g.setdefault('cids', deque(maxlen=400)):
            return 0
        now = time.time()
        while g['posts'] and now - g['posts'][0] > 60:
            g['posts'].popleft()
        if len(g['posts']) >= 20:
            raise ValueError('slow down: 20 lines a minute')
        text = str(text).strip()[:LINE_MAX]
        if not text:
            raise ValueError('empty message')
        g['posts'].append(now)
        n = self.room.post(g['name'], text, g.get('color'))
        if cid:
            g['cids'].append(cid)
        return n

    def ask(self, g, text):
        """a guest asks for help (research, a plan, a change to their files): the host decides, nothing runs before"""
        text = str(text).strip()[:1500]
        if not text:
            raise ValueError('say what you need')
        with self.lock:
            if sum(1 for r in self.requests if r['guest'] == g['name'] and r['status'] == 'pending') >= 2:
                raise ValueError('wait for the host to answer the requests already sent')
            r = {'id': len(self.requests) + 1, 'guest': g['name'], 'text': text, 'ts': time.time(), 'status': 'pending'}
            self.requests.append(r)
        if self.on_ask:                                       # the host may have said: lend by yourself
            try:
                self.on_ask(r)
            except Exception:
                pass
        return {'id': r['id']}

    def ask_guest(self, name, text):
        """the host asks a guest to lend one of their agents: the guest decides on their side, nothing runs before"""
        text = str(text).strip()[:1500]
        if not text:
            raise ValueError('say what you need')
        with self.lock:
            if not any(g['name'] == name for g in self.guests.values()):
                raise ValueError('that friend is not in the room')
            if sum(1 for a in self.asks if a['to'] == name and a['status'] == 'pending') >= 2:
                raise ValueError('wait for the friend to answer the asks already sent')
            a = {'id': len(self.asks) + 1, 'to': name, 'text': text, 'ts': time.time(), 'status': 'pending'}
            self.asks.append(a)
            return {'id': a['id']}

    def ask_answer(self, g, rid, ok, helper=None, model=None, minutes=None):
        """a guest answers an ask of the host; the helper they lend is seen here as GUEST·HELPER"""
        with self.lock:
            a = next((a for a in self.asks if a['id'] == rid and a['to'] == g['name']), None)
            if not a or a['status'] != 'pending':
                raise ValueError('no such pending ask')
            if ok:
                minutes = int(num(minutes or 30, 5, 120))
                a.update(helper=f"{g['name']}·{person({'name': helper})['name']}", model=str(model or '')[:24], minutes=minutes, until=time.time() + minutes * 60)
            a['status'] = 'approved' if ok else 'declined'
            return {}

    def taken(self):
        """the agents guests lend to the host right now, still within their time"""
        now = time.time()
        return [a for a in self.asks if a['status'] == 'approved' and a.get('until', 0) > now]

    def answer(self, rid, ok, helper=None, model=None, effort=None, minutes=None):
        with self.lock:
            r = next((r for r in self.requests if r['id'] == rid), None)
            if not r or r['status'] != 'pending':
                raise ValueError('no such pending request')
            r['status'] = 'approved' if ok else 'declined'
            if ok:
                r.update(helper=helper, model=model, effort=effort, minutes=minutes, until=time.time() + minutes * 60)
            return r

    def helpers(self):
        """the agents lent right now, still within their time"""
        now = time.time()
        return [r for r in self.requests if r['status'] == 'approved' and r.get('until', 0) > now]

    def people(self):
        """everyone in the common room from the outside: the guests and their agents, the host's agents"""
        with self.lock:
            here = [g for g in self.guests.values() if time.time() - g.get('seen', 0) < GONE]
            out = [{**{k: g[k] for k in ('name', 'emoji', 'color')}, 'state': 'break', 'guest': g['name'], 'pos': g.get('me')} for g in here]
            for g in here:
                out += [{**a, 'name': f"{g['name']}·{a['name']}", 'guest': g['name']} for a in g['agents']]
        out += [{'name': a['helper'], 'emoji': '🤝', 'color': '#26a69a', 'state': 'work', 'guest': a['to']} for a in self.taken()
                if not any(p['name'] == a['helper'] for p in out)]
        host = {'name': self.host, 'emoji': '👑', 'color': '#f5b400', 'state': 'break', 'guest': None, 'host': True, 'pos': self.me_pos}
        lent = [{'name': r['helper'], 'emoji': '🤝', 'color': '#26a69a', 'state': 'work', 'guest': None, 'helper_for': r['guest']} for r in self.helpers()]
        return out + [host] + [{**p, 'guest': None} for p in self.people_fn()] + lent

    def guest_office(self, name):
        """a guest's office as they last sent it, for the host's visit (None until it arrives)"""
        with self.lock:
            g = next((g for g in self.guests.values() if g['name'] == name), None)
            return g and g.get('office') and {**g['office'], 'host': g['name']}

    def status(self):
        with self.lock:
            return {'sharing': bool(self.pin), 'via': self.via, 'url': self.url, 'pin': self.pin, 'error': self.error,
                    'requests': [{k: r[k] for k in ('id', 'guest', 'text', 'status', 'helper', 'model', 'effort', 'minutes') if k in r} for r in self.requests],
                    'asks': [{k: a[k] for k in ('id', 'to', 'text', 'status', 'helper', 'model', 'minutes') if k in a} for a in self.asks],
                    'guests': [{k: g[k] for k in ('name', 'emoji', 'color')} | {'agents': len(g['agents'])} for g in self.guests.values()]}


def make_handler(share):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, obj):
            data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def body(self, limit=MAX_BODY):
            n = int(self.headers.get('Content-Length') or 0)
            if n < 0 or n > limit:
                raise ValueError('bad length')
            return json.loads(self.rfile.read(n).decode('utf-8') or '{}')

        def do_GET(self):
            path, _, query = self.path.partition('?')
            if path not in ('/share/feed', '/share/office', '/share/room', '/share/tvsearch') and not re.fullmatch(r'/share/doc/\d{1,6}', path):
                return self.send(404, {'error': 'not found'})
            g = share.guest(self.headers.get('X-Chatroom-Token'))
            if not g:
                return self.send(401, {'error': 'join first'})
            if path.startswith('/share/doc/'):              # a document of the common room, as plain text
                did = int(path.rsplit('/', 1)[1])
                line = next((m for m in share.common.messages() if (m.get('doc') or {}).get('id') == did), None)
                p = doc_path(share.common.dir, line['doc']) if line else None
                if not p:
                    return self.send(404, {'error': 'no such document'})
                data = p.read_bytes()
                self.send_response(200); self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('X-Content-Type-Options', 'nosniff'); self.send_header('Content-Length', str(len(data))); self.end_headers()
                return self.wfile.write(data)
            if path == '/share/tvsearch':                 # a guest that cannot search YouTube searches through the host (6 a minute)
                if not share.search:
                    return self.send(404, {'error': 'the host cannot search'})
                now = time.time()
                g.setdefault('searches', deque())
                while g['searches'] and now - g['searches'][0] > 60:
                    g['searches'].popleft()
                if len(g['searches']) >= 6:
                    return self.send(429, {'error': 'slow down: 6 searches a minute'})
                g['searches'].append(now)
                q = re.sub(r'[\x00-\x1f]', ' ', (re.search(r'(?:^|&)q=([^&]*)', query) or [0, ''])[1])
                try:
                    q = urllib.parse.unquote_plus(q).strip()[:100]
                    return self.send(200, {'results': share.search(q) if q else []})
                except RuntimeError as exc:
                    return self.send(503, {'error': str(exc)})
            if path == '/share/room':                     # the room's own chat, when the host shares it with friends
                if not share.room or not share.room.allowed():
                    return self.send(403, {'error': 'the host does not share the room chat'})
                since = int((re.search(r'(?:^|&)since=(\d+)', query) or [0, 0])[1])
                return self.send(200, {'messages': share.room.read(since)[:300], 'config': share.room.config()})
            if path == '/share/office':                   # a visit: the host's plan and everyone's coarse presence
                return self.send(200, {**share.office_fn(), 'host': share.host, 'title': share.title, 'present': share.people()})
            since = int((re.search(r'(?:^|&)since=(\d+)', query) or [0, 0])[1])
            msgs = [{k: m[k] for k in ('n', 'time', 'from', 'text', 'doc', 'game') if k in m} for m in share.common.messages() if m['n'] > since][:200]
            mine = [{k: r[k] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes') if k in r} for r in share.requests if r['guest'] == g['name']]
            asks = [{k: a[k] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes') if k in a} for a in share.asks if a['to'] == g['name']]
            self.send(200, {'title': share.title, 'host': share.host, 'messages': msgs, 'people': share.people(), 'requests': mine, 'asks': asks})

        def do_POST(self):
            path = self.path.split('?')[0]
            try:
                body = self.body(DOC_BODY if path == '/share/doc' else MAX_BODY)
            except (ValueError, json.JSONDecodeError):
                return self.send(400, {'error': 'bad request'})
            if path == '/share/join':
                try:
                    token = share.join(str(body.get('pin', '')), body)
                except ValueError as exc:
                    return self.send(403, {'error': str(exc)})
                return self.send(200, {'token': token, 'title': share.title, 'host': share.host})
            g = share.guest(self.headers.get('X-Chatroom-Token'))
            if not g:
                return self.send(401, {'error': 'join first'})
            try:
                if path == '/share/room':
                    if not share.room or not share.room.allowed():
                        return self.send(403, {'error': 'the host does not share the room chat'})
                    return self.send(200, {'n': share.room_post(g, body.get('text', ''), body.get('cid'))})
                if path == '/share/post':
                    return self.send(200, {'n': share.post(g, body.get('from'), body.get('text', ''), body.get('game'), body.get('cid'))})
                if path == '/share/presence':
                    if 'agents' in body:
                        g['agents'] = [person(a) for a in (body.get('agents') or [])[:12]]
                    if 'me' in body:
                        g['me'] = clean_pos(body['me'])
                    if isinstance(body.get('office'), dict):    # the guest's plan, for a visit by the host (checked when it is drawn)
                        o = body['office']
                        g['office'] = {'items': o.get('items') if isinstance(o.get('items'), list) else None,
                                       'people': [p for p in (o.get('people') or [])[:40] if isinstance(p, dict)], 'title': str(o.get('title') or '')[:120],
                                       'common': clean_common(o.get('common'))}
                    return self.send(200, {})
                if path == '/share/doc':              # a guest shares a document
                    try:
                        data = base64.b64decode(str(body.get('data', '')), validate=True)
                    except (ValueError, TypeError):
                        raise ValueError('the document must be base64')
                    return self.send(200, {'n': share.doc(g, body.get('from'), body.get('name'), data, body.get('cid'))})
                if path == '/share/request':          # a guest asks the host to lend an agent
                    return self.send(200, share.ask(g, body.get('text', '')))
                if path == '/share/askanswer':        # a guest answers an ask of the host
                    return self.send(200, share.ask_answer(g, int(num(body.get('id'), 0, 1e6)), bool(body.get('ok')), body.get('helper'), body.get('model'), body.get('minutes')))
                if path == '/share/leave':
                    share.kick(g['name'])
                    return self.send(200, {})
            except ValueError as exc:
                return self.send(429 if 'slow' in str(exc) else 400, {'error': str(exc)})
            self.send(404, {'error': 'not found'})
    return Handler


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))                   # no packet is sent: it only picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


# ------------------------------------------------------------------ tunnels
def cloudflared_path():
    exe = shutil.which('cloudflared')
    local = BIN / ('cloudflared.exe' if os.name == 'nt' else 'cloudflared')
    return exe or (str(local) if local.is_file() else None)


def install_cloudflared():
    """download the pinned cloudflared from its GitHub release into ~/.claude/chatroom/bin, checked by SHA256"""
    osname = {'Windows': 'windows', 'Linux': 'linux', 'Darwin': 'darwin'}.get(platform.system())
    arch = {'AMD64': 'amd64', 'x86_64': 'amd64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine())
    if (osname, arch) not in SUMS:
        raise ValueError(f'no cloudflared build for {platform.system()} {platform.machine()}: install it yourself')
    asset, digest = SUMS[(osname, arch)]
    url = f'https://github.com/cloudflare/cloudflared/releases/download/{CLOUDFLARED}/{asset}'
    with urllib.request.urlopen(url, timeout=180) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('the download does not match its published checksum: nothing installed')
    BIN.mkdir(parents=True, exist_ok=True)
    target = BIN / ('cloudflared.exe' if osname == 'windows' else 'cloudflared')
    if asset.endswith('.tgz'):
        with tarfile.open(fileobj=BytesIO(data)) as tar:
            member = next(m for m in tar.getmembers() if Path(m.name).name == 'cloudflared' and m.isfile())
            data = tar.extractfile(member).read()
    target.write_bytes(data)
    target.chmod(0o755)
    return str(target)


def alive(pid):
    """is this process still running (a tunnel kept from before a restart of the viewer)"""
    if not pid:
        return False
    if os.name == 'nt':
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, int(pid))                 # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return bool(ok) and code.value == 259                    # STILL_ACTIVE
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def end(pid):
    """stop a tunnel process"""
    if not alive(pid):
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(int(pid)), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.kill(int(pid), 15)
        except OSError:
            pass


def watch_tunnel(share, pid, log, pattern):
    """read the tunnel's public address from its log, and notice when it ends"""
    def run():
        while share.tunnel_pid == pid:
            if not share.url:
                for f in (log, log.with_name(log.name + '.out')):
                    try:
                        m = re.search(pattern, f.read_text(encoding='utf-8', errors='replace'))
                    except OSError:
                        m = None
                    if m:
                        share.url, share.error = m.group(0), None
                        share.save()
                        break
            if not alive(pid):
                if share.tunnel_pid == pid:
                    share.error, share.url = 'the tunnel closed', None
                return
            time.sleep(0.5)
    threading.Thread(target=run, daemon=True).start()


TUNNEL_URL = {'cloudflared': r'https://[a-z0-9-]+\.trycloudflare\.com', 'pinggy': r'https://[a-z0-9.-]+\.pinggy\.(?:link|online)'}


def start_tunnel(via, port, share, log):
    """start the tunnel as a process of its own, so it outlives a restart of the viewer; returns its process id"""
    if via == 'cloudflared':
        exe = cloudflared_path()
        if not exe:
            raise ValueError('cloudflared is not installed')
        cmd = [exe, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{port}']
    else:
        ssh = shutil.which('ssh')
        if not ssh:
            raise ValueError('ssh is not available on this computer')
        cmd = [ssh, '-T', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30',
               '-o', 'ExitOnForwardFailure=yes', f'-R0:127.0.0.1:{port}', 'free.pinggy.io']
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text('', encoding='utf-8')
    if os.name == 'nt':                       # through Start-Process: its parent ends at once, so closing the viewer leaves it running
        q = lambda s: "'" + str(s).replace("'", "''") + "'"
        pidfile = log.with_name(log.name + '.pid')
        pidfile.unlink(missing_ok=True)
        ps = (f"(Start-Process -FilePath {q(cmd[0])} -ArgumentList {','.join(q(a) for a in cmd[1:])} -WindowStyle Hidden "
              f"-RedirectStandardError {q(log)} -RedirectStandardOutput {q(str(log) + '.out')} -PassThru).Id | Set-Content -Path {q(pidfile)}")
        # no pipes to PowerShell: the tunnel would inherit them, and this call would wait for the tunnel to end
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            pid = int(pidfile.read_text(encoding='utf-8-sig').strip())
        except (OSError, ValueError):
            raise ValueError('the tunnel did not start')
    else:
        with open(log, 'w') as out:
            pid = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True).pid
    share.tunnel_pid = pid
    watch_tunnel(share, pid, log, TUNNEL_URL[via])
    return pid


# ------------------------------------------------------------------ the guest
def clean_line(m):
    """a common room line from the other side: only these fields, bounded; nothing else (no pictures, no kinds)"""
    out = {'n': int(m.get('n', 0)), 'time': str(m.get('time', ''))[:20], 'from': clean_name(m.get('from')), 'text': str(m.get('text', ''))[:LINE_MAX]}
    if isinstance(m.get('game'), dict):
        try:
            out['game'] = clean_game(m['game'])
        except (ValueError, TypeError):
            pass
    d = m.get('doc')
    if isinstance(d, dict):
        try:
            out['doc'] = {'id': int(d['id']), 'name': doc_name(d.get('name')), 'size': min(int(d.get('size', 0)), DOC_MAX)}
        except (KeyError, TypeError, ValueError):
            pass
    return out


AVATAR = {'style': ('short', 'spiky', 'bob', 'bun', 'long', 'cap', 'beanie', 'bald'), 'outfit': ('suit', 'cardigan', 'hoodie', 'polo')}


def clean_avatar(a):
    """a figure's look: colours, a hair style, an outfit, glasses and headphones; nothing else"""
    if not isinstance(a, dict):
        return None
    out = {k: a[k] for k in ('skin', 'hair', 'top', 'pants') if COLOR.match(str(a.get(k, '')))}
    out.update({k: a[k] for k, opts in AVATAR.items() if a.get(k) in opts})
    out.update({k: a[k] for k in ('glasses', 'headphones') if isinstance(a.get(k), bool)})
    return out or None


def clean_pos(d):
    """where a figure is: a point of the floor plan, its height (a seat), a heading, a pose, and whose office it is in
    ('home', or 'visit:NAME' while visiting NAME); anything else is dropped"""
    if not isinstance(d, dict):
        return None
    try:
        x, y, z, rot = (max(-80.0, min(80.0, float(d.get(k) or 0))) for k in ('x', 'y', 'z', 'rot'))
    except (TypeError, ValueError):
        return None
    where = str(d.get('where') or 'home')
    if where != 'home' and not re.fullmatch(r'visit:[A-Za-z0-9_-]{1,24}', where):
        return None
    return {'x': round(x, 2), 'y': round(min(2.0, max(-0.5, y)), 2), 'z': round(z, 2), 'rot': round(rot, 3),
            'pose': d.get('pose') if d.get('pose') in ('walk', 'stand', 'sit', 'sofa') else 'stand', 'where': where,
            'look': clean_avatar(d.get('look'))}


def clean_name(name):
    return re.sub(r'[\x00-\x1f<>&"]', '', str(name or '?'))[:60] or '?'


def clean_room_line(m):
    """a line of the host's room chat, for drawing: number, time, author, text, and whether it is a status"""
    return {'n': int(m.get('n') or 0), 'time': str(m.get('time') or '')[:8], 'from': clean_name(m.get('from')),
            'text': str(m.get('text') or '')[:LINE_MAX], **({'kind': m['kind']} if m.get('kind') in ('status', 'idle') else {})}


def clean_common(c):
    """who of an office may spend a break in its common room (the visitor needs it to put the agents where the owner sees them)"""
    c = c if isinstance(c, dict) else {}
    return {'all': c.get('all') is True, 'who': [clean_name(x) for x in (c.get('who') if isinstance(c.get('who'), list) else [])[:40]]}


def clean_room_config(c):
    """the host room's look, for drawing its chat: title, colours, who is who; nothing else"""
    c = c if isinstance(c, dict) else {}
    names = lambda v: [clean_name(x) for x in (v if isinstance(v, list) else [])[:30]]
    profiles = {clean_name(k): {'emoji': str(v.get('emoji', ''))[:8], 'color': v['color'] if COLOR.match(str(v.get('color', ''))) else '#888888',
                                'role': clean_name(v.get('role', ''))} for k, v in list((c.get('profiles') or {}).items())[:40] if isinstance(v, dict)}
    return {'title': clean_name(c.get('title') or ''), 'subtitle': clean_name(c.get('subtitle') or ''), 'icon': str(c.get('icon') or '')[:8],
            'accent': c['accent'] if COLOR.match(str(c.get('accent', ''))) else '#00a884', 'lang': 'en' if c.get('lang') == 'en' else 'it',
            'participants': names(c.get('participants')), 'self_names': names(c.get('self_names')), 'host': clean_name(c.get('user_name')),
            'profiles': profiles}


def clean_person(p):
    """a presence entry from the other side, for drawing: bounded strings, a real colour, nothing else"""
    out = {'name': clean_name(p.get('name')), 'emoji': str(p.get('emoji', ''))[:8], 'state': 'work' if p.get('state') == 'work' else 'break',
           'color': p['color'] if COLOR.match(str(p.get('color', ''))) else '#888888', 'guest': None if p.get('guest') is None else clean_name(p.get('guest'))}
    if p.get('host'):
        out['host'] = True
    if p.get('pos'):
        out['pos'] = clean_pos(p['pos'])
    return out


def call(url, path, token=None, body=None, timeout=10):
    req = urllib.request.Request(url.rstrip('/') + path, method='POST' if body is not None else 'GET',
                                 data=None if body is None else json.dumps(body).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', **({'X-Chatroom-Token': token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            cap = DOC_MAX if path.startswith('/share/doc/') else 2 * 1024 * 1024    # a friend's server is still someone else's
            data = r.read(cap + 1)
            if len(data) > cap:
                raise ValueError('the other side sent too much')
            return data if path.startswith('/share/doc/') else json.loads(data.decode('utf-8') or '{}')
    except urllib.error.HTTPError as exc:
        try:
            msg = json.loads(exc.read().decode('utf-8')).get('error')
        except (ValueError, OSError):
            msg = None
        raise PermissionError(msg or f'HTTP {exc.code}') if exc.code in (401, 403) else ValueError(msg or f'HTTP {exc.code}')


class Bridge:
    def __init__(self, common_dir, url, pin, me, people=lambda: [], office=None, outgoing=lambda: [], arrived=lambda lines: None):
        """common_dir: ROOM/common of the guest; me: {name, emoji, color} of the guest; people(): the guest's agents there;
        office(): the guest's plan and people, for a visit by the host; outgoing(): lines to add to the common room
        (tags of a lent helper written in the guest's own chat); arrived(lines): the new common room lines"""
        self.dir, self.url, self.pin, self.me, self.people_fn = Path(common_dir), url.strip(), str(pin).strip(), me, people
        self.office_fn, self.outgoing, self.arrived, self.me_pos = office, outgoing, arrived, None
        self.room_lines, self.room_n, self.room_cfg, self.room_ok, self.room_next = [], 0, None, False, 0
        self.heard = time.time()
        self.token = self.title = self.host = self.error = None
        self.n, self.people, self.requests, self.stopped = 0, [], [], threading.Event()
        self.asks, self.on_asks, self.asks_seen = [], None, set()         # the host's asks for help; on_asks(new pending ones)
        self.dir.mkdir(parents=True, exist_ok=True)

    def start(self, token=None, title='', host=''):
        if not re.match(r'^https?://[\w.-]+(:\d+)?/?$', self.url):
            raise ValueError('the address looks like https://something.trycloudflare.com')
        if token:                                                    # back after a restart of the viewer: the same pass, no PIN
            self.token, self.title, self.host = str(token)[:100], str(title)[:120], clean_name(host)
            try:
                self.n = max([0] + [int(json.loads(x).get('n', 0)) for x in (self.dir / 'chat.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()])
            except (OSError, ValueError):
                self.n = 0
        else:
            r = call(self.url, '/share/join', body={**self.me, 'pin': self.pin})
            self.token, self.title, self.host = str(r['token'])[:100], str(r.get('title') or '')[:120], clean_name(r.get('host'))
            (self.dir / 'chat.jsonl').write_text('', encoding='utf-8')   # the mirror starts fresh
        (self.dir / 'link.json').write_text(json.dumps({'role': 'guest', 'url': self.url, 'host': self.host, 'title': self.title, 'token': self.token}),
                                           encoding='utf-8')
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        last_presence = last_office = 0
        sent_me = None
        while not self.stopped.is_set():
            try:
                lines = self.outgoing()
                if lines:
                    with (self.dir / 'outbox.jsonl').open('a', encoding='utf-8') as f:
                        for line in lines:
                            f.write(json.dumps(line, ensure_ascii=False) + '\n')
                self.push()
                now, body = time.time(), {}
                if self.me_pos != sent_me:                 # the figure moved: its place goes at once, the rest when due
                    body['me'] = self.me_pos
                if now - last_presence > 10:
                    body['agents'] = self.people_fn()
                    last_presence = now
                if self.office_fn and now - last_office > 20:
                    body['office'] = self.office_fn()
                    last_office = now
                if body:
                    call(self.url, '/share/presence', self.token, body)
                    sent_me = body.get('me', sent_me)
                feed = call(self.url, f'/share/feed?since={self.n}', self.token)
                lines = [clean_line(m) for m in (feed.get('messages') or [])[:200] if isinstance(m, dict)]
                lines = [m for m in lines if m['n'] > self.n]
                if lines:
                    with (self.dir / 'chat.jsonl').open('a', encoding='utf-8') as f:
                        for m in lines:
                            f.write(json.dumps(m, ensure_ascii=False) + '\n')
                    self.n = max(m['n'] for m in lines)
                    for m in lines:                                # documents come down next to the mirror
                        if m.get('doc') and not doc_path(self.dir, m['doc']):
                            try:
                                data = call(self.url, f"/share/doc/{m['doc']['id']}", self.token, timeout=60)
                                (self.dir / 'docs').mkdir(exist_ok=True)
                                (self.dir / 'docs' / f"{m['doc']['id']}-{m['doc']['name']}").write_bytes(data)
                            except (ValueError, OSError):
                                pass
                if lines:
                    self.arrived(lines)
                if time.time() >= self.room_next:                # the host's room chat, if the host shares it with us
                    try:
                        got = call(self.url, f'/share/room?since={self.room_n}', self.token)
                        new = [clean_room_line(m) for m in (got.get('messages') or [])[:300] if isinstance(m, dict)]
                        new = [m for m in new if m['n'] > self.room_n]
                        self.room_lines = (self.room_lines + new)[-500:]
                        self.room_n = max([self.room_n] + [m['n'] for m in new])
                        self.room_cfg, self.room_ok = clean_room_config(got.get('config')), True
                    except (PermissionError, ValueError):
                        self.room_ok, self.room_next = False, time.time() + 5
                self.people = [clean_person(p) for p in (feed.get('people') or [])[:60] if isinstance(p, dict)]
                self.heard = time.time()
                self.requests = [{k: str(r.get(k, ''))[:300] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes')}
                                 for r in (feed.get('requests') or [])[:20] if isinstance(r, dict)]
                self.asks = [{k: str(a.get(k, ''))[:1500] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes')}
                             for a in (feed.get('asks') or [])[:20] if isinstance(a, dict)]
                fresh = [a for a in self.asks if a['status'] == 'pending' and a['id'] not in self.asks_seen]
                self.asks_seen.update(a['id'] for a in fresh)
                if fresh and self.on_asks:
                    try:
                        self.on_asks(fresh)
                    except Exception:
                        pass
                self.error = None
            except PermissionError as exc:
                self.error = f'closed by the host: {exc}'
                break
            except (ValueError, OSError) as exc:
                self.error = str(exc)
                if time.time() - self.heard > GONE:
                    self.people = []
            self.stopped.wait(0.3)                             # often enough for the figures to walk smoothly
        (self.dir / 'link.json').unlink(missing_ok=True)

    def push(self):
        """send what the guest's side wrote; a line is dropped only once the host took it"""
        out = self.dir / 'outbox.jsonl'
        if not out.exists():
            return
        sending = self.dir / 'outbox.sending'
        if not sending.exists():
            os.replace(out, sending)
        lines = [json.loads(x) for x in sending.read_text(encoding='utf-8').splitlines() if x.strip()]
        if any('cid' not in x for x in lines):
            lines = [{**x, 'cid': x.get('cid') or secrets.token_hex(8)} for x in lines]
            sending.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in lines), encoding='utf-8')
        for k, line in enumerate(lines):
            try:
                if line.get('doc_path'):                             # a document: read here, sent as base64
                    p = Path(line['doc_path'])
                    data = p.read_bytes() if p.is_file() and p.stat().st_size <= DOC_MAX else b''
                    if data:
                        call(self.url, '/share/doc', self.token, {'from': line.get('from'), 'name': p.name, 'cid': line['cid'],
                                                                  'data': base64.b64encode(data).decode('ascii')}, timeout=60)
                    continue
                call(self.url, '/share/post', self.token, line)
            except (ValueError, OSError):                       # a timeout may have delivered it: the cid keeps it single
                rest = lines[k:]
                sending.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rest), encoding='utf-8')
                raise
        sending.unlink()

    def tv_search(self, q):
        """the host searches YouTube for us; only well formed results come back"""
        r = call(self.url, '/share/tvsearch?q=' + urllib.parse.quote(str(q)[:100]), self.token, timeout=45)
        return [{'id': e['id'], 'title': str(e.get('title') or '')[:120], 'channel': str(e.get('channel') or '')[:60],
                 'duration': e.get('duration') if isinstance(e.get('duration'), (int, float)) else None}
                for e in (r.get('results') or [])[:16] if isinstance(e, dict) and re.fullmatch(r'[A-Za-z0-9_-]{11}', str(e.get('id', '')))]

    def room_post(self, text):
        return call(self.url, '/share/room', self.token, {'text': str(text)[:LINE_MAX], 'cid': secrets.token_hex(8)})

    def ask(self, text):
        return call(self.url, '/share/request', self.token, {'text': text})

    def answer_ask(self, rid, ok, helper=None, model=None, minutes=None):
        """tell the host what we do with its ask for help"""
        r = call(self.url, '/share/askanswer', self.token, {'id': int(rid), 'ok': bool(ok), 'helper': helper, 'model': model, 'minutes': minutes})
        for a in self.asks:
            if str(a['id']) == str(rid):
                a['status'] = 'approved' if ok else 'declined'
        return r

    def office(self):
        return call(self.url, '/share/office', self.token, timeout=15)

    def stop(self):
        self.stopped.set()
        try:
            call(self.url, '/share/leave', self.token, {}, timeout=4)
        except (ValueError, PermissionError, OSError):
            pass
        (self.dir / 'link.json').unlink(missing_ok=True)

    def status(self):
        return {'joined': bool(self.token) and not self.stopped.is_set(), 'url': self.url, 'host': self.host,
                'title': self.title, 'error': self.error, 'requests': self.requests, 'asks': self.asks}


def guest_link(common_dir):
    p = Path(common_dir) / 'link.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None


def _prova():
    """a host and a guest on this computer: PIN, token, post, mirror, wrong PINs, kick"""
    import tempfile

    class Common:                                             # just enough of chat.py's Room
        def __init__(self):
            self.items = []

        def messages(self):
            return list(self.items)

        def append(self, name, text, **extra):
            self.items.append({'n': len(self.items) + 1, 'time': '', 'from': name, 'text': text, **{k: v for k, v in extra.items() if v}})
            return len(self.items)
    common = Common()
    common.append('ALICE', 'benvenuti')
    host = Share(common, 'Stanza', 'ALICE', people=lambda: [{'name': 'MOTORE', 'emoji': '⚙️', 'color': '#123456', 'state': 'break'}])
    host.start('local')
    with tempfile.TemporaryDirectory() as tmp:
        try:
            call(host.url, '/share/join', body={'pin': '000000' if host.pin != '000000' else '111111', 'name': 'BOB'})
            raise AssertionError('a wrong PIN got in')
        except PermissionError:
            pass
        b = Bridge(tmp, host.url, host.pin, {'name': 'BOB', 'emoji': '🦊', 'color': '#ff8800'}, people=lambda: [{'name': 'RICERCA', 'state': 'break'}])
        b.start()
        (Path(tmp) / 'outbox.jsonl').write_text(json.dumps({'from': 'RICERCA', 'text': 'ciao a tutti'}) + '\n', encoding='utf-8')
        for _ in range(40):
            time.sleep(0.15)
            if any(m['from'] == 'BOB·RICERCA' for m in common.items) and b.n >= 2:
                break
        assert [m['from'] for m in common.items] == ['ALICE', 'BOB·RICERCA'], common.items
        mirror = [json.loads(x) for x in (Path(tmp) / 'chat.jsonl').read_text(encoding='utf-8').splitlines()]
        assert [m['text'] for m in mirror] == ['benvenuti', 'ciao a tutti'], mirror
        assert any(p['name'] == 'MOTORE' for p in b.people) and any(p['name'] == 'BOB·RICERCA' for p in host.people())
        g = next(iter(host.guests.values())); heard, g['seen'] = g['seen'], 0         # a guest silent for GONE seconds is gone
        assert not any(p.get('guest') == 'BOB' for p in host.people())
        g['seen'] = heard
        tv = {'type': 'tv', 'op': 'play', 'id': 'ab12', 'v': 'dQw4w9WgXcQ', 't': time.time(), 'title': 'x<y>'}
        assert clean_game(tv)['title'] == 'xy'
        for bad in ({**tv, 't': float('nan')}, {**tv, 't': 10 ** 400}, {**tv, 't': 0}, {**tv, 'v': 'dQw4w9WgXcé'}):
            try:
                clean_game(bad)
            except ValueError:
                continue
            raise AssertionError(f'a bad tv move got in: {bad}')
        shot = {'type': 'pool', 'op': 'shot', 'id': 'p1', 'a': 1.5, 'p': 0.5, 'end': [[100, 200]] + [None] * 15, 'groups': [None, 'solids'], 'turn': 1}
        assert clean_game(shot)['end'][0] == [100.0, 200.0] and clean_game({**shot, 'win': 0})['win'] == 0
        for bad in ({**shot, 'a': float('nan')}, {**shot, 'p': 2}, {**shot, 'end': shot['end'][:15]}, {**shot, 'end': [[1e9, 5]] + [None] * 15},
                    {**shot, 'end': [[1]] + [None] * 15}, {**shot, 'end': [5] + [None] * 15}, {**shot, 'groups': ['evens', None]}, {**shot, 'turn': 2}):
            try:
                clean_game(bad)
            except (ValueError, TypeError):
                continue
            raise AssertionError(f'a bad pool shot got in: {bad}')
        assert host.ask_guest('BOB', 'cerca')['id'] == 1                             # the host asks a guest; only that guest answers, with a clean name
        for who, helper in (({'name': 'EVE'}, 'AIUTO1'), (g, 'AI UTO')):
            try:
                host.ask_answer(who, 1, True, helper, 'haiku', 20)
            except ValueError:
                continue
            raise AssertionError('a wrong answer to an ask got in')
        host.ask_answer(g, 1, True, 'AIUTO1', 'haiku', 20)
        assert any(p['name'] == 'BOB·AIUTO1' and p['guest'] == 'BOB' for p in host.people())
        host.kick('BOB')
        for _ in range(40):
            time.sleep(0.15)
            if b.error:
                break
        assert b.error and 'closed by the host' in b.error, b.error
        b.stopped.set()
    host.stop()
    print('share ok')


def ensure_cloudflared():
    """called by the plugin's SessionStart hook: fetch the pinned cloudflared once, in the background, never failing
    the session; a lock file keeps two sessions from downloading at the same time"""
    if cloudflared_path():
        return
    BIN.mkdir(parents=True, exist_ok=True)
    lock = BIN / 'cloudflared.lock'
    if lock.exists() and time.time() - lock.stat().st_mtime < 900:
        return
    lock.write_text(str(os.getpid()))
    try:
        install_cloudflared()
    except (ValueError, OSError) as exc:
        (BIN / 'cloudflared.error').write_text(str(exc), encoding='utf-8')
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--ensure-cloudflared']:
        ensure_cloudflared()
    elif sys.argv[1:] == ['--ensure-cloudflared-background']:      # return at once, download in a detached process
        flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0
        if not cloudflared_path():
            subprocess.Popen([sys.executable, __file__, '--ensure-cloudflared'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, creationflags=flags, start_new_session=os.name != 'nt')
    else:
        _prova()
