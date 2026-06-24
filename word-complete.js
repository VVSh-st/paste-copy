// file_name: word-complete.js
'use strict';

/* ============================================================
   WordDict — частотный словарь + биграммы
   ============================================================ */
const WordDict = (() => {

  const wordFreq = new Map();
  const bigrams  = new Map();
  let buildTimer = null;

  const cfg = {
    enabled: true,
    minLen: 3,
    maxSuggest: 3,
    acceptEffect: true,
    acceptEffectMs: 3500,
  };

  const _staticWords   = new Map();
  const _staticBigrams = new Map();

  // Накопленные пользовательские слова: word → суммарная частота за все сессии.
  // Пополняется только через _loadTempWordlist() и явно при build(),
  // но НЕ суммируется повторно при каждом build() — иначе частоты росли бы бесконечно.
  const _dynWords = new Map();

  const KEY_TEMP        = 'wordlist-temp';
  const TEMP_INTERVAL   = 2 * 60 * 60 * 1000;
  const PROMPT_INIT_MS  = 4000;
  const PROMPT_RETRY_MS = 60 * 60 * 1000;

  let _saveInterval    = null;
  let _fsHandle        = null;
  let _promptTimer     = null;
  let _tempSaveEnabled = true;

  /* ---- токенизация ---- */
  function tokenize(text) {
    if (!text) return [];
    return text.split(/[^\p{L}\p{N}']+/u)
      .map(w => w.toLowerCase().replace(/^'+|'+$/g, ''))
      .filter(w => w.length >= 2);
  }

  /* ---- сбор текстов из блоков состояния ---- */
  function collectTexts(blocks, out) {
    if (!Array.isArray(blocks)) return;

    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;

      if (b.type === 'text') {
        (b.subtabs || []).forEach(st => { if (st?.value) out.push(st.value); });
      } else if (b.type === 'snippets') {
        (b.items || []).forEach(i => { if (i?.value) out.push(i.value); });
      } else if (b.type === 'group') {
        collectTexts(b.children, out);
      }
    }
  }

  /* ---- перестройка словаря в памяти ---- */
  function build() {
    wordFreq.clear();
    bigrams.clear();
    _seedFromStatic();

    // _dynWords отражает накопленный межсессионный словарь — вносим как базу,
    // но не трогаем сами _dynWords здесь, чтобы не было бесконечного роста.
    for (const [w, freq] of _dynWords) {
      if (!_staticWords.has(w))
        wordFreq.set(w, (wordFreq.get(w) || 0) + freq);
    }

    const activeId = State.getActive()?.id;

    // Временный счётчик текущего прохода — только для обновления _dynWords
    const sessionCounts = new Map();

    State.getAll().forEach(tab => {
      const mult  = tab.id === activeId ? 2 : 1;
      const texts = [];
      collectTexts(tab.blocks, texts);

      texts.forEach(text => {
        const words = tokenize(text);
        words.forEach((w, i) => {
          wordFreq.set(w, (wordFreq.get(w) || 0) + mult);

          if (!_staticWords.has(w) && w.length >= cfg.minLen)
            sessionCounts.set(w, (sessionCounts.get(w) || 0) + mult);

          if (i > 0) {
            const prev = words[i - 1];
            if (!bigrams.has(prev)) bigrams.set(prev, new Map());
            const bm = bigrams.get(prev);
            bm.set(w, (bm.get(w) || 0) + mult);
          }
        });
      });
    });

    // Обновляем _dynWords только до максимума между накопленным и текущим проходом,
    // чтобы частоты отражали реальную встречаемость, а не суммировались бесконечно.
    for (const [w, cnt] of sessionCounts)
      _dynWords.set(w, Math.max(_dynWords.get(w) || 0, cnt));
  }

  function scheduleBuild() {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(build, 500);
  }

  /* ---- подсказки по префиксу ---- */
  const STATIC_BOOST = 10000;

  function suggest(prefix) {
    if (!cfg.enabled || !prefix || prefix.length < cfg.minLen) return [];
    const p   = prefix.toLowerCase();
    const out = [];

    for (const [w, freq] of wordFreq) {
      if (w.length > p.length && w.startsWith(p))
        out.push({ w, effective: freq + (_staticWords.has(w) ? STATIC_BOOST : 0) });
    }

    out.sort((a, b) => b.effective - a.effective);
    return out.slice(0, cfg.maxSuggest).map(x => x.w);
  }

  function suggestNext(prevWord) {
    if (!cfg.enabled || !prevWord) return null;
    const bm = bigrams.get(prevWord.toLowerCase());
    if (!bm?.size) return null;
    let best = null, max = 0;
    for (const [w, c] of bm) if (c > max) { best = w; max = c; }
    return best;
  }

  function getConfig() { return cfg; }
  function setConfig(patch) { Object.assign(cfg, patch); }

  function getTempSaveEnabled() { return _tempSaveEnabled; }
  function setTempSaveEnabled(v) {
    _tempSaveEnabled = !!v;
    if (!v) {
      clearInterval(_saveInterval); _saveInterval = null;
      clearTimeout(_promptTimer);   _promptTimer   = null;
      document.getElementById('wdict-file-prompt')?.remove();
    } else {
      _startAutoSave();
      _scheduleFileHandlePrompt(PROMPT_INIT_MS);
    }
  }

  /* ---- заполнение wordFreq/bigrams из статических карт ---- */
  function _seedFromStatic() {
    for (const [w, freq] of _staticWords) {
      if (typeof freq !== 'number' || !Number.isFinite(freq) || freq <= 0) continue;
      wordFreq.set(w, (wordFreq.get(w) || 0) + freq);
    }

    for (const [prev, followers] of _staticBigrams) {
      if (!bigrams.has(prev)) bigrams.set(prev, new Map());
      const bm = bigrams.get(prev);
      for (const [w, c] of followers) {
        if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
        bm.set(w, (bm.get(w) || 0) + c);
      }
    }
  }

  /* ---- загрузка wordlist.json (статический, высший приоритет) ---- */
  async function loadWordlist(url = 'wordlist.json') {
    // Браузер блокирует fetch() на file://-origin (CORS null-origin).
    if (location.protocol === 'file:') {
      console.debug('[WordDict] file:// origin — wordlist.json fetch skipped (CORS)');
      _loadTempWordlist();
      build();
      return;
    }

    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.debug(`[WordDict] wordlist.json not found (HTTP ${r.status})`);
        return;
      }

      const data = await r.json();

      if (Array.isArray(data.words)) {
        for (const item of data.words) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const w = String(item[0] || '').trim().toLowerCase();
          const freq = Number(item[1]);
          if (!w || !Number.isFinite(freq) || freq <= 0) continue;
          _staticWords.set(w, (_staticWords.get(w) || 0) + freq);
        }
      }

      if (data.bigrams && typeof data.bigrams === 'object') {
        for (const [rawPrev, followers] of Object.entries(data.bigrams)) {
          if (!followers || typeof followers !== 'object') continue;
          const prev = String(rawPrev || '').trim().toLowerCase();
          if (!prev) continue;
          if (!_staticBigrams.has(prev)) _staticBigrams.set(prev, new Map());
          const bm = _staticBigrams.get(prev);
          for (const [rawW, rawC] of Object.entries(followers)) {
            const w = String(rawW || '').trim().toLowerCase();
            const c = Number(rawC);
            if (!w || !Number.isFinite(c) || c <= 0) continue;
            bm.set(w, (bm.get(w) || 0) + c);
          }
        }
      }

    } catch (e) {
      if (e instanceof TypeError) {
        console.debug('[WordDict] wordlist.json not available:', e.message);
      } else {
        console.warn('[WordDict] failed to load wordlist:', e);
      }
    } finally {
      _loadTempWordlist();
      build();
    }
  }

  /* ---- временный словарь: персистентность через localStorage ---- */
  function _loadTempWordlist() {
    try {
      const raw = localStorage.getItem(KEY_TEMP);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.words)) return;
      for (const item of data.words) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const w = String(item[0] || '').trim().toLowerCase();
        const freq = Number(item[1]);
        if (!w || _staticWords.has(w)) continue;
        if (!Number.isFinite(freq) || freq < 2) continue;
        _dynWords.set(w, Math.max(_dynWords.get(w) || 0, freq));
      }
    } catch (e) {
      console.warn('[WordDict] failed to load temp wordlist from localStorage:', e);
    }
  }

  function _buildTempPayload() {
    const words = [..._dynWords.entries()]
      .filter(([w, freq]) =>
        !_staticWords.has(w) &&
        w.length >= cfg.minLen &&
        typeof freq === 'number' &&
        freq >= 2
      )
      .sort((a, b) => b[1] - a[1]);

    if (!words.length) return null;

    return JSON.stringify({
      meta: {
        schemaVersion: 1,
        generatedAt:   new Date().toISOString(),
        source:        'user-session',
        words_count:   words.length,
        note: 'Auto-generated by WordDict. Contains only words NOT present in wordlist.json.',
      },
      words,
    }, null, 2);
  }

  function _saveTempToLocalStorage(payload) {
    try {
      const p = payload ?? _buildTempPayload();
      if (p) localStorage.setItem(KEY_TEMP, p);
    } catch (e) {
      console.warn('[WordDict] failed to save temp wordlist to localStorage:', e);
    }
  }

  async function _tryWriteToHandle(content) {
    if (!_fsHandle) return;
    try {
      const writable = await _fsHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (_) { /* некритично */ }
  }

  /* ---- периодическое автосохранение ---- */
  function _startAutoSave() {
    clearInterval(_saveInterval);
    _saveInterval = null;
    if (!_tempSaveEnabled) return;
    _saveInterval = setInterval(async () => {
      const payload = _buildTempPayload();
      if (!payload) return;
      _saveTempToLocalStorage(payload);
      await _tryWriteToHandle(payload);
    }, TEMP_INTERVAL);
  }

  /* ---- ручной экспорт ---- */
  async function exportTempWordlist() {
    const payload = _buildTempPayload();
    if (!payload) return false;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'wordlist_temp.json',
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        });
        _fsHandle = handle;
        const writable = await handle.createWritable();
        await writable.write(payload);
        await writable.close();
        _saveTempToLocalStorage(payload);
        return true;
      } catch (_) { /* пользователь отменил */ }
    }

    // Fallback: скачивание через <a>
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url, download: 'wordlist_temp.json',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    _saveTempToLocalStorage(payload);
    return true;
  }

  /* ---- баннер-запрос на выбор файла ---- */
  function _createPromptBanner() {
    const el = document.createElement('div');
    el.id = 'wdict-file-prompt';
    Object.assign(el.style, {
      position:     'fixed',
      bottom:       '70px',
      left:         '50%',
      transform:    'translateX(-50%)',
      background:   'var(--bg3)',
      border:       '1px solid var(--border2)',
      borderRadius: '99px',
      padding:      '8px 14px',
      display:      'flex',
      alignItems:   'center',
      gap:          '8px',
      fontSize:     '12px',
      color:        'var(--text1)',
      boxShadow:    'var(--shadow-lg)',
      zIndex:       '1999',
      userSelect:   'none',
      whiteSpace:   'nowrap',
    });

    const msg = document.createElement('span');
    msg.textContent = '💾 Сохранять подсказки в файл для ускорения?';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Выбрать файл';
    Object.assign(saveBtn.style, {
      background:   'rgba(79,142,247,0.13)',
      border:       '1px solid rgba(79,142,247,0.33)',
      color:        'var(--accent)',
      padding:      '4px 12px',
      borderRadius: '99px',
      cursor:       'pointer',
      fontFamily:   'inherit',
      fontSize:     '11px',
      fontWeight:   '600',
    });

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.textContent = '✕';
    Object.assign(skipBtn.style, {
      background: 'transparent',
      border:     'none',
      color:      'var(--text3)',
      cursor:     'pointer',
      fontSize:   '13px',
      padding:    '0 3px',
      lineHeight: '1',
    });

    el.append(msg, saveBtn, skipBtn);

    saveBtn.onclick = async () => {
      el.remove();
      const ok = await exportTempWordlist();
      if (!ok || !_fsHandle) _scheduleFileHandlePrompt(PROMPT_RETRY_MS);
    };
    skipBtn.onclick = () => {
      el.remove();
      _scheduleFileHandlePrompt(PROMPT_RETRY_MS);
    };

    return el;
  }

  function _scheduleFileHandlePrompt(delay) {
    clearTimeout(_promptTimer);
    if (!_tempSaveEnabled) return;
    _promptTimer = setTimeout(() => {
      if (!_tempSaveEnabled || _fsHandle) return;
      if (!_dynWords.size) { _scheduleFileHandlePrompt(PROMPT_RETRY_MS); return; }
      if (!window.showSaveFilePicker) return;
      if (document.getElementById('wdict-file-prompt')) return;
      document.body.appendChild(_createPromptBanner());
    }, delay);
  }

  /* ---- инициализация ---- */
  // Требование: скрипт должен загружаться с defer или в конце <body>,
  // чтобы document.body существовал на момент исполнения IIFE.
  loadWordlist();
  _startAutoSave();
  window.addEventListener('beforeunload', () => _saveTempToLocalStorage());
  _scheduleFileHandlePrompt(PROMPT_INIT_MS);

  return {
    build, scheduleBuild,
    suggest, suggestNext,
    getConfig, setConfig,
    getTempSaveEnabled, setTempSaveEnabled,
    loadWordlist,
    exportTempWordlist,
  };
})();


