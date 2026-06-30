// file_name: dictionaries.js
/* ============================================================
   dictionaries.js — Тезаурус (Datamuse), Грамматика (LanguageTool),
                     Определение языка
   ============================================================ */
'use strict';

window.Dictionaries = (() => {
  // ── Кэш ──────────────────────────────────────────────────
  const CACHE_KEY = 'dict-cache-v1';
  const MAX_CACHE = 500;
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  let cache = new Map();
  let _cacheDirty = false;
  let _cacheSaveTimer = null;

  // ── Состояние UI ──────────────────────────────────────────
  let _popup = null;
  let _popupTimer = null;
  let _grammarUnderlines = [];
  let _grammarMarkers = new Map();

  // ── Утилиты ───────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Кэш ──────────────────────────────────────────────────
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) cache = new Map(arr.slice(-MAX_CACHE));
      }
    } catch {}
  }

  function flushCache() {
    if (!_cacheDirty) return;
    _cacheDirty = false;
    try {
      const arr = [...cache.entries()].slice(-MAX_CACHE);
      localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
    } catch {}
  }

  function scheduleCacheSave() {
    _cacheDirty = true;
    clearTimeout(_cacheSaveTimer);
    _cacheSaveTimer = setTimeout(flushCache, 3000);
  }

  function cacheGet(key) {
    const v = cache.get(key);
    if (v !== undefined) {
      if (v.ts && Date.now() - v.ts > CACHE_TTL) { cache.delete(key); return undefined; }
      cache.delete(key);
      cache.set(key, v);
      return v.data;
    }
    return undefined;
  }

  function cacheSet(key, data) {
    if (!data) return;
    cache.delete(key);
    cache.set(key, { data, ts: Date.now() });
    if (cache.size > MAX_CACHE) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    scheduleCacheSave();
  }

  // ============================================================
  //  1. ТЕЗАУРУС (Datamuse API)
  // ============================================================
  const Thesaurus = (() => {
    const BASE = 'https://api.datamuse.com';
    let _activeController = null;

    // Типы связей
    const RELATIONS = {
      synonyms:   { ml: 'meaning', label: 'Синонимы', icon: '🔄' },
      antonyms:   { rel_ant: 'antonym', label: 'Антонимы', icon: '↔️' },
      rhymes:     { rel_rhy: 'rhyme', label: 'Рифмы', icon: '🎵' },
      triggers:   { rel_trg: 'trigger', label: 'Ассоциации', icon: '💡' },
      similar:    { sl: 'spelling-like', label: 'Похожие по написанию', icon: '✏️' },
    };

    async function query(word, relationKey, max = 15) {
      if (!word || !relationKey) return [];
      const rel = RELATIONS[relationKey];
      if (!rel) return [];

      const paramKey = Object.keys(rel)[0];
      const cacheKey = JSON.stringify(['thesaurus', word.toLowerCase(), relationKey]);
      const cached = cacheGet(cacheKey);
      if (cached) return cached;

      if (_activeController) _activeController.abort();
      _activeController = new AbortController();

      try {
        const url = `${BASE}?${paramKey}=${encodeURIComponent(word)}&max=${max}`;
        const r = await withTimeout(fetch(url, { signal: _activeController.signal }), 5000);
        if (!r.ok) return [];
        const data = await r.json();
        const results = (data || []).map(item => ({
          word: item.word,
          score: item.score || 0,
          tags: item.tags || [],
        }));
        cacheSet(cacheKey, results);
        return results;
      } catch {
        return [];
      }
    }

    function getSelectedWord() {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const text = sel.toString().trim();
      if (!text || text.length > 50 || /\s/.test(text)) return null;
      return text;
    }

    function getWordAtCursor(textarea) {
      if (!textarea) return null;
      const pos = textarea.selectionStart;
      const text = textarea.value;
      if (pos === undefined || pos === null) return null;
      let start = pos;
      let end = pos;
      while (start > 0 && /[a-zA-Zа-яёА-ЯЁ0-9_-]/.test(text[start - 1])) start--;
      while (end < text.length && /[a-zA-Zа-яёА-ЯЁ0-9_-]/.test(text[end])) end++;
      if (start === end) return null;
      return { word: text.slice(start, end), start, end };
    }

    return {
      RELATIONS,
      query,
      getSelectedWord,
      getWordAtCursor,
    };
  })();

  // ============================================================
  //  2. ГРАММАТИКА (LanguageTool API)
  // ============================================================
  const Grammar = (() => {
    const PUBLIC_URL = 'https://api.languagetool.org/v2';
    let _activeController = null;
    let _debounceTimer = null;
    const DEBOUNCE_MS = 1500;

    async function check(text, lang = 'auto') {
      if (!text || text.trim().length < 5) return [];

      const cacheKey = JSON.stringify(['grammar', text.slice(0, 500), lang]);
      const cached = cacheGet(cacheKey);
      if (cached) return cached;

      if (_activeController) _activeController.abort();
      _activeController = new AbortController();

      try {
        const body = new URLSearchParams({ text, language: lang });
        const r = await withTimeout(
          fetch(`${PUBLIC_URL}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: _activeController.signal,
          }),
          10000
        );
        if (!r.ok) return [];
        const data = await r.json();
        const matches = (data.matches || []).map(m => ({
          message: m.message,
          shortMessage: m.shortMessage || m.message,
          replacements: (m.replacements || []).slice(0, 5).map(r => r.value),
          offset: m.offset,
          length: m.length,
          context: m.context,
          rule: m.rule?.id,
          category: m.rule?.category?.id,
          severity: m.rule?.issueType || 'misspelling',
        }));
        cacheSet(cacheKey, matches);
        return matches;
      } catch {
        return [];
      }
    }

    function checkDebounced(text, lang, callback) {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(async () => {
        const results = await check(text, lang);
        callback(results);
      }, DEBOUNCE_MS);
    }

    function getSeverityColor(severity) {
      switch (severity) {
        case 'misspelling': return '#ef4444';
        case 'grammar': return '#f59e0b';
        case 'style': return '#3b82f6';
        case 'typography': return '#8b5cf6';
        default: return '#6b7280';
      }
    }

    return {
      check,
      checkDebounced,
      getSeverityColor,
    };
  })();

  // ============================================================
  //  3. ОПРЕДЕЛЕНИЕ ЯЗЫКА
  // ============================================================
  const LangDetect = (() => {
    const SAMPLES = {
      ru: 'это текст на русском языке для определения',
      en: 'this is english text for language detection',
      de: 'dies ist deutscher text zur Spracherkennung',
      fr: 'ceci est un texte français pour la détection',
      es: 'este es un texto español para la detección',
      it: 'questo è un testo italiano per il rilevamento',
      zh: '这是用于检测的中文文本',
      ja: 'これは検出用の日本語テキストです',
      ko: '이것은 감지를위한 한국어 텍스트입니다',
    };

    function detect(text) {
      if (!text || text.length < 3) return null;
      const sample = text.toLowerCase();

      // Простая эвристика на основе Unicode-диапазонов
      if (/[\u3400-\u9FFF]/.test(text)) return { code: 'zh', confidence: 0.8 };
      if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { code: 'ja', confidence: 0.85 };
      if (/[\uAC00-\uD7A3]/.test(text)) return { code: 'ko', confidence: 0.85 };
      if (/[\u0600-\u06FF]/.test(text)) return { code: 'ar', confidence: 0.8 };
      if (/[\u0900-\u097F]/.test(text)) return { code: 'hi', confidence: 0.8 };

      // Подсчёт буквенных диапазонов
      const letters = text.replace(/[\s\d\p{P}]/gu, '');
      if (!letters) return null;

      const cyrCount = (letters.match(/[\u0400-\u04FF]/gu) || []).length;
      const latCount = (letters.match(/[A-Za-z]/g) || []).length;
      const total = letters.length;

      if (cyrCount / total > 0.5) return { code: 'ru', confidence: Math.min(0.95, 0.5 + cyrCount / total * 0.5) };
      if (latCount / total > 0.5) {
        // Определяем конкретный латинский язык по частотным словам
        const lower = sample;
        if (/\b(the|and|is|are|was|were|have|has|been|will|would|could|should|this|that|with|from|for)\b/.test(lower))
          return { code: 'en', confidence: 0.85 };
        if (/\b(der|die|das|und|ist|ein|eine|nicht|sie|wir|ich|kann|werden|haben|dass)\b/.test(lower))
          return { code: 'de', confidence: 0.8 };
        if (/\b(le|la|les|des|est|sont|une|dans|pour|avec|pas|sur|qui|que|nous|mais)\b/.test(lower))
          return { code: 'fr', confidence: 0.8 };
        if (/\b(el|la|los|las|es|son|una|del|por|con|que|está|tiene|puede|como|pero)\b/.test(lower))
          return { code: 'es', confidence: 0.8 };
        if (/\b(il|la|le|di|che|è|un|una|per|con|non|sono|come|questo|anche|ma)\b/.test(lower))
          return { code: 'it', confidence: 0.75 };
        return { code: 'en', confidence: 0.6 };
      }

      return null;
    }

    return { detect, SAMPLES };
  })();

  // ============================================================
  //  UI: Тултип тезауруса
  // ============================================================
  function ensurePopup() {
    if (_popup && _popup.isConnected) return _popup;
    _popup = document.createElement('div');
    _popup.className = 'dict-popup';
    _popup.style.cssText = [
      'position:fixed;z-index:8000;max-width:360px;max-height:400px;overflow-y:auto',
      'background:var(--bg2,#1e1e2e);color:var(--text1,#cdd6f4)',
      'border:1px solid var(--border,#45475a);border-radius:10px',
      'padding:8px;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,.45)',
      'display:none',
    ].join(';');
    document.body.appendChild(_popup);
    return _popup;
  }

  function showPopup(x, y, html) {
    const pop = ensurePopup();
    pop.innerHTML = html;
    pop.style.display = 'block';
    // Позиционирование с учётом границ экрана
    const rect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y + 10;
    if (left + rect.width > vw - 10) left = vw - rect.width - 10;
    if (top + rect.height > vh - 10) top = y - rect.height - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function hidePopup() {
    clearTimeout(_popupTimer);
    _popupTimer = setTimeout(() => {
      if (_popup) _popup.style.display = 'none';
    }, 300);
  }

  function showThesaurusPopup(word, x, y) {
    if (!word) return;
    const pop = ensurePopup();
    pop.innerHTML = `<div style="padding:8px;color:var(--text3)">🔍 Загрузка для «${esc(word)}»...</div>`;
    pop.style.display = 'block';
    pop.style.left = x + 'px';
    pop.style.top = (y + 10) + 'px';

    pop.onmouseenter = () => clearTimeout(_popupTimer);
    pop.onmouseleave = hidePopup;

    // Загружаем синонимы и ассоциации параллельно
    Promise.all([
      Thesaurus.query(word, 'synonyms', 12),
      Thesaurus.query(word, 'triggers', 8),
    ]).then(([synonyms, triggers]) => {
      let html = `<div style="padding:4px 6px;font-weight:600;color:var(--text2);border-bottom:1px solid var(--border)">📖 ${esc(word)}</div>`;

      if (synonyms.length) {
        html += `<div style="padding:6px 6px 2px;font-size:11px;color:var(--text3)">Синонимы</div>`;
        html += `<div class="dict-word-list">`;
        synonyms.forEach(s => {
          html += `<button type="button" class="dict-word-btn" data-word="${esc(s.word)}">${esc(s.word)}</button>`;
        });
        html += `</div>`;
      }

      if (triggers.length) {
        html += `<div style="padding:6px 6px 2px;font-size:11px;color:var(--text3)">Ассоциации</div>`;
        html += `<div class="dict-word-list">`;
        triggers.forEach(s => {
          html += `<button type="button" class="dict-word-btn dict-word-assoc" data-word="${esc(s.word)}">${esc(s.word)}</button>`;
        });
        html += `</div>`;
      }

      if (!synonyms.length && !triggers.length) {
        html += `<div style="padding:8px 6px;color:var(--text3)">Ничего не найдено</div>`;
      }

      pop.innerHTML = html;
      // Обработчики кликов по словам
      pop.querySelectorAll('.dict-word-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const newWord = btn.dataset.word;
          if (newWord) {
            _replaceSelectedWord(newWord);
            hidePopup();
          }
        });
      });
    });
  }

  function _replaceSelectedWord(newWord) {
    // Пробуем заменить в textarea
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      const ta = active;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      // Находим границы слова
      let wordStart = start;
      let wordEnd = end;
      while (wordStart > 0 && /[a-zA-Zа-яёА-ЯЁ0-9_-]/.test(text[wordStart - 1])) wordStart--;
      while (wordEnd < text.length && /[a-zA-Zа-яёА-ЯЁ0-9_-]/.test(text[wordEnd])) wordEnd++;
      ta.value = text.slice(0, wordStart) + newWord + text.slice(wordEnd);
      ta.selectionStart = wordStart;
      ta.selectionEnd = wordStart + newWord.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Fallback: вставка через clipboard
    navigator.clipboard?.writeText(newWord).then(() => {
      window.Toast?.show('Скопировано: ' + newWord, 'success');
    });
  }

  // ============================================================
  //  UI: Подсветка грамматических ошибок
  // ============================================================
  function showGrammarResults(textarea, matches) {
    clearGrammarMarkers();
    if (!textarea || !matches?.length) return;

    const container = textarea.closest('.block-body, .subtab-content, .code-block');
    if (!container) return;

    matches.forEach(m => {
      const marker = document.createElement('span');
      marker.className = 'grammar-error-marker';
      marker.dataset.offset = m.offset;
      marker.dataset.length = m.length;
      marker.title = `${m.severity}: ${m.message}`;
      marker.style.cssText = [
        'border-bottom:2px wavy',
        `border-color:${Grammar.getSeverityColor(m.severity)}`,
        'cursor:pointer;position:relative',
      ].join(';');

      // Тултип с исправлениями
      marker.addEventListener('mouseenter', (e) => {
        const tipHtml = `
          <div style="padding:4px 6px;max-width:300px">
            <div style="font-weight:600;margin-bottom:4px;color:${Grammar.getSeverityColor(m.severity)}">${esc(m.shortMessage)}</div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${esc(m.message)}</div>
            ${m.replacements.length ? `
              <div style="font-size:11px;color:var(--text3);margin-bottom:2px">Замены:</div>
              <div class="dict-word-list">
                ${m.replacements.map(r => `<button type="button" class="dict-word-btn grammar-fix" data-replacement="${esc(r)}" data-offset="${m.offset}" data-length="${m.length}">${esc(r)}</button>`).join('')}
              </div>
            ` : '<div style="font-size:11px;color:var(--text3)">Нет предложений</div>'}
          </div>
        `;
        showPopup(e.clientX, e.clientY, tipHtml);
        _popup?.querySelectorAll('.grammar-fix').forEach(btn => {
          btn.addEventListener('click', () => {
            _applyGrammarFix(textarea, parseInt(btn.dataset.offset), parseInt(btn.dataset.length), btn.dataset.replacement);
            hidePopup();
          });
        });
      });
      marker.addEventListener('mouseleave', hidePopup);

      _grammarMarkers.set(m.offset + ':' + m.length, marker);
    });
  }

  function _applyGrammarFix(textarea, offset, length, replacement) {
    if (!textarea) return;
    const text = textarea.value;
    textarea.value = text.slice(0, offset) + replacement + text.slice(offset + length);
    textarea.selectionStart = offset;
    textarea.selectionEnd = offset + replacement.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clearGrammarMarkers() {
    _grammarMarkers.clear();
  }

  // ============================================================
  //  UI: Индикатор языка
  // ============================================================
  let _langIndicator = null;

  function ensureLangIndicator() {
    if (_langIndicator && _langIndicator.isConnected) return _langIndicator;
    _langIndicator = document.createElement('span');
    _langIndicator.className = 'dict-lang-indicator';
    _langIndicator.style.cssText = [
      'font-size:10px;padding:1px 6px;border-radius:999px',
      'background:var(--bg1,#11111b);color:var(--text3,#a6adc8)',
      'border:1px solid var(--border,#45475a);margin-left:4px',
      'cursor:default;display:none',
    ].join(';');
    const wordCount = document.getElementById('global-word-count');
    if (wordCount) wordCount.parentNode.insertBefore(_langIndicator, wordCount.nextSibling);
    return _langIndicator;
  }

  function updateLangIndicator(text) {
    const el = ensureLangIndicator();
    if (!text || text.length < 10) {
      el.style.display = 'none';
      return;
    }
    const result = LangDetect.detect(text);
    if (!result) {
      el.style.display = 'none';
      return;
    }
    const langNames = {
      ru: 'RU', en: 'EN', de: 'DE', fr: 'FR', es: 'ES', it: 'IT',
      zh: 'ZH', ja: 'JA', ko: 'KO', ar: 'AR', hi: 'HI',
    };
    el.textContent = langNames[result.code] || result.code;
    el.title = `Определён: ${result.code} (${Math.round(result.confidence * 100)}%)`;
    el.style.display = 'inline';
  }

  // ============================================================
  //  Инициализация
  // ============================================================
  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    loadCache();
    window.addEventListener('beforeunload', () => {
      if (_activeController) _activeController.abort();
      flushCache();
    });
  }

  return {
    Thesaurus,
    Grammar,
    LangDetect,

    init,
    ensurePopup,
    showPopup,
    hidePopup,
    showThesaurusPopup,
    showGrammarResults,
    clearGrammarMarkers,
    updateLangIndicator,
    _replaceSelectedWord,
  };
})();
