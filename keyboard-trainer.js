// file_name: keyboard-trainer.js
'use strict';

const KeyboardTrainer = (() => {

  // Layout tables: KeyboardEvent.code -> visible letter
  // Standard ANSI 104, all rows including digits and modifiers.

  const LAYOUT_RU = {
    'Backquote':{base:'\u0451',shift:'\u0401'},
    'Digit1':{base:'1',shift:'!'},'Digit2':{base:'2',shift:'"'},
    'Digit3':{base:'3',shift:'\u2116'},'Digit4':{base:'4',shift:';'},
    'Digit5':{base:'5',shift:'%'},'Digit6':{base:'6',shift:':'},
    'Digit7':{base:'7',shift:'?'},'Digit8':{base:'8',shift:'*'},
    'Digit9':{base:'9',shift:'('},'Digit0':{base:'0',shift:')'},
    'Minus':{base:'-',shift:'_'},'Equal':{base:'=',shift:'+'},
    'KeyQ':{base:'\u0439'},'KeyW':{base:'\u0446'},'KeyE':{base:'\u0443'},
    'KeyR':{base:'\u043a'},'KeyT':{base:'\u0435'},'KeyY':{base:'\u043d'},
    'KeyU':{base:'\u0433'},'KeyI':{base:'\u0448'},'KeyO':{base:'\u0449'},
    'KeyP':{base:'\u0437'},'BracketLeft':{base:'\u0445'},'BracketRight':{base:'\u044a'},
    'Backslash':{base:'\\'},
    'KeyA':{base:'\u0444'},'KeyS':{base:'\u044b'},'KeyD':{base:'\u0432'},
    'KeyF':{base:'\u0430'},'KeyG':{base:'\u043f'},'KeyH':{base:'\u0440'},
    'KeyJ':{base:'\u043e'},'KeyK':{base:'\u043b'},'KeyL':{base:'\u0434'},
    'Semicolon':{base:'\u0436'},'Quote':{base:'\u044d'},
    'KeyZ':{base:'\u044f'},'KeyX':{base:'\u0447'},'KeyC':{base:'\u0441'},
    'KeyV':{base:'\u043c'},'KeyB':{base:'\u0438'},'KeyN':{base:'\u0442'},
    'KeyM':{base:'\u044c'},'Comma':{base:'\u0431'},'Period':{base:'\u044e'},
    'Slash':{base:'.'},'Space':{base:' '}
  };

  const LAYOUT_EN = {
    'Backquote':{base:'`',shift:'~'},
    'Digit1':{base:'1',shift:'!'},'Digit2':{base:'2',shift:'@'},
    'Digit3':{base:'3',shift:'#'},'Digit4':{base:'4',shift:'$'},
    'Digit5':{base:'5',shift:'%'},'Digit6':{base:'6',shift:'^'},
    'Digit7':{base:'7',shift:'&'},'Digit8':{base:'8',shift:'*'},
    'Digit9':{base:'9',shift:'('},'Digit0':{base:'0',shift:')'},
    'Minus':{base:'-',shift:'_'},'Equal':{base:'=',shift:'+'},
    'KeyQ':{base:'q'},'KeyW':{base:'w'},
    'KeyE':{base:'e'},'KeyR':{base:'r'},
    'KeyT':{base:'t'},'KeyY':{base:'y'},
    'KeyU':{base:'u'},'KeyI':{base:'i'},
    'KeyO':{base:'o'},'KeyP':{base:'p'},
    'BracketLeft':{base:'[',shift:'{'},'BracketRight':{base:']',shift:'}'},
    'Backslash':{base:'\\',shift:'|'},
    'KeyA':{base:'a'},'KeyS':{base:'s'},
    'KeyD':{base:'d'},'KeyF':{base:'f'},
    'KeyG':{base:'g'},'KeyH':{base:'h'},
    'KeyJ':{base:'j'},'KeyK':{base:'k'},
    'KeyL':{base:'l'},'Semicolon':{base:';',shift:':'},
    'Quote':{base:"'",shift:'"'},
    'KeyZ':{base:'z'},'KeyX':{base:'x'},
    'KeyC':{base:'c'},'KeyV':{base:'v'},
    'KeyB':{base:'b'},'KeyN':{base:'n'},
    'KeyM':{base:'m'},'Comma':{base:',',shift:'<'},
    'Period':{base:'.',shift:'>'},'Slash':{base:'/',shift:'?'},
    'Space':{base:' '}
  };

  // Physical codes for home row (left hand, right hand)
  const HOME_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL','Semicolon'];

  // Visual rows for rendering (offset: fractional grid offset for physical keyboard shape)
  const ROWS = [
    { offset: 0, keys: [
      {code:'Backquote',w:1},{code:'Digit1',w:1},{code:'Digit2',w:1},{code:'Digit3',w:1},
      {code:'Digit4',w:1},{code:'Digit5',w:1},{code:'Digit6',w:1},{code:'Digit7',w:1},
      {code:'Digit8',w:1},{code:'Digit9',w:1},{code:'Digit0',w:1},{code:'Minus',w:1},
      {code:'Equal',w:1}
    ]},
    { offset: 0.5, keys: [
      {code:'KeyQ',w:1},{code:'KeyW',w:1},{code:'KeyE',w:1},{code:'KeyR',w:1},
      {code:'KeyT',w:1},{code:'KeyY',w:1},{code:'KeyU',w:1},{code:'KeyI',w:1},
      {code:'KeyO',w:1},{code:'KeyP',w:1},{code:'BracketLeft',w:1},
      {code:'BracketRight',w:1},{code:'Backslash',w:1}
    ]},
    { offset: 0.75, keys: [
      {code:'KeyA',w:1},{code:'KeyS',w:1},{code:'KeyD',w:1},{code:'KeyF',w:1},
      {code:'KeyG',w:1},{code:'KeyH',w:1},{code:'KeyJ',w:1},{code:'KeyK',w:1},
      {code:'KeyL',w:1},{code:'Semicolon',w:1},{code:'Quote',w:1}
    ]},
    { offset: 1.25, keys: [
      {code:'KeyZ',w:1},{code:'KeyX',w:1},{code:'KeyC',w:1},{code:'KeyV',w:1},
      {code:'KeyB',w:1},{code:'KeyN',w:1},{code:'KeyM',w:1},{code:'Comma',w:1},
      {code:'Period',w:1},{code:'Slash',w:1}
    ]},
    { offset: 3, keys: [
      {code:'Space',w:'space'}
    ]}
  ];

  // Finger zone mapping for color coding
  const FINGER_MAP = {
    Backquote:'l-pinky',Digit1:'l-pinky',Digit2:'l-ring',Digit3:'l-middle',
    Digit4:'l-index',Digit5:'l-index',Digit6:'r-index',Digit7:'r-index',
    Digit8:'r-middle',Digit9:'r-ring',Digit0:'r-pinky',Minus:'r-pinky',Equal:'r-pinky',
    KeyQ:'l-pinky',KeyW:'l-ring',KeyE:'l-middle',KeyR:'l-index',KeyT:'l-index',
    KeyY:'r-index',KeyU:'r-index',KeyI:'r-middle',KeyO:'r-ring',KeyP:'r-pinky',
    BracketLeft:'r-pinky',BracketRight:'r-pinky',Backslash:'r-pinky',
    KeyA:'l-pinky',KeyS:'l-ring',KeyD:'l-middle',KeyF:'l-index',KeyG:'l-index',
    KeyH:'r-index',KeyJ:'r-index',KeyK:'r-middle',KeyL:'r-ring',
    Semicolon:'r-pinky',Quote:'r-pinky',
    KeyZ:'l-pinky',KeyX:'l-ring',KeyC:'l-middle',KeyV:'l-index',KeyB:'l-index',
    KeyN:'r-index',KeyM:'r-index',Comma:'r-middle',Period:'r-ring',Slash:'r-pinky',
    Space:'thumb'
  };

  // Problem key categories
  const PROBLEM_CODES = {
    rightPinky: new Set([
      'Digit0','Minus','Equal',
      'KeyP','BracketLeft','BracketRight','Backslash',
      'Semicolon','Quote','Slash'
    ]),
    punctuation: new Set([
      'Backquote','Minus','Equal',
      'BracketLeft','BracketRight','Backslash',
      'Semicolon','Quote','Comma','Period','Slash'
    ]),
    digits: new Set([
      'Digit1','Digit2','Digit3','Digit4','Digit5',
      'Digit6','Digit7','Digit8','Digit9','Digit0'
    ])
  };

  // State
  const STORAGE_KEY = 'kb-trainer-state';
  let _enabled = false;
  let _panel = null;
  let _langHandleEl = null;
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
  let _labelColor = '#e0e0e0';
  let _keyBgAlpha = 0.04;
  let _labelAlpha = 1;
  let _mouseThrough = false;
  let _stayVisible = false;
  let _showFingerZones = true;
  let _showShiftedSymbols = false;
  let _ghostMode = false;
  let _slimMode = false;
  let _onScreenMode = false;
  let _problemKeysOnly = false;
  let _focusLayerEnabled = true;
  let _resizeObserver = null;
  let _metricsRaf1 = 0;
  let _metricsRaf2 = 0;
  let _savedBounds = null;

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
        labelColor: _labelColor,
        keyBgAlpha: _keyBgAlpha,
        labelAlpha: _labelAlpha,
        mouseThrough: _mouseThrough,
        stayVisible: _stayVisible,
        showFingerZones: _showFingerZones,
        showShiftedSymbols: _showShiftedSymbols,
        ghostMode: _ghostMode,
        slimMode: _slimMode,
        onScreenMode: _onScreenMode,
        problemKeysOnly: _problemKeysOnly,
        focusLayerEnabled: _focusLayerEnabled,
        panelLeft: _panel ? _panel.style.left : '',
        panelTop: _panel ? _panel.style.top : '',
        panelWidth: _panel ? _panel.style.width : '',
        panelHeight: _panel ? _panel.style.height : ''
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
      _autoHideDelay = Math.max(0, Math.min(30000, _autoHideDelay));
      _currentLayout = s.layout === 'en' ? 'en' : 'ru';
      _fontScale = typeof s.fontScale === 'number' ? s.fontScale : 1;
      _homeBorderAlpha = typeof s.homeBorderAlpha === 'number' ? s.homeBorderAlpha : 0.6;
      _homeBorderWidth = typeof s.homeBorderWidth === 'number' ? s.homeBorderWidth : 2;
      _flashAlpha = typeof s.flashAlpha === 'number' ? s.flashAlpha : 0.35;
      _labelColor = typeof s.labelColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.labelColor) ? s.labelColor : '#e0e0e0';
      _keyBgAlpha = typeof s.keyBgAlpha === 'number' ? Math.max(0, Math.min(1, s.keyBgAlpha)) : 0.04;
      _labelAlpha = typeof s.labelAlpha === 'number' ? Math.max(0, Math.min(1, s.labelAlpha)) : 1;
      _mouseThrough = !!s.mouseThrough;
      _stayVisible = !!s.stayVisible;
      _showFingerZones = s.showFingerZones !== false;
      _showShiftedSymbols = !!s.showShiftedSymbols;
      _ghostMode = !!s.ghostMode;
      _slimMode = !!s.slimMode;
      _onScreenMode = !!s.onScreenMode;
      _problemKeysOnly = !!s.problemKeysOnly;
      _focusLayerEnabled = s.focusLayerEnabled !== false;
      _savedBounds = {
        left: s.panelLeft || '',
        top: s.panelTop || '',
        width: s.panelWidth || '',
        height: s.panelHeight || ''
      };
    } catch(e) { console.warn('[KBTrainer]', e); }
  }

  // Layout detection
  function _detectLayout(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const ruSpec = LAYOUT_RU[e.code];
    const enSpec = LAYOUT_EN[e.code];
    if (!ruSpec || !enSpec) return;
    const ruChar = ruSpec.base || '';
    const enChar = enSpec.base || '';
    if (!ruChar || !enChar || ruChar === enChar) return;
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
      '<div class="kb-lang-handle">' + (_currentLayout === 'ru' ? 'RU' : 'EN') + '</div>',
      '<div class="kb-trainer-body"></div>',
      '<div class="kb-trainer-resize">',
      '  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2L2 14"/><path d="M14 8V2H8"/><path d="M14 14H8V8"/></svg>',
      '</div>'
    ].join('\n');

    document.body.appendChild(_panel);

    _langHandleEl = _panel.querySelector('.kb-lang-handle');
    _setupLangHandleClick();
    _panel.addEventListener('pointerdown', function(e) {
      if (_onScreenMode && !e.target.closest('.kb-trainer-resize') && !e.target.closest('.kb-lang-handle')) {
        e.preventDefault();
      }
    }, { capture: true });
    _renderKeys();
    _updateClickHandlers();
    _initDragResize();
    _applyVisualSettings();
    _setupResizeObserver();
    _applySavedBounds();

    return _panel;
  }

  function _renderKeys() {
    const body = _panel.querySelector('.kb-trainer-body');
    body.innerHTML = '';
    _keyEls = {};

    ROWS.forEach(function(row) {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';

      var startCol = Math.round((row.offset || 0) * 2) + 1;

      row.keys.forEach(function(k, idx) {
        const el = document.createElement('div');
        const isHome = HOME_CODES.includes(k.code);
        const finger = FINGER_MAP[k.code];
        el.className = 'kb-key' + (isHome ? ' kb-home' : '') + (finger ? ' kb-finger-' + finger : '');
        if (isHome && _showHomeRow) el.classList.add('kb-home-highlight');
        el.dataset.code = k.code;

        if (k.w === 'space') {
          el.classList.add('kb-key-space');
          el.style.gridColumn = startCol + ' / span 14';
        } else if (idx === 0 && startCol > 1) {
          el.style.gridColumn = startCol + ' / span 2';
        } else {
          el.style.gridColumn = 'span 2';
        }

        const layout = _currentLayout === 'ru' ? LAYOUT_RU : LAYOUT_EN;
        const spec = layout[k.code] || {};

        if (_showShiftedSymbols && spec.shift) {
          var shiftedEl = document.createElement('span');
          shiftedEl.className = 'kb-key-shifted';
          shiftedEl.textContent = spec.shift;
          el.appendChild(shiftedEl);
        }

        const glyph = document.createElement('span');
        glyph.className = 'kb-key-label';
        glyph.textContent = spec.base || '';
        el.appendChild(glyph);

        rowEl.appendChild(el);
        _keyEls[k.code] = el;
      });

      // On-screen extra keys — explicit grid positions
      if (_onScreenMode) {
        var ek = null;
        if (row === ROWS[0])       ek = { code: 'Backspace', label: '',  col: 27, span: 1, finger: 'l-pinky' };
        else if (row === ROWS[2])  ek = { code: 'Enter',    label: 'Enter', col: 25, span: 3, finger: 'r-pinky' };
        if (ek) {
          var el = document.createElement('div');
          el.className = 'kb-key kb-key-extra kb-finger-' + ek.finger;
          el.dataset.code = ek.code;
          el.style.gridColumn = ek.col + ' / span ' + ek.span;
          var glyph = document.createElement('span');
          glyph.className = 'kb-key-label';
          glyph.textContent = ek.label;
          el.appendChild(glyph);
          rowEl.appendChild(el);
          _keyEls[ek.code] = el;
        }
      }

      body.appendChild(rowEl);
    });
  }

  function _updateLangLabel() {
    if (!_panel) return;
    var lbl = _panel.querySelector('.kb-lang-handle');
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
      var spec = layout[code] || {};
      var label = _keyEls[code].querySelector('.kb-key-label');
      if (label) label.textContent = spec.base || '';
      var shifted = _keyEls[code].querySelector('.kb-key-shifted');
      if (shifted) {
        if (_showShiftedSymbols && spec.shift) {
          shifted.textContent = spec.shift;
          shifted.style.display = '';
        } else {
          shifted.style.display = 'none';
        }
      }
    });
  }

  function _applyVisualSettings() {
    if (!_panel) return;
    _panel.style.setProperty('--kb-bg-alpha', _opacity);
    _panel.style.setProperty('--kb-home-border-alpha', _homeBorderAlpha);
    _panel.style.setProperty('--kb-home-border-width', _homeBorderWidth + 'px');
    _panel.style.setProperty('--kb-flash-alpha', _flashAlpha);
    _panel.style.setProperty('--kb-label-color', _labelColor);
    _panel.style.setProperty('--kb-label-alpha', _labelAlpha);
    _panel.style.setProperty('--kb-key-bg-alpha', _keyBgAlpha);
    _panel.style.setProperty('--kb-bg-hide-opacity', _stayVisible ? 0.1 : 0);
    _panel.classList.toggle('kb-fingers-on', _showFingerZones);
    _panel.classList.toggle('kb-ghost', _ghostMode);
    _panel.classList.toggle('kb-slim', _slimMode);
    _panel.classList.toggle('kb-mouse-through', _mouseThrough && !_onScreenMode);
    _panel.classList.toggle('kb-onscreen', _onScreenMode);
    _panel.classList.toggle('kb-problem-mode', _problemKeysOnly);
    _panel.classList.toggle('kb-focus-layer-on', _focusLayerEnabled);
    _updateFontSize();
    _updateProblemKeys();
  }

  function _updateFontSize() {
    if (!_panel) return;
    var panelWidth = _panel.offsetWidth || 420;
    var bodyPadding = 16;
    var contentWidth = Math.max(100, panelWidth - bodyPadding);
    var keySize = Math.round(contentWidth / 13.5);
    var size = Math.round(keySize * 0.4 * _fontScale);
    _panel.style.setProperty('--kb-font-size', Math.max(9, size) + 'px');
    _panel.style.setProperty('--kb-key-size', Math.max(28, keySize) + 'px');
  }

  function _formatDelay(ms) {
    if (ms <= 0) return '0 c';
    var sec = ms / 1000;
    return (sec % 1 === 0 ? sec.toFixed(0) : sec.toFixed(1)) + ' c';
  }

  function _isProblemKey(code) {
    if (PROBLEM_CODES.rightPinky.has(code)) return true;
    if (PROBLEM_CODES.punctuation.has(code)) return true;
    if (PROBLEM_CODES.digits.has(code)) return true;
    return false;
  }

  function _updateProblemKeys() {
    if (!_panel) return;
    Object.keys(_keyEls).forEach(function(code) {
      var el = _keyEls[code];
      if (el) el.classList.toggle('kb-problem-key', _isProblemKey(code));
    });
  }

  function _setupResizeObserver() {
    if (_resizeObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    _resizeObserver = new ResizeObserver(function() {
      _scheduleMetricsUpdate();
    });
    _resizeObserver.observe(_panel);
    window.addEventListener('resize', function() {
      if (_enabled && _panel) _scheduleMetricsUpdate();
    });
  }

  function _scheduleMetricsUpdate() {
    if (_metricsRaf1 || _metricsRaf2) return;
    _metricsRaf1 = requestAnimationFrame(function() {
      _metricsRaf1 = 0;
      _metricsRaf2 = requestAnimationFrame(function() {
        _metricsRaf2 = 0;
        _updateFontSize();
      });
    });
  }

  function _applySavedBounds() {
    if (!_panel || !_savedBounds) return;
    if (_savedBounds.left) _panel.style.left = _savedBounds.left;
    if (_savedBounds.top) _panel.style.top = _savedBounds.top;
    if (_savedBounds.width) _panel.style.width = _savedBounds.width;
    if (_savedBounds.height) _panel.style.height = _savedBounds.height;
    if (_savedBounds.left || _savedBounds.top) {
      _panel.style.right = 'auto';
      _panel.style.bottom = 'auto';
    }
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
    if (_autoHideDelay <= 0) return;
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

  // ── On-screen keyboard ────────────────────────────────────────

  function _insertChar(ch) {
    var el = _lastFocusedEl || document.activeElement;
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var start = el.selectionStart, end = el.selectionEnd;
      el.setRangeText(ch, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      document.execCommand('insertText', false, ch);
    }
  }

  function _insertKey(code) {
    var el = _lastFocusedEl || document.activeElement;
    if (!el) return;
    if (code === 'Backspace') {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        var start = el.selectionStart, end = el.selectionEnd;
        if (start !== end) {
          el.setRangeText('', start, end, 'end');
        } else if (start > 0) {
          el.setRangeText('', start - 1, start, 'end');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        document.execCommand('delete');
      }
    } else if (code === 'Enter') {
      _insertChar('\n');
    }
  }

  function _getLayout() {
    return _currentLayout === 'en' ? LAYOUT_EN : LAYOUT_RU;
  }

  var _keyLongPressTimers = {};
  var _keyLongPressFired = {};
  var _lastFocusedEl = null;

  function _setupKeyClick(el, code) {
    var _startX = 0, _startY = 0;
    var onDown = function(e) {
      if (e.button && e.button !== 0) return;
      _lastFocusedEl = document.activeElement;
      _keyLongPressFired[code] = false;
      _startX = e.clientX;
      _startY = e.clientY;
      _keyLongPressTimers[code] = setTimeout(function() {
        if (!_onScreenMode) return;
        if (!_isForeground) _show();
        else _scheduleAutoHide();
        _keyLongPressFired[code] = true;
        if (code === 'Backspace' || code === 'Enter') {
          _insertKey(code);
          _flashKey(code);
          if (_lastFocusedEl && _lastFocusedEl.isConnected) _lastFocusedEl.focus();
        } else {
          var spec = _getLayout()[code];
          if (spec) {
            var ch = spec.shift || (spec.base ? spec.base.toUpperCase() : '');
            if (ch) {
              _insertChar(ch);
              _flashKey(code);
              if (_lastFocusedEl && _lastFocusedEl.isConnected) _lastFocusedEl.focus();
            }
          }
        }
      }, LONG_PRESS_MS);
    };
    var onUp = function(e) {
      clearTimeout(_keyLongPressTimers[code]);
      if (_keyLongPressFired[code]) { _keyLongPressFired[code] = false; return; }
      if (!_onScreenMode) return;
      if (!_isForeground) _show();
      else _scheduleAutoHide();
      if (code === 'Backspace' || code === 'Enter') {
        _insertKey(code);
      } else {
        var spec = _getLayout()[code];
        if (spec) _insertChar(spec.base);
      }
      _flashKey(code);
      if (_lastFocusedEl && _lastFocusedEl.isConnected) _lastFocusedEl.focus();
    };
    var onMove = function(e) {
      var dx = e.clientX - _startX, dy = e.clientY - _startY;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(_keyLongPressTimers[code]);
      }
    };
    var onCancel = function() { clearTimeout(_keyLongPressTimers[code]); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('pointerleave', onCancel);
    el.addEventListener('pointermove', onMove);
    el._clickBound = true;
  }

  function _updateClickHandlers() {
    if (!_panel) return;
    Object.keys(_keyEls).forEach(function(code) {
      var el = _keyEls[code];
      if (_onScreenMode && !el._clickBound) {
        _setupKeyClick(el, code);
      }
    });
  }

  function _setupLangHandleClick() {
    if (!_langHandleEl) return;
    _langHandleEl.addEventListener('click', function() {
      if (!_onScreenMode) return;
      _currentLayout = _currentLayout === 'ru' ? 'en' : 'ru';
      _updateLangLabel();
      _updateLayoutLabels();
      _save();
    });
  }

  // Long press (settings open)
  function _setupLongPress(btn) {
    var onStart = function(e) {
      if (e.button && e.button !== 0) return;
      _longPressFired = false;
      var startX = e.clientX;
      var startY = e.clientY;
      _longPressStart = { x: startX, y: startY };
      _longPressTimer = setTimeout(function() {
        _longPressFired = true;
        _openSettings(startX, startY);
      }, LONG_PRESS_MS);
    };

    var onMove = function(e) {
      if (!_longPressStart || _longPressFired) return;
      var dx = e.clientX - _longPressStart.x;
      var dy = e.clientY - _longPressStart.y;
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(_longPressTimer);
        _longPressStart = null;
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

    var bar = _panel.querySelector('.kb-lang-handle');
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
      if (_dragging || _resizing) e.preventDefault();
      var pos = getClientPos(e);
      if (_dragging) {
        var rect = _panel.getBoundingClientRect();
        var nextLeft = Math.max(0, Math.min(window.innerWidth - rect.width, pos.x - _dragOffset.x));
        var nextTop = Math.max(0, Math.min(window.innerHeight - rect.height, pos.y - _dragOffset.y));
        _panel.style.left = nextLeft + 'px';
        _panel.style.top = nextTop + 'px';
        _panel.style.right = 'auto';
        _panel.style.bottom = 'auto';
      }
      if (_resizing) {
        var dx = pos.x - _resizeStartPos.x;
        var dy = pos.y - _resizeStartPos.y;
        var rect2 = _panel.getBoundingClientRect();
        var maxWidth = window.innerWidth - rect2.left;
        var maxHeight = window.innerHeight - rect2.top;
        _panel.style.width = Math.min(maxWidth, Math.max(300, _resizeStartRect.w + dx)) + 'px';
        _panel.style.height = Math.min(maxHeight, Math.max(120, _resizeStartRect.h + dy)) + 'px';
      }
    }

    function onEnd() {
      if (_dragging || _resizing) {
        _save();
        _scheduleMetricsUpdate();
      }
      _dragging = _resizing = false;
    }

    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }

  // Settings popup
  function _openSettings(anchorX, anchorY) {
    _closeSettings();

    _settingsPopup = document.createElement('div');
    _settingsPopup.className = 'kb-settings-popup';

    _settingsPopup.innerHTML = [
      '<h4>\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044b</h4>',
      '<div class="kb-spoiler" id="kb-visual-spoiler">',
      '  <div class="kb-spoiler-header" id="kb-spoiler-toggle">\u0412\u0438\u0437\u0443\u0430\u043b <span class="kb-spoiler-arrow">\u25b6</span></div>',
      '  <div class="kb-spoiler-body" id="kb-spoiler-body">',
      '    <div class="kb-settings-row">',
      '      <label>',
      '        <input type="checkbox" id="kb-set-home" ' + (_showHomeRow ? 'checked' : '') + '>',
      '        \u041f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0430 \u0434\u043e\u043c\u0430\u0448\u043d\u0435\u0433\u043e \u0440\u044f\u0434\u0430',
      '      </label>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d. \u0444\u043e\u043d\u0430</label>',
      '      <input type="range" id="kb-set-opacity" min="0" max="100" value="' + Math.round(_opacity * 100) + '">',
      '      <span id="kb-set-opacity-val">' + Math.round(_opacity * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0420\u0430\u0437\u043c\u0435\u0440 \u0431\u0443\u043a\u0432</label>',
      '      <input type="range" id="kb-set-fontscale" min="50" max="200" value="' + Math.round(_fontScale * 100) + '">',
      '      <span id="kb-set-fontscale-val">' + Math.round(_fontScale * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0426\u0432\u0435\u0442 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432</label>',
      '      <input type="color" id="kb-set-labelcolor" value="' + _labelColor + '">',
      '      <span id="kb-set-labelcolor-val">' + _labelColor + '</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d. \u0431\u0443\u043a\u0432</label>',
      '      <input type="range" id="kb-set-labelalpha" min="0" max="100" value="' + Math.round(_labelAlpha * 100) + '">',
      '      <span id="kb-set-labelalpha-val">' + Math.round(_labelAlpha * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u041f\u0440\u043e\u0437\u0440\u0430\u0447\u043d. \u043a\u043b\u0430\u0432\u0438\u0448</label>',
      '      <input type="range" id="kb-set-keybgalpha" min="0" max="100" value="' + Math.round(_keyBgAlpha * 100) + '">',
      '      <span id="kb-set-keybgalpha-val">' + Math.round(_keyBgAlpha * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0420\u0430\u043c\u043a\u0430 \u0434\u043e\u043c.\u0440\u044f\u0434\u0430</label>',
      '      <input type="range" id="kb-set-homeborder" min="0" max="100" value="' + Math.round(_homeBorderAlpha * 100) + '">',
      '      <span id="kb-set-homeborder-val">' + Math.round(_homeBorderAlpha * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0422\u043e\u043b\u0449. \u0440\u0430\u043c\u043a\u0438</label>',
      '      <input type="range" id="kb-set-homeborder-width" min="0" max="6" step="1" value="' + _homeBorderWidth + '">',
      '      <span id="kb-set-homeborder-width-val">' + _homeBorderWidth + 'px</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0412\u0441\u043f\u044b\u0448\u043a\u0430 \u043a\u043b\u0430\u0432\u0438\u0448\u0438</label>',
      '      <input type="range" id="kb-set-flash" min="10" max="100" value="' + Math.round(_flashAlpha * 100) + '">',
      '      <span id="kb-set-flash-val">' + Math.round(_flashAlpha * 100) + '%</span>',
      '    </div>',
      '    <div class="kb-settings-row">',
      '      <label>\u0420\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430</label>',
      '      <select id="kb-set-layout">',
      '        <option value="ru" ' + (_currentLayout === 'ru' ? 'selected' : '') + '>RU</option>',
      '        <option value="en" ' + (_currentLayout === 'en' ? 'selected' : '') + '>EN</option>',
      '      </select>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>\u0410\u0432\u0442\u043e-\u0441\u043a\u0440\u044b\u0442\u0438\u0435</label>',
      '  <input type="range" id="kb-set-delay" min="0" max="30000" step="500" value="' + _autoHideDelay + '">',
      '  <span id="kb-set-delay-val">' + _formatDelay(_autoHideDelay) + '</span>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-stayvisible" ' + (_stayVisible ? 'checked' : '') + '>',
      '    \u041e\u0441\u0442\u0430\u0432\u0430\u0442\u044c\u0441\u044f \u0432\u0438\u0434\u0438\u043c\u043e\u0439 \u0432 \u0444\u043e\u043d\u0435',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-fingers" ' + (_showFingerZones ? 'checked' : '') + '>',
      '    \u0417\u043e\u043d\u044b \u043f\u0430\u043b\u044c\u0446\u0435\u0432',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-shifted" ' + (_showShiftedSymbols ? 'checked' : '') + '>',
      '    \u0421\u0438\u043c\u0432\u043e\u043b\u044b \u0441\u043e Shift',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-ghost" ' + (_ghostMode ? 'checked' : '') + '>',
      '    \u0420\u0435\u0436\u0438\u043c \u043f\u0440\u0438\u0437\u0440\u0430\u043a\u0430',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-slim" ' + (_slimMode ? 'checked' : '') + '>',
      '    Slim',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-onscreen" ' + (_onScreenMode ? 'checked' : '') + '>',
      '    \u042d\u043a\u0440\u0430\u043d\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-problem" ' + (_problemKeysOnly ? 'checked' : '') + '>',
      '    \u0422\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u043e\u0431\u043b\u0435\u043c\u043d\u044b\u0435',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-focuslayer" ' + (_focusLayerEnabled ? 'checked' : '') + '>',
      '    \u0424\u043e\u043a\u0443\u0441\u043d\u044b\u0439 \u0441\u043b\u043e\u0439',
      '  </label>',
      '</div>',
      '<div class="kb-settings-row">',
      '  <label>',
      '    <input type="checkbox" id="kb-set-mousethrough" ' + (_mouseThrough ? 'checked' : '') + '>',
      '    \u041f\u0440\u043e\u043f\u0443\u0441\u043a \u043a\u043b\u0438\u043a\u043e\u0432',
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

    // Spoiler toggle
    var spoilerToggle = _settingsPopup.querySelector('#kb-spoiler-toggle');
    var spoilerBody = _settingsPopup.querySelector('#kb-spoiler-body');
    if (spoilerToggle && spoilerBody) {
      spoilerToggle.addEventListener('click', function() {
        var open = spoilerBody.classList.toggle('kb-spoiler-open');
        spoilerToggle.querySelector('.kb-spoiler-arrow').textContent = open ? '\u25bc' : '\u25b6';
      });
    }

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

    var labelColorInput = _settingsPopup.querySelector('#kb-set-labelcolor');
    var labelColorVal = _settingsPopup.querySelector('#kb-set-labelcolor-val');
    labelColorInput.addEventListener('input', function(e) {
      _labelColor = e.target.value;
      labelColorVal.textContent = _labelColor;
      _applyVisualSettings();
      _save();
    });

    var labelAlphaSlider = _settingsPopup.querySelector('#kb-set-labelalpha');
    var labelAlphaVal = _settingsPopup.querySelector('#kb-set-labelalpha-val');
    labelAlphaSlider.addEventListener('input', function(e) {
      _labelAlpha = parseInt(e.target.value, 10) / 100;
      labelAlphaVal.textContent = e.target.value + '%';
      _applyVisualSettings();
      _save();
    });

    var keyBgAlphaSlider = _settingsPopup.querySelector('#kb-set-keybgalpha');
    var keyBgAlphaVal = _settingsPopup.querySelector('#kb-set-keybgalpha-val');
    keyBgAlphaSlider.addEventListener('input', function(e) {
      _keyBgAlpha = parseInt(e.target.value, 10) / 100;
      keyBgAlphaVal.textContent = e.target.value + '%';
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

    var hbWidthSlider = _settingsPopup.querySelector('#kb-set-homeborder-width');
    var hbWidthVal = _settingsPopup.querySelector('#kb-set-homeborder-width-val');
    hbWidthSlider.addEventListener('input', function(e) {
      _homeBorderWidth = parseInt(e.target.value);
      hbWidthVal.textContent = _homeBorderWidth + 'px';
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
      _autoHideDelay = parseInt(e.target.value, 10);
      delayVal.textContent = _formatDelay(_autoHideDelay);
      _save();
    });

    _settingsPopup.querySelector('#kb-set-stayvisible').addEventListener('change', function(e) {
      _stayVisible = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-fingers').addEventListener('change', function(e) {
      _showFingerZones = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-shifted').addEventListener('change', function(e) {
      _showShiftedSymbols = e.target.checked;
      _renderKeys();
      _updateClickHandlers();
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-ghost').addEventListener('change', function(e) {
      _ghostMode = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-slim').addEventListener('change', function(e) {
      _slimMode = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-onscreen').addEventListener('change', function(e) {
      _onScreenMode = e.target.checked;
      _renderKeys();
      _updateClickHandlers();
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-problem').addEventListener('change', function(e) {
      _problemKeysOnly = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-focuslayer').addEventListener('change', function(e) {
      _focusLayerEnabled = e.target.checked;
      _applyVisualSettings();
      _save();
    });

    _settingsPopup.querySelector('#kb-set-mousethrough').addEventListener('change', function(e) {
      _mouseThrough = e.target.checked;
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
      if (_longPressFired) {
        _longPressFired = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
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
      _tryDetectInitialLayout();
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
