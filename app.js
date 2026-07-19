// file_name: app.js

(async function main() {
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

  let _renderQueued = false;
  function queueFullRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
      _renderQueued = false;
      fullRender();
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

    const optSpellCheck = $id('opt-spell-check');
    if (optSpellCheck) optSpellCheck.checked = lay.spellCheck === true;
    const spellStatus = $id('spell-check-status');
    if (spellStatus) spellStatus.textContent = lay.spellCheck ? 'Текст отправляется на speller.yandex.net' : '';

    // TextSkeletonizer settings
    const skeletonLevel = $id('opt-skeleton-level');
    if (skeletonLevel) skeletonLevel.value = lay.skeletonLevel || 'auto';
    const skeletonWorker = $id('opt-skeleton-worker');
    if (skeletonWorker) skeletonWorker.checked = lay.skeletonWorker !== false;

    const optEmojiPicker = $id('opt-emoji-picker');
    if (optEmojiPicker) optEmojiPicker.checked = lay.emojiPicker !== false;
  }

  State.onChange(queueFullRender);
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
  onClick('btn-export-tab', exportCurrentTab);

  /* ── Long-press for export buttons ──────────────────────────── */
  (function setupExportLongPress() {
    let _lpTimer = null;
    function _makeLP(el, onLong) {
      let started = false, triggered = false;
      const start = () => { started = true; triggered = false; clearTimeout(_lpTimer); _lpTimer = setTimeout(() => { if (started) { triggered = true; onLong(); } }, 400); };
      const stop = () => { started = false; clearTimeout(_lpTimer); };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
      return () => triggered;
    }

    function _gatherTabText(tab) {
      const blocks = tab?.blocks || [];
      return blocks.map(b => {
        if (b.type !== 'text') return '';
        const sub = b.subtabs?.[b.activeSubtab ?? 0];
        return sub?.value || '';
      }).filter(Boolean).join('\n\n');
    }

    function _gatherAllText() {
      return (State.getAll() || []).map(t => _gatherTabText(t)).filter(Boolean).join('\n\n');
    }

    function _doExportJson(data, name) {
      const safeName = (name || 'export').replace(/[/\\:*?"<>|]/g, '_').slice(0, 60);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: safeName + '.json' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      Toast.show('Файл экспортирован ✓', 'success');
    }

    const btnAll = $id('btn-export');
    if (btnAll) {
      const isLongAll = _makeLP(btnAll, async () => {
        const allText = _gatherAllText();
        if (!allText) { Toast.show('Нет данных для экспорта', 'info'); return; }
        window.Blocks?._showExportNamePopup?.(btnAll, allText, 'Все вкладки', name => {
          const data = State.serialize();
          _doExportJson(data, name);
        });
      });
      btnAll.addEventListener('click', e => { if (isLongAll()) { e.stopPropagation(); e.preventDefault(); } });
    }

    const btnTab = $id('btn-export-tab');
    if (btnTab) {
      const isLongTab = _makeLP(btnTab, async () => {
        const tab = State.getActive();
        if (!tab) return;
        const tabText = _gatherTabText(tab);
        if (!tabText) { Toast.show('Нет данных для экспорта', 'info'); return; }
        window.Blocks?._showExportNamePopup?.(btnTab, tabText, tab.name || 'Вкладка', name => {
          const exported = JSON.parse(JSON.stringify(tab));
          delete exported.history;
          delete exported.historyIdx;
          _doExportJson({ tabs: [exported] }, name);
        });
      });
      btnTab.addEventListener('click', e => { if (isLongTab()) { e.stopPropagation(); e.preventDefault(); } });
    }
  })();
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

  /* ── Close ALL menus (dropdowns + palettes) ────────────────────────────*/
  function closeAllMenus(except) {
    document.querySelectorAll('.ui-menu.open').forEach(d => {
      if (d !== except) d.classList.remove('open');
    });
    document.querySelectorAll('.ui-menu[style*="display: block"], .ui-menu[style*="display:block"]').forEach(d => {
      if (d !== except) d.style.display = 'none';
    });
    if (!except || !except.classList?.contains('pl-palette')) {
      document.dispatchEvent(new Event('close-all-palettes'));
    }
  }
  window.closeAllMenus = closeAllMenus;

  /* ── Add-block dropdown ─────────────────────────────────────────────────*/
  const addDd = $id('add-dropdown');
  onClick('btn-add-block', e => {
    e.stopPropagation();
    closeAllMenus(addDd);
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
    closeAllMenus(tplDd);
    tplDd?.classList.toggle('open');
  });

  /* ── Settings dropdown ──────────────────────────────────────────────────*/
  onClick('btn-settings', e => {
    e.stopPropagation();
    const sd = $id('settings-dropdown');
    closeAllMenus(sd);
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

  const WC_EFFECT_MIN_MS  = 1000;
  const WC_EFFECT_MAX_MS  = 10000;
  const WC_EFFECT_STEP_MS = 50;

  const optWcEffectMs = $id('opt-wc-effect-ms-misc');
  if (optWcEffectMs) optWcEffectMs.onchange = e => {
    const raw = parseInt(e.target.value, 10);
    if (!Number.isFinite(raw)) return;

    const v = Math.max(WC_EFFECT_MIN_MS, Math.min(WC_EFFECT_MAX_MS, Math.round(raw / WC_EFFECT_STEP_MS) * WC_EFFECT_STEP_MS));
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
      const pk = $id('opt-current-line-color-picker');
      if (pk) {
        const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) pk.value = '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
      }
      scheduleSave();
    };
    optCurrentLineColor.oninput = saveLineColor;
    optCurrentLineColor.onchange = saveLineColor;
  }

  const optLineColorPicker = $id('opt-current-line-color-picker');
  if (optLineColorPicker) {
    const syncPickerFromText = () => {
      const raw = optCurrentLineColor?.value || '';
      const m = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) optLineColorPicker.value = '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
    };
    syncPickerFromText();
    optLineColorPicker.oninput = e => {
      const hex = e.target.value;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const rgba = `rgba(${r},${g},${b},0.18)`;
      if (optCurrentLineColor) { optCurrentLineColor.value = rgba; optCurrentLineColor.dispatchEvent(new Event('change', { bubbles: true })); }
    };
  }

  const optEmojiPicker = $id('opt-emoji-picker');
  if (optEmojiPicker) optEmojiPicker.onchange = e => {
    State.setLayout({ emojiPicker: e.target.checked });
    scheduleSave();
  };

  const optSpellCheck = $id('opt-spell-check');
  if (optSpellCheck) optSpellCheck.onchange = e => {
    const enabled = e.target.checked;
    State.setLayout({ spellCheck: enabled });
    const st = $id('spell-check-status');
    if (st) st.textContent = enabled ? 'Текст отправляется на speller.yandex.net' : '';
    if (!enabled && typeof SpellCheck !== 'undefined') SpellCheck.clearCache();
    scheduleSave();
    Toast.show(enabled ? 'Проверка орфографии включена' : 'Проверка орфографии выключена', 'success');
  };

  /* ── TextSkeletonizer settings ─────────────────────────────────────── */
  const optSkeletonLevel = $id('opt-skeleton-level');
  if (optSkeletonLevel) optSkeletonLevel.onchange = e => {
    State.setLayout({ skeletonLevel: e.target.value });
    scheduleSave();
    const labels = { off: 'Выключено', light: 'Лёгкое', medium: 'Среднее', aggressive: 'Полное', auto: 'Авто' };
    Toast.show(`Сжатие текста: ${labels[e.target.value] || e.target.value}`, 'success');
  };

  const optSkeletonWorker = $id('opt-skeleton-worker');
  if (optSkeletonWorker) optSkeletonWorker.onchange = e => {
    State.setLayout({ skeletonWorker: e.target.checked });
    scheduleSave();
  };

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

  if (typeof QRPanel !== 'undefined') {
    const _previewProxy = {
      get value() { return Preview.getText?.() ?? ''; },
      selectionStart: 0,
      selectionEnd: 0,
    };
    onClick('prev-qr', () => QRPanel.open(_previewProxy));
  }

  onEvent('preview-bar', 'dblclick', e => {
    if (e.target.closest('button, .preview-controls')) return;
    Preview.toggleCollapse();
  });

  onClick('prev-download', () => {
    const text = Preview.getText();
    if (!text) { Toast.show('Превью пустое — нечего скачивать', 'error'); return; }

    const tab = State.getActive();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    Object.assign(document.createElement('a'), {
      href:     url,
      download: (tab?.name ?? 'prompt') + '.txt',
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    Toast.show('Экспортировано ' + allTabs.length + ' вкладок ✓', 'success');
    window.Intelligence?.track?.('preview.exportAll', {
      tabs: allTabs.length,
      chars: md.length
    });
  });

  /* ── Hotkeys ────────────────────────────────────────────────────────────*/
  document.addEventListener('keydown', e => {
    const k       = e.code;
    const ctrl    = e.ctrlKey || e.metaKey;
    const shift   = e.shiftKey;
    const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

    // Не перехватываем нативные хоткеи редактирования в полях ввода
    if (inField && ctrl && ['KeyZ', 'KeyY', 'KeyT', 'KeyW'].includes(k)) return;

    if      (ctrl && !shift && k === 'KeyZ') { e.preventDefault(); State.undo(); }
    else if (ctrl && (k === 'KeyY' || (shift && k === 'KeyZ'))) { e.preventDefault(); State.redo(); }
    else if (ctrl && k === 'KeyS') {
      e.preventDefault();
      Storage.save(State.serialize());
      window.Intelligence?.track?.('state.save');
      if (typeof GistSync !== 'undefined') {
        GistSync.onSaveTrigger();
      } else {
        Toast.show('Сохранено ✓', 'success');
      }
    }
    else if (ctrl && k === 'KeyT') { e.preventDefault(); State.newTab(); }
    else if (ctrl && k === 'KeyW') { e.preventDefault(); const t = State.getActive(); if (t) State.closeTab(t.id); }
    else if (ctrl && shift && k === 'KeyC') { e.preventDefault(); Preview.copy(); }
    else if (ctrl && k === 'KeyD' && !inField) {
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

    // AiTransform: Ctrl+K — AI трансформация выделенного текста
    else if (ctrl && k === 'KeyK') {
      e.preventDefault();
      if (typeof AiTransform !== 'undefined') {
        const ta = document.activeElement;
        if (ta && ta.tagName === 'TEXTAREA') AiTransform.openForSelection(ta);
        else Toast.show('Выделите текст в блоке', 'error');
      }
    }

    // Полезная UI-функция: Escape закрывает открытые меню/панели/модалки
    else if (e.key === 'Escape') {
      document.querySelectorAll('.dropdown.open, .open').forEach(el => {
        if (el.id === 'workspace' || el.tagName === 'BODY') return;
        if (el.classList.contains('open')) el.classList.remove('open');
      });
      document.dispatchEvent(new Event('close-all-palettes'));
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
      closeAllMenus(dropdown);
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
        State.setLayout({ columnCount: count, rightColHidden: false, colRatios: null });
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
    let _colRafId = null;
    let _colPendingDx = 0;

    document.addEventListener('mousedown', e => {
      const r = e.target.closest('.col-resizer');
      if (!r) return;
      e.preventDefault();
      activeResizer = r;
      startX = e.clientX;
      const cols = Array.from(ws.querySelectorAll('.column')).filter(c => c.style.display !== 'none');
      startWidths = cols.map(c => c.getBoundingClientRect().width);
      r.classList.add('active');
      document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', e => {
      if (!activeResizer) return;
      _colPendingDx = e.clientX - startX;
      if (_colRafId) return;
      _colRafId = requestAnimationFrame(() => {
        _colRafId = null;
        const cols = Array.from(ws.querySelectorAll('.column')).filter(c => c.style.display !== 'none');
        const resizers = Array.from(ws.querySelectorAll('.col-resizer'));
        const rIdx = resizers.indexOf(activeResizer);
        if (rIdx < 0 || rIdx >= cols.length - 1) return;
        const dx = _colPendingDx;
        const leftW = Math.max(80, startWidths[rIdx] + dx);
        const rightW = Math.max(80, startWidths[rIdx + 1] - dx);
        const newWidths = startWidths.map((w, i) => {
          if (i === rIdx) return leftW;
          if (i === rIdx + 1) return rightW;
          return w;
        });
        const total = newWidths.reduce((a, b) => a + b, 0);
        const ratios = newWidths.map(w => Math.round((w / total) * 1000));
        Blocks.applyLayout(ratios);
        activeResizer._pendingRatios = ratios;
      });
    });

    document.addEventListener('mouseup', () => {
      if (!activeResizer) return;
      activeResizer.classList.remove('active');
      if (activeResizer._pendingRatios) Blocks.applyLayout(activeResizer._pendingRatios);
      const ratios = activeResizer._pendingRatios;
      activeResizer = null;
      document.body.style.cursor = '';
      if (ratios) {
        State.setLayout({ colRatios: ratios });
        scheduleSave();
      }
    });
  })();

  /* ── Preview resizer ────────────────────────────────────────────────────*/
  (() => {
    const resizer = $id('preview-resizer');
    const panel   = $id('preview-panel');
    if (!resizer || !panel) return;

    let dragging = false, startY = 0, startH = 0;
    let _prevRafId = null;
    let _prevPendingDy = 0;

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
      _prevPendingDy = startY - e.clientY;
      if (_prevRafId) return;
      _prevRafId = requestAnimationFrame(() => {
        _prevRafId = null;
        const h = Math.max(60, Math.min(window.innerHeight * 0.7, startH + _prevPendingDy));
        panel.style.height = h + 'px';
        State.setLayout({ previewHeight: h });
      });
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (_prevRafId) { cancelAnimationFrame(_prevRafId); _prevRafId = null; }
      // Apply final position from last mousemove
      const h = Math.max(60, Math.min(window.innerHeight * 0.7, startH + _prevPendingDy));
      panel.style.height = h + 'px';
      State.setLayout({ previewHeight: h });
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
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    Toast.show('Файл экспортирован ✓', 'success');
    window.Intelligence?.track?.('file.export', {
      tabs: State.getAll().length
    });
  }

  function exportCurrentTab() {
    const tab = State.getActive();
    if (!tab) { Toast.show('Нет активной вкладки', 'error'); return; }
    const exported = JSON.parse(JSON.stringify(tab));
    delete exported.history;
    delete exported.historyIdx;
    const data = { tabs: [exported] };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const name = (tab.name || 'tab').replace(/[^\wа-яА-ЯёЁ-]/gi, '_').slice(0, 40);
    Object.assign(document.createElement('a'), {
      href:     url,
      download: name + '-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json',
    }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    Toast.show('Вкладка «' + (tab.name || 'Без имени') + '» экспортирована ✓', 'success');
    window.Intelligence?.track?.('file.exportTab', { blocks: (tab.blocks || []).length });
  }

  let _importBusy = false;
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

  function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (_importBusy) { Toast.show('Импорт уже выполняется…', 'error'); return; }
    if (file.size > MAX_IMPORT_BYTES) {
      Toast.show('Файл слишком большой (макс. 10 МБ)', 'error');
      return;
    }
    _importBusy = true;

    const reader = new FileReader();
    reader.onload = ev => {
      _importBusy = false;
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.tabs || !Array.isArray(data.tabs) || !data.tabs.length) throw new Error('Неверный формат файла');

        if (data.tabs.length === 1) {
          // Single tab — add to existing tabs, preserve current settings
          const incoming = JSON.parse(JSON.stringify(data.tabs[0]));
          const existing = State.getAll();
          const dup = existing.find(t => t.name === incoming.name);
          if (dup) incoming.name = incoming.name + ' (импорт)';
          const idMap = {};
          incoming.id = State.uid();
          incoming.blocks = (incoming.blocks || []).map(b => {
            const oldId = b.id;
            b.id = State.uid();
            idMap[oldId] = b.id;
            return b;
          });
          incoming.history = { base: null, deltas: [] };
          incoming.historyIdx = -1;
          incoming.namedSnapshots = [];
          incoming.anchors = (incoming.anchors || []).map(a => {
            if (a.blockId && idMap[a.blockId]) a.blockId = idMap[a.blockId];
            return a;
          });
          existing.push(incoming);
          // Preserve current layout and settings
          State.load({ tabs: existing, layout: State.getLayout(), activeTabId: incoming.id });
          Storage.save(State.serialize());
          Toast.show('Вкладка «' + (incoming.name || 'Без имени') + '» добавлена ✓', 'success');
        } else {
          // Multiple tabs — replace all (with confirm)
          if (!confirm('Заменить все ' + existingTabsCount() + ' вкладок на ' + data.tabs.length + ' из файла?')) return;
          // Auto-backup current state before destructive import
          try {
            const backup = JSON.stringify(State.serialize());
            localStorage.setItem('import-backup-pre-' + Date.now(), backup);
            const backupKeys = Object.keys(localStorage)
              .filter(k => k.startsWith('import-backup-pre-'))
              .sort();
            while (backupKeys.length > 3) localStorage.removeItem(backupKeys.shift());
          } catch (_) { /* quota exceeded — proceed anyway */ }
          State.load(data);
          Storage.save(State.serialize());
          Toast.show('Импортировано ' + data.tabs.length + ' вкладок ✓', 'success');
        }
      } catch (err) {
        Toast.show('Ошибка импорта: ' + err.message, 'error');
        console.error('Import failed:', err);
      }
    };
    reader.onerror = () => {
      _importBusy = false;
      Toast.show('Не удалось прочитать файл', 'error');
    };
    reader.readAsText(file);
  }

  function existingTabsCount() { return State.getAll().length; }

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

  // SpellCheck init
  if (typeof SpellCheck !== 'undefined') SpellCheck.init(State);

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
  if (typeof AiTransform !== 'undefined') AiTransform.init(State, LLMCore);
  if (typeof TextExpander !== 'undefined') TextExpander.init();

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
      closeAllMenus(profileBar);
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
    onEvent('prev-mindmap', 'click',  () => MindMap?.open());
    onEvent('prev-flowchart', 'click', () => Flowchart?.open());

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
      switch (e.code) {
        case 'KeyL': e.preventDefault(); LLMFeatures.MiniChat?.open?.(); break;
        case 'KeyT': e.preventDefault(); LLMFeatures.handleAction('thesaurus'); break;
        case 'Slash': e.preventDefault(); LLMFeatures.AutoPoet?.nextVariant(document.activeElement); break;
      }
    });

    State.onLive(() => {
      const text = Preview.getText?.() ?? '';
      if (text && LLMCore.getCtxPct) LLMCore.updateCtxBadge?.(LLMCore.getCtxPct(text));
    });
  })();

})().catch(err => {
  console.error('[app] Bootstrap failed:', err);
  document.body.innerHTML =
    '<pre style="padding:2rem;color:#c00;white-space:pre-wrap">'
    + 'Ошибка запуска приложения:\n' + (err?.message ?? err) + '</pre>';
});
