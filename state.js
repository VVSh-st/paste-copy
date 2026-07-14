// file_name: state.js

const State = (() => {
  'use strict';

  let tabs              = [];
  let activeTabId       = null;
  let defaultTemplateId = null;
  let globalSnippets    = [];

  const DEFAULT_LAYOUT = {
    colRatio:        0.5,
    columnCount:     2,
    colRatios:       null,
    previewHeight:   220,
    previewFontSize: 12,
    previewWrap:     true,
    previewMarkdown: false,
    previewHeaders:  true,
    currentLineHighlight: false,
    currentLineColor:     'rgba(79,142,247,0.18)',
    spellCheck:           true,
    blockHeights:    {},

    llm: {
      enabled:         true,
      activeProfileId: null,
      profiles:        [],
      streaming:       true,
      debugMode:       false,
      customPrompts:   {},
      diffMode:        'classic',
      diffEffectMs:    3500,

      ghost: {
        enabled:        false,
        profileId:      null,
        strategy:       'word',
        words:          5,
        lines:          3,
        debounce:       800,
        acceptKey:      'Tab',
        minChars:       20,
        noCode:         true,
        noLists:        true,
        noVars:         true,
        matrixEffectMs: 3500,
      },

      bro: {
        enabled:   true,
        tags:      [],
        usage:     {},
        chatDepth: 6,
      },

      cache: {
        enabled:    true,
        ttlH:       24,
        maxEntries: 200,
      },

      history: {
        enabled: true,
        limit:   100,
      },
    },
  };

  let layout = _cloneDeep(DEFAULT_LAYOUT);

  const listeners     = [];
  const liveListeners = [];
  const snapTimers    = new Map();

  const uid = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 10);

  const SUBTABS_COUNT = 20;

  const iconPool   = [...'📄📝📌📎✏️📋📑🗂📊📈📉📚📖📕📗📘📙📓📔📒'];
  const randomIcon = () => iconPool[Math.floor(Math.random() * iconPool.length)];

  /* ── Deep utilities ── */

  // [FIX] Защита от prototype pollution
  const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function _cloneDeep(obj) {
    // JSON round-trip is fine for plain data; avoids lodash dependency
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Deep-merge `saved` into `defaults`.
   * - Plain objects: merged recursively (saved wins on conflicts).
   * - Arrays: replaced wholesale by the saved value.
   *   Rationale: user-created arrays (profiles, tags) must not be clobbered
   *   by defaults. New default array items won't appear automatically — that
   *   is intentional to prevent overwriting user deletions.
   * - Primitives / null: saved value wins.
   */
  // [FIX] Клонируем saved values — предотвращаем скрытые мутации через live-ссылки
  function _cloneSavedValue(value) {
    if (value && typeof value === 'object') return _cloneDeep(value);
    return value;
  }

  function deepMerge(defaults, saved) {
    // Guard: if saved is missing, return a fresh clone of defaults
    if (saved === null || saved === undefined) return _cloneDeep(defaults);

    // Primitive or array in defaults → saved wins (cloned)
    if (typeof defaults !== 'object' || Array.isArray(defaults)) return _cloneSavedValue(saved);

    // saved is not a plain object → saved wins (type mismatch, e.g. old schema)
    if (typeof saved !== 'object' || Array.isArray(saved)) return _cloneDeep(defaults);

    const result = _cloneDeep(defaults);

    for (const key of Object.keys(saved)) {
      if (UNSAFE_MERGE_KEYS.has(key)) continue;
      const sv = saved[key];
      const dv = result[key]; // use result (already a clone of defaults)

      if (
        sv !== null && sv !== undefined &&
        typeof sv === 'object' && !Array.isArray(sv) &&
        dv !== null && dv !== undefined &&
        typeof dv === 'object' && !Array.isArray(dv)
      ) {
        result[key] = deepMerge(dv, sv);
      } else {
        // Primitives, arrays, null — saved value wins (cloned)
        result[key] = _cloneSavedValue(sv);
      }
    }

    return result;
  }

  /* ── default content factories ── */

  function defaultSnippets() {
    return [];
  }

  function defaultCommands() {
    return [];
  }

  function normalizeSnippetValue(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function addGlobalSnippet(title, value, meta = {}) {
    const clean = normalizeSnippetValue(value);
    if (!clean) return null;
    const duplicate = globalSnippets.find(item => normalizeSnippetValue(item.value) === clean);
    if (duplicate) return duplicate;

    const item = {
      id: uid(),
      title: String(title || '').trim() || clean.slice(0, 40),
      value: clean,
      enabled: true,
      global: true,
      createdAt: Date.now(),
      meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
    };
    globalSnippets.unshift(item);
    emit();
    return item;
  }

  function removeGlobalSnippet(id) {
    const before = globalSnippets.length;
    globalSnippets = globalSnippets.filter(item => item.id !== id);
    if (globalSnippets.length !== before) emit();
    return globalSnippets.length !== before;
  }

  function getGlobalSnippets() {
    return globalSnippets.map(item => ({ ...item }));
  }

  function toggleGlobalSnippet(id) {
    const item = globalSnippets.find(i => i.id === id);
    if (!item) return false;
    item.enabled = !item.enabled;
    emit();
    return item.enabled;
  }

  function updateGlobalSnippetLive(id, fn) {
    const item = globalSnippets.find(i => i.id === id);
    if (!item) return;
    try { fn(item); } catch (e) { console.error('[State.updateGlobalSnippetLive]', e); }
    emitLive();
  }

  function updateGlobalSnippet(id, fn) {
    const item = globalSnippets.find(i => i.id === id);
    if (!item) return;
    try { fn(item); } catch (e) { console.error('[State.updateGlobalSnippet]', e); }
    emit();
  }

  function clearGlobalSnippets() {
    if (!globalSnippets.length) return false;
    globalSnippets = [];
    emit();
    return true;
  }

  function mergeGlobalSnippets(items = []) {
    const seen = new Set(globalSnippets.map(item => normalizeSnippetValue(item.value)));
    let changed = false;
    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const clean = normalizeSnippetValue(raw?.value);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      globalSnippets.push({
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : uid(),
        title: String(raw.title || '').trim() || clean.slice(0, 40),
        value: clean,
        enabled: raw.enabled !== false,
        global: true,
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
        meta: raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {},
      });
      changed = true;
    }
    if (changed) emit();
    return changed;
  }

  function defaultBlocks() {
    return [
      makeBlock('База промпта', randomIcon(), 0, 'Основной системный промпт...', 'text'),
      makeBlock('Замечания',    randomIcon(), 0, 'Что исправить...',             'text'),
      makeBlock('Улучшения',    randomIcon(), 0, 'Что добавить...',              'text'),
      makeBlock('Скрипт',       randomIcon(), 1, 'Текущий код...',               'text'),
      makeBlock('Стили',        randomIcon(), 1, 'CSS и оформление...',          'text'),
      makeBlock('Разное',       randomIcon(), 1, 'Всё остальное...',             'text'),
      makeBlock('Сниппеты',     '⚡',         1, '',                             'commands'),
    ];
  }

  function makeBlock(title, icon, column, placeholder, type = 'text') {
    const block = { id: uid(), title, icon: icon || randomIcon(), column, collapsed: false, type };

    if (type === 'text') {
      block.activeSubtab = 0;
      block.subtabs      = Array.from({ length: SUBTABS_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
      block.placeholder  = placeholder || '';
      block.fontSize     = 13.5;
      block.height       = null;
    } else if (type === 'snippets') {
      block.items      = defaultSnippets();
      block.showTitles = true;
    } else if (type === 'commands') {
      block.items = defaultCommands();
    } else if (type === 'group') {
      block.enabled  = true;
      block.children = [];
    } else if (type === 'variable') {
      block.variableName  = 'name';
      block.variableValue = '';
    } else if (type === 'sticky') {
      block.color    = 'yellow';
      block.value    = '';
      block.fontSize = 13;
    } else if (type === 'todo') {
      block.activeSubtab = 0;
      block.subtabs = Array.from({ length: 5 }, (_, i) => ({
        label: String(i + 1), name: '', items: [],
      }));
    } else if (type === 'table') {
      block.activeSubtab = 0;
      block.subtabs = Array.from({ length: 5 }, (_, i) => ({
        label: String(i + 1), name: '', cols: 2,
        rows: [['', ''], ['', '']],
      }));
    }

    return block;
  }

  // [FIX] Выносим общую логику миграции subtabs для todo/table
  function _migrateSubtabs(block, defaultItemFactory) {
    // [FIX] Проверяем что subtabs — массив, а не строка/объект
    if (!Array.isArray(block.subtabs)) {
      block.activeSubtab = 0;
      block.subtabs = Array.from({ length: 5 }, (_, i) => defaultItemFactory(i));
    }
    // [FIX] Нормализуем каждый элемент — null/bad элементы заменяем дефолтами
    block.subtabs = block.subtabs.map((sub, i) => {
      const def = defaultItemFactory(i);
      if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return def;
      return { ...def, ...sub, label: String(sub.label ?? def.label) };
    });
    while (block.subtabs.length > 5) block.subtabs.pop();
    while (block.subtabs.length < 5) block.subtabs.push(defaultItemFactory(block.subtabs.length));
    if (
      !Number.isInteger(block.activeSubtab) ||
      block.activeSubtab < 0 ||
      block.activeSubtab >= 5
    ) block.activeSubtab = 0;
  }

  function migrate(blocks, usedBlockIds = new Set()) {
    // [FIX] Фильтруем невалидные блоки — null/string/array не ломают миграцию
    const list = Array.isArray(blocks) ? blocks : [];
    return list
      .filter(b => b && typeof b === 'object' && !Array.isArray(b))
      .map(b => {
      // [FIX] Нормализуем базовые поля + дедупликация block ID
      const rawId = typeof b.id === 'string' ? b.id.trim() : '';
      if (rawId && !usedBlockIds.has(rawId)) {
        b.id = rawId;
        usedBlockIds.add(rawId);
      } else {
        do { b.id = uid(); } while (usedBlockIds.has(b.id));
        usedBlockIds.add(b.id);
      }
      b.title = String(b.title || '');
      if (!Number.isInteger(b.column)) b.column = 0;
      b.column = Math.max(0, Math.min(4, b.column));
      b.collapsed = !!b.collapsed;
      if (!b.type) b.type = 'text';
      if (!b.icon) b.icon = randomIcon();

      if (b.type === 'text') {
        if (!Array.isArray(b.subtabs)) b.subtabs = Array.from({ length: SUBTABS_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
        // [FIX] Безопасная маппинг subtabs — защищает от повреждённых данных
        b.subtabs = b.subtabs.map((st, i) => ({
          label: String(st?.label ?? i + 1),
          name: String(st?.name ?? ''),
          value: String(st?.value ?? ''),
          completed: !!st?.completed,
          blocked: !!st?.blocked,
        }));
        // Ensure subtabs array is not shorter than SUBTABS_COUNT (schema upgrade)
        while (b.subtabs.length < SUBTABS_COUNT)
          b.subtabs.push({ label: String(b.subtabs.length + 1), value: '' });
        // [FIX] Обрезаем слишком длинный массив — защита от повреждённых данных
        if (b.subtabs.length > SUBTABS_COUNT) b.subtabs.length = SUBTABS_COUNT;
        if (
          !Number.isInteger(b.activeSubtab) ||
          b.activeSubtab < 0 ||
          b.activeSubtab >= b.subtabs.length
        ) b.activeSubtab = 0;
        if (!b.fontSize)            b.fontSize = 13.5;
        if (b.height === undefined) b.height   = null;
      }

      if ((b.type === 'snippets' || b.type === 'commands') && !Array.isArray(b.items)) {
        b.items = b.type === 'snippets' ? defaultSnippets() : defaultCommands();
      }

      // Миграция: snippets → commands
      if (b.type === 'snippets') {
        b.type = 'commands';
        b.title = 'Сниппеты';
        b.icon = '⚡';
        // Фильтруем старые дефолтные сниппеты — не переносим их
        const _oldDefaultValues = new Set([
          'отвечай кратко и по делу, без воды.',
          'используй markdown форматирование.',
          'распиши решение по шагам, нумеруй этапы.',
          'приводи примеры кода с пояснениями.',
          'ты — опытный senior-разработчик с 10+ лет опыта.',
          'ты — терпеливый ментор, объясняй как новичку.',
          'не добавляй оговорки и предисловия, сразу к делу.',
          'оформляй результат в виде таблицы markdown.',
          'приведи плюсы и минусы в двух колонках.',
          'верни ответ строго в формате json без лишнего текста.',
          'будь критичным, найди слабые места и уязвимости.',
          'оцени производительность и предложи оптимизации.',
          'объясни простыми словами, как для новичка:',
          'сократи текст, оставив только главное:',
          'переведи на русский язык:',
          'translate to english:',
          'сделай детальное код-ревью:',
          'найди логические и грамматические ошибки:',
          'улучши читаемость и производительность кода:',
          'напиши unit-тесты для следующего кода:',
          'напиши документацию (jsdoc/docstring) для:',
          'проведи рефакторинг, не меняя поведение:',
        ]);
        b.items = (b.items || [])
          .map(i => ({ id: i.id, label: i.title || '', value: i.value || '' }))
          .filter(i => !_oldDefaultValues.has((i.value || '').trim().toLowerCase()));
        delete b.showTitles;
      }

      if (b.type === 'group') {
        // [FIX] Проверяем что children — массив
        if (!Array.isArray(b.children)) b.children = [];
        if (b.enabled === undefined) b.enabled = true;
        b.children = migrate(b.children, usedBlockIds);
      }

      if (b.type === 'variable' && b.variableName === undefined) {
        b.variableName  = 'var';
        b.variableValue = '';
      }

      if (b.type === 'sticky') {
        if (b.color === undefined) b.color = 'yellow';
        if (b.value === undefined) b.value = '';
      }

      if (b.type === 'todo') {
        _migrateSubtabs(b, i => ({ label: String(i + 1), name: '', items: [] }));
        // [FIX] Нормализуем todo subtabs — защита от повреждённых данных
        for (const sub of b.subtabs) {
          sub.name = String(sub.name ?? '');
          if (!Array.isArray(sub.items)) sub.items = [];
        }
      }

      if (b.type === 'table') {
        _migrateSubtabs(b, i => ({ label: String(i + 1), name: '', cols: 2, rows: [['', ''], ['', '']] }));
        // [FIX] Нормализуем table subtabs — защита от повреждённых данных
        for (const sub of b.subtabs) {
          if (!Array.isArray(sub.rows)) sub.rows = [['', ''], ['', '']];
          const detectedCols = Array.isArray(sub.rows[0]) ? sub.rows[0].length : 2;
          if (!Number.isInteger(sub.cols)) sub.cols = Math.max(1, Math.min(4, detectedCols || 2));
          sub.cols = Math.max(1, Math.min(4, sub.cols));
          sub.rows = sub.rows.map(row => {
            const cells = Array.isArray(row) ? row : [];
            return Array.from({ length: sub.cols }, (_, i) => String(cells[i] ?? ''));
          });
          if (!sub.rows.length) {
            sub.rows = [
              Array.from({ length: sub.cols }, () => ''),
              Array.from({ length: sub.cols }, () => ''),
            ];
          }
        }
      }

      return b;
    });
  }

  function _deduplicateCommandsBlocks(blocks) {
    const commandsBlocks = blocks.filter(b => b.type === 'commands');
    if (commandsBlocks.length <= 1) return blocks;
    // Объединяем все items в первый блок, остальные удаляем
    const primary = commandsBlocks[0];
    for (let i = 1; i < commandsBlocks.length; i++) {
      const extra = commandsBlocks[i];
      const existingValues = new Set(primary.items.map(item => (item.value || '').trim().toLowerCase()));
      for (const item of (extra.items || [])) {
        const val = (item.value || '').trim().toLowerCase();
        if (val && !existingValues.has(val)) {
          primary.items.push(item);
          existingValues.add(val);
        }
      }
    }
    return blocks.filter(b => !(b.type === 'commands' && b !== primary));
  }

  /* ── event bus ── */

  // [FIX] Безопасный вызов listener'ов — исключение в одном не убивает остальные
  function _safeListenerCall(fn, label) {
    try { fn(); } catch (err) {
      console.error(`[State.${label}] listener failed.`, err);
    }
  }

  const emit     = () => listeners.forEach(l => _safeListenerCall(l, 'onChange'));
  const emitLive = () => liveListeners.forEach(l => _safeListenerCall(l, 'onLive'));
  const onChange = fn => { if (typeof fn !== 'function') return; listeners.push(fn); };
  const onLive   = fn => { if (typeof fn !== 'function') return; liveListeners.push(fn); };

  /* Легковесный автобус — срабатывает когда история реально изменилась (без re-render блоков) */
  const _snapListeners = [];
  const _snapEmit = () => _snapListeners.forEach(l => _safeListenerCall(l, 'onSnapshot'));
  const onSnapshot = fn => { if (typeof fn !== 'function') return; _snapListeners.push(fn); };

  /* ── diff snapshot helpers ── */

  function _deepDiff(a, b) {
    if (a === b) return null;
    if (typeof a !== 'object' || typeof b !== 'object') return { v: _cloneDeep(b) };
    if (Array.isArray(a) !== Array.isArray(b)) return { v: _cloneDeep(b) };

    const patch = {};
    let changed = false;
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      if (key === 'id') continue;
      const av = JSON.stringify(a[key]);
      const bv = JSON.stringify(b[key]);
      if (av === bv) continue;
      patch[key] = _cloneDeep(b[key]);
      changed = true;
    }
    return changed ? patch : null;
  }

  function _computeDelta(base, current) {
    const changes = [];
    if (base.separator !== current.separator) {
      changes.push({ _sep: current.separator });
    }
    const baseMap = new Map(base.blocks.map(b => [b.id, b]));
    const curMap  = new Map(current.blocks.map(b => [b.id, b]));

    for (const [id] of baseMap) {
      if (!curMap.has(id)) changes.push({ id, _d: true });
    }
    for (const [id, block] of curMap) {
      const bb = baseMap.get(id);
      if (!bb) {
        changes.push({ id, _n: true, block: _cloneDeep(block) });
      } else {
        const diff = _deepDiff(bb, block);
        if (diff) changes.push({ id, patch: diff });
      }
    }
    return changes.length ? changes : null;
  }

  function _applyDelta(state, delta) {
    const s = { blocks: _cloneDeep(state.blocks), separator: state.separator };
    for (const ch of delta) {
      if (ch._sep !== undefined) { s.separator = ch._sep; continue; }
      if (ch._d) { s.blocks = s.blocks.filter(b => b.id !== ch.id); continue; }
      if (ch._n) { s.blocks.push(_cloneDeep(ch.block)); continue; }
      if (ch.patch) {
        const idx = s.blocks.findIndex(b => b.id === ch.id);
        if (idx >= 0) s.blocks[idx] = { ...s.blocks[idx], ...ch.patch };
        // Если ID не найден — пропускаем (данные могли измениться между снапшотами)
      }
    }
    return s;
  }

  function _rebuildFromHistory(tab, targetIdx) {
    if (!tab.history.base) return null;
    // Оптимизация: если targetIdx < 0 — возвращаем base без применения дельт
    if (targetIdx < 0) return { blocks: _cloneDeep(tab.history.base.blocks), separator: tab.history.base.separator };
    let state = { blocks: _cloneDeep(tab.history.base.blocks), separator: tab.history.base.separator };
    for (let i = 0; i <= targetIdx && i < tab.history.deltas.length; i++) {
      const d = tab.history.deltas[i];
      if (d?.changes) state = _applyDelta(state, d.changes);
    }
    return state;
  }

  function _migrateHistory(raw) {
    if (Array.isArray(raw)) {
      if (!raw.length) return { base: null, deltas: [] };
      try {
        const parsed = JSON.parse(raw[raw.length - 1]);
        return { base: { blocks: parsed.blocks, separator: parsed.separator }, deltas: [] };
      } catch { return { base: null, deltas: [] }; }
    }
    if (raw && typeof raw === 'object' && raw.base) return raw;
    return { base: null, deltas: [] };
  }

  /* ── tab management ── */

  function newTab(name) {
    if (!name) {
      let n = 1;
      while (tabs.some(t => t.name === `Project ${n}`)) n++;
      name = `Project ${n}`;
    }
    const tab = {
      id: uid(), name, separator: '\n\n',
      blocks: defaultBlocks(),
      history: { base: null, deltas: [] }, historyIdx: -1,
      namedSnapshots: [],
      anchors: [],
    };
    tabs.push(tab);
    activeTabId = tab.id;
    // Take the initial snapshot so undo/redo index is valid from the start
    snapshot(tab);
    emit();
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    clearTimeout(snapTimers.get(id));
    snapTimers.delete(id);
    // Очистка per-block history для всех блоков закрытой вкладки
    const closedTab = tabs[idx];
    if (closedTab?.blocks) closedTab.blocks.forEach(b => _dropBlockHistory(b));
    tabs.splice(idx, 1);
    if (activeTabId === id)
      activeTabId = tabs.length ? tabs[Math.max(0, idx - 1)].id : null;
    if (!tabs.length) newTab();
    else emit();
  }

  function renameTab(id, name) {
    const t = tabs.find(t => t.id === id);
    if (t && name && name.trim()) { t.name = name.trim(); emit(); }
  }

  function moveTab(fromId, toId) {
    const fromIdx = tabs.findIndex(t => t.id === fromId);
    const toIdx   = tabs.findIndex(t => t.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const [moved] = tabs.splice(fromIdx, 1);
    tabs.splice(toIdx, 0, moved);
    emit();
  }

  function addBlock(type, targetGroupId) {
    type = type || 'text';
    const t = getActive();
    if (!t) return;

    let title, icon;
    if      (type === 'snippets') { title = 'Сниппеты';        icon = '💬'; }
    else if (type === 'commands') { title = 'Сниппеты';        icon = '⚡'; }
    else if (type === 'group')    { title = 'Группа';          icon = '📁'; }
    else if (type === 'variable') { title = 'Переменная';      icon = '🔤'; }
    else if (type === 'sticky')   { title = 'Заметка';         icon = '📌'; }
    else if (type === 'todo')     { title = 'Чеклист';         icon = '☑️'; }
    else if (type === 'table')    { title = 'Таблица';         icon = '📊'; }
    else {
      const usedNums = (t.blocks || []).map(b => {
        const m = (b.title || '').match(/^NEW (\d+)$/);
        return m ? +m[1] : 0;
      });
      const nextNum = Math.max(0, ...usedNums) + 1;
      title = 'NEW ' + nextNum;
      icon = randomIcon();
    }

    const colCount = Math.max(2, Math.min(5, layout.columnCount || 2));
    const colCounts = Array.from({ length: colCount }, (_, i) =>
      t.blocks.filter(b => b.column === i).length
    );
    const col = colCounts.indexOf(Math.min(...colCounts));
    const b = makeBlock(title, icon, col, '', type);

    update(tab => {
      if (targetGroupId) {
        const grp = findBlock(tab.blocks, targetGroupId);
        if (grp?.type === 'group') { grp.children.push(b); return; }
      }
      tab.blocks.push(b);
    });
    return b.id;
  }

  /* ── block helpers ── */

  function findBlock(blocks, id) {
    for (const b of blocks) {
      if (b.id === id) return b;
      if (b.type === 'group' && b.children) {
        const found = findBlock(b.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  // [FIX] Очистка per-block history при удалении — предотвращает утечку памяти
  function _dropBlockHistory(block) {
    if (!block) return;
    _blockHistory.delete(block.id);
    if (block.type === 'group' && Array.isArray(block.children)) {
      block.children.forEach(_dropBlockHistory);
    }
  }

  function removeBlock(blocks, id) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) {
        _dropBlockHistory(blocks[i]);
        blocks.splice(i, 1);
        return true;
      }
      if (blocks[i].type === 'group' && blocks[i].children) {
        if (removeBlock(blocks[i].children, id)) return true;
      }
    }
    return false;
  }

  /* ── active tab ── */

  const getActive = () => tabs.find(t => t.id === activeTabId) ?? null;
  const getAll    = () => tabs;
  // [FIX] Проверяем что вкладка существует — предотвращает невалидное состояние
  const setActive = id => {
    if (id === activeTabId) return;
    if (!tabs.some(t => t.id === id)) return;
    activeTabId = id;
    emit();
  };

  /* ── history ── */

  function snapshot(tab) {
    tab = tab ?? getActive();
    if (!tab) return;

    const currentState = { blocks: tab.blocks, separator: tab.separator };

    // Первый снапшот — сохраняем как base
    if (!tab.history.base) {
      try { tab.history.base = _cloneDeep(currentState); } catch (err) {
        console.error('[State.snapshot] Failed to clone base.', err); return;
      }
      tab.history.deltas = [];
      tab.historyIdx = 0;
      _snapEmit();
      return;
    }

    // Вычисляем дельту от base
    let delta;
    try { delta = _computeDelta(tab.history.base, currentState); } catch (err) {
      console.error('[State.snapshot] Failed to compute delta.', err); return;
    }
    if (!delta) return; // ничего не изменилось

    // Обрезаем будущие ветки (historyIdx = deltas.length, slice до него сохраняет все прошлые)
    tab.history.deltas = tab.history.deltas.slice(0, tab.historyIdx);
    tab.history.deltas.push({ changes: delta, ts: Date.now() });

    // Лимит 30: replay — создаём новый base из текущего состояния
    if (tab.history.deltas.length > 30) {
      try { tab.history.base = _cloneDeep(currentState); } catch (err) {
        console.error('[State.snapshot] Failed to replay base.', err); return;
      }
      tab.history.deltas.shift();
    }

    tab.historyIdx = tab.history.deltas.length;
    _snapEmit();
  }

  function scheduleSnapshot(tab) {
    if (!tab?.id) return;
    clearTimeout(snapTimers.get(tab.id));
    snapTimers.set(tab.id, setTimeout(() => {
      // [FIX] Вкладку могли закрыть после постановки таймера
      if (tabs.includes(tab)) snapshot(tab);
      snapTimers.delete(tab.id);
    }, 500));
  }

  function applySnap(t, snap) {
    // [FIX] Защита от битых snapshots — предотвращает крэш
    try {
      const data  = JSON.parse(snap);
      t.blocks    = _deduplicateCommandsBlocks(migrate(Array.isArray(data.blocks) ? data.blocks : []));
      t.separator = typeof data.separator === 'string' ? data.separator : '\n\n';
      return true;
    } catch (err) {
      console.error('[State.applySnap] Failed to apply snapshot.', err);
      return false;
    }
  }

  function undo() {
    const t = getActive();
    if (!t || t.historyIdx <= 0) return;
    const prevIdx = t.historyIdx;
    t.historyIdx--;
    const state = t.historyIdx === 0
      ? t.history.base
      : _rebuildFromHistory(t, t.historyIdx - 1);
    if (!state) { t.historyIdx = prevIdx; return; }
    try {
      t.blocks    = _deduplicateCommandsBlocks(migrate(_cloneDeep(state.blocks)));
      t.separator = state.separator;
    } catch (err) {
      console.error('[State.undo] Failed to apply.', err);
      t.historyIdx = prevIdx;
      return;
    }
    _snapEmit();
    emit();
  }

  function redo() {
    const t = getActive();
    if (!t || t.historyIdx >= t.history.deltas.length) return;
    const prevIdx = t.historyIdx;
    t.historyIdx++;
    const state = t.historyIdx === 0
      ? t.history.base
      : _rebuildFromHistory(t, t.historyIdx - 1);
    if (!state) { t.historyIdx = prevIdx; return; }
    try {
      t.blocks    = _deduplicateCommandsBlocks(migrate(_cloneDeep(state.blocks)));
      t.separator = state.separator;
    } catch (err) {
      console.error('[State.redo] Failed to apply.', err);
      t.historyIdx = prevIdx;
      return;
    }
    _snapEmit();
    emit();
  }

  const canUndo = () => { const t = getActive(); return !!t && t.historyIdx > 0; };
  const canRedo = () => { const t = getActive(); return !!t && t.historyIdx < t.history.deltas.length; };

  /* ── per-block history (diff-based) ── */

  const _blockHistory = new Map();

  function _bh(blockId) {
    if (!_blockHistory.has(blockId)) _blockHistory.set(blockId, { base: null, deltas: [], idx: -1 });
    return _blockHistory.get(blockId);
  }

  function _computeSubtabsDelta(base, current) {
    if (!Array.isArray(base) || !Array.isArray(current)) return null;
    const changes = [];
    const maxLen = Math.max(base.length, current.length);
    for (let i = 0; i < maxLen; i++) {
      const bs = base[i];
      const cs = current[i];
      if (!bs && cs) { changes.push({ i, _n: true, v: _cloneDeep(cs) }); continue; }
      if (bs && !cs) { changes.push({ i, _d: true }); continue; }
      if (JSON.stringify(bs) !== JSON.stringify(cs)) {
        changes.push({ i, v: _cloneDeep(cs) });
      }
    }
    return changes.length ? changes : null;
  }

  function _applySubtabsDelta(base, delta) {
    const result = _cloneDeep(base);
    for (const ch of delta) {
      if (ch._d) { result.splice(ch.i, 1); continue; }
      if (ch._n) { result.splice(ch.i, 0, _cloneDeep(ch.v)); continue; }
      result[ch.i] = _cloneDeep(ch.v);
    }
    return result;
  }

  function _rebuildBlockHistory(bh, targetIdx) {
    if (!bh.base) return null;
    if (targetIdx < 0) return _cloneDeep(bh.base);
    let state = _cloneDeep(bh.base);
    for (let i = 0; i <= targetIdx && i < bh.deltas.length; i++) {
      const d = bh.deltas[i];
      if (d?.changes) state = _applySubtabsDelta(state, d.changes);
    }
    return state;
  }

  function blockSnapshot(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block?.subtabs) return;

    const bh = _bh(blockId);
    const current = _cloneDeep(block.subtabs);

    if (!bh.base) {
      bh.base = current;
      bh.deltas = [];
      bh.idx = 0;
      _snapEmit();
      return;
    }

    const delta = _computeSubtabsDelta(bh.base, current);
    if (!delta) return;

    bh.deltas = bh.deltas.slice(0, bh.idx);
    bh.deltas.push({ changes: delta });

    if (bh.deltas.length > 30) {
      bh.base = current;
      bh.deltas.shift();
    }
    bh.idx = bh.deltas.length;
    _snapEmit();
  }

  function blockUndo(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block?.subtabs) return;
    const bh = _bh(blockId);
    if (bh.idx <= 0) return;
    bh.idx--;
    const state = bh.idx === 0 ? bh.base : _rebuildBlockHistory(bh, bh.idx - 1);
    if (!state) return;
    block.subtabs = state;
    _snapEmit();
    emitLive();
  }

  function blockRedo(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block?.subtabs) return;
    const bh = _bh(blockId);
    if (bh.idx >= bh.deltas.length) return;
    bh.idx++;
    const state = bh.idx === 0 ? bh.base : _rebuildBlockHistory(bh, bh.idx - 1);
    if (!state) return;
    block.subtabs = state;
    _snapEmit();
    emitLive();
  }

  const canBlockUndo = blockId => {
    const bh = _blockHistory.get(blockId);
    return !!bh && bh.idx > 0;
  };
  const canBlockRedo = blockId => {
    const bh = _blockHistory.get(blockId);
    return !!bh && bh.idx < bh.deltas.length;
  };

  // [FIX] Полный сброс runtime-состояния — предотвращает утечку при повторной загрузке
  function _resetInMemoryState() {
    for (const timer of snapTimers.values()) clearTimeout(timer);
    snapTimers.clear();
    _blockHistory.clear();
    tabs              = [];
    activeTabId       = null;
    defaultTemplateId = null;
    globalSnippets    = [];
    layout            = _cloneDeep(DEFAULT_LAYOUT);
  }

  // [FIX] Убираем globalSnippets из сохранённого layout — это serialization артефакт
  function _sanitizeSavedLayout(savedLayout) {
    if (!savedLayout || typeof savedLayout !== 'object' || Array.isArray(savedLayout)) return null;
    const { globalSnippets: _, ...safeLayout } = savedLayout;
    return safeLayout;
  }

  /* ── named snapshots ── */

  function saveNamedSnapshot(name) {
    const t = getActive();
    if (!t) return;
    if (!t.namedSnapshots) t.namedSnapshots = [];

    // [FIX] Защита от JSON.stringify крэша
    let data;
    try {
      data = JSON.stringify({ blocks: t.blocks, separator: t.separator });
    } catch (err) {
      console.error('[State.saveNamedSnapshot] Failed to serialize named snapshot.', err);
      return;
    }

    t.namedSnapshots.unshift({
      id:   uid(),
      name: name || new Date().toLocaleString('ru'),
      date: Date.now(),
      data,
    });
    if (t.namedSnapshots.length > 5) t.namedSnapshots.pop();
    emit();
  }

  function restoreNamedSnapshot(snapId) {
    const t = getActive();
    if (!t?.namedSnapshots) return;
    const snap = t.namedSnapshots.find(s => s.id === snapId);
    if (!snap) return;
    if (!applySnap(t, snap.data)) return;
    snapshot(t);
    emit();
  }

  function deleteNamedSnapshot(snapId) {
    const t = getActive();
    if (!t?.namedSnapshots) return;
    t.namedSnapshots = t.namedSnapshots.filter(s => s.id !== snapId);
    emit();
  }

  const getNamedSnapshots = () => getActive()?.namedSnapshots ?? [];

  /* ── state mutations ── */

  function update(fn) {
    const t = getActive();
    if (!t || typeof fn !== 'function') return;
    try { fn(t); } catch (err) {
      console.error('[State.update] mutation failed.', err);
      return;
    }
    scheduleSnapshot(t);
    emit();
  }

  function updateLive(fn) {
    const t = getActive();
    if (!t || typeof fn !== 'function') return;
    try { fn(t); } catch (err) {
      console.error('[State.updateLive] mutation failed.', err);
      return;
    }
    emitLive();
  }

  /* ── layout ── */

  const getDefaultTemplateId = () => defaultTemplateId;
  // [FIX] Вызываем emit() — persistence теряет изменение без него
  const setDefaultTemplateId = id => {
    const nextId = id || null;
    if (defaultTemplateId === nextId) return;
    defaultTemplateId = nextId;
    emit();
  };

  const getLayout = ()    => layout;
  // [FIX] Deep merge + emit — предотвращает потерю вложенных настроек
  const setLayout = patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    // [FIX] Быстрый shallow-check — избегаем deepMerge для одинаковых значений
    let shallowSame = true;
    for (const key of Object.keys(patch)) {
      if (UNSAFE_MERGE_KEYS.has(key)) continue;
      if (layout[key] !== patch[key]) { shallowSame = false; break; }
    }
    if (shallowSame) return;
    // [FIX] Защита от JSON.stringify крэша
    try {
      const before = JSON.stringify(layout);
      layout = deepMerge(layout, patch);
      if (JSON.stringify(layout) !== before) emit();
    } catch (err) {
      console.error('[State.setLayout] Failed to merge layout patch.', err);
    }
  };

  /* ── persistence ── */

  // [FIX] Проверка что snapshot data — валидный JSON с объектом
  function _isValidSnapshotData(data) {
    if (typeof data !== 'string') return false;
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch (_) { return false; }
  }

  function load(data) {
    // Guard: corrupt / empty save → fresh start
    if (!Array.isArray(data?.tabs) || !data.tabs.length) {
      _resetInMemoryState();
      newTab();
      return;
    }

    try {
      _resetInMemoryState();

      // [FIX] Фильтруем невалидные tab — один bad element не ломает все
      const sourceTabs = data.tabs.filter(t => t && typeof t === 'object' && !Array.isArray(t));
      if (!sourceTabs.length) throw new Error('No valid tabs in saved state');

      // [FIX] Дедупликация tab ID — предотвращает неоднозначные операции
      const usedTabIds = new Set();
      const normalizeTabId = id => {
        const raw = String(id || '').trim();
        if (raw && !usedTabIds.has(raw)) { usedTabIds.add(raw); return raw; }
        let next;
        do { next = uid(); } while (usedTabIds.has(next));
        usedTabIds.add(next);
        return next;
      };

      tabs = sourceTabs.map(t => ({
        id:             normalizeTabId(t.id),
        name:           typeof t.name === 'string' && t.name.trim() ? t.name : 'Project',
        separator:      t.separator ?? '\n\n',
        blocks:         _deduplicateCommandsBlocks(migrate(Array.isArray(t.blocks) ? t.blocks : [])),
        history:        _migrateHistory(t.history),
        historyIdx:     typeof t.historyIdx === 'number' ? t.historyIdx : -1,
        // [FIX] Нормализуем namedSnapshots — фильтруем невалидные, удаляем [LLM] compress
        namedSnapshots: Array.isArray(t.namedSnapshots)
          ? t.namedSnapshots
              .filter(s => s && typeof s === 'object' && !Array.isArray(s) && _isValidSnapshotData(s.data))
              .filter(s => !String(s.name || '').startsWith('[LLM]'))
              .map(s => ({
                id:   s.id || uid(),
                name: String(s.name || ''),
                date: Number.isFinite(Number(s.date)) ? Number(s.date) : Date.now(),
                data: s.data,
              }))
              .slice(0, 5)
          : [],
        // [FIX] Нормализуем anchors — фильтруем невалидные элементы
        anchors:        Array.isArray(t.anchors)
          ? t.anchors.filter(a => a && typeof a === 'object' && !Array.isArray(a))
          : [],
      }));

      tabs.forEach(t => {
        // Создаём base для diff-снапшотов если его нет (старый формат или новая вкладка)
        if (!t.history.base) {
          try {
            t.history.base = { blocks: _cloneDeep(t.blocks), separator: t.separator };
            t.history.deltas = [];
            t.historyIdx = 0;
          } catch (err) {
            console.error('[State.load] Failed to create initial history base.', err);
            t.history    = { base: null, deltas: [] };
            t.historyIdx = -1;
          }
        }
      });

      activeTabId = (data.activeTabId && tabs.find(t => t.id === data.activeTabId))
        ? data.activeTabId
        : tabs[0].id;

      const savedLayout = _sanitizeSavedLayout(data.layout);
      layout = savedLayout ? deepMerge(DEFAULT_LAYOUT, savedLayout) : _cloneDeep(DEFAULT_LAYOUT);

      defaultTemplateId = data.defaultTemplateId || null;
      const savedGlobalSnippets = Array.isArray(data.globalSnippets)
        ? data.globalSnippets
        : (data.layout?.globalSnippets && Array.isArray(data.layout.globalSnippets.items) ? data.layout.globalSnippets.items : []);
      // [FIX] Нормализуем globalSnippets — фильтруем невалидные элементы
      globalSnippets = Array.isArray(savedGlobalSnippets)
        ? savedGlobalSnippets
            .filter(item => item && typeof item === 'object' && !Array.isArray(item))
            .map(item => {
              const value = normalizeSnippetValue(item.value);
              return {
                id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : uid(),
                title: String(item.title || '').trim() || value.slice(0, 40),
                value,
                enabled: item.enabled !== false,
                global: true,
                createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
                meta: item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : {},
              };
            })
            .filter(item => item.value)
        : [];

    } catch (err) {
      // Corrupt data — reset to clean state rather than crashing
      console.error('[State.load] Failed to restore saved state, starting fresh.', err);
      _resetInMemoryState();
      newTab();
      return;
    }

    // TextExpander integration — restore from Gist payload
    if (data.textExpander && typeof TextExpander !== 'undefined') {
      TextExpander.load(data.textExpander);
    }

    emit();
  }

  // [FIX] Выносим общую сериализацию global snippets — устраняет дублирование
  function _serializeGlobalSnippets() {
    return globalSnippets.map(item => ({
      id: item.id,
      title: item.title,
      value: item.value,
      global: true,
      createdAt: item.createdAt || 0,
      meta: item.meta || {},
    }));
  }

  function serialize() {
    const serializedGlobalSnippets = _serializeGlobalSnippets();
    const state = {
      version: 5,
      defaultTemplateId,
      tabs: tabs.map(t => ({
        id:             t.id,
        name:           t.name,
        separator:      t.separator,
        blocks:         t.blocks,
        namedSnapshots: (t.namedSnapshots || []).filter(s => !String(s.name || '').startsWith('[LLM]')).slice(0, 5),
        anchors:        t.anchors || [],
      })),
      activeTabId,
      layout: {
        ...layout,
        globalSnippets: {
          schemaVersion: 1,
          updatedAt: Date.now(),
          items: serializedGlobalSnippets,
        },
      },
    };
    // TextExpander integration — include in Gist payload
    if (typeof TextExpander !== 'undefined') {
      state.textExpander = TextExpander.serialize();
    }
    return state;
  }

  /* ── search ── */

  function makeSearchRe(q, options, flags) {
    try {
      let pattern = options.regex
        ? q
        : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (options.wholeWord) pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
      return new RegExp(pattern, flags + 'u');
    } catch (_) { return null; }
  }

  // [FIX] Безопасный advance по строке — учитывает Unicode surrogate pairs
  function _advanceStringIndex(str, index) {
    if (index + 1 >= str.length) return index + 1;
    const first = str.charCodeAt(index);
    const second = str.charCodeAt(index + 1);
    if (first >= 0xD800 && first <= 0xDBFF && second >= 0xDC00 && second <= 0xDFFF) return index + 2;
    return index + 1;
  }

  function _collectMatches(re, val) {
    const MAX_MATCHES_PER_VALUE = 1000;
    const matches = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(val)) !== null) {
      matches.push({ index: m.index, length: m[0].length, match: m[0] });
      // [FIX] Лимит совпадений — предотвращает зависание UI на широких regex
      if (matches.length >= MAX_MATCHES_PER_VALUE) break;
      // Защита от zero-length matches (с учётом Unicode surrogate pairs)
      if (m[0].length === 0) {
        re.lastIndex = _advanceStringIndex(val, m.index);
        if (re.lastIndex > val.length) break;
      }
    }
    return matches;
  }

  function _searchTab(tab, re) {
    const results = [];

    function searchBlocks(blocks) {
      for (const b of blocks) {
        if (b.type === 'text') {
          b.subtabs.forEach((st, si) => {
            const val = st.value || '';
            if (!val) return;
            const matches = _collectMatches(re, val);
            if (matches.length)
              results.push({
                tabId: tab.id, tabName: tab.name,
                blockId: b.id, blockTitle: b.title,
                subtabIdx: si, subtabLabel: st.label,
                matches, value: val,
              });
          });
        } else if (b.type === 'snippets') {
          for (const item of (b.items || [])) {
            const val = item.value || '';
            if (!val) continue;
            const matches = _collectMatches(re, val);
            if (matches.length)
              results.push({
                tabId: tab.id, tabName: tab.name,
                blockId: b.id, blockTitle: b.title,
                itemId: item.id, itemTitle: item.title,
                matches, value: val,
              });
          }
        } else if (b.type === 'sticky') {
          const val = b.value || '';
          if (val) {
            const matches = _collectMatches(re, val);
            if (matches.length)
              results.push({
                tabId: tab.id, tabName: tab.name,
                blockId: b.id, blockTitle: b.title,
                matches, value: val,
              });
          }
        } else if (b.type === 'todo') {
          for (const sub of (b.subtabs || [])) {
            for (const item of (sub.items || [])) {
              const val = item.text || '';
              if (!val) continue;
              const matches = _collectMatches(re, val);
              if (matches.length)
                results.push({
                  tabId: tab.id, tabName: tab.name,
                  blockId: b.id, blockTitle: b.title,
                  subtabLabel: sub.label,
                  matches, value: val,
                });
            }
          }
        } else if (b.type === 'table') {
          for (const sub of (b.subtabs || [])) {
            for (const row of (sub.rows || [])) {
              for (const cell of row) {
                const val = String(cell || '');
                if (!val) continue;
                const matches = _collectMatches(re, val);
                if (matches.length)
                  results.push({
                    tabId: tab.id, tabName: tab.name,
                    blockId: b.id, blockTitle: b.title,
                    subtabLabel: sub.label,
                    matches, value: val,
                  });
              }
            }
          }
        } else if (b.type === 'group' && b.children) {
          searchBlocks(b.children);
        }
      }
    }

    searchBlocks(tab.blocks);
    return results;
  }

  function searchAll(query, options = {}) {
    if (!query) return [];
    const flags = options.caseSensitive ? 'g' : 'gi';
    const re    = makeSearchRe(query, options, flags);
    if (!re) return [];
    if (options.allTabs) return tabs.flatMap(t => _searchTab(t, re));
    const t = getActive();
    return t ? _searchTab(t, re) : [];
  }

  function replaceAll(query, replacement, options = {}) {
    if (!query) return 0;
    replacement = String(replacement ?? '');
    const flags = options.caseSensitive ? 'g' : 'gi';
    const re    = makeSearchRe(query, options, flags);
    if (!re) return 0;

    let count = 0;

    function replaceBlocks(blocks) {
      for (const b of blocks) {
        if (b.type === 'text') {
          for (const st of b.subtabs) {
            const before = st.value || '';
            if (!before) continue;
            re.lastIndex = 0;
            const hits = before.match(re);
            if (!hits) continue;
            // [FIX] Пропускаем no-op замены — не увеличиваем count
            const next = before.replace(re, replacement);
            if (next === before) continue;
            count += hits.length;
            st.value = next;
          }
        } else if (b.type === 'snippets') {
          for (const item of (b.items || [])) {
            const before = item.value || '';
            if (!before) continue;
            re.lastIndex = 0;
            const hits = before.match(re);
            if (!hits) continue;
            // [FIX] Пропускаем no-op замены — не увеличиваем count
            const next = before.replace(re, replacement);
            if (next === before) continue;
            count      += hits.length;
            item.value   = next;
          }
        } else if (b.type === 'sticky') {
          const before = b.value || '';
          if (before) {
            re.lastIndex = 0;
            const hits = before.match(re);
            if (hits) {
              const next = before.replace(re, replacement);
              if (next !== before) { count += hits.length; b.value = next; }
            }
          }
        } else if (b.type === 'todo') {
          for (const sub of (b.subtabs || [])) {
            for (const item of (sub.items || [])) {
              const before = item.text || '';
              if (!before) continue;
              re.lastIndex = 0;
              const hits = before.match(re);
              if (!hits) continue;
              const next = before.replace(re, replacement);
              if (next === before) continue;
              count += hits.length;
              item.text = next;
            }
          }
        } else if (b.type === 'table') {
          for (const sub of (b.subtabs || [])) {
            for (const row of (sub.rows || [])) {
              for (let ci = 0; ci < row.length; ci++) {
                const before = String(row[ci] || '');
                if (!before) continue;
                re.lastIndex = 0;
                const hits = before.match(re);
                if (!hits) continue;
                const next = before.replace(re, replacement);
                if (next === before) continue;
                count += hits.length;
                row[ci] = next;
              }
            }
          }
        } else if (b.type === 'group' && b.children) {
          replaceBlocks(b.children);
        }
      }
    }

    // [FIX] Поддержка allTabs — замена по всем вкладкам, как в searchAll
    const tabsToReplace = options.allTabs ? tabs : [getActive()].filter(Boolean);
    for (const t of tabsToReplace) {
      const beforeCount = count;
      replaceBlocks(t.blocks);
      if (count > beforeCount) snapshot(t);
    }
    if (count) emit();
    return count;
  }

  /* ── snippet/command picker ── */

  function getAllSnippetsAndCommands() {
    // Собираем со всех вкладок, дедупликация по value.
    // Глобальные сниппеты идут первыми: они сохраняются в общий Gist и доступны между проектами.
    const seen  = new Set();
    const items = [];

    for (const i of globalSnippets) {
      const value = normalizeSnippetValue(i.value);
      if (!value || seen.has(value) || i.enabled === false) continue;
      seen.add(value);
      items.push({ type: 'snippet', label: i.title || value.slice(0, 30), value, icon: '☁', global: true, id: i.id });
    }

    function collect(blocks) {
      for (const b of blocks) {
        if (b.type === 'commands') {
          for (const i of (b.items || [])) {
            const nv = normalizeSnippetValue(i.value);
            if (nv && !seen.has(nv)) {
              seen.add(nv);
              items.push({ type: 'command', label: i.label || nv.slice(0, 30), value: nv, icon: '⚡' });
            }
          }
        } else if (b.type === 'snippets') {
          for (const i of (b.items || [])) {
            if (!i.enabled) continue;
            const nv = normalizeSnippetValue(i.value);
            if (nv && !seen.has(nv)) {
              seen.add(nv);
              items.push({ type: 'snippet', label: i.title || nv.slice(0, 30), value: nv, icon: '💬' });
            }
          }
        } else if (b.type === 'group' && b.children) {
          collect(b.children);
        }
      }
    }

    // Активная вкладка в приоритете, потом остальные
    const active = getActive();
    if (active) collect(active.blocks);
    tabs.filter(t => t !== active).forEach(t => collect(t.blocks));
    return items;
  }

  /* ── public API ── */

  return {
    newTab, addBlock, makeBlock, findBlock, removeBlock,
    getActive, getAll, setActive, closeTab, renameTab, moveTab,
    undo, redo, canUndo, canRedo,
    blockSnapshot, blockUndo, blockRedo, canBlockUndo, canBlockRedo,
    saveNamedSnapshot, restoreNamedSnapshot, deleteNamedSnapshot, getNamedSnapshots,
    update, updateLive, snapshot, emit,
    getLayout, setLayout,
    load, serialize, onChange, onLive, onSnapshot, uid,
    searchAll, replaceAll, getAllSnippetsAndCommands,
    addGlobalSnippet, removeGlobalSnippet, getGlobalSnippets, toggleGlobalSnippet, updateGlobalSnippetLive, updateGlobalSnippet, clearGlobalSnippets, mergeGlobalSnippets,
    getDefaultTemplateId, setDefaultTemplateId,
    randomIcon, SUBTABS_COUNT,
  };
})();

window.State = State;
