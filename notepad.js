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

  let _instance = null;

  /* ---- localStorage helpers ----------------------------------------- */

  function _persist(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        title:     state.title,
        tabs:      state.tabs,
        activeTab: state.activeTab,
        fontSize:  state.fontSize,
        pos:       state.pos,
        size:      state.size,
      }));
    } catch (_) {}
  }

  function _loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
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
  };

  function _mkBtn(html, title, onclick) {
    const b = document.createElement('button');
    b.className = 'notepad-tool-btn';
    b.type      = 'button';
    b.innerHTML = html;
    b.title     = title;
    b.onclick   = onclick;
    return b;
  }

  function _mkDiv() {
    const d = document.createElement('span');
    d.className = 'notepad-tool-divider';
    return d;
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
        .then(text => onText(text))
        .catch(() => Toast.show('Нажмите Ctrl+V для вставки', 'info'));
    } else {
      // Clipboard API disabled — user must press Ctrl+V manually
      Toast.show('Нажмите Ctrl+V для вставки', 'info');
    }
  }

  /* ================================================================
     Public: create / open
  ================================================================ */
  function create() {
    if (_instance && _instance.el?.isConnected) {
      if (_instance.minimized) {
        _instance.minimized = false;
        _instance.el.classList.remove('notepad-minimized');
        const chevron = _instance.el.querySelector('.notepad-min-btn svg');
        if (chevron) chevron.style.transform = '';
      }
      _instance.el.querySelector('.notepad-body textarea')?.focus();
      return;
    }

    const saved = _loadSaved();

    let tabs = saved?.tabs ?? null;
    if (!Array.isArray(tabs)) {
      tabs = Array.from({ length: TAB_COUNT }, (_, i) => ({ label: String(i + 1), value: '' }));
    }
    while (tabs.length < TAB_COUNT) tabs.push({ label: String(tabs.length + 1), value: '' });

    const activeTab = Math.min(saved?.activeTab ?? 0, TAB_COUNT - 1);
    const initVal   = tabs[activeTab]?.value ?? '';

    const state = {
      title:        saved?.title    || 'Блокнот',
      tabs,
      activeTab,
      tabOffset:    0,
      fontSize:     saved?.fontSize || 12,
      minimized:    false,
      pos:          saved?.pos      || null,
      size:         saved?.size     || null,
      history:      [initVal],
      histIdx:      0,
      histTimer:    null,
      el:           null,
      _tabsRow:     null,
      _countSpan:   null,
      _doUndo:      null,
      _doRedo:      null,
      _pushHistory: null,
    };

    const win = _buildWindow(state);
    state.el  = win;
    _instance = state;

    document.getElementById('notepad-container').appendChild(win);

    if (state.pos) {
      win.style.left      = state.pos.left;
      win.style.top       = state.pos.top;
      win.style.transform = 'none';
    }
    if (state.size) {
      win.style.width  = state.size.w;
      win.style.height = state.size.h;
    }

    requestAnimationFrame(() => win.querySelector('.notepad-body textarea')?.focus());
  }

  /* ================================================================
     Close
  ================================================================ */
  function _closeNotepad(state) {
    const ta = state.el?.querySelector('.notepad-body textarea');
    if (ta) state.tabs[state.activeTab].value = ta.value;

    clearTimeout(state.histTimer);
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
     FIX: minBtn and closeBtn are now <button type="button"> elements
     instead of <span> — proper keyboard focus and activation support.
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
    titleLabel.title       = 'Двойной клик — переименовать';

    const titleInput = document.createElement('input');
    titleInput.className     = 'notepad-title-input';
    titleInput.value         = state.title;
    titleInput.spellcheck    = false;
    titleInput.style.display = 'none';

    titleLabel.ondblclick = e => {
      e.stopPropagation();
      titleLabel.style.display = 'none';
      titleInput.style.display = '';
      titleInput.value = state.title;
      titleInput.focus();
      titleInput.select();
    };
    const commitTitle = () => {
      const v = titleInput.value.trim();
      if (v) state.title = v;
      titleLabel.textContent   = state.title;
      titleLabel.style.display = '';
      titleInput.style.display = 'none';
      _persist(state);
    };
    titleInput.onblur    = commitTitle;
    titleInput.onkeydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); commitTitle(); }
      if (e.key === 'Escape') { titleInput.style.display = 'none'; titleLabel.style.display = ''; }
    };

    titleWrap.append(titleLabel, titleInput);

    // FIX: was <span> — now proper <button> for keyboard accessibility
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
    _makeDraggable(header, win, state, titleInput);
    return header;
  }

  function _toggleMinimize(state, win) {
    state.minimized = !state.minimized;
    win.classList.toggle('notepad-minimized', state.minimized);
    const chevron = win.querySelector('.notepad-min-btn svg');
    if (chevron) chevron.style.transform = state.minimized ? 'rotate(-90deg)' : '';
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
      if (state.history.length > MAX_HISTORY) state.history.shift();
      state.histIdx = state.history.length - 1;
    }

    const doUndo = () => {
      const ta = getTa();
      if (!ta || state.histIdx <= 0) return;
      state.histIdx--;
      ta.value = state.history[state.histIdx];
      state.tabs[state.activeTab].value = ta.value;
      _updateCount(ta, countSpan);
      _persist(state);
    };

    const doRedo = () => {
      const ta = getTa();
      if (!ta || state.histIdx >= state.history.length - 1) return;
      state.histIdx++;
      ta.value = state.history[state.histIdx];
      state.tabs[state.activeTab].value = ta.value;
      _updateCount(ta, countSpan);
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
      navigator.clipboard.writeText(sel).catch(() => {});
      pushHistory(ta.value);
      ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    });

    const copyBtn = _mkBtn(SVG.copy, 'Копировать (выделение или всё)', () => {
      const ta = getTa(); if (!ta) return;
      const text = ta.selectionStart !== ta.selectionEnd
        ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : ta.value;
      navigator.clipboard.writeText(text)
        .then(() => Toast.show('Скопировано ✓', 'success'))
        .catch(() => Toast.show('Ошибка копирования', 'error'));
    });

    const pasteBtn = _mkBtn(SVG.paste, 'Вставить из буфера (или Ctrl+V)', () => {
      const ta = getTa(); if (!ta) return;
      _doPaste(ta, text => {
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
        pushHistory('');
        ta.value = '';
        state.tabs[state.activeTab].value = '';
        _updateCount(ta, countSpan);
        _renderTabs(state);
        _persist(state);
      }
    });

    const saveBtn = _mkBtn(SVG.save, 'Сохранить в .txt', () => {
      const ta = getTa(); if (!ta) return;
      const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }));
      Object.assign(document.createElement('a'), {
        href:     url,
        download: (state.title || 'notepad') + '.txt',
      }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      Toast.show('Файл скачан ✓', 'success');
    });

    const transferBtn = _mkBtn(SVG.transfer, 'Скопировать на следующую свободную вкладку', () => {
      const ta = getTa(); if (!ta || !ta.value.trim()) return;

      let target = (state.activeTab + 1) % TAB_COUNT;
      for (let i = 1; i < TAB_COUNT; i++) {
        const idx = (state.activeTab + i) % TAB_COUNT;
        if (!state.tabs[idx].value.trim()) { target = idx; break; }
      }

      clearTimeout(state.histTimer);
      state.tabs[target].value += (state.tabs[target].value ? '\n' : '') + ta.value;
      _persist(state);
      _switchTab(state, target, win);
      Toast.show('Скопировано ✓', 'success');
    });

    const fDecBtn = _mkBtn('A−', 'Шрифт меньше', () => {
      state.fontSize = Math.max(9, state.fontSize - 1);
      const ta = getTa(); if (ta) ta.style.fontSize = state.fontSize + 'px';
      _persist(state);
    });
    const fIncBtn = _mkBtn('A+', 'Шрифт больше', () => {
      state.fontSize = Math.min(22, state.fontSize + 1);
      const ta = getTa(); if (ta) ta.style.fontSize = state.fontSize + 'px';
      _persist(state);
    });

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

    toolbar.append(
      _mkBtn(SVG.undo, 'Отменить (Ctrl+Z)',  doUndo),
      _mkBtn(SVG.redo, 'Повторить (Ctrl+Y)', doRedo),
      cutBtn, copyBtn, pasteBtn,
      _mkDiv(),
      clearBtn, saveBtn, transferBtn,
      _mkDiv(),
      fDecBtn, fIncBtn,
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
    row.innerHTML = '';

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
      renameInput.maxLength  = 6;
      renameInput.spellcheck = false;
      renameInput.style.cssText =
        'display:none;width:40px;background:var(--bg0);border:1px solid var(--accent);' +
        'color:var(--text0);border-radius:4px;padding:0 3px;font-size:10px;' +
        'font-family:inherit;font-weight:600;outline:none;text-align:center;';

      const commitRename = () => {
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
        if (e.key === 'Escape') { renameInput.style.display = 'none'; labelSpan.style.display = ''; }
      };
      renameInput.onclick = e => e.stopPropagation();

      btn.appendChild(labelSpan);
      btn.appendChild(renameInput);

      const idx = i;
      let _clickTimer = null;

      btn.onclick = e => {
        e.stopPropagation();
        clearTimeout(_clickTimer);
        _clickTimer = setTimeout(() => _switchTab(state, idx, state.el), 220);
      };

      btn.ondblclick = e => {
        e.stopPropagation();
        clearTimeout(_clickTimer);
        if (state.activeTab !== idx) {
          _switchTab(state, idx, state.el);
          _openRenameOnTab(state, idx);
        } else {
          labelSpan.style.display = 'none';
          renameInput.style.display = '';
          renameInput.value = state.tabs[idx].label;
          renameInput.focus();
          renameInput.select();
        }
      };

      row.appendChild(btn);
    }
  }

  function _openRenameOnTab(state, idx) {
    requestAnimationFrame(() => {
      const row = state._tabsRow;
      if (!row) return;
      const visPos = idx - state.tabOffset;
      if (visPos < 0 || visPos >= row.children.length) return;
      const newBtn = row.children[visPos];
      const ls = newBtn?.querySelector('span');
      const ri = newBtn?.querySelector('input.notepad-tab-rename');
      if (!ls || !ri) return;
      ls.style.display = 'none';
      ri.style.display = '';
      ri.value = state.tabs[idx].label;
      ri.focus();
      ri.select();
    });
  }

  function _switchTab(state, idx, win) {
    const ta = win?.querySelector('.notepad-body textarea');
    if (ta) state.tabs[state.activeTab].value = ta.value;

    state.activeTab = idx;

    if (ta) {
      const newVal = state.tabs[idx].value ?? '';
      ta.value = newVal;
      state.history = [newVal];
      state.histIdx = 0;
      _updateCount(ta, state._countSpan);
      ta.focus();
    }

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

    _updateCount(ta, state._countSpan);

    ta.addEventListener('input', () => {
      state.tabs[state.activeTab].value = ta.value;
      _updateCount(ta, state._countSpan);
      _renderTabs(state);
      clearTimeout(state.histTimer);
      state.histTimer = setTimeout(() => {
        state._pushHistory?.(ta.value);
        _persist(state);
      }, 600);
    });

    ta.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Tab / Shift+Tab: indent / de-indent (no focus change)
      if (e.key === 'Tab' && !ctrl) {
        e.preventDefault();
        const start = ta.selectionStart;
        const end   = ta.selectionEnd;

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
          // FIX: Shift+Tab — de-indent: remove up to 2 leading spaces per line
          const before   = ta.value.slice(0, start);
          const selected = ta.value.slice(start, end || start);
          const after    = ta.value.slice(end || start);

          if (start === end) {
            // No selection: remove up to 2 spaces before cursor on same line
            const lineStart = before.lastIndexOf('\n') + 1;
            const linePrefix = before.slice(lineStart);
            const remove = linePrefix.match(/^ {1,2}/)?.[0]?.length ?? 0;
            if (remove) {
              ta.value = before.slice(0, lineStart) + before.slice(lineStart + remove) + after;
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

      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        state._doUndo?.();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        state._doRedo?.();
      }
    });

    body.appendChild(ta);
    return body;
  }

  const _byteEnc = new TextEncoder();

  function _byteLen(s) { return _byteEnc.encode(s).length; }

  function _updateCount(ta, countSpan) {
    if (!countSpan || !ta) return;
    const chars = ta.value.length;
    const lines = ta.value ? ta.value.split('\n').length : 0;
    const kb    = (_byteLen(ta.value) / 1024).toFixed(1);
    countSpan.textContent = `${chars}/${lines}/${kb}KB`;
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

      const ac = new AbortController();
      document.addEventListener('mousemove', mv => {
        win.style.width  = Math.max(260, startW + (mv.clientX - startX)) + 'px';
        win.style.height = Math.max(180, startH + (mv.clientY - startY)) + 'px';
      }, { signal: ac.signal });
      document.addEventListener('mouseup', () => {
        document.body.style.userSelect = '';
        state.size = { w: win.style.width, h: win.style.height };
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

      const ac = new AbortController();
      document.addEventListener('mousemove', mv => {
        el.style.left = Math.max(0, Math.min(window.innerWidth  - 80, startL + (mv.clientX - startX))) + 'px';
        el.style.top  = Math.max(0, Math.min(window.innerHeight - 40, startT + (mv.clientY - startY))) + 'px';
      }, { signal: ac.signal });
      document.addEventListener('mouseup', () => {
        document.body.style.userSelect = '';
        state.pos = { left: el.style.left, top: el.style.top };
        _persist(state);
        ac.abort();
      }, { signal: ac.signal, once: true });
    });
  }

  return { create };
})();

window.Notepad = Notepad;