/* ============================================================
   InlineHint — призрачная подсказка у каретки (position:fixed)
   Требование: скрипт загружается после появления document.body
   (defer / конец <body>).
   ============================================================ */
const InlineHint = (() => {
  const MIRROR_PROPS = [
    'boxSizing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant',
    'letterSpacing', 'wordSpacing', 'lineHeight',
    'textIndent', 'textTransform', 'tabSize', 'MozTabSize',
    'wordBreak', 'overflowWrap',
  ];

  const mirrorEl = document.createElement('div');
  Object.assign(mirrorEl.style, {
    position:   'absolute',
    visibility: 'hidden',
    top:        '-9999px',
    left:       '-9999px',
    overflow:   'auto',
    whiteSpace: 'pre-wrap',
    wordWrap:   'break-word',
    border:     'none',
    margin:     '0',
  });
  document.body.appendChild(mirrorEl);

  const hintEl = document.createElement('div');
  hintEl.id = 'inline-hint';
  hintEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(hintEl);

  // Кэш вычисленных стилей textarea, ключ — комбинация значимых свойств
  const _styleCache = new WeakMap();

  function syncMirror(ta) {
    const cs       = window.getComputedStyle(ta);
    const cacheKey = `${cs.fontSize}|${cs.paddingTop}|${cs.lineHeight}|${ta.clientWidth}`;
    let cached     = _styleCache.get(ta);

    if (!cached || cached.key !== cacheKey) {
      const styles = {};
      MIRROR_PROPS.forEach(p => { styles[p] = cs[p]; });
      cached = { styles, key: cacheKey };
      _styleCache.set(ta, cached);
    }

    Object.assign(mirrorEl.style, cached.styles);
    mirrorEl.style.width = ta.clientWidth + 'px';
  }

  function getCaretXY(ta, pos) {
    syncMirror(ta);

    const before = document.createTextNode(ta.value.slice(0, pos));
    const marker = document.createElement('span');
    marker.style.cssText =
      'display:inline-block;width:0;height:0;overflow:hidden;vertical-align:top;';

    mirrorEl.replaceChildren(before, marker);
    mirrorEl.scrollTop  = ta.scrollTop;
    mirrorEl.scrollLeft = ta.scrollLeft;

    const dRect = mirrorEl.getBoundingClientRect();
    const mRect = marker.getBoundingClientRect();

    return { x: mRect.left - dRect.left, y: mRect.top - dRect.top };
  }

  // Без горизонтального зазора: ghost и overlay совпадают с реальной точкой вставки.
  const HINT_OFFSET_X = 0;

  let suffix   = '';
  let activeTa = null;
  let composing = false;
  let _visible  = false;
  let _insertLeft = 0;

  function show(ta, suf) {
    if (!suf || !ta) { hide(); return; }
    suffix   = suf;
    activeTa = ta;

    const cs    = window.getComputedStyle(ta);
    const rect  = ta.getBoundingClientRect();
    const bordL = parseFloat(cs.borderLeftWidth)   || 0;
    const bordT = parseFloat(cs.borderTopWidth)    || 0;
    const bordB = parseFloat(cs.borderBottomWidth) || 0;
    const paddT = parseFloat(cs.paddingTop)        || 0;
    const paddB = parseFloat(cs.paddingBottom)     || 0;

    const fontSize = parseFloat(cs.fontSize) || 12;
    const lineH    = parseFloat(cs.lineHeight) || fontSize * 1.4;

    const caret = getCaretXY(ta, ta.selectionStart);
    const insertX = Math.round(rect.left + bordL + caret.x);
    const rawX  = insertX + HINT_OFFSET_X;
    const rawY  = Math.round(rect.top  + bordT + caret.y);

    const visTop = rect.top    + bordT + paddT;
    const visBot = rect.bottom - bordB - paddB;
    if (rawY < visTop - 2 || rawY + lineH > visBot + 2) { hide(); return; }

    Object.assign(hintEl.style, {
      fontFamily:    cs.fontFamily,
      fontSize:      cs.fontSize,
      fontWeight:    cs.fontWeight,
      lineHeight:    cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      left:          rawX + 'px',
      top:           rawY + 'px',
      maxWidth:      Math.max(0, rect.right - rawX - 4) + 'px',
      display:       'block',
    });
    hintEl.textContent = suf;
    _insertLeft = insertX;
    _visible = true;
  }

  function hide() {
    hintEl.style.display = 'none';
    suffix   = '';
    activeTa = null;
    _insertLeft = 0;
    _visible = false;
  }

  function isVisible()   { return _visible; }
  function getSuffix()   { return suffix; }
  function getActiveTa() { return activeTa; }

  function getSnapshot() {
    if (!_visible || !activeTa || !suffix) return null;
    const rect = hintEl.getBoundingClientRect();
    const cs = window.getComputedStyle(hintEl);
    return {
      ta: activeTa,
      suffix,
      left: rect.left,
      insertLeft: _insertLeft,
      top: rect.top,
      hintOffsetX: HINT_OFFSET_X,
      maxWidth: hintEl.style.maxWidth,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
    };
  }

  document.addEventListener('compositionstart', () => { composing = true;  hide(); });
  document.addEventListener('compositionend',   () => { composing = false; });
  document.addEventListener('focusout', e => {
    if (e.target === activeTa) hide();
  }, true);
  window.addEventListener('resize', hide, { passive: true });
  window.addEventListener('scroll', hide, { passive: true, capture: true });

  return { show, hide, isVisible, getSuffix, getActiveTa, getSnapshot, isComposing: () => composing };
})();


