"""A group chat on a shared file, for Claude Code agents that run at the same time.

Every message is one JSON line in <room>/chat.jsonl and everyone sees every message: there are no turns, each
participant reads and writes whenever it wants. Two rules are built in, because agents left alone go quiet for long
stretches while they verify things:

- the TIMER: a participant silent for more than `heartbeat` seconds gets a warning on every read, and `wait` returns
  at once, until it posts at least a status (--status): what it is doing, or its conclusions in a few words;
- the ALERT: after a real message, `post` prints the SendMessage ping the author must send to the others. A message
  sent with SendMessage reaches an agent at its next tool call, even in the middle of a long verification, so the
  others read the chat right away instead of at their next `wait`.

Commands (the room is --room DIR or the CHATROOM_DIR environment variable):

  chat.py init --room DIR --topic "..." --participants A,B,C [look options, see below]
  chat.py config --room DIR key=value ... [--profile ...]   (change the look or the settings of an existing room)
  chat.py roster --room DIR A=<agentId> B=<agentId> ...     (the lead writes it right after spawning the agents)
  chat.py post --as NAME [--status]                         (text on stdin: use a quoted heredoc <<'EOF' ... EOF)
  chat.py read --as NAME                                    (new messages since your last read)
  chat.py read --all                                        (the whole chat)
  chat.py wait --as NAME [--timeout 100]                    (blocks until someone else writes or your timer expires)
  chat.py status                                            (messages and seconds of silence per participant)
  chat.py transcript [--out FILE]                           (the whole chat as Markdown)
  chat.py serve [--port 8765]                               (the live viewer, with a box to write as the user)

Look options (init) and config keys: --title, --subtitle, --icon (an emoji), --accent (#rrggbb), --theme
(auto|light|dark), --wallpaper (dots|plain|grid), --lang (en|it), --heartbeat, --user-name, and --profile
"NAME|emoji|#color|role" once per participant. The viewer's settings panel changes the same fields.
"""
import argparse
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding='utf-8')

PALETTE = ['#1fa855', '#027eb5', '#d9730d', '#8e44ad', '#c0392b', '#16a085', '#b7950b', '#6c5ce7', '#e84393', '#0984e3']
LOOK_KEYS = {'title': str, 'subtitle': str, 'icon': str, 'accent': str, 'theme': str, 'wallpaper': str, 'lang': str,
             'heartbeat': int, 'user_name': str, 'topic': str}
CHOICES = {'theme': ('auto', 'light', 'dark'), 'wallpaper': ('dots', 'plain', 'grid'), 'lang': ('en', 'it')}
COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')


def clean_look(key, value):
    """one validated setting, or ValueError: the viewer can write these, so nothing unchecked reaches config.json"""
    if key not in LOOK_KEYS:
        raise ValueError(f'unknown setting {key!r}')
    value = LOOK_KEYS[key](value)
    if isinstance(value, str):
        value = value.strip()[:200 if key in ('title', 'subtitle', 'topic') else 40]
    if key in CHOICES and value not in CHOICES[key]:
        raise ValueError(f'{key} must be one of {CHOICES[key]}')
    if key == 'accent' and not COLOR.match(value):
        raise ValueError('accent must be #rrggbb')
    if key == 'heartbeat' and not 30 <= value <= 3600:
        raise ValueError('heartbeat must be between 30 and 3600 seconds')
    return value


def clean_profile(profile):
    out = {}
    if 'emoji' in profile:
        out['emoji'] = str(profile['emoji']).strip()[:8]
    if 'color' in profile:
        if not COLOR.match(str(profile['color'])):
            raise ValueError('a profile color must be #rrggbb')
        out['color'] = str(profile['color'])
    if 'role' in profile:
        out['role'] = str(profile['role']).strip()[:120]
    return out


def parse_profile(text):
    """'NAME|emoji|#color|role' (trailing fields optional) to (name, profile)"""
    parts = [p.strip() for p in text.split('|')]
    name, profile = parts[0], {}
    for key, value in zip(('emoji', 'color', 'role'), parts[1:]):
        if value:
            profile[key] = value
    return name, clean_profile(profile)


