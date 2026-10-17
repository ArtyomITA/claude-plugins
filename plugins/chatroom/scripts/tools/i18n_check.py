"""Checks the translations of the chat room: python i18n_check.py [--root PLUGIN_DIR] [--strays]

Errors (exit 1):
- a catalog that is not valid JSON, has a key twice, a key not shaped like area.name, or a value that is not a
  non-empty text or {"one": ..., "other": ...};
- a key of another language that English does not have; fields ({name}) that differ from English; a protocol word of
  the English text with none of its forms in the translation;
- in the code: tr(lang, 'key') or I18N.t('key') with a key English lacks, a call whose fields differ from the text's,
  a key that is not a literal (it cannot be checked);
- a language list (i18n.py, i18n.js, chat.py) that differs from the catalogs;
- a translated document (templates/<lang>/, guides/<lang>/) of an unknown language, or whose {{FIELDS}}, command
  flags, chat.py and research commands, numbered steps, record ids or protocol words differ from the English one.
Reported, not errors: keys another language lacks (they fall back to English); with --strays, the natural-language
strings still written in the code, per file (what is left to move into the catalogs)."""
import argparse
import ast
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from i18n import FALLBACK, FIELD, LANGS, PROTOCOL  # noqa: E402

KEY = re.compile(r'(_meta|[a-z][A-Za-z0-9_]*)(\.[A-Za-z0-9_]+)+')     # area.name, name as the code calls it (camelCase)
WORDS = re.compile(r"[A-Za-zÀ-ÿ]{2,}(?:[\s'’][A-Za-zÀ-ÿ]{2,})+")
JS_CALL = re.compile(r"""\bI18N\.(?:t|text)\(\s*(['"`])([^'"`]*)\1\s*(?:,\s*\{([^}]*)\})?""")


def texts(value):
    return [value] if isinstance(value, str) else [value.get('one', ''), value.get('other', '')] if isinstance(value, dict) else []


def fields_of(value):
    return {x for t in texts(value) for x in FIELD.findall(t)}


def word(w):
    return re.compile(r'(?<![\w-])' + re.escape(w) + (r'(?![\w-])' if w[-1].isalnum() else ''))


PROTO = [[word(w) for w in group] for group in PROTOCOL]


def protocol_in(text):
    return sorted('/'.join(g) for g, pats in zip(PROTOCOL, PROTO) if any(p.search(text) for p in pats))


def load(path, errors):
    def pairs(items):
        seen = {}
        for k, v in items:
            if k in seen:
                errors.append(f'{path.name}: {k} is there twice')
            seen[k] = v
        return seen
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs)
    except ValueError as exc:
        errors.append(f'{path.name}: not valid JSON ({exc})')
        return None


def check_catalogs(root, errors, notes):
    cats = {}
    for f in sorted((root / 'locales').glob('*.json')):
        cat = load(f, errors)
        if cat is None:
            continue
        cats[f.stem] = cat
        for k, v in cat.items():
            if not KEY.fullmatch(k):
                errors.append(f'{f.name}: {k} is not shaped like area.name (lowercase, dots)')
            if not ((isinstance(v, str) and v) or (isinstance(v, dict) and set(v) == {'one', 'other'}
                                                    and all(isinstance(x, str) and x for x in v.values()))):
                errors.append(f'{f.name}: {k} is neither a non-empty text nor {{"one": ..., "other": ...}}')
    en = cats.get(FALLBACK, {})
    for lang, cat in cats.items():
        if lang == FALLBACK:
            continue
        for k in sorted(set(cat) - set(en)):
            errors.append(f'{lang}.json: {k} does not exist in {FALLBACK}.json')
        missing = sorted(set(en) - set(cat))
        if missing:
            notes.append(f'{lang}.json: {len(missing)} keys fall back to English (first: {", ".join(missing[:5])})')
        for k in sorted(set(cat) & set(en)):
            if fields_of(en[k]) != fields_of(cat[k]):
                errors.append(f'{lang}.json: {k} has fields {sorted(fields_of(cat[k]))}, English {sorted(fields_of(en[k]))}')
            a, b = protocol_in(' '.join(texts(en[k]))), protocol_in(' '.join(texts(cat[k])))
            for w in sorted(set(a) - set(b)):
                errors.append(f'{lang}.json: {k} drops the protocol word {w}')
    if set(cats) != set(LANGS):
        errors.append(f'catalogs {sorted(cats)} but i18n.LANGS {list(LANGS)}')
    return en


