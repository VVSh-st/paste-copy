// file_name: text-format.js
/* ============================================================
   TextFormat — пункты форматирования текста
   ============================================================ */
'use strict';

window.TextFormat = (() => {
  const STORAGE_KEY = 'text-format-last';
  const STORAGE_VARS = 'text-format-vars';

  const RU_COLLATOR = new Intl.Collator('ru');

  // Zalgo combining marks (precomputed)
  const ZALGO_UP = ['\u030d','\u030e','\u0304','\u0305','\u033f','\u0311','\u0306','\u0310','\u0352','\u0357','\u0351'];
  const ZALGO_MID = ['\u0315','\u031b','\u0340','\u0341','\u0358','\u0321','\u0322','\u0327','\u0328','\u0334','\u0335','\u0336'];
  const ZALGO_DOWN = ['\u0316','\u0317','\u0318','\u0319','\u031c','\u031d','\u031e','\u031f','\u0320','\u0323','\u0324','\u0325'];
  const _zalgoPick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ── Общие regex ─────────────────────────────────────────
  const ALPHA_RE = /[a-zA-Zа-яА-ЯёЁ]/u;
  const isAlpha = ch => ALPHA_RE.test(ch);

  // ── Определения пунктов ─────────────────────────────────
  const ITEMS = [
    // Tier 1 — Регистр и пробелы (transparent)
    { id: 'upper',    tier: 1, name: 'Верхний регистр',       desc: 'Все символы в верхний регистр', example: 'hello → HELLO', fn: t => t.toUpperCase() },
    { id: 'lower',    tier: 1, name: 'Нижний регистр',        desc: 'Все символы в нижний регистр', example: 'HELLO → hello', fn: t => t.toLowerCase() },
    { id: 'trim',     tier: 1, name: 'Trim строк',            desc: 'Убрать пробелы/табы по краям каждой строки', example: '"  hello  " → "hello"', fn: t => t.split('\n').map(l => l.trim()).join('\n') },
    { id: 'empty',    tier: 1, name: 'Убрать пустые строки',  desc: 'Схлопнуть consecutive пустые строки в одну', example: 'a\\n\\n\\nb → a\\nb', fn: t => t.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n') },
    { id: 'sort',     tier: 1, name: 'Сортировка A→Я',       desc: 'Алфавитная сортировка строк', example: 'b\\na → a\\nb', fn: t => t.split('\n').sort(RU_COLLATOR.compare).join('\n') },
    { id: 'dedup',    tier: 1, name: 'Убрать дубли строк',    desc: 'Уникальные строки (порядок сохраняется)', example: 'a\\na\\nb → a\\nb', fn: t => { const seen = new Set(); return t.split('\n').filter(l => { if (seen.has(l)) return false; seen.add(l); return true; }).join('\n'); } },
    { id: 'linenum',  tier: 1, name: 'Номера строк',          desc: 'Добавить нумерацию перед каждой строкой', example: 'a → 1. a', vars: ['1. ', '1) ', '- ', '• ', '→ '], fn: (t, v) => t.split('\n').map((l, i) => { if (v === '1. ') return (i + 1) + '. ' + l; if (v === '1) ') return (i + 1) + ') ' + l; return v + l; }).join('\n') },

    // Tier 2 — Форматирование (subtle)
    { id: 'title',    tier: 2, name: 'Слово с Заглавной',     desc: 'Каждое слово с заглавной буквы', example: 'hELLO world → Hello World', fn: t => t.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase()) },
    { id: 'sentence', tier: 2, name: 'Предложение с Заглавной', desc: 'Первая буква предложения заглавная', example: 'hello. world → Hello. World', fn: t => t.replace(/(^|[.!?…]\s*|\n\s*)(\p{Ll})/gu, (_, p, c) => p + c.toLocaleUpperCase()) },
    { id: 'json',     tier: 2, name: 'Формат JSON',          desc: 'Красивое форматирование JSON', example: '{"a":1} → структурированный', vars: ['2', '4', 'min'], fn: (t, v) => { try { const data = JSON.parse(t); const formatted = v === 'min' ? JSON.stringify(data) : JSON.stringify(data, null, Number.parseInt(v, 10) || 2); return /\n$/.test(t) ? formatted + '\n' : formatted; } catch { return t; } } },
    { id: 'slug',     tier: 2, name: 'Slugify',               desc: 'URL-safe строка', example: 'Привет Мир! → привет-мир', fn: t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') },
    { id: 'caseconv', tier: 2, name: 'Case строки',           desc: 'camelCase / snake_case / kebab-case', example: 'hello world → helloWorld', vars: ['camel', 'snake', 'kebab'], fn: (t, v) => { const words = t.trim().toLowerCase().split(/[^\p{L}\p{N}]+/gu).filter(Boolean); if (v === 'snake') return words.join('_'); if (v === 'kebab') return words.join('-'); return words.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(''); } },
    { id: 'reverse',  tier: 2, name: 'Обратный порядок',      desc: 'Инвертировать порядок строк', example: 'a\\nb\\nc → c\\nb\\na', fn: t => t.split('\n').reverse().join('\n') },
    { id: 'deindent', tier: 2, name: 'Убрать отступ',         desc: 'Убрать минимальный общий пробел/таб со всех строк', example: '  a\\n  b → a\\nb', fn: t => { const lines = t.split('\n'); const nonEmpty = lines.filter(l => l.trim()); if (!nonEmpty.length) return t; const min = nonEmpty.reduce((m, l) => Math.min(m, l.match(/^(\s*)/)[1].length), Infinity); return lines.map(l => l.slice(min)).join('\n'); } },
    { id: 'wrap',     tier: 2, name: 'Перенос на N',             desc: 'Перенос длинных строк по словам', example: 'Текст >40 символов → перенос', vars: ['40', '60', '80', '100', '120'], fn: (t, v) => { const n = Number.parseInt(v, 10); const width = Number.isFinite(n) && n > 0 ? n : 80; return t.split('\n').map(l => { const indent = l.match(/^\s*/)[0]; const body = l.slice(indent.length).trimEnd(); const available = Math.max(1, width - indent.length); if (body.length <= available) return l; const words = body.split(/\s+/); const lines = []; let line = ''; for (const w of words) { if (w.length > available) { if (line) { lines.push(indent + line); line = ''; } for (let i = 0; i < w.length; i += available) lines.push(indent + w.slice(i, i + available)); continue; } if (line && (line + ' ' + w).length > available) { lines.push(indent + line); line = w; } else { line = line ? line + ' ' + w : w; } } if (line) lines.push(indent + line); return lines.join('\n'); }).join('\n'); } },
    { id: 'split',    tier: 2, name: 'Разбить по',            desc: 'Split по разделителю', example: 'a,b,c → a\\nb\\nc', vars: [',', ';', '|', '\\n', '\\t'], fn: (t, v) => t.split(v === '\\n' ? '\n' : v === '\\t' ? '\t' : v).join('\n') },

    // Tier 3 — Строки (transparent)
    { id: 'prefix',   tier: 3, name: 'Префикс строк',         desc: 'Добавить префикс к каждой строке', example: '> hello', vars: ['> ', '// ', '# ', '  ', '→ '], fn: (t, v) => t.split('\n').map(l => v + l).join('\n') },
    { id: 'uncomment', tier: 3, name: 'Убрать комментарии',  desc: 'Стрипнуть комментарии из начала строк', example: '// code → code', fn: t => t.split('\n').map(l => l.replace(/^\s*(\/\/|#|--|\/\*|\*\/)\s?/, '')).join('\n') },
    { id: 'comment',  tier: 3, name: 'В комментарий',         desc: 'Обернуть каждую строку в комментарий', example: 'code → // code', vars: ['// ', '# ', '/* ', '-- '], fn: (t, v) => t.split('\n').map(l => v + l).join('\n') },
    { id: 'wrapch',   tier: 3, name: 'Обернуть в',            desc: 'Скобки/кавычки вокруг всего текста', example: 'text → (text)', vars: ['()', '[]', '{}', '""', "''"], fn: (t, v) => { const pairs = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '""': ['\u0022', '\u0022'], "''": ['\u0027', '\u0027'] }; const [open, close] = pairs[v] || [v[0] || '', v.slice(1) || '']; return open + t + close; } },
    { id: 'join',     tier: 3, name: 'Склеить строки',        desc: 'Всё в одну строку через пробел', example: 'a\\nb → a b', fn: t => t.replace(/\r\n|\r|\n/g, ' ') },
    { id: 'spaces',   tier: 3, name: 'Схлопнуть пробелы',    desc: 'Множественные пробелы → один', example: 'a   b → a b', fn: t => t.replace(/[^\S\r\n]{2,}/g, ' ') },
    { id: 'tab2sp',   tier: 3, name: 'Табы → Пробелы',        desc: 'Конвертация табов в пробелы', example: '\\tcode →     code', vars: ['2', '4', '8'], fn: (t, v) => { const n = Number.parseInt(v, 10); return t.replace(/\t/g, ' '.repeat(Number.isFinite(n) && n > 0 ? n : 4)); } },
    { id: 'sp2tab',   tier: 3, name: 'Пробелы → Табы',        desc: 'Конвертация ведущих пробелов в табы', example: '    code → \\tcode', vars: ['2', '4', '8'], fn: (t, v) => { const parsed = Number.parseInt(v, 10); const size = Number.isInteger(parsed) && parsed > 0 ? parsed : 4; const re = new RegExp(' {' + size + '}', 'g'); return t.split('\n').map(line => { const indent = line.match(/^ */)[0]; return indent.replace(re, '\t') + line.slice(indent.length); }).join('\n'); } },
    { id: 'newline',  tier: 3, name: 'Переносы строк',        desc: 'Конвертация окончаний строк', example: 'CRLF → LF', vars: ['→ LF', '→ CRLF', '→ CR'], fn: (t, v) => { const clean = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); if (v === '→ LF') return clean; if (v === '→ CRLF') return clean.replace(/\n/g, '\r\n'); return clean.replace(/\n/g, '\r'); } },

    // Tier 4 — Код/декод (subtle)
    { id: 'b64',      tier: 4, name: 'Base64',               desc: 'Кодировать/Декодировать Base64', example: 'hello → aGVsbG8=', vars: ['→ Enc', '← Dec'], fn: (t, v) => { try { if (v === '→ Enc') return btoa(unescape(encodeURIComponent(t))); return decodeURIComponent(escape(atob(t))); } catch { return t; } } },
    { id: 'urlencode', tier: 4, name: 'URL-кодирование',      desc: 'Кодировать/Декодировать URL', example: 'привет → %D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82', vars: ['→ Enc', '← Dec'], fn: (t, v) => { try { if (v === '→ Enc') return encodeURIComponent(t); return decodeURIComponent(t); } catch { return t; } } },
    { id: 'caesar',   tier: 4, name: 'Шифр Цезаря',          desc: 'Сдвиг букв на N позиций', example: 'abc → def (+3)', vars: ['+1', '+3', '+6', '+13', '-1', '-3', '-6', '-13'], fn: (t, v) => { const n = Number.parseInt(v, 10); const shift = Number.isFinite(n) ? n : 0; const alpha = 'abcdefghijklmnopqrstuvwxyz'; const cyr = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'; return Array.from(t).map(ch => { const lower = ch.toLowerCase(); const isUpper = lower !== ch; let idx = alpha.indexOf(lower); if (idx !== -1) { idx = (idx + shift + alpha.length) % alpha.length; return isUpper ? alpha[idx].toUpperCase() : alpha[idx]; } idx = cyr.indexOf(lower); if (idx !== -1) { idx = (idx + shift + cyr.length) % cyr.length; return isUpper ? cyr[idx].toUpperCase() : cyr[idx]; } return ch; }).join(''); } },

    // Tier 5 — Извлечение (transparent)
    { id: 'contacts', tier: 5, name: 'Извлечь контакты',      desc: 'Найти email / URL / телефоны в тексте', example: 'Позвони 8-900-111-22-33 → контакт', fn: t => { const re = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|https?:\/\/[^\s<>"')\]}]+|\+?\d[\d\s().-]{7,}\d/gu; const found = t.match(re); return found ? found.map(x => x.replace(/[.,;:!?]+$/g, '')).join('\n') : ''; } },
    { id: 'onlynum',  tier: 5, name: 'Извлечь числа',         desc: 'Оставить только цифры из текста', example: 'a1b2c3 → 123', fn: t => t.replace(/[^0-9]/g, '') },
    { id: 'onlylet',  tier: 5, name: 'Извлечь буквы',         desc: 'Оставить только буквы (latin + кириллица)', example: 'h3ll0 → hll', fn: t => t.replace(/[^\p{Script=Latin}\p{Script=Cyrillic}]/gu, '') },
    { id: 'uniqword', tier: 5, name: 'Только уникальные слова', desc: 'Дедупликация слов внутри строк', example: 'a b a c → a b c', fn: t => t.split('\n').map(l => { const seen = new Set(); return l.trim().split(/\s+/).filter(w => { if (!w || seen.has(w)) return false; seen.add(w); return true; }).join(' '); }).join('\n') },
    { id: 'sortword', tier: 5, name: 'Сортировать слова',     desc: 'Слова в каждой строке по алфавиту', example: 'c a b → a b c', fn: t => t.split('\n').map(l => l.trim().split(/\s+/).filter(Boolean).sort(RU_COLLATOR.compare).join(' ')).join('\n') },

    // Tier 6 — Трансформации (subtle)
    { id: 'revtext',  tier: 6, name: 'Обратный текст',        desc: 'Перевернуть текст', example: 'abc → cba', vars: ['буквы', 'строки'], fn: (t, v) => v === 'строки' ? t.split('\n').reverse().join('\n') : t.split('\n').map(l => Array.from(l).reverse().join('')).join('\n') },
    { id: 'shuffle',  tier: 6, name: 'Shuffle строки',        desc: 'Случайный порядок строк', example: 'c\\na\\nb → b\\nc\\na', fn: t => { const a = t.split('\n'); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.join('\n'); } },
    { id: 'sortlen',  tier: 6, name: 'Сортировка по длине',   desc: 'Короткие строки сверху', example: 'ccc\\nbb\\na → a\\nbb\\nccc', fn: t => t.split('\n').sort((a, b) => a.length - b.length).join('\n') },
    { id: 'repeat',   tier: 6, name: 'Повторить N',           desc: 'Дублировать текст N раз', example: 'hello × 3', vars: ['2', '3', '5', '10'], fn: (t, v) => { const n = Number.parseInt(v, 10); const count = Number.isFinite(n) && n > 0 && n <= 100 ? n : 1; return Array.from({ length: count }, () => t).join('\n'); } },

    // Tier 7 — Оформление (transparent)
    { id: 'trunc',    tier: 7, name: 'Обрезать на N',         desc: 'Truncate каждую строку до N символов', example: 'Длинный текст → Длинный', vars: ['40', '60', '80', '100', '120'], fn: (t, v) => { const limit = Number.parseInt(v, 10); if (!Number.isFinite(limit) || limit < 1) return t; return t.split('\n').map(line => { const chars = Array.from(line); if (chars.length <= limit) return line; return limit === 1 ? '…' : chars.slice(0, limit - 1).join('') + '…'; }).join('\n'); } },
    { id: 'numstep',  tier: 7, name: 'Prefix цифрами',        desc: 'Пронумеровать строки с шагом', example: '1. a\\n6. b', vars: ['+1', '+5', '+10', '+100'], fn: (t, v) => { const step = Number.parseInt(v, 10) || 1; let n = 1; return t.split('\n').map(l => { const out = n + '. ' + l; n += step; return out; }).join('\n'); } },
    { id: 'noascii',  tier: 7, name: 'Только латиница',       desc: 'Оставить только латиницу + цифры', example: 'Привет → (пусто)', fn: t => t.replace(/[^a-zA-Z0-9]/g, '') },
    { id: 'typography', tier: 7, name: 'Типографика',        desc: 'Кавычки, тире, многоточие и неразрывные пробелы', example: '"Привет" -- сказал он... → «Привет» — сказал он…', vars: ['RU', 'basic'], fn: (t, v) => { let out = t.replace(/\.{3}/g, '…').replace(/\s--\s/g, ' — ').replace(/\s-\s/g, ' — ').replace(/(^|\n)-\s/g, '$1— '); if (v === 'RU') { out = out.replace(/"([^"\n]+)"/g, '«$1»').replace(/\b(№)\s+/g, '$1\u00A0').replace(/\b(г|стр|рис|табл)\.\s+/gi, '$1.\u00A0').replace(/(\d)\s+(%|₽|кг|г|м|см|мм|км|ч|мин|сек)\b/gi, '$1\u00A0$2'); } return out; } },

    // Tier 8 — Безумие (subtle)
    { id: 'randcase', tier: 8, name: 'Регистр',              desc: 'Случайный, волновой или пульсирующий регистр', example: 'hello → hElLo', vars: ['random', 'wave', 'pulse'], fn: (t, v) => { if (v === 'wave') { let i = 0; return Array.from(t).map(ch => { if (!isAlpha(ch)) return ch; const out = i % 2 === 0 ? ch.toLowerCase() : ch.toUpperCase(); i++; return out; }).join(''); } if (v === 'pulse') { return t.split(/(\s+)/).map(word => { if (!isAlpha(word)) return word; const letters = Array.from(word); const len = letters.length; if (len === 1) return letters[0].toUpperCase(); const mid = (len - 1) / 2; return letters.map((ch, idx) => { if (!isAlpha(ch)) return ch; const dist = Math.abs(idx - mid) / mid; return dist < 0.4 ? ch.toUpperCase() : ch.toLowerCase(); }).join(''); }).join(''); } return Array.from(t).map(ch => isAlpha(ch) ? (Math.random() > 0.5 ? ch.toUpperCase() : ch.toLowerCase()) : ch).join(''); } },
    { id: 'mirror',   tier: 8, name: 'Зеркало',              desc: 'Разворот текста с Unicode-символами или без', example: 'abc → ɐbɔ или cba', vars: ['↕ Символы', '↔ Простой'], fn: (t, v) => { if (v === '↕ Символы') { const map = {a:'∀',b:'q',c:'ɔ',d:'p',e:'Ǝ',f:'ꟻ',g:'ƃ',h:'ɥ',i:'ı',j:'ſ',k:'ʞ',l:'˥',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z',A:'∀',B:'q',C:'Ɔ',D:'p',E:'Ǝ',F:'ꟻ',G:'ɓ',H:'H',I:'I',J:'ſ',K:'ʞ',L:'˥',M:'W',N:'N',O:'O',P:'d',Q:'b',R:'ɹ',S:'S',T:'ʇ',U:'∩',V:'Λ',W:'M',X:'X',Y:'⅄',Z:'Z',а:'ɐ',б:'ƍ',в:'ʚ',г:'ɹ',е:'ǝ',ё:'ǝ̈',з:'ε',к:'ʞ',м:'w',н:'н',о:'о',р:'d',с:'ɔ',т:'ʇ',у:'ʎ',х:'х',я:'ʁ',А:'∀',Б:'Ƃ',В:'ʚ',Г:'⅃',Е:'Ǝ',Ё:'Ǝ̈',З:'Ɛ',К:'ʞ',М:'W',Н:'Н',О:'О',Р:'Ԁ',С:'Ɔ',Т:'⊥',У:'⅄',Х:'Х',Я:'Я'}; return t.split('\n').map(l => Array.from(l).map(ch => map[ch] || ch).reverse().join('')).join('\n'); } return t.split('\n').map(l => Array.from(l).reverse().join('')).join('\n'); } },
    { id: 'leet',     tier: 8, name: 'Leet speak',           desc: 'Замена букв на цифры (1337)', example: 'Hello → H3llo', fn: t => { const map = {a:'4',b:'8',e:'3',g:'6',i:'1',o:'0',s:'5',t:'7',z:'2',а:'4',б:'6',в:'8',е:'3',ё:'3',и:'1',й:'1',о:'0',с:'5',т:'7',з:'2'}; return t.replace(/[a-zA-Zа-яА-ЯёЁ]/gu, ch => map[ch.toLowerCase()] ?? ch); } },
    { id: 'cyr2lat',  tier: 8, name: 'Кириллица ↔ Латиница', desc: 'Транслитерация (обратимая)', example: 'привет → privet', vars: ['→ Lat', '← Cyr'], fn: (t, v) => { const cyrToLat = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}; if (v === '← Cyr') { const latToCyr = {}; for (const [k, val] of Object.entries(cyrToLat)) { if (val) latToCyr[val] = k; } latToCyr['e'] = 'е';
      const keys = Object.keys(latToCyr).sort((a, b) => b.length - a.length); const re = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'); return t.replace(re, m => { const rep = latToCyr[m.toLowerCase()]; return m[0] !== m[0].toLowerCase() ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep; }); } return t.split('').map(ch => { const rep = cyrToLat[ch.toLowerCase()]; if (!rep) return ch; return ch !== ch.toLowerCase() ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep; }).join(''); } },
    { id: 'bubble',   tier: 8, name: 'Bubble text',          desc: 'Полноширинные символы Юникода', example: 'hello → ｈｅｌｌｏ', vars: ['ASCII', 'Все'], fn: (t, v) => { return Array.from(t).map(ch => { const code = ch.charCodeAt(0); if (code >= 33 && code <= 126) return String.fromCharCode(code + 0xFEE0); if (code === 32) return ' '; if (v === 'Все' && /[а-яА-ЯёЁ]/.test(ch)) return ch + '\u0361'; return ch; }).join(''); } },
    { id: 'mirrorf',  tier: 8, name: 'Зеркальный шрифт',     desc: 'Юникод-зеркальные буквы', example: 'hello → ollǝh', fn: t => { const map = {a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z',A:'∀',B:'q',C:'Ɔ',D:'p',E:'Ǝ',F:'Ⅎ',G:'⅁',H:'H',I:'I',J:'ſ',K:'ʞ',L:'˥',M:'W',N:'И',O:'O',P:'Ԁ',Q:'Q',R:'Я',S:'S',T:'⊥',U:'∩',V:'Λ',W:'M',X:'X',Y:'⅄',Z:'Z',а:'ɐ',б:'ƍ',в:'ʚ',г:'ɹ',д:'ɓ',е:'ǝ',ё:'ǝ̈',ж:'ж',з:'ε',и:'и',й:'ӣ',к:'ʞ',л:'v',м:'w',н:'н',о:'о',п:'u',р:'d',с:'ɔ',т:'ʇ',у:'ʎ',ф:'ф',х:'х',ц:'ц',ч:'Һ',ш:'m',щ:'m',ы:'ıq',э:'є',ю:'oı',я:'ʁ',А:'∀',Б:'Ƃ',В:'ʚ',Г:'⅃',Д:'ᗡ',Е:'Ǝ',Ё:'Ǝ̈',Ж:'Ж',З:'Ɛ',И:'И',Й:'Ӣ',К:'ʞ',Л:'Λ',М:'W',Н:'Н',О:'О',П:'∩',Р:'Ԁ',С:'Ɔ',Т:'⊥',У:'⅄',Ф:'Ф',Х:'Х',Ц:'Ц',Ч:'Һ',Ш:'M',Щ:'M',Ы:'Іᑫ',Э:'Є',Ю:'OІ',Я:'Я'}; return Array.from(t).reverse().map(ch => map[ch] || ch).join(''); } },
    { id: 'zalgo',    tier: 8, name: 'Zalgo',               desc: 'Хаотичные диакритические знаки (glitch text)', example: 'hello → h̷e̸l̶l̴o̷', vars: ['low', 'mid', 'high'], fn: (t, v) => { const count = v === 'high' ? 6 : v === 'low' ? 1 : 3; return Array.from(t).map(ch => { if (!/\p{L}|\p{N}/u.test(ch)) return ch; let out = ch; for (let i = 0; i < count; i++) out += _zalgoPick(ZALGO_UP) + _zalgoPick(ZALGO_MID) + _zalgoPick(ZALGO_DOWN); return out; }).join(''); } },
    { id: 'smallcaps', tier: 8, name: 'Small Caps',           desc: 'Unicode small caps (только латиница)', example: 'Hello World → Hᴇʟʟᴏ Wᴏʀʟᴅ', fn: t => { const map = {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'}; return Array.from(t).map(ch => map[ch.toLowerCase()] || ch).join(''); } },
    { id: 'invisible', tier: 8, name: 'Невидимые символы',    desc: 'Вставить zero-width символы между буквами', example: 'hello → h​e​l​l​o', fn: t => Array.from(t).join('\u200B') },
  ];

  const ITEM_BY_ID = new Map(ITEMS.map(item => [item.id, item]));
  const ITEM_INDEX_BY_ID = new Map(ITEMS.map((item, idx) => [item.id, idx + 1]));

  // Precompute tier grouping
  const ITEMS_BY_TIER = {};
  ITEMS.forEach((item, idx) => {
    if (!ITEMS_BY_TIER[item.tier]) ITEMS_BY_TIER[item.tier] = [];
    ITEMS_BY_TIER[item.tier].push({ item, idx });
  });

  // ── Состояние ───────────────────────────────────────────
  let _popup = null;
  let _lastItem = null;
  let _vars = {};
  let _closeHandlers = [];
  let _closeHandlersTimer = null;
  let _menuBtn = null; // кнопка блока, с которого открыли меню
  let _menuTooltip = null;
  let _State = null;

  function _loadState() {
    try { _lastItem = localStorage.getItem(STORAGE_KEY); } catch {}
    try {
      const raw = localStorage.getItem(STORAGE_VARS);
      const parsed = raw ? JSON.parse(raw) : null;
      _vars = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { _vars = {}; }
  }

  function _saveLastItem(id) { try { localStorage.setItem(STORAGE_KEY, id); } catch {} }
  function _saveVars() { try { localStorage.setItem(STORAGE_VARS, JSON.stringify(_vars)); } catch {} }

  function _getVarIdx(item) {
    if (!item.vars?.length) return 0;
    const saved = Number(_vars[item.id]);
    return Number.isInteger(saved) && saved >= 0 && saved < item.vars.length ? saved : 0;
  }
  function _getVar(item) { return item.vars ? item.vars[_getVarIdx(item)] : null; }
  function _cycleVar(item) {
    if (!item.vars) return;
    const idx = (_getVarIdx(item) + 1) % item.vars.length;
    _vars[item.id] = idx;
    _saveVars();
  }

  // ── Выполнение (с поддержкой выделения) ─────────────────
  function execute(item, textarea, btn) {
    if (!textarea) return;
    const text = textarea.value;
    if (!text.length) return;
    try { textarea._skipWordComplete = true; } catch {}
    try {
      const varVal = _getVar(item);
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const hasSelection = start !== end;
      const source = hasSelection ? text.slice(start, end) : text;
      const result = item.fn(source, varVal);
      _lastItem = item.id;
      _saveLastItem(item.id);
      updateButtonIcon(btn);
      if (result === source) return;
      const scrollTop = textarea.scrollTop;
      textarea.value = hasSelection
        ? text.slice(0, start) + result + text.slice(end)
        : result;
      textarea.selectionStart = hasSelection ? start : result.length;
      textarea.selectionEnd = hasSelection ? start + result.length : result.length;
      textarea.scrollTop = scrollTop;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      try { textarea._skipWordComplete = false; } catch {}
    }
  }

  // ── Кнопка ──────────────────────────────────────────────
  let _btnEl = null;
  let _tooltip = null;
  let _tooltipTimer = null;

  function updateButtonIcon(btn) {
    const target = btn || _menuBtn || _btnEl;
    if (!target) return;
    const item = _lastItem ? ITEM_BY_ID.get(_lastItem) : null;
    const num = item ? ITEM_INDEX_BY_ID.get(item.id) : null;
    const numEl = target.querySelector('.tf-btn-num');
    if (numEl) numEl.textContent = num || 'F';
    const varEl = target.querySelector('.tf-btn-var');
    if (varEl) {
      const raw = item?.vars ? _getVar(item) : '';
      const value = raw.length > 3 ? raw.slice(0, 3) : raw;
      varEl.textContent = value;
      varEl.hidden = !value;
    }
  }

  function createButton(ta) {
    _loadState();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-ctrl-btn tf-btn';
    btn.innerHTML = '<span class="tf-btn-num">F</span><span class="tf-btn-var"></span>';
    btn.setAttribute('aria-label', 'Форматирование текста');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    _btnEl = btn;

    // Long press → menu, short click → last action
    let longPressTimer = null;
    let longPressed = false;

    btn.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      longPressed = false;
      longPressTimer = setTimeout(() => {
        longPressed = true;
        const rect = btn.getBoundingClientRect();
        showMenu(ta, rect.left, rect.top, btn);
      }, 400);
    });
    btn.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    btn.addEventListener('mouseleave', () => clearTimeout(longPressTimer));

    btn.onclick = e => {
      e.stopPropagation();
      clearTimeout(longPressTimer);
      if (longPressed) { longPressed = false; return; }
      if (_lastItem) {
        const item = ITEM_BY_ID.get(_lastItem);
        if (item) execute(item, ta, btn);
      } else {
        const rect = btn.getBoundingClientRect();
        showMenu(ta, rect.left, rect.top, btn);
      }
    };

    // Tooltip
    btn.addEventListener('mouseenter', () => {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = setTimeout(() => _showTooltip(btn), 600);
    });
    btn.addEventListener('mouseleave', () => {
      clearTimeout(_tooltipTimer);
      _hideTooltip();
    });

    updateButtonIcon();
    return btn;
  }

  // ── Tooltip ──────────────────────────────────────────────
  function _showTooltip(anchor) {
    _hideTooltip();
    if (!_lastItem) return;
    const item = ITEM_BY_ID.get(_lastItem);
    if (!item) return;
    _tooltip = document.createElement('div');
    _tooltip.className = 'tf-tooltip';
    const title = document.createElement('div');
    title.className = 'tf-tooltip-title';
    title.textContent = item.name + (item.vars ? ' (' + _getVar(item) + ')' : '');
    const body = document.createElement('div');
    body.className = 'tf-tooltip-body';
    body.textContent = item.example || item.desc;
    _tooltip.appendChild(title);
    _tooltip.appendChild(body);
    document.body.appendChild(_tooltip);
    const rect = anchor.getBoundingClientRect();
    let left = rect.left;
    const top = Math.max(10, rect.top - _tooltip.offsetHeight - 6);
    requestAnimationFrame(() => {
      const tr = _tooltip?.getBoundingClientRect();
      if (tr && tr.right > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - tr.width - 10);
      }
      if (_tooltip) _tooltip.style.left = left + 'px';
    });
    _tooltip.style.left = left + 'px';
    _tooltip.style.top = top + 'px';
  }

  function _hideTooltip() {
    if (_tooltip) { _tooltip.remove(); _tooltip = null; }
  }

  // ── Меню ─────────────────────────────────────────────────
  function showMenu(ta, x, y, btn) {
    hideMenu();
    _loadState();
    _menuBtn = btn || _btnEl;
    const popup = document.createElement('div');
    popup.className = 'tf-menu';
    popup.setAttribute('role', 'menu');
    _popup = popup;

    // Group items by tier (precomputed)
    const fragment = document.createDocumentFragment();
    Object.keys(ITEMS_BY_TIER).sort((a, b) => a - b).forEach((tier, tierIdx) => {
      const isSubtle = tierIdx % 2 === 1;
      ITEMS_BY_TIER[tier].forEach(({ item, idx }, i) => {
        const row = document.createElement('div');
        row.className = 'tf-menu-item' + (isSubtle ? ' tf-subtle' : '');
        if (isSubtle && i === 0) row.classList.add('tf-subtle-first');
        if (_lastItem === item.id) {
          row.classList.add('tf-active');
          row.setAttribute('aria-current', 'true');
        }
        row.setAttribute('role', 'menuitem');
        row.tabIndex = -1;

        const num = document.createElement('span');
        num.className = 'tf-num';
        num.textContent = String(idx + 1).padStart(2, '0');

        const name = document.createElement('span');
        name.className = 'tf-name';
        name.textContent = item.name;

        row.appendChild(num);
        row.appendChild(name);

        // varSpan — кнопка-пилюля для цикла переменной
        let varSpan = null;
        if (item.vars) {
          varSpan = document.createElement('button');
          varSpan.type = 'button';
          varSpan.tabIndex = -1;
          varSpan.className = 'tf-var';
          varSpan.textContent = _getVar(item);
          varSpan.setAttribute('aria-label', 'Переключить параметр');
          varSpan.addEventListener('click', e => {
            e.stopPropagation();
            _cycleVar(item);
            varSpan.textContent = _getVar(item);
            _lastItem = item.id;
            _saveLastItem(item.id);
            updateButtonIcon();
            // Update tooltip active highlight
            const tip = popup.querySelector('.tf-item-tooltip');
            if (tip) {
              const codes = tip.querySelectorAll('code');
              codes.forEach(c => {
                c.classList.toggle('tf-tip-active', c.textContent === _getVar(item));
              });
            }
          });
          row.appendChild(varSpan);
        }

        // Click по строке — только выбрать + закрыть (без apply)
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (item.vars && e.target === varSpan) return; // клик по пилюле обработан выше
          _lastItem = item.id;
          _saveLastItem(item.id);
          updateButtonIcon();
          hideMenu();
        });

        // Hover tooltip
        let hoverTimer = null;
        row.addEventListener('mouseenter', () => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => {
            if (!_menuTooltip) {
              _menuTooltip = document.createElement('div');
              _menuTooltip.className = 'tf-item-tooltip';
              popup.appendChild(_menuTooltip);
            }
            let varHtml = '';
            if (item.vars) {
              const cur = _getVar(item);
              varHtml = '<br>Варианты: ' + item.vars.map(v =>
                v === cur ? '<code class="tf-tip-active">' + esc(v) + '</code>' : '<code>' + esc(v) + '</code>'
              ).join(' ');
            }
            _menuTooltip.innerHTML = '<b>' + esc(item.name) + '</b><br>' + esc(item.desc) + (item.example ? '<br><code>' + esc(item.example) + '</code>' : '') + varHtml;
            _menuTooltip.style.display = '';
            const r = row.getBoundingClientRect();
            let left = r.right + 8;
            let top = r.top;
            requestAnimationFrame(() => {
              if (!_menuTooltip) return;
              const tr = _menuTooltip.getBoundingClientRect();
              if (tr.right > window.innerWidth - 10) left = Math.max(10, r.left - tr.width - 8);
              if (left < 10) left = 10;
              if (tr.bottom > window.innerHeight - 10) top = Math.max(10, window.innerHeight - tr.height - 10);
              _menuTooltip.style.left = left + 'px';
              _menuTooltip.style.top = top + 'px';
            });
            _menuTooltip.style.left = left + 'px';
            _menuTooltip.style.top = top + 'px';
          }, 500);
        });
        row.addEventListener('mouseleave', () => {
          clearTimeout(hoverTimer);
          if (_menuTooltip) _menuTooltip.style.display = 'none';
        });

        fragment.appendChild(row);
      });
    });
    popup.appendChild(fragment);

    document.body.appendChild(popup);

    // Position
    popup.style.left = x + 'px';
    popup.style.bottom = (window.innerHeight - y + 4) + 'px';
    popup.style.top = 'auto';

    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.left + rect.width > window.innerWidth - 10) {
        popup.style.left = (window.innerWidth - rect.width - 10) + 'px';
      }
      if (rect.left < 10) popup.style.left = '10px';
      if (rect.top < 10 || rect.bottom > window.innerHeight - 10) {
        popup.style.top = '10px';
        popup.style.bottom = 'auto';
      }
    });

    // aria-expanded
    const expandedBtn = _menuBtn || _btnEl;
    if (expandedBtn) expandedBtn.setAttribute('aria-expanded', 'true');

    // Keyboard navigation
    popup.addEventListener('keydown', e => {
      const rows = [...popup.querySelectorAll('.tf-menu-item')];
      if (!rows.length) return;
      const current = document.activeElement;
      const idx = rows.indexOf(current);
      const safeIdx = idx === -1 ? 0 : idx;

      if (e.key === 'Escape') {
        e.preventDefault();
        hideMenu();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows[(safeIdx + 1) % rows.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        rows[(safeIdx - 1 + rows.length) % rows.length]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const row = current?.closest?.('.tf-menu-item');
        (row || current)?.click();
      }
    });

    // Focus first item
    requestAnimationFrame(() => {
      popup.querySelector('.tf-menu-item')?.focus();
    });

    // Close handlers
    const onClickOutside = e => {
      if (!popup.contains(e.target) && !_menuBtn?.contains?.(e.target)) hideMenu();
    };
    const onContextMenu = e => {
      if (!popup.contains(e.target)) { e.preventDefault(); hideMenu(); }
    };
    _closeHandlersTimer = setTimeout(() => {
      _closeHandlersTimer = null;
      if (_popup !== popup) return; // stale — new menu opened
      document.addEventListener('mousedown', onClickOutside, true);
      document.addEventListener('contextmenu', onContextMenu, true);
    }, 0);
    _closeHandlers.push(
      () => document.removeEventListener('mousedown', onClickOutside, true),
      () => document.removeEventListener('contextmenu', onContextMenu, true)
    );
  }

  function hideMenu() {
    if (_closeHandlersTimer) { clearTimeout(_closeHandlersTimer); _closeHandlersTimer = null; }
    if (_popup) { _popup.remove(); _popup = null; }
    _menuTooltip = null;
    const expandedBtn = _menuBtn || _btnEl;
    if (expandedBtn) expandedBtn.setAttribute('aria-expanded', 'false');
    _menuBtn = null;
    _closeHandlers.forEach(fn => fn());
    _closeHandlers = [];
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Public API ──────────────────────────────────────────
  function init(State) {
    _State = State;
  }

  function openMenu(ta) {
    if (!ta) return;
    // Find the button from the same block
    const block = ta.closest('.block');
    const btn = block?.querySelector('.tf-btn');
    const rect = ta.getBoundingClientRect();
    showMenu(ta, rect.left + 10, rect.top, btn);
  }

  return { init, createButton, execute, openMenu, hideMenu, updateButtonIcon, ITEMS };
})();
