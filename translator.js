// file_name: translator.js
/* ============================================================
   translator.js — Google / Microsoft / Tencent / legacy fallback translate
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
  let settings = { targetLang: 'ru', engine: 'auto', autoTarget: true };
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
  let _bcChannel = null;
  let _activeController = null;
  let _inflightOne = new Map();
  let _stats = { cacheHits: 0, cacheMisses: 0, googleRequests: 0, msRequests: 0, tencentRequests: 0, legacyRequests: 0, totalChars: 0, failed: 0 };

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
  ];

  const LANG_BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));
  const ENGINES = new Set(['auto', 'google', 'microsoft', 'tencent', 'legacy']);
  const MS_LANG_MAP = { zh: 'zh-Hans', 'zh-TW': 'zh-Hant' };

  // ── Helpers ────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function fetchWithTimeout(url, options = {}, ms) {
    const ctrl = new AbortController();
    const external = options.signal;
    let timer;
    const abort = () => ctrl.abort(external.reason);
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

  const withTimeout = (p, ms, abortCtrl) => {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => {
        if (abortCtrl) abortCtrl.abort(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
        rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
      }, ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  };

  function countChars(texts) {
    return texts.reduce((s, t) => s + String(t || '').length, 0);
  }

  function normalizeTargetLang(v) {
    return LANG_BY_CODE[v] ? v : settings.targetLang;
  }

  const AUTO_LANG_PAIRS = { ru: 'en', en: 'ru' };

  function resolveTargetLang(text) {
    if (!settings.autoTarget) return settings.targetLang;
    const detected = detectLangHint(text);
    if (!detected || detected.code === 'mixed') return settings.targetLang;
    return AUTO_LANG_PAIRS[detected.code] || settings.targetLang;
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

  function protectTemplates(text) {
    const tokens = [];
    let i = 0;
    let ns = 0;

    while (text.includes(`\u27E6TRPL${ns}_`)) ns++;

    const prefix = `\u27E6TRPL${ns}_`;
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
          out = out.replace(re, () => t.original);
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
            .filter(([k, v]) =>
              typeof k === 'string' &&
              v && typeof v === 'object' &&
              typeof v.text === 'string' &&
              typeof v.ts === 'number' &&
              now - v.ts <= CACHE_TTL
            )
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
      let arr = [...cache.entries()].slice(-MAX_CACHE);
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(arr));
        _cacheDirty = false;
      } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
          // Drop 20% oldest entries and retry
          const dropCount = Math.max(10, Math.floor(arr.length * 0.2));
          arr = arr.slice(dropCount);
          cache = new Map(arr);
          try {
            storage.setItem(CACHE_KEY, JSON.stringify(arr));
            _cacheDirty = false;
          } catch {}
        }
      }
    } catch {}
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
      if (!v.text || typeof v.text !== 'string') {
        cache.delete(key);
        scheduleCacheSave();
        _stats.cacheMisses++;
        return undefined;
      }
      cache.delete(key);
      cache.set(key, v);
      _stats.cacheHits++;
      return v.text;
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
    if (_bcChannel) {
      try { _bcChannel.postMessage({ type: 'cache-set', key, text: translated, ts: Date.now() }); } catch {}
    }
  }

  // ── History ────────────────────────────────────────────────
  function loadHistory() {
    try {
      const storage = getStorage();
      const raw = storage?.getItem(HISTORY_KEY);
      if (raw && raw.length > 512 * 1024) {
        storage?.removeItem(HISTORY_KEY);
        history = [];
        return;
      }
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
    if (!original || !translated || original === translated) return;
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
        if (typeof s?.autoTarget === 'boolean') settings.autoTarget = s.autoTarget;
      }
    } catch {}
  }

  function saveSettings() {
    try {
      const storage = getStorage();
      storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }

  // ── Google fallback key ─────────────────────────────────────
  // Hardcoded backup key when dynamic key extraction fails
  const GOOGLE_FALLBACK_KEY = new TextDecoder().decode(new Uint8Array([
    65,73,122,97,83,121,65,84,66,88,97,106,118,122,81,76,
    84,68,72,69,81,98,99,112,113,48,73,104,101,48,118,87,
    68,72,109,79,53,50,48
  ]));

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
        googleKey = GOOGLE_FALLBACK_KEY;
        googleKeyTs = Date.now();
        return googleKey;
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        googleKeyError = e?.message || 'google key network error';
        googleKey = GOOGLE_FALLBACK_KEY;
        googleKeyTs = Date.now();
      }
      return GOOGLE_FALLBACK_KEY;
    })();
    try {
      return await googleKeyPromise;
    } finally {
      googleKeyPromise = null;
    }
  }

  function awaitWithSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([promise, aborted])
      .finally(() => signal.removeEventListener('abort', onAbort));
  }

  async function translateGoogle(texts, to, signal) {
    const key = await awaitWithSignal(fetchGoogleKey(), signal);
    if (!key) throw new Error(`Google auth failed${googleKeyError ? ': ' + googleKeyError : ''}`);
    _stats.googleRequests++;
    const CONCURRENCY = 3;
    const chunks = [];
    for (let i = 0; i < texts.length; i += 50) chunks.push(texts.slice(i, i + 50));
    const results = new Array(texts.length).fill(null);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < chunks.length) {
        if (signal?.aborted) break;
        const ci = next++;
        const chunk = chunks[ci];
        const offset = ci * 50;
        try {
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
            googleKey = null; googleKeyTs = 0;
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
          const data = await r.json();
          const rows = Array.isArray(data?.[0]) ? data[0] : [];
          for (let j = 0; j < chunk.length; j++) {
            const v = rows[j];
            results[offset + j] = v ? decodeHtmlEntities(String(v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : null;
          }
        } catch (e) {
          if (e?.status === 401 || e?.status === 403 || e?.status === 429) { stop = true; throw e; }
          for (let j = 0; j < chunk.length; j++) results[offset + j] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
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
    const tg = MS_LANG_MAP[to] || to;
    const CONCURRENCY = 3;
    const chunks = [];
    for (let i = 0; i < texts.length; i += 100) chunks.push(texts.slice(i, i + 100));
    const results = new Array(texts.length).fill(null);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < chunks.length) {
        if (signal?.aborted) break;
        const ci = next++;
        const chunk = chunks[ci];
        const offset = ci * 100;
        try {
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
          const data = await r.json();
          const rows = Array.isArray(data) ? data : [];
          for (let j = 0; j < chunk.length; j++) {
            results[offset + j] = decodeHtmlEntities(rows[j]?.translations?.[0]?.text || null);
          }
        } catch (e) {
          if (e?.status === 401 || e?.status === 403 || e?.status === 429) { stop = true; throw e; }
          for (let j = 0; j < chunk.length; j++) results[offset + j] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    return results;
  }

  // ── Tencent API ─────────────────────────────────────────────
  let tFail = 0, tBlockUntil = 0;

  function tencentClientKey() {
    const k = 'browser-chrome-120.0-Windows_10-' + crypto.randomUUID() + '-' + Date.now();
    tencentClientKey = () => k;
    return k;
  }

  const TENCENT_LANG_MAP = { 'zh': 'zh', 'zh-TW': 'zh-TW' };

  async function translateTencent(texts, to, signal) {
    _stats.tencentRequests++;
    const tg = TENCENT_LANG_MAP[to] || to;
    const CONCURRENCY = 3;
    const chunks = [];
    for (let i = 0; i < texts.length; i += 50) chunks.push(texts.slice(i, i + 50));
    const results = new Array(texts.length).fill(null);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < chunks.length) {
        if (signal?.aborted) break;
        const ci = next++;
        const chunk = chunks[ci];
        const offset = ci * 50;
        try {
          const r = await fetchWithTimeout(
            'https://transmart.qq.com/api/imt',
            {
              method: 'POST',
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                header: { fn: 'auto_translation', session: '', client_key: tencentClientKey(), user: '' },
                type: 'plain',
                model_category: 'normal',
                text_domain: 'general',
                source: { lang: 'auto', text_list: chunk },
                target: { lang: tg },
              }),
              signal,
            },
            MS_TIMEOUT
          );
          if (!r.ok) throw Object.assign(new Error(`tencent http ${r.status}`), { status: r.status });
          const data = await r.json();
          const out = data?.auto_translation;
          if (Array.isArray(out)) {
            for (let j = 0; j < chunk.length; j++) {
              results[offset + j] = out[j] || null;
            }
          }
        } catch (e) {
          if (e?.name === 'AbortError' || signal?.aborted) throw e;
          stop = true;
          throw e;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
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
    const CONCURRENCY = 5;
    const out = new Array(texts.length).fill(null);
    let next = 0;
    let stop = false;
    let rateLimitError = null;
    const worker = async () => {
      while (!stop && next < texts.length) {
        if (signal?.aborted) break;
        const i = next++;
        try {
          out[i] = await retry(() => translateLegacyOne(texts[i], to, signal), e => e?.status !== 429 && e?.name !== 'AbortError', 2, 500);
        } catch (e) {
          if (e?.status === 429) { stop = true; rateLimitError = e; }
          out[i] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker));
    if (rateLimitError) throw rateLimitError;
    return out;
  }

  // ── Main translate pipeline ────────────────────────────────
  async function translate(texts, toLang) {
    if (!Array.isArray(texts)) texts = texts == null ? [] : [String(texts)];
    if (!texts.length) return [];
    _stats.totalChars += countChars(texts);
    if (_activeController) _activeController.abort();
    _activeController = new AbortController();
    const signal = _activeController.signal;
    if (!toLang) toLang = resolveTargetLang(texts[0] || '');
    else toLang = normalizeTargetLang(toLang);
    const out = new Array(texts.length).fill(null);
    const pendingByNorm = new Map();

    texts.forEach((t, i) => {
      const n = norm(t);
      if (!n) return;
      if (!needsTranslation(n, toLang)) {
        out[i] = t;
        return;
      }
      const c = cacheGet(n, toLang);
      if (c !== undefined) { out[i] = c; return; }
      let byRaw = pendingByNorm.get(n);
      if (!byRaw) { byRaw = new Map(); pendingByNorm.set(n, byRaw); }
      const raw = String(t);
      const existing = byRaw.get(raw);
      if (existing) existing.indices.push(i);
      else byRaw.set(raw, { raw: t, key: n, indices: [i] });
    });

    const todo = [...pendingByNorm.values()].flatMap(byRaw => [...byRaw.values()]);
    if (!todo.length) return out;

    const engine = settings.engine;
    let rem = todo.map((x, i) => ({ t: x.raw, key: x.key, i, indices: x.indices }));

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
          for (const oi of src[j].indices) out[oi] = tr;
        }
      }
    };

    const filterRem = (arr, src) => src.filter((x, j) => {
      return !accept(arr[j], x);
    });

    const applyIfEmpty = (arr, src) => {
      for (let j = 0; j < src.length; j++) {
        const tr = arr[j];
        if (out[src[j].indices[0]] == null && accept(tr, src[j])) {
          cacheSet(src[j].key, toLang, tr);
          for (const oi of src[j].indices) if (out[oi] == null) out[oi] = tr;
        }
      }
    };
    const refreshRem = src => src.filter(x => out[x.indices[0]] == null);

    const runMsTencent = async (src) => {
      const mReady = Date.now() >= mBlockUntil;
      const tReady = Date.now() >= tBlockUntil;
      if (!mReady && !tReady) return;
      const textsForEngines = src.map(x => x.t);
      const candidates = [];
      if (mReady) candidates.push(
        translateMs(textsForEngines, toLang, signal)
          .then(result => ({ engine: 'ms', result }))
          .catch(error => ({ engine: 'ms', error }))
      );
      if (tReady) candidates.push(
        translateTencent(textsForEngines, toLang, signal)
          .then(result => ({ engine: 'tc', result }))
          .catch(error => ({ engine: 'tc', error }))
      );
      for (const s of await Promise.all(candidates)) {
        if (s.error) {
          if (s.error?.name === 'AbortError' || signal.aborted) throw s.error;
          _stats.failed++;
          if (s.engine === 'ms') {
            mFail++;
            if (s.error?.retryAfterMs) mBlockUntil = Date.now() + s.error.retryAfterMs;
            else if (mFail >= 3) mBlockUntil = Date.now() + 3 * 60 * 1000;
          }
          if (s.engine === 'tc') {
            tFail++;
            if (tFail >= 3) tBlockUntil = Date.now() + 3 * 60 * 1000;
          }
          continue;
        }
        if (s.engine === 'ms') mFail = 0;
        else if (s.engine === 'tc') tFail = 0;
        if (!s.result.every(v => !v)) applyIfEmpty(s.result, src);
      }
    };

    // ── Auto mode ──
    if (engine === 'auto') {
      let gPromise = null;
      let gSrc = null;
      let gCtrl = null;

      // Google head start
      if (rem.length && Date.now() >= gBlockUntil) {
        gSrc = rem;
        gCtrl = new AbortController();
        const gSignal = gCtrl.signal;
        const onParentAbort = () => gCtrl.abort();
        if (signal.aborted) gCtrl.abort();
        else signal.addEventListener('abort', onParentAbort, { once: true });
        gPromise = translateGoogle(gSrc.map(x => x.t), toLang, gSignal)
          .catch(e => {
            if (e?.name === 'AbortError' || gSignal.aborted || signal.aborted) return null;
            gFail++;
            _stats.failed++;
            if (e?.retryAfterMs) gBlockUntil = Date.now() + e.retryAfterMs;
            else if (gFail >= 3) gBlockUntil = Date.now() + 5 * 60 * 1000;
            return { _err: true };
          })
          .finally(() => signal.removeEventListener('abort', onParentAbort));
        const gQuick = await Promise.race([
          gPromise.then(r => ({ done: true, r })),
          sleep(1200).then(() => ({ done: false }))
        ]);

        if (gQuick.done) {
          if (gQuick.r && !gQuick.r._err && gQuick.r.length && !gQuick.r.every(v => !v)) {
            applyIfEmpty(gQuick.r, gSrc);
            gFail = 0;
          } else if (!gQuick.r?._err) {
            gFail++;
            if (gFail >= 3) gBlockUntil = Date.now() + 5 * 60 * 1000;
          }
          rem = refreshRem(gSrc);
          gPromise = null; // already consumed
        }
        // else: Google slow, gPromise still pending — MS/Tencent will run below
      }

      // MS/Tencent parallel for remaining (always, regardless of Google status)
      if (rem.length) {
        await runMsTencent(rem);
        rem = refreshRem(gSrc || rem);
      }

      // Abort Google if everything is covered
      if (gCtrl && gPromise && !rem.length) {
        gCtrl.abort(Object.assign(new Error('covered'), { code: 'COVERED' }));
        gPromise = null;
      }

      // Wait for Google if it's still running and there are remaining items
      if (gPromise && rem.length) {
        const gResult = await gPromise;
        if (gResult && gResult.length && !gResult.every(v => !v)) {
          applyIfEmpty(gResult, gSrc);
          gFail = 0;
        }
        rem = refreshRem(gSrc);
      }

    // ── Explicit engine ──
    } else if (engine === 'google') {
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
      return out.map((v, i) => v == null ? texts[i] : v);
    } else {
      if ((engine === 'microsoft') && rem.length && Date.now() >= mBlockUntil) {
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
        return out.map((v, i) => v == null ? texts[i] : v);
      }
      if ((engine === 'tencent') && rem.length && Date.now() >= tBlockUntil) {
        try {
          const tc = await translateTencent(rem.map(x => x.t), toLang, signal);
          tFail = 0;
          if (!tc.every(v => !v)) { apply(tc, rem); rem = filterRem(tc, rem); }
        } catch (e) {
          if (e?.name === 'AbortError' || signal.aborted) throw e;
          tFail++;
          _stats.failed++;
          if (tFail >= 3) tBlockUntil = Date.now() + 3 * 60 * 1000;
        }
        return out.map((v, i) => v == null ? texts[i] : v);
      }
    }
    if ((engine === 'legacy' || engine === 'auto') && rem.length && (engine === 'legacy' || Date.now() >= lBlockUntil)) {
      try {
        const l = await translateLegacy(rem.map(x => x.t), toLang, signal);
        lFail = 0;
        apply(l, rem);
      } catch (e) {
        if (e?.name === 'AbortError' || signal.aborted) throw e;
        lFail++;
        if (e?.retryAfterMs) lBlockUntil = Date.now() + e.retryAfterMs;
        else if (lFail >= 3) lBlockUntil = Date.now() + 3 * 60 * 1000;
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

  async function translateOneVisible(text, toLang) {
    const target = toLang ? normalizeTargetLang(toLang) : resolveTargetLang(text);
    const n = norm(text);
    if (!n) return null;
    const cached = cacheGet(n, target);
    if (cached !== undefined) return cached;

    const key = cacheKey(n, target);
    if (_inflightOne.has(key)) return _inflightOne.get(key);

    const promise = _doTranslateOneVisible(text, n, target, key);
    _inflightOne.set(key, promise);
    return promise;
  }

  async function _doTranslateOneVisible(text, n, target, key) {
    try {
      const accept = (tr) => {
        if (!tr || !tr.trim()) return false;
        if (norm(tr) === n && needsTranslation(n, target)) return false;
        return true;
      };

      const promises = [];
      const gReady = Date.now() >= gBlockUntil;
      const mReady = Date.now() >= mBlockUntil;
      const tReady = Date.now() >= tBlockUntil;
      const controllers = [];
      const sel = settings.engine;

      function pushEngine(fn, ms, engine) {
        const ctrl = new AbortController();
        controllers.push(ctrl);
        promises.push(
          withTimeout(fn(ctrl.signal), ms, ctrl)
            .then(r => ({ engine, result: r?.[0] }))
            .catch(error => ({ engine, result: null, error }))
        );
      }

      if (gReady && (sel === 'auto' || sel === 'google')) pushEngine(signal => translateGoogle([text], target, signal), GOOGLE_TIMEOUT, 'g');
      if (mReady && (sel === 'auto' || sel === 'microsoft')) pushEngine(signal => translateMs([text], target, signal), MS_TIMEOUT, 'ms');
      if (tReady && (sel === 'auto' || sel === 'tencent')) pushEngine(signal => translateTencent([text], target, signal), 12000, 'tc');
      if (!promises.length) {
        if (sel !== 'auto' && sel !== 'legacy') return text;
        try {
          const l = await translateLegacy([text], target);
          if (l?.[0] && accept(l[0])) { cacheSet(n, target, l[0]); return l[0]; }
        } catch {}
        return text;
      }

      const usablePromises = promises.map(p =>
        p.then(res => {
          if (res?.result && accept(res.result)) return res;
          throw new Error('empty translation');
        })
      );

      const res = await Promise.any(usablePromises).catch(() => null);
      if (res?.result && accept(res.result)) {
        controllers.forEach(c => c.abort(Object.assign(new Error('done'), { code: 'DONE' })));
        if (res.engine === 'g') gFail = 0;
        else if (res.engine === 'ms') mFail = 0;
        else if (res.engine === 'tc') tFail = 0;
        cacheSet(n, target, res.result);
        return res.result;
      }

      // Track errors from all engines
      const allResults = await Promise.all(promises);
      for (const r of allResults) {
        const failedResult = r.error || !r.result || !accept(r.result);
        if (!failedResult) continue;
        _stats.failed++;
        if (r.engine === 'g') {
          gFail++;
          if (r.error?.retryAfterMs) gBlockUntil = Date.now() + r.error.retryAfterMs;
          else if (gFail >= 3) gBlockUntil = Date.now() + 5 * 60 * 1000;
        }
        if (r.engine === 'ms') {
          mFail++;
          if (r.error?.retryAfterMs) mBlockUntil = Date.now() + r.error.retryAfterMs;
          else if (mFail >= 3) mBlockUntil = Date.now() + 3 * 60 * 1000;
        }
        if (r.engine === 'tc') {
          tFail++;
          if (tFail >= 3) tBlockUntil = Date.now() + 3 * 60 * 1000;
        }
      }

      // Fallback: legacy для непереведённых (только в auto)
      if (sel === 'auto') {
        controllers.forEach(c => c.abort(Object.assign(new Error('fallback'), { code: 'FALLBACK' })));
        try {
          const l = await translateLegacy([text], target);
          if (l?.[0] && accept(l[0])) { cacheSet(n, target, l[0]); return l[0]; }
        } catch {}
      }

      return text;
    } finally {
      _inflightOne.delete(key);
    }
  }

  async function translateOne(text, toLang) {
    const target = toLang ? normalizeTargetLang(toLang) : resolveTargetLang(text);
    if (!needsTranslation(text, target)) return text;
    const translated = settings.engine === 'auto' || settings.engine === 'google' || settings.engine === 'microsoft' || settings.engine === 'tencent'
      ? await translateOneVisible(text, toLang)
      : await translateOneRaw(text, toLang);
    if (translated && translated !== text) {
      const from = detectLangHint(text)?.code || 'auto';
      addHistory(text, translated, from, target);
    }
    return translated || text;
  }

  // ── Translate with template protection ─────────────────────
  async function translateProtected(text, toLang) {
    if (!text?.trim()) return text;
    const target = toLang ? normalizeTargetLang(toLang) : resolveTargetLang(text);
    const { text: safe, tokens } = protectTemplates(text);
    const result = await translateOneRaw(safe, target);
    if (!result) {
      _stats.failed++;
      return text;
    }
    const restored = restoreTemplates(result, tokens);
    if (restored !== text) {
      const from = detectLangHint(text)?.code || 'auto';
      addHistory(text, restored, from, target);
    }
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

    get autoTarget() { return settings.autoTarget; },
    set autoTarget(v) {
      settings.autoTarget = !!v;
      saveSettings();
    },

    resolveTargetLang,

    get history() { return history.map(item => ({ ...item })); },

    init() {
      if (_inited) return;
      _inited = true;
      loadCache();
      loadHistory();
      loadSettings();
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          _bcChannel = new BroadcastChannel('tr-cache-sync');
          _bcChannel.onmessage = e => {
            const d = e.data;
            if (
              d?.type !== 'cache-set' ||
              typeof d.key !== 'string' ||
              d.key.length > MAX_CACHE_TEXT_LEN + 16 ||
              typeof d.text !== 'string' ||
              d.text.length > MAX_CACHE_TEXT_LEN ||
              !Number.isFinite(d.ts)
            ) return;
            cache.delete(d.key);
            cache.set(d.key, { text: d.text, ts: d.ts });
            while (cache.size > MAX_CACHE) {
              cache.delete(cache.keys().next().value);
            }
            scheduleCacheSave();
          };
        } catch {}
      }
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
      try { getStorage()?.removeItem(CACHE_KEY); } catch {}
    },
    clearHistory() { history = []; saveHistory(); },

    getCacheSize() { return cache.size; },
    getHistorySize() { return history.length; },
    stats() { return { ..._stats, cacheSize: cache.size, historySize: history.length }; },
    resetStats() { _stats = { cacheHits: 0, cacheMisses: 0, googleRequests: 0, msRequests: 0, tencentRequests: 0, legacyRequests: 0, totalChars: 0, failed: 0 }; },
  };
})();
