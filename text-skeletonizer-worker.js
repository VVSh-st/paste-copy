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
    default:
      return base;
  }
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

function _extractSections(text, cfg) {
  const sections = [];
  const lines = text.split('\n');
  let currentSection = null;
  for (let i = 0; i < lines.length && sections.length < cfg.maxSections; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
  if (currentSection && sections.length < cfg.maxSections) sections.push(currentSection);
      currentSection = { level: headingMatch[1].length, heading: headingMatch[2].trim().slice(0, cfg.maxHeadingLength), preview: '', lines: [] };
    } else if (currentSection && line.trim()) {
      currentSection.lines.push(line.trim());
      if (!currentSection.preview) {
        const sentence = _extractFirstSentence(line.trim());
        if (sentence) currentSection.preview = sentence.slice(0, cfg.maxSentenceLength);
      }
    }
  }
  if (currentSection) sections.push(currentSection);
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
  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/#{1,6}\s/g, '').replace(/[*_`>\[\]()]/g, '').toLowerCase();
  const freq = new Map();
  const rawWords = clean.split(/\s+/);
  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    if (w.length <= 3 || STOP_WORDS.has(w)) continue;
    if (i > 0 && NEGATIONS.has(rawWords[i - 1])) continue;
    const lemma = _lemmatize(w);
    freq.set(lemma, (freq.get(lemma) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, cfg.maxKeyTerms).map(([word]) => word);
}

function _extractLists(text) {
  const lists = [];
  const lines = text.split('\n');
  let currentList = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
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
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || 'code', preview: match[2].trim().split('\n')[0].trim().slice(0, 100) || '(пусто)' });
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

function process(text, level) {
  if (!text || !text.trim()) return '';
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
    const lists = _extractLists(text);
    if (lists.length) {
      parts.push('=== СПИСКИ ===');
      lists.forEach(l => {
        parts.push(`[${l.context || 'список'}]:`);
        l.items.slice(0, cfg.maxBulletsPerSection).forEach(item => parts.push(`  - ${item}`));
      });
    }
    const codeBlocks = _extractCodeBlocks(text);
    if (codeBlocks.length) {
      parts.push('=== КОД ===');
      codeBlocks.forEach(b => parts.push(`  [${b.lang || 'code'}] ${b.preview}`));
    }
    const links = _extractLinks(text);
    if (links.length) parts.push(`=== ССЫЛКИ ===\n${links.slice(0, 10).join('\n')}`);
  }
  if (cfg.includeStats) {
    const chars = text.length;
    const words = text.split(/\s+/).filter(Boolean).length;
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim()).length;
    const kb = (chars / 1024).toFixed(1);
    parts.push(`=== СТАТИСТИКА ===\n${kb} KB | ${words} слов | ${paragraphs} абзацев | ${sections.length} секций`);
  }
  return parts.join('\n');
}

// ── Worker обработчик ──────────────────────────────────────────

self.onmessage = function(e) {
  const { text, level, id } = e.data;
  try {
    const result = process(text, level);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
