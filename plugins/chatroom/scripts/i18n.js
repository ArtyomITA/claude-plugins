// Translations for the viewer and the office: the same catalogs as chat.py (locales/<lang>.json), English as the
// fallback. Await I18N.load(lang) before the first render (and again when the language changes), then
// I18N.t('viewer.empty', {n: 3}): the fields are escaped, so the result may go into innerHTML; I18N.text() leaves
// them as they are, for textContent. A missing or empty key falls back to English; a key English lacks shows itself
// (tools/i18n_check.py reports it). A field not given stays as written, as in i18n.py.
(function () {
  const LANGS = ['en', 'it'], cats = {};
  let cur = 'en';
  async function get(lang) {
    if (!cats[lang]) {
      try {
        const r = await fetch(`locales/${lang}.json`);
        if (r.ok) cats[lang] = await r.json();         // a failed load is tried again next time, never cached
      } catch (e) { /* offline: English, or the key */ }
    }
    return cats[lang] || {};
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const pick = (v, f) => (v && typeof v === 'object' ? (f.n == 1 ? v.one : v.other) : v);
  const empty = (v) => v == null || v === '';
  function find(key, f) {
    let v = pick((cats[cur] || {})[key], f);
    if (empty(v)) v = pick((cats.en || {})[key], f);
    return empty(v) ? key : v;
  }
  const fill = (v, f, wrap) => v.replace(/\{(\w+)\}/g, (m, k) => (k in f ? wrap(f[k]) : m));
  window.I18N = {
    LANGS,
    async load(lang) {
      cur = LANGS.includes(String(lang).toLowerCase().slice(0, 2)) ? String(lang).toLowerCase().slice(0, 2) : 'en';
      await Promise.all([get('en'), get(cur)]);
    },
    t(key, f = {}) { return fill(find(key, f), f, esc); },
    text(key, f = {}) { return fill(find(key, f), f, String); },
    get lang() { return cur; },
  };
})();