class Room:
    def __init__(self, path):
        self.dir = Path(path)
        self.chat = self.dir / 'chat.jsonl'
        self.lock = self.dir / 'chat.lock'
        self.config_path = self.dir / 'config.json'

    # ------------------------------------------------------------------ files
    def config(self):
        return json.loads(self.config_path.read_text(encoding='utf-8')) if self.config_path.exists() else {}

    def save_config(self, config):
        tmp = self.config_path.with_suffix('.tmp')
        tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding='utf-8')
        os.replace(tmp, self.config_path)

    def update_config(self, settings=None, profiles=None):
        config = self.config()
        for key, value in (settings or {}).items():
            config[key] = clean_look(key, value)
        for name, profile in (profiles or {}).items():
            config.setdefault('profiles', {}).setdefault(name, {}).update(clean_profile(profile))
        self.save_config(config)
        return config

    def roster(self):
        p = self.dir / 'roster.json'
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}

    def user_names(self):
        c = self.config()
        return {c.get('user_name', 'USER'), *c.get('self_names', [])}

    def heartbeat(self):
        return int(self.config().get('heartbeat', 120))

    def messages(self):
        if not self.chat.exists():
            return []
        out = []
        for line in self.chat.read_text(encoding='utf-8').splitlines():
            if line.strip():
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass                  # a line being written right now
        return out

    def cursor(self, name):
        p = self.dir / f'cursor_{name}.txt'
        return int(p.read_text()) if p.exists() else 0

    def set_cursor(self, name, n):
        (self.dir / f'cursor_{name}.txt').write_text(str(n))

    # ------------------------------------------------------------------ writing
    def locked(self, fn):
        for _ in range(400):
            try:
                os.mkdir(self.lock)
                break
            except FileExistsError:
                time.sleep(0.05)
        else:                             # a lock left behind by a killed process
            os.rmdir(self.lock)
            os.mkdir(self.lock)
        try:
            return fn()
        finally:
            os.rmdir(self.lock)

    def append(self, name, text, status=False):
        def write():
            n = len(self.messages()) + 1
            entry = {'n': n, 'time': time.strftime('%H:%M:%S'), 'ts': time.time(), 'from': name, 'text': text}
            if status:
                entry['kind'] = 'status'
            with self.chat.open('a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
            return n
        return self.locked(write)

    # ------------------------------------------------------------------ reading
    def silence(self, name, items=None):
        own = [m['ts'] for m in (items if items is not None else self.messages()) if m['from'] == name and 'ts' in m]
        return time.time() - own[-1] if own else None

    def show(self, items):
        users = self.user_names()
        for m in items:
            tag = ' [STATUS]' if m.get('kind') in ('status', 'stato') else ''
            if m['from'] in users:
                print('!!! MESSAGE FROM THE USER: answer it before anything else !!!')
            print(f"--- #{m['n']} {m['time']} {m['from']}{tag}:\n{m['text']}\n", flush=True)

    def timer_warning(self, name):
        limit, age = self.heartbeat(), self.silence(name)
        if age is None or age > limit:
            since = 'you have not written yet' if age is None else f'your last message was {int(age)} s ago'
            print(f"*** TIMER @{name}: {since} (limit {limit} s). Post a STATUS now with --status: what you are doing, "
                  f"or your conclusions in a few arrows and technical terms. ***\n", flush=True)

    def read(self, name):
        self.timer_warning(name)
        items = [m for m in self.messages() if m['n'] > self.cursor(name)]
        if items:
            self.set_cursor(name, items[-1]['n'])
            self.show(items)
        else:
            print('(no new messages)')

    def wait(self, name, timeout):
        start, limit = time.time(), self.heartbeat()
        while time.time() - start < timeout:
            items = self.messages()
            if any(m['from'] != name and m['n'] > self.cursor(name) for m in items):
                return self.read(name)
            age = self.silence(name, items)
            if age is None or age > limit:
                return self.read(name)        # the timer interrupts the wait
            time.sleep(2)
        print(f'(no new messages in {timeout} s)')


# ---------------------------------------------------------------------- commands
def cmd_init(room, a):
    room.dir.mkdir(parents=True, exist_ok=True)
    participants = [p.strip() for p in (a.participants or '').split(',') if p.strip()]
    config = {'topic': a.topic or 'Chat room', 'title': a.topic or 'Chat room', 'subtitle': '', 'icon': '💬',
              'accent': '#00a884', 'theme': 'auto', 'wallpaper': 'dots', 'lang': 'en', 'heartbeat': 120,
              'user_name': 'USER', 'self_names': ['LEAD', 'COORDINATOR', 'COORDINATORE'],
              'participants': participants, 'created': time.strftime('%Y-%m-%d %H:%M:%S'),
              'profiles': {name: {'emoji': name[:1], 'color': PALETTE[i % len(PALETTE)], 'role': ''}
                           for i, name in enumerate(participants)}}
    for key in LOOK_KEYS:
        value = getattr(a, key, None)
        if value is not None:
            config[key] = clean_look(key, value)
    for text in a.profile or []:
        name, profile = parse_profile(text)
        config['profiles'].setdefault(name, {}).update(profile)
    room.save_config(config)
    print(f'room ready: {room.dir}')


def cmd_config(room, a):
    settings = {}
    for pair in a.pairs:
        key, _, value = pair.partition('=')
        settings[key.strip()] = value
    for key in LOOK_KEYS:
        value = getattr(a, key, None)
        if value is not None:
            settings[key] = value
    profiles = dict(parse_profile(text) for text in a.profile or [])
    print(json.dumps(room.update_config(settings, profiles), indent=2, ensure_ascii=False))


def cmd_roster(room, a):
    roster = room.roster()
    for pair in a.pairs:
        name, _, agent = pair.partition('=')
        if not agent:
            sys.exit(f'expected NAME=agentId, got {pair!r}')
        roster[name.strip()] = agent.strip()
    (room.dir / 'roster.json').write_text(json.dumps(roster, indent=2), encoding='utf-8')
    print(json.dumps(roster))


def cmd_post(room, a):
    text = sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
    if not text:
        sys.exit('empty message')
    n = room.append(a.name, text, a.status)
    print(f'posted #{n}')
    if a.status:
        return
    others = {k: v for k, v in room.roster().items() if k != a.name}
    first = ' '.join(text.split())[:140]
    if others:
        targets = '; '.join(f'{k} = {v}' for k, v in others.items())
        print(f"ALERT: now send with SendMessage, to each of ({targets}), the text: "
              f"CHAT #{n} from {a.name}: {first} ... -> read the chat and answer if it concerns you")
    else:
        print('ALERT: the roster is not written yet; the others will see your message at their next read.')


def cmd_status(room, a):
    items = room.messages()
    counts = {}
    for m in items:
        counts[m['from']] = counts.get(m['from'], 0) + 1
    silent = {k: (int(room.silence(k, items)) if room.silence(k, items) is not None else None) for k in counts}
    print(json.dumps({'total': len(items), 'per_participant': counts, 'seconds_silent': silent}, ensure_ascii=False))


def cmd_transcript(room, a):
    c = room.config()
    lines = [f"# {c.get('title') or c.get('topic', 'Chat room')}", '']
    if c.get('subtitle'):
        lines += [c['subtitle'], '']
    for m in room.messages():
        kind = ' (status)' if m.get('kind') in ('status', 'stato') else ''
        lines += [f"**#{m['n']} · {m['time']} · {m['from']}{kind}**", '', m['text'], '']
    text = '\n'.join(lines)
    if a.out:
        Path(a.out).write_text(text, encoding='utf-8')
        print(f'written {a.out}')
    else:
        print(text)


def cmd_serve(room, a):
    viewer = HERE / 'viewer.html'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, body, ctype):
            data = body if isinstance(body, bytes) else body.encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def body(self):
            return json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8'))

        def do_GET(self):
            path = self.path.split('?')[0]
            if path in ('/', '/index.html'):
                return self.send(200, viewer.read_bytes(), 'text/html; charset=utf-8')
            if path == '/chat.jsonl':
                body = room.chat.read_bytes() if room.chat.exists() else b''
                return self.send(200, body, 'application/x-ndjson; charset=utf-8')
            if path == '/config.json':
                return self.send(200, json.dumps(room.config(), ensure_ascii=False), 'application/json; charset=utf-8')
            self.send(404, 'not found', 'text/plain')

        def do_POST(self):
            path = self.path.split('?')[0]
            try:
                body = self.body()
            except (ValueError, json.JSONDecodeError):
                return self.send(400, 'bad request', 'text/plain')
            if path == '/post':
                text = str(body.get('text', '')).strip()
                if not text:
                    return self.send(400, 'empty message', 'text/plain')
                n = room.append(room.config().get('user_name', 'USER'), text[:4000])
                return self.send(200, json.dumps({'n': n}), 'application/json')
            if path == '/config':
                settings = {k: v for k, v in body.items() if k in LOOK_KEYS and k not in ('user_name', 'topic')}
                profiles = body.get('profiles') if isinstance(body.get('profiles'), dict) else {}
                try:
                    config = room.update_config(settings, {k: v for k, v in profiles.items() if isinstance(v, dict)})
                except (ValueError, TypeError) as exc:
                    return self.send(400, str(exc), 'text/plain')
                return self.send(200, json.dumps(config, ensure_ascii=False), 'application/json; charset=utf-8')
            self.send(404, 'not found', 'text/plain')

    server = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f'viewer on http://{a.host}:{a.port}/  (room {room.dir})', flush=True)
    server.serve_forever()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('command', choices=['init', 'config', 'roster', 'post', 'read', 'wait', 'status', 'transcript', 'serve'])
    p.add_argument('pairs', nargs='*', help='roster: NAME=agentId pairs; config: key=value pairs')
    p.add_argument('--room', default=os.environ.get('CHATROOM_DIR'))
    p.add_argument('--as', dest='name')
    p.add_argument('--all', action='store_true')
    p.add_argument('--status', action='store_true', help='a short status: no alert is printed')
    p.add_argument('--timeout', type=int, default=100)
    p.add_argument('--topic')
    p.add_argument('--participants')
    p.add_argument('--title')
    p.add_argument('--subtitle')
    p.add_argument('--icon')
    p.add_argument('--accent')
    p.add_argument('--theme')
    p.add_argument('--wallpaper')
    p.add_argument('--lang')
    p.add_argument('--heartbeat', type=int)
    p.add_argument('--user-name')
    p.add_argument('--profile', action='append', help='"NAME|emoji|#color|role", once per participant')
    p.add_argument('--out')
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--host', default='127.0.0.1')
    a = p.parse_intermixed_args()        # roster and config pairs may come after the options
    if not a.room:
        sys.exit('no room: pass --room DIR or set CHATROOM_DIR')
    room = Room(a.room)
    try:
        if a.command == 'init':
            return cmd_init(room, a)
        if not room.dir.exists():
            sys.exit(f'room {room.dir} does not exist: run init first')
        commands = {'config': cmd_config, 'roster': cmd_roster, 'status': cmd_status, 'transcript': cmd_transcript,
                    'serve': cmd_serve}
        if a.command in commands:
            return commands[a.command](room, a)
    except ValueError as exc:
        sys.exit(f'error: {exc}')
    if a.command == 'read' and a.all:
        return room.show(room.messages())
    if not a.name:
        sys.exit('--as NAME required')
    if a.command == 'post':
        return cmd_post(room, a)
    if a.command == 'read':
        return room.read(a.name)
    return room.wait(a.name, min(a.timeout, 110))


if __name__ == '__main__':
    main()