/* ============================================================
   WordAcceptEffect — аккуратное проявление принятой подсказки
   ============================================================ */
const WordAcceptEffect = (() => {
  const SOFT_POOLS = {
    ruLower: 'аеинорстулкпмвыд',
    ruUpper: 'АЕИНОРСТУЛКПМВД',
    enLower: 'aeinorstlucmpd',
    enUpper: 'AEINORSTLUCMPD',
    digit:   '0123456789',
  };
  const timers = new WeakMap();
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  function clampMs(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 3500;
    const stepped = Math.round(n / 50) * 50;
    return Math.max(1000, Math.min(10000, stepped));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  }

  function charPool(ch) {
    if (/\p{Script=Cyrillic}/u.test(ch)) return ch === ch.toUpperCase() ? SOFT_POOLS.ruUpper : SOFT_POOLS.ruLower;
    if (/[A-Za-z]/.test(ch)) return ch === ch.toUpperCase() ? SOFT_POOLS.enUpper : SOFT_POOLS.enLower;
    if (/\d/.test(ch)) return SOFT_POOLS.digit;
    return '';
  }

  function revealGlyph(ch, phase) {
    if (/\s/.test(ch)) return ch;
    if (phase > 0.62 || Math.random() > 0.58) return ch;

    const pool = charPool(ch);
    if (!pool) return ch;
    return pool[Math.floor(Math.random() * pool.length)] || ch;
  }

  function measureChar(ch, snapshot) {
    if (!measureCtx || /\s/.test(ch)) return null;
    measureCtx.font = `${snapshot.fontWeight || '400'} ${snapshot.fontSize || '12px'} ${snapshot.fontFamily || 'monospace'}`;
    const w = measureCtx.measureText(ch).width;
    return Number.isFinite(w) && w > 0 ? Math.ceil(w * 100) / 100 : null;
  }

  function makePlan(text, duration) {
    const letters = [...text];
    const indexes = letters
      .map((ch, i) => (/\s/.test(ch) ? null : i))
      .filter(i => i !== null);

    indexes.sort(() => Math.random() - 0.5);

    const lockAt = new Map();
    const start = Math.min(90, duration * 0.22);
    const span = Math.max(80, duration * 0.5);
    indexes.forEach((i, order) => {
      const t = order / Math.max(1, indexes.length - 1);
      const jitter = (Math.random() - 0.5) * Math.min(70, duration * 0.12);
      lockAt.set(i, Math.max(35, Math.min(duration - 40, start + span * t + jitter)));
    });
    return { letters, lockAt };
  }

  function textareaBackground(ta) {
    const parseRgb = color => {
      const m = String(color || '').match(/^rgba?\(([^)]+)\)$/i);
      if (!m) return null;
      const parts = m[1].split(',').map(v => parseFloat(v.trim()));
      if (parts.length < 3 || parts.some((v, i) => i < 3 && !Number.isFinite(v))) return null;
      return {
        r: Math.max(0, Math.min(255, parts[0])),
        g: Math.max(0, Math.min(255, parts[1])),
        b: Math.max(0, Math.min(255, parts[2])),
        a: Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1,
      };
    };

    const blend = (fgColor, bgColor) => {
      const fg = parseRgb(fgColor);
      const bg = parseRgb(bgColor);
      if (!fg) return fgColor;
      if (fg.a >= 1 || !bg) return `rgb(${Math.round(fg.r)}, ${Math.round(fg.g)}, ${Math.round(fg.b)})`;
      const a = fg.a;
      return `rgb(${Math.round(fg.r * a + bg.r * (1 - a))}, ${Math.round(fg.g * a + bg.g * (1 - a))}, ${Math.round(fg.b * a + bg.b * (1 - a))})`;
    };

    const lineBg = ta
      ?.closest?.('.current-line-wrap.current-line-enabled')
      ?.querySelector?.('.current-line-highlight');
    if (lineBg) {
      const lineCs = window.getComputedStyle(lineBg);
      if (lineCs.backgroundColor && lineCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        const wrapBg = window.getComputedStyle(ta.closest('.current-line-wrap')).backgroundColor;
        return blend(lineCs.backgroundColor, wrapBg);
      }
    }

    const cs = window.getComputedStyle(ta);
    return cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? cs.backgroundColor
      : 'var(--bg0)';
  }

  function cleanup(ta) {
    const prev = timers.get(ta);
    if (!prev) return;
    cancelAnimationFrame(prev.raf);
    clearTimeout(prev.timer);
    prev.el?.remove();
    timers.delete(ta);
  }

  function play(snapshot, text, cfg) {
    if (!snapshot?.ta || !text || cfg?.acceptEffect === false || prefersReducedMotion()) return;

    const ta = snapshot.ta;
    cleanup(ta);

    const duration = clampMs(cfg?.acceptEffectMs);
    const cleanText = String(text).replace(/\s+$/u, '');
    if (!cleanText) return;

    const el = document.createElement('div');
    el.className = 'wc-accept-effect';
    el.setAttribute('aria-hidden', 'true');

    // Overlay стартует там же, где стояла подсказка: без скачка и двойного слова.
    const left = Number.isFinite(snapshot.left) ? snapshot.left : snapshot.insertLeft;

    Object.assign(el.style, {
      left: Math.round(left) + 'px',
      top: (snapshot.top + 0) + 'px', // - 1 поднимет Matrix-эффект на 1px, + 1 опустит
      maxWidth: snapshot.maxWidth || 'none',
      fontFamily: snapshot.fontFamily,
      fontSize: snapshot.fontSize,
      fontWeight: snapshot.fontWeight,
      lineHeight: (parseFloat(snapshot.lineHeight) - 1) + 'px',  // - 1 поднимет высоту букв/маски на 1px, + 1 опустит
      letterSpacing: snapshot.letterSpacing,
    });
    el.style.setProperty('--wc-mask-bg', textareaBackground(ta));

    const { letters, lockAt } = makePlan(cleanText, duration);
    const spans = letters.map(ch => {
      const span = document.createElement('span');
      const isSpace = /\s/.test(ch);
      span.className = isSpace ? 'wc-accept-space' : 'wc-accept-letter';
      span.textContent = isSpace ? ch : revealGlyph(ch, 0);

      // Маска скрывает уже вставленную букву под overlay без общей плашки.
      const w = measureChar(ch, snapshot);
      if (w) span.style.width = w + 'px';

      el.appendChild(span);
      return span;
    });

    document.body.appendChild(el);

    const start = performance.now();
    let lastTick = 0;
    const state = { raf: 0, timer: 0, el };
    timers.set(ta, state);

    function frame(now) {
      const elapsed = now - start;
      const done = elapsed >= duration;
      const shouldTick = elapsed - lastTick > 34;
      if (shouldTick) lastTick = elapsed;

      for (let i = 0; i < spans.length; i++) {
        const ch = letters[i];
        if (/\s/.test(ch) || spans[i].classList.contains('locked')) continue;

        const lockTime = lockAt.get(i) ?? duration * 0.66;
        if (done || elapsed >= lockTime) {
          spans[i].textContent = ch;
          spans[i].classList.add('locked');
        } else if (shouldTick) {
          spans[i].textContent = revealGlyph(ch, elapsed / lockTime);
        }
      }

      if (!done && document.body.contains(el)) {
        state.raf = requestAnimationFrame(frame);
        return;
      }

      el.classList.add('done');
      state.timer = setTimeout(() => cleanup(ta), 150);
    }

    state.raf = requestAnimationFrame(frame);
  }

  function isPlaying(ta) {
    return !!(ta && timers.has(ta));
  }

  window.addEventListener('blur', () => {
    document.querySelectorAll('.wc-accept-effect').forEach(el => el.remove());
  });

  return { play, cleanup, isPlaying, clampMs };
})();


