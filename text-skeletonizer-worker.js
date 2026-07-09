/**
 * TextSkeletonizer Web Worker — выполняет сжатие текста в отдельном потоке.
 * Получает { text, level, id } и возвращает { id, result }.
 */

// Импортируем логику (копия основных функций из text-skeletonizer.js)
// Worker не может использовать замыкания IIFE, поэтому код дублируется.

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

const NEGATIONS = new Set(['не', 'нет', 'без', 'ни', 'никак', 'никогда', 'ничего']);

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
      return { ...base, maxSections: 20, maxKeyTerms: 20, maxBulletsPerSection: 4 };
    default:
      return base;
  }
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
      currentSection = { level: headingMatch[1].length, heading: headingMatch[2].trim().slice(0, cfg.maxHeadingLength), preview: '', lines: [] };
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
  if (!sections.length) {
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
    paragraphs.slice(0, cfg.maxSections).forEach((p, i) => {
      sections.push({ level: 1, heading: `Абзац ${i + 1}`, preview: _extractFirstSentence(p.trim())?.slice(0, cfg.maxSentenceLength) || '', lines: [] });
    });
  }
  return sections;
}

function _extractKeyTerms(text, cfg) {
  if (!cfg.maxKeyTerms) return [];
  const clean = text.replace(/^\s*(`{3}|~{3})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/(`+)([\s\S]*?)\1/g, ' ').replace(/#{1,6}\s/g, '').replace(/[*_`>\[\]()]/g, '').toLowerCase();
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
    const lemma = _lemmatize(w);
    freq.set(lemma, (freq.get(lemma) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, cfg.maxKeyTerms).map(([word]) => word);
}

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

function _extractCodeBlocks(text) {
  const blocks = [];
  const regex = /(`{3}|~{3})([^\s`]*)[ \t]*\n?([\s\S]*?)\1/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[2] || 'code', preview: match[3].trim().split('\n')[0].trim().slice(0, 100) || '(пусто)' });
  }
  return blocks;
}

function _extractLinks(text) {
  const links = new Set();
  const regex = /https?:\/\/[^\s'"<>)]{10,200}/g;
  let match;
  while ((match = regex.exec(text)) !== null) links.add(match[0]);
  return [...links];
}

function _computeStats(text, sections, resultLength) {
  const chars = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const headings = sections.length;
  const ratio = resultLength > 0 ? (chars / resultLength).toFixed(1) : '?';
  return `${chars} символов → ~${ratio}x сжатие | ${words} слов | ${headings} секций`;
}

function process(text, level) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const cfg = _configForLevel(level);
  const sections = _extractSections(text, cfg);
  const parts = [];
  const title = _extractTitle(text);
  if (title) parts.push(`=== ДОКУМЕНТ ===\n${title}`);
  if (sections.length) {
    parts.push('=== СТРУКТУРА ===');
    sections.forEach(s => {
      const indent = '  '.repeat(Math.max(0, s.level - 1));
      const preview = s.preview ? `\n${indent}  ${s.preview}` : '';
      parts.push(`${indent}${'#'.repeat(s.level)} ${s.heading}${preview}`);
    });
  }
  if (level !== 'light') {
    const keyTerms = _extractKeyTerms(text, cfg);
    if (keyTerms.length) parts.push(`=== КЛЮЧЕВЫЕ ПОНЯТИЯ ===\n${keyTerms.join(', ')}`);
  }
  if (level === 'aggressive') {
    const lists = _extractLists(text).slice(0, 30);
    if (lists.length) {
      parts.push('=== СПИСКИ ===');
      lists.forEach(l => {
        parts.push(`[${l.context || 'список'}]:`);
        l.items.slice(0, cfg.maxBulletsPerSection).forEach(item => parts.push(`  - ${item}`));
      });
    }
    const codeBlocks = _extractCodeBlocks(text).slice(0, 30);
    if (codeBlocks.length) {
      parts.push('=== КОД ===');
      codeBlocks.forEach(b => parts.push(`  [${b.lang || 'code'}] ${b.preview}`));
    }
    const links = _extractLinks(text).slice(0, 30);
    if (links.length) parts.push(`=== ССЫЛКИ ===\n${links.join('\n')}`);
  }
  if (cfg.includeStats) {
    const tmpResult = parts.join('\n');
    parts.push(`=== СТАТИСТИКА ===\n${_computeStats(text, sections, tmpResult.length)}`);
  }
  return parts.join('\n');
}

// ── Worker обработчик ──────────────────────────────────────────

self.onmessage = function(e) {
  try {
    const { text, level, id } = e.data || {};
    const result = process(text, level);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id: e.data?.id, error: String(err.message || err) });
  }
};
