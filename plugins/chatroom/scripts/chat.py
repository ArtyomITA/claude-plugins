"""A group chat on a shared file, for agents that run at the same time (Claude Code or Codex).

Every message is one JSON line in <room>/chat.jsonl and everyone sees every message: there are no turns, each
participant reads and writes whenever it wants. Three rules are built in, because agents left alone go quiet for long
stretches while they verify things, or keep writing "still waiting" when they have nothing to do:

- the TIMER: a participant silent for more than `heartbeat` seconds gets a warning on every read, and `wait` returns
  at once, until it posts at least a status (--status): the percentage of its part that is done (for example "60%"
  or "written 70% / verified 50%") and what it is doing, or its conclusions in a few words. A status without a
  percentage is refused;
- the IDLE state: a participant with nothing to do until someone else acts posts ONE idle status (--idle: what it
  waits for and from whom, with its percentage) and then loops on `wait`. While it is idle the timer does not apply
  to it, a second --idle is refused, and `wait` returns only for a message that tags it (@NAME, any case), a tag to
  everyone (@all, @tutti, @everyone) or a message from the user (or the lead); the other messages stay unread until
  then. The idle state ends as soon as it posts anything else;
- the ALERT: after a real message, `post` prints the ping the author must send to the others with its messaging tool
  (SendMessage in Claude Code, send_message in Codex, chosen from the roster: Codex agents are paths like /root/name).
  A ping reaches an agent at its next tool call, even in the middle of a long verification, so the others read the
  chat right away instead of at their next `wait`. Idle participants are left out of the ping unless
  the message tags them (or everyone), or comes from the user (or the lead).

Commands (the room is --room DIR or the CHATROOM_DIR environment variable):

  chat.py init --room DIR --topic "..." --participants A,B,C [look options, see below]
  chat.py config --room DIR key=value ... [--profile ...]   (change the look or the settings of an existing room)
  chat.py roster --room DIR A=<agent> B=<agent> ...         (the lead writes it right after spawning the agents:
                                                            Claude Code agent IDs, or Codex paths like /root/a)
  chat.py post --as NAME [--status|--idle] [--image PATH ...]
                                                            (text on stdin: use a quoted heredoc <<'EOF' ... EOF;
                                                            --image attaches a picture, once per picture)
  chat.py read --as NAME                                    (new messages since your last read)
  chat.py read --all                                        (the whole chat)
  chat.py wait --as NAME [--timeout 100]                    (blocks until someone else writes or your timer expires,
                                                            at most 110 s; when you are idle it blocks until someone
                                                            tags you, at most 540 s)
  chat.py status                                            (messages, seconds of silence and idle state per
                                                            participant)
  chat.py transcript [--out FILE]                           (the whole chat as Markdown)
  chat.py command [NAME] [--as AUTHOR]                      (a quick command, see COMMANDS; no NAME lists them)
  chat.py alerts [--follow]                                 (the lead's relay: a ping line per user message)
  chat.py serve [--port 8765]                               (the live viewer, with a box to write as the user)

Look options (init) and config keys: --title, --subtitle, --icon (an emoji), --accent (#rrggbb), --theme
(auto|light|dark), --wallpaper (dots|plain|grid), --lang (en|it), --heartbeat, --user-name, and --profile
"NAME|emoji|#color|role" once per participant. The viewer's settings panel changes the same fields.
"""
import argparse
import base64
import json
import os
import re
import shutil
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
IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
               '.gif': 'image/gif'}
IMAGE_MAX_BYTES = 20 * 1024 * 1024
IMAGE_NAME = re.compile(r'^[A-Za-z0-9_.-]+$')
STATUS_KINDS = ('status', 'stato')        # 'stato' is how the first versions wrote a status
IDLE = 'idle'
PERCENT = re.compile(r'\d[^\S\n]?%')
# a plan, a vote or a closing concerns everyone: it wakes idle participants like a tag to all
BROADCAST = re.compile(r'^\s*(PLAN|PIANO)\s*v\d+|^\s*(CLOSED|CHIUSO)\b|\b(VOTE|VOTO)\s*v?\d+\s*:', re.IGNORECASE)
EVERYONE = ('all', 'tutti', 'everyone')   # @all, @tutti, @everyone tag every participant
WAIT_MAX, IDLE_WAIT_MAX = 110, 540

