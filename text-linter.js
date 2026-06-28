// file_name: text-linter.js
'use strict';

/* ============================================================
   TextLinter — локальная безопасная «причёска» текстовых блоков
   ============================================================ */
window.TextLinter = (() => {
  const STORAGE_KEY = 'llm-pb-text-linter-v1';

  const DEFAULT_SETTINGS = {
    trimLines: true,
    collapseSpaces: true,
    punctuationSpacing: true,
    normalizeNbsp: false,
    normalizeAbbreviations: true,
    compactAbbreviations: false,
    collapseBlankLines: true,
    showHints: true,
    capitalAfterPunctuation: false,
    finalPeriod: false,
    redLine: false,
    paragraphBreaks: false,
    matrixAcceptEffect: true,
    removeInvisibleChars: true,
    normalizeDashes: false,
    normalizeQuotes: false,
    normalizeEllipsis: true,
    normalizeAllNbsp: false,
  };

  const SAFE_LINE_SKIP_RE = /^\s*(?:!\S*|\/(?:system|user|assistant|developer)\b|```|~~~)/i;
  const JSONISH_LINE_RE = /^\s*(?:[\[{]\s*|[\]}]\s*,?)(?:\s*(?:\/\/.*|#.*))?\s*$/u;
  const JSON_PAIR_LINE_RE = /^\s*"[^"\n]+"\s*:\s*(?:"(?:\\.|[^"])*"|-?\d+(?:\.\d+)?|true|false|null|\{.*\}|\[.*\])\s*,?\s*$/u;
  const INDENTED_CODE_LINE_RE = /^(?: {4,}|\t)\S/u;
  const NESTED_MARKDOWN_LINE_RE = /^ {2,}(?:(?:[-*+]|>)\s+|\d+[.)]\s+)/u;
  const MARKDOWN_TABLE_LINE_RE = /^\s*\|.*\|\s*$/u;
  const SENTENCE_END_RE = /[.!?…]$/u;
  const LIST_OR_HEADING_RE = /^\s*(?:[-*+>]\s+|\d+[.)]\s+|#{1,6}\s+|\|)/u;
  const PLACEHOLDER_RE = /\uE000\d+\uE001/u;
  const PLACEHOLDER_FULL_RE = /^\uE000\d+\uE001$/u;
  const PLACEHOLDER_AT_EDGE_RE = /^\uE000\d+\uE001|\uE000\d+\uE001$/u;
  const SHORT_ABBR_RE = /(?:^|[^\p{L}\p{N}_])(?:[а-яё]\s*\.|[A-ZА-ЯЁ]{1,4}\s*\.){2,}(?:$|[^\p{L}\p{N}_])/u;
  const ABBREVIATION_DOT_BEFORE_WORD_RE = /(?:^|\s)(?:и\s+)?т\.\s?д\.$|(?:^|\s)(?:и\s+)?т\.\s?п\.$|(?:^|\s)т\.\s?[екно]\.$|(?:^|\s)в\s+т\.\s?ч\.$|(?:^|\s)(?:до\s+)?н\.\s?э\.$/iu;
  const ABBREVIATION_RULES = [
    // Более длинные варианты идут первыми, чтобы статистика и замены не дробились.
    { re: /(^|[^\p{L}\p{N}_])и\s*т\s*\.\s*д\s*\./giu, value: '$1и т. д.' },
    { re: /(^|[^\p{L}\p{N}_])и\s*т\s*\.\s*п\s*\./giu, value: '$1и т. п.' },
    { re: /(^|[^\p{L}\p{N}_])в\s*т\s*\.\s*ч\s*\./giu, value: '$1в т. ч.' },
    { re: /(^|[^\p{L}\p{N}_])до\s+н\s*\.\s*э\s*\./giu, value: '$1до н. э.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*д\s*\./giu, value: '$1т. д.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*п\s*\./giu, value: '$1т. п.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*е\s*\./giu, value: '$1т. е.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*к\s*\./giu, value: '$1т. к.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*н\s*\./giu, value: '$1т. н.' },
    { re: /(^|[^\p{L}\p{N}_])т\s*\.\s*о\s*\./giu, value: '$1т. о.' },
    { re: /(^|[^\p{L}\p{N}_])н\s*\.\s*э\s*\./giu, value: '$1н. э.' },
  ];
  const ABBREVIATION_STYLE_RULES = [
    { from: 'и т. д.', to: 'и т.д.' },
    { from: 'и т. п.', to: 'и т.п.' },
    { from: 'в т. ч.', to: 'в т.ч.' },
    { from: 'до н. э.', to: 'до н.э.' },
    { from: 'т. д.', to: 'т.д.' },
    { from: 'т. п.', to: 'т.п.' },
    { from: 'т. е.', to: 'т.е.' },
    { from: 'т. к.', to: 'т.к.' },
    { from: 'т. н.', to: 'т.н.' },
    { from: 'т. о.', to: 'т.о.' },
    { from: 'н. э.', to: 'н.э.' },
  ];
  const ABBREVIATION_TRAILING_SPACE_RE = /((?:и\s+)?т\.\s?д\.|(?:и\s+)?т\.\s?п\.|т\.\s?е\.|т\.\s?к\.|т\.\s?н\.|т\.\s?о\.|в\s+т\.\s?ч\.|до\s+н\.\s?э\.|н\.\s?э\.)(?=[\p{L}«"'])/giu;
  const HINT_RULES = [
    { id: 'comma-chto', re: /(?:^|[^\p{L}\p{N}_])(?:то|так|думаю|кажется|важно|нужно|понятно|видно|считаю|знаю|вижу|помню|похоже|выходит)\s+что(?:$|[^\p{L}\p{N}_])/giu, text: 'возможна запятая перед «что»' },
    { id: 'comma-esli-before', re: /(?:^|[^\p{L}\p{N}_])(?:но|и|то|это|лучше|важно|нужно|можно|стоит|проверь|пиши|скажи|сделай)\s+если(?:$|[^\p{L}\p{N}_])/giu, text: 'возможна запятая перед «если»' },
    { id: 'comma-esli-after', re: /^\s*если\b[^.!?…\n,]{18,}(?:\s+(?:то|значит|можно|нужно|стоит|лучше|пиши|скажи|сделай|проверь)\b)/iu, text: 'возможна запятая после придаточной части с «если»' },
    { id: 'comma-a', re: /[^\p{L}\p{N}_]а\s+(?:если|когда|потом|затем|это|лучше|надо|нужно|можно|значит|вот)(?:$|[^\p{L}\p{N}_])/giu, text: 'проверь запятую перед «а»' },
    { id: 'comma-kotory', re: /(?:^|[^\p{L}\p{N}_])котор(?:ый|ая|ое|ые|ого|ую|ыми|ых)(?:$|[^\p{L}\p{N}_])/giu, text: 'обычно перед «который» нужна запятая' },
    { id: 'comma-no', re: /(?:^|[^\p{L}\p{N}_])но\s+(?:это|если|когда|потом|затем|при|без|надо|нужно|можно|лучше)(?:$|[^\p{L}\p{N}_])/giu, text: 'проверь запятую перед «но»' },
    { id: 'long-sentence', re: /[^.!?…\n]{220,}[.!?…]?/gu, text: 'длинное предложение: возможно, стоит разбить' },
    { id: 'many-commas', re: /(?:[^.!?…\n]*,[^.!?…\n]*){5,}/gu, text: 'много запятых в одном предложении: возможно, лучше разбить' },
    { id: 'double-word', re: /(?:^|[^\p{L}\p{N}_])([\p{L}\p{N}_]{3,})\s+\1(?:$|[^\p{L}\p{N}_])/giu, text: 'похоже на повтор слова' },
  ];

  let settings = loadSettings();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  function getSettings() {
    return { ...settings };
  }

  function setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    settings[key] = !!value;
    saveSettings();
  }

  function getSettingMeta() {
    return [
      { key: 'trimLines', label: 'Обрезать края строк' },
      { key: 'collapseSpaces', label: 'Схлопывать лишние пробелы' },
      { key: 'punctuationSpacing', label: 'Пробелы у знаков препинания' },
      { key: 'normalizeNbsp', label: 'Неразрывные пробелы после коротких предлогов', risky: true },
      { key: 'removeInvisibleChars', label: 'Удалить невидимые символы (zero-width)', hint: 'Нулевые пробелы, символы соединения слов и другие невидимые Unicode-артефакты AI-текста' },
      { key: 'normalizeDashes', label: 'Нормализовать тире (—, – → -)', risky: true, hint: 'Длинное и короткое тире заменяются дефисом' },
      { key: 'normalizeQuotes', label: 'Нормализовать кавычки («умные» → прямые)', risky: true, hint: '" " \' \' → " \' — ломает типографику, но безопасно для кода/JSON' },
      { key: 'normalizeEllipsis', label: 'Нормализовать многоточие (... → …)', hint: 'Три точки заменяются символом многоточия' },
      { key: 'normalizeAllNbsp', label: 'Все неразрывные пробелы → обычные', risky: true, hint: 'Конвертирует ВСЕ \\u00A0 в обычные пробелы' },
      { key: 'normalizeAbbreviations', label: 'Нормализовать сокращения: т. д., т. п.', hint: 'По ГОСТ/Розенталю нужен пробел: «и т. д.». Если хочется бытовой компактности — включи опцию ниже.' },
      { key: 'compactAbbreviations', label: 'Компактные сокращения: т.д., т.п.', risky: true, hint: 'Личный стиль поверх типографики. Удобно, если пробел в сокращениях бесит сильнее, чем баг в пятницу.' },
      { key: 'collapseBlankLines', label: 'Убирать лишние пустые строки' },
      { key: 'showHints', label: 'Показывать подсказки без автоправки' },
      { key: 'capitalAfterPunctuation', label: 'Заглавные после точки', risky: true },
      { key: 'finalPeriod', label: 'Точка в конце абзаца', risky: true },
      { key: 'paragraphBreaks', label: 'Разбивка на абзацы', risky: true },
      { key: 'redLine', label: 'Красная строка', risky: true },
      { key: 'matrixAcceptEffect', label: 'Matrix-подсветка принятия' },
    ];
  }

  function makeStats() {
    return {
      newlines: 0,
      trim: 0,
      spaces: 0,
      punctuation: 0,
      abbreviations: 0,
      compactAbbreviations: 0,
      nbsp: 0,
      blanks: 0,
      hints: 0,
      caps: 0,
      finalPeriod: 0,
      paragraphs: 0,
      redLine: 0,
      invisibleChars: 0,
      dashes: 0,
      quotes: 0,
      ellipsis: 0,
      protected: 0,
    };
  }

  function inc(stats, key, by = 1) {
    stats[key] = (stats[key] || 0) + by;
  }

  function countDiff(before, after) {
    return before === after ? 0 : 1;
  }

  function countTrimDiff(before, after) {
    return before === after ? 0 : Math.max(1, Math.abs(String(before ?? '').length - String(after ?? '').length));
  }

  function expandReplacement(template, args) {
    const replacement = String(template ?? '');
    const hasGroups = args.length > 0 && args[args.length - 1] && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1]);
    const groups = hasGroups ? args[args.length - 1] : null;
    const input = String(args[hasGroups ? args.length - 2 : args.length - 1] ?? '');
    const offset = Number(args[hasGroups ? args.length - 3 : args.length - 2]) || 0;
    const captures = args.slice(1, hasGroups ? -3 : -2);

    return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (match, token) => {
      if (token === '$') return '$';
      if (token === '&') return String(args[0] ?? '');
      if (token === '`') return input.slice(0, offset);
      if (token === "'") {
        const fullMatch = String(args[0] ?? '');
        return input.slice(offset + fullMatch.length);
      }
      if (token.startsWith('<')) {
        const groupName = token.slice(1, -1);
        return groups?.[groupName] ?? '';
      }

      const doubleIndex = Number(token);
      if (doubleIndex >= 1 && doubleIndex <= captures.length) {
        return captures[doubleIndex - 1] ?? '';
      }

      const singleIndex = Number(token[0]);
      if (singleIndex >= 1 && singleIndex <= captures.length) {
        return String(captures[singleIndex - 1] ?? '') + token.slice(1);
      }

      return match;
    });
  }

  function replaceTracked(text, re, replacer, stats, key) {
    let count = 0;
    const next = text.replace(re, (...args) => {
      const oldPart = args[0];
      const newPart = typeof replacer === 'function'
        ? replacer(...args)
        : expandReplacement(replacer, args);
      if (oldPart !== newPart) count++;
      return newPart;
    });
    if (count) inc(stats, key, count);
    return next;
  }

  function maskProtectedInline(line) {
    const values = [];
    let out = String(line ?? '');

    const put = value => {
      const token = `\uE000${values.length}\uE001`;
      values.push(value);
      return token;
    };

    const safeReplace = (source, re) => {
      try {
        return source.replace(re, put);
      } catch (error) {
        console.warn('[TextLinter] Не удалось замаскировать защищённый фрагмент:', error);
        return source;
      }
    };

    // Сначала более широкие и технические конструкции.
    out = safeReplace(out, /`[^`\n]*`/g);
    out = safeReplace(out, /\{\{[^\n]*?\}\}/g);
    out = safeReplace(out, /https?:\/\/[^\s)\]}>'"]+/gi);
    out = safeReplace(out, /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g);
    out = safeReplace(out, /\b[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+\b/g);
    out = safeReplace(out, /\b[A-ZА-ЯЁ]{2,}(?:\.[A-ZА-ЯЁ]{2,})+\b/gu);

    return {
      text: out,
      restore(value) {
        return value.replace(/\uE000(\d+)\uE001/g, (_, index) => values[Number(index)] ?? '');
      },
      count: values.length,
    };
  }

  function shouldSkipLine(line) {
    return SAFE_LINE_SKIP_RE.test(line)
      || JSONISH_LINE_RE.test(line)
      || JSON_PAIR_LINE_RE.test(line)
      || INDENTED_CODE_LINE_RE.test(line)
      || MARKDOWN_TABLE_LINE_RE.test(line);
  }

  function splitLeadingIndent(line) {
    const match = String(line ?? '').match(/^\s*/u);
    const indent = match?.[0] ?? '';
    return { indent, body: String(line ?? '').slice(indent.length) };
  }

  function shouldPreserveIndent(line) {
    return NESTED_MARKDOWN_LINE_RE.test(line) && !/^\s+$/.test(line);
  }

  function normalizeAbbreviations(line, stats) {
    let next = line;
    for (const rule of ABBREVIATION_RULES) {
      next = replaceTracked(next, rule.re, rule.value, stats, 'abbreviations');
    }
    return next;
  }

  function preserveReplacementCase(source, replacement) {
    const text = String(replacement ?? '');
    const first = String(source ?? '').trimStart().charAt(0);
    if (!first) return text;
    const isUpper = first === first.toUpperCase() && first !== first.toLowerCase();
    return isUpper ? first + text.slice(1) : text;
  }

  function compactAbbreviations(line, stats) {
    let next = line;
    for (const rule of ABBREVIATION_STYLE_RULES) {
      const from = String(rule.from).split(' ').map(escapeRegExp).join('\\s+');
      const re = new RegExp(from, 'giu');
      next = replaceTracked(next, re, match => preserveReplacementCase(match, rule.to), stats, 'compactAbbreviations');
    }
    return next;
  }

  function protectAbbreviationTrailingSpace(line, stats) {
    return replaceTracked(
      line,
      ABBREVIATION_TRAILING_SPACE_RE,
      match => `${match} `,
      stats,
      'punctuation'
    );
  }

  function normalizeNbsp(src, stats) {
    return replaceTracked(
      src,
      /(^|[ \t([{"'«])([^ \t\n]+)[ \t]+(?=[\p{L}\p{N}])/giu,
      (match, prefix, word, offset) => {
        const wordText = String(word || '');
        if (PLACEHOLDER_FULL_RE.test(wordText)) return match;
        if (!/^(?:[вксоуаи]|не|ни|на|за|по|из|от|до|со|об|обо|под|над)$/iu.test(wordText)) return match;
        const wordOffset = offset + String(prefix || '').length;
        if (hasPlaceholderNearby(src, wordOffset)) return match;
        return `${prefix}${word}\u00A0`;
      },
      stats,
      'nbsp'
    );
  }

  function hasShortAbbreviationContext(line, index) {
    const from = Math.max(0, index - 12);
    const to = Math.min(line.length, index + 16);
    return SHORT_ABBR_RE.test(line.slice(from, to));
  }

  function hasPlaceholderNearby(line, index) {
    const from = Math.max(0, index - 8);
    const to = Math.min(line.length, index + 8);
    return PLACEHOLDER_RE.test(line.slice(from, to));
  }

  function hasTemplatePlaceholderAtEdge(line) {
    const source = String(line ?? '');
    return /^\s*\{\{[^\n]*?\}\}/u.test(source) || /\{\{[^\n]*?\}\}\s*$/u.test(source);
  }

  function processLine(rawLine, opts, stats) {
    const raw = String(rawLine ?? '');

    if (shouldSkipLine(raw)) {
      if (raw.trim()) inc(stats, 'protected');
      return raw;
    }

    const masked = maskProtectedInline(raw);
    if (masked.count) inc(stats, 'protected', masked.count);

    // Шаблонные переменные остаются замаскированными, поэтому безопасные правки
    // можно выполнять вокруг них без изменения содержимого `{{...}}`.
    // Точечные проверки ниже не дают вставлять/удалять пробел прямо на границе placeholder.

    const preserveIndent = shouldPreserveIndent(raw);
    const { indent: leadingIndent, body } = preserveIndent ? splitLeadingIndent(masked.text) : { indent: '', body: masked.text };
    let line = body;

    if (opts.removeInvisibleChars) {
      line = replaceTracked(line, /[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '', stats, 'invisibleChars');
    }

    if (opts.trimLines) {
      const next = preserveIndent ? line.trimEnd() : line.trim();
      inc(stats, 'trim', countTrimDiff(line, next));
      line = next;
    }

    if (opts.collapseSpaces) {
      line = replaceTracked(line, /[ \t]{2,}/g, ' ', stats, 'spaces');
    }

    if (opts.punctuationSpacing) {
      line = replaceTracked(line, /\s+([,!?;])/gu, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        const before = line.slice(Math.max(0, offset - 24), offset);
        if (PLACEHOLDER_AT_EDGE_RE.test(before)) return match;
        return match.trimStart();
      }, stats, 'punctuation');
      line = replaceTracked(line, /\s+([.:])(?!\d)/gu, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        const before = line.slice(Math.max(0, offset - 24), offset);
        if (PLACEHOLDER_AT_EDGE_RE.test(before)) return match;
        return match.trimStart();
      }, stats, 'punctuation');
    }

    if (opts.normalizeAbbreviations || opts.compactAbbreviations) {
      line = normalizeAbbreviations(line, stats);
    }

    if (opts.compactAbbreviations) {
      line = compactAbbreviations(line, stats);
    }

    if (opts.punctuationSpacing) {
      line = replaceTracked(line, /(\d),\s+(?=\d)/gu, '$1,', stats, 'punctuation');
      line = protectAbbreviationTrailingSpace(line, stats);
      line = replaceTracked(line, /([,!?;])(?=[\p{L}\p{N}«"'])/gu, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        const nextChar = line.charAt(offset + 1);
        const prevChar = line.charAt(offset - 1);
        const before = line.slice(Math.max(0, offset - 24), offset);
        const after = line.slice(offset + 1, Math.min(line.length, offset + 25));
        if (match[0] === ',' && /\d/u.test(prevChar) && /\d/u.test(nextChar)) return match;
        if (PLACEHOLDER_AT_EDGE_RE.test(before) || PLACEHOLDER_AT_EDGE_RE.test(after) || hasPlaceholderNearby(line, offset) || /\uE001$/u.test(before)) return match;
        return `${match[0]}${nextChar === '\uE000' ? '' : ' '}`;
      }, stats, 'punctuation');
      line = replaceTracked(line, /([.:])(?=[\p{L}«"'])/gu, (...args) => {
        const match = args[0];
        const offset = args[args.length - 2];
        const nextChar = line.charAt(offset + 1);
        const before = line.slice(Math.max(0, offset - 24), offset);
        const after = line.slice(offset + 1, Math.min(line.length, offset + 25));
        if (PLACEHOLDER_AT_EDGE_RE.test(before) || PLACEHOLDER_AT_EDGE_RE.test(after) || hasPlaceholderNearby(line, offset) || /\uE001$/u.test(before) || ABBREVIATION_DOT_BEFORE_WORD_RE.test(before) || hasShortAbbreviationContext(line, offset)) return match;
        return `${match[0]}${nextChar === '\uE000' ? '' : ' '}`;
      }, stats, 'punctuation');
      line = replaceTracked(line, /([([{])\s+/g, '$1', stats, 'punctuation');
      line = replaceTracked(line, /\s+([)\]}])/g, (...args) => {
        const match = args[0];
        // Убираем только пробел прямо перед закрывающей скобкой.
        // Внутренний пробел сокращения сохраняется: «(т. п.)», а не «(т.п.)».
        return match.trimStart();
      }, stats, 'punctuation');
    }

    if (opts.normalizeNbsp) {
      line = normalizeNbsp(line, stats);
    }

    if (opts.normalizeAllNbsp) {
      line = replaceTracked(line, /\u00A0/g, ' ', stats, 'nbsp');
    }

    if (opts.normalizeDashes) {
      line = replaceTracked(line, /[—–]/g, '-', stats, 'dashes');
    }

    if (opts.normalizeQuotes) {
      line = replaceTracked(line, /[\u201C\u201D]/g, '"', stats, 'quotes');
      line = replaceTracked(line, /[\u2018\u2019]/g, "'", stats, 'quotes');
    }

    if (opts.normalizeEllipsis) {
      line = replaceTracked(line, /\.\.\./g, '\u2026', stats, 'ellipsis');
    }

    if (opts.capitalAfterPunctuation && !LIST_OR_HEADING_RE.test(line)) {
      const before = line;
      const abbrMasked = maskSentenceAbbreviationDots(line);
      let capLine = abbrMasked.text.replace(/(^|[.!?…]\s+|\uE001\s+)([a-zа-яё])/giu, (match, prefix, ch, offset) => {
        if (/^\uE001\s+$/u.test(prefix)) return match;
        if (hasPlaceholderNearby(abbrMasked.text, offset + String(prefix || '').length)) return match;
        return prefix + ch.toUpperCase();
      });
      line = abbrMasked.restore(capLine);
      inc(stats, 'caps', countDiff(before, line));
    }

    if (opts.finalPeriod && line && !LIST_OR_HEADING_RE.test(line) && /[\p{L}\p{N}"»)]$/u.test(line) && !SENTENCE_END_RE.test(line)) {
      line += '.';
      inc(stats, 'finalPeriod');
    }

    return masked.restore(leadingIndent + line);
  }

  function overlapsPlaceholder(line, start, length) {
    const from = Math.max(0, start - 8);
    const to = Math.min(line.length, start + length + 8);
    return PLACEHOLDER_RE.test(line.slice(from, to));
  }

  function getVisibleMatchStart(line, match) {
    const value = String(match?.[0] ?? '');
    const leading = value.match(/^\s*[^\p{L}\p{N}_]*/u)?.[0]?.length ?? 0;
    return Math.min(String(line ?? '').length, (match?.index ?? 0) + leading);
  }

  function getHintSnippet(line, index) {
    const source = String(line ?? '');
    const safeIndex = Math.max(0, Math.min(source.length, Number(index) || 0));
    const from = Math.max(0, safeIndex - 36);
    const to = Math.min(source.length, safeIndex + 84);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < source.length ? '…' : '';
    return prefix + source.slice(from, to) + suffix;
  }

  function collectHintsFromLine(rawLine, lineIndex, hints) {
    if (!hints || shouldSkipLine(rawLine) || !rawLine.trim()) return;
    const masked = maskProtectedInline(rawLine);
    let line = masked.text;
    if (!line.trim()) return;

    for (const rule of HINT_RULES) {
      const re = new RegExp(rule.re.source, rule.re.flags);
      let match;
      while ((match = re.exec(line))) {
        const matchIndex = getVisibleMatchStart(line, match);
        if (overlapsPlaceholder(line, match.index, match[0].length)) {
          if (match[0].length === 0) re.lastIndex++;
          continue;
        }
        const maskedSnippet = getHintSnippet(line, matchIndex);
        const snippet = masked.restore(maskedSnippet).replace(/\s+/g, ' ').trim();
        if (!snippet) {
          if (match[0].length === 0) re.lastIndex++;
          continue;
        }
        hints.push({
          id: rule.id,
          line: lineIndex + 1,
          text: rule.text,
          snippet: snippet.slice(0, 120),
        });
        break;
      }
    }
  }

  function processNormalSegment(segment, opts, stats, hints, lineOffset = 0) {
    if (opts.showHints) {
      segment.forEach((line, index) => collectHintsFromLine(line, lineOffset + index, hints));
    }

    let text = segment.map(line => processLine(line, opts, stats)).join('\n');

    if (opts.collapseBlankLines) {
      text = text.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, match => {
        const newlineCount = match.match(/\n/g)?.length || 0;
        const removed = Math.max(1, newlineCount - 1);
        inc(stats, 'blanks', removed);
        return '\n';
      });
    }

    if (opts.paragraphBreaks) {
      text = splitLongParagraphs(text, stats);
    }

    if (opts.redLine) {
      text = addRedLine(text, stats);
    }

    return text;
  }

  function maskSentenceAbbreviationDots(text) {
    const DOT = '\uE002';
    const masked = String(text ?? '').replace(
      /(?:^|[^\p{L}\p{N}_])(?:и\s+)?т\.\s?д\.|(?:^|[^\p{L}\p{N}_])(?:и\s+)?т\.\s?п\.|(?:^|[^\p{L}\p{N}_])т\.\s?[екно]\.|(?:^|[^\p{L}\p{N}_])в\s+т\.\s?ч\.|(?:^|[^\p{L}\p{N}_])(?:до\s+)?н\.\s?э\./giu,
      match => match.replace(/\./g, DOT)
    );
    return {
      text: masked,
      restore(value) {
        return String(value ?? '').replace(new RegExp(DOT, 'g'), '.');
      },
    };
  }

  function splitLongParagraphs(text, stats) {
    return text.split(/\n{2,}/).map(paragraph => {
      if (paragraph.length < 430 || /\n/.test(paragraph) || LIST_OR_HEADING_RE.test(paragraph)) return paragraph;

      const protectedParagraph = maskSentenceAbbreviationDots(paragraph);
      const sentences = protectedParagraph.text.match(/[^.!?…]+[.!?…]+(?:["»)]*)|[^.!?…]+$/gu);
      if (!sentences || sentences.length < 3) return paragraph;

      const chunks = [];
      let current = '';
      for (const sentence of sentences) {
        const s = protectedParagraph.restore(sentence).trim();
        if (!s) continue;
        if ((current + ' ' + s).trim().length > 280 && current.length > 120) {
          chunks.push(current.trim());
          current = s;
        } else {
          current = (current ? current + ' ' : '') + s;
        }
      }
      if (current) chunks.push(current.trim());
      if (chunks.length <= 1) return paragraph;
      inc(stats, 'paragraphs', chunks.length - 1);
      return chunks.join('\n\n');
    }).join('\n\n');
  }

  function addRedLine(text, stats) {
    return text.split(/\n{2,}/).map(paragraph => {
      if (!paragraph.trim() || /^\s{2}/.test(paragraph) || LIST_OR_HEADING_RE.test(paragraph)) return paragraph;
      inc(stats, 'redLine');
      return '  ' + paragraph;
    }).join('\n\n');
  }

  function isClosingFenceLine(line, marker) {
    const fence = escapeRegExp(marker || '');
    return !!fence && new RegExp(`^\\s*${fence}\\s*$`).test(String(line ?? ''));
  }

  function lint(source, options = {}) {
    const opts = { ...DEFAULT_SETTINGS, ...settings, ...options };
    // Внешние options могут включать/выключать любые правила поверх сохранённых настроек.
    // Главное — не смешивать старый localStorage с явным вызовом lint(text, options).
    const stats = makeStats();
    const hints = [];
    const original = String(source ?? '');
    let text = original;

    if (/\r/.test(text)) {
      text = text.replace(/\r\n?/g, '\n');
      inc(stats, 'newlines');
    }

    const lines = text.split('\n');
    const chunks = [];
    let normal = [];
    let normalStartLine = 0;
    let code = [];
    let inFence = false;
    let fenceMarker = '';

    function flushNormal(nextStartLine = normalStartLine) {
      if (!normal.length) {
        normalStartLine = nextStartLine;
        return;
      }
      const segment = normal;
      const segmentStartLine = normalStartLine;
      normal = [];
      chunks.push(processNormalSegment(segment, opts, stats, hints, segmentStartLine));
      normalStartLine = nextStartLine;
    }

    function flushCode() {
      if (!code.length) return;
      chunks.push(code.join('\n'));
      inc(stats, 'protected', code.filter(line => line.trim()).length);
      code = [];
    }

    lines.forEach((line, lineIndex) => {
      const nextLineIndex = lineIndex + 1;
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence && !inFence) {
        flushNormal(lineIndex);
        inFence = true;
        fenceMarker = fence[1];
        code.push(line);
        return;
      }

      if (inFence) {
        code.push(line);
        if (line.trim().startsWith(fenceMarker) && code.length > 1) {
          inFence = false;
          fenceMarker = '';
          flushCode();
          normalStartLine = nextLineIndex;
        }
        return;
      }

      if (!normal.length) normalStartLine = lineIndex;
      normal.push(line);
    });

    flushNormal(lines.length);
    flushCode();

    const result = chunks.join('\n');
    stats.hints = hints.length;
    return {
      original,
      text: result,
      changed: result !== original,
      stats,
      hints,
      changeCount: Object.entries(stats)
        .filter(([key]) => key !== 'protected' && key !== 'hints')
        .reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0),
      protectedCount: stats.protected,
    };
  }

  function getBlockSelector(blockId) {
    if (typeof blockId !== 'string' || !blockId) return '';
    const escapedId = window.CSS?.escape ? CSS.escape(blockId) : blockId.replace(/"/g, '\\"');
    return `[data-id="${escapedId}"]`;
  }

  function getBlockTextarea(blockId) {
    const selector = getBlockSelector(blockId);
    if (!selector) return null;
    const blockEl = document.querySelector(selector);
    if (!blockEl) return null;
    return blockEl.querySelector('textarea.block-textarea:not([hidden])')
      ?? blockEl.querySelector('textarea.block-textarea')
      ?? blockEl.querySelector('textarea:not([hidden])')
      ?? blockEl.querySelector('textarea');
  }

  function getScope(ta) {
    const hasSelection = ta.selectionStart !== ta.selectionEnd;
    return {
      hasSelection,
      start: hasSelection ? ta.selectionStart : 0,
      end: hasSelection ? ta.selectionEnd : ta.value.length,
      text: hasSelection ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value,
    };
  }

  function runQuick(blockId) {
    const ta = getBlockTextarea(blockId);
    if (!ta) { window.Toast?.show('Не найдена textarea блока', 'error'); return; }

    const scope = getScope(ta);
    if (!scope.text.trim()) { window.Toast?.show('Тут пока нечего причёсывать', 'info'); return; }

    const result = lint(scope.text);
    if (!result.changed) {
      if (result.hints?.length) {
        window.Toast?.show(`Автоправок нет, но есть подсказки: ${result.hints.length}. Открываю diff-панель.`, 'info');
        showPreviewPanel(blockId, ta, scope, result);
        return;
      }
      window.Toast?.show('Текст уже опрятный. Подозрительно, но приятно ✓', 'success');
      return;
    }

    applyResult(blockId, ta, scope, result, { removePanels: true });
  }

  function openPreview(blockId) {
    const ta = getBlockTextarea(blockId);
    if (!ta) { window.Toast?.show('Не найдена textarea блока', 'error'); return; }

    const scope = getScope(ta);
    if (!scope.text.trim()) { window.Toast?.show('Тут пока нечего причёсывать', 'info'); return; }

    const result = lint(scope.text);
    if (!result.changed && !result.hints?.length) {
      window.Toast?.show('Изменений нет: текст уже держит осанку ✓', 'success');
      return;
    }

    showPreviewPanel(blockId, ta, scope, result);
  }

  function showPreviewPanel(blockId, ta, scope, result) {
    const blockEl = document.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    if (!blockEl) return;

    blockEl.querySelector('.text-lint-result-panel')?.remove();

    const panel = document.createElement('div');
    panel.className = 'llm-result-panel text-lint-result-panel';
    applyDiffTypography(panel, ta);

    const mode = getDiffMode();
    const diffScale = getDiffFontSize(ta);
    const diffHtml = renderDiff(scope.text, result.text, mode);
    const hintsHtml = renderHints(result.hints);
    const risky = getRiskyEnabledCount();

    const settings = getSettings();
    const meta = getSettingMeta();
    const gearItems = meta.map(item => {
      const chk = settings[item.key] ? ' checked' : '';
      const cls = item.risky ? ' risky' : '';
      return `<label class="text-lint-gear-item${cls}"><input type="checkbox" data-lint-key="${item.key}"${chk}><span>${item.label}</span></label>`;
    }).join('');

    panel.innerHTML =
      `<div class="llm-result-toolbar text-lint-result-toolbar">` +
        `<span class="llm-result-stats text-lint-result-stats">${formatStats(result)}${scope.hasSelection ? ' · выделение' : ''}</span>` +
        (result.changed ? renderDiffSizeControls(diffScale) : '') +
        `<div class="text-lint-gear-wrap">` +
          `<button type="button" class="btn-sm text-lint-gear-btn" title="Настройки линтера" aria-label="Настройки линтера">⚙</button>` +
          `<div class="text-lint-gear-dropdown">${gearItems}</div>` +
        `</div>` +
        (result.changed ? `<button type="button" class="btn-sm" data-action="copy" title="Скопировать исправленный вариант" aria-label="Скопировать исправленный вариант">⧉</button>` : '') +
        (result.changed ? `<button type="button" class="btn-sm btn-sm-accent" data-action="accept">✓</button>` : '') +
        `<button type="button" class="btn-sm" data-action="reject">✕</button>` +
      `</div>` +
      (result.changed ? `<div class="llm-result-content llm-result-content--${mode} text-lint-result-content">${diffHtml}</div>` : `<div class="text-lint-no-changes">Автоправок нет. Только подсказки — руками, аккуратно.</div>`) +
      hintsHtml;

    if (ta.parentNode) ta.parentNode.insertBefore(panel, ta.nextSibling);
    else blockEl.appendChild(panel);

    panel.querySelector('[data-action="accept"]')?.addEventListener('click', event => {
      const button = event.currentTarget;
      if (button?.disabled) return;
      if (button) button.disabled = true;
      panel.remove();
      applyResult(blockId, ta, scope, result, { removePanels: false });
    });
    panel.querySelector('[data-action="copy"]')?.addEventListener('click', () => copyFixedText(result.text));
    panel.querySelector('[data-action="reject"]')?.addEventListener('click', () => panel.remove());
    panel.querySelectorAll('[data-diff-size]').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = btn.dataset.diffSize === 'inc' ? 1 : -1;
        adjustDiffFontSize(panel, step);
      });
    });

    const gearBtn = panel.querySelector('.text-lint-gear-btn');
    const gearDrop = panel.querySelector('.text-lint-gear-dropdown');
    if (gearBtn && gearDrop) {
      let gearDirty = false;
      gearBtn.addEventListener('click', e => {
        e.stopPropagation();
        gearDrop.classList.toggle('open');
      });
      gearDrop.querySelectorAll('[data-lint-key]').forEach(cb => {
        cb.addEventListener('change', () => { gearDirty = true; });
      });
      function closeGear(e) {
        if (gearDrop.contains(e.target)) return;
        if (!gearDrop.classList.contains('open')) return;
        gearDrop.classList.remove('open');
        if (gearDirty) {
          gearDirty = false;
          const checkboxes = gearDrop.querySelectorAll('[data-lint-key]');
          checkboxes.forEach(cb => setSetting(cb.dataset.lintKey, cb.checked));
          openPreview(blockId);
        }
        document.removeEventListener('click', closeGear);
      }
      document.addEventListener('click', closeGear);
    }
  }

  async function copyFixedText(text) {
    try {
      if (window._clipboardApiEnabled && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        temp.style.top = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      window.Toast?.show('Исправленный текст скопирован', 'success');
    } catch (_) {
      window.Toast?.show('Не удалось скопировать исправленный текст', 'error');
    }
  }

  function getDiffMode() {
    return window.State?.getLayout?.()?.llm?.diffMode === 'matrix' ? 'matrix' : 'classic';
  }

  function getDiffFontSize(ta) {
    const cs = ta ? window.getComputedStyle(ta) : null;
    const fontSize = Number.parseFloat(cs?.fontSize || '');
    return Number.isFinite(fontSize) && fontSize > 0 ? Math.round(fontSize) : 12;
  }

  function renderDiffSizeControls(size) {
    return `<span class="text-lint-diff-size-controls" aria-label="Размер текста diff">` +
      `<button type="button" class="btn-sm text-lint-diff-size-btn" data-diff-size="dec" title="Уменьшить текст diff" aria-label="Уменьшить размер текста diff">A−</button>` +
      `<span class="text-lint-diff-size-value" aria-live="polite">${size}px</span>` +
      `<button type="button" class="btn-sm text-lint-diff-size-btn" data-diff-size="inc" title="Увеличить текст diff" aria-label="Увеличить размер текста diff">A+</button>` +
    `</span>`;
  }

  function adjustDiffFontSize(panel, step) {
    if (!panel) return;
    const current = Number.parseFloat(panel.style.getPropertyValue('--text-lint-diff-font-size')) || 12;
    const next = Math.max(8, Math.min(32, Math.round((current + step) * 2) / 2));
    panel.style.setProperty('--text-lint-diff-font-size', `${next}px`);
    panel.style.setProperty('--text-lint-diff-line-height', `${Math.round(next * 1.65 * 100) / 100}px`);
    const valueEl = panel.querySelector('.text-lint-diff-size-value');
    if (valueEl) valueEl.textContent = `${next}px`;
  }

  function applyDiffTypography(panel, ta) {
    if (!panel || !ta) return;

    const cs = window.getComputedStyle(ta);
    const fontSize = Number.parseFloat(cs.fontSize);
    const lineHeight = Number.parseFloat(cs.lineHeight);
    const fontFamily = cs.fontFamily;
    const letterSpacing = cs.letterSpacing;
    const fontWeight = cs.fontWeight;

    // Diff линтера должен ощущаться как тот же текст, который сейчас правим.
    if (Number.isFinite(fontSize) && fontSize > 0) panel.style.setProperty('--text-lint-diff-font-size', `${fontSize}px`);
    if (Number.isFinite(lineHeight) && lineHeight > 0) panel.style.setProperty('--text-lint-diff-line-height', `${lineHeight}px`);
    else if (Number.isFinite(fontSize) && fontSize > 0) panel.style.setProperty('--text-lint-diff-line-height', `${Math.round(fontSize * 1.65 * 100) / 100}px`);
    if (fontFamily) panel.style.setProperty('--text-lint-diff-font-family', fontFamily);
    if (letterSpacing && letterSpacing !== 'normal') panel.style.setProperty('--text-lint-diff-letter-spacing', letterSpacing);
    if (fontWeight) panel.style.setProperty('--text-lint-diff-font-weight', fontWeight);
  }

  function getDiffEffectMs() {
    const raw = parseInt(window.State?.getLayout?.()?.llm?.diffEffectMs, 10);
    if (!Number.isFinite(raw)) return 3500;
    return Math.max(1000, Math.min(10000, Math.round(raw / 50) * 50));
  }

  function renderDiff(before, after, mode) {
    const engine = window.LLMFeatures?.DiffEngine;
    if (engine?.compute && engine?.renderHtml) {
      return engine.renderHtml(engine.compute(before, after), mode, { durationMs: getDiffEffectMs() });
    }
    return escapeHtml(after);
  }

  function renderHints(hints) {
    if (!Array.isArray(hints) || !hints.length) return '';
    return `<details class="text-lint-hints" open>` +
      `<summary>💡 Подсказки без автоправки: ${hints.length}</summary>` +
      `<ul>` +
        hints.slice(0, 8).map(hint =>
          `<li><b>стр. ${hint.line}</b>: ${escapeHtml(hint.text)}${hint.snippet ? ` <code>${escapeHtml(hint.snippet)}</code>` : ''}</li>`
        ).join('') +
        (hints.length > 8 ? `<li class="text-lint-hint-muted">…ещё ${hints.length - 8}. Линтер не лезет с запятыми в драку без спроса.</li>` : '') +
      `</ul>` +
    `</details>`;
  }

  function findStateBlock(blockId) {
    const tab = window.State?.getActive?.();
    if (!tab || !Array.isArray(tab.blocks) || !window.State?.findBlock) return null;
    return window.State.findBlock(tab.blocks, blockId);
  }

  function syncStateBlockValue(blockId, value) {
    const block = findStateBlock(blockId);
    if (block?.type !== 'text' || !Array.isArray(block.subtabs)) return;
    const activeIndex = Number.isInteger(block.activeSubtab) ? block.activeSubtab : 0;
    const subtab = block.subtabs[activeIndex];
    if (subtab) subtab.value = value;
  }

  function applyResult(blockId, ta, scope, result, options = {}) {
    if (!result?.changed) {
      window.Toast?.show('Автоправок нет — подсказки оставил для ручного режима', 'info');
      return;
    }

    if (!ta || typeof ta.value !== 'string') {
      window.Toast?.show('Не найдена textarea блока', 'error');
      return;
    }

    const currentScope = options.useCurrentScope ? getScope(ta) : scope;
    const safeScope = currentScope && Number.isInteger(currentScope.start) && Number.isInteger(currentScope.end)
      ? currentScope
      : { start: 0, end: ta.value.length };

    try {
      syncStateBlockValue(blockId, ta.value);
      window.State?.blockSnapshot?.(blockId);
    } catch (_) {}

    if (options.removePanels) {
      document.querySelector(`[data-id="${CSS.escape(blockId)}"] .text-lint-result-panel`)?.remove();
    }

    ta.focus();
    ta.setRangeText(result.text, safeScope.start, safeScope.end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    try {
      window.PromptLoom?.record?.(result.text, 'edit', {
        via: 'text-linter',
        blockId,
        chars: result.text.length,
      });
      window.Intelligence?.track?.('block.text_lint', {
        blockId,
        chars: result.text.length,
        changes: result.changeCount,
        protected: result.protectedCount,
      });
    } catch (_) {}

    try {
      syncStateBlockValue(blockId, ta.value);
      if (window.Storage?.save && window.State?.serialize) window.Storage.save(window.State.serialize());
    } catch (_) {}

    setTimeout(() => {
      try { window.State?.blockSnapshot?.(blockId); window.State?.snapshot?.(); } catch (_) {}
    }, 0);

    playAcceptEffect(ta);
    window.WordDict?.scheduleBuild?.();
    window.Toast?.show(`Причёсано: ${result.changeCount || 1} мелк. правок. Смысл не трогал 🪮`, 'success');
  }

  function playAcceptEffect(ta) {
    if (!settings.matrixAcceptEffect || !ta) return;
    ta.classList.remove('text-lint-matrix-accept');
    void ta.offsetWidth;
    ta.classList.add('text-lint-matrix-accept');
    setTimeout(() => ta.classList.remove('text-lint-matrix-accept'), 950);
  }

  function formatStats(result) {
    const parts = [];
    if (result.stats.trim) parts.push(`края: ${result.stats.trim}`);
    if (result.stats.spaces) parts.push(`пробелы: ${result.stats.spaces}`);
    if (result.stats.punctuation) parts.push(`знаки: ${result.stats.punctuation}`);
    if (result.stats.abbreviations) parts.push(`сокр.: ${result.stats.abbreviations}`);
    if (result.stats.compactAbbreviations) parts.push(`комп.сокр.: ${result.stats.compactAbbreviations}`);
    if (result.stats.nbsp) parts.push(`неразр.: ${result.stats.nbsp}`);
    if (result.stats.invisibleChars) parts.push(`невидимые: ${result.stats.invisibleChars}`);
    if (result.stats.dashes) parts.push(`тире: ${result.stats.dashes}`);
    if (result.stats.quotes) parts.push(`кавычки: ${result.stats.quotes}`);
    if (result.stats.ellipsis) parts.push(`многоточие: ${result.stats.ellipsis}`);
    if (result.stats.blanks) parts.push('пустые');
    if (result.stats.caps) parts.push(`заглавные: ${result.stats.caps}`);
    if (result.stats.finalPeriod) parts.push(`точки: ${result.stats.finalPeriod}`);
    if (result.stats.paragraphs) parts.push(`абзацы: ${result.stats.paragraphs}`);
    if (result.stats.redLine) parts.push(`красная: ${result.stats.redLine}`);
    if (result.stats.hints) parts.push(`подсказки: ${result.stats.hints}`);
    if (!parts.length) parts.push('нормализация');
    return `${parts.join(' · ')}${result.protectedCount ? ` · защ:${result.protectedCount}` : ''}`;
  }

  function getRiskyEnabledCount() {
    return getSettingMeta().filter(item => item.risky && settings[item.key]).length;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function escapeRegExp(str) {
    return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function ensureStyles() {
    if (document.getElementById('text-linter-styles')) return;
    const style = document.createElement('style');
    style.id = 'text-linter-styles';
    style.textContent = `
      .text-groom-trigger {
        color: rgba(92,184,122,0.95);
        border-color: rgba(92,184,122,0.2);
        background: rgba(92,184,122,0.08);
      }
      .text-groom-trigger:hover,
      .dropdown.open .text-groom-trigger {
        color: var(--green);
        border-color: rgba(92,184,122,0.45);
        background: rgba(92,184,122,0.16);
        box-shadow: 0 4px 16px rgba(92,184,122,0.14);
      }
      .text-groom-trigger-has-fixes {
        position: relative;
      }
      .text-groom-trigger-has-fixes::after {
        content: attr(data-lint-badge);
        position: absolute;
        right: -5px;
        top: -6px;
        min-width: 14px;
        height: 14px;
        padding: 0 3px;
        border: 1px solid rgba(92,184,122,0.55);
        border-radius: 999px;
        background: rgba(26,32,28,0.96);
        color: var(--green);
        font: 700 9px/13px var(--mono);
        text-align: center;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.24), 0 4px 12px rgba(92,184,122,0.2);
        pointer-events: none;
      }
      .llm-groom-menu .text-lint-local-action {
        color: var(--text0);
        background: rgba(92,184,122,0.06);
      }
      .llm-groom-menu .text-lint-local-action:hover,
      .llm-groom-menu .text-lint-local-action:focus-visible {
        color: var(--green);
        background: rgba(92,184,122,0.15);
        outline: none;
      }
      .llm-groom-menu [data-lint-action]:disabled,
      .llm-groom-menu [data-lint-setting]:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .text-lint-menu-note {
        margin: 3px 8px 5px;
        padding: 7px 9px;
        border: 1px solid rgba(92,184,122,0.16);
        border-radius: var(--radius-sm);
        background: rgba(92,184,122,0.055);
        color: var(--text2);
        font-size: 11px;
        line-height: 1.35;
      }
      .text-lint-settings-wrap {
        max-height: 154px;
        overflow-y: auto;
        padding: 2px 4px 4px;
      }
      .text-lint-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        color: var(--text1);
        border-radius: var(--radius-sm);
        font-size: 11px;
        line-height: 1.25;
        cursor: pointer;
        user-select: none;
      }
      .text-lint-option:hover { background: var(--surface2); color: var(--text0); }
      .text-lint-option input { accent-color: var(--green); flex-shrink: 0; }
      .text-lint-option:has(input:disabled) { opacity: 0.55; cursor: not-allowed; }
      .text-lint-option-risky { color: var(--orange); }
      .text-lint-option-risky input { accent-color: var(--orange); }
      .text-lint-result-panel {
        border-color: rgba(92,184,122,0.18);
        background: linear-gradient(180deg, rgba(92,184,122,0.045), rgba(255,255,255,0.025)), var(--bg2);
      }
      .text-lint-result-toolbar {
        flex-wrap: wrap;
        background: linear-gradient(90deg, rgba(92,184,122,0.09), rgba(79,142,247,0.04)), var(--bg1);
      }
      .text-lint-result-stats { color: var(--green); }
      .text-lint-preview-labels {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 7px 12px 0;
        color: var(--text2);
        font-family: var(--mono);
        font-size: 10px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .text-lint-preview-labels span:first-child { color: #e95666; }
      .text-lint-preview-labels span:last-child { color: var(--green); }
      .text-lint-diff-size-controls {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-inline: 3px;
        padding: 1px;
        border: 1px solid rgba(92,184,122,0.14);
        border-radius: 999px;
        background: rgba(92,184,122,0.055);
      }
      .text-lint-diff-size-btn {
        min-width: 22px;
        height: 20px;
        padding: 0 4px;
        border-radius: 999px;
        color: var(--text1);
        font-weight: 700;
        font-size: 10px;
      }
      .text-lint-diff-size-btn:hover,
      .text-lint-diff-size-btn:focus-visible {
        color: var(--green);
        border-color: rgba(92,184,122,0.35);
        background: rgba(92,184,122,0.12);
      }
      .text-lint-diff-size-value {
        min-width: 28px;
        color: var(--text2);
        font-family: var(--mono);
        font-size: 9px;
        text-align: center;
      }
      .text-lint-result-content {
        margin-top: 4px;
        font-family: var(--text-lint-diff-font-family, var(--mono));
        font-size: var(--text-lint-diff-font-size, 12px);
        line-height: var(--text-lint-diff-line-height, 1.65);
        letter-spacing: var(--text-lint-diff-letter-spacing, normal);
        font-weight: var(--text-lint-diff-font-weight, 400);
      }
      .text-lint-result-content .diff-del,
      .text-lint-result-content .diff-ins,
      .text-lint-result-content .diff-classic-token,
      .text-lint-result-content .diff-matrix-token {
        font-size: 1em;
      }
      .text-lint-no-changes {
        margin: 8px;
        padding: 10px;
        border: 1px solid rgba(92,184,122,0.16);
        border-radius: var(--radius-sm);
        background: rgba(92,184,122,0.06);
        color: var(--text1);
        font-size: 12px;
        line-height: 1.4;
      }
      .text-lint-hints {
        margin: 8px;
        padding: 8px 10px;
        border: 1px solid rgba(245,158,11,0.18);
        border-radius: var(--radius-sm);
        background: rgba(245,158,11,0.07);
        color: var(--text1);
        font-size: 12px;
      }
      .text-lint-hints summary {
        cursor: pointer;
        color: var(--orange);
        font-weight: 700;
      }
      .text-lint-hints ul {
        margin: 7px 0 0;
        padding-left: 18px;
      }
      .text-lint-hints li { margin: 5px 0; }
      .text-lint-hints code {
        display: inline-block;
        max-width: 100%;
        margin-top: 2px;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(0,0,0,0.18);
        color: var(--text0);
        white-space: normal;
      }
      .text-lint-hint-muted { color: var(--text2); }
      textarea.block-textarea.text-lint-matrix-accept {
        animation: textLintMatrixAccept 900ms cubic-bezier(.16,1,.3,1) both;
      }
      @keyframes textLintMatrixAccept {
        0% {
          box-shadow: 0 0 0 1px rgba(92,184,122,0.65), 0 0 0 rgba(92,184,122,0);
          text-shadow: 0 0 0 rgba(92,184,122,0);
          border-color: rgba(92,184,122,0.72);
        }
        28% {
          box-shadow: 0 0 0 3px rgba(92,184,122,0.16), 0 0 28px rgba(92,184,122,0.22);
          text-shadow: 0 0 8px rgba(92,184,122,0.35);
          border-color: rgba(92,184,122,0.9);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(92,184,122,0);
          text-shadow: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        textarea.block-textarea.text-lint-matrix-accept { animation: none; }
      }
      .text-lint-result-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }
      .text-lint-result-stats {
        font-size: 10px;
        color: var(--text2);
        white-space: nowrap;
      }
      .text-lint-gear-wrap {
        position: relative;
        display: inline-flex;
      }
      .text-lint-gear-btn {
        min-width: 24px;
        height: 22px;
        padding: 0 4px;
        font-size: 12px;
        color: var(--text2);
      }
      .text-lint-gear-btn:hover {
        color: var(--green);
      }
      .text-lint-gear-dropdown {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        z-index: 100;
        min-width: 220px;
        max-height: 260px;
        overflow-y: auto;
        margin-top: 4px;
        padding: 4px;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
      }
      .text-lint-gear-dropdown.open {
        display: block;
      }
      .text-lint-gear-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        font-size: 11px;
        color: var(--text1);
        border-radius: var(--radius-sm);
        cursor: pointer;
        white-space: nowrap;
      }
      .text-lint-gear-item:hover {
        background: var(--surface2);
      }
      .text-lint-gear-item.risky {
        color: var(--orange);
      }
      .text-lint-gear-item input[type="checkbox"] {
        margin: 0;
        accent-color: var(--green);
      }
      .text-lint-result-toolbar .btn-sm {
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        font-size: 11px;
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureStyles, { once: true });
  } else {
    ensureStyles();
  }

  return {
    lint,
    runQuick,
    openPreview,
    getSettings,
    setSetting,
    getSettingMeta,
  };
})();
