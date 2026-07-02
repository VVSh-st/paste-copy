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

  // ── Web Worker ──────────────────────────────────────────────
  let _worker = null;
  let _workerReady = false;
  let _workerCallbacks = new Map();
  let _workerId = 0;
  const WORKER_THRESHOLD = 20000; // используем Worker для текстов >20K

  function _initWorker() {
    if (_worker || typeof Worker === 'undefined') return;
    try {
      _worker = new Worker('text-skeletonizer-worker.js');
      _worker.onmessage = (e) => {
        const { id, result, error } = e.data;
        const cb = _workerCallbacks.get(id);
        if (cb) {
          _workerCallbacks.delete(id);
          if (error) cb.reject(new Error(error));
          else cb.resolve(result);
        }
      };
      _worker.onerror = () => { _workerReady = false; };
      _workerReady = true;
    } catch {
      _worker = null;
    }
  }

  function _processViaWorker(text, level) {
    return new Promise((resolve, reject) => {
      if (!_worker || !_workerReady) {
        resolve(_processSync(text, level));
        return;
      }
      const id = ++_workerId;
      _workerCallbacks.set(id, { resolve, reject });
      _worker.postMessage({ text, level, id });
      // Fallback: если Worker не ответил за 2 сек — синхронно
      setTimeout(() => {
        if (_workerCallbacks.has(id)) {
          _workerCallbacks.delete(id);
          resolve(_processSync(text, level));
        }
      }, 2000);
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
    'ований', 'еваний', 'ировани',                    // 7-8
    'ования', 'евания', 'ирова', 'ующих', 'ующем',     // 6-7
    'овала', 'евала', 'ировал', 'оваться', 'еваться',  // 6
    'ующие', 'ующее', 'ующий', 'ующей', 'ующую',       // 6
    'ание', 'ение', 'иться', 'аться', 'яться',         // 5
    'ний', 'ний', 'тие', 'сть', 'ние', 'ции',         // 4
    'ый', 'ий', 'ой', 'ей', 'ый', 'ая', 'яя',        // 3-4
    'ое', 'ые', 'ий', 'ов', 'ев', 'ёв',               // 3-4
    'ть', 'чь', 'шь', 'щь', 'ать', 'ять', 'еть',     // 3
    'ить', 'оть', 'уть', 'ить', 'ать', 'ять',         // 3
    'ет', 'ит', 'ут', 'ют', 'ат', 'ят',               // 2-3
    'ам', 'ям', 'ом', 'ем', 'ой', 'ей',               // 2
    'ась', 'ясь', 'ишь', 'ешь', 'щи',                  // 2-3
    'ся', 'сь',                                        // 2
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
   * Основная функция: строит скелет текста.
   * Для текстов >20K автоматически использует Web Worker.
   * @param {string} text — исходный текст
   * @param {object} opts — настройки: { level: 'light'|'medium'|'aggressive' }
   * @returns {string|Promise<string>} компактный скелет (sync для маленьких, async для больших)
   */
  function process(text, opts = {}) {
    if (!text || !text.trim()) return '';
    const level = opts.level || 'medium';

    // Кэширование
    const key = _hash(text) + ':' + level;
    if (_cache.has(key)) return _cache.get(key);

    // Для больших текстов — через Worker
    if (text.length > WORKER_THRESHOLD && _workerReady) {
      return _processViaWorker(text, level).then(result => {
        if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
        _cache.set(key, result);
        return result;
      });
    }

    // Для маленьких — синхронно
    const result = _processSync(text, level);
    if (_cache.size >= MAX_CACHE) _cache.delete(_cache.keys().next().value);
    _cache.set(key, result);
    return result;
  }

  /**
   * Синхронная обработка (используется для маленьких текстов и как fallback).
   */
  function _processSync(text, level) {

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
      const lists = _extractLists(text);
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
      const codeBlocks = _extractCodeBlocks(text);
      if (codeBlocks.length) {
        parts.push('=== КОД ===');
        codeBlocks.forEach(b => parts.push(`  [${b.lang || 'code'}] ${b.preview}`));
      }
    }

    // Ссылки (aggressive)
    if (level === 'aggressive') {
      const links = _extractLinks(text);
      if (links.length) parts.push(`=== ССЫЛКИ ===\n${links.slice(0, 10).join('\n')}`);
    }

    // Статистика (все уровни)
    if (cfg.includeStats) {
      const stats = _computeStats(text, sections);
      parts.push(`=== СТАТИСТИКА ===\n${stats}`);
    }

    const result = parts.join('\n');

    // Сохраняем в кэш
    if (_cache.size >= MAX_CACHE) {
      const firstKey = _cache.keys().next().value;
      _cache.delete(firstKey);
    }
    _cache.set(key, result);

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
    if (textLength < 5000) return null; // не сжимать
    if (textLength < 15000) return 'light';
    if (textLength < 50000) return 'medium';
    return 'aggressive';
  }

  // ── Конфигурация по уровню ──────────────────────────────────

  function _configForLevel(level, opts) {
    const base = {
      maxHeadingLength: 120,
      maxSentenceLength: 200,
      maxKeyTerms: 30,
      maxSections: 40,
      maxBulletsPerSection: 5,
      includeStats: true,
    };
    switch (level) {
      case 'light':
        return { ...base, maxSections: 20, maxKeyTerms: 0, includeStats: true };
      case 'aggressive':
        return { ...base, maxSections: 60, maxKeyTerms: 50, maxBulletsPerSection: 8 };
      default: // medium
        return base;
    }
  }

  // ── Извлечение секций ──────────────────────────────────────

  function _extractSections(text, cfg) {
    const sections = [];
    const lines = text.split('\n');
    let currentSection = null;

    for (let i = 0; i < lines.length && sections.length < cfg.maxSections; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

      if (headingMatch) {
        if (currentSection) sections.push(currentSection);
        const level = headingMatch[1].length;
        const heading = headingMatch[2].trim().slice(0, cfg.maxHeadingLength);
        currentSection = { level, heading, preview: '', lines: [] };
      } else if (currentSection && line.trim()) {
        currentSection.lines.push(line.trim());
        if (!currentSection.preview) {
          const sentence = _extractFirstSentence(line.trim());
          if (sentence) currentSection.preview = sentence.slice(0, cfg.maxSentenceLength);
        }
      }
    }
    if (currentSection) sections.push(currentSection);

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

  function _extractFirstSentence(text) {
    const clean = text.replace(/[#*_`>\[\]()]/g, '').trim();
    const match = clean.match(/^[^.!?]*[.!?]\s/);
    return match ? match[0].trim() : clean.slice(0, 200);
  }

  function _extractTitle(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      const h1 = line.match(/^#\s+(.+)/);
      if (h1) return h1[1].trim().slice(0, 150);
      if (line.trim() && !line.startsWith('```')) return line.trim().slice(0, 150);
    }
    return null;
  }

  // ── Ключевые термины (лемматизация + защита от отрицаний) ────

  function _extractKeyTerms(text, cfg) {
    if (!cfg.maxKeyTerms) return [];

    const clean = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_`>\[\]()]/g, '')
      .toLowerCase();

    // Частотный анализ с лемматизацией и учётом отрицаний
    const freq = new Map();
    const rawWords = clean.split(/\s+/);
    for (let i = 0; i < rawWords.length; i++) {
      const w = rawWords[i];
      if (w.length <= 3 || STOP_WORDS.has(w)) continue;

      // Проверяем предыдущее слово — если отрицание, пропускаем
      if (i > 0 && NEGATIONS.has(rawWords[i - 1])) continue;

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

    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*+]\s+(.+)/);
      const numMatch = line.match(/^\s*\d+[.)]\s+(.+)/);

      if (bulletMatch || numMatch) {
        const item = (bulletMatch?.[1] || numMatch?.[1]).trim();
        if (!currentList) {
          currentList = { context: '', items: [] };
          const idx = lines.indexOf(line);
          for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
            const prev = lines[i].trim();
            if (prev && !prev.match(/^\s*[-*+]\s/) && !prev.match(/^\s*\d+[.)]\s/)) {
              currentList.context = prev.replace(/[#*_`]/g, '').slice(0, 60);
              break;
            }
          }
        }
        currentList.items.push(item);
      } else {
        if (currentList && currentList.items.length) {
          lists.push(currentList);
          currentList = null;
        }
      }
    }
    if (currentList && currentList.items.length) lists.push(currentList);

    return lists;
  }

  // ── Блоки кода ──────────────────────────────────────────────

  function _extractCodeBlocks(text) {
    const blocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lang = match[1] || 'code';
      const code = match[2].trim();
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

  function _computeStats(text, sections) {
    const chars = text.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim()).length;
    const headings = sections.length;
    const kb = (chars / 1024).toFixed(1);
    return `${kb} KB | ${words} слов | ${paragraphs} абзацев | ${headings} секций`;
  }

  // ── Публичный API ──────────────────────────────────────────

  return { process, shouldCompress, recommendLevel, DEFAULTS: { level: 'medium' } };
})();