# Quick commands: the user sends them from the viewer (type / in the box) or the lead with `chat.py command NAME`.
# One prompt each, written from Anthropic's prompting guidance (proactive action, independent steps together,
# time as a signal, updates that lead with the outcome) and kept general: they state the logic, not a model quirk.
COMMANDS = {
    'accelera': {
        'en': ('speedup', '⚡', 'Speed up and anticipate steps, same quality',
               '@all SPEED UP. Time matters: do not spend time that can be avoided, and the earlier a correct result '
               'arrives, the better. Make routine decisions yourself and keep going; stop only when different '
               'readings would lead to really different work. While something runs, prepare the next step. When two '
               'actions do not depend on each other, do them together in the same turn. Quality does not drop: the '
               'planned checks stay, but do not re-check what is already verified. Do not spawn subagents: you do '
               'the work yourself.'),
        'it': ('accelera', '⚡', 'Accelerare e anticipare i passi, stessa qualità',
               "@tutti ACCELERA. Il tempo conta: non spendete tempo evitabile, e prima arriva un risultato corretto "
               "meglio è. Le scelte di routine decidetele voi e andate avanti; fermatevi solo quando letture diverse "
               "porterebbero a lavori davvero diversi. Mentre qualcosa gira, preparate il passo dopo. Quando due "
               "azioni non dipendono l'una dall'altra, fatele insieme nello stesso turno. La qualità non cala: le "
               "prove previste restano, ma non ricontrollate ciò che è già verificato. Non evocate subagenti: il "
               "lavoro lo fate voi.")},
    'resoconto': {
        'en': ('report', '📋', 'A short report from everyone',
               '@all REPORT for the user. Each of you writes ONE short message (not a status): first line the outcome '
               '(what you did, what you found); then the percentage of your part, written and verified; what is '
               'missing; what blocks you or what you need from someone; your next action. Numbers and evidence '
               '(files, #messages, pictures) instead of adjectives. Then go straight back to work.'),
        'it': ('resoconto', '📋', 'Un resoconto breve da ognuno',
               "@tutti RESOCONTO per il committente. Ognuno scriva UN solo messaggio breve (non uno status): prima "
               "riga l'esito (cosa hai fatto, cosa hai trovato); poi la percentuale della tua parte, scritto e "
               "verificato; cosa manca; cosa ti blocca o cosa ti serve da qualcuno; la prossima azione. Numeri e prove "
               "(file, #messaggi, foto) al posto degli aggettivi. Poi tornate subito al lavoro.")},
    'menoparole': {
        'en': ('lesstalk', '🤫', 'A little less talk, a little more work',
               '@all A little less talk and a little more work (not drastically). Write when you have a result, a '
               'finding that changes something, a change of direction or a question that blocks you. Do not announce '
               'what you are about to do: do it. No repeating what was already said, no thanks or redundant '
               'summaries. Statuses stay, in one or two lines with the percentage. Always answer when someone tags '
               'you.'),
        'it': ('menoparole', '🤫', "Un po' meno parole, un po' più lavoro",
               "@tutti Un po' meno parole e un po' più lavoro (senza esagerare). Scrivete quando avete un risultato, "
               "una scoperta che cambia qualcosa, un cambio di strada o una domanda che vi blocca. Non annunciate "
               "cosa state per fare: fatelo. Niente ripetizioni di cose già dette, niente ringraziamenti o riepiloghi "
               "ridondanti. Gli status restano, in una o due righe con la percentuale. Rispondete sempre quando "
               "qualcuno vi tagga.")},
    'consegna': {
        'en': ('deliver', '🎯', 'Converge on the delivery',
               '@all TOWARD THE DELIVERY. No new ideas and no widening of scope: finish what is open. Whoever has the '
               'fullest picture writes the draft (done, evidence, numbers, open points); the others amend it or vote '
               'within a few messages. What does not fit goes to the open points or to the ideas for the lead.'),
        'it': ('consegna', '🎯', 'Convergere sulla consegna',
               "@tutti VERSO LA CONSEGNA. Niente idee nuove né allargamenti di scopo: finite quello che è aperto. Chi "
               "ha il quadro più completo scriva la bozza (fatto, prova, numeri, aperti); gli altri la emendano o "
               "votano entro pochi messaggi. Quello che non entra va negli aperti o nelle idee per l'orchestratore.")},
    'prove': {
        'en': ('evidence', '🔍', 'Back every claim with evidence',
               '@all EVIDENCE. Every recent claim that still has no evidence gets it now: a picture with --image, a '
               'measurement with numbers and load, or file:line. Whoever has visible work shows it in the chat. What '
               'cannot be proven is written as "not verified", without rounding up.'),
        'it': ('prove', '🔍', 'Ogni affermazione con la sua prova',
               "@tutti PROVE. Ogni affermazione recente ancora senza prova la riceve adesso: una foto con --image, "
               "una misura con numeri e carico, oppure file:riga. Chi ha lavoro visibile lo mostri in chat. Quello "
               "che non si può provare si scrive \"non verificato\", senza arrotondare.")},
    'pausa': {
        'en': ('pause', '⏸', 'Finish the step, save the state, go idle',
               '@all PAUSE. Finish the step in progress without leaving files half done. Then each of you writes '
               'where you got to (percentage, what is missing, how to resume) and goes idle with --idle until '
               'tagged.'),
        'it': ('pausa', '⏸', 'Finire il passo, salvare lo stato, idle',
               "@tutti PAUSA. Finite il passo in corso senza lasciare file a metà. Poi ognuno scriva dove è arrivato "
               "(percentuale, cosa manca, come riprendere) e passi in idle con --idle finché non viene taggato.")},
}


