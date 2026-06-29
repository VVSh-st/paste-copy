// file_name: app.js

(async function () {
  'use strict';

  let saveTimer = null;

  // ── Separator key ↔ value map ──────────────────────────────────────────
  const SEP_OPTIONS = [
    { key: '\\n\\n',          val: '\n\n'        },
    { key: '\\n',             val: '\n'          },
    { key: '\\n---\\n',       val: '\n---\n'     },
    { key: '\\n\\n---\\n\\n', val: '\n\n---\n\n' },
    { key: '\\n===\\n',       val: '\n===\n'     },
    { key: '\\n\\n***\\n\\n', val: '\n\n***\n\n' },
  ];
  const _keyToSep = key => SEP_OPTIONS.find(o => o.key === key)?.val ?? '\n\n';
  const _sepToKey = sep => SEP_OPTIONS.find(o => o.val === sep)?.key ?? '\\n\\n';

  // ── Track tab IDs to detect truly-new tabs for default template ─────────
  const _seenTabIds = new Set();

  // ── Tiny DOM helpers (минимально, чтобы не падать на отсутствующих узлах) ─
  const $id = id => document.getElementById(id);
  const onClick = (id, fn) => { const el = $id(id); if (el) el.onclick = fn; };
  const onEvent = (id, evt, fn) => { const el = $id(id); if (el) el.addEventListener(evt, fn); };
  // ── Schedule auto-save ──────────────────────────────────────────────────
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Storage.save(State.serialize());
      if (typeof GistSync !== 'undefined') GistSync.schedulePush();
    }, 600);
  }

  // ── Restore WordDict / hint / clipboard settings ────────────────────────
  function _restoreWordDictSettings() {
    const lay = State.getLayout();
    if (lay.hintsEnabled  !== undefined) WordDict.setConfig({ enabled:    lay.hintsEnabled });
    if (lay.wcMinLen          !== undefined) WordDict.setConfig({ minLen:         lay.wcMinLen });
    if (lay.wcMaxSuggest      !== undefined) WordDict.setConfig({ maxSuggest:     lay.wcMaxSuggest });
    if (lay.wcAcceptEffect    !== undefined) WordDict.setConfig({ acceptEffect:   lay.wcAcceptEffect });
    if (lay.wcAcceptEffectMs  !== undefined) WordDict.setConfig({ acceptEffectMs: lay.wcAcceptEffectMs });
    if (lay.wcHintYOffset    !== undefined) WordDict.setConfig({ hintYOffset:    lay.wcHintYOffset });
    if (lay.wordlistSave      !== undefined) WordDict.setTempSaveEnabled(lay.wordlistSave);
  }

  function _restoreClipboardSetting() {
    // Синхронизируем глобальный флаг из layout (используется в notepad.js)
    window._clipboardApiEnabled = State.getLayout().clipboardApi !== false;
  }

  // ── Detect and initialise new tabs (default template) ───────────────────
  function _applyDefaultTemplateToNewTabs() {
    const defId = State.getDefaultTemplateId();
    if (!defId) return;

    State.getAll().forEach(tab => {
      if (_seenTabIds.has(tab.id)) return;
      _seenTabIds.add(tab.id);
      applyDefaultTemplate(tab);
    });
  }

  // ── Full render ─────────────────────────────────────────────────────────
  function fullRender() {
    _applyDefaultTemplateToNewTabs();
    Tabs.render();
    Blocks.render();
    Preview.render();
    Preview.applyHeight();
    updateButtons();
    syncSettings();
    scheduleSave();
    Templates.renderDropdown();
    WordDict.scheduleBuild();
    requestAnimationFrame(() => {
      if (typeof Anchors !== 'undefined') Anchors._renderMarkersAll();
    });
  }

  function liveRender() {
    Preview.render();
    scheduleSave();
  }

  function updateButtons() {
    const undoEl = $id('btn-undo');
    const redoEl = $id('btn-redo');
    const canU   = State.canUndo();
    const canR   = State.canRedo();
    if (undoEl) { undoEl.disabled = !canU; undoEl.classList.toggle('active-btn', canU); }
    if (redoEl) { redoEl.disabled = !canR; redoEl.classList.toggle('active-btn', canR); }
  }

  // ── Sync settings panel UI ↔ state ──────────────────────────────────────
  function syncSettings() {
    const t   = State.getActive();
    const lay = State.getLayout();
    const wc  = WordDict.getConfig();

    const optHeaders = $id('opt-headers');
    if (optHeaders) optHeaders.checked = lay.previewHeaders !== false;

    const currentSep = t ? (t.separator ?? '\n\n') : '\n\n';
    const optSep = $id('opt-separator');
    if (optSep) optSep.value = _sepToKey(currentSep);

    const optHints = $id('opt-wc-enabled-misc');
    if (optHints) optHints.checked = wc.enabled;

    const optMinLen = $id('opt-wc-minchars-misc');
    if (optMinLen) optMinLen.value = wc.minLen;

    const optMaxSug = $id('opt-wc-maxsug-misc');
    if (optMaxSug) optMaxSug.value = wc.maxSuggest;

    const optWcAcceptEffect = $id('opt-wc-accept-effect-misc');
    if (optWcAcceptEffect) optWcAcceptEffect.checked = wc.acceptEffect !== false;

    const optWcEffectMs = $id('opt-wc-effect-ms-misc');
    if (optWcEffectMs) optWcEffectMs.value = wc.acceptEffectMs;

    const optHintY = $id('opt-wc-hint-y-misc');
    if (optHintY) optHintY.value = wc.hintYOffset || 0;

    const smartList = lay.smartList !== false;
    const optSmart = $id('opt-wc-enter-numbering-misc');
    if (optSmart) optSmart.checked = smartList;
    window._smartListEnabled = smartList;

    const optWlSave = $id('opt-wordlist-save-misc');
    if (optWlSave) optWlSave.checked = WordDict.getTempSaveEnabled();

    const tooltips = lay.tooltips !== false;
    const optTooltips = $id('opt-tooltips');
    if (optTooltips) optTooltips.checked = tooltips;
    document.body.classList.toggle('no-tooltips', !tooltips);

    const optClipboard = $id('opt-clipboard-api');
    if (optClipboard) optClipboard.checked = lay.clipboardApi !== false;

    // Sync ninja cursor checkbox with persisted layout flag
    const optNinja = $id('opt-ninja-cursor');
    if (optNinja) optNinja.checked = lay.ninjaCursor === true;

    const optCurrentLine = $id('opt-current-line-highlight-misc');
    if (optCurrentLine) optCurrentLine.checked = lay.currentLineHighlight === true;

    const optCurrentLineColor = $id('opt-current-line-color-misc');
    if (optCurrentLineColor) optCurrentLineColor.value = lay.currentLineColor || 'rgba(79,142,247,0.18)';
  }

  State.onChange(fullRender);
  State.onLive(liveRender);
  State.onSnapshot(updateButtons); // обновляем кнопки undo/redo после blur без re-render блоков

  /* ── Toolbar buttons ────────────────────────────────────────────────────*/
  // preventDefault на mousedown — не уводим фокус с textarea при клике
  onEvent('btn-undo', 'mousedown', e => e.preventDefault());
  onEvent('btn-redo', 'mousedown', e => e.preventDefault());
  onClick('btn-undo', () => { State.undo(); updateButtons(); });
  onClick('btn-redo', () => { State.redo(); updateButtons(); });

  onClick('btn-save', () => {
      Storage.save(State.serialize());
      window.Intelligence?.track?.('state.save');
      if (typeof Ember !== 'undefined') Ember.triggerReaction('save');
      if (typeof GistSync !== 'undefined') {
        GistSync.onSaveTrigger();
    } else {
      Toast.show('Сохранено ✓', 'success');
    }
  });

  onClick('btn-export', exportFile);
  onClick('btn-import', () => $id('file-input')?.click());
  const fileInput = $id('file-input');
  if (fileInput) fileInput.onchange = importFile;
  onClick('btn-search', () => Search.open());
  onClick('btn-notepad', () => Notepad.create());

  /* ── Close all dropdowns helper ────────────────────────────────────────*/
  function closeAllDropdowns(except) {
    document.querySelectorAll('.dropdown.open').forEach(d => {
      if (d !== except) d.classList.remove('open');
    });
  }

  /* ── Add-block dropdown ─────────────────────────────────────────────────*/
  const addDd = $id('add-dropdown');
  onClick('btn-add-block', e => {
    e.stopPropagation();
    closeAllDropdowns(addDd);
    addDd?.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  });

  document.querySelectorAll('#add-menu button').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      State.addBlock(btn.dataset.type);
      addDd?.classList.remove('open');
    };
  });

  /* ── Templates dropdown ─────────────────────────────────────────────────*/
  const tplDd = $id('tpl-dropdown');
  onClick('btn-templates', e => {
    e.stopPropagation();
    closeAllDropdowns(tplDd);
    tplDd?.classList.toggle('open');
  });

  /* ── Settings dropdown ──────────────────────────────────────────────────*/
  onClick('btn-settings', e => {
    e.stopPropagation();
    const sd = $id('settings-dropdown');
    closeAllDropdowns(sd);
    sd?.classList.toggle('open');
  });

  onClick('btn-intelligence-save-version', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openSaveVersion?.();
  });

  onClick('btn-intelligence-compare-version', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openNamedVersionCompare?.();
  });

  onClick('btn-intelligence-baseline', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openBaselineManager?.();
  });

  onClick('btn-intelligence-update-baseline', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openQuickBaselineUpdate?.();
  });

  onClick('btn-intelligence-cleanup', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openProjectGraphCleanup?.();
  });

  onClick('btn-memory-sync', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.MemorySync?.openDialog?.();
  });

  onClick('btn-intelligence-diagnostics', e => {
    e.stopPropagation();
    $id('settings-dropdown')?.classList.remove('open');
    window.SmartSuggestions?.openDiagnostics?.();
  });

  const settingsMenu = $id('settings-menu');
  settingsMenu?.addEventListener('click', e => e.stopPropagation());
  settingsMenu?.addEventListener('mousedown', e => e.stopPropagation());

  /* ── Settings handlers ──────────────────────────────────────────────────*/
  const optHeaders = $id('opt-headers');
  if (optHeaders) optHeaders.onchange = e => {
    State.setLayout({ previewHeaders: e.target.checked });
    Preview.render();
    scheduleSave();
  };

  const optSeparator = $id('opt-separator');
  if (optSeparator) optSeparator.onchange = e => {
    const sep = _keyToSep(e.target.value);
    State.update(t => { t.separator = sep; });
  };

  const optHints = $id('opt-wc-enabled-misc');
  if (optHints) optHints.onchange = e => {
    WordDict.setConfig({ enabled: e.target.checked });
    State.setLayout({ hintsEnabled: e.target.checked });
    if (!e.target.checked && window.InlineHint) window.InlineHint.hide();
    scheduleSave();
  };

  const optMinLen = $id('opt-wc-minchars-misc');
  if (optMinLen) optMinLen.oninput = e => {
    const v = parseInt(e.target.value, 10);
    if (v >= 2 && v <= 8) {
      WordDict.setConfig({ minLen: v });
      State.setLayout({ wcMinLen: v });
      scheduleSave();
    }
  };

  const optMaxSug = $id('opt-wc-maxsug-misc');
  if (optMaxSug) optMaxSug.oninput = e => {
    const v = parseInt(e.target.value, 10);
    if (v >= 1 && v <= 10) {
      WordDict.setConfig({ maxSuggest: v });
      State.setLayout({ wcMaxSuggest: v });
      scheduleSave();
    }
  };

  const optWcAcceptEffect = $id('opt-wc-accept-effect-misc');
  if (optWcAcceptEffect) optWcAcceptEffect.onchange = e => {
    const enabled = e.target.checked;
    WordDict.setConfig({ acceptEffect: enabled });
    State.setLayout({ wcAcceptEffect: enabled });
    scheduleSave();
  };

  const optWcEffectMs = $id('opt-wc-effect-ms-misc');
  if (optWcEffectMs) optWcEffectMs.onchange = e => {
    const raw = parseInt(e.target.value, 10);
    if (!Number.isFinite(raw)) return;

    const v = Math.max(1000, Math.min(10000, Math.round(raw / 50) * 50));
    e.target.value = v;
    WordDict.setConfig({ acceptEffectMs: v });
    State.setLayout({ wcAcceptEffectMs: v });
    scheduleSave();
  };

  const optHintY = $id('opt-wc-hint-y-misc');
  if (optHintY) optHintY.oninput = e => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    WordDict.setConfig({ hintYOffset: v });
    State.setLayout({ wcHintYOffset: v });
    scheduleSave();
  };

  const optSmartList = $id('opt-wc-enter-numbering-misc');
  if (optSmartList) optSmartList.onchange = e => {
    window._smartListEnabled = e.target.checked;
    State.setLayout({ smartList: e.target.checked });
    scheduleSave();
  };

  const optWordlistSave = $id('opt-wordlist-save-misc');
  if (optWordlistSave) optWordlistSave.onchange = e => {
    WordDict.setTempSaveEnabled(e.target.checked);
    State.setLayout({ wordlistSave: e.target.checked });
    scheduleSave();
  };

  const optTooltips = $id('opt-tooltips');
  if (optTooltips) optTooltips.onchange = e => {
    const enabled = e.target.checked;
    State.setLayout({ tooltips: enabled });
    document.body.classList.toggle('no-tooltips', !enabled);
    _applyTooltipState(enabled);
    scheduleSave();
  };

  const optClipboardApi = $id('opt-clipboard-api');
  if (optClipboardApi) optClipboardApi.onchange = e => {
    const enabled = e.target.checked;
    State.setLayout({ clipboardApi: enabled });
    window._clipboardApiEnabled = enabled; // синхронизируем глобальный флаг
    scheduleSave();
    Toast.show(
      enabled ? 'Clipboard API включён' : 'Вставка через Ctrl+V (без запроса разрешения)',
      'success',
    );
  };

  const optNinjaCursor = $id('opt-ninja-cursor');
  if (optNinjaCursor) optNinjaCursor.onchange = e => {
    const enabled = e.target.checked;
    State.setLayout({ ninjaCursor: enabled });
    if (typeof NinjaCursor !== 'undefined') NinjaCursor.setEnabled(enabled);
    scheduleSave();
    Toast.show(
      enabled ? 'Ninja cursor включён ✓' : 'Ninja cursor выключен',
      'success',
    );
  };

  const optCurrentLine = $id('opt-current-line-highlight-misc');
  if (optCurrentLine) optCurrentLine.onchange = e => {
    const enabled = e.target.checked;
    State.setLayout({ currentLineHighlight: enabled });
    Blocks.render();
    scheduleSave();
    Toast.show(enabled ? 'Подсветка строки включена' : 'Подсветка строки выключена', 'success');
  };

  const optCurrentLineColor = $id('opt-current-line-color-misc');
  if (optCurrentLineColor) {
    const saveLineColor = e => {
      const value = String(e.target.value || '').trim() || 'rgba(79,142,247,0.18)';
      State.setLayout({ currentLineColor: value });
      document.querySelectorAll('.current-line-highlight').forEach(el => {
        el.style.background = value;
      });
      scheduleSave();
    };
    optCurrentLineColor.oninput = saveLineColor;
    optCurrentLineColor.onchange = saveLineColor;
  }

  /* ── Anchor settings ──────────────────────────────────────────────────*/
  const anchorSettings = Anchors?.getMarkerSettings?.() || { lineMarkers: true, bgHighlight: true, color: '#4f8ef7' };

  const optAnchorLines = $id('opt-anchor-line-markers');
  if (optAnchorLines) {
    optAnchorLines.checked = anchorSettings.lineMarkers;
    optAnchorLines.onchange = e => {
      Anchors.setMarkerSetting('lineMarkers', e.target.checked);
      Toast.show(e.target.checked ? 'Линии-маркеры якорей включены' : 'Линии-маркеры якорей выключены', 'success');
    };
  }

  const optAnchorBg = $id('opt-anchor-bg-highlight');
  if (optAnchorBg) {
    optAnchorBg.checked = anchorSettings.bgHighlight;
    optAnchorBg.onchange = e => {
      Anchors.setMarkerSetting('bgHighlight', e.target.checked);
      Toast.show(e.target.checked ? 'Подсветка фона якорей включена' : 'Подсветка фона якорей выключена', 'success');
    };
  }

  const optAnchorColor = $id('opt-anchor-color');
  if (optAnchorColor) {
    optAnchorColor.value = anchorSettings.color;
    const saveAnchorColor = e => {
      const value = String(e.target.value || '').trim() || '#4f8ef7';
      Anchors.setMarkerSetting('color', value);
    };
    optAnchorColor.oninput = saveAnchorColor;
    optAnchorColor.onchange = saveAnchorColor;
  }

  function _applyTooltipState(enabled) {
    if (!enabled) {
      document.querySelectorAll('[title]').forEach(el => {
        el.dataset._title = el.title;
        el.removeAttribute('title');
      });
    } else {
      document.querySelectorAll('[data-_title]').forEach(el => {
        el.title = el.dataset._title;
        delete el.dataset._title;
      });
    }
  }

  /* ── Preview controls ───────────────────────────────────────────────────*/
  onClick('btn-copy',      () => Preview.copy());
  onClick('prev-copy',     () => Preview.copy());
  onClick('prev-font-inc', () => Preview.fontInc());
  onClick('prev-font-dec', () => Preview.fontDec());
  onClick('prev-wrap',     () => Preview.toggleWrap());
  onClick('prev-md',       () => Preview.toggleMarkdown());
  onClick('prev-toggle',   () => Preview.toggleCollapse());

  onEvent('preview-bar', 'dblclick', e => {
    if (e.target.closest('button, .preview-controls')) return;
    Preview.toggleCollapse();
  });

  onClick('prev-download', () => {
    const text = Preview.getText();
    if (!text) return;

    const tab = State.getActive();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    Object.assign(document.createElement('a'), {
      href:     url,
      download: (tab?.name ?? 'prompt') + '.txt',
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.show('Файл скачан ✓', 'success');
    window.Intelligence?.track?.('preview.download', {
      chars: text.length,
      tabId: tab?.id,
      tabName: tab?.name || ''
    });
  });

  // Улучшение 1: экспорт всех вкладок в один Markdown-файл
  onEvent('prev-export-all', 'click', () => {
    const allTabs = State.getAll();
    const md = allTabs.map(tab => {
      const sep   = tab.separator ?? '\n\n';
      const parts = (tab.blocks || [])
        .filter(b => b.type === 'text' && ((b.subtabs?.[b.activeSubtab ?? 0]?.value) || '').trim())
        .map(b => {
          const v = (b.subtabs?.[b.activeSubtab ?? 0]?.value) || '';
          return '### ' + (b.title || 'Блок') + '\n\n' + v;
        });
      return '## ' + (tab.name || 'Вкладка') + '\n\n' + parts.join(sep);
    }).join('\n\n---\n\n');

    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    Object.assign(document.createElement('a'), {
      href:     url,
      download: 'all-tabs-' + new Date().toISOString().slice(0, 10) + '.md',
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.show('Экспортировано ' + allTabs.length + ' вкладок ✓', 'success');
    window.Intelligence?.track?.('preview.exportAll', {
      tabs: allTabs.length,
      chars: md.length
    });
  });

  /* ── Hotkeys ────────────────────────────────────────────────────────────*/
  document.addEventListener('keydown', e => {
    const k       = e.key.toLowerCase();
    const ctrl    = e.ctrlKey || e.metaKey;
    const shift   = e.shiftKey;
    const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

    if      (ctrl && !shift && k === 'z') { e.preventDefault(); State.undo(); }
    else if (ctrl && (k === 'y' || (shift && k === 'z'))) { e.preventDefault(); State.redo(); }
    else if (ctrl && k === 's') {
      e.preventDefault();
      Storage.save(State.serialize());
      window.Intelligence?.track?.('state.save');
      if (typeof GistSync !== 'undefined') {
        GistSync.onSaveTrigger();
      } else {
        Toast.show('Сохранено ✓', 'success');
      }
    }
    else if (ctrl && k === 't') { e.preventDefault(); State.newTab(); }
    else if (ctrl && k === 'w') { e.preventDefault(); const t = State.getActive(); if (t) State.closeTab(t.id); }
    else if (ctrl && shift && k === 'c') { e.preventDefault(); Preview.copy(); }
    else if (ctrl && k === 'd' && !inField) {
      e.preventDefault();

      const t = State.getActive();
      if (!t) return;

      const srcTab = State.serialize().tabs.find(x => x.id === t.id);
      if (!srcTab) return;

      State.newTab(srcTab.name + ' (копия)');
      const newT = State.getActive();

      State.update(nt => {
        if (nt.id === newT.id) nt.blocks = JSON.parse(JSON.stringify(srcTab.blocks));
      });

      Toast.show('Вкладка дублирована ✓', 'success');
    }

    // Полезная UI-функция: Escape закрывает открытые меню/панели/модалки
    else if (e.key === 'Escape') {
      document.querySelectorAll('.dropdown.open, .open').forEach(el => {
        if (el.id === 'workspace' || el.tagName === 'BODY') return;
        if (el.classList.contains('open')) el.classList.remove('open');
      });
      const llmSettings = $id('llm-settings-modal');
      const llmHistory  = $id('llm-history-modal');
      if (llmSettings && getComputedStyle(llmSettings).display !== 'none') llmSettings.style.display = 'none';
      if (llmHistory && getComputedStyle(llmHistory).display !== 'none') llmHistory.style.display = 'none';
    }
  });

  /* ── Column count dropdown (long-click) ────────────────────────────────*/
  (() => {
    const btn = $id('btn-hide-right');
    const dropdown = $id('col-count-dropdown');
    if (!btn || !dropdown) return;

    let longTimer = null;
    let longFired = false;

    function openDropdown() {
      dropdown.classList.add('open');
      longFired = true;
      const count = State.getLayout().columnCount || 2;
      dropdown.querySelectorAll('[data-count]').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.count, 10) === count);
      });
    }
    function closeDropdown() { dropdown.classList.remove('open'); longFired = false; }
    function isDropdownOpen() { return dropdown.classList.contains('open'); }

    btn.addEventListener('mousedown', e => {
      e.stopPropagation();
      longFired = false;
      longTimer = setTimeout(openDropdown, 500);
    });

    btn.addEventListener('mouseup', () => {
      clearTimeout(longTimer);
      longTimer = null;
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (longFired) { longFired = false; return; }
      if (isDropdownOpen()) { closeDropdown(); return; }
      const lay = State.getLayout();
      State.setLayout({ rightColHidden: !lay.rightColHidden });
      Blocks.syncColumnElements();
      Blocks.render();
      btn.classList.toggle('active-btn', State.getLayout().rightColHidden);
      scheduleSave();
    });

    dropdown.addEventListener('mousedown', e => e.stopPropagation());

    dropdown.querySelectorAll('[data-count]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const count = parseInt(b.dataset.count, 10);
        State.setLayout({ columnCount: count, rightColHidden: false });
        Blocks.syncColumnElements();
        Blocks.render();
        closeDropdown();
        btn.classList.remove('active-btn');
        scheduleSave();
      });
    });

    document.addEventListener('mousedown', e => {
      if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        closeDropdown();
      }
    });
  })();

  /* ── Column resizers (dynamic) ──────────────────────────────────────────*/
  (() => {
    const ws = $id('workspace');
    if (!ws) return;
    let activeResizer = null;
    let startX = 0;
    let startWidths = [];

    document.addEventListener('mousedown', e => {
      const r = e.target.closest('.col-resizer');
      if (!r) return;
      e.preventDefault();
      activeResizer = r;
      startX = e.clientX;
      const cols = ws.querySelectorAll('.column:not([style*="display: none"])');
      startWidths = Array.from(cols).map(c => c.getBoundingClientRect().width);
      r.classList.add('active');
      document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', e => {
      if (!activeResizer) return;
      const cols = ws.querySelectorAll('.column:not([style*="display: none"])');
      const colArr = Array.from(cols);
      const resizers = ws.querySelectorAll('.col-resizer');
      const rIdx = Array.from(resizers).indexOf(activeResizer);
      if (rIdx < 0 || rIdx >= colArr.length - 1) return;
      const dx = e.clientX - startX;
      const left = colArr[rIdx];
      const right = colArr[rIdx + 1];
      const leftW = Math.max(80, startWidths[rIdx] + dx);
      const rightW = Math.max(80, startWidths[rIdx + 1] - dx);
      left.style.flex = 'none';
      right.style.flex = 'none';
      left.style.width = leftW + 'px';
      right.style.width = rightW + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!activeResizer) return;
      activeResizer.classList.remove('active');
      activeResizer = null;
      document.body.style.cursor = '';
      scheduleSave();
    });
  })();

  /* ── Preview resizer ────────────────────────────────────────────────────*/
  (() => {
    const resizer = $id('preview-resizer');
    const panel   = $id('preview-panel');
    if (!resizer || !panel) return;

    let dragging = false, startY = 0, startH = 0;

    resizer.onmousedown = e => {
      if (panel.classList.contains('collapsed')) return;
      e.preventDefault();
      dragging = true;
      resizer.classList.add('active');
      startY = e.clientY;
      startH = panel.offsetHeight;
      document.body.style.cursor = 'row-resize';
    };

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const h = Math.max(60, Math.min(window.innerHeight * 0.7, startH + (startY - e.clientY)));
      panel.style.height = h + 'px';
      State.setLayout({ previewHeight: h });
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      scheduleSave();
    });
  })();

  /* ── File helpers ───────────────────────────────────────────────────────*/
  function exportFile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(State.serialize(), null, 2)], { type: 'application/json' }),
    );
    Object.assign(document.createElement('a'), {
      href:     url,
      download: 'prompt-builder-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json',
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Toast.show('Файл экспортирован ✓', 'success');
    window.Intelligence?.track?.('file.export', {
      tabs: State.getAll().length
    });
  }

  function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.tabs) throw new Error('Неверный формат файла');
        if (!confirm('Заменить текущие данные импортируемыми?')) return;
        State.load(data);
        Storage.save(State.serialize());
        Toast.show('Импортировано ✓', 'success');
      } catch (err) {
        Toast.show('Ошибка импорта: ' + err.message, 'error');
        console.error('Import failed:', err);
      }
    };
    reader.readAsText(file);
  }

  /* ── Default template helper ────────────────────────────────────────────*/
  function applyDefaultTemplate(tab) {
    if (!tab) return;
    const defId = State.getDefaultTemplateId();
    if (!defId) return;

    const all = typeof Templates !== 'undefined' ? Templates._getAll?.() : [];
    const tpl = (all || []).find(t => t.id === defId)
             ?? (Storage.loadTemplates() || []).find(t => t.id === defId);
    if (!tpl?.blocks) return;

    const cloned = JSON.parse(JSON.stringify(tpl.blocks));
    function reId(blocks) {
      return blocks.map(b => {
        b.id = State.uid();
        if (b.children) b.children = reId(b.children);
        if (b.items)    b.items    = b.items.map(i => ({ ...i, id: State.uid() }));
        return b;
      });
    }

    const t = State.getAll().find(x => x.id === tab.id);
    if (t) { t.blocks = reId(cloned); State.snapshot(t); }
  }

  /* ── Bootstrap ──────────────────────────────────────────────────────────*/
  Blocks.setupColumns();

  await Storage.ready?.();
  const savedData = await Storage.load();
  if (savedData?.tabs) savedData.tabs.forEach(t => _seenTabIds.add(t.id));
  State.load(savedData);

  _restoreWordDictSettings();
  _restoreClipboardSetting();

  // Restore ninja cursor setting from persisted layout
  if (typeof NinjaCursor !== 'undefined') {
    NinjaCursor.setEnabled(State.getLayout().ninjaCursor === true);
  }

  window._smartListEnabled = State.getLayout().smartList !== false;

  if (State.getLayout().tooltips === false) {
    document.body.classList.add('no-tooltips');
    _applyTooltipState(false);
  }

  setUiSaveBridge(() => scheduleSave());
  syncSettings();

  // Конфигурируем marked: переносы строк + GFM (защита от повторной инициализации)
  if (typeof marked !== 'undefined' && !window.__markedConfiguredOnce) {
    marked.use({ breaks: true, gfm: true, html: false });
    window.__markedConfiguredOnce = true;
  }

  // Превью свёрнуто при старте (#10)
  (() => {
    const panel = $id('preview-panel');
    const btn   = $id('prev-toggle');
    if (panel && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      if (btn) btn.textContent = '▲';
    }
  })();

  if (typeof GistSync !== 'undefined') GistSync.init();
  if (window.MemorySync?.init) window.MemorySync.init();
  if (typeof Anchors !== 'undefined') Anchors.init();
  if (typeof Translator !== 'undefined') Translator.init();
  if (typeof Ember !== 'undefined') Ember.init(null, State.getActive()?.id);

  State.onChange(() => {
    if (typeof Ember !== 'undefined') Ember.switchTab(State.getActive()?.id);
  });

  window.addEventListener('beforeunload', () => Storage.save(State.serialize()));

  /* ══════════════════════════════════════════════════════════════════════
     LLM MODULE
  ══════════════════════════════════════════════════════════════════════ */
  (function initLLM() {
    if (!window.LLMCore || !window.LLMFeatures) return;

    LLMCore.init(State, Storage);
    LLMFeatures.init(State, Storage, LLMCore);

    State.onChange(() => LLMFeatures.renderProfileBar?.());

    onEvent('btn-llm-chat', 'click', e => {
      e.stopPropagation();
      const panel = document.getElementById('llm-chat-panel');
      if (panel && panel.style.display === 'flex') {
        LLMFeatures.MiniChat?.close?.();
      } else {
        LLMFeatures.MiniChat?.open?.();
      }
    });

    const profileBar = $id('llm-profile-bar');
    onEvent('btn-llm-profile', 'click', e => {
      e.stopPropagation();
      closeAllDropdowns(profileBar);
      profileBar?.classList.toggle('open');
    });

    onEvent('llm-profile-menu', 'click', e => {
      const btn = e.target.closest('[data-profile-id]');
      if (!btn) return;
      e.stopPropagation();
      profileBar?.classList.remove('open');
      LLMFeatures.setActiveProfile?.(btn.dataset.profileId);
    });

    onEvent('prev-audit', 'click',    () => LLMFeatures.handleAction('audit'));
    onEvent('prev-compress', 'click', () => LLMFeatures.handleAction('compress'));

    onEvent('llm-modal-close', 'click', () => {
      const m = $id('llm-settings-modal');
      if (m) m.style.display = 'none';
    });

    onEvent('llm-settings-modal', 'click', e => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });
    onEvent('llm-history-modal', 'click', e => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });

    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'l': e.preventDefault(); LLMFeatures.MiniChat?.open?.(); break;
        case 't': e.preventDefault(); LLMFeatures.handleAction('thesaurus'); break;
        case '/': e.preventDefault(); LLMFeatures.AutoPoet?.nextVariant(document.activeElement); break;
      }
    });

    State.onLive(() => {
      const text = Preview.getText?.() ?? '';
      if (text && LLMCore.getCtxPct) LLMCore.updateCtxBadge?.(LLMCore.getCtxPct(text));
    });
  })();

})();
