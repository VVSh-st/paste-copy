/**
 * TextSkeletonizer — извлекает структуру из текста для экономии токенов в LLM-запросах.
 * Аналог Skeletonizer для кода, но для текстовых документов.
 *
 * Уровни сжатия:
 *   light     — только заголовки + статистика (~5% от оригинала)
 *   medium    — заголовки + первые предложения + ключевые термины (~10-15%)
 *   aggressive — всё: заголовки, предложения, термины, списки, код, ссылки (~20-30%)
 *
 * Поддержка Web Worker: автоматически использует отдельный поток для больших текстов.
 */
const TextSkeletonizer = (() => {

  // ── Кэш ──────────────────────────────────────────────────────
  const _cache = new Map();
  const MAX_CACHE = 50;

  function _hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return ((h2 ^= h1 >>> 16) >>> 0).toString(36) + ((h1 >>> 0).toString(36));
  }

  function _cacheKey(level, text) {
    return level + ':' + text.length + ':' + _hash(text);
  }

  function _setCache(key, value) {
    _cache.delete(key);
    _cache.set(key, value);
    if (_cache.size > MAX_CACHE) _cache.delete(_cache.keys().next().value);
  }

  // ── Web Worker ──────────────────────────────────────────────
  let _worker = null;
  let _workerReady = false;
  let _workerCallbacks = new Map();
  let _workerId = 0;
  const WORKER_THRESHOLD = 20000; // используем Worker для текстов >20K

  function _fallbackWorkerCallbacks() {
    const cbs = [..._workerCallbacks.values()];
    _workerCallbacks.clear();
    cbs.forEach(cb => {
      clearTimeout(cb.timerId);
      try { cb.resolve(_processSync(cb.text, cb.level)); }
      catch (err) { cb.reject(err); }
    });
  }

  function _resetWorker() {
    _workerReady = false;
    _fallbackWorkerCallbacks();
    try { _worker?.terminate(); } catch {}
    _worker = null;
  }

  function _initWorker() {
    if (_worker || typeof Worker === 'undefined') return;
    try {
      _worker = new Worker('text-skeletonizer-worker.js?v=' + Date.now());
      _worker.onmessage = (e) => {
        const { id, result, error } = e.data;
        const cb = _workerCallbacks.get(id);
        if (cb) {
          clearTimeout(cb.timerId);
          _workerCallbacks.delete(id);
          if (error || typeof result !== 'string') {
            try { cb.resolve(_processSync(cb.text, cb.level)); }
            catch (err) { cb.reject(err); }
          } else {
            _setCache(_cacheKey(cb.level, cb.text), result);
            cb.resolve(result);
          }
        }
      };
      _worker.onerror = () => _resetWorker();
      _workerReady = true;
    } catch {
      _worker = null;
    }
  }

  function _processViaWorker(text, level) {
    return new Promise((resolve, reject) => {
      if (!_worker || !_workerReady) {
        _initWorker();
        if (!_worker || !_workerReady) {
          resolve(_processSync(text, level));
          return;
        }
      }
      const id = ++_workerId;
      const timerId = setTimeout(() => {
        if (_workerCallbacks.has(id)) {
          _workerCallbacks.delete(id);
          _resetWorker();
          resolve(_processSync(text, level));
        }
      }, 2000);
      _workerCallbacks.set(id, { resolve, reject, timerId, text, level });
      try {
        _worker.postMessage({ text, level, id });
      } catch {
        clearTimeout(timerId);
        _workerCallbacks.delete(id);
        _resetWorker();
        resolve(_processSync(text, level));
      }
    });
  }

  // Инициализируем Worker при загрузке
  _initWorker();

  // ── Стоп-слова ──────────────────────────────────────────────
  const STOP_WORDS = new Set([
    'это', 'для', 'что', 'как', 'не', 'но', 'или', 'так', 'его', 'при',
    'она', 'они', 'все', 'ее', 'их', 'быть', 'был', 'была', 'были',
    'будет', 'будут', 'может', 'могут', 'нужно', 'нужен', 'нужна', 'можно',
    'которые', 'который', 'которая', 'которое', 'этого', 'этой', 'этот',
    'этих', 'того', 'той', 'тех', 'такой', 'такая', 'такое', 'такие',
    'каждый', 'каждая', 'каждое', 'каждые', 'очень', 'также', 'уже',
    'еще', 'ещё', 'просто', 'только', 'пока', 'после', 'перед',
    'между', 'через', 'если', 'чтобы', 'потому', 'поэтому',
    'однако', 'кроме', 'того', 'самый', 'самая', 'самое', 'самые',
    'другой', 'другая', 'другое', 'другие', 'несколько', 'много',
    'мало', 'весь', 'вся', 'всё', 'какой', 'какая', 'какое',
    'какие', 'чей', 'чья', 'чьё', 'чьи', 'где', 'когда', 'откуда',
    'куда', 'зачем', 'почему', 'сколько', 'кто', 'ваш', 'ваша',
    'ваше', 'ваши', 'мой', 'моя', 'моё', 'мои', 'наш', 'наша', 'наше',
    'наши', 'свой', 'своя', 'своё', 'свои', 'тот', 'та', 'те',
    'вот', 'тут', 'там', 'здесь', 'тогда', 'сейчас', 'потом',
  ]);

  // ── Защита от отрицаний ──────────────────────────────────────
  const NEGATIONS = new Set(['не', 'нет', 'без', 'ни', 'никак', 'никогда', 'ничего']);

  // ── Упрощённый стемминг для русского ─────────────────────────
  const RU_SUFFIXES = [
    'ований', 'еваний', 'ировани',
    'ования', 'евания', 'ирова', 'ующих', 'ующем',
    'овала', 'евала', 'ировал', 'оваться', 'еваться',
    'ующие', 'ующее', 'ующий', 'ующей', 'ующую',
    'ание', 'ение', 'иться', 'аться', 'яться',
    'ний', 'тие', 'сть', 'ние', 'ции',
    'ый', 'ий', 'ой', 'ей', 'ая', 'яя',
    'ое', 'ые', 'ов', 'ев', 'ёв',
    'ть', 'чь', 'шь', 'щь', 'ать', 'ять', 'еть',
    'ить', 'оть', 'уть',
    'ет', 'ит', 'ут', 'ют', 'ат', 'ят',
    'ам', 'ям', 'ом', 'ем',
    'ась', 'ясь', 'ишь', 'ешь', 'щи',
    'ся', 'сь',
  ];

  function _lemmatize(word) {
    if (word.length <= 4) return word;
    for (const suffix of RU_SUFFIXES) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }

  /**
   * Синхронная обработка: строит скелет текста.
   * Не использует Web Worker — для больших текстов используйте processAsync().
   * @param {string} text — исходный текст
   * @param {object} opts — настройки: { level: 'light'|'medium'|'aggressive' }
   * @returns {string} компактный скелет
   */
  function process(text, opts = {}) {
    if (!text || !text.trim()) return '';
    const level = opts.level || 'medium';
    return _processSync(text, level);
  }

  function processAsync(text, opts = {}) {
    if (!text || !text.trim()) return Promise.resolve('');
    const level = opts.level || 'medium';
    const key = _cacheKey(level, text);
    const cached = _cache.get(key);
    if (cached !== undefined) {
      _setCache(key, cached);
      return Promise.resolve(cached);
    }
    if (text.length >= WORKER_THRESHOLD) {
      return _processViaWorker(text, level);
    }
    return Promise.resolve(_processSync(text, level));
  }

  /**
   * Синхронная обработка (используется для маленьких текстов и как fallback).
   */
  function _processSync(text, level) {
    const key = _cacheKey(level, text);
    const cached = _cache.get(key);
    if (cached !== undefined) {
      _setCache(key, cached);
      return cached;
    }

    const cfg = _configForLevel(level);
    const sections = _extractSections(text, cfg);
    const parts = [];

    // Заголовок документа
    const title = _extractTitle(text);
    if (title) parts.push(`=== ДОКУМЕНТ ===\n${title}`);

    // Секции (все уровни)
    if (sections.length) {
      parts.push('=== СТРУКТУРА ===');
      sections.forEach(s => {
        const indent = '  '.repeat(Math.max(0, s.level - 1));
        const preview = s.preview ? `\n${indent}  ${s.preview}` : '';
        parts.push(`${indent}${'#'.repeat(s.level)} ${s.heading}${preview}`);
      });
    }

    // Ключевые термины (medium + aggressive)
    if (level !== 'light') {
      const keyTerms = _extractKeyTerms(text, cfg);
      if (keyTerms.length) parts.push(`=== КЛЮЧЕВЫЕ ПОНЯТИЯ ===\n${keyTerms.join(', ')}`);
    }

    // Списки (aggressive)
    if (level === 'aggressive') {
      const lists = _extractLists(text).slice(0, 30);
      if (lists.length) {
        parts.push('=== СПИСКИ ===');
        lists.forEach(l => {
          parts.push(`[${l.context || 'список'}]:`);
          l.items.slice(0, cfg.maxBulletsPerSection).forEach(item => parts.push(`  - ${item}`));
        });
      }
    }

    // Блоки кода (aggressive)
    if (level === 'aggressive') {
      const codeBlocks = _extractCodeBlocks(text).slice(0, 30);
      if (codeBlocks.length) {
        parts.push('=== КОД ===');
        codeBlocks.forEach(b => parts.push(`  [${b.lang || 'code'}] ${b.preview}`));
      }
    }

    // Ссылки (aggressive)
    if (level === 'aggressive') {
      const links = _extractLinks(text).slice(0, 30);
      if (links.length) parts.push(`=== ССЫЛКИ ===\n${links.join('\n')}`);
    }

    // Статистика (все уровни) — считаем после сборки
    if (cfg.includeStats) {
      const tmpResult = parts.join('\n');
      const stats = _computeStats(text, sections, tmpResult.length);
      parts.push(`=== СТАТИСТИКА ===\n${stats}`);
    }

    const result = parts.join('\n');

    _setCache(key, result);

    return result;
  }

  /**
   * Адаптивный порог: считает нужно ли сжимать, исходя из размера контекстного окна модели.
   * @param {number} textLength — длина текста в символах
   * @param {number} contextWindow — размер контекстного окна модели в токенах
   * @returns {boolean} true если нужно сжимать
   */
  function shouldCompress(textLength, contextWindow = 8000) {
    // 1 токен ≈ 3-4 символа для русского
    const charsPerToken = 3.5;
    const maxChars = contextWindow * charsPerToken * 0.5; // 50% контекста на текст
    return textLength > maxChars;
  }

  /**
   * Рекомендуемый уровень сжатия по размеру текста.
   */
  function recommendLevel(textLength) {
    if (textLength < 5000) return null;
    if (textLength < 10000) return 'light';
    if (textLength < 20000) return 'medium';
    return 'aggressive';
  }

  // ── Конфигурация по уровню ──────────────────────────────────

  function _configForLevel(level) {
    const base = {
      maxHeadingLength: 40,
      maxSentenceLength: 40,
      maxKeyTerms: 15,
      maxSections: 10,
      maxBulletsPerSection: 3,
      includeStats: true,
    };
    switch (level) {
      case 'light':
        return { ...base, maxSections: 5, maxKeyTerms: 0, includeStats: true };
      case 'aggressive':
        return { ...base, maxSections: 35, maxKeyTerms: 20, maxBulletsPerSection: 4 };
      default: // medium
        return base;
    }
  }

  // ── Извлечение секций ──────────────────────────────────────

  function _extractSections(text, cfg) {
    const sections = [];
    const lines = text.split('\n');
    let currentSection = null;
    let inFence = false;

    // Инициализируем "нулевую" секцию для текста до первого заголовка
    currentSection = { level: 0, heading: '', preview: '', lines: [] };

    for (let i = 0; i < lines.length && sections.length < cfg.maxSections; i++) {
      const line = lines[i];
      if (/^\s*(`{3}|~{3})/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const headingMatch = line.match(/^ {0,3}(#{1,6})\s+(.+)/);

      if (headingMatch) {
        if (currentSection && (currentSection.heading || currentSection.lines.length)) {
          sections.push(currentSection);
        }
        const level = headingMatch[1].length;
        const heading = headingMatch[2].trim().slice(0, cfg.maxHeadingLength);
        currentSection = { level, heading, preview: '', lines: [] };
      } else if (line.trim()) {
        if (!currentSection) currentSection = { level: 0, heading: '', preview: '', lines: [] };
        currentSection.lines.push(line.trim());
        if (!currentSection.preview) {
          const sentence = _extractFirstSentence(line.trim());
          if (sentence) currentSection.preview = sentence.slice(0, cfg.maxSentenceLength);
        }
      }
    }
    if (currentSection && (currentSection.heading || currentSection.lines.length)) {
      if (sections.length < cfg.maxSections) sections.push(currentSection);
    }

    // Если нет заголовков — разбиваем по абзацам
    if (!sections.length) {
      const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
      paragraphs.slice(0, cfg.maxSections).forEach((p, i) => {
        const firstSentence = _extractFirstSentence(p.trim());
        sections.push({
          level: 1,
          heading: `Абзац ${i + 1}`,
          preview: firstSentence?.slice(0, cfg.maxSentenceLength) || '',
          lines: [],
        });
      });
    }

    return sections;
  }

  const ABBREVIATIONS = new Set([
    'т.е.', 'т.д.', 'т.п.', 'т.к.', 'т.н.', 'т.о.',
    'e.g.', 'i.e.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'inc.', 'vs.',
  ]);

  function _extractFirstSentence(text) {
    const clean = text.replace(/[#*_`>\[\]()]/g, '').trim();
    for (let i = 0; i < clean.length; i++) {
      if ('.!?'.includes(clean[i])) {
        const after = clean[i + 1];
        if (after !== undefined && after !== ' ' && after !== '\n') continue;
        const prefix = clean.slice(0, i + 1).toLowerCase();
        if ([...ABBREVIATIONS].some(abbr => prefix.endsWith(abbr))) continue;
        if (i > 0 && /\d/.test(clean[i - 1]) && after && /\d/.test(after)) continue;
        const sentence = clean.slice(0, i + 1).trim();
        if (sentence) return sentence;
      }
    }
    return clean.slice(0, 200);
  }

  function _extractTitle(text) {
    const lines = text.split('\n');
    let inFence = false;
    for (const line of lines) {
      if (/^\s*(`{3}|~{3})/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const h1 = line.match(/^#\s+(.+)/);
      if (h1) return h1[1].trim().slice(0, 150);
      if (line.trim()) return line.trim().slice(0, 150);
    }
    return null;
  }

  // ── Ключевые термины (лемматизация + защита от отрицаний) ────

  function _extractKeyTerms(text, cfg) {
    if (!cfg.maxKeyTerms) return [];

    const clean = text
      .replace(/^\s*(`{3}|~{3})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
      .replace(/(`+)([\s\S]*?)\1/g, ' ')
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_`>\[\]()]/g, '')
      .toLowerCase();

    // Частотный анализ с лемматизацией и учётом отрицаний
    const freq = new Map();
    const rawWords = clean.match(/[a-zа-яё0-9-]+/g) || [];
    for (let i = 0; i < rawWords.length; i++) {
      const w = rawWords[i];
      if (w.length <= 3 || STOP_WORDS.has(w)) continue;

      // Проверяем окно 3 слова назад — если есть отрицание, пропускаем
      let negated = false;
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (NEGATIONS.has(rawWords[j])) { negated = true; break; }
      }
      if (negated) continue;

      // Лемматизация: приводим к основе
      const lemma = _lemmatize(w);
      freq.set(lemma, (freq.get(lemma) || 0) + 1);
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, cfg.maxKeyTerms)
      .map(([word]) => word);
  }

  // ── Списки ──────────────────────────────────────────────────

  function _extractLists(text) {
    const lists = [];
    const lines = text.split('\n');
    let currentList = null;
    let inFence = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (/^\s*(`{3}|~{3})/.test(line)) { inFence = !inFence; if (currentList && currentList.items.length) { lists.push(currentList); currentList = null; } continue; }
      if (inFence) continue;
      const bulletMatch = line.match(/^\s*[-*+]\s+(.+)/);
      const numMatch = line.match(/^\s*\d+[.)]\s+(.+)/);

      if (bulletMatch || numMatch) {
        const item = (bulletMatch?.[1] || numMatch?.[1]).trim();
        if (!currentList) {
          currentList = { context: '', items: [] };
          for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
            const prev = lines[i].trim();
            if (prev && !prev.match(/^\s*[-*+]\s/) && !prev.match(/^\s*\d+[.)]\s/)) {
              currentList.context = prev.replace(/[#*_`]/g, '').slice(0, 60);
              break;
            }
          }
        }
        currentList.items.push(item);
      } else if (currentList && currentList.items.length) {
        lists.push(currentList);
        currentList = null;
      }
    }
    if (currentList && currentList.items.length) lists.push(currentList);

    return lists;
  }

  // ── Блоки кода ──────────────────────────────────────────────

  function _extractCodeBlocks(text) {
    const blocks = [];
    const regex = /(`{3}|~{3})([^\s`]*)[ \t]*\n?([\s\S]*?)\1/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lang = match[2] || 'code';
      const code = match[3].trim();
      const firstLine = code.split('\n')[0].trim().slice(0, 100);
      blocks.push({ lang, preview: firstLine || '(пусто)' });
    }
    return blocks;
  }

  // ── Ссылки ──────────────────────────────────────────────────

  function _extractLinks(text) {
    const links = new Set();
    const regex = /https?:\/\/[^\s'"<>)]{10,200}/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      links.add(match[0]);
    }
    return [...links];
  }

  // ── Статистика ──────────────────────────────────────────────

  function _computeStats(text, sections, resultLength) {
    const chars = text.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim()).length;
    const headings = sections.length;
    const ratio = resultLength > 0 ? (chars / resultLength).toFixed(1) : '?';
    return `${chars} символов → ~${ratio}x сжатие | ${words} слов | ${headings} секций`;
  }

  // ── Публичный API ──────────────────────────────────────────

  return { process, processAsync, shouldCompress, recommendLevel, DEFAULTS: { level: 'medium' } };
})();