# the "less talk" command also lengthens the status timer a little (x1.5, at most 3600 s)
TIMER_FACTOR = {'menoparole': 1.5}
TIMER_NOTE = {'en': ' The status timer goes from {old} to {new} s.', 'it': ' Il timer degli status passa da {old} a {new} s.'}


def command_list(lang):
    """the quick commands in the room language: [{key, name, icon, label, text}]"""
    lang = lang if lang in ('en', 'it') else 'en'
    return [dict(zip(('name', 'icon', 'label', 'text'), c[lang]), key=key) for key, c in COMMANDS.items()]


def find_command(word, lang):
    word = word.lstrip('/').strip().lower()
    for c in command_list(lang) + command_list('en' if lang == 'it' else 'it'):
        if word in (c['key'], c['name']):
            return c
    return None


def run_command(room, word, author):
    """post a quick command as `author`, applying its effect; (n, text), or ValueError for an unknown command"""
    config = room.config()
    lang = config.get('lang', 'en')
    c = find_command(word, lang)
    if not c:
        raise ValueError(f'unknown command {word!r}: ' + ', '.join('/' + x['name'] for x in command_list(lang)))
    c = next(x for x in command_list(lang) if x['key'] == c['key'])      # always in the room language
    text = c['text']
    factor = TIMER_FACTOR.get(c['key'])
    if factor:
        old = room.heartbeat()
        new = min(3600, int(round(old * factor)))
        room.update_config({'heartbeat': new})
        text += TIMER_NOTE['it' if lang == 'it' else 'en'].format(old=old, new=new)
    return room.append(author, text), text


def ping_tool(roster):
    """Codex addresses agents by path (/root/name), Claude Code by agent ID"""
    return 'send_message' if any(str(v).startswith('/') for v in roster.values()) else 'SendMessage'


def print_alert(room, author, n, text, images=()):
    """the ping the author must send: everyone not idle, plus the idle ones this message wakes"""
    items = room.messages()
    users = room.user_names()
    others = {k: v for k, v in room.roster().items() if k != author}
    first = ' '.join(text.split())[:140] + (f' [+{len(images)} image(s)]' if images else '')
    if not others:
        print('ALERT: the roster is not written yet; the others will see your message at their next read.')
        return
    wakes_all = author in users or tags_everyone(text) or BROADCAST.search(text) is not None
    ping, asleep = {}, {}
    for k, v in others.items():
        idle = room.idle_entry(k, items)
        if idle and not (wakes_all or tags(text, k)):
            asleep[k] = idle
        else:
            ping[k] = v
    if ping:
        targets = '; '.join(f'{k} = {v}' for k, v in ping.items())
        print(f"ALERT: now send with {ping_tool(others)}, to each of ({targets}), the text: "
              f"CHAT #{n} from {author}: {first} ... -> read the chat and answer if it concerns you")
    else:
        print('ALERT: nobody to ping, every other participant is idle and your message does not tag them.')
    if asleep:
        names = ', '.join(f'{k} (idle since #{m["n"]})' for k, m in asleep.items())
        print(f'IDLE, do NOT ping: {names}. They wake up only when tagged: to call one, post a message with @NAME. '
              f'When you deliver what an idle participant is waiting for, tag it.')


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


