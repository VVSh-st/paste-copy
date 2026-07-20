// file_name: text-format.js
/* ============================================================
   TextFormat — 46 пунктов форматирования текста
   ============================================================ */
'use strict';

window.TextFormat = (() => {
  const STORAGE_KEY = 'text-format-last';
  const STORAGE_VARS = 'text-format-vars';

  // ── Определения пунктов ─────────────────────────────────
  const ITEMS = [
    // Tier 1 — Регистр и пробелы (transparent)
    { id: 'upper',    tier: 1, name: 'Верхний регистр',       desc: 'Все символы в верхний регистр', example: 'hello → HELLO', fn: t => t.toUpperCase() },
    { id: 'lower',    tier: 1, name: 'Нижний регистр',        desc: 'Все символы в нижний регистр', example: 'HELLO → hello', fn: t => t.toLowerCase() },
    { id: 'trim',     tier: 1, name: 'Trim строк',            desc: 'Убрать пробелы/табы по краям каждой строки', example: '"  hello  " → "hello"', fn: t => t.split('\n').map(l => l.trim()).join('\n') },
    { id: 'empty',    tier: 1, name: 'Убрать пустые строки',  desc: 'Схлопнуть consecutive пустые строки в одну', example: 'a\\n\\n\\nb → a\\nb', fn: t => t.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n') },
    { id: 'sort',     tier: 1, name: 'Сортировка A→Я',       desc: 'Алфавитная сортировка строк', example: 'b\\na → a\\nb', fn: t => t.split('\n').sort((a, b) => a.localeCompare(b, 'ru')).join('\n') },
    { id: 'dedup',    tier: 1, name: 'Убрать дубли строк',    desc: 'Уникальные строки (порядок сохраняется)', example: 'a\\na\\nb → a\\nb', fn: t => { const seen = new Set(); return t.split('\n').filter(l => { if (seen.has(l)) return false; seen.add(l); return true; }).join('\n'); } },
    { id: 'linenum',  tier: 1, name: 'Номера строк',          desc: 'Добавить нумерацию перед каждой строкой', example: 'a → 1. a', vars: ['1. ', '1) ', '- ', '• ', '→ '], fn: (t, v) => t.split('\n').map((l, i) => { if (v === '1. ') return (i + 1) + '. ' + l; if (v === '1) ') return (i + 1) + ') ' + l; return v + l; }).join('\n') },

    // Tier 2 — Форматирование (subtle)
    { id: 'title',    tier: 2, name: 'Title Case',            desc: 'Каждое слово с заглавной буквы', example: 'hello world → Hello World', fn: t => t.replace(/(^|[^\p{L}])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase()) },
    { id: 'sentence', tier: 2, name: 'Sentence case',         desc: 'Первая буква предложения заглавная', example: 'hello. world → Hello. World', fn: t => t.replace(/(^|[.!?]\s+)([a-zа-яё])/g, (m, p, c) => p + c.toUpperCase()) },
    { id: 'json',     tier: 2, name: 'Формат JSON',          desc: 'Красивое форматирование JSON (2 отступа)', example: '{"a":1} → структурированный', fn: t => { try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; } } },
    { id: 'slug',     tier: 2, name: 'Slugify',               desc: 'URL-safe строка', example: 'Привет Мир! → привет-мир', fn: t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') },
    { id: 'reverse',  tier: 2, name: 'Обратный порядок',      desc: 'Инвертировать порядок строк', example: 'a\\nb\\nc → c\\nb\\na', fn: t => t.split('\n').reverse().join('\n') },
    { id: 'deindent', tier: 2, name: 'Убрать отступ',         desc: 'Убрать минимальный общий пробел/таб со всех строк', example: '  a\\n  b → a\\nb', fn: t => { const lines = t.split('\n'); const nonEmpty = lines.filter(l => l.trim()); if (!nonEmpty.length) return t; const min = nonEmpty.reduce((m, l) => Math.min(m, l.match(/^(\s*)/)[1].length), Infinity); return lines.map(l => l.slice(min)).join('\n'); } },
    { id: 'wrap',     tier: 2, name: 'Wrap на N',             desc: 'Перенос длинных строк по словам', example: 'Текст >40 символов → перенос', vars: ['40', '60', '80', '100', '120'], fn: (t, v) => { const n = parseInt(v); return t.split('\n').map(l => { if (l.length <= n) return l; const words = l.split(' '); let result = '', line = ''; for (const w of words) { if (line && (line + ' ' + w).length > n) { result += line + '\n'; line = w; } else { line = line ? line + ' ' + w : w; } } return result + line; }).join('\n'); } },
    { id: 'split',    tier: 2, name: 'Разбить по',            desc: 'Split по разделителю', example: 'a,b,c → a\\nb\\nc', vars: [',', ';', '|', '\\n', '\\t'], fn: (t, v) => t.split(v === '\\n' ? '\n' : v === '\\t' ? '\t' : v).join('\n') },

    // Tier 3 — Строки (transparent)
    { id: 'prefix',   tier: 3, name: 'Префикс строк',         desc: 'Добавить префикс к каждой строке', example: '> hello', vars: ['> ', '// ', '# ', '  ', '→ '], fn: (t, v) => t.split('\n').map(l => v + l).join('\n') },
    { id: 'uncomment', tier: 3, name: 'Убрать комментарии',  desc: 'Стрипнуть комментарии из начала строк', example: '// code → code', fn: t => t.split('\n').map(l => l.replace(/^\s*(\/\/|#|--|\/\*|\*\/)\s?/, '')).join('\n') },
    { id: 'comment',  tier: 3, name: 'В комментарий',         desc: 'Обернуть каждую строку в комментарий', example: 'code → // code', vars: ['// ', '# ', '/* ', '-- '], fn: (t, v) => t.split('\n').map(l => v + l).join('\n') },
    { id: 'wrapch',   tier: 3, name: 'Обернуть в',            desc: 'Скобки/кавычки вокруг всего текста', example: 'text → (text)', vars: ['()', '[]', '{}', '""', "''"], fn: (t, v) => { const o = v[0], c = v[1]; return o + t + c; } },
    { id: 'join',     tier: 3, name: 'Склеить строки',        desc: 'Всё в одну строку через пробел', example: 'a\\nb → a b', fn: t => t.replace(/\n/g, ' ') },
    { id: 'spaces',   tier: 3, name: 'Схлопнуть пробелы',    desc: 'Множественные пробелы → один', example: 'a   b → a b', fn: t => t.replace(/ {2,}/g, ' ') },
    { id: 'tab2sp',   tier: 3, name: 'Tabs → Spaces',         desc: 'Конвертация табов в пробелы', example: '\\tcode →     code', vars: ['2', '4', '8'], fn: (t, v) => t.replace(/\t/g, ' '.repeat(parseInt(v))) },
    { id: 'sp2tab',   tier: 3, name: 'Spaces → Tabs',         desc: 'Конвертация пробелов в табы', example: '    code → \\tcode', vars: ['2', '4', '8'], fn: (t, v) => { const n = parseInt(v); const re = new RegExp(' {' + n + '}', 'g'); return t.replace(re, '\t'); } },
    { id: 'newline',  tier: 3, name: 'Переносы строк',        desc: 'Конвертация окончаний строк', example: 'CRLF → LF', vars: ['→ LF', '→ CRLF', '→ CR'], fn: (t, v) => { const clean = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); if (v === '→ LF') return clean; if (v === '→ CRLF') return clean.replace(/\n/g, '\r\n'); return clean.replace(/\n/g, '\r'); } },

    // Tier 4 — Код/декод (subtle)
    { id: 'b64',      tier: 4, name: 'Base64',               desc: 'Кодировать/Декодировать Base64', example: 'hello → aGVsbG8=', vars: ['→ Enc', '← Dec'], fn: (t, v) => { try { if (v === '→ Enc') return btoa(unescape(encodeURIComponent(t))); return decodeURIComponent(escape(atob(t))); } catch { return t; } } },
    { id: 'urlencode', tier: 4, name: 'URL Encode',          desc: 'Кодировать/Декодировать URL', example: 'привет → %D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82', vars: ['→ Enc', '← Dec'], fn: (t, v) => { try { if (v === '→ Enc') return encodeURIComponent(t); return decodeURIComponent(t); } catch { return t; } } },
    { id: 'caesar',   tier: 4, name: 'Шифр Цезаря',          desc: 'Сдвиг букв на N позиций', example: 'abc → def (+3)', vars: ['+1', '+3', '+6', '+13', '-1', '-3', '-6', '-13'], fn: (t, v) => { const n = parseInt(v); const alpha = 'abcdefghijklmnopqrstuvwxyz'; const cyr = 'абвгдежзийклмнопрстуфхцчшщъыьэюя'; return t.split('').map(ch => { const isUpper = ch === ch.toUpperCase(); const lower = ch.toLowerCase(); let idx = alpha.indexOf(lower); if (idx !== -1) { idx = (idx + n + 26) % 26; return isUpper ? alpha[idx].toUpperCase() : alpha[idx]; } idx = cyr.indexOf(lower); if (idx !== -1) { idx = (idx + n + 33) % 33; return isUpper ? cyr[idx].toUpperCase() : cyr[idx]; } return ch; }).join(''); } },

    // Tier 5 — Извлечение (transparent)
    { id: 'contacts', tier: 5, name: 'Извлечь контакты',      desc: 'Найти email / URL / телефоны в тексте', example: 'Позвони 8-900-111-22-33 → контакт', fn: t => { const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[^\s<>"')\]}]+|[\+]?[0-9][\-\s\(\)]{7,}[0-9]/g; const found = t.match(re); return found ? found.join('\n') : t; } },
    { id: 'onlynum',  tier: 5, name: 'Извлечь числа',         desc: 'Оставить только цифры из текста', example: 'a1b2c3 → 123', fn: t => t.replace(/[^0-9]/g, '') },
    { id: 'onlylet',  tier: 5, name: 'Извлечь буквы',         desc: 'Оставить только буквы (latin + кириллица)', example: 'h3ll0 → hll', fn: t => t.replace(/[^\p{Script=Latin}\p{Script=Cyrillic}]/gu, '') },
    { id: 'uniqword', tier: 5, name: 'Только уникальные слова', desc: 'Дедупликация слов внутри строк', example: 'a b a c → a b c', fn: t => t.split('\n').map(l => { const seen = new Set(); return l.split(/\s+/).filter(w => { if (seen.has(w)) return false; seen.add(w); return true; }).join(' '); }).join('\n') },
    { id: 'sortword', tier: 5, name: 'Сортировать слова',     desc: 'Слова в каждой строке по алфавиту', example: 'c a b → a b c', fn: t => t.split('\n').map(l => l.split(/\s+/).sort((a, b) => a.localeCompare(b, 'ru')).join(' ')).join('\n') },

    // Tier 6 — Трансформации (subtle)
    { id: 'revtext',  tier: 6, name: 'Обратный текст',        desc: 'Перевернуть текст', example: 'abc → cba', vars: ['буквы', 'строки'], fn: (t, v) => v === 'строки' ? t.split('\n').reverse().join('\n') : t.split('\n').map(l => Array.from(l).reverse().join('')).join('\n') },
    { id: 'shuffle',  tier: 6, name: 'Shuffle строки',        desc: 'Случайный порядок строк', example: 'c\\na\\nb → b\\nc\\na', fn: t => { const a = t.split('\n'); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.join('\n'); } },
    { id: 'sortlen',  tier: 6, name: 'Сортировка по длине',   desc: 'Короткие строки сверху', example: 'ccc\\nbb\\na → a\\nbb\\nccc', fn: t => t.split('\n').sort((a, b) => a.length - b.length).join('\n') },
    { id: 'repeat',   tier: 6, name: 'Повторить N',           desc: 'Дублировать текст N раз', example: 'hello × 3', vars: ['2', '3', '5', '10'], fn: (t, v) => { const n = parseInt(v); return Array(n).fill(t).join('\n'); } },

    // Tier 7 — Оформление (transparent)
    { id: 'trunc',    tier: 7, name: 'Обрезать на N',         desc: 'Truncate каждую строку до N символов', example: 'Длинный текст → Длинный', vars: ['40', '60', '80', '100', '120'], fn: (t, v) => { const n = parseInt(v); return t.split('\n').map(l => l.length > n ? l.slice(0, n) + '…' : l).join('\n'); } },
    { id: 'numstep',  tier: 7, name: 'Prefix цифрами',        desc: 'Пронумеровать строки с шагом', example: '1. a\\n2. b', vars: ['+1', '+5', '+10', '+100'], fn: (t, v) => { const step = parseInt(v); let n = step; return t.split('\n').map(l => (n += step) - step + '. ' + l).join('\n'); } },
    { id: 'noascii',  tier: 7, name: 'Убрать не-ASCII',       desc: 'Оставить только латиницу + цифры', example: 'Привет → (пусто)', fn: t => t.replace(/[^a-zA-Z0-9]/g, '') },

    // Tier 8 — Безумие (subtle)
    { id: 'randcase', tier: 8, name: 'Случайный регистр',     desc: 'Каждая буква случайно верхний/нижний', example: 'hello → hElLo', fn: t => t.split('').map(ch => /[a-zA-Zа-яА-ЯёЁ]/.test(ch) ? (Math.random() > 0.5 ? ch.toUpperCase() : ch.toLowerCase()) : ch).join('') },
    { id: 'mirror',   tier: 8, name: 'Зеркало',              desc: 'Отражение текста', example: 'abc → abc ( ↕ ) или abc ( ↔ )', vars: ['↕ Вертикаль', '↔ Горизонталь'], fn: (t, v) => { if (v === '↕ Вертикаль') { const map = {a:'∀',b:'q',c:'ɔ',d:'p',e:'Ǝ',f:'ꟻ',g:'ƃ',h:'ɥ',i:'ı',j:'ſ',k:'ʞ',l:'˥',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z',A:'∀',B:'q',C:'Ɔ',D:'p',E:'Ǝ',F:'ꟻ',G:'ɓ',H:'H',I:'I',J:'ſ',K:'ʞ',L:'˥',M:'W',N:'N',O:'O',P:'d',Q:'b',R:'ɹ',S:'S',T:'ʇ',U:'∩',V:'Λ',W:'M',X:'X',Y:'⅄',Z:'Z'}; return t.split('\n').map(l => l.split('').map(ch => map[ch] || ch).reverse().join('')).join('\n'); } return t.split('\n').map(l => l.split('').reverse().join('')).join('\n'); } },
    { id: 'leet',     tier: 8, name: 'Leet speak',           desc: 'Замена букв на цифры (1337)', example: 'Hello → H3llo', fn: t => t.replace(/[eE]/g, '3').replace(/[oO]/g, '0').replace(/[iI]/g, '1').replace(/[sS]/g, '5').replace(/[tT]/g, '7').replace(/[aA]/g, '4').replace(/[bB]/g, '8') },
    { id: 'cyr2lat',  tier: 8, name: 'Кириллица ↔ Латиница', desc: 'Однобуквенная подмена кириллицы', example: 'привет → npivеt', fn: t => { const map = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}; return t.split('').map(ch => { const lower = ch.toLowerCase(); const rep = map[lower]; if (!rep) return ch; const isUpper = ch !== lower; const result = isUpper ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep; return result; }).join(''); } },
    { id: 'bubble',   tier: 8, name: 'Bubble text',          desc: 'Полноширинные символы Юникода', example: 'hello → ｈｅｌｌｏ', fn: t => t.split('').map(ch => { const code = ch.charCodeAt(0); if (code >= 33 && code <= 126) return String.fromCharCode(code + 0xFEE0); if (code === 32) return ' '; return ch; }).join('') },
    { id: 'mirrorf',  tier: 8, name: 'Зеркальный шрифт',     desc: 'Юникод-зеркальные буквы', example: 'hello → ollǝh', fn: t => { const map = {a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z',A:'∀',B:'q',C:'Ɔ',D:'p',E:'Ǝ',F:'Ⅎ',G:'⅁',H:'H',I:'I',J:'ſ',K:'ʞ',L:'˥',M:'W',N:'И',O:'O',P:'Ԁ',Q:'Q',R:'Я',S:'S',T:'⊥',U:'∩',V:'Λ',W:'M',X:'X',Y:'⅄',Z:'Z'}; return t.split('').reverse().map(ch => map[ch] || ch).join(''); } },
    { id: 'invisible', tier: 8, name: 'Invisible chars',     desc: 'Вставить zero-width символы между буквами', example: 'hello → h​e​l​l​o', fn: t => t.split('').join('\u200B') },
  ];

  const ITEM_BY_ID = new Map(ITEMS.map(item => [item.id, item]));

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
  let _State = null;

  function _loadState() {
    try { _lastItem = localStorage.getItem(STORAGE_KEY); } catch {}
    try { _vars = JSON.parse(localStorage.getItem(STORAGE_VARS)) || {}; } catch { _vars = {}; }
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
  function execute(item, textarea) {
    if (!textarea) return;
    const text = textarea.value;
    if (!text.trim()) return;
    try { textarea._skipWordComplete = true; } catch {}
    try {
      const varVal = _getVar(item);
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const hasSelection = start !== end;
      const source = hasSelection ? text.slice(start, end) : text;
      const result = item.fn(source, varVal);
      if (result === source) return;
      textarea.value = hasSelection
        ? text.slice(0, start) + result + text.slice(end)
        : result;
      textarea.selectionStart = hasSelection ? start : 0;
      textarea.selectionEnd = hasSelection ? start + result.length : 0;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      try { textarea._skipWordComplete = false; } catch {}
    }
    _lastItem = item.id;
    _saveLastItem(item.id);
    updateButtonIcon();
  }

  // ── Кнопка ──────────────────────────────────────────────
  let _btnEl = null;
  let _tooltip = null;
  let _tooltipTimer = null;

  function updateButtonIcon(btn) {
    const target = btn || _menuBtn || _btnEl;
    if (!target) return;
    const item = _lastItem ? ITEM_BY_ID.get(_lastItem) : null;
    const num = item ? ITEMS.indexOf(item) + 1 : null;
    const numEl = target.querySelector('.tf-btn-num');
    if (numEl) numEl.textContent = num || 'F';
    if (item) {
      target.title = item.name + (item.vars ? ' (' + _getVar(item) + ')' : '') + ' (Shift+F)';
    } else {
      target.title = 'Форматирование текста (Shift+F)';
    }
  }

  function createButton(ta) {
    _loadState();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-ctrl-btn tf-btn';
    btn.title = 'Форматирование текста (Shift+F)';
    btn.innerHTML = '<span class="tf-btn-num">F</span>';
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
        if (item) execute(item, ta);
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
    _tooltip.textContent = item.example || item.desc;
    document.body.appendChild(_tooltip);
    const rect = anchor.getBoundingClientRect();
    _tooltip.style.left = rect.left + 'px';
    _tooltip.style.top = (rect.top - _tooltip.offsetHeight - 6) + 'px';
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
    Object.keys(ITEMS_BY_TIER).sort((a, b) => a - b).forEach((tier, tierIdx) => {
      const isSubtle = tierIdx % 2 === 1;
      ITEMS_BY_TIER[tier].forEach(({ item, idx }, i) => {
        const row = document.createElement('div');
        row.className = 'tf-menu-item' + (isSubtle ? ' tf-subtle' : '');
        if (isSubtle && i === 0) row.classList.add('tf-subtle-first');
        if (_lastItem === item.id) row.classList.add('tf-active');
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
            const tip = document.createElement('div');
            tip.className = 'tf-item-tooltip';
            let varHtml = '';
            if (item.vars) {
              const cur = _getVar(item);
              varHtml = '<br>Варианты: ' + item.vars.map(v =>
                v === cur ? '<code class="tf-tip-active">' + esc(v) + '</code>' : '<code>' + esc(v) + '</code>'
              ).join(' ');
            }
            tip.innerHTML = '<b>' + esc(item.name) + '</b><br>' + esc(item.desc) + (item.example ? '<br><code>' + esc(item.example) + '</code>' : '') + varHtml;
            popup.appendChild(tip);
            const r = row.getBoundingClientRect();
            tip.style.left = (r.right + 8) + 'px';
            tip.style.top = r.top + 'px';
            requestAnimationFrame(() => {
              const tr = tip.getBoundingClientRect();
              if (tr.right > window.innerWidth - 10) {
                tip.style.left = (r.left - tr.width - 8) + 'px';
              }
              if (tr.bottom > window.innerHeight - 10) {
                tip.style.top = Math.max(10, window.innerHeight - tr.height - 10) + 'px';
              }
            });
          }, 500);
        });
        row.addEventListener('mouseleave', () => {
          clearTimeout(hoverTimer);
          const tip = popup.querySelector('.tf-item-tooltip');
          if (tip) tip.remove();
        });

        popup.appendChild(row);
      });
    });

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
      if (rect.bottom > window.innerHeight - 10) {
        popup.style.top = '10px';
        popup.style.bottom = 'auto';
      }
    });

    // aria-expanded
    if (_btnEl) _btnEl.setAttribute('aria-expanded', 'true');

    // Keyboard navigation
    popup.addEventListener('keydown', e => {
      const rows = [...popup.querySelectorAll('.tf-menu-item')];
      const current = document.activeElement;
      const idx = rows.indexOf(current);

      if (e.key === 'Escape') {
        e.preventDefault();
        hideMenu();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows[(idx + 1) % rows.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        rows[(idx - 1 + rows.length) % rows.length]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        current?.click();
      }
    });

    // Focus first item
    requestAnimationFrame(() => {
      popup.querySelector('.tf-menu-item')?.focus();
    });

    // Close handlers
    const onClickOutside = e => {
      if (!popup.contains(e.target)) hideMenu();
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
    if (_btnEl) _btnEl.setAttribute('aria-expanded', 'false');
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