def check_code(root, en, errors):
    for f in sorted((root / 'scripts').glob('*.py')):
        for n in ast.walk(ast.parse(f.read_text(encoding='utf-8'))):
            if not (isinstance(n, ast.Call) and getattr(n.func, 'id', getattr(n.func, 'attr', None)) == 'tr' and len(n.args) >= 1):
                continue
            where = f'{f.name}:{n.lineno}'
            if len(n.args) < 2 or not (isinstance(n.args[1], ast.Constant) and isinstance(n.args[1].value, str)):
                errors.append(f'{where}: tr() with a key that is not a literal (it cannot be checked)')
                continue
            key = n.args[1].value
            if key not in en:
                errors.append(f'{where}: uses {key}, missing from {FALLBACK}.json')
            elif not any(k.arg is None for k in n.keywords):             # tr(..., **fields): not checkable here
                given = {k.arg for k in n.keywords}
                if given != fields_of(en[key]):
                    errors.append(f'{where}: {key} given fields {sorted(given)}, the text has {sorted(fields_of(en[key]))}')
    for f in sorted((root / 'scripts').glob('*.js')) + sorted((root / 'scripts').glob('*.html')):
        if f.name == 'i18n.js':                                       # the library itself
            continue
        src = re.sub(r'(?ms)/\*.*?\*/|^\s*//.*?$', '', f.read_text(encoding='utf-8'))
        table = re.search(r"I18N\.tables?\('(\w+)'(?:,\s*(\{[^}]*\}|\w+))?(?:,\s*(\w+))?", src)
        if table:                                                     # old-style objects: L.key, t().key, T().key
            prefix, extra_name = table.group(1), table.group(3)
            extra = set()
            if extra_name:
                block = re.search(re.escape(extra_name) + r'\s*=\s*tx\s*=>\s*\(\{(.*?)\}\);', src, re.S)
                extra = set(re.findall(r'(\w+):\s*\(?[\w, ]*\)?\s*=>', block.group(1))) if block else set()
                for k in re.findall(r"\btx\('([\w.]+)'", block.group(1) if block else ''):   # the keys the logic reads
                    full = f'{prefix}.{k}'
                    if not (full in en or (k.endswith('.') and any(x.startswith(full) for x in en))):
                        errors.append(f'{f.name}: {extra_name} reads {full}, missing from {FALLBACK}.json')
            names = {k[len(prefix) + 1:].split('.')[0] for k in en if k.startswith(prefix + '.')} | extra
            for name in sorted(set(re.findall(r'\b(?:L|(?:L|T|t)\(\))\.([A-Za-z_]\w*)', src)) - names):
                errors.append(f'{f.name}: uses {prefix}.{name} (through its table), missing from {FALLBACK}.json')
        for m in re.finditer(r'\bI18N\.(?:t|text)\(\s*(?![\'"`])', src):
            errors.append(f'{f.name}: I18N call with a key that is not a literal (it cannot be checked)')
        for m in JS_CALL.finditer(src):
            key, args = m.group(2), m.group(3)
            if m.group(1) == '`' and '${' in key:
                errors.append(f'{f.name}: I18N key {key} is built at run time (it cannot be checked)')
            elif key.endswith('.'):                                    # 'edit.names.' + type: a family of keys
                if not any(k.startswith(key) for k in en):
                    errors.append(f'{f.name}: no key starts with {key} in {FALLBACK}.json')
            elif key not in en:
                errors.append(f'{f.name}: uses {key}, missing from {FALLBACK}.json')
            elif args is not None and '...' not in args:
                given = {a.split(':')[0].strip() for a in args.split(',') if a.strip()}
                if given != fields_of(en[key]):
                    errors.append(f'{f.name}: {key} given fields {sorted(given)}, the text has {sorted(fields_of(en[key]))}')
    js = (root / 'scripts' / 'i18n.js')
    if js.is_file():
        m = re.search(r'const LANGS = \[([^\]]*)\]', js.read_text(encoding='utf-8'))
        if not m or sorted(re.findall(r"'(\w+)'", m.group(1))) != sorted(LANGS):
            errors.append(f'i18n.js LANGS differ from i18n.LANGS {list(LANGS)}')
    chat = root / 'scripts' / 'chat.py'
    if chat.is_file():
        m = re.search(r"'lang': \(([^)]*)\)", chat.read_text(encoding='utf-8'))
        if m and sorted(re.findall(r"'(\w+)'", m.group(1))) != sorted(LANGS):
            errors.append(f'chat.py lang choices differ from i18n.LANGS {list(LANGS)}')


