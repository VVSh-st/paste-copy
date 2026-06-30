// file_name: dictionaries.js
/* ============================================================
   dictionaries.js — Offline-тезаурус (Datamuse API) + Определение языка
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

  // ── Тезаурус state ────────────────────────────────────────
  let _popup = null;
  let _items = [];
  let _idx = -1;
  let _ta = null;
  let _origStart = 0;
  let _origEnd = 0;
  let _origText = '';
  let _leadSpace = '';
  let _trailSpace = '';
  let _closeOnClick = null;
  let _closeOnCtx = null;
  let _onKey = null;

  // ── Утилиты ───────────────────────────────────────────────
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Кэш ──────────────────────────────────────────────────
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) cache = new Map(a.slice(-MAX_CACHE)); }
    } catch {}
  }
  function flushCache() {
    if (!_cacheDirty) return;
    _cacheDirty = false;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache.entries()].slice(-MAX_CACHE))); } catch {}
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
      cache.delete(key); cache.set(key, v);
      return v.data;
    }
    return undefined;
  }
  function cacheSet(key, data) {
    if (!data) return;
    cache.delete(key); cache.set(key, { data, ts: Date.now() });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    scheduleCacheSave();
  }

  // ============================================================
  //  1. ТЕЗАУРУС (Datamuse API)
  // ============================================================
  const BASE = 'https://api.datamuse.com';
  let _activeController = null;

  async function query(word, relationKey, max = 15) {
    if (!word) return [];
    const RELATIONS = {
      synonyms:  'ml',
      antonyms:  'rel_ant',
      rhymes:    'rel_rhy',
      triggers:  'rel_trg',
    };
    const paramKey = RELATIONS[relationKey];
    if (!paramKey) return [];

    const cacheKey = JSON.stringify(['th', word.toLowerCase(), relationKey]);
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    if (_activeController) _activeController.abort();
    _activeController = new AbortController();

    try {
      const url = `${BASE}?${paramKey}=${encodeURIComponent(word)}&max=${max}`;
      const r = await withTimeout(fetch(url, { signal: _activeController.signal }), 5000);
      if (!r.ok) return [];
      const data = await r.json();
      const results = (data || []).map(item => ({ word: item.word, score: item.score || 0 }));
      cacheSet(cacheKey, results);
      return results;
    } catch {
      return [];
    }
  }

  // ============================================================
  //  2. Попап (по образцу existing thesaurus)
  // ============================================================
  function _close() {
    if (_closeOnClick) { document.removeEventListener('click', _closeOnClick, true); _closeOnClick = null; }
    if (_closeOnCtx) { document.removeEventListener('contextmenu', _closeOnCtx, true); _closeOnCtx = null; }
    if (_onKey) { document.removeEventListener('keydown', _onKey, true); _onKey = null; }
    if (_popup) { _popup.remove(); _popup = null; }
    _items = []; _idx = -1; _ta = null;
  }

  function _applyItem() {
    if (!_items.length || !_ta || _idx < 0) return;
    const item = _items[_idx];
    const replacement = _leadSpace + item.word + _trailSpace;
    _ta._skipWordComplete = true;
    _ta.focus();
    _ta.setRangeText(replacement, _origStart, _origEnd, 'select');
    _ta.dispatchEvent(new Event('input', { bubbles: true }));
    _ta._skipWordComplete = false;
    const newEnd = _origStart + replacement.length;
    _origEnd = newEnd;
    if (_popup) {
      const dot = _popup.querySelector('.thesaurus-dot');
      if (dot) dot.textContent = `${_idx + 1}/${_items.length}`;
      const label = _popup.querySelector('.thesaurus-word');
      if (label) label.textContent = item.word;
    }
  }

  function _showPopup(ta) {
    _close();
    _ta = ta;
    _origStart = ta.selectionStart;
    _origEnd = ta.selectionEnd;
    _origText = ta.value.slice(_origStart, _origEnd);
    const leadMatch = _origText.match(/^(\s*)/);
    const trailMatch = _origText.match(/(\s*)$/);
    _leadSpace = leadMatch ? leadMatch[1] : '';
    _trailSpace = trailMatch ? trailMatch[1] : '';

    const popup = document.createElement('div');
    popup.className = 'thesaurus-popup';
    popup.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9500;background:var(--bg2);border:1px solid var(--border2);border-radius:10px;padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;font-size:12px;color:var(--text1);';
    popup.innerHTML =
      '<span class="thesaurus-dot" style="color:var(--text3);font-size:10px;min-width:30px">0/0</span>' +
      '<span class="thesaurus-word" style="font-weight:600;color:#4ade80"></span>' +
      '<span style="color:var(--text3);font-size:10px;margin-left:8px">← →: цикл · Enter: ✓ · Esc: ✕</span>';
    document.body.appendChild(popup);
    _popup = popup;

    _onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        _idx = (_idx + 1) % _items.length;
        _applyItem();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        _idx = (_idx - 1 + _items.length) % _items.length;
        _applyItem();
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        _close();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        _restoreOrig();
        _close();
      }
    };
    setTimeout(() => document.addEventListener('keydown', _onKey, true), 0);

    _closeOnClick = (e) => {
      if (!popup.contains(e.target)) _close();
    };
    setTimeout(() => document.addEventListener('click', _closeOnClick, true), 0);

    _closeOnCtx = (e) => {
      if (!popup.contains(e.target)) {
        e.preventDefault();
        _restoreOrig();
        _close();
      }
    };
    setTimeout(() => document.addEventListener('contextmenu', _closeOnCtx, true), 0);
  }

  function _restoreOrig() {
    if (_ta && _origText != null) {
      _ta._skipWordComplete = true;
      _ta.setRangeText(_origText, _origStart, _origEnd, 'end');
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;
    }
  }

  // ============================================================
  //  3. Публичный API: тезаурус на слове
  // ============================================================
  async function openAtCursor(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return false;

    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    const pos = ta.selectionStart;
    const text = ta.value;
    const wordRe = /[\wА-Яа-яЁёA-Za-z\u00C0-\u024F]/;
    let start = pos, end = pos;
    while (start > 0 && wordRe.test(text[start - 1])) start--;
    while (end < text.length && wordRe.test(text[end])) end++;
    const word = sel || text.slice(start, end).trim();
    if (!word) {
      window.Toast?.show('Выделите слово или поставьте курсор', 'error');
      return false;
    }

    window.Toast?.show(`Тезаурус: «${word}» (Datamuse)`, 'success');
    const results = await Promise.all([
      query(word, 'synonyms', 12),
      query(word, 'triggers', 8),
    ]);
    const synonyms = results[0];
    const triggers = results[1];
    _items = [...synonyms, ...triggers];
    if (!_items.length) {
      window.Toast?.show('Ничего не найдено', 'info');
      return false;
    }
    _idx = 0;
    _showPopup(ta);
    _applyItem();
    return true;
  }

  // ============================================================
  //  4. ОПРЕДЕЛЕНИЕ ЯЗЫКА
  // ============================================================
  function detectLang(text) {
    if (!text || text.length < 3) return null;
    if (/[\u3400-\u9FFF]/.test(text)) return { code: 'zh', name: 'Chinese' };
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return { code: 'ja', name: 'Japanese' };
    if (/[\uAC00-\uD7A3]/.test(text)) return { code: 'ko', name: 'Korean' };
    if (/[\u0600-\u06FF]/.test(text)) return { code: 'ar', name: 'Arabic' };

    const letters = text.replace(/[\s\d\p{P}]/gu, '');
    if (!letters) return null;
    const cyrCount = (letters.match(/[\u0400-\u04FF]/gu) || []).length;
    const latCount = (letters.match(/[A-Za-z]/g) || []).length;
    const total = letters.length;

    if (cyrCount / total > 0.5) return { code: 'ru', name: 'Russian' };
    if (latCount / total > 0.5) {
      const lower = text.toLowerCase();
      if (/\b(the|and|is|are|was|were|have|has|been|will|would|could|should|this|that|with|from|for)\b/.test(lower))
        return { code: 'en', name: 'English' };
      if (/\b(der|die|das|und|ist|ein|eine|nicht|sie|wir|ich)\b/.test(lower))
        return { code: 'de', name: 'Deutsch' };
      if (/\b(le|la|les|des|est|sont|une|dans|pour|avec|pas|sur|qui|que)\b/.test(lower))
        return { code: 'fr', name: 'Français' };
      if (/\b(el|la|los|las|es|son|una|del|por|con|que|está|tiene|puede)\b/.test(lower))
        return { code: 'es', name: 'Español' };
      if (/\b(il|la|le|di|che|è|un|una|per|con|non|sono|come|questo|anche)\b/.test(lower))
        return { code: 'it', name: 'Italiano' };
      return { code: 'en', name: 'English' };
    }
    return null;
  }

  let _langEl = null;
  function updateLangIndicator(text) {
    if (!_langEl) {
      _langEl = document.createElement('span');
      _langEl.className = 'dict-lang-indicator';
      _langEl.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:999px;background:var(--bg1);color:var(--text3);border:1px solid var(--border);margin-left:4px;cursor:default;display:none';
      const wc = document.getElementById('global-word-count');
      if (wc) wc.parentNode.insertBefore(_langEl, wc.nextSibling);
    }
    if (!text || text.length < 10) { _langEl.style.display = 'none'; return; }
    const r = detectLang(text);
    if (!r) { _langEl.style.display = 'none'; return; }
    _langEl.textContent = r.code.toUpperCase();
    _langEl.title = r.name;
    _langEl.style.display = 'inline';
  }

  // ============================================================
  //  5. Инициализация
  // ============================================================
  let _inited = false;
  function init() {
    if (_inited) return;
    _inited = true;
    loadCache();
    window.addEventListener('beforeunload', () => { if (_activeController) _activeController.abort(); flushCache(); });
  }

  return {
    init,
    query,
    openAtCursor,
    detectLang,
    updateLangIndicator,
    _close,
  };
})();
