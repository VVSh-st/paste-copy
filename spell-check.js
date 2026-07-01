// file_name: spell-check.js
'use strict';

/* ============================================================
   SpellCheck — орфографическая проверка через Яндекс.Спеллер
   ============================================================ */
window.SpellCheck = (() => {
  const API_URL = 'https://speller.yandex.net/services/spellservice.json/checkText';
  const TIMEOUT_MS = 5000;
  const CACHE_LIMIT = 100;
  const LANG = 'ru,en';
  const OPTIONS = 6; // IGNORE_DIGITS (2) + IGNORE_URLS (4)
  const MAX_TEXT_LEN = 8000; // лимит Yandex Speller (URL ~10KB, безопасный запас)

  let _unreachable = false;
  let _cache = new Map();
  let _State = null;

  function init(State) {
    _State = State;
  }

  function isEnabled() {
    return _State?.getLayout?.().spellCheck === true;
  }

  function clearCache() {
    _cache.clear();
  }

  function _hash(text) {
    const source = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  // Заменить {{var}} на нейтральные токены той же длины, запомнить диапазоны
  function _maskPlaceholders(text) {
    const ranges = [];
    const masked = text.replace(/\{\{[^}]+\}\}/g, match => {
      const start = ranges.length ? ranges[ranges.length - 1].end : 0;
      const absStart = text.indexOf(match, start);
      ranges.push({ start: absStart, end: absStart + match.length });
      return '_'.repeat(match.length);
    });
    return { masked, ranges };
  }

  // Отфильтровать ошибки, попавшие в диапазоны плейсхолдеров
  function _filterPlaceholderErrors(words, ranges) {
    if (!ranges.length) return words;
    return words.filter(w => {
      for (const r of ranges) {
        if (w.pos >= r.start && w.pos < r.end) return false;
        if (w.pos + w.len > r.start && w.pos + w.len <= r.end) return false;
      }
      return true;
    });
  }

  function _cacheGet(key) {
    if (_cache.has(key)) {
      const val = _cache.get(key);
      // Move to end (most recently used)
      _cache.delete(key);
      _cache.set(key, val);
      return val;
    }
    return undefined;
  }

  function _cacheSet(key, val) {
    if (_cache.has(key)) _cache.delete(key);
    if (_cache.size >= CACHE_LIMIT) {
      const firstKey = _cache.keys().next().value;
      if (firstKey) _cache.delete(firstKey);
    }
    _cache.set(key, val);
  }

  async function checkText(text, opts = {}) {
    if (!isEnabled()) return { ok: false, words: [], source: 'unavailable' };
    if (_unreachable) return { ok: false, words: [], source: 'unavailable' };

    const trimmed = String(text || '').trim();
    if (!trimmed) return { ok: true, words: [], source: 'cache' };

    // Обрезаем до лимита API (не ставим _unreachable — это не ошибка сервиса)
    const toCheck = trimmed.length > MAX_TEXT_LEN ? trimmed.slice(0, MAX_TEXT_LEN) : trimmed;

    // Кэш
    const cacheKey = _hash(toCheck);
    const cached = _cacheGet(cacheKey);
    if (cached) return { ...cached, source: 'cache' };

    // Маскируем плейсхолдеры
    const { masked, ranges } = _maskPlaceholders(toCheck);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const url = `${API_URL}?text=${encodeURIComponent(masked)}&lang=${LANG}&options=${OPTIONS}&format=plain`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      // 414 = текст слишком длинный для URL — это не ошибка сервиса, просто обрезаем
      if (res.status === 414) {
        return { ok: true, words: [], source: 'cache' };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const words = (data || [])
        .map(item => ({
          word: item.word || '',
          pos: item.pos || 0,
          len: item.len || 0,
          suggestions: item.s || [],
        }))
        .filter(w => w.word && w.len > 0);

      const filtered = _filterPlaceholderErrors(words, ranges);
      const result = { ok: true, words: filtered, source: 'network' };
      _cacheSet(cacheKey, result);
      return result;

    } catch (err) {
      if (!_unreachable) {
        _unreachable = true;
        if (typeof Toast !== 'undefined') {
          Toast.show('Спеллер недоступен, проверка орфографии отключена до перезагрузки', 'info');
        }
      }
      return { ok: false, words: [], source: 'unavailable' };
    }
  }

  return { init, checkText, isEnabled, clearCache };
})();