def strays(root):
    out = {}
    for f in sorted((root / 'scripts').glob('*.py')):
        tree = ast.parse(f.read_text(encoding='utf-8'))
        docs = {id(n.body[0].value) for n in ast.walk(tree)
                if isinstance(n, (ast.Module, ast.FunctionDef, ast.ClassDef)) and n.body and isinstance(n.body[0], ast.Expr)}
        out[f.name] = sum(1 for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)
                          and id(node) not in docs and WORDS.search(node.value))
    for f in sorted((root / 'scripts').glob('*.js')) + sorted((root / 'scripts').glob('*.html')):
        src = re.sub(r'(?ms)/\*.*?\*/|^\s*//.*?$', '', f.read_text(encoding='utf-8'))
        out[f.name] = sum(1 for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", src)
                          if WORDS.search(re.sub(r'<[^>]+>|\$\{[^}]*\}', ' ', next(g for g in m.groups() if g is not None))))
    return out


def shape(text):
    """what a translation must keep from its original"""
    commands = re.findall(r'CHAT(?:\}\})?"?\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?', text)
    return {'fields': sorted(set(re.findall(r'\{\{([A-Z_]+)\}\}', text))),
            'flags': sorted(set(re.findall(r'(?<![\w-])--[a-z][a-z-]+', text))),
            'commands': sorted({(v + ' ' + w) if v == 'research' and w else v for v, w in commands}),
            'steps': len(re.findall(r'(?m)^\s*\d+\.\s', text)),
            'ids': sorted(set(re.findall(r'(?<![\w-])(?:att-(?:N|\d+)|[EI]\d+|[EI]-n)(?![\w-])', text))),
            'protocol': protocol_in(text)}


def check_documents(root, errors):
    for group in ('templates', 'guides'):
        if not (root / group).is_dir():
            continue
        for lang_dir in sorted(p for p in (root / group).iterdir() if p.is_dir()):
            if lang_dir.name not in LANGS or lang_dir.name == FALLBACK:
                errors.append(f'{group}/{lang_dir.name}/: not a translation folder ({", ".join(l for l in LANGS if l != FALLBACK)})')
                continue
            for f in sorted(lang_dir.glob('*.md')):
                original = root / group / f.name
                if not original.is_file():
                    errors.append(f'{group}/{lang_dir.name}/{f.name}: no English {group}/{f.name}')
                    continue
                a, b = shape(original.read_text(encoding='utf-8')), shape(f.read_text(encoding='utf-8'))
                for what in a:
                    if a[what] != b[what]:
                        errors.append(f'{group}/{lang_dir.name}/{f.name}: {what} differ from the English one '
                                      f'({b[what]} instead of {a[what]})')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--root', default=str(Path(__file__).resolve().parent.parent.parent))
    p.add_argument('--strays', action='store_true')
    a = p.parse_args()
    root = Path(a.root)
    errors, notes = [], []
    en = check_catalogs(root, errors, notes)
    check_code(root, en, errors)
    check_documents(root, errors)
    for line in notes:
        print('note: ' + line)
    if a.strays:
        left = strays(root)
        print(f"strings still in the code: {sum(left.values())} ({', '.join(f'{k} {v}' for k, v in left.items() if v)})")
    for line in errors:
        print('error: ' + line)
    print(f'i18n: {len(errors)} errors')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
