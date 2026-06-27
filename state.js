// file_name: state.js

const State = (() => {
  'use strict';

  let tabs              = [];
  let activeTabId       = null;
  let defaultTemplateId = null;
  let globalSnippets    = [];

  const DEFAULT_LAYOUT = {
    colRatio:        0.5,
    previewHeight:   220,
    previewFontSize: 12,
    previewWrap:     true,
    previewMarkdown: false,
    previewHeaders:  true,
    currentLineHighlight: false,
    currentLineColor:     'rgba(79,142,247,0.18)',
    blockHeights:    {},

    llm: {
      enabled:         false,
      activeProfileId: null,
      profiles:        [],
      streaming:       true,
      autoSnapshot:    true,
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
  function deepMerge(defaults, saved) {
    // Guard: if saved is missing, return a fresh clone of defaults
    if (saved === null || saved === undefined) return _cloneDeep(defaults);

    // Primitive or array in defaults → saved wins outright
    if (typeof defaults !== 'object' || Array.isArray(defaults)) return saved;

    // saved is not a plain object → saved wins (type mismatch, e.g. old schema)
    if (typeof saved !== 'object' || Array.isArray(saved)) return _cloneDeep(defaults);

    const result = _cloneDeep(defaults);

    for (const key of Object.keys(saved)) {
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
        // Primitives, arrays, null — saved value wins
        result[key] = sv;
      }
    }

    return result;
  }

  /* ── default content factories ── */

  function defaultSnippets() {
    return [
      { id: uid(), title: 'Краткий стиль',        value: 'Отвечай кратко и по делу, без воды.',               enabled: false },
      { id: uid(), title: 'Markdown',              value: 'Используй Markdown форматирование.',                enabled: false },
      { id: uid(), title: 'Пошагово',              value: 'Распиши решение по шагам, нумеруй этапы.',          enabled: false },
      { id: uid(), title: 'Примеры кода',          value: 'Приводи примеры кода с пояснениями.',               enabled: false },
      { id: uid(), title: 'Роль: эксперт',         value: 'Ты — опытный senior-разработчик с 10+ лет опыта.', enabled: false },
      { id: uid(), title: 'Роль: ментор',          value: 'Ты — терпеливый ментор, объясняй как новичку.',     enabled: false },
      { id: uid(), title: 'Без оговорок',          value: 'Не добавляй оговорки и предисловия, сразу к делу.', enabled: false },
      { id: uid(), title: 'Таблица вывод',         value: 'Оформляй результат в виде таблицы Markdown.',       enabled: false },
      { id: uid(), title: 'Список плюсов/минусов', value: 'Приведи плюсы и минусы в двух колонках.',           enabled: false },
      { id: uid(), title: 'JSON формат',           value: 'Верни ответ строго в формате JSON без лишнего текста.', enabled: false },
      { id: uid(), title: 'Критик',                value: 'Будь критичным, найди слабые места и уязвимости.',  enabled: false },
      { id: uid(), title: 'Производительность',    value: 'Оцени производительность и предложи оптимизации.',  enabled: false },
    ];
  }

  function defaultCommands() {
    return [
      { id: uid(), label: 'Объясни проще',  value: 'Объясни простыми словами, как для новичка:' },
      { id: uid(), label: 'Сократи',        value: 'Сократи текст, оставив только главное:' },
      { id: uid(), label: 'Переведи RU',    value: 'Переведи на русский язык:' },
      { id: uid(), label: 'Переведи EN',    value: 'Translate to English:' },
      { id: uid(), label: 'Код-ревью',      value: 'Сделай детальное код-ревью:' },
      { id: uid(), label: 'Найди ошибки',   value: 'Найди логические и грамматические ошибки:' },
      { id: uid(), label: 'Улучши код',     value: 'Улучши читаемость и производительность кода:' },
      { id: uid(), label: 'Напиши тесты',   value: 'Напиши unit-тесты для следующего кода:' },
      { id: uid(), label: 'Задокументируй', value: 'Напиши документацию (JSDoc/docstring) для:' },
      { id: uid(), label: 'Рефакторинг',    value: 'Проведи рефакторинг, не меняя поведение:' },
    ];
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
      enabled: false,
      global: true,
      createdAt: Date.now(),
      meta: meta || {},
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

  function mergeGlobalSnippets(items = []) {
    const seen = new Set(globalSnippets.map(item => normalizeSnippetValue(item.value)));
    let changed = false;
    for (const raw of Array.isArray(items) ? items : []) {
      const clean = normalizeSnippetValue(raw?.value);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      globalSnippets.push({
        id: raw.id || uid(),
        title: String(raw.title || '').trim() || clean.slice(0, 40),
        value: clean,
        enabled: false,
        global: true,
        createdAt: raw.createdAt || Date.now(),
        meta: raw.meta || {},
      });
      changed = true;
    }
    if (changed) emit();
    return changed;
  }

  function defaultBlocks() {
    return [
      makeBlock('База промпта',    randomIcon(), 0, 'Основной системный промпт...', 'text'),
      makeBlock('Замечания',       randomIcon(), 0, 'Что исправить...',             'text'),
      makeBlock('Улучшения',       randomIcon(), 0, 'Что добавить...',              'text'),
      makeBlock('Скрипт',          randomIcon(), 1, 'Текущий код...',               'text'),
      makeBlock('Стили',           randomIcon(), 1, 'CSS и оформление...',          'text'),
      makeBlock('Разное',          randomIcon(), 1, 'Всё остальное...',             'text'),
      makeBlock('Сниппеты',        '💬',         1, '',                             'snippets'),
      makeBlock('Быстрые команды', '⚡',         1, '',                             'commands'),
    ];
  }

  function makeBlock(title, icon, column, placeholder, type = 'text') {
    const block = { id: uid(), title, icon: icon || randomIcon(), column, collapsed: false, type };

    if (type === 'text') {
      block.activeSubtab = 0;
      block.subtabs      = Array.from({ length: SUBTABS_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
      block.placeholder  = placeholder || '';
      block.fontSize     = 12;
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

  function migrate(blocks) {
    return (blocks || []).map(b => {
      if (!b.type) b.type = 'text';
      if (!b.icon) b.icon = randomIcon();

      if (b.type === 'text') {
        if (!b.subtabs)                   b.subtabs      = Array.from({ length: SUBTABS_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
        if (b.activeSubtab === undefined) b.activeSubtab = 0;
        // Ensure subtabs array is not shorter than SUBTABS_COUNT (schema upgrade)
        while (b.subtabs.length < SUBTABS_COUNT)
          b.subtabs.push({ label: String(b.subtabs.length + 1), value: '' });
        if (!b.fontSize)            b.fontSize = 12;
        if (b.height === undefined) b.height   = null;
      }

      if ((b.type === 'snippets' || b.type === 'commands') && !b.items) {
        b.items = b.type === 'snippets' ? defaultSnippets() : defaultCommands();
      }
      if (b.type === 'snippets' && b.showTitles === undefined) b.showTitles = true;

      if (b.type === 'group') {
        if (!b.children) { b.children = []; b.enabled = true; }
        b.children = migrate(b.children);
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
        if (!b.subtabs) {
          b.activeSubtab = 0;
          b.subtabs = Array.from({ length: 5 }, (_, i) => ({
            label: String(i + 1), name: '', items: [],
          }));
        }
        while (b.subtabs.length > 5) b.subtabs.pop();
        while (b.subtabs.length < 5) b.subtabs.push({ label: String(b.subtabs.length + 1), name: '', items: [] });
        if (b.activeSubtab === undefined) b.activeSubtab = 0;
        if (b.activeSubtab >= 5) b.activeSubtab = 0;
      }

      if (b.type === 'table') {
        if (!b.subtabs) {
          b.activeSubtab = 0;
          b.subtabs = Array.from({ length: 5 }, (_, i) => ({
            label: String(i + 1), name: '', cols: 2,
            rows: [['', ''], ['', '']],
          }));
        }
        while (b.subtabs.length > 5) b.subtabs.pop();
        while (b.subtabs.length < 5) b.subtabs.push({ label: String(b.subtabs.length + 1), name: '', cols: 2, rows: [['', ''], ['', '']] });
        for (const sub of b.subtabs) {
          if (!sub.rows) sub.rows = [['', ''], ['', '']];
          if (!sub.cols) sub.cols = Math.max(1, Math.min(4, sub.rows[0]?.length || 2));
        }
        if (b.activeSubtab === undefined) b.activeSubtab = 0;
        if (b.activeSubtab >= 5) b.activeSubtab = 0;
      }

      return b;
    });
  }

  /* ── event bus ── */

  const emit     = () => listeners.forEach(l => l());
  const emitLive = () => liveListeners.forEach(l => l());
  const onChange = fn => listeners.push(fn);
  const onLive   = fn => liveListeners.push(fn);

  /* Легковесный автобус — срабатывает когда история реально изменилась (без re-render блоков) */
  const _snapListeners = [];
  const _snapEmit = () => _snapListeners.forEach(l => l());
  const onSnapshot = fn => _snapListeners.push(fn);

  /* ── tab management ── */

  function newTab(name) {
    if (!name) {
      let n = 1;
      while (tabs.some(t => t.name === `Промпт ${n}`)) n++;
      name = `Промпт ${n}`;
    }
    const tab = {
      id: uid(), name, separator: '\n\n',
      blocks: defaultBlocks(),
      history: [], historyIdx: -1,
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

  function addBlock(type, targetGroupId) {
    type = type || 'text';
    const t = getActive();
    if (!t) return;

    let title, icon;
    if      (type === 'snippets') { title = 'Сниппеты';        icon = '💬'; }
    else if (type === 'commands') { title = 'Быстрые команды'; icon = '⚡'; }
    else if (type === 'group')    { title = 'Группа';          icon = '📁'; }
    else if (type === 'variable') { title = 'Переменная';      icon = '🔤'; }
    else if (type === 'sticky')   { title = 'Заметка';         icon = '📌'; }
    else if (type === 'todo')     { title = 'Чеклист';         icon = '☑️'; }
    else if (type === 'table')    { title = 'Таблица';         icon = '📊'; }
    else {
      title = prompt('Название нового блока:', 'Новый блок');
      if (!title) return;
      icon = randomIcon();
    }

    const col = t.blocks.filter(b => b.column === 0).length <=
                t.blocks.filter(b => b.column === 1).length ? 0 : 1;
    const b = makeBlock(title, icon, col, '', type);

    update(tab => {
      if (targetGroupId) {
        const grp = findBlock(tab.blocks, targetGroupId);
        if (grp?.type === 'group') { grp.children.push(b); return; }
      }
      tab.blocks.push(b);
    });
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

  function removeBlock(blocks, id) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) { blocks.splice(i, 1); return true; }
      if (blocks[i].type === 'group' && blocks[i].children) {
        if (removeBlock(blocks[i].children, id)) return true;
      }
    }
    return false;
  }

  /* ── active tab ── */

  const getActive = () => tabs.find(t => t.id === activeTabId) ?? null;
  const getAll    = () => tabs;
  const setActive = id => { activeTabId = id; emit(); };

  /* ── history ── */

  function snapshot(tab) {
    tab = tab ?? getActive();
    if (!tab) return;

    // Always serialize with consistent key order to avoid false "changed" detection
    const snap = JSON.stringify({ blocks: tab.blocks, separator: tab.separator });

    // Trim future branch before comparing tail
    tab.history = tab.history.slice(0, tab.historyIdx + 1);

    // Skip if nothing changed (string equality is sufficient for plain data)
    if (tab.history.length > 0 && tab.history[tab.history.length - 1] === snap) return;

    tab.history.push(snap);
    // Keep history bounded to 200 entries
    if (tab.history.length > 200) tab.history.shift();
    tab.historyIdx = tab.history.length - 1;
    _snapEmit(); // уведомляем updateButtons без re-render
  }

  function scheduleSnapshot(tab) {
    clearTimeout(snapTimers.get(tab.id));
    snapTimers.set(tab.id, setTimeout(() => {
      snapshot(tab);
      snapTimers.delete(tab.id);
    }, 500));
  }

  function applySnap(t, snap) {
    const data  = JSON.parse(snap);
    t.blocks    = data.blocks;
    t.separator = data.separator ?? '\n\n';
  }

  function undo() {
    const t = getActive();
    if (!t || t.historyIdx <= 0) return;
    t.historyIdx--;
    applySnap(t, t.history[t.historyIdx]);
    emit();
  }

  function redo() {
    const t = getActive();
    if (!t || t.historyIdx >= t.history.length - 1) return;
    t.historyIdx++;
    applySnap(t, t.history[t.historyIdx]);
    emit();
  }

  const canUndo = () => { const t = getActive(); return !!t && t.historyIdx > 0; };
  const canRedo = () => { const t = getActive(); return !!t && t.historyIdx < t.history.length - 1; };

  /* ── per-block history ── */

  const _blockHistory = new Map();

  function _bh(blockId) {
    if (!_blockHistory.has(blockId)) _blockHistory.set(blockId, { snaps: [], idx: -1 });
    return _blockHistory.get(blockId);
  }

  function blockSnapshot(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block) return;
    const snap = JSON.stringify(block.subtabs);
    const bh   = _bh(blockId);
    bh.snaps = bh.snaps.slice(0, bh.idx + 1);
    if (bh.snaps.length > 0 && bh.snaps[bh.snaps.length - 1] === snap) return;
    bh.snaps.push(snap);
    if (bh.snaps.length > 100) bh.snaps.shift();
    bh.idx = bh.snaps.length - 1;
    _snapEmit(); // уведомляем об изменении блочной истории
  }

  function blockUndo(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block) return;
    const bh = _bh(blockId);
    if (bh.idx === -1) { blockSnapshot(blockId); }
    // Если стоим на последнем снапе — проверяем, не ушёл ли текст вперёд (несохранённые изменения)
    if (bh.idx === bh.snaps.length - 1) {
      const cur = JSON.stringify(block.subtabs);
      if (cur !== bh.snaps[bh.idx]) {
        bh.snaps = bh.snaps.slice(0, bh.idx + 1);
        bh.snaps.push(cur);
        if (bh.snaps.length > 100) bh.snaps.shift();
        bh.idx = bh.snaps.length - 1;
      }
    }
    if (bh.idx <= 0) return;
    bh.idx--;
    block.subtabs = JSON.parse(bh.snaps[bh.idx]);
    emitLive();
  }

  function blockRedo(blockId) {
    const tab = getActive();
    if (!tab) return;
    const block = findBlock(tab.blocks, blockId);
    if (!block) return;
    const bh = _bh(blockId);
    if (bh.idx >= bh.snaps.length - 1) return;
    bh.idx++;
    block.subtabs = JSON.parse(bh.snaps[bh.idx]);
    emitLive();
  }

  const canBlockUndo = blockId => { const bh = _bh(blockId); return bh.idx > 0; };
  const canBlockRedo = blockId => { const bh = _bh(blockId); return bh.idx < bh.snaps.length - 1; };

  /* ── named snapshots ── */

  function saveNamedSnapshot(name) {
    const t = getActive();
    if (!t) return;
    if (!t.namedSnapshots) t.namedSnapshots = [];
    t.namedSnapshots.unshift({
      id:   uid(),
      name: name || new Date().toLocaleString('ru'),
      date: Date.now(),
      data: JSON.stringify({ blocks: t.blocks, separator: t.separator }),
    });
    if (t.namedSnapshots.length > 30) t.namedSnapshots.pop();
    emit();
  }

  function restoreNamedSnapshot(snapId) {
    const t = getActive();
    if (!t?.namedSnapshots) return;
    const snap = t.namedSnapshots.find(s => s.id === snapId);
    if (!snap) return;
    applySnap(t, snap.data);
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
    if (!t) return;
    fn(t);
    scheduleSnapshot(t);
    emit();
  }

  function updateLive(fn) {
    const t = getActive();
    if (!t) return;
    fn(t);
    emitLive();
  }

  /* ── layout ── */

  const getDefaultTemplateId = () => defaultTemplateId;
  const setDefaultTemplateId = id => { defaultTemplateId = id; };

  const getLayout = ()    => layout;
  const setLayout = patch => Object.assign(layout, patch);

  /* ── persistence ── */

  function load(data) {
    // Guard: corrupt / empty save → fresh start
    if (!data?.tabs?.length) { newTab(); return; }

    try {
      tabs = data.tabs.map(t => ({
        id:             t.id || uid(),
        name:           t.name || 'Промпт',
        separator:      t.separator ?? '\n\n',
        blocks:         migrate(t.blocks || []),
        history:        [],
        historyIdx:     -1,
        namedSnapshots: Array.isArray(t.namedSnapshots) ? t.namedSnapshots : [],
        anchors:        Array.isArray(t.anchors) ? t.anchors : [],
      }));

      tabs.forEach(t => {
        const snap = JSON.stringify({ blocks: t.blocks, separator: t.separator });
        t.history    = [snap];
        t.historyIdx = 0;
      });

      activeTabId = (data.activeTabId && tabs.find(t => t.id === data.activeTabId))
        ? data.activeTabId
        : tabs[0].id;

      layout = data.layout ? deepMerge(DEFAULT_LAYOUT, data.layout) : _cloneDeep(DEFAULT_LAYOUT);

      if (data.defaultTemplateId) defaultTemplateId = data.defaultTemplateId;
      const savedGlobalSnippets = Array.isArray(data.globalSnippets)
        ? data.globalSnippets
        : (data.layout?.globalSnippets && Array.isArray(data.layout.globalSnippets.items) ? data.layout.globalSnippets.items : []);
      globalSnippets = Array.isArray(savedGlobalSnippets)
        ? savedGlobalSnippets.map(item => ({
            id: item.id || uid(),
            title: item.title || normalizeSnippetValue(item.value).slice(0, 40),
            value: normalizeSnippetValue(item.value),
            enabled: false,
            global: true,
            createdAt: item.createdAt || Date.now(),
            meta: item.meta || {},
          })).filter(item => item.value)
        : [];

    } catch (err) {
      // Corrupt data — reset to clean state rather than crashing
      console.error('[State.load] Failed to restore saved state, starting fresh.', err);
      tabs = [];
      layout = _cloneDeep(DEFAULT_LAYOUT);
      newTab();
      return;
    }

    emit();
  }

  function serialize() {
    return {
      version: 5,
      defaultTemplateId,
      tabs: tabs.map(t => ({
        id:             t.id,
        name:           t.name,
        separator:      t.separator,
        blocks:         t.blocks,
        namedSnapshots: t.namedSnapshots || [],
        anchors:        t.anchors || [],
      })),
      activeTabId,
      layout: {
        ...layout,
        globalSnippets: {
          schemaVersion: 1,
          updatedAt: Date.now(),
          items: globalSnippets.map(item => ({
            id: item.id,
            title: item.title,
            value: item.value,
            global: true,
            createdAt: item.createdAt || 0,
            meta: item.meta || {},
          })),
        },
      },
      globalSnippets: globalSnippets.map(item => ({
        id: item.id,
        title: item.title,
        value: item.value,
        global: true,
        createdAt: item.createdAt || 0,
        meta: item.meta || {},
      })),
    };
  }

  /* ── search ── */

  function makeSearchRe(q, options, flags) {
    try {
      let pattern = options.regex
        ? q
        : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (options.wholeWord) pattern = `\\b${pattern}\\b`;
      return new RegExp(pattern, flags);
    } catch (_) { return null; }
  }

  function _collectMatches(re, val) {
    const matches = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(val)) !== null) {
      matches.push({ index: m.index, length: m[0].length, match: m[0] });
      // =защита поиска=
      if (m[0].length === 0) {
        re.lastIndex = m.index + 1;
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
    const t = getActive();
    if (!t || !query) return 0;
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
            count += hits.length;
            re.lastIndex = 0;
            st.value = before.replace(re, replacement);
          }
        } else if (b.type === 'snippets') {
          for (const item of (b.items || [])) {
            const before = item.value || '';
            if (!before) continue;
            re.lastIndex = 0;
            const hits = before.match(re);
            if (!hits) continue;
            count      += hits.length;
            re.lastIndex = 0;
            item.value   = before.replace(re, replacement);
          }
        } else if (b.type === 'group' && b.children) {
          replaceBlocks(b.children);
        }
      }
    }

    replaceBlocks(t.blocks);
    if (count) { snapshot(t); emit(); }
    return count;
  }

  /* ── snippet/command picker ── */

  function getAllSnippetsAndCommands() {
    // Улучшение 5: собираем со ВСЕХ вкладок, дедупликация по value.
    // Глобальные сниппеты идут первыми: они сохраняются в общий Gist и доступны между проектами.
    const seen  = new Set();
    const items = [];

    for (const i of globalSnippets) {
      const value = normalizeSnippetValue(i.value);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      items.push({ type: 'snippet', label: i.title || value.slice(0, 30), value, icon: '☁', global: true, id: i.id });
    }

    function collect(blocks) {
      for (const b of blocks) {
        if (b.type === 'snippets') {
          for (const i of (b.items || []))
            if ((i.value || '').trim() && !seen.has(i.value)) {
              seen.add(i.value);
              items.push({ type: 'snippet', label: i.title || i.value.slice(0, 30), value: i.value, icon: '💬' });
            }
        } else if (b.type === 'commands') {
          for (const i of (b.items || []))
            if ((i.value || '').trim() && !seen.has(i.value)) {
              seen.add(i.value);
              items.push({ type: 'command', label: i.label || i.value.slice(0, 30), value: i.value, icon: '⚡' });
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
    getActive, getAll, setActive, closeTab, renameTab,
    undo, redo, canUndo, canRedo,
    blockSnapshot, blockUndo, blockRedo, canBlockUndo, canBlockRedo,
    saveNamedSnapshot, restoreNamedSnapshot, deleteNamedSnapshot, getNamedSnapshots,
    update, updateLive, snapshot, emit,
    getLayout, setLayout,
    load, serialize, onChange, onLive, onSnapshot, uid,
    searchAll, replaceAll, getAllSnippetsAndCommands,
    addGlobalSnippet, removeGlobalSnippet, getGlobalSnippets, mergeGlobalSnippets,
    getDefaultTemplateId, setDefaultTemplateId,
    randomIcon, SUBTABS_COUNT,
  };
})();

window.State = State;
