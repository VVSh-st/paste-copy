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
  const MAX_CACHE_TEXT_LEN = 2000;
  const MAX_HISTORY = 50;
  const GOOGLE_TIMEOUT = 8000;
  const MS_TIMEOUT = 12000;
  const LEGACY_TIMEOUT = 9000;
  const LEGACY_MAX_QUERY_CHARS = 1200;
  const GOOGLE_KEY_TTL = 4 * 60 * 60 * 1000;
  const MS_TOKEN_TTL = 8 * 60 * 1000;

  // ── State ──────────────────────────────────────────────────
  let cache = new Map();
  let history = [];
  let settings = { targetLang: 'ru', engine: 'auto' };
  let googleKey = null;
  let googleKeyTs = 0;
  let googleKeyPromise = null;
  let googleKeyError = null;
  let msToken = null;
  let msTokenTs = 0;
  let msTokenPromise = null;
  let msTokenError = null;
  let gFail = 0, gBlockUntil = 0;
  let mFail = 0, mBlockUntil = 0;
  let lFail = 0, lBlockUntil = 0;
  let _inited = false;
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
    { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
  ];

  const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));
  const ENGINES = new Set(['auto', 'google', 'microsoft', 'legacy']);
  const MS_LANG_MAP = { zh: 'zh-Hans', 'zh-TW': 'zh-Hant' };

  // ── Helpers ────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function fetchWithTimeout(url, options = {}, ms) {
    const ctrl = new AbortController();
    const external = options.signal;
    let timer;
    const abort = () => ctrl.abort();
    if (external) {
      if (external.aborted) ctrl.abort();
      else external.addEventListener('abort', abort, { once: true });
    }
    timer = setTimeout(() => ctrl.abort(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
    return fetch(url, { ...options, signal: ctrl.signal })
      .catch(e => {
        if (ctrl.signal.aborted && !external?.aborted) {
          throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
        }
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        if (external) external.removeEventListener('abort', abort);
      });
  }

  const withTimeout = (p, ms) => {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  };

  function countChars(texts) {
    return texts.reduce((s, t) => s + String(t || '').length, 0);
  }

  function normalizeTargetLang(v) {
    return LANG_BY_CODE[v] ? v : settings.targetLang;
  }

  function getStorage() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }
  const retry = async (fn, canRetry, m = 2, d = 700) => {
    for (let i = 0; i < m; i++) {
      try { return await fn(); }
      catch (e) {
        const shouldRetry = canRetry ? canRetry(e) : true;
        if (i === m - 1 || !shouldRetry) throw e;
        await sleep(d << i);
      }
    }
  };

  const ZW = /[\u200B-\u200D\uFEFF]/g;
  const WS = /\s+/g;
  const norm = t => (t == null ? '' : String(t)).replace(ZW, '').replace(WS, ' ').trim();

  const htmlDecodeEl = typeof document !== 'undefined' ? document.createElement('textarea') : null;

  function decodeHtmlEntities(s) {
    if (!s || !s.includes('&')) return s;
    if (!htmlDecodeEl) return s;
    htmlDecodeEl.innerHTML = s;
    const value = htmlDecodeEl.value;
    htmlDecodeEl.innerHTML = '';
    return value;
  }

  // ── Template protection ────────────────────────────────────
  // {{...}}, $VAR, !теги — не переводим
  const TMPL_RE = /(\{\{[^}\n]{1,200}\}\}|\$[A-Z_][A-Z0-9_]*\b|\$\{[^}\n]{1,200}\}|\[\[[^\]\n]{1,200}\]\]|%[A-Z_][A-Z0-9_]*%|\{\d+\}|![а-яёА-ЯЁ]+\b)/g;
  let templateSeq = 0;

  function protectTemplates(text) {
    const tokens = [];
    let i = 0;
    let prefix;
    do {
      prefix = `\u27E6TRPL_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_`;
    } while (text.includes(prefix));
    const protected_ = text.replace(TMPL_RE, m => {
      const token = `${prefix}${i++}\u27E7`;
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
  const HAN_RE = /\p{Script=Han}/u;
  const NON_LETTER_HINT_RE = /[\s\d\p{P}]/gu;

  function detectLangHint(text) {
    text = text == null ? '' : String(text);
    if (!text) return null;
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { code: 'ja', name: 'Japanese' };
    if (HAN_RE.test(text)) return { code: 'zh', name: 'Chinese' };
    if (/[\uAC00-\uD7A3]/.test(text)) return { code: 'ko', name: 'Korean' };
    if (/[\u0600-\u06FF]/.test(text)) return { code: 'ar', name: 'Arabic' };
    const letters = text.replace(NON_LETTER_HINT_RE, '');
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
      const storage = getStorage();
      const raw = storage?.getItem(CACHE_KEY);
      if (raw) {
        if (raw.length > 5 * 1024 * 1024) {
          storage?.removeItem(CACHE_KEY);
          cache = new Map();
          return;
        }
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const now = Date.now();
          cache = new Map(arr
            .filter(([, v]) => v && typeof v === 'object' && v.ts && now - v.ts <= CACHE_TTL)
            .slice(-MAX_CACHE));
        }
      }
    } catch {}
  }

  function flushCache() {
    if (!_cacheDirty) return;
    try {
      const storage = getStorage();
      if (!storage) return;
      const arr = [...cache.entries()].slice(-MAX_CACHE);
      storage.setItem(CACHE_KEY, JSON.stringify(arr));
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

  const cacheKey = (text, lang) => `${lang}\u0001${text}`;

  function cacheGet(text, lang) {
    if (text.length > MAX_CACHE_TEXT_LEN) {
      _stats.cacheMisses++;
      return undefined;
    }
    const key = cacheKey(text, lang);
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
    if (text.length > MAX_CACHE_TEXT_LEN || translated.length > MAX_CACHE_TEXT_LEN) return;
    const key = cacheKey(text, lang);
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
      const storage = getStorage();
      const raw = storage?.getItem(HISTORY_KEY);
      if (raw) history = JSON.parse(raw);
      if (!Array.isArray(history)) history = [];
      history = history.filter(item =>
        item &&
        typeof item.original === 'string' &&
        typeof item.translated === 'string' &&
        typeof item.to === 'string' &&
        typeof item.ts === 'number'
      );
      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    } catch { history = []; }
  }

  function saveHistory() {
    try {
      const storage = getStorage();
      storage?.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }

  function addHistory(original, translated, fromLang, toLang) {
    const origSlice = original.slice(0, 500);
    history = history.filter(item =>
      !(item.original === origSlice && item.to === toLang)
    );
    history.push({
      original: origSlice,
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
      const storage = getStorage();
      const raw = storage?.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        if (LANG_BY_CODE[s?.targetLang]) settings.targetLang = s.targetLang;
        if (ENGINES.has(s?.engine)) settings.engine = s.engine;
      }
    } catch {}
  }

  function saveSettings() {
    try {
      const storage = getStorage();
      storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  // ── Google API ─────────────────────────────────────────────
  async function fetchGoogleKey() {
    if (googleKey && Date.now() - googleKeyTs < GOOGLE_KEY_TTL) return googleKey;
    if (googleKeyPromise) return googleKeyPromise;
    googleKeyPromise = (async () => {
      try {
        const r = await fetchWithTimeout(
          'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main',
          { credentials: 'omit', referrerPolicy: 'no-referrer' },
          8000
        );
        if (!r.ok) {
          googleKeyError = `google key http ${r.status}`;
          return null;
        }
        const len = Number(r.headers.get('Content-Length') || 0);
        if (len && len > 512 * 1024) {
          googleKeyError = 'google key response too large';
          return null;
        }
        const text = await r.text();
        if (text.length > 512 * 1024) {
          googleKeyError = 'google key response too large';
          return null;
        }
        const m = text.match(/["']?x-goog-api-key["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (m && /^AIza[0-9A-Za-z_-]{20,}$/.test(m[1])) {
          googleKey = m[1];
          googleKeyTs = Date.now();
          googleKeyError = null;
          return googleKey;
        }
        googleKeyError = 'google key not found in response';
      } catch (e) {
        googleKeyError = e?.message || 'google key network error';
      }
      return null;
    })();
    try {
      return await googleKeyPromise;
    } finally {
      googleKeyPromise = null;
    }
  }

  async function translateGoogle(texts, to, signal) {
    const key = await fetchGoogleKey();
    if (!key) throw new Error(`Google auth failed${googleKeyError ? ': ' + googleKeyError : ''}`);
    _stats.googleRequests++;
    _stats.totalChars += countChars(texts);
    const results = [];
    for (let i = 0; i < texts.length; i += 50) {
      const chunk = texts.slice(i, i + 50);
      const r = await fetchWithTimeout(
        'https://translate-pa.googleapis.com/v1/translateHtml',
        {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': key },
          body: JSON.stringify([[chunk, 'auto', to], 'te']),
          signal,
        },
        GOOGLE_TIMEOUT
      );
      if (r.status === 401 || r.status === 403) {
        googleKey = null;
        googleKeyTs = 0;
        throw Object.assign(new Error(`google auth http ${r.status}`), { status: r.status });
      }
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get('Retry-After') || 0);
        throw Object.assign(new Error('rate limit'), {
          status: 429,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
        });
      }
      if (!r.ok) throw Object.assign(new Error(`google http ${r.status}`), { status: r.status });
      try {
        const data = await r.json();
        const rows = Array.isArray(data?.[0]) ? data[0] : [];
        for (let j = 0; j < chunk.length; j++) {
          const v = rows[j];
          results.push(v ? decodeHtmlEntities(String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : null);
        }
      } catch {
        results.push(...chunk.map(() => null));
      }
    }
    return results;
  }

  // ── Microsoft API ──────────────────────────────────────────
  async function fetchMsToken() {
    if (msToken && Date.now() - msTokenTs < MS_TOKEN_TTL) return msToken;
    if (msTokenPromise) return msTokenPromise;
    msTokenPromise = (async () => {
      try {
        const r = await fetchWithTimeout(
          'https://edge.microsoft.com/translate/auth',
          { credentials: 'omit', referrerPolicy: 'no-referrer' },
          5000
        );
        if (r.ok) {
          const token = (await r.text()).trim();
          if (!token) {
            msTokenError = 'ms auth empty token';
            return null;
          }
          msToken = token;
          msTokenTs = Date.now();
          msTokenError = null;
          return msToken;
        }
        msTokenError = `ms auth http ${r.status}`;
      } catch (e) {
        msTokenError = e?.message || 'ms auth network error';
      }
      return null;
    })();
    try {
      return await msTokenPromise;
    } finally {
      msTokenPromise = null;
    }
  }

  async function translateMs(texts, to, signal) {
    const token = await fetchMsToken();
    if (!token) throw new Error(`MS auth failed${msTokenError ? ': ' + msTokenError : ''}`);
    _stats.msRequests++;
    _stats.totalChars += countChars(texts);
    const tg = MS_LANG_MAP[to] || to;
    const results = [];
    for (let i = 0; i < texts.length; i += 100) {
      const chunk = texts.slice(i, i + 100);
      const r = await fetchWithTimeout(
        `https://api-edge.cognitive.microsofttranslator.com/translate?to=${encodeURIComponent(tg)}&api-version=3.0`,
        {
          method: 'POST',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk.map(Text => ({ Text }))),
          signal,
        },
        MS_TIMEOUT
      );
      if (r.status === 401 || r.status === 403) {
        msToken = null; msTokenTs = 0;
        throw Object.assign(new Error('ms auth'), { status: r.status });
      }
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get('Retry-After') || 0);
        throw Object.assign(new Error('rate limit'), {
          status: 429,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
        });
      }
      if (!r.ok) throw Object.assign(new Error(`ms http ${r.status}`), { status: r.status });
      try {
        const data = await r.json();
        const rows = Array.isArray(data) ? data : [];
        for (let j = 0; j < chunk.length; j++) {
          results.push(decodeHtmlEntities(rows[j]?.translations?.[0]?.text || null));
        }
      } catch {
        results.push(...chunk.map(() => null));
      }
    }
    return results;
  }

  // ── Legacy fallback ────────────────────────────────────────
  async function translateLegacyOne(text, to, signal) {
    if (text.length > LEGACY_MAX_QUERY_CHARS) return null;
    const r = await fetchWithTimeout(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`,
      { signal, credentials: 'omit', referrerPolicy: 'no-referrer' },
      LEGACY_TIMEOUT
    );
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get('Retry-After') || 0);
      throw Object.assign(new Error('rate limit'), {
        status: 429,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
      });
    }
    if (!r.ok) throw Object.assign(new Error(`legacy http ${r.status}`), { status: r.status });
    const data = await r.json();
    if (!Array.isArray(data?.[0])) return null;
    let out = '';
    data[0].forEach(y => { if (Array.isArray(y) && y[0]) out += y[0]; });
    return decodeHtmlEntities(out) || null;
  }

  async function translateLegacy(texts, to, signal) {
    _stats.legacyRequests++;
    _stats.totalChars += countChars(texts);
    const CONCURRENCY = 5;
    const out = new Array(texts.length).fill(null);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < texts.length) {
        if (signal?.aborted) break;
        const i = next++;
        try {
          out[i] = await retry(() => translateLegacyOne(texts[i], to, signal), e => e?.status !== 429 && e?.name !== 'AbortError', 2, 500);
        } catch (e) {
          if (e?.status === 429) stop = true;
          out[i] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
    return out;
  }

  // ── Main translate pipeline ────────────────────────────────
  async function translate(texts, toLang) {
    if (!Array.isArray(texts)) texts = texts == null ? [] : [String(texts)];
    if (!texts.length) return [];
    if (_activeController) _activeController.abort();
    _activeController = new AbortController();
    const signal = _activeController.signal;
    toLang = normalizeTargetLang(toLang || settings.targetLang);
    const out = new Array(texts.length).fill(null);
    const todo = [], idx = [];

    texts.forEach((t, i) => {
      const n = norm(t);
      if (!n) return;
      if (!needsTranslation(n, toLang)) {
        out[i] = t;
        return;
      }
      const c = cacheGet(n, toLang);
      if (c !== undefined) out[i] = c;
      else { todo.push({ raw: t, key: n }); idx.push(i); }
    });

    if (!todo.length) return out;

    const engine = settings.engine;
    let rem = todo.map((x, i) => ({ t: x.raw, key: x.key, i }));

    const accept = (tr, src) => {
      if (!tr || !tr.trim()) return false;
      if (src && norm(tr) === src.key && needsTranslation(src.key, toLang)) return false;
      return true;
    };

    const apply = (arr, src) => {
      for (let j = 0; j < src.length; j++) {
        const tr = arr[j];
        if (accept(tr, src[j])) {
          cacheSet(src[j].key, toLang, tr);
          out[idx[src[j].i]] = tr;
        }
      }
    };

    const filterRem = (arr, src) => src.filter((x, j) => {
      return !accept(arr[j], x);
    });

    // Google
    if (engine === 'google' || engine === 'auto') {
      if (Date.now() >= gBlockUntil) {
        try {
          const g = await translateGoogle(rem.map(x => x.t), toLang, signal);
          gFail = 0;
          if (!g.every(v => !v)) { apply(g, rem); rem = filterRem(g, rem); }
        } catch (e) {
          if (e?.name === 'AbortError' || signal.aborted) throw e;
          gFail++;
          _stats.failed++;
          if (e?.retryAfterMs) gBlockUntil = Date.now() + e.retryAfterMs;
          else if (gFail >= 3) gBlockUntil = Date.now() + 5 * 60 * 1000;
        }
      }
      if (engine === 'google') return out.map((v, i) => v == null ? texts[i] : v);
    }

    // Microsoft
    if ((engine === 'microsoft' || engine === 'auto') && rem.length && Date.now() >= mBlockUntil) {
      try {
        const m = await translateMs(rem.map(x => x.t), toLang, signal);
        mFail = 0;
        if (!m.every(v => !v)) { apply(m, rem); rem = filterRem(m, rem); }
      } catch (e) {
        if (e?.name === 'AbortError' || signal.aborted) throw e;
        mFail++;
        _stats.failed++;
        if (e?.retryAfterMs) mBlockUntil = Date.now() + e.retryAfterMs;
        else if (mFail >= 3) mBlockUntil = Date.now() + 3 * 60 * 1000;
      }
      if (engine === 'microsoft') return out.map((v, i) => v == null ? texts[i] : v);
    }

    // Legacy fallback
    if ((engine === 'legacy' || engine === 'auto') && rem.length && (engine === 'legacy' || Date.now() >= lBlockUntil)) {
      try {
        const l = await translateLegacy(rem.map(x => x.t), toLang, signal);
        lFail = 0;
        apply(l, rem);
      } catch (e) {
        if (e?.name === 'AbortError' || signal.aborted) throw e;
        lFail++;
        if (lFail >= 3) lBlockUntil = Date.now() + 3 * 60 * 1000;
        _stats.failed++;
      }
    }

    return out.map((v, i) => v == null ? texts[i] : v);
  }

  // ── Single text translate ──────────────────────────────────
  async function translateOneRaw(text, toLang) {
    const res = await translate([text], toLang);
    return res[0] || null;
  }

  async function translateOne(text, toLang) {
    const target = normalizeTargetLang(toLang || settings.targetLang);
    if (!needsTranslation(text, target)) return text;
    const translated = await translateOneRaw(text, toLang);
    if (translated) {
      const from = detectLangHint(text)?.code || 'auto';
      addHistory(text, translated, from, target);
    }
    return translated || text;
  }

  // ── Translate with template protection ─────────────────────
  async function translateProtected(text, toLang) {
    if (!text?.trim()) return text;
    const target = normalizeTargetLang(toLang || settings.targetLang);
    const { text: safe, tokens } = protectTemplates(text);
    const result = await translateOneRaw(safe, target);
    if (!result) {
      _stats.failed++;
      return text;
    }
    const restored = restoreTemplates(result, tokens);
    const from = detectLangHint(text)?.code || 'auto';
    addHistory(text, restored, from, target);
    return restored;
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    LANGUAGES,
    LANG_BY_CODE,

    get targetLang() { return settings.targetLang; },
    set targetLang(v) {
      if (LANG_BY_CODE[v]) {
        settings.targetLang = v;
        saveSettings();
      }
    },

    get engine() { return settings.engine; },
    set engine(v) {
      if (ENGINES.has(v)) {
        settings.engine = v;
        saveSettings();
      }
    },

    get history() { return history; },

    init() {
      if (_inited) return;
      _inited = true;
      loadCache();
      loadHistory();
      loadSettings();
      if (typeof window !== 'undefined') {
        const finalFlush = () => { if (_activeController) _activeController.abort(); flushCache(); };
        window.addEventListener('beforeunload', finalFlush);
        window.addEventListener('pagehide', finalFlush);
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') flushCache();
        });
      }
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
      clearTimeout(_cacheSaveTimer);
      _cacheSaveTimer = null;
      _cacheDirty = false;
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    },
    clearHistory() { history = []; saveHistory(); },

    getCacheSize() { return cache.size; },
    getHistorySize() { return history.length; },
    stats() { return { ..._stats, cacheSize: cache.size, historySize: history.length }; },
    resetStats() { _stats = { cacheHits: 0, cacheMisses: 0, googleRequests: 0, msRequests: 0, legacyRequests: 0, totalChars: 0, failed: 0 }; },
  };
})();
