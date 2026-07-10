// file_name: keyboard-trainer.js
'use strict';

const KeyboardTrainer = (() => {

  // Layout tables: KeyboardEvent.code -> visible letter
  // Standard ANSI 104, all rows including digits and modifiers.

  const LAYOUT_RU = {
    'Backquote':'\u0451',
    'Digit1':'1','Digit2':'2','Digit3':'3','Digit4':'4','Digit5':'5',
    'Digit6':'6','Digit7':'7','Digit8':'8','Digit9':'9','Digit0':'0',
    'Minus':'-','Equal':'=',
    'KeyQ':'\u0439','KeyW':'\u0446','KeyE':'\u0443','KeyR':'\u043a','KeyT':'\u0435',
    'KeyY':'\u043d','KeyU':'\u0433','KeyI':'\u0448','KeyO':'\u0449','KeyP':'\u0437',
    'BracketLeft':'\u0445','BracketRight':'\u044a','Backslash':'\\',
    'KeyA':'\u0444','KeyS':'\u044b','KeyD':'\u0432','KeyF':'\u0430','KeyG':'\u043f',
    'KeyH':'\u0440','KeyJ':'\u043e','KeyK':'\u043b','KeyL':'\u0434','Semicolon':'\u0436',
    'Quote':'\u044d',
    'KeyZ':'\u044f','KeyX':'\u0447','KeyC':'\u0441','KeyV':'\u043c','KeyB':'\u0438',
    'KeyN':'\u0442','KeyM':'\u044c','Comma':'\u0431','Period':'\u044e','Slash':'.',
    'Space':' '
  };

  const LAYOUT_EN = {
    'Backquote':'`',
    'Digit1':'1','Digit2':'2','Digit3':'3','Digit4':'4','Digit5':'5',
    'Digit6':'6','Digit7':'7','Digit8':'8','Digit9':'9','Digit0':'0',
    'Minus':'-','Equal':'=',
    'KeyQ':'q','KeyW':'w','KeyE':'e','KeyR':'r','KeyT':'t',
    'KeyY':'y','KeyU':'u','KeyI':'i','KeyO':'o','KeyP':'p',
    'BracketLeft':'[','BracketRight':']','Backslash':'\\',
    'KeyA':'a','KeyS':'s','KeyD':'d','KeyF':'f','KeyG':'g',
    'KeyH':'h','KeyJ':'j','KeyK':'k','KeyL':'l','Semicolon':';',
    'Quote':"'",
    'KeyZ':'z','KeyX':'x','KeyC':'c','KeyV':'v','KeyB':'b',
    'KeyN':'n','KeyM':'m','Comma':',','Period':'.','Slash':'/',
    'Space':' '
  };

  // Physical codes for home row (left hand, right hand)
  const HOME_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL','Semicolon'];

  // Visual rows for rendering
  const ROWS = [
    [
      {code:'Backquote',w:1},{code:'Digit1',w:1},{code:'Digit2',w:1},{code:'Digit3',w:1},
      {code:'Digit4',w:1},{code:'Digit5',w:1},{code:'Digit6',w:1},{code:'Digit7',w:1},
      {code:'Digit8',w:1},{code:'Digit9',w:1},{code:'Digit0',w:1},{code:'Minus',w:1},
      {code:'Equal',w:1}
    ],
    [
      {code:'KeyQ',w:1},{code:'KeyW',w:1},{code:'KeyE',w:1},{code:'KeyR',w:1},
      {code:'KeyT',w:1},{code:'KeyY',w:1},{code:'KeyU',w:1},{code:'KeyI',w:1},
      {code:'KeyO',w:1},{code:'KeyP',w:1},{code:'BracketLeft',w:1},
      {code:'BracketRight',w:1},{code:'Backslash',w:1}
    ],
    [
      {code:'KeyA',w:1},{code:'KeyS',w:1},{code:'KeyD',w:1},{code:'KeyF',w:1},
      {code:'KeyG',w:1},{code:'KeyH',w:1},{code:'KeyJ',w:1},{code:'KeyK',w:1},
      {code:'KeyL',w:1},{code:'Semicolon',w:1},{code:'Quote',w:1}
    ],
    [
      {code:'KeyZ',w:1},{code:'KeyX',w:1},{code:'KeyC',w:1},{code:'KeyV',w:1},
      {code:'KeyB',w:1},{code:'KeyN',w:1},{code:'KeyM',w:1},{code:'Comma',w:1},
      {code:'Period',w:1},{code:'Slash',w:1}
    ],
    [
      {code:'Space',w:'space'}
    ]
  ];

  // State
  const STORAGE_KEY = 'kb-trainer-state';
  let _enabled = false;
  let _panel = null;
  let _settingsPopup = null;
  let _currentLayout = 'ru';
  let _layoutDetected = false;
  let _showHomeRow = true;
  let _opacity = 0.85;
  let _autoHideDelay = 1500;
  let _keyEls = {};
  let _fontScale = 1;
  let _homeBorderAlpha = 0.6;
  let _homeBorderWidth = 2;
  let _flashAlpha = 0.35;
  let _stayVisible = false;
  let _resizeObserver = null;

  // Long press
  let _longPressTimer = null;
  let _longPressFired = false;
  let _longPressStart = null;
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_THRESHOLD = 10;

  // Auto-hide
  let _autoHideTimer = null;
  let _isForeground = false;

  // Drag / resize
  let _dragging = false;
  let _resizing = false;
  let _dragOffset = { x: 0, y: 0 };
  let _dragBound = false;
  let _resizeStartPos = { x: 0, y: 0 };
  let _resizeStartRect = { w: 0, h: 0 };

  // Persistence
  function _save() {
    try {
      Storage._set(STORAGE_KEY, JSON.stringify({
        enabled: _enabled,
        showHomeRow: _showHomeRow,
        opacity: _opacity,
        autoHideDelay: _autoHideDelay,
        layout: _currentLayout,
        fontScale: _fontScale,
        homeBorderAlpha: _homeBorderAlpha,
        homeBorderWidth: _homeBorderWidth,
        flashAlpha: _flashAlpha,
        stayVisible: _stayVisible
      }));
    } catch(e) { console.warn('[KBTrainer]', e); }
  }

  function _load() {
    try {
      const raw = Storage._get(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      _enabled = !!s.enabled;
      _showHomeRow = s.showHomeRow !== false;
      _opacity = typeof s.opacity === 'number' ? s.opacity : 0.85;
      _autoHideDelay = typeof s.autoHideDelay === 'number' ? s.autoHideDelay : 1500;
      _currentLayout = s.layout === 'en' ? 'en' : 'ru';
      _fontScale = typeof s.fontScale === 'number' ? s.fontScale : 1;
      _homeBorderAlpha = typeof s.homeBorderAlpha === 'number' ? s.homeBorderAlpha : 0.6;
      _homeBorderWidth = typeof s.homeBorderWidth === 'number' ? s.homeBorderWidth : 2;
      _flashAlpha = typeof s.flashAlpha === 'number' ? s.flashAlpha : 0.35;
      _stayVisible = !!s.stayVisible;
    } catch(e) { console.warn('[KBTrainer]', e); }
  }

  // Layout detection
  function _detectLayout(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const ruChar = LAYOUT_RU[e.code];
    const enChar = LAYOUT_EN[e.code];
    if (!ruChar || !enChar) return;
    if (ruChar === enChar) return;
    const actual = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (!actual) return;
    const prev = _currentLayout;
    if (actual === ruChar) _currentLayout = 'ru';
    else if (actual === enChar) _currentLayout = 'en';
    if (_currentLayout !== prev) {
      _layoutDetected = true;
      _updateLangLabel();
      _updateLayoutLabels();
      _save();
    }
  }

  // Chromium getLayoutMap fallback
  async function _tryDetectInitialLayout() {
    if (_layoutDetected) return;
    try {
      if ('keyboard' in navigator && navigator.keyboard && navigator.keyboard.getLayoutMap) {
        const map = await navigator.keyboard.getLayoutMap();
        const keyF = map.get('KeyF');
        if (keyF) {
          const ch = keyF.toLowerCase();
          _currentLayout = ch === '\u0444' ? 'ru' : 'en';
          _layoutDetected = true;
        }
      }
    } catch(e) { /* ignore */ }
    _updateLangLabel();
    _updateLayoutLabels();
  }

  // DOM
  function _buildPanel() {
    if (_panel) return _panel;

    _panel = document.createElement('div');
    _panel.className = 'kb-trainer-panel';
    _panel.innerHTML = [
      '<div class="kb-trainer-bar">',
      '  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="4" width="12" height="8" rx="1.5"/><line x1="5" y1="7" x2="5" y2="7.01"/><line x1="8" y1="7" x2="8" y2="7.01"/><line x1="11" y1="7" x2="11" y2="7.01"/><line x1="5" y1="10" x2="11" y2="10"/></svg>',
      '  <span>\u041a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u0430</span>',
      '  <span class="kb-lang-label">' + (_currentLayout === 'ru' ? 'RU' : 'EN') + '</span>',
      '</div>',
      '<div class="kb-trainer-body"></div>',
      '<div class="kb-trainer-resize">',
      '  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2L2 14"/><path d="M14 8V2H8"/><path d="M14 14H8V8"/></svg>',
      '</div>'
    ].join('\n');

    document.body.appendChild(_panel);

    _renderKeys();
    _initDragResize();
    _applyVisualSettings();
    _setupResizeObserver();

    return _panel;
  }

  function _renderKeys() {
    const body = _panel.querySelector('.kb-trainer-body');
    body.innerHTML = '';
    _keyEls = {};

    ROWS.forEach(function(row) {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      rowEl.dataset.count = row.length;

      row.forEach(function(k) {
        const el = document.createElement('div');
        const isHome = HOME_CODES.includes(k.code);
        el.className = 'kb-key' + (isHome ? ' kb-home' : '') + (k.w === 'space' ? ' kb-space' : '');
        if (isHome && _showHomeRow) el.classList.add('kb-home-highlight');
        el.dataset.code = k.code;

        const layout = _currentLayout === 'ru' ? LAYOUT_RU : LAYOUT_EN;
        el.textContent = layout[k.code] || '';

        rowEl.appendChild(el);
        _keyEls[k.code] = el;
      });

      body.appendChild(rowEl);
    });
  }

  function _updateLangLabel() {
    if (!_panel) return;
    var lbl = _panel.querySelector('.kb-lang-label');
    if (lbl) lbl.textContent = _currentLayout === 'ru' ? 'RU' : 'EN';
  }

  function _updateHomeHighlight() {
    if (!_panel) return;
    HOME_CODES.forEach(function(code) {
      var el = _keyEls[code];
      if (el) el.classList.toggle('kb-home-highlight', _showHomeRow);
    });
  }

  function _updateLayoutLabels() {
    if (!_panel) return;
    var layout = _currentLayout === 'ru' ? LAYOUT_RU : LAYOUT_EN;
    Object.keys(_keyEls).forEach(function(code) {
      _keyEls[code].textContent = layout[code] || '';
    });
  }

  function _applyVisualSettings() {
    if (!_panel) return;
    _panel.style.setProperty('--kb-bg-alpha', _opacity);
    _panel.style.setProperty('--kb-home-border-alpha', _homeBorderAlpha);
    _panel.style.setProperty('--kb-home-border-width', _homeBorderWidth + 'px');
    _panel.style.setProperty('--kb-flash-alpha', _flashAlpha);
    _panel.style.setProperty('--kb-bg-hide-opacity', _stayVisible ? 0.1 : 0);
    _updateFontSize();
  }

  function _updateFontSize() {
    if (!_panel) return;
    var key = _panel.querySelector('.kb-key');
    var keyWidth = key ? key.offsetWidth : 40;
    var size = Math.round(keyWidth * 0.4 * _fontScale);
    _panel.style.setProperty('--kb-font-size', Math.max(9, size) + 'px');
  }

  function _setupResizeObserver() {
    if (_resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    _resizeObserver = new ResizeObserver(function() {
      _updateFontSize();
    });
    _resizeObserver.observe(_panel);
  }

  // Flash on keydown
  function _flashKey(code) {
    var el = _keyEls[code];
    if (!el) return;
    el.classList.add('kb-flash');
    setTimeout(function() { el.classList.remove('kb-flash'); }, 250);
  }

  // Auto-show / auto-hide
  function _show() {
    if (!_panel || !_enabled) return;
    _panel.style.display = 'flex';
    _panel.classList.add('kb-active');
    _panel.classList.remove('kb-background');
    _isForeground = true;
    _scheduleAutoHide();
  }

  function _goBackground() {
    if (!_panel || !_enabled) return;
    _panel.classList.add('kb-background');
    _panel.classList.remove('kb-active');
    _isForeground = false;
  }

  function _scheduleAutoHide() {
    clearTimeout(_autoHideTimer);
    _autoHideTimer = setTimeout(_goBackground, _autoHideDelay);
  }

  function _hide() {
    if (!_panel) return;
    _panel.style.display = 'none';
    _panel.classList.remove('kb-active', 'kb-background');
    _isForeground = false;
    clearTimeout(_autoHideTimer);
  }

  // Event handlers
  function _onKeyDown(e) {
    if (!_enabled) return;
    if (['Shift','Control','Alt','Meta'].includes(e.key)) return;
    _detectLayout(e);
    _flashKey(e.code);
    if (!_isForeground) _show();
    else _scheduleAutoHide();
  }

  function _onMouseMove() {
    if (!_enabled || !_isForeground) return;
    _scheduleAutoHide();
  }

  // Long press (settings open)
  function _setupLongPress(btn) {
    var onStart = function(e) {
      if (e.button && e.button !== 0) return;
      _longPressFired = false;
      _longPressStart = { x: e.clientX, y: e.clientY };
      _longPressTimer = setTimeout(function() {
        _longPressFired = true;
        _openSettings(e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    };

    var onMove = function(e) {
      if (!_longPressStart || _longPressFired) return;
      var dx = e.clientX - _longPressStart.x;
      var dy = e.clientY - _longPressStart.y;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(_longPressTimer);
      }
    };

    var onEnd = function() {
      clearTimeout(_longPressTimer);
      _longPressStart = null;
    };

    btn.addEventListener('pointerdown', onStart);
    btn.addEventListener('pointermove', onMove);
    btn.addEventListener('pointerup', onEnd);
    btn.addEventListener('pointercancel', onEnd);
    btn.addEventListener('pointerleave', onEnd);
  }

  // Drag + Resize (reusing MiniChat pattern)
  function _initDragResize() {
    if (_dragBound) return;
    _dragBound = true;

    var bar = _panel.querySelector('.kb-trainer-bar');
    var handle = _panel.querySelector('.kb-trainer-resize');

    function getClientPos(e) {
      if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function onStart(e, mode) {
      if (mode === 'drag' && e.target.closest('button')) return;
      if (mode === 'drag') {
        _dragging = true;
        var rect = _panel.getBoundingClientRect();
        _dragOffset = {
          x: getClientPos(e).x - rect.left,
          y: getClientPos(e).y - rect.top
        };
      }
      if (mode === 'resize') {
        _resizing = true;
        var rect2 = _panel.getBoundingClientRect();
        var pos = getClientPos(e);
        _resizeStartPos = { x: pos.x, y: pos.y };
        _resizeStartRect = { w: rect2.width, h: rect2.height };
      }
      e.preventDefault();
    }

    if (bar) {
      bar.addEventListener('mousedown', function(e) { onStart(e, 'drag'); });
      bar.addEventListener('touchstart', function(e) { onStart(e, 'drag'); }, { passive: false });
    }
    if (handle) {
      handle.addEventListener('mousedown', function(e) { onStart(e, 'resize'); });
      handle.addEventListener('touchstart', function(e) { onStart(e, 'resize'); }, { passive: false });
    }

    function onMove(e) {
      var pos = getClientPos(e);
      if (_dragging) {
        _panel.style.left = (pos.x - _dragOffset.x) + 'px';
        _panel.style.top = (pos.y - _dragOffset.y) + 'px';
        _panel.style.right = 'auto';
        _panel.style.bottom = 'auto';
      }
      if (_resizing) {
        var dx = pos.x - _resizeStartPos.x;
        var dy = pos.y - _resizeStartPos.y;
        _panel.style.width = Math.max(420, _resizeStartRect.w + dx) + 'px';
        _panel.style.height = Math.max(120, _resizeStartRect.h + dy) + 'px';
      }
    }

    function onEnd() { _dragging = _resizing = false; }

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
  }

  // Settings popup
  function _openSettings(anchorX, anchorY) {
    _closeSettings();

    _settingsPopup = document.createElement('div');
    _settingsPopup.className = 'kb-settings-popup';

    _settingsPopup.innerHTML = [
      '<h4>\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044b</h4>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-home" ' + (_showHomeRow ? 'checked' : '') + '>',
      '    \u041f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0430 \u0434\u043e\u043c\u0430\u0448\u043d\u0435\u0433\u043e \u0440\u044f\u0434\u0430',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0441\u0442\u044c \u0444\u043e\u043d\u0430</label>',
      '  <input type="range" id="kb-set-opacity" min="0" max="100" value="' + Math.round(_opacity * 100) + '">',
      '  <span id="kb-set-opacity-val">' + Math.round(_opacity * 100) + '%</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0420\u0430\u0437\u043c\u0435\u0440 \u0431\u0443\u043a\u0432</label>',
      '  <input type="range" id="kb-set-fontscale" min="50" max="200" value="' + Math.round(_fontScale * 100) + '">',
      '  <span id="kb-set-fontscale-val">' + Math.round(_fontScale * 100) + '%</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0420\u0430\u043c\u043a\u0430 \u0434\u043e\u043c.\u0440\u044f\u0434\u0430</label>',
      '  <input type="range" id="kb-set-homeborder" min="0" max="100" value="' + Math.round(_homeBorderAlpha * 100) + '">',
      '  <span id="kb-set-homeborder-val">' + Math.round(_homeBorderAlpha * 100) + '%</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0412\u0441\u043f\u044b\u0448\u043a\u0430 \u043a\u043b\u0430\u0432\u0438\u0448\u0438</label>',
      '  <input type="range" id="kb-set-flash" min="10" max="100" value="' + Math.round(_flashAlpha * 100) + '">',
      '  <span id="kb-set-flash-val">' + Math.round(_flashAlpha * 100) + '%</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0420\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430</label>',
      '  <select id="kb-set-layout">',
      '    <option value="ru" ' + (_currentLayout === 'ru' ? 'selected' : '') + '>RU</option>',
      '    <option value="en" ' + (_currentLayout === 'en' ? 'selected' : '') + '>EN</option>',
      '  </select>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0410\u0432\u0442\u043e-\u0441\u043a\u0440\u044b\u0442\u0438\u0435</label>',
      '  <input type="range" id="kb-set-delay" min="500" max="5000" step="100" value="' + _autoHideDelay + '">',
      '  <span id="kb-set-delay-val">' + _autoHideDelay + '\u043c\u0441</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-stayvisible" ' + (_stayVisible ? 'checked' : '') + '>',
      '    \u041e\u0441\u0442\u0430\u0432\u0430\u0442\u044c\u0441\u044f \u0432\u0438\u0434\u0438\u043c\u043e\u0439 \u0432 \u0444\u043e\u043d\u0435',
      '  </label>',
      '</div>'
    ].join('\n');

    document.body.appendChild(_settingsPopup);

    var pw = _settingsPopup.offsetWidth || 240;
    var ph = _settingsPopup.offsetHeight || 200;
    var left = anchorX + 10;
    var top = anchorY + 10;
    if (left + pw > window.innerWidth) left = window.innerWidth - pw - 10;
    if (top + ph > window.innerHeight) top = window.innerHeight - ph - 10;
    _settingsPopup.style.left = left + 'px';
    _settingsPopup.style.top = top + 'px';

    _settingsPopup.querySelector('#kb-set-home').addEventListener('change', function(e) {
      _showHomeRow = e.target.checked;
      _updateHomeHighlight();
      _save();
    });

    var opSlider = _settingsPopup.querySelector('#kb-set-opacity');
    var opVal = _settingsPopup.querySelector('#kb-set-opacity-val');
    opSlider.addEventListener('input', function(e) {
      _opacity = parseInt(e.target.value) / 100;
      opVal.textContent = e.target.value + '%';
      _applyVisualSettings();
      _save();
    });

    var fontSlider = _settingsPopup.querySelector('#kb-set-fontscale');
    var fontVal = _settingsPopup.querySelector('#kb-set-fontscale-val');
    fontSlider.addEventListener('input', function(e) {
      _fontScale = parseInt(e.target.value) / 100;
      fontVal.textContent = e.target.value + '%';
      _applyVisualSettings();
      _save();
    });

    var hbSlider = _settingsPopup.querySelector('#kb-set-homeborder');
    var hbVal = _settingsPopup.querySelector('#kb-set-homeborder-val');
    hbSlider.addEventListener('input', function(e) {
      _homeBorderAlpha = parseInt(e.target.value) / 100;
      hbVal.textContent = e.target.value + '%';
      _applyVisualSettings();
      _save();
    });

    var flashSlider = _settingsPopup.querySelector('#kb-set-flash');
    var flashVal = _settingsPopup.querySelector('#kb-set-flash-val');
    flashSlider.addEventListener('input', function(e) {
      _flashAlpha = parseInt(e.target.value) / 100;
      flashVal.textContent = e.target.value + '%';
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-layout').addEventListener('change', function(e) {
      _currentLayout = e.target.value;
      _updateLangLabel();
      _updateLayoutLabels();
      _save();
    });

    var delaySlider = _settingsPopup.querySelector('#kb-set-delay');
    var delayVal = _settingsPopup.querySelector('#kb-set-delay-val');
    delaySlider.addEventListener('input', function(e) {
      _autoHideDelay = parseInt(e.target.value);
      delayVal.textContent = _autoHideDelay + '\u043c\u0441';
      _save();
    });

    _settingsPopup.querySelector('#kb-set-stayvisible').addEventListener('change', function(e) {
      _stayVisible = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    setTimeout(function() {
      document.addEventListener('mousedown', _onSettingsOutsideClick, true);
    }, 0);
  }

  function _closeSettings() {
    if (_settingsPopup) {
      _settingsPopup.remove();
      _settingsPopup = null;
    }
    document.removeEventListener('mousedown', _onSettingsOutsideClick, true);
  }

  function _onSettingsOutsideClick(e) {
    if (_settingsPopup && !_settingsPopup.contains(e.target)) {
      if (!e.target.closest('.kb-trainer-btn')) {
        _closeSettings();
      }
    }
  }

  // Toggle (called from button click)
  function toggle() {
    _enabled = !_enabled;
    _save();
    _updateAllButtons();

    if (_enabled) {
      _buildPanel();
      _show();
      _tryDetectInitialLayout();
      document.addEventListener('keydown', _onKeyDown, true);
      document.addEventListener('mousemove', _onMouseMove, { passive: true });
    } else {
      document.removeEventListener('keydown', _onKeyDown, true);
      document.removeEventListener('mousemove', _onMouseMove);
      _hide();
    }
  }

  function _updateAllButtons() {
    document.querySelectorAll('.kb-trainer-btn').forEach(function(btn) {
      btn.classList.toggle('kb-trainer-active', _enabled);
    });
  }

  function isEnabled() { return _enabled; }

  // Button setup (called from blocks.js)
  function setupButton(btn) {
    btn.addEventListener('click', function(e) {
      if (_longPressFired) { _longPressFired = false; return; }
      e.stopPropagation();
      toggle();
    });

    _setupLongPress(btn);
    btn.classList.toggle('kb-trainer-active', _enabled);
  }

  // Init
  function init() {
    _load();
    if (_enabled) {
      _buildPanel();
      _show();
      document.addEventListener('keydown', _onKeyDown, true);
      document.addEventListener('mousemove', _onMouseMove, { passive: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { toggle: toggle, setupButton: setupButton, isEnabled: isEnabled };
})();
