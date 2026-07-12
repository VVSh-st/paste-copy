// file_name: quality-detectors.js

/* ============================================================
   QualityDetectors — deterministic-анализ промпта без LLM
   ============================================================ */
(function () {
  'use strict';

  const PLACEHOLDER_RE = /\{\{\s*[^}\n]{1,80}\s*\}\}/g;
  const SECTION_LABEL_RE = /^\s*(#{1,6}\s+)?(роль|role|контекст|context|задача|task|цель|требования|requirements|constraints|ограничения|правила|rules|формат|output|вывод|пример|examples?|данные|input|код|code)\s*[:：\-–—]?/i;

  function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 3.5);
  }

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[ё]/g, 'е')
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getTextBlocks(tab, _depth = 0) {
    if (_depth > 20) return [];
    const out = [];
    const walk = (blocks, depth) => (blocks || []).forEach(block => {
      if (!block || block.previewDisabled === true) return;
      if (block.type === 'text') {
        const idx = Number.isInteger(block.activeSubtab) ? block.activeSubtab : 0;
        const value = String(block.subtabs?.[idx]?.value || '');
        if (value.trim()) {
          out.push({
            id: block.id,
            title: block.title || 'Блок',
            value,
            chars: value.length,
            kind: window.PromptLoom?.classify?.(value) || classifyFallback(value)
          });
        }
      } else if (block.type === 'group' && block.enabled !== false) {
        if (depth < 20) walk(block.children || [], depth + 1);
      }
    });
    walk(tab?.blocks || [], _depth);
    return out;
  }

  function classifyFallback(text) {
    const raw = String(text || '').trim();
    if (!raw) return 'text';
    if ((raw.startsWith('{') || raw.startsWith('[')) && raw.length < 150000) {
      try { JSON.parse(raw); return 'json'; } catch (_) {}
    }
    if (/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(raw)) return 'markdown';
    if (/^(отвечай|ответь|напиши|сделай|используй|объясни|проверь|найди|сократи|переведи|оформи)/i.test(raw)) return 'instruction';
    if (/(```|\b(function|const|let|var|class|return|async|await)\b|=>)/.test(raw)) return 'code';
    return 'text';
  }

  function makeTokenSet(text) {
    return new Set(normalize(text).split(' ').filter(w => w.length > 2));
  }

  // 0.82 — эмпирический коэффициент: containment на коротких блоках
  // завышает оценку, 0.82 снижает ложные срабатывания при пороге 0.72
  const SIMILARITY_CONTAINMENT_FACTOR = 0.82;
  const DUPLICATE_THRESHOLD = 0.72;

  function similarityFromTokenSets(a, b) {
    if (window.PromptLoom?.similarityScore) {
      const score = Number(window.PromptLoom.similarityScore(a, b));
      if (Number.isFinite(score)) return Math.max(0, Math.min(1, score));
    }

    const at = makeTokenSet(a);
    const bt = makeTokenSet(b);
    if (!at.size || !bt.size) return 0;
    let hits = 0;
    at.forEach(t => { if (bt.has(t)) hits += 1; });
    const denom = at.size + bt.size - hits;
    const jaccard = denom ? hits / denom : 0;
    const containment = hits / Math.min(at.size, bt.size);
    return Math.max(jaccard, containment * SIMILARITY_CONTAINMENT_FACTOR);
  }

  function findDuplicatesFromBlocks(blocks) {
    const filtered = blocks
      .filter(b => normalize(b.value).length > 80)
      .map(b => ({ ...b, tokenSet: makeTokenSet(b.value) }));
    const duplicates = [];

    for (let i = 0; i < filtered.length; i += 1) {
      for (let j = i + 1; j < filtered.length; j += 1) {
        const a = filtered[i];
        const b = filtered[j];
        const score = similarityFromTokenSets(a.value, b.value);

        if (score >= DUPLICATE_THRESHOLD) {
          duplicates.push({
            a: { id: a.id, title: a.title, chars: a.chars },
            b: { id: b.id, title: b.title, chars: b.chars },
            score: Number(score.toFixed(2))
          });
        }
      }
    }

    return duplicates.sort((x, y) => y.score - x.score).slice(0, 8);
  }

  function findPlaceholders(text) {
    const seen = new Set();
    const out = [];
    const raw = String(text || '');
    for (const m of raw.matchAll(PLACEHOLDER_RE)) {
      const item = m[0].trim();
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
      if (out.length >= 20) break;
    }
    return out;
  }

  function findFormatConflicts(text) {
    const raw = String(text || '');
    const low = raw.toLowerCase();
    const conflicts = [];

    const wantsJson = /\b(json|валидный json|только json|объект json)\b/i.test(raw);
    const wantsMarkdown = /\b(markdown|md|таблиц[ауы] markdown|заголовк[иов]*|списком)\b/i.test(raw) || /^\s*#{1,6}\s/m.test(raw);
    const wantsPlain = /(без markdown|не используй markdown|plain text|обычный текст)/i.test(raw);

    if (wantsJson && wantsMarkdown) {
      conflicts.push({ type: 'format', severity: 'medium', message: 'Есть одновременно JSON и Markdown-инструкции' });
    }
    if (wantsMarkdown && wantsPlain) {
      conflicts.push({ type: 'format', severity: 'medium', message: 'Есть одновременно Markdown и запрет на Markdown' });
    }
    if (/\b(кратко|лаконично|коротко)\b/i.test(low) && /\b(подробно|детально|развернуто|максимально подробно)\b/i.test(low)) {
      conflicts.push({ type: 'verbosity', severity: 'low', message: 'Есть конфликт краткости и подробности' });
    }

    return conflicts;
  }

  function estimateStructureFromBlocks(blocks) {
    const titles = blocks.map(b => b.title).join('\n').toLowerCase();
    let text = '';
    for (const b of blocks) {
      if (text.length >= 20000) break;
      text += '\n' + b.value.toLowerCase().slice(0, 20000 - text.length);
    }
    const joined = titles + '\n' + text;

    const structure = {
      hasRole: /(роль|role|ты\s+[—-]|you are|выступи)/i.test(joined),
      hasContext: /(контекст|context|background|исходные данные)/i.test(joined),
      hasTask: /(задача|task|цель|сделай|проанализируй)/i.test(joined),
      hasConstraints: /(ограничения|constraints|правила|rules|не\s+делай|нельзя|обязательно)/i.test(joined),
      hasOutputFormat: /(формат|output|вывод|ответ в формате|структура ответа|json|markdown)/i.test(joined),
      disciplineScore: 0
    };

    const hits = ['hasRole', 'hasContext', 'hasTask', 'hasConstraints', 'hasOutputFormat'].filter(k => structure[k]).length;
    structure.disciplineScore = Number((hits / 5).toFixed(2));
    return structure;
  }

  function detectLanguage(text) {
    const raw = String(text || '');
    if (raw.length < 20) return 'mixed';
    const ru = (raw.match(/[а-яё]/gi) || []).length;
    const en = (raw.match(/[a-z]/gi) || []).length;
    if (ru > en * 0.35) return 'ru';
    if (en > ru * 2) return 'en';
    return 'mixed';
  }

  function detectPromptDisciplineFromBlocks(blocks) {
    const filled = blocks.length;
    const named = blocks.filter(b => b.title && b.title !== 'Блок').length;
    const longBlocks = blocks.filter(b => b.chars > 3500).length;
    const emptyTitles = Math.max(0, filled - named);

    let score = 0.45;
    score += Math.min(0.25, named / Math.max(1, filled) * 0.25);
    score += Math.min(0.2, filled / 8 * 0.2);
    score -= Math.min(0.2, longBlocks * 0.06);
    score -= Math.min(0.12, emptyTitles * 0.03);

    return Number(Math.max(0, Math.min(1, score)).toFixed(2));
  }

  function getHeavyBlocksFromBlocks(blocks) {
    return blocks
      .sort((a, b) => b.chars - a.chars)
      .slice(0, 5)
      .map(b => ({ id: b.id, title: b.title, chars: b.chars, tokens: estimateTokens(b.value), kind: b.kind }));
  }

  function cleanSectionTitle(line, index) {
    const raw = String(line || '').trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/[:：\-–—]+\s*$/, '')
      .trim();
    if (!raw) return `Часть ${index + 1}`;
    return raw.slice(0, 56);
  }

  function splitByHeadings(lines) {
    const sections = [];
    let current = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      const isHeading = /^#{1,6}\s+\S/.test(trimmed) || SECTION_LABEL_RE.test(trimmed);
      if (isHeading) {
        if (current && current.value.trim()) sections.push(current);
        current = { title: cleanSectionTitle(trimmed, sections.length), value: '' };
        return;
      }
      if (!current) current = { title: 'Вводный контекст', value: '' };
      current.value += (current.value ? '\n' : '') + line;
    });

    if (current && current.value.trim()) sections.push(current);
    return sections;
  }

  function splitByParagraphs(lines) {
    const raw = lines.join('\n');
    return raw
      .split(/\n{2,}/)
      .map(part => part.trim())
      .filter(part => part.length > 120)
      .slice(0, 8)
      .map((part, index) => {
        const first = part.split('\n').find(Boolean) || '';
        const title = cleanSectionTitle(first.length < 64 ? first : `Часть ${index + 1}`, index);
        return { title, value: part };
      });
  }

  function splitIntoSections(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').trim();
    if (raw.length < 900) {
      return [{
        title: 'Весь текст',
        value: raw,
        chars: raw.length,
        tokens: estimateTokens(raw),
        kind: classifyFallback(raw)
      }];
    }

    const lines = raw.split('\n');
    let sections = splitByHeadings(lines)
      .map(s => ({ title: s.title, value: String(s.value || '').trim() }))
      .filter(s => s.value.length >= 80);

    if (sections.length < 2) sections = splitByParagraphs(lines);
    if (sections.length < 2) return [];

    return sections.slice(0, 10).map((section, index) => ({
      title: section.title || `Часть ${index + 1}`,
      value: section.value,
      chars: section.value.length,
      tokens: estimateTokens(section.value),
      kind: classifyFallback(section.value)
    }));
  }

  function findStructureCandidate(tab, event) {
    if (!tab || event?.type !== 'block.paste' || Number(event.chars) < 1200 || !event.blockId) return null;
    const block = window.State?.findBlock?.(tab.blocks || [], event.blockId);
    if (!block || block.type !== 'text') return null;
    const idx = Number.isInteger(block.activeSubtab) ? block.activeSubtab : 0;
    const value = String(block.subtabs?.[idx]?.value || '');
    if (value.length < Math.max(900, Number(event.chars) * 0.75)) return null;

    const sections = splitIntoSections(value);
    if (sections.length < 2) return null;

    return {
      blockId: block.id,
      title: block.title || 'Блок',
      chars: value.length,
      sections: sections.map(s => ({ title: s.title, chars: s.chars, tokens: s.tokens, kind: s.kind }))
    };
  }

  function analyzePreview(text, tab) {
    const raw = String(text || '');
    const blocks = getTextBlocks(tab);
    const duplicates = findDuplicatesFromBlocks(blocks);
    const placeholders = findPlaceholders(raw);
    const conflicts = findFormatConflicts(raw);
    const structure = estimateStructureFromBlocks(blocks);

    return {
      previewChars: raw.length,
      estimatedTokens: estimateTokens(raw),
      blockCount: Array.isArray(tab?.blocks) ? tab.blocks.length : 0,
      textBlockCount: blocks.length,
      language: detectLanguage(raw),
      duplicates,
      conflicts,
      placeholders,
      heavyBlocks: getHeavyBlocksFromBlocks([...blocks]),
      structure,
      promptDiscipline: detectPromptDisciplineFromBlocks(blocks)
    };
  }

  function findDuplicates(tab) {
    return findDuplicatesFromBlocks(getTextBlocks(tab));
  }

  function estimateStructure(tab) {
    return estimateStructureFromBlocks(getTextBlocks(tab));
  }

  function detectPromptDiscipline(tab) {
    return detectPromptDisciplineFromBlocks(getTextBlocks(tab));
  }

  function getHeavyBlocks(tab) {
    return getHeavyBlocksFromBlocks(getTextBlocks(tab));
  }

  window.QualityDetectors = {
    analyzePreview,
    findDuplicates,
    findPlaceholders,
    findFormatConflicts,
    estimateStructure,
    detectLanguage,
    detectPromptDiscipline,
    getTextBlocks,
    getHeavyBlocks,
    splitIntoSections,
    findStructureCandidate,
    estimateTokens
  };
})();
