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
    const masked = text.replace(/\{\{[^}]+\}\}/g, (match, offset) => {
      ranges.push({ start: offset, end: offset + match.length });
      return '_'.repeat(match.length);
    });
    return { masked, ranges };
  }

  // Заменить содержимое code fences (``` / ~~~) на пробелы той же длины
  function _maskCodeFences(text) {
    const ranges = [];
    let masked = text;
    let fenceChar = null;
    let fenceStart = -1;
    const lines = text.split('\n');
    let offset = 0;
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (!fenceChar) {
        // Ищем opening fence: ``` или ~~~ (3+ одинаковых символа)
        const m = trimmed.match(/^(`{3,}|~{3,})/);
        if (m) {
          fenceChar = m[1][0];
          fenceStart = offset;
        }
      } else {
        // Ищем closing fence тем же символом
        if (trimmed.startsWith(fenceChar.repeat(3))) {
          const fenceEnd = offset + line.length;
          ranges.push({ start: fenceStart, end: fenceEnd });
          fenceChar = null;
          fenceStart = -1;
        }
      }
      offset += line.length + 1; // +1 для \n
    }
    // Незакрытый fence — маскируем до конца
    if (fenceChar !== null) {
      ranges.push({ start: fenceStart, end: text.length });
    }
    if (!ranges.length) return { masked, ranges };
    // Заменяем содержимое на пробелы
    let result = '';
    let lastEnd = 0;
    for (const r of ranges) {
      result += masked.slice(lastEnd, r.start);
      result += ' '.repeat(r.end - r.start);
      lastEnd = r.end;
    }
    result += masked.slice(lastEnd);
    return { masked: result, ranges };
  }

  // Отфильтровать ошибки, попавшие в диапазоны плейсхолдеров или code fences
  function _filterExcludedErrors(words, ranges) {
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

  async function checkText(text) {
    if (!isEnabled()) return { ok: false, words: [], source: 'unavailable' };
    if (_unreachable) return { ok: false, words: [], source: 'unavailable' };

    // Нормализация CRLF → LF (позиции API совпадают с позициями в JS)
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const trimmed = normalized.trim();
    if (!trimmed) return { ok: true, words: [], source: 'cache' };

    // Кэш по полному тексту
    const cacheKey = _hash(trimmed);
    const cached = _cacheGet(cacheKey);
    if (cached) return { ...cached, source: 'cache' };

    // Компенсация сдвига: API считает позиции от trimmed, а overlay рисует от полного ta.value
    const leadingTrim = normalized.length - normalized.trimStart().length;
    const trimOffset = leadingTrim;

    // Разбиваем на чанки
    const chunks = _splitIntoChunks(trimmed);

    try {
      const allWords = [];
      let offset = 0;

      // Маскируем code fences в полном тексте (до разбиения на чанки)
      const { ranges: fenceRanges } = _maskCodeFences(trimmed);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const { masked, ranges: phRanges } = _maskPlaceholders(chunk);

        // Таймаут на каждый чанк отдельно
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        let words;
        try {
          words = await _fetchChunk(masked, controller.signal);
        } finally {
          clearTimeout(timer);
        }

        const filtered = _filterExcludedErrors(words, phRanges);

        // Смещаем позиции: API считает от trimmed, а нужен offset от полного текста
        for (const w of filtered) {
          allWords.push({
            word: w.word,
            pos: w.pos + offset + trimOffset,
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

      // Успешно — сбрасываем флаг недоступности
      _unreachable = false;
      const result = { ok: true, words: allWords, source: 'network' };
      _cacheSet(cacheKey, result);
      return result;

    } catch (err) {
      // AbortError (таймаут) — не отключаем спеллер навсегда
      if (err.name !== 'AbortError' && !_unreachable) {
        _unreachable = true;
        try { Toast?.show?.('Спеллер недоступен, проверка орфографии отключена до перезагрузки', 'info'); } catch {}
      }
      return { ok: false, words: [], source: 'unavailable' };
    }
  }

  return { init, checkText, isEnabled, clearCache };
})();
