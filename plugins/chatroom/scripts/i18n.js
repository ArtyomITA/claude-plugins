// Translations for the viewer and the office: the same catalogs as chat.py (locales/<lang>.json), English as the
// fallback. Await I18N.load(lang) before the first render (and again when the language changes), then
// I18N.t('viewer.empty', {n: 3}): the fields are escaped, so the result may go into innerHTML; I18N.text() leaves
// them as they are, for textContent. A missing or empty key falls back to English; a key English lacks shows itself
// (tools/i18n_check.py reports it). A field not given stays as written, as in i18n.py.
// I18N.table('office', args, extra) gives the old-style object of a prefix (o.key, o.fn(a, b), o.list[i]): args maps
// a function key to its field names in call order, extra(tx) adds the functions that hold logic; keys with a dot
// (kind.shell) become nested objects. I18N.tables() gives the old {en: ..., it: ...} shape.
(function () {
  const LANGS = ['en', 'it'], cats = {}, tables = {};
  let cur = 'en';
  const norm = (lang) => (LANGS.includes(String(lang).toLowerCase().slice(0, 2)) ? String(lang).toLowerCase().slice(0, 2) : 'en');
  const pending = {};
  async function get(lang) {
    if (!cats[lang] && !pending[lang]) {                // one request per language at a time
      pending[lang] = (async () => {
        try {
          const r = await fetch(`locales/${lang}.json`);
          if (r.ok) { cats[lang] = await r.json(); for (const k in tables) if (k.endsWith('|' + lang)) delete tables[k]; }
          else console.warn(`chatroom i18n: locales/${lang}.json: HTTP ${r.status}`);
        } catch (e) { console.warn(`chatroom i18n: locales/${lang}.json not loaded (${e}): English is used`); }
        delete pending[lang];
      })();
    }
    if (pending[lang]) await pending[lang];
    return cats[lang] || {};
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const pick = (v, f) => (v && typeof v === 'object' ? (f.n == 1 ? v.one : v.other) : v);
  const empty = (v) => v == null || v === '';
  function find(key, f, lang) {
    lang = norm(lang);
    let v = pick((cats[lang] || {})[key], f);
    if (empty(v)) v = pick((cats.en || {})[key], f);
    return empty(v) ? key : v;
  }
  const fill = (v, f, wrap) => v.replace(/\{(\w+)\}/g, (m, k) => (k in f ? wrap(f[k]) : m));
  const I18N = {
    LANGS,
    async load(lang) { cur = norm(lang); await Promise.all([get('en'), get(cur)]); },
    async fetchLang(lang) { await Promise.all([get('en'), get(norm(lang))]); },   // without changing the current language
    t(key, f = {}, lang = cur) { return fill(find(key, f, lang), f, esc); },
    text(key, f = {}, lang = cur) { return fill(find(key, f, lang), f, String); },
    table(prefix, args = {}, extra = null, lang = cur) {
      lang = norm(lang);
      const id = prefix + '|' + lang;
      if (tables[id]) return tables[id];
      const out = {}, p = prefix + '.';
      for (const k of Object.keys(cats.en || {})) {
        if (!k.startsWith(p)) continue;
        const name = k.slice(p.length), arr = name.match(/^(\w+)\.(\d+)$/);
        if (arr) { (out[arr[1]] = out[arr[1]] || [])[+arr[2]] = I18N.text(k, {}, lang); continue; }
        const dot = name.indexOf('.');
        if (dot > 0) { (out[name.slice(0, dot)] = out[name.slice(0, dot)] || {})[name.slice(dot + 1)] = I18N.text(k, {}, lang); continue; }
        out[name] = args[name] ? (...a) => I18N.text(k, Object.fromEntries(args[name].map((n, i) => [n, a[i]])), lang) : I18N.text(k, {}, lang);
      }
      if (extra) Object.assign(out, extra((key, f) => I18N.text(`${p}${key}`, f || {}, lang)));
      if (cats.en) tables[id] = out;                      // not cached before English arrives
      return out;
    },
    // the old {en: {...}, it: {...}} shape of a module's table, each language read from the catalog when asked
    tables(prefix, args = {}, extra = null) {
      const o = {};
      for (const l of LANGS) Object.defineProperty(o, l, {get: () => I18N.table(prefix, args, extra, l), enumerable: true});
      return o;
    },
    seed(lang, cat) { cats[lang] = cat; },           // the server puts English in this file: the page has it even offline
    has(key) { return !empty((cats.en || {})[key]); },
    get lang() { return cur; },
  };
  window.I18N = I18N;
})();
