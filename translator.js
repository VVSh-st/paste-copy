// file_name: translator.js
/* ============================================================
   translator.js — Google / Microsoft / legacy fallback translate
   ============================================================ */
'use strict';

const Translator = (() => {
  const CACHE_KEY = 'tr-cache-v1';
  const HISTORY_KEY = 'tr-history-v1';
  const SETTINGS_KEY = 'tr-settings-v1';
  const MAX_CACHE = 2000;
  const MAX_HISTORY = 50;
  const GOOGLE_TIMEOUT = 8000;
  const MS_TIMEOUT = 12000;
  const LEGACY_TIMEOUT = 9000;

  // ── State ──────────────────────────────────────────────────
  let cache = new Map();
  let history = [];
  let settings = { targetLang: 'ru', engine: 'auto' };
  let googleKey = null;
  let googleKeyTs = 0;
  let msToken = null;
  let msTokenTs = 0;
  let gFail = 0, gBlockUntil = 0;
  let mFail = 0, mBlockUntil = 0;
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  let _activeController = null;
  let _stats = { cacheHits: 0, cacheMisses: 0, googleRequests: 0, msRequests: 0, legacyRequests: 0, totalChars: 0, failed: 0 };

  // ── Languages ──────────────────────────────────────────────
  const LANGUAGES = [
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
  ];

  const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));

  // ── Helpers ────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms) => {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  };
  const retry = async (fn, canRetry, m = 2, d = 700) => {
    for (let i = 0; i < m; i++) {
      try { return await fn(); }
      catch (e) { if (i === m - 1 || (canRetry && !canRetry(e))) throw e; await sleep(d << i); }
    }
  };

  const ZW = /[\u200B-\u200D\uFEFF]/g;
  const WS = /\s+/g;
  const norm = t => (t == null ? '' : String(t)).replace(ZW, '').replace(WS, ' ').trim();

  function decodeHtmlEntities(s) {
    if (!s || !s.includes('&')) return s;
    const el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  }

  // ── Template protection ────────────────────────────────────
  // {{...}}, $VAR, !теги — не переводим
  const TMPL_RE = /(\{\{[^}]+\}\}|\$[A-Z_][A-Z0-9_]*|\$\{[^}]+\}|\[\[[^\]]+\]\]|%[^%]+%|\{\d+\}|![а-яёА-ЯЁ]+)\b/g;

  function protectTemplates(text) {
    const tokens = [];
    let i = 0;
    const prefix = `__TRPL${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_`;
    const protected_ = text.replace(TMPL_RE, m => {
      const token = `${prefix}${i++}`;
      tokens.push({ token, original: m });
      return token;
    });
    return { text: protected_, tokens };
  }

  function restoreTemplates(text, tokens) {
    if (!tokens?.length) return text;
    let out = text;
    for (const t of tokens) {
      if (out.includes(t.token)) {
        out = out.split(t.token).join(t.original);
      } else {
        // fuzzy: token may have been split by translation
        try {
          const re = new RegExp(t.token.split('').map(ch =>
            ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('\\s*'), 'g');
          out = out.replace(re, t.original);
        } catch {}
      }
    }
    return out;
  }

  // ── Cyrillic detection ─────────────────────────────────────
  const CYR_RE = /[\u0400-\u04FF]/gu;
  const LAT_RE = /[A-Za-z]/g;

  function detectLangHint(text) {
    if (!text) return null;
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { code: 'ja', name: 'Japanese' };
    if (/[\u3400-\u9FFF]/.test(text)) return { code: 'zh', name: 'Chinese' };
    if (/[\uAC00-\uD7A3]/.test(text)) return { code: 'ko', name: 'Korean' };
    if (/[\u0600-\u06FF]/.test(text)) return { code: 'ar', name: 'Arabic' };
    const letters = text.replace(/[\s\d\p{P}]/gu, '');
    if (!letters) return null;
    const cyrCount = (letters.match(CYR_RE) || []).length;
    const latCount = (letters.match(LAT_RE) || []).length;
    if (cyrCount > 0 && latCount > 0) return { code: 'mixed', name: 'Смешанный' };
    if (cyrCount > 0) return { code: 'ru', name: 'Русский' };
    if (latCount > 0) return { code: 'en', name: 'English' };
    return null;
  }

  function needsTranslation(text, targetLang) {
    const c = norm(text);
    if (c.length < 2) return false;
    const lang = detectLangHint(c);
    if (lang?.code && lang.code !== 'mixed' && lang.code === targetLang) return false;
    return true;
  }

  // ── Cache ──────────────────────────────────────────────────
  let _cacheDirty = false;
  let _cacheSaveTimer = null;

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          cache = new Map(arr.slice(-MAX_CACHE));
        }
      }
    } catch {}
  }

  function flushCache() {
    if (!_cacheDirty) return;
    try {
      const arr = [...cache.entries()].slice(-MAX_CACHE);
      localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
      _cacheDirty = false;
    } catch {
      // dirty flag stays true so we retry on next flush
    }
  }

  function scheduleCacheSave() {
    _cacheDirty = true;
    clearTimeout(_cacheSaveTimer);
    _cacheSaveTimer = setTimeout(flushCache, 3000);
  }

  function cacheGet(text, lang) {
    const key = JSON.stringify([lang, text]);
    const v = cache.get(key);
    if (v !== undefined) {
      if (typeof v === 'string' || !v.ts || Date.now() - v.ts > CACHE_TTL) {
        cache.delete(key);
        scheduleCacheSave();
        _stats.cacheMisses++;
        return undefined;
      }
      cache.delete(key);
      cache.set(key, v);
      _stats.cacheHits++;
      return v.text ?? v;
    }
    _stats.cacheMisses++;
    return undefined;
  }

  function cacheSet(text, lang, translated) {
    if (!text || !translated) return;
    const key = JSON.stringify([lang, text]);
    cache.delete(key);
    cache.set(key, { text: translated, ts: Date.now() });
    if (cache.size > MAX_CACHE) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    scheduleCacheSave();
  }

  // ── History ────────────────────────────────────────────────
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) history = JSON.parse(raw);
      if (!Array.isArray(history)) history = [];
    } catch { history = []; }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch {}
  }

  function addHistory(original, translated, fromLang, toLang) {
    history.push({
      original: original.slice(0, 500),
      translated: translated.slice(0, 500),
      from: fromLang,
      to: toLang,
      ts: Date.now()
    });
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    saveHistory();
  }

  // ── Settings ───────────────────────────────────────────────
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.targetLang) settings.targetLang = s.targetLang;
        if (s?.engine) settings.engine = s.engine;
      }
    } catch {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  // ── Google API ─────────────────────────────────────────────
  async function fetchGoogleKey() {
    if (googleKey && Date.now() - googleKeyTs < 4 * 3600 * 1000) return googleKey;
    try {
      const r = await withTimeout(
        fetch('https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main'),
        8000
      );
      if (!r.ok) return null;
      const text = await r.text();
      const m = text.match(/x-goog-api-key['"]\s*:\s*['"]([^'"]+)/i);
      if (m && /^AIza[0-9A-Za-z_-]{20,}$/.test(m[1])) {
        googleKey = m[1];
        googleKeyTs = Date.now();
        return googleKey;
      }
    } catch {}
    return null;
  }

  async function translateGoogle(texts, to, signal) {
    const key = await fetchGoogleKey();
    if (!key) throw new Error('Google auth failed');
    _stats.googleRequests++;
    _stats.totalChars += texts.reduce((s, t) => s + t.length, 0);
    const results = [];
    for (let i = 0; i < texts.length; i += 50) {
      const chunk = texts.slice(i, i + 50);
      const r = await withTimeout(
        fetch('https://translate-pa.googleapis.com/v1/translateHtml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': key },
          body: JSON.stringify([[chunk, 'auto', to], 'te']),
          signal,
        }),
        GOOGLE_TIMEOUT
      );
      if (r.status === 429) throw Object.assign(new Error('rate limit'), { status: 429 });
      if (!r.ok) throw Object.assign(new Error(`google http ${r.status}`), { status: r.status });
      try {
        const data = await r.json();
        results.push(...(data?.[0] || []).map(v => decodeHtmlEntities((v || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())));
      } catch {
        results.push(...chunk.map(() => null));
      }
    }
    return results;
  }

  // ── Microsoft API ──────────────────────────────────────────
  async function fetchMsToken() {
    if (msToken && Date.now() - msTokenTs < 480000) return msToken;
    try {
      const r = await withTimeout(
        fetch('https://edge.microsoft.com/translate/auth'),
        5000
      );
      if (r.ok) {
        msToken = await r.text();
        msTokenTs = Date.now();
        return msToken;
      }
    } catch {}
    return null;
  }

  async function translateMs(texts, to, signal) {
    const token = await fetchMsToken();
    if (!token) throw new Error('MS auth failed');
    _stats.msRequests++;
    _stats.totalChars += texts.reduce((s, t) => s + t.length, 0);
    const tg = to === 'zh' ? 'zh-Hans' : to;
    const results = [];
    for (let i = 0; i < texts.length; i += 100) {
      const chunk = texts.slice(i, i + 100);
      const r = await withTimeout(
        fetch(`https://api-edge.cognitive.microsofttranslator.com/translate?to=${tg}&api-version=3.0`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk.map(Text => ({ Text }))),
          signal,
        }),
        MS_TIMEOUT
      );
      if (r.status === 401 || r.status === 403) {
        msToken = null; msTokenTs = 0;
        throw Object.assign(new Error('ms auth'), { status: r.status });
      }
      if (r.status === 429) throw Object.assign(new Error('rate limit'), { status: 429 });
      if (!r.ok) throw Object.assign(new Error(`ms http ${r.status}`), { status: r.status });
      try {
        const data = await r.json();
        results.push(...(Array.isArray(data) ? data : []).map(y => decodeHtmlEntities(y?.translations?.[0]?.text || null)));
      } catch {
        results.push(...chunk.map(() => null));
      }
    }
    return results;
  }

  // ── Legacy fallback ────────────────────────────────────────
  async function translateLegacyOne(text, to, signal) {
    const r = await withTimeout(
      fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`, { signal }),
      LEGACY_TIMEOUT
    );
    if (r.status === 429) throw Object.assign(new Error('rate limit'), { status: 429 });
    if (!r.ok) throw Object.assign(new Error(`legacy http ${r.status}`), { status: r.status });
    const data = await r.json();
    let out = '';
    data[0].forEach(y => { if (y[0]) out += y[0]; });
    return decodeHtmlEntities(out) || null;
  }

  async function translateLegacy(texts, to, signal) {
    _stats.legacyRequests++;
    _stats.totalChars += texts.reduce((s, t) => s + t.length, 0);
    const CONCURRENCY = 5;
    const out = new Array(texts.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < texts.length) {
        if (signal?.aborted) break;
        const i = next++;
        try { out[i] = await retry(() => translateLegacyOne(texts[i], to, signal), e => e?.status !== 429 && e?.name !== 'AbortError', 2, 500); }
        catch { out[i] = null; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
    return out;
  }

  // ── Main translate pipeline ────────────────────────────────
  async function translate(texts, toLang) {
    if (!texts.length) return [];
    if (_activeController) _activeController.abort();
    _activeController = new AbortController();
    const signal = _activeController.signal;
    toLang = toLang || settings.targetLang;
    const out = new Array(texts.length).fill(null);
    const todo = [], idx = [];

    texts.forEach((t, i) => {
      const n = norm(t);
      if (!n) return;
      const c = cacheGet(n, toLang);
      if (c !== undefined) out[i] = c;
      else { todo.push(n); idx.push(i); }
    });

    if (!todo.length) return out;

    const engine = settings.engine;
    let rem = todo.map((t, i) => ({ t, i }));

    const accept = (src, tr) => {
      if (!tr || !tr.trim()) return false;
      return true;
    };

    const apply = (arr, src) => {
      for (let j = 0; j < src.length; j++) {
        const tr = arr[j];
        if (accept(src[j].t, tr)) {
          cacheSet(src[j].t, toLang, tr);
          out[idx[src[j].i]] = tr;
        }
      }
    };

    const filterRem = (arr, src) => src.filter((x, j) => {
      return !accept(x.t, arr[j]);
    });

    // Google
    if (engine === 'google' || engine === 'auto') {
      if (Date.now() >= gBlockUntil) {
        try {
          const g = await translateGoogle(rem.map(x => x.t), toLang, signal);
          gFail = 0;
          if (!g.every(v => !v)) { apply(g, rem); rem = filterRem(g, rem); }
        } catch (e) {
          gFail++;
          if (gFail >= 3) gBlockUntil = Date.now() + 5 * 60 * 1000;
        }
      }
      if (engine === 'google') return out;
    }

    // Microsoft
    if ((engine === 'microsoft' || engine === 'auto') && rem.length && Date.now() >= mBlockUntil) {
      try {
        const m = await translateMs(rem.map(x => x.t), toLang, signal);
        mFail = 0;
        if (!m.every(v => !v)) { apply(m, rem); rem = filterRem(m, rem); }
      } catch (e) {
        mFail++;
        if (mFail >= 3) mBlockUntil = Date.now() + 3 * 60 * 1000;
      }
      if (engine === 'microsoft') return out;
    }

    // Legacy fallback
    if (rem.length) {
      try {
        const l = await translateLegacy(rem.map(x => x.t), toLang, signal);
        apply(l, rem);
      } catch {}
    }

    return out;
  }

  // ── Single text translate ──────────────────────────────────
  async function translateOne(text, toLang) {
    const res = await translate([text], toLang);
    const translated = res[0] || null;
    if (translated) {
      const from = detectLangHint(text)?.code || 'auto';
      addHistory(text, translated, from, toLang || settings.targetLang);
    }
    return translated;
  }

  // ── Translate with template protection ─────────────────────
  async function translateProtected(text, toLang) {
    if (!text?.trim()) return text;
    const { text: safe, tokens } = protectTemplates(text);
    const result = await translateOne(safe, toLang);
    if (!result) return text;
    return restoreTemplates(result, tokens);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    LANGUAGES,
    LANG_BY_CODE,

    get targetLang() { return settings.targetLang; },
    set targetLang(v) { settings.targetLang = v; saveSettings(); },

    get engine() { return settings.engine; },
    set engine(v) { settings.engine = v; saveSettings(); },

    get history() { return history; },

    init() {
      loadCache();
      loadHistory();
      loadSettings();
      window.addEventListener('beforeunload', () => { if (_activeController) _activeController.abort(); flushCache(); });
    },

    detectLang: detectLangHint,
    needsTranslation,
    translateOne,
    translate,
    translateProtected,
    protectTemplates,
    restoreTemplates,
    addHistory,

    clearCache() {
      cache.clear();
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    },
    clearHistory() { history = []; saveHistory(); },

    getCacheSize() { return cache.size; },
    getHistorySize() { return history.length; },
    stats() { return { ..._stats, cacheSize: cache.size, historySize: history.length }; },
    resetStats() { _stats = { cacheHits: 0, cacheMisses: 0, googleRequests: 0, msRequests: 0, legacyRequests: 0, totalChars: 0, failed: 0 }; },
  };
})();
