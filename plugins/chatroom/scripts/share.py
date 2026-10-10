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


GAMES = {'tris': ('new', 'join', 'move', 'quit'), 'morra': ('new', 'join', 'commit', 'reveal', 'quit'), 'dadi': ('roll',)}


def clean_game(g):
    """a game move, checked: the game and its id, the kind of move, and only the fields that move needs"""
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
    def __init__(self, common, title, host, port_hint=0, people=lambda: [], office=lambda: {}):
        """common: the Room of the common room; host: the host's user name; people(): the host's agents in the room;
        office(): the host's plan and everyone's coarse presence, for visits"""
        self.common, self.title, self.host, self.people_fn, self.office_fn = common, title, host, people, office
        self.requests = []                                   # help asked by guests: {id, guest, text, ts, status, ...}
        self.me_pos = None                                   # where the host's own figure is, from the viewer
        self.lock = threading.Lock()
        self.fails = deque()
        self.server = self.proc = None
        self._clear()

    def _clear(self):
        self.pin = self.via = self.url = self.error = None
        self.guests = {}                                    # token -> {name, emoji, color, agents, seen, posts}
        self.requests = []

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
        if via == 'lan':
            self.url = f'http://{lan_ip()}:{port}'
        elif via == 'local':
            self.url = f'http://127.0.0.1:{port}'
        else:
            self.proc = start_tunnel(via, port, self)

    def stop(self):
        if self.proc:
            self.proc.terminate()
            self.proc = None
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
        return n

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
            return {'id': r['id']}

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
            out = [{**{k: g[k] for k in ('name', 'emoji', 'color')}, 'state': 'break', 'guest': g['name'], 'pos': g.get('me')} for g in self.guests.values()]
            for g in self.guests.values():
                out += [{**a, 'name': f"{g['name']}·{a['name']}", 'guest': g['name']} for a in g['agents']]
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
            if path not in ('/share/feed', '/share/office') and not re.fullmatch(r'/share/doc/\d{1,6}', path):
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
            if path == '/share/office':                   # a visit: the host's plan and everyone's coarse presence
                return self.send(200, {**share.office_fn(), 'host': share.host, 'title': share.title, 'present': share.people()})
            since = int((re.search(r'(?:^|&)since=(\d+)', query) or [0, 0])[1])
            msgs = [{k: m[k] for k in ('n', 'time', 'from', 'text', 'doc', 'game') if k in m} for m in share.common.messages() if m['n'] > since][:200]
            mine = [{k: r[k] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes') if k in r} for r in share.requests if r['guest'] == g['name']]
            self.send(200, {'title': share.title, 'host': share.host, 'messages': msgs, 'people': share.people(), 'requests': mine})

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
                                       'people': [p for p in (o.get('people') or [])[:40] if isinstance(p, dict)], 'title': str(o.get('title') or '')[:120]}
                    return self.send(200, {})
                if path == '/share/doc':              # a guest shares a document
                    try:
                        data = base64.b64decode(str(body.get('data', '')), validate=True)
                    except (ValueError, TypeError):
                        raise ValueError('the document must be base64')
                    return self.send(200, {'n': share.doc(g, body.get('from'), body.get('name'), data, body.get('cid'))})
                if path == '/share/request':          # a guest asks the host to lend an agent
                    return self.send(200, share.ask(g, body.get('text', '')))
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


def start_tunnel(via, port, share):
    """start the tunnel process; its public address is read from its output into share.url"""
    if via == 'cloudflared':
        exe = cloudflared_path()
        if not exe:
            raise ValueError('cloudflared is not installed')
        cmd, pattern = [exe, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{port}'], r'https://[a-z0-9-]+\.trycloudflare\.com'
    else:
        ssh = shutil.which('ssh')
        if not ssh:
            raise ValueError('ssh is not available on this computer')
        cmd = [ssh, '-T', '-p', '443', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30',
               '-o', 'ExitOnForwardFailure=yes', f'-R0:127.0.0.1:{port}', 'free.pinggy.io']
        pattern = r'https://[a-z0-9.-]+\.pinggy\.(?:link|online)'
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            text=True, encoding='utf-8', errors='replace', creationflags=flags)

    def read():
        for line in proc.stdout:
            m = re.search(pattern, line)
            if m and not share.url:
                share.url, share.error = m.group(0), None
        if share.proc is proc:
            share.error, share.url = 'the tunnel closed', None
    threading.Thread(target=read, daemon=True).start()
    return proc


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
            'pose': d.get('pose') if d.get('pose') in ('walk', 'stand', 'sit', 'sofa') else 'stand', 'where': where}


def clean_name(name):
    return re.sub(r'[\x00-\x1f<>&"]', '', str(name or '?'))[:60] or '?'


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
        self.token = self.title = self.host = self.error = None
        self.n, self.people, self.requests, self.stopped = 0, [], [], threading.Event()
        self.dir.mkdir(parents=True, exist_ok=True)

    def start(self):
        if not re.match(r'^https?://[\w.-]+(:\d+)?/?$', self.url):
            raise ValueError('the address looks like https://something.trycloudflare.com')
        r = call(self.url, '/share/join', body={**self.me, 'pin': self.pin})
        self.token, self.title, self.host = str(r['token'])[:100], str(r.get('title') or '')[:120], clean_name(r.get('host'))
        (self.dir / 'chat.jsonl').write_text('', encoding='utf-8')       # the mirror starts fresh
        (self.dir / 'link.json').write_text(json.dumps({'role': 'guest', 'url': self.url, 'host': self.host}), encoding='utf-8')
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
                self.people = [clean_person(p) for p in (feed.get('people') or [])[:60] if isinstance(p, dict)]
                self.requests = [{k: str(r.get(k, ''))[:300] for k in ('id', 'text', 'status', 'helper', 'model', 'minutes')}
                                 for r in (feed.get('requests') or [])[:20] if isinstance(r, dict)]
                self.error = None
            except PermissionError as exc:
                self.error = f'closed by the host: {exc}'
                break
            except (ValueError, OSError) as exc:
                self.error = str(exc)
            self.stopped.wait(0.8)                             # often enough for the figures to walk smoothly
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

    def ask(self, text):
        return call(self.url, '/share/request', self.token, {'text': text})

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
                'title': self.title, 'error': self.error, 'requests': self.requests}


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