def tags(text, name):
    """True if the text tags @name as a whole word, in any case"""
    return re.search(r'(?<![\w@])@' + re.escape(name) + r'(?![\w-])', text or '', re.IGNORECASE) is not None


def tags_everyone(text):
    return any(tags(text, word) for word in EVERYONE)


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

    def append(self, name, text, status=False, images=None):
        """status: False for a message, True (or 'status') for a status, 'idle' for an idle status"""
        def write():
            items = self.messages()
            if status == IDLE and self.idle_entry(name, items):
                return None                   # already idle: checked under the lock, so two idles cannot race
            n = len(items) + 1
            entry = {'n': n, 'time': time.strftime('%H:%M:%S'), 'ts': time.time(), 'from': name, 'text': text}
            if status:
                entry['kind'] = IDLE if status == IDLE else 'status'
            if images:
                entry['images'] = list(images)
            with self.chat.open('a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
            return n
        return self.locked(write)

    # ------------------------------------------------------------------ pictures
    @property
    def images_dir(self):
        return self.dir / 'images'

    def _image_name(self, name, index, suffix):
        stem = re.sub(r'[^A-Za-z0-9_-]+', '_', Path(name).stem)[:40] or 'image'
        return f'{int(time.time() * 1000)}_{index}_{stem}{suffix}'

    def store_image_file(self, path, index=0):
        """Copy a picture into the room, so the viewer can show it and the room stays self-contained."""
        src = Path(path).expanduser().resolve()
        suffix = src.suffix.lower()
        if suffix not in IMAGE_TYPES:
            raise ValueError(f'{src.name}: not a picture (allowed: ' + ', '.join(sorted(IMAGE_TYPES)) + ')')
        if not src.is_file():
            raise ValueError(f'{src}: file not found')
        if src.stat().st_size > IMAGE_MAX_BYTES:
            raise ValueError(f'{src.name}: larger than {IMAGE_MAX_BYTES // (1024 * 1024)} MB')
        self.images_dir.mkdir(exist_ok=True)
        name = self._image_name(src.name, index, suffix)
        shutil.copyfile(src, self.images_dir / name)
        return f'images/{name}'

    def store_image_bytes(self, filename, data, index=0):
        suffix = Path(filename or 'image.png').suffix.lower() or '.png'
        if suffix not in IMAGE_TYPES:
            raise ValueError('not a picture')
        if len(data) > IMAGE_MAX_BYTES:
            raise ValueError('picture too large')
        self.images_dir.mkdir(exist_ok=True)
        name = self._image_name(filename or 'image', index, suffix)
        (self.images_dir / name).write_bytes(data)
        return f'images/{name}'

    def image_path(self, rel):
        return (self.dir / rel).resolve()

    # ------------------------------------------------------------------ reading
    def silence(self, name, items=None):
        own = [m['ts'] for m in (items if items is not None else self.messages()) if m['from'] == name and 'ts' in m]
        return time.time() - own[-1] if own else None

    def idle_entry(self, name, items=None):
        """the idle status of `name` if its latest message is one, else None: posting anything else ends the idle"""
        own = [m for m in (items if items is not None else self.messages()) if m.get('from') == name]
        return own[-1] if own and own[-1].get('kind') == IDLE else None

    def wakes(self, m, name, users=None):
        """True if message m wakes the idle participant `name`: a tag to it or to everyone, the user (or the lead)
        writing, or a plan, a vote or a closing, which concern everyone"""
        if m.get('from') == name:
            return False
        users = self.user_names() if users is None else users
        text = m.get('text', '')
        return (m.get('from') in users or tags(text, name) or tags_everyone(text)
                or (m.get('kind') not in (IDLE, *STATUS_KINDS) and BROADCAST.search(text) is not None))

    def show(self, items):
        users = self.user_names()
        for m in items:
            kind = m.get('kind')
            tag = ' [IDLE]' if kind == IDLE else ' [STATUS]' if kind in STATUS_KINDS else ''
            if m['from'] in users:
                print('!!! MESSAGE FROM THE USER: answer it before anything else !!!')
            print(f"--- #{m['n']} {m['time']} {m['from']}{tag}:\n{m['text']}", flush=True)
            if m.get('images'):
                paths = ', '.join(str(self.image_path(r)) for r in m['images'])
                print(f"[{len(m['images'])} IMAGE(S) attached - look at them with the Read tool: {paths}]", flush=True)
            print(flush=True)

    def timer_warning(self, name, items=None):
        items = self.messages() if items is None else items
        if self.idle_entry(name, items):
            return                            # the timer does not apply to an idle participant
        limit, age = self.heartbeat(), self.silence(name, items)
        if age is None or age > limit:
            since = 'you have not written yet' if age is None else f'your last message was {int(age)} s ago'
            print(f"*** TIMER @{name}: {since} (limit {limit} s). Post a STATUS now with --status, with the "
                  f"PERCENTAGE of your part that is done (for example \"60%\" or \"written 70% / verified 50%\"): "
                  f"what you are doing, or your conclusions in a few arrows and technical terms. If you have nothing "
                  f"to do until someone else acts, post ONE --idle instead (what you wait for and from whom, with "
                  f"your percentage) and wait to be tagged. ***\n", flush=True)

    def read(self, name):
        items = self.messages()
        self.timer_warning(name, items)
        items = [m for m in items if m['n'] > self.cursor(name)]
        if items:
            self.set_cursor(name, items[-1]['n'])
            self.show(items)
        else:
            print('(no new messages)')

    def wait(self, name, timeout):
        items = self.messages()
        idle = self.idle_entry(name, items)
        timeout = max(1, min(timeout, IDLE_WAIT_MAX if idle else WAIT_MAX))
        start, limit, users = time.time(), self.heartbeat(), self.user_names()
        while True:
            cursor = self.cursor(name)
            new = [m for m in items if m['n'] > cursor and m['from'] != name]
            idle = self.idle_entry(name, items)
            if idle:
                wake = next((m for m in new if self.wakes(m, name, users)), None)
                if wake:
                    print(f"*** WAKE-UP @{name}: #{wake['n']} from {wake['from']} is for you. You stay idle until you "
                          f"post anything: answer it, or call wait again if it needs nothing from you. If you start working on "
                          f"it, post a --status (with your percentage) first: it ends your idle and restarts the "
                          f"timer. ***\n",
                          flush=True)
                    return self.read(name)
            else:
                if new:
                    return self.read(name)
                age = self.silence(name, items)
                if age is None or age > limit:
                    return self.read(name)    # the timer interrupts the wait
            if time.time() - start >= timeout:
                break
            time.sleep(2)
            items = self.messages()
        if idle:
            unread = len([m for m in items if m['n'] > self.cursor(name) and m['from'] != name])
            print(f'(you are idle since #{idle["n"]}: nobody tagged you in {timeout} s'
                  + (f'; {unread} new message(s) not addressed to you stay unread' if unread else '')
                  + f'. This is not an empty wait (rule 8): call wait again with --timeout {IDLE_WAIT_MAX}.)')
        else:
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
            sys.exit(f'expected NAME=<agent ID or path>, got {pair!r}')
        agent = agent.strip()
        if '/root/' in agent:                 # Git Bash on Windows turns /root/a into C:/.../root/a
            agent = agent[agent.index('/root/'):]
        roster[name.strip()] = agent
    (room.dir / 'roster.json').write_text(json.dumps(roster, indent=2), encoding='utf-8')
    print(json.dumps(roster))


def cmd_post(room, a):
    text = '' if sys.stdin.isatty() else sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
    if a.status and a.idle:
        sys.exit('error: use --status or --idle, not both. Nothing was posted.')
    kind = IDLE if a.idle else 'status' if a.status else None
    if kind and not text:
        sys.exit('error: a status needs a text with the percentage of your part that is done, for example "60%". '
                 'Nothing was posted.')
    if kind and not PERCENT.search(text):
        label = 'an IDLE status' if kind == IDLE else 'a STATUS'
        sys.exit(f'error: {label} must say the PERCENTAGE of your part that is done, as a number followed by % '
                 f'(for example "60%" or "written 70% / verified 50%"). Nothing was posted: write it again with '
                 f'the percentage and post it again.')
    was_idle = room.idle_entry(a.name)
    if kind == IDLE and was_idle:
        sys.exit(f'error: you already said you are idle (#{was_idle["n"]}): do not post another idle, wait to be '
                 f'tagged (wait --as {a.name} --timeout {IDLE_WAIT_MAX}). Nothing was posted. Your idle ends when '
                 f'you post a message or a --status.')
    if kind == IDLE:
        unread = [m['n'] for m in room.messages() if m['n'] > room.cursor(a.name) and m['from'] != a.name]
        if unread:
            sys.exit(f'error: read first: {len(unread)} unread message(s) (#{unread[0]}-#{unread[-1]}) may already '
                     f'hold what you are waiting for. Nothing was posted: read --as {a.name}, then decide.')
    if not text and not a.image:
        sys.exit('empty message')
    try:
        images = [room.store_image_file(p, i) for i, p in enumerate(a.image or [])]
    except ValueError as exc:
        sys.exit(f'error: {exc}')
    n = room.append(a.name, text, kind or False, images)
    if n is None:
        for rel in images:                    # nothing was posted: do not leave the copied pictures behind
            try:
                room.image_path(rel).unlink()
            except OSError:
                pass
        sys.exit(f'error: you already said you are idle: do not post another idle, wait to be tagged '
                 f'(wait --as {a.name} --timeout {IDLE_WAIT_MAX}). Nothing was posted.')
    print(f'posted #{n}' + (f' with {len(images)} image(s)' if images else ''))
    if kind == IDLE:
        print(f'You are now IDLE: the timer no longer applies to you. Loop on wait --as {a.name} --timeout '
              f'{IDLE_WAIT_MAX} (Bash tool timeout 600000 ms): it returns only when someone tags @{a.name} or '
              f'@all/@tutti/@everyone, when the user (or the lead) writes, or on a PLAN, a VOTE or a CLOSED. '
              f'Do not post another idle.')
        return
    if was_idle:
        print('You are no longer idle: the timer applies to you again.')
    if kind:
        return
    print_alert(room, a.name, n, text, images)


def cmd_command(room, a):
    """chat.py command NAME [--as AUTHOR]: post a quick command (default author: the user)"""
    if not a.pairs:
        lang = room.config().get('lang', 'en')
        for c in command_list(lang):
            print(f"/{c['name']:<11} {c['icon']} {c['label']}")
        return
    author = a.name or room.config().get('user_name', 'USER')
    try:
        n, text = run_command(room, a.pairs[0], author)
    except ValueError as exc:
        sys.exit(f'error: {exc}')
    print(f'posted #{n}')
    print_alert(room, author, n, text)


def alert_lines(room, items, users):
    """one line per new message of the user: who to ping now (the tagged ones, or everyone not idle)"""
    roster = room.roster()
    out = []
    for m in items:
        if m.get('from') not in users or m.get('from') in room.config().get('self_names', []):
            continue                          # only the user's messages: the lead pings its own
        text = m.get('text', '')
        named = [k for k in roster if tags(text, k)]
        if named and not tags_everyone(text):
            targets = named
        else:
            targets = [k for k in roster if not room.idle_entry(k, items) or tags_everyone(text)
                       or m.get('from') in users]
        first = ' '.join(text.split())[:140]
        pairs = '; '.join(f'{k} = {roster[k]}' for k in targets)
        out.append(f"ALERT #{m['n']} from {m['from']}"
                   + (f" tags {', '.join(named)}" if named else '') + f": send with {ping_tool(roster)} to ({pairs}) the text: "
                   f"CHAT #{m['n']} from {m['from']}: {first} ... -> read the chat and answer, the user wrote it")
    return out


def cmd_alerts(room, a):
    """the lead's relay: print a ping line for each new message of the user (--follow keeps watching)"""
    name = '_alerts'
    while True:
        items = room.messages()
        new = [m for m in items if m['n'] > room.cursor(name)]
        if new:
            for line in alert_lines(room, [*new], room.user_names()):
                print(line, flush=True)
            room.set_cursor(name, new[-1]['n'])
        if not a.follow:
            return
        time.sleep(1)


def cmd_status(room, a):
    items = room.messages()
    counts = {}
    for m in items:
        counts[m['from']] = counts.get(m['from'], 0) + 1
    silent = {k: (int(room.silence(k, items)) if room.silence(k, items) is not None else None) for k in counts}
    users = room.user_names()
    idle = {}
    for k in dict.fromkeys([*room.config().get('participants', []), *counts]):
        if k in users:
            continue
        m = room.idle_entry(k, items)
        idle[k] = {'since': m.get('time'), 'message': m['n'],
                   'seconds': int(time.time() - m['ts']) if 'ts' in m else None,
                   'waits_for': (m.get('text') or '').split('\n')[0][:160]} if m else False
    print(json.dumps({'total': len(items), 'per_participant': counts, 'seconds_silent': silent, 'idle': idle},
                     ensure_ascii=False))


def cmd_transcript(room, a):
    c = room.config()
    lines = [f"# {c.get('title') or c.get('topic', 'Chat room')}", '']
    if c.get('subtitle'):
        lines += [c['subtitle'], '']
    for m in room.messages():
        kind = ' (idle)' if m.get('kind') == IDLE else ' (status)' if m.get('kind') in STATUS_KINDS else ''
        lines += [f"**#{m['n']} · {m['time']} · {m['from']}{kind}**", '', m['text'], '']
        for i, rel in enumerate(m.get('images') or []):
            lines += [f"![#{m['n']} image {i + 1}]({rel})", '']
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
            if path.startswith('/images/'):
                name = path[len('/images/'):]
                target = room.images_dir / name
                ctype = IMAGE_TYPES.get(Path(name).suffix.lower())
                if not IMAGE_NAME.match(name) or not ctype or not target.is_file():
                    return self.send(404, 'not found', 'text/plain')
                return self.send(200, target.read_bytes(), ctype)
            if path == '/config.json':
                return self.send(200, json.dumps(room.config(), ensure_ascii=False), 'application/json; charset=utf-8')
            if path == '/commands.json':
                body = json.dumps(command_list(room.config().get('lang', 'en')), ensure_ascii=False)
                return self.send(200, body, 'application/json; charset=utf-8')
            self.send(404, 'not found', 'text/plain')

        def do_POST(self):
            path = self.path.split('?')[0]
            try:
                body = self.body()
            except (ValueError, json.JSONDecodeError):
                return self.send(400, 'bad request', 'text/plain')
            if path == '/post':
                text = str(body.get('text', '')).strip()
                images = []
                try:
                    for i, item in enumerate((body.get('images') or [])[:6]):
                        data = str(item.get('data', ''))
                        data = data.split(',', 1)[1] if data.startswith('data:') else data
                        images.append(room.store_image_bytes(str(item.get('name', 'image.png')),
                                                             base64.b64decode(data), i))
                except (ValueError, TypeError, AttributeError) as exc:
                    return self.send(400, f'bad image: {exc}', 'text/plain')
                if not text and not images:
                    return self.send(400, 'empty message', 'text/plain')
                n = room.append(room.config().get('user_name', 'USER'), text[:4000], images=images)
                return self.send(200, json.dumps({'n': n}), 'application/json')
            if path == '/command':
                try:
                    n, _ = run_command(room, str(body.get('name', '')), room.config().get('user_name', 'USER'))
                except ValueError as exc:
                    return self.send(400, str(exc), 'text/plain')
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
    p.add_argument('command', choices=['init', 'config', 'roster', 'post', 'read', 'wait', 'status', 'transcript',
                                        'serve', 'command', 'alerts'])
    p.add_argument('pairs', nargs='*', help='roster: NAME=<agent ID or path> pairs; config: key=value pairs')
    p.add_argument('--room', default=os.environ.get('CHATROOM_DIR'))
    p.add_argument('--as', dest='name')
    p.add_argument('--all', action='store_true')
    p.add_argument('--status', action='store_true',
                   help='a short status with the percentage of your part that is done: no alert is printed')
    p.add_argument('--idle', action='store_true',
                   help='an idle status, once: what you wait for and from whom, with your percentage; afterwards '
                        'only a tag wakes you')
    p.add_argument('--follow', action='store_true', help='alerts: keep watching and print each new ping line')
    p.add_argument('--timeout', type=int, default=100,
                   help=f'wait: at most {WAIT_MAX} s, or {IDLE_WAIT_MAX} s while you are idle')
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
    p.add_argument('--image', action='append', help='post: attach a picture (png, jpg, webp, gif); repeat for more')
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
                    'serve': cmd_serve, 'command': cmd_command, 'alerts': cmd_alerts}
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
    return room.wait(a.name, a.timeout)         # wait caps the timeout: 110 s, or 540 s while idle


if __name__ == '__main__':
    main()