/* ============================================================
   WordComplete — принятие подсказки по Tab
   ============================================================ */
const WordComplete = (() => {
  const WORD_RE      = /(\p{L}[\p{L}\p{N}']*|\p{N}+)$/u;
  const PREV_WORD_RE = /(\p{L}[\p{L}\p{N}']*|\p{N}+)\s+$/u;

  // Клавиши, при которых подсказку не скрываем
  const NAV_KEYS = new Set([
    'Shift', 'CapsLock',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ]);

  function getContext(ta) {
    const before      = ta.value.slice(0, ta.selectionStart);
    const mCur        = before.match(WORD_RE);
    const currentWord = mCur ? mCur[1] : '';
    const beforeCur   = before.slice(0, before.length - currentWord.length);
    const mPrev       = beforeCur.match(PREV_WORD_RE);
    const prevWord    = mPrev ? mPrev[1] : '';
    return { currentWord, prevWord };
  }

  function isSnippetPopupVisible() {
    const popup = document.getElementById('snippet-dropdown');
    if (!popup) return false;
    const cs = window.getComputedStyle(popup);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function handleInput(ta) {
    const cfg = WordDict.getConfig();
    if (!cfg.enabled || !ta || ta.disabled || ta.readOnly) { InlineHint.hide(); return; }
    if (ta.selectionStart !== ta.selectionEnd) { InlineHint.hide(); return; }

    // Не показываем подсказку при открытом выпадающем списке сниппетов
    if (isSnippetPopupVisible()) { InlineHint.hide(); return; }

    if (InlineHint.isComposing()) return;

    const { currentWord, prevWord } = getContext(ta);

    if (currentWord.length >= cfg.minLen) {
      const candidates = WordDict.suggest(currentWord);
      if (candidates.length) {
        InlineHint.show(ta, candidates[0].slice(currentWord.length));
        return;
      }
      InlineHint.hide();
      return;
    }

    // Нет текущего слова — предлагаем следующее по биграмме
    if (!currentWord && prevWord.length >= 2) {
      const next = WordDict.suggestNext(prevWord);
      if (next) { InlineHint.show(ta, next); return; }
    }

    InlineHint.hide();
  }

  function handleKeydown(e, ta) {
    if (!ta || ta.disabled || ta.readOnly) { InlineHint.hide(); return; }

    if (e.key === 'Escape' && InlineHint.isVisible()) {
      InlineHint.hide();
      e.stopPropagation();
      return;
    }

    if (e.key !== 'Tab') {
      if (InlineHint.isVisible() && InlineHint.getActiveTa() === ta) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey && !NAV_KEYS.has(e.key))
          InlineHint.hide();
      }
      return;
    }

    // Tab нажат — применяем подсказку только если она активна для этого поля
    if (!InlineHint.isVisible() || InlineHint.getActiveTa() !== ta) return;
    if (ta.selectionStart !== ta.selectionEnd || isSnippetPopupVisible()) { InlineHint.hide(); return; }

    // Читаем suffix ДО preventDefault, чтобы не поглощать Tab зря
    const suf = InlineHint.getSuffix();
    if (!suf) { InlineHint.hide(); return; }

    e.preventDefault();
    e.stopPropagation();

    const pos = ta.selectionStart;
    const { currentWord } = getContext(ta);
    // Для биграммного предложения (нет currentWord) добавляем пробел после
    const insert = currentWord ? suf : suf + ' ';
    const hintSnapshot = InlineHint.getSnapshot?.();
    const cfg = WordDict.getConfig();

    InlineHint.hide();
    ta.setRangeText(insert, pos, pos, 'end');
    WordAcceptEffect.play(hintSnapshot, insert, cfg);
    ta.dispatchEvent(new Event('input'));
    State.snapshot();
    WordDict.scheduleBuild();

    // Не зовём новый ghost сразу: иначе он наслаивается на Matrix-принятие.
    const nextHintDelay = cfg.acceptEffect === false ? 80 : Math.min(650, WordAcceptEffect.clampMs?.(cfg.acceptEffectMs) ?? 3500);
    setTimeout(() => {
      if (!WordAcceptEffect.isPlaying?.(ta)) handleInput(ta);
    }, nextHintDelay);
  }

  return { handleInput, handleKeydown };
})();


/* ============================================================
   SmartList — авто-нумерация при Enter в списке
   ============================================================ */
const SmartList = (() => {
  const LIST_RE = /^(\d+(?:\.\d+)*)\.\s/;

  function getLineInfo(ta) {
    const val       = ta.value;
    const start     = ta.selectionStart;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    const lineEnd   = val.indexOf('\n', start);
    const line      = val.slice(lineStart, lineEnd < 0 ? val.length : lineEnd);
    return { lineStart, lineEnd, line };
  }

  function handleKeydown(e, ta) {
    if (window._smartListEnabled === false) return;
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

    const { lineStart, lineEnd, line } = getLineInfo(ta);
    const m = line.match(LIST_RE);
    if (!m) return;

    const prefix  = m[0];
    const numStr  = m[1];
    const trueEnd = lineEnd < 0 ? ta.value.length : lineEnd;

    // Курсор должен быть строго в конце строки
    if (ta.selectionStart !== trueEnd || ta.selectionEnd !== trueEnd) return;

    // Пустой элемент списка — выходим из режима списка
    if (line.trimEnd() === prefix.trimEnd()) {
      e.preventDefault();
      ta.setRangeText('', lineStart, trueEnd, 'end');
      ta.selectionStart = ta.selectionEnd = lineStart;
      ta.dispatchEvent(new Event('input'));
      State.snapshot();
      return;
    }

    const parts = numStr.split('.');
    parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
    let nextPrefix = parts.join('.') + '. ';

    // Если следующая строка уже занята тем же номером — делаем подпункт
    if (lineEnd >= 0) {
      const nextLineEnd = ta.value.indexOf('\n', lineEnd + 1);
      const nextLine    = ta.value.slice(
        lineEnd + 1,
        nextLineEnd < 0 ? undefined : nextLineEnd
      );
      const nextM = nextLine.match(LIST_RE);
      if (nextM && nextM[1] === parts.join('.')) {
        nextPrefix = numStr + '.1. ';
      }
    }

    e.preventDefault();
    ta.setRangeText('\n' + nextPrefix, trueEnd, trueEnd, 'end');
    ta.dispatchEvent(new Event('input'));
    State.snapshot();
  }

  // Заглушка для единообразия интерфейса модулей
  function handleInput() {}

  return { handleInput, handleKeydown };
})();


window.WordComplete     = WordComplete;
window.WordDict         = WordDict;
window.SmartList        = SmartList;
window.InlineHint       = InlineHint;
window.WordAcceptEffect = WordAcceptEffect;
