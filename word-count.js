// file_name: word-count.js

/* ============================================================
   Word Count — floating statistics popup
   ============================================================ */
const WordCount = (() => {
  'use strict';

  let _popup = null;
  let _btn = null;
  let _ta = null;
  let _isOpen = false;
  let _pinned = localStorage.getItem('wc-pinned') === 'true';
  let _updateTimer = null;
  let _lastSourceText = '';
  let _lastSel = '';
  let _rowValueEls = new Map();

  /* ---- drag state ---- */
  let _dragging = false;
  let _dragOffset = { x: 0, y: 0 };

  /* ---- row definitions ---- */
  const _ROW_DEFS = [
    { label: 'Символы',      stat: 'chars' },
    { label: 'Без пробелов', stat: 'charsNoSpaces' },
    { label: 'Предложения',  stat: 'sentences' },
    { label: 'Абзацы',       stat: 'paragraphs' },
    { label: 'Время чтения', stat: 'readingTime' },
  ];

  /* ---- stats computation ---- */
  function computeStats(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const sentences = text.trim()
      ? (text.match(/[.!?]+(?:\s|$)/g) || []).length || (text.trim() ? 1 : 0)
      : 0;
    const paragraphs = text.trim()
      ? text.split(/\n\s*\n/).filter(s => s.trim()).length || 1
      : 0;
    const readingMinutes = Math.ceil(words / 200);
    const readingTime = words < 200 ? '< 1 мин' : readingMinutes + ' мин';
    return { words, chars, charsNoSpaces, sentences, paragraphs, readingTime };
  }

  /* ---- determine source text ---- */
  function _getSourceText() {
    if (!_ta) return '';
    const s = _ta.selectionStart;
    const e = _ta.selectionEnd;
    if (s !== e) return _ta.value.substring(s, e);
    return _ta.value;
  }

  /* ---- build skeleton rows (once) ---- */
  function _buildRowsSkeleton() {
    const rows = _popup.querySelector('.wc-rows');
    if (!rows) return;
    rows.textContent = '';
    _rowValueEls.clear();
    for (const def of _ROW_DEFS) {
      const row = document.createElement('div');
      row.className = 'wc-row';
      const lbl = document.createElement('span');
      lbl.className = 'wc-label';
      lbl.textContent = def.label;
      const val = document.createElement('span');
      val.className = 'wc-value';
      val.textContent = '0';
      row.append(lbl, val);
      rows.appendChild(row);
      _rowValueEls.set(def.stat, val);
    }
  }

  /* ---- render (diff-update, textContent only) ---- */
  function _render() {
    if (!_popup || !_ta || !_ta.isConnected) return;
    const src = _getSourceText();
    if (src === _lastSourceText) return;
    _lastSourceText = src;

    if (!_rowValueEls.size) _buildRowsSkeleton();
    const stats = computeStats(src);

    const wordsEl = _popup.querySelector('.wc-words-value');
    if (wordsEl) wordsEl.textContent = stats.words;

    for (const def of _ROW_DEFS) {
      const el = _rowValueEls.get(def.stat);
      if (el) el.textContent = stats[def.stat];
    }
  }

  /* ---- schedule update ---- */
  function _scheduleUpdate() {
    clearTimeout(_updateTimer);
    _updateTimer = setTimeout(_render, 80);
  }

  /* ---- clamp position to viewport ---- */
  function _clampPosition() {
    if (!_popup) return;
    const r = _popup.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.round(r.left);
    let top = Math.round(r.top);
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + r.width > vw) left = Math.max(0, Math.round(vw - r.width));
    if (top + r.height > vh) top = Math.max(0, Math.round(vh - r.height));
    _popup.style.left = left + 'px';
    _popup.style.top = top + 'px';
  }

  /* ---- create popup DOM ---- */
  function _createPopup() {
    if (_popup) return _popup;

    _popup = document.createElement('div');
    _popup.className = 'wc-popup';
    _popup.setAttribute('role', 'dialog');
    _popup.setAttribute('aria-label', 'Подсчёт слов');

    // restore position
    const saved = localStorage.getItem('wc-popup-pos');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        _popup.style.left = p.x + 'px';
        _popup.style.top = p.y + 'px';
      } catch (_) {}
    }
    if (!_popup.style.left) {
      _popup.style.right = '20px';
      _popup.style.bottom = '80px';
    }

    // words block (hero) — pin lives inside for drag guard
    const wordsBlock = document.createElement('div');
    wordsBlock.className = 'wc-words-block';
    wordsBlock.style.cursor = 'grab';

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'wc-pin';
    pin.title = _pinned ? 'Открепить окно' : 'Закрепить окно';
    pin.textContent = '\uD83D\uDCCC';
    if (_pinned) pin.classList.add('active');
    pin.onclick = e => {
      e.stopPropagation();
      _pinned = !_pinned;
      localStorage.setItem('wc-pinned', String(_pinned));
      pin.classList.toggle('active', _pinned);
      pin.title = _pinned ? 'Открепить окно' : 'Закрепить окно';
    };

    const wordsLabel = document.createElement('div');
    wordsLabel.className = 'wc-words-label';
    wordsLabel.textContent = 'Слова';
    const wordsVal = document.createElement('div');
    wordsVal.className = 'wc-words-value';
    wordsVal.textContent = '0';
    wordsVal.setAttribute('aria-live', 'polite');
    wordsBlock.append(pin, wordsLabel, wordsVal);
    _popup.appendChild(wordsBlock);

    // rows container
    const rows = document.createElement('div');
    rows.className = 'wc-rows';
    _popup.appendChild(rows);

    // drag — guard: skip if click started on pin
    wordsBlock.addEventListener('mousedown', e => {
      if (e.target === pin || pin.contains(e.target)) return;
      _dragging = true;
      const rect = _popup.getBoundingClientRect();
      _dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wordsBlock.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!_dragging || !_popup) return;
      let left = e.clientX - _dragOffset.x;
      let top = e.clientY - _dragOffset.y;
      const pw = _popup.offsetWidth;
      const ph = _popup.offsetHeight;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + pw > window.innerWidth) left = window.innerWidth - pw;
      if (top + ph > window.innerHeight) top = window.innerHeight - ph;
      _popup.style.left = left + 'px';
      _popup.style.top = top + 'px';
      _popup.style.right = 'auto';
      _popup.style.bottom = 'auto';
    }, { passive: true });

    document.addEventListener('mouseup', () => {
      if (_dragging) {
        _dragging = false;
        if (_popup) wordsBlock.style.cursor = 'grab';
        _savePosition();
      }
    });

    document.body.appendChild(_popup);
    _popup.style.display = 'none';
    return _popup;
  }

  function _savePosition() {
    if (!_popup) return;
    const rect = _popup.getBoundingClientRect();
    localStorage.setItem('wc-popup-pos', JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
  }

  /* ---- open / close ---- */
  function open(ta) {
    _ta = ta;
    _createPopup();
    _popup.style.display = 'block';
    _clampPosition();
    _isOpen = true;
    _btn?.classList.add('active');
    _lastSourceText = '';
    _lastSel = '';
    _render();
    _attachListeners();
  }

  function close() {
    if (_popup) _popup.style.display = 'none';
    _isOpen = false;
    _btn?.classList.remove('active');
    clearTimeout(_updateTimer);
    _updateTimer = null;
    _detachListeners();
  }

  function toggle(ta) {
    if (_isOpen && _ta === ta) { close(); return; }
    open(ta);
  }

  /* ---- listeners ---- */
  function _onInput(e) {
    if (_ta && e.target !== _ta) return;
    _scheduleUpdate();
  }

  function _onSelection() {
    if (!_ta) return;
    const sel = _ta.selectionStart + ':' + _ta.selectionEnd;
    if (sel !== _lastSel) {
      _lastSel = sel;
      _scheduleUpdate();
    }
  }

  function _onFocusIn(e) {
    const newTa = e.target;
    const isBlockTextarea = newTa.classList?.contains('block-textarea');
    const isNotepadTextarea = newTa.tagName === 'TEXTAREA' && newTa.closest('.notepad-body');
    if ((!isBlockTextarea && !isNotepadTextarea) || newTa === _ta) return;
    _ta = newTa;
    _lastSourceText = '';
    _lastSel = '';
    // При открытом попапе не обновляем — click на кнопке другого блока
    // должен работать через toggle(), а не через focusin.
    if (_isOpen) _scheduleUpdate();
  }

  function _onKeydown(e) {
    if (e.key === 'Escape' && _isOpen) {
      e.preventDefault();
      close();
    }
  }

  // Подавление системного контекстного меню при ПКМ вне закреплённого попапа — by design.
  function _onContextMenu(e) {
    if (_pinned) return;
    if (_isOpen && _popup && !_popup.contains(e.target)) {
      e.preventDefault();
      close();
    }
  }

  /* ---- listener registry ---- */
  const _DOC_HANDLERS = [
    ['input',           _onInput,        true],
    ['selectionchange', _onSelection,    true],
    ['focusin',         _onFocusIn,      true],
    ['keydown',         _onKeydown,      true],
    ['contextmenu',     _onContextMenu,  true],
  ];

  let _listenersAttached = false;

  function _attachListeners() {
    if (_listenersAttached) return;
    _listenersAttached = true;
    for (const [type, fn, opts] of _DOC_HANDLERS) {
      document.addEventListener(type, fn, opts);
    }
  }

  function _detachListeners() {
    if (!_listenersAttached) return;
    _listenersAttached = false;
    for (const [type, fn, opts] of _DOC_HANDLERS) {
      document.removeEventListener(type, fn, opts);
    }
  }

  /* ---- public API ---- */
  function setupButton(btn, ta) {
    _btn = btn;
    btn.onclick = e => {
      e.stopPropagation();
      toggle(ta);
    };
  }

  return { setupButton, open, close, toggle, computeStats };
})();
