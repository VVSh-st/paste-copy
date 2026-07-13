// file_name: notepad.js

/**
 * Notepad — singleton floating notepad with localStorage persistence.
 *
 * Behaviour:
 *  - Only ONE notepad instance exists at a time.
 *  - Toolbar "Блокнот" button: opens if closed, restores minimized if minimized.
 *  - X button: saves all data → removes DOM → clears _instance (data NOT lost).
 *  - Chevron button: toggles minimized state (body/toolbar hidden, header visible).
 *  - All tab content, position, size, font-size persist across page reloads.
 *  - Transfer copies to next free tab WITHOUT clearing the source.
 *  - Paste respects window._clipboardApiEnabled flag; fallback shows Ctrl+V hint
 *    (execCommand('paste') removed — deprecated and unreliable).
 *  - Double-click a tab label to rename it.
 *  - Tab key inserts 2 spaces; Shift+Tab removes up to 2 spaces (de-indent).
 */
const Notepad = (() => {
  'use strict';

  const STORE_KEY    = 'llm-notepads-v1';
  const MAX_HISTORY  = 100;
  const VISIBLE_TABS = 5;
  const TAB_COUNT    = 10;
  const HISTORY_DEBOUNCE_MS = 600;
  const TAB_CLICK_DELAY_MS  = 220;
  const MIN_WIDTH  = 260;
  const MIN_HEIGHT = 180;
  const MIN_FONT_SIZE = 9;
  const MAX_FONT_SIZE = 22;

  let _instance = null;
  let _lastPersistErrorAt = 0;
  let _lastPersistPayload = '';

  function _toast(msg, type) {
    if (typeof Toast !== 'undefined' && Toast?.show) {
      Toast.show(msg, type);
    } else {
      console[type === 'error' ? 'error' : 'log']('[Notepad]', msg);
    }
  }

  /* ---- localStorage helpers ----------------------------------------- */

  function _persist(state) {
    try {
      const payload = JSON.stringify({
        title:     state.title,
        tabs:      state.tabs.map(tab => ({
          label: tab.label,
          value: tab.value,
        })),
        activeTab: state.activeTab,
        tabOffset: state.tabOffset,
        fontSize:  state.fontSize,
        mdPreview: state.mdPreview,
        minimized: state.minimized,
        pos:       state.pos,
        size:      state.size,
      });
      if (payload === _lastPersistPayload) return;
      localStorage.setItem(STORE_KEY, payload);
      _lastPersistPayload = payload;
    } catch (err) {
      const now = Date.now();
      if (now - _lastPersistErrorAt > 5000) {
        _lastPersistErrorAt = now;
        const reason = err?.name === 'QuotaExceededError'
          ? 'localStorage переполнен'
          : 'localStorage недоступен';
        _toast('Не удалось сохранить блокнот: ' + reason, 'error');
      }
    }
  }

  function _loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return null;
      const rawTabs = Array.isArray(saved.tabs) ? saved.tabs.slice(0, TAB_COUNT) : [];
      const tabs = Array.from({ length: TAB_COUNT }, (_, i) => {
        const t = rawTabs[i];
        return {
          label: typeof t?.label === 'string' && t.label.trim()
            ? t.label.slice(0, 12)
            : String(i + 1),
          value: typeof t?.value === 'string' ? t.value : '',
        };
      });
      const cssPx = value => {
        if (typeof value !== 'string') return null;
        const n = parseFloat(value);
        return Number.isFinite(n) && n >= 0 ? n + 'px' : null;
      };
      const posLeft = cssPx(saved.pos?.left);
      const posTop = cssPx(saved.pos?.top);
      const sizeW = cssPx(saved.size?.w);
      const sizeH = cssPx(saved.size?.h);

      return {
        title: typeof saved.title === 'string' && saved.title.trim()
          ? saved.title.slice(0, 80)
          : 'Блокнот',
        tabs,
        activeTab: Number.isInteger(saved.activeTab)
          ? Math.max(0, Math.min(TAB_COUNT - 1, saved.activeTab))
          : 0,
        tabOffset: Number.isInteger(saved.tabOffset)
          ? Math.max(0, Math.min(TAB_COUNT - VISIBLE_TABS, saved.tabOffset))
          : 0,
        fontSize: Number.isFinite(saved.fontSize)
          ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, saved.fontSize))
          : 12,
        mdPreview: typeof saved.mdPreview === 'boolean' ? saved.mdPreview : false,
        minimized: typeof saved.minimized === 'boolean' ? saved.minimized : false,
        pos: posLeft && posTop
          ? { left: posLeft, top: posTop }
          : null,
        size: sizeW && sizeH
          ? { w: sizeW, h: sizeH }
          : null,
      };
    } catch (_) { return null; }
  }

  /* ---- SVG icons ----------------------------------------------------- */
  const SVG = {
    undo:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6H9a3.5 3.5 0 0 1 0 7H6"/><polyline points="3.5,2.5 3.5,6 7,6"/></svg>',
    redo:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 6H7a3.5 3.5 0 0 0 0 7h3"/><polyline points="12.5,2.5 12.5,6 9,6"/></svg>',
    x:       '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    cut:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="11" cy="12" r="2"/><path d="M5 10L9.5 5M11 10L6.5 5"/></svg>',
    copy:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>',
    paste:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="5" width="9" height="10" rx="1.5"/><path d="M6 5V3.5C6 3 6.5 2 8 2s2 1 2 1.5V5"/></svg>',
    trash:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3h4v2M12 5l-1 8H5L4 5"/></svg>',
    save:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 13H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6l3 3v6a1 1 0 0 1-1 1z"/><polyline points="10,13 10,9 6,9 6,13"/><polyline points="6,3 6,6 10,6"/></svg>',
    transfer:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    resize:  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10"/></svg>',
    notepad: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>',
    md:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M3 10V6l2 2.5L7 6v4"/><path d="M9 10V6l4 4V6"/></svg>',
  };

  function _mkBtn(html, title, onclick) {
    const b = document.createElement('button');
    b.className = 'notepad-tool-btn';
    b.type      = 'button';
    b.innerHTML = html;
    b.title     = title;
    if (onclick) b.addEventListener('click', onclick);
    return b;
  }

  function _mkDiv() {
    const d = document.createElement('span');
    d.className = 'notepad-tool-divider';
    return d;
  }

  /* ---- Sync textarea → state ---------------------------------------- */
  function _syncActiveTabValue(state) {
    const ta = state.el?.querySelector('.notepad-body textarea');
    if (!ta) return null;
    clearTimeout(state.histTimer);
    state.tabs[state.activeTab].value = ta.value;
    return ta;
  }

  /* ---- Paste helper -------------------------------------------------- */
  // execCommand('paste') removed: deprecated, inconsistent, causes permission
  // dialogs in some browsers. If Clipboard API is disabled or fails we just
  // show a Ctrl+V hint — the textarea is already focused so the shortcut works.
  function _doPaste(ta, onText) {
    ta.focus();
    const useApi = window._clipboardApiEnabled !== false;
    if (useApi && navigator.clipboard?.readText) {
      navigator.clipboard.readText()
        .then(text => onText(typeof text === 'string' ? text : String(text ?? '')))
        .catch(() => _toast('Нажмите Ctrl+V для вставки', 'info'));
    } else {
      _toast('Нажмите Ctrl+V для вставки', 'info');
    }
  }

  /* ================================================================
     Public: create / open
  ================================================================ */
  function create() {
    if (_instance && _instance.el?.isConnected) {
      _closeNotepad(_instance);
      return;
    }

    if (_instance && !_instance.el?.isConnected) {
      clearTimeout(_instance.histTimer);
      clearTimeout(_instance.tabClickTimer);
      _instance.dragAbort?.abort();
      _instance.resizeAbort?.abort();
      document.body.style.userSelect = '';
      _persist(_instance);
      _instance = null;
    }

    const saved = _loadSaved();

    let tabs = saved?.tabs ?? null;
    if (!Array.isArray(tabs)) {
      tabs = Array.from({ length: TAB_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
    }
    while (tabs.length < TAB_COUNT) tabs.push({ label: String(tabs.length + 1), value: '' });

    const activeTab = Math.max(0, Math.min(saved?.activeTab ?? 0, TAB_COUNT - 1));
    const initVal   = tabs[activeTab]?.value ?? '';

    const state = {
      title:        saved?.title    || 'Блокнот',
      tabs,
      activeTab,
      tabOffset:    Number.isInteger(saved?.tabOffset)
        ? Math.max(0, Math.min(TAB_COUNT - VISIBLE_TABS, saved.tabOffset))
        : 0,
      fontSize:     saved?.fontSize || 12,
      mdPreview:    saved?.mdPreview ?? false,
      minimized:    saved?.minimized ?? false,
      pos:          saved?.pos      || null,
      size:         saved?.size     || null,
      history:      [initVal],
      histIdx:      0,
      histTimer:    null,
      tabClickTimer:null,
      dragAbort:    null,
      resizeAbort:  null,
      _translateBusy: false,
      _translateOriginal: null,
      _translateOriginalTab: null,
      _saveToFile:  null,
      el:           null,
      _tabsRow:     null,
      _countSpan:   null,
      _mdContent:   null,
      _mdBtn:       null,
      _doUndo:      null,
      _doRedo:      null,
      _pushHistory: null,
    };

    const win = _buildWindow(state);
    state.el  = win;
    _instance = state;

    const container = document.getElementById('notepad-container') || document.body;
    container.appendChild(win);

    if (state.size) {
      const w = parseFloat(state.size.w);
      const h = parseFloat(state.size.h);
      win.style.width  = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 16,  Number.isFinite(w) ? w : 420)) + 'px';
      win.style.height = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 16, Number.isFinite(h) ? h : 320)) + 'px';
    }
    if (state.pos) {
      const left = parseFloat(state.pos.left);
      const top  = parseFloat(state.pos.top);
      const maxLeft = Math.max(0, window.innerWidth - win.offsetWidth);
      const maxTop  = Math.max(0, window.innerHeight - win.offsetHeight);
      win.style.left      = Math.max(0, Math.min(maxLeft, Number.isFinite(left) ? left : 0)) + 'px';
      win.style.top       = Math.max(0, Math.min(maxTop, Number.isFinite(top) ? top : 0)) + 'px';
      win.style.transform = 'none';
    }
    win.classList.toggle('notepad-minimized', state.minimized);
    const chevron = win.querySelector('.notepad-min-btn svg');
    if (chevron) chevron.style.transform = state.minimized ? 'rotate(-90deg)' : '';

    if (!state.minimized) {
      requestAnimationFrame(() => win.querySelector('.notepad-body textarea')?.focus());
    }
  }

  /* ================================================================
     Close
  ================================================================ */
  function _closeNotepad(state) {
    if (_instance !== state) return;

    const ta = _syncActiveTabValue(state);
    if (ta) {
      if (state.history[state.histIdx] !== ta.value) {
        state._pushHistory?.(ta.value);
      }
    }

    state.histTimer = null;
    clearTimeout(state.tabClickTimer);
    state.dragAbort?.abort();
    state.resizeAbort?.abort();
    state.dragAbort = null;
    state.resizeAbort = null;
    document.body.style.userSelect = '';
    _persist(state);
    state.el?.remove();
    state.el  = null;
    _instance = null;
  }

  /* ================================================================
     Build window DOM
  ================================================================ */
  function _buildWindow(state) {
    const win = document.createElement('div');
    win.className = 'notepad-window';
    win.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%)';

    win.appendChild(_buildHeader(state, win));
    win.appendChild(_buildToolbar(state, win));
    win.appendChild(_buildBody(state, win));
    win.appendChild(_buildResizeHandle(state, win));
    return win;
  }

  /* ================================================================
     Header
  ================================================================ */
  function _buildHeader(state, win) {
    const header = document.createElement('div');
    header.className = 'notepad-header';

    const iconEl = document.createElement('span');
    iconEl.className = 'notepad-icon';
    iconEl.innerHTML = SVG.notepad;

    const titleWrap = document.createElement('span');
    titleWrap.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;overflow:hidden;';

    const titleLabel = document.createElement('span');
    titleLabel.className   = 'notepad-title-label';
    titleLabel.textContent = state.title;

    titleWrap.append(titleLabel);

    // minBtn and closeBtn are proper <button> elements for keyboard accessibility
    const minBtn = document.createElement('button');
    minBtn.className = 'notepad-min-btn';
    minBtn.type      = 'button';
    minBtn.innerHTML = SVG.chevron;
    minBtn.title     = 'Свернуть / развернуть';
    minBtn.addEventListener('click', e => { e.stopPropagation(); _toggleMinimize(state, win); });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'notepad-close';
    closeBtn.type      = 'button';
    closeBtn.innerHTML = SVG.x;
    closeBtn.title     = 'Закрыть (данные сохранятся)';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); _closeNotepad(state); });

    header.append(iconEl, titleWrap, minBtn, closeBtn);
    header.style.cursor = 'grab';
    _makeDraggable(header, win, state);
    return header;
  }

  function _toggleMinimize(state, win) {
    _syncActiveTabValue(state);
    state.minimized = !state.minimized;
    win.classList.toggle('notepad-minimized', state.minimized);
    const chevron = win.querySelector('.notepad-min-btn svg');
    if (chevron) chevron.style.transform = state.minimized ? 'rotate(-90deg)' : '';
    _persist(state);
  }

  /* ================================================================
     Toolbar
  ================================================================ */
  function _buildToolbar(state, win) {
    const toolbar = document.createElement('div');
    toolbar.className = 'notepad-toolbar';

    const countSpan = document.createElement('span');
    countSpan.className = 'notepad-count';
    state._countSpan = countSpan;

    const getTa = () => win.querySelector('.notepad-body textarea');

    /* ---- Undo / redo ---- */
    function pushHistory(val) {
      if (state.histIdx < state.history.length - 1) {
        state.history.splice(state.histIdx + 1);
      }
      if (state.history[state.histIdx] === val) return;
      state.history.push(val);
      if (state.history.length > MAX_HISTORY) {
        state.history.shift();
        state.histIdx = Math.max(0, state.histIdx - 1);
      }
      state.histIdx = state.history.length - 1;
    }

    const doUndo = () => {
      const ta = getTa();
      if (!ta || state.histIdx <= 0) return;
      state._translateOriginal = null;
      state._translateOriginalTab = null;
      const wasFilled = !!state.tabs[state.activeTab].value;
      state.histIdx--;
      ta.value = state.history[state.histIdx];
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      state.tabs[state.activeTab].value = ta.value;
      _updateCount(ta, countSpan);
      if (wasFilled !== !!ta.value) _renderTabs(state);
      _persist(state);
    };

    const doRedo = () => {
      const ta = getTa();
      if (!ta || state.histIdx >= state.history.length - 1) return;
      state._translateOriginal = null;
      state._translateOriginalTab = null;
      const wasFilled = !!state.tabs[state.activeTab].value;
      state.histIdx++;
      ta.value = state.history[state.histIdx];
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      state.tabs[state.activeTab].value = ta.value;
      _updateCount(ta, countSpan);
      if (wasFilled !== !!ta.value) _renderTabs(state);
      _persist(state);
    };

    state._doUndo      = doUndo;
    state._doRedo      = doRedo;
    state._pushHistory = pushHistory;

    /* ---- Edit buttons ---- */
    const cutBtn = _mkBtn(SVG.cut, 'Вырезать выделение', () => {
      const ta = getTa(); if (!ta) return;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (!sel) return;
      const removeSelection = () => {
        pushHistory(ta.value);
        ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(sel)
          .then(removeSelection)
          .catch(() => _toast('Не удалось вырезать: буфер недоступен', 'error'));
      } else {
        _toast('Буфер обмена недоступен: вырезание отменено', 'error');
      }
    });

    const copyBtn = _mkBtn(SVG.copy, 'Копировать (выделение или всё)', () => {
      const ta = getTa(); if (!ta) return;
      if (!navigator.clipboard?.writeText) {
        _toast('Буфер обмена недоступен', 'error');
        return;
      }
      const text = ta.selectionStart !== ta.selectionEnd
        ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : ta.value;
      navigator.clipboard.writeText(text)
        .then(() => _toast(
          ta.selectionStart !== ta.selectionEnd ? 'Выделение скопировано ✓' : 'Вся вкладка скопирована ✓',
          'success'
        ))
        .catch(() => _toast('Ошибка копирования', 'error'));
    });

    const pasteBtn = _mkBtn(SVG.paste, 'Вставить из буфера (или Ctrl+V)', () => {
      const ta = getTa(); if (!ta) return;
      const taAtStart = ta;
      const tabAtStart = state.activeTab;
      _doPaste(ta, text => {
        if (state.activeTab !== tabAtStart || !state.el?.isConnected || getTa() !== taAtStart) return;
        pushHistory(ta.value);
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      });
    });

    const clearBtn = _mkBtn(SVG.trash, 'Очистить (выделение или всю вкладку)', () => {
      const ta = getTa(); if (!ta) return;
      clearTimeout(state.histTimer);
      if (ta.selectionStart !== ta.selectionEnd) {
        pushHistory(ta.value);
        ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      } else if (ta.value) {
        pushHistory(ta.value);
        ta.value = '';
        pushHistory('');
        ta.dispatchEvent(new Event('input'));
        _persist(state);
      }
    });

    const saveToFile = () => {
      const ta = getTa(); if (!ta) return;
      const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }));
      const safeName = (state.title || 'notepad')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
        .trim()
        .slice(0, 80) || 'notepad';
      Object.assign(document.createElement('a'), {
        href: url,
        download: safeName + '.txt',
      }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      _toast('Файл скачан ✓', 'success');
    };
    state._saveToFile = saveToFile;
    const saveBtn = _mkBtn(SVG.save, 'Сохранить в .txt (Ctrl+S)', saveToFile);

    const transferBtn = _mkBtn(SVG.transfer, 'Скопировать на следующую свободную вкладку', () => {
      const ta = getTa(); if (!ta || !ta.value.trim()) return;

      let target = -1;
      for (let i = 1; i < TAB_COUNT; i++) {
        const idx = (state.activeTab + i) % TAB_COUNT;
        if (!state.tabs[idx].value.trim()) { target = idx; break; }
      }
      if (target === -1) {
        _toast('Нет свободных вкладок', 'info');
        return;
      }

      clearTimeout(state.histTimer);
      state.tabs[target].value = ta.value;
      _persist(state);
      _switchTab(state, target, win);
      _toast('Скопировано ✓', 'success');
    });

    const fDecBtn = _mkBtn('A−', 'Шрифт меньше', () => {
      state.fontSize = Math.max(MIN_FONT_SIZE, state.fontSize - 1);
      const ta = getTa(); if (ta) ta.style.fontSize = state.fontSize + 'px';
      _persist(state);
    });
    const fIncBtn = _mkBtn('A+', 'Шрифт больше', () => {
      state.fontSize = Math.min(MAX_FONT_SIZE, state.fontSize + 1);
      const ta = getTa(); if (ta) ta.style.fontSize = state.fontSize + 'px';
      _persist(state);
    });

    const mdBtn = _mkBtn(SVG.md, 'Markdown-превью', () => _toggleMdPreview(state, win));
    mdBtn.classList.add('notepad-md-btn');
    state._mdBtn = mdBtn;

    const prevTabBtn = _mkBtn('◀', 'Предыдущая вкладка',
      () => _switchTab(state, (state.activeTab - 1 + TAB_COUNT) % TAB_COUNT, win));
    prevTabBtn.classList.add('notepad-tab-arrow');

    const nextTabBtn = _mkBtn('▶', 'Следующая вкладка',
      () => _switchTab(state, (state.activeTab + 1) % TAB_COUNT, win));
    nextTabBtn.classList.add('notepad-tab-arrow');

    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'notepad-tabs-wrap';
    const tabsRow = document.createElement('div');
    tabsRow.className = 'notepad-tabs-row';
    tabsWrap.appendChild(tabsRow);
    state._tabsRow = tabsRow;

    _renderTabs(state);

    const translateBtn = _mkBtn('<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15"/><path d="M10 2.5c2.5 2.5 3.5 5 3.5 7.5s-1 5-3.5 7.5"/><path d="M10 2.5c-2.5 2.5-3.5 5-3.5 7.5s1 5 3.5 7.5"/></svg>', 'Перевести текст');
    const handleTranslate = () => {
      if (typeof Translator === 'undefined') { _toast('Модуль переводчика не загружен', 'error'); return; }
      const ta = getTa(); if (!ta) return;
      if (state._translateBusy) {
        _toast('Перевод уже выполняется...', 'info');
        return;
      }

      if (state._translateOriginal !== null && state._translateOriginalTab === state.activeTab) {
        pushHistory(ta.value);
        ta.value = state._translateOriginal;
        state.tabs[state.activeTab].value = state._translateOriginal;
        state._translateOriginal = null;
        state._translateOriginalTab = null;
        ta.dispatchEvent(new Event('input'));
        _toast('↩ Оригинал восстановлен');
        return;
      }

      const selStart = ta.selectionStart;
      const selEnd   = ta.selectionEnd;
      const tabAtStart = state.activeTab;
      const sourceValue = ta.value;
      const hasSel   = selStart !== selEnd;
      const sel      = ta.value.substring(selStart, selEnd);
      const text     = hasSel ? sel : ta.value;
      if (!text.trim()) return;
      const lang = Translator.LANG_BY_CODE[Translator.targetLang];
      _toast('Перевод → ' + (lang?.name || Translator.targetLang) + '...');
      state._translateBusy = true;
      translateBtn.disabled = true;
      Translator.translateProtected(text, Translator.targetLang).then(result => {
        if (state.activeTab !== tabAtStart || !state.el?.isConnected) {
          _toast('Перевод отменён: вкладка изменена', 'info');
          return;
        }
        if (ta.value !== sourceValue) {
          _toast('Перевод отменён: текст изменён', 'info');
          return;
        }
        if (!result || result === text) { _toast('Не удалось перевести'); return; }
        pushHistory(ta.value);
        state._translateOriginal = ta.value;
        state._translateOriginalTab = state.activeTab;
        if (hasSel) {
          ta.setRangeText(result, selStart, selEnd, 'select');
        } else {
          ta.value = result;
        }
        state.tabs[state.activeTab].value = ta.value;
        ta.dispatchEvent(new Event('input'));
        _toast('✓ Переведено → ' + (lang?.name || Translator.targetLang) + ' (клик ↩ — вернуть)');
      }).catch(err => _toast('Ошибка: ' + err.message))
        .finally(() => {
          state._translateBusy = false;
          translateBtn.disabled = false;
        });
    };
    translateBtn.addEventListener('click', handleTranslate);

    toolbar.append(
      _mkBtn(SVG.undo, 'Отменить (Ctrl+Z)',  doUndo),
      _mkBtn(SVG.redo, 'Повторить (Ctrl+Y)', doRedo),
      cutBtn, copyBtn, pasteBtn,
      _mkDiv(),
      clearBtn, saveBtn, transferBtn,
      _mkDiv(),
      fDecBtn, fIncBtn, mdBtn,
      _mkDiv(),
      translateBtn,
      _mkDiv(),
      prevTabBtn, tabsWrap, nextTabBtn,
      _mkDiv(),
      countSpan,
    );
    return toolbar;
  }

  /* ================================================================
     Tab rendering
  ================================================================ */
  function _renderTabs(state) {
    const row = state._tabsRow;
    if (!row) return;
    clearTimeout(state.tabClickTimer);
    const frag = document.createDocumentFragment();

    let off = state.tabOffset || 0;
    if (state.activeTab < off) off = state.activeTab;
    if (state.activeTab >= off + VISIBLE_TABS) off = state.activeTab - VISIBLE_TABS + 1;
    off = Math.max(0, Math.min(TAB_COUNT - VISIBLE_TABS, off));
    state.tabOffset = off;

    for (let i = off; i < Math.min(off + VISIBLE_TABS, TAB_COUNT); i++) {
      const btn = document.createElement('span');
      btn.className = 'notepad-tab'
        + (i === state.activeTab ? ' active' : '')
        + (state.tabs[i].value   ? ' filled' : '');
      btn.title = `Вкладка ${i + 1} · Двойной клик — переименовать`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = state.tabs[i].label;
      labelSpan.style.cssText = 'pointer-events:none;';

      const renameInput = document.createElement('input');
      renameInput.className  = 'notepad-tab-rename';
      renameInput.value      = state.tabs[i].label;
      renameInput.maxLength  = 12;
      renameInput.spellcheck = false;
      renameInput.style.cssText =
        'display:none;width:70px;background:var(--bg0);border:1px solid var(--accent);' +
        'color:var(--text0);border-radius:4px;padding:0 3px;font-size:10px;' +
        'font-family:inherit;font-weight:600;outline:none;text-align:center;';

      const commitRename = () => {
        if (!renameInput._editing) return;
        renameInput._editing = false;
        if (renameInput.style.display === 'none') return;
        const v = renameInput.value.trim();
        if (v) state.tabs[i].label = v;
        renameInput.style.display = 'none';
        labelSpan.textContent     = state.tabs[i].label;
        labelSpan.style.display   = '';
        _persist(state);
      };
      renameInput.onblur    = commitRename;
      renameInput.onkeydown = e => {
        e.stopPropagation();
        if (e.key === 'Enter')  { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') {
          renameInput._editing = false;
          renameInput.value = state.tabs[i].label;
          renameInput.style.display = 'none';
          labelSpan.style.display = '';
        }
      };
      renameInput.onclick = e => e.stopPropagation();

      btn.appendChild(labelSpan);
      btn.appendChild(renameInput);

      const idx = i;

      btn.onclick = e => {
        e.stopPropagation();
        clearTimeout(state.tabClickTimer);
        if (e.detail > 1) return;
        state.tabClickTimer = setTimeout(() => {
          if (!state.el?.isConnected) return;
          _switchTab(state, idx, state.el);
        }, TAB_CLICK_DELAY_MS);
      };

      btn.ondblclick = e => {
        e.stopPropagation();
        clearTimeout(state.tabClickTimer);
        if (state.activeTab !== idx) {
          _switchTab(state, idx, state.el);
        }
        _openRenameOnTab(state, idx);
      };

      frag.appendChild(btn);
    }
    row.replaceChildren(frag);
  }

  function _openRenameOnTab(state, idx) {
    const row = state._tabsRow;
    if (!row) return;
    const visPos = idx - state.tabOffset;
    if (visPos < 0 || visPos >= row.children.length) return;
    const tabEl = row.children[visPos];
    const ls = tabEl?.querySelector('span');
    const ri = tabEl?.querySelector('input.notepad-tab-rename');
    if (!ls || !ri) return;
    ri._editing = true;
    ls.style.display = 'none';
    ri.style.display = '';
    ri.value = state.tabs[idx].label;
    ri.focus();
    ri.select();
  }

  function _switchTab(state, idx, win) {
    const ta = _syncActiveTabValue(state) || win?.querySelector('.notepad-body textarea');
    if (ta) {
      state._pushHistory?.(ta.value);
      state.tabs[state.activeTab]._history = state.history.slice();
      state.tabs[state.activeTab]._histIdx = state.histIdx;
    }

    state.activeTab = idx;
    state._translateOriginal = null;
    state._translateOriginalTab = null;

    if (ta) {
      const newVal = state.tabs[idx].value ?? '';
      ta.value = newVal;
      state.history = state.tabs[idx]._history || [newVal];
      state.histIdx = state.tabs[idx]._histIdx ?? state.history.length - 1;
      _updateCount(ta, state._countSpan);
      ta.focus();
    }

    if (state.mdPreview) _renderMdPreview(state);

    _renderTabs(state);
    _persist(state);
  }

  /* ================================================================
     Body
  ================================================================ */
  function _buildBody(state, win) {
    const body = document.createElement('div');
    body.className = 'notepad-body';

    const ta = document.createElement('textarea');
    ta.placeholder    = 'Пишите здесь...';
    ta.spellcheck     = false;
    ta.style.fontSize = state.fontSize + 'px';
    ta.value          = state.tabs[state.activeTab]?.value ?? '';

    const mdContent = document.createElement('div');
    mdContent.className = 'notepad-md-content';
    mdContent.style.display = state.mdPreview ? '' : 'none';
    ta.style.display = state.mdPreview ? 'none' : '';
    state._mdContent = mdContent;

    _updateCount(ta, state._countSpan);

    ta.addEventListener('input', () => {
      state._translateOriginal = null;
      state._translateOriginalTab = null;
      const wasFilled = !!state.tabs[state.activeTab].value;
      state.tabs[state.activeTab].value = ta.value;
      const isFilled = !!ta.value;
      _updateCount(ta, state._countSpan);
      if (wasFilled !== isFilled) _renderTabs(state);
      clearTimeout(state.histTimer);
      state.histTimer = setTimeout(() => {
        state._pushHistory?.(ta.value);
        _persist(state);
      }, HISTORY_DEBOUNCE_MS);
    });

    ta.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Tab / Shift+Tab: indent / de-indent (no focus change)
      if (e.key === 'Tab' && !ctrl && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const start = ta.selectionStart;
        const end   = ta.selectionEnd;
        state._pushHistory?.(ta.value);

        if (!e.shiftKey) {
          // Indent: insert 2 spaces or prepend each selected line
          if (start === end) {
            ta.setRangeText('  ', start, end, 'end');
          } else {
            const before   = ta.value.slice(0, start);
            const selected = ta.value.slice(start, end);
            const after    = ta.value.slice(end);
            const indented = selected.replace(/^/gm, '  ');
            ta.value = before + indented + after;
            ta.selectionStart = start;
            ta.selectionEnd   = start + indented.length;
          }
        } else {
          // Shift+Tab: remove up to 2 leading spaces per line.
          const before   = ta.value.slice(0, start);
          const selected = ta.value.slice(start, end || start);
          const after    = ta.value.slice(end || start);

          if (start === end) {
            // No selection: remove up to 2 trailing spaces before cursor on same line
            const lineStart = before.lastIndexOf('\n') + 1;
            const linePrefix = before.slice(lineStart);
            const remove = linePrefix.endsWith('  ') ? 2 : linePrefix.endsWith(' ') ? 1 : 0;
            if (remove) {
              ta.value = before.slice(0, start - remove) + after;
              ta.selectionStart = ta.selectionEnd = start - remove;
            }
          } else {
            const deindented = selected.replace(/^ {1,2}/gm, '');
            ta.value = before + deindented + after;
            ta.selectionStart = start;
            ta.selectionEnd   = start + deindented.length;
          }
        }

        ta.dispatchEvent(new Event('input'));
        return;
      }

      if (ctrl && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        state._saveToFile?.();
        return;
      }

      if (ctrl && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault();
        state._doUndo?.();
        return;
      }

      if (ctrl && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
        e.preventDefault();
        state._doRedo?.();
      }
    });

    body.appendChild(ta);
    body.appendChild(mdContent);
    return body;
  }

  const _byteEnc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

  function _byteLen(s) {
    if (_byteEnc) return _byteEnc.encode(s).length;
    try { return unescape(encodeURIComponent(s)).length; } catch (_) { return s.length; }
  }

  function _updateCount(ta, countSpan) {
    if (!countSpan || !ta) return;
    const value = ta.value;
    const chars = value.length;
    let lines = value ? 1 : 0;
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) === 10) lines++;
    }
    const bytes = value.length > 10000
      ? Math.ceil(value.length * 1.5)
      : _byteLen(value);
    const kb = (bytes / 1024).toFixed(1);
    countSpan.textContent = `${chars}/${lines}/${kb}KB`;
  }

  /* ================================================================
     Markdown preview
  ================================================================ */
  function _renderMdPreview(state) {
    const mdEl = state._mdContent;
    if (!mdEl) return;
    const ta = state.el?.querySelector('.notepad-body textarea');
    const text = ta?.value || state.tabs[state.activeTab]?.value || '';
    if (!text.trim()) {
      mdEl.innerHTML = '<span style="color:var(--text3);font-style:italic">Пусто</span>';
      return;
    }
    if (typeof marked !== 'undefined') {
      try {
        const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        mdEl.innerHTML = marked.parse(safe);
      } catch (_) {
        mdEl.textContent = text;
      }
    } else {
      mdEl.textContent = text;
    }
  }

  function _toggleMdPreview(state, win) {
    state.mdPreview = !state.mdPreview;
    const ta = win.querySelector('.notepad-body textarea');
    if (ta) {
      state.tabs[state.activeTab].value = ta.value;
    }
    if (state._mdContent) {
      state._mdContent.style.display = state.mdPreview ? '' : 'none';
    }
    if (ta) {
      ta.style.display = state.mdPreview ? 'none' : '';
      if (!state.mdPreview) {
        ta.value = state.tabs[state.activeTab].value ?? '';
        ta.focus();
      }
    }
    if (state.mdPreview) _renderMdPreview(state);
    if (state._mdBtn) state._mdBtn.classList.toggle('active', state.mdPreview);
    _persist(state);
  }

  /* ================================================================
     Resize handle
  ================================================================ */
  function _buildResizeHandle(state, win) {
    const handle = document.createElement('div');
    handle.className = 'notepad-resize-handle';
    handle.title     = 'Изменить размер';
    handle.innerHTML = SVG.resize;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const startW = win.offsetWidth, startH = win.offsetHeight;
      document.body.style.userSelect = 'none';

      state.resizeAbort?.abort();
      const ac = new AbortController();
      state.resizeAbort = ac;
      document.addEventListener('mousemove', mv => {
        const rect = win.getBoundingClientRect();
        const maxW = Math.max(MIN_WIDTH, window.innerWidth - rect.left);
        const maxH = Math.max(MIN_HEIGHT, window.innerHeight - rect.top);
        win.style.width  = Math.max(MIN_WIDTH, Math.min(maxW, startW + (mv.clientX - startX))) + 'px';
        win.style.height = Math.max(MIN_HEIGHT, Math.min(maxH, startH + (mv.clientY - startY))) + 'px';
      }, { signal: ac.signal });
      document.addEventListener('mouseup', () => {
        document.body.style.userSelect = '';
        state.size = { w: win.style.width, h: win.style.height };
        state.resizeAbort = null;
        _persist(state);
        ac.abort();
      }, { signal: ac.signal, once: true });
    });

    return handle;
  }

  /* ================================================================
     Drag
  ================================================================ */
  function _makeDraggable(handle, el, state, excludeInput) {
    handle.addEventListener('mousedown', e => {
      if (
        e.target === excludeInput ||
        e.target.tagName === 'INPUT' ||
        e.target.closest('button, .notepad-close, .notepad-min-btn')
      ) return;

      const rect   = el.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const startL = rect.left,  startT = rect.top;
      el.style.transform = 'none';
      el.style.left = startL + 'px';
      el.style.top  = startT + 'px';
      document.body.style.userSelect = 'none';
      e.preventDefault();

      state.dragAbort?.abort();
      const ac = new AbortController();
      state.dragAbort = ac;
      document.addEventListener('mousemove', mv => {
        const maxLeft = Math.max(0, window.innerWidth  - el.offsetWidth);
        const maxTop  = Math.max(0, window.innerHeight - el.offsetHeight);
        el.style.left = Math.max(0, Math.min(maxLeft, startL + (mv.clientX - startX))) + 'px';
        el.style.top  = Math.max(0, Math.min(maxTop,  startT + (mv.clientY - startY))) + 'px';
      }, { signal: ac.signal });
      document.addEventListener('mouseup', () => {
        document.body.style.userSelect = '';
        state.pos = { left: el.style.left, top: el.style.top };
        state.dragAbort = null;
        _persist(state);
        ac.abort();
      }, { signal: ac.signal, once: true });
    });
  }

  return { create };
})();

window.Notepad = Notepad;