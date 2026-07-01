// file_name: spell-check.js
'use strict';

/* ============================================================
   SpellCheck — орфографическая проверка через Яндекс.Спеллер
   Умная отправка порциями для больших текстов.
   ============================================================ */
window.SpellCheck = (() => {
  const API_URL = 'https://speller.yandex.net/services/spellservice.json/checkText';
  const TIMEOUT_MS = 5000;
  const CACHE_LIMIT = 100;
  const LANG = 'ru,en';
  const OPTIONS = 6; // IGNORE_DIGITS (2) + IGNORE_URLS (4)
  const CHUNK_SIZE = 4000; // безопасный размер чанка для URL-кодирования
  const BETWEEN_CHUNKS_DELAY = 150; // пауза между запросами (rate limit)

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

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Разбить текст на чанки по строкам (не ломая слова)
  function _splitIntoChunks(text) {
    if (text.length <= CHUNK_SIZE) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= CHUNK_SIZE) {
        chunks.push(remaining);
        break;
      }
      // Ищем последний перевод строки в пределах CHUNK_SIZE
      let splitAt = remaining.lastIndexOf('\n', CHUNK_SIZE);
      if (splitAt <= 0) splitAt = CHUNK_SIZE; // нет перевода — режем жёстко
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  // Запрос одного чанка к API
  async function _fetchChunk(masked, signal) {
    const url = `${API_URL}?text=${encodeURIComponent(masked)}&lang=${LANG}&options=${OPTIONS}&format=plain`;
    const res = await fetch(url, { signal });
    if (res.status === 414) return []; // текст слишком длинный — пропускаем
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data || [])
      .map(item => ({
        word: item.word || '',
        pos: item.pos || 0,
        len: item.len || 0,
        suggestions: item.s || [],
      }))
      .filter(w => w.word && w.len > 0);
  }

  async function checkText(text, opts = {}) {
    if (!isEnabled()) return { ok: false, words: [], source: 'unavailable' };
    if (_unreachable) return { ok: false, words: [], source: 'unavailable' };

    const trimmed = String(text || '').trim();
    if (!trimmed) return { ok: true, words: [], source: 'cache' };

    // Кэш по полному тексту
    const cacheKey = _hash(trimmed);
    const cached = _cacheGet(cacheKey);
    if (cached) return { ...cached, source: 'cache' };

    // Разбиваем на чанки
    const chunks = _splitIntoChunks(trimmed);
    const allWords = [];
    let offset = 0;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const { masked, ranges } = _maskPlaceholders(chunk);

        const words = await _fetchChunk(masked, controller.signal);
        const filtered = _filterPlaceholderErrors(words, ranges);

        // Смещаем позиции относительно начала полного текста
        for (const w of filtered) {
          allWords.push({
            word: w.word,
            pos: w.pos + offset,
            len: w.len,
            suggestions: w.suggestions,
          });
        }

        offset += chunk.length;

        // Пауза между запросами (кроме последнего)
        if (i < chunks.length - 1) {
          await _sleep(BETWEEN_CHUNKS_DELAY);
        }
      }

      clearTimeout(timer);
      const result = { ok: true, words: allWords, source: 'network' };
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
