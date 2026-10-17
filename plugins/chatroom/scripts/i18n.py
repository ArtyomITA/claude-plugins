"""Translations of the chat room.

One catalog per language in ../locales/<lang>.json: flat keys by audience (kernel.*, chat.*, viewer.*, office.*,
cli.*), values with named fields ("{file} changed"), and plurals as {"one": ..., "other": ...} chosen by the field n.
English is complete and is the fallback: a key missing (or empty) in another language comes out in English. A key
missing in English is a bug that tools/i18n_check.py reports; at run time it shows the key and warns once, it never
stops a command. A field not given stays as written ({file}), as in i18n.js. The room's language (config "lang") is
the language of everyone in it, agents included. Protocol words are never translated: the code and the agents
recognise them by their form; each group lists the forms the code accepts."""
import json
import re
import sys
import threading
import time
from pathlib import Path

LOCALES = Path(__file__).resolve().parent.parent / 'locales'
LANGS = ('en', 'it')
FALLBACK = 'en'
PROTOCOL = (('PLAN', 'PIANO'), ('VOTE', 'VOTO'), ('CLOSED', 'CHIUSO'), ('ALERT',), ('WATCH',), ('CHECK',), ('LEND',),
            ('RELAY',), ('error:',), ('KEEP',), ('DISCARD',), ('CRASH',), ('SMOKE',), ('DEGRADED',), ('INTERRUPTED',),
            ('protocol:',), ('answer_ready',), ('search_more',), ('TIMER',), ('WAKE-UP',), ('CHECKPOINT',), ('IDLE',))
FIELD = re.compile(r'\{(\w+)\}')
_cache, _warned = {}, set()
_current = {'lang': FALLBACK}
_local = threading.local()


def use(lang, here=False):
    """the language of what this process says from now on (main sets it from the room); here: only this thread (each
    MCP call names its own room)"""
    if here:
        _local.lang = lang_of({'lang': lang})
    else:
        _current['lang'] = lang_of({'lang': lang})


def current():
    return getattr(_local, 'lang', None) or _current['lang']


def say(key, /, **fields):
    """tr() in the current language"""
    return tr(current(), key, **fields)


def catalog(lang):
    """the catalog of one language; its file is looked at again at most once a second, and a file that cannot be read
    (half written, not JSON) keeps the last good catalog"""
    now = time.monotonic()
    entry = _cache.get(lang)
    if entry and now - entry[2] < 1:
        return entry[1]
    path = LOCALES / f'{lang}.json'
    try:
        stamp = path.stat().st_mtime_ns
        if not entry or entry[0] != stamp:
            entry = (stamp, json.loads(path.read_text(encoding='utf-8-sig')), now)
    except (OSError, ValueError) as exc:
        if lang not in _warned:
            _warned.add(lang)
            print(f'chatroom i18n: locales/{lang}.json not read ({exc}): the last good copy, or English, is used', file=sys.stderr)
        entry = (entry[0], entry[1], now) if entry else (None, {}, now)
    _cache[lang] = (entry[0], entry[1], now)
    return entry[1]


def lang_of(config):
    """the language of a room from its config: one of LANGS, else the fallback"""
    lang = str((config or {}).get('lang') or FALLBACK).lower()[:2]
    return lang if lang in LANGS else FALLBACK


def fill(text, fields):
    """{name} replaced by its field; a field not given stays as written"""
    return FIELD.sub(lambda m: str(fields[m.group(1)]) if m.group(1) in fields else m.group(0), text)


def tr(lang, key, /, **fields):
    """the text of key in lang (or in English), its fields filled; a plural picks "one" when n == 1"""
    for code in ((lang, FALLBACK) if lang in LANGS else (FALLBACK,)):
        value = catalog(code).get(key)
        if value not in (None, '', {}):
            break
    else:
        if key not in _warned:
            _warned.add(key)
            print(f'chatroom i18n: no text {key!r} in locales/{FALLBACK}.json', file=sys.stderr)
        return key
    if isinstance(value, dict):
        value = value.get('one') if str(fields.get('n')) == '1' else value.get('other')   # as i18n.js: 1 or '1'
    return fill(value or key, fields)
