// file_name: word-count.js

/* ============================================================
   Word Count — floating statistics popup
   ============================================================ */
const WordCount = (() => {
  'use strict';

  let _popup = null;
  let _btn = null;
  let _ta = null;          // current textarea
  let _isOpen = false;
  let _pinned = localStorage.getItem('wc-pinned') === 'true';
  let _updateTimer = null;
  let _lastSelection = '';

  /* ---- drag state ---- */
  let _dragging = false;
  let _dragOffset = { x: 0, y: 0 };

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

  /* ---- render ---- */
  function _render() {
    if (!_popup) return;
    const stats = computeStats(_getSourceText());
    const rows = _popup.querySelector('.wc-rows');
    if (!rows) return;

    const lines = [
      { label: 'Символы',       value: stats.chars },
      { label: 'Без пробелов',  value: stats.charsNoSpaces },
      { label: 'Предложения',   value: stats.sentences },
      { label: 'Абзацы',        value: stats.paragraphs },
      { label: 'Время чтения',  value: stats.readingTime },
    ];

    const wordsEl = _popup.querySelector('.wc-words-value');
    if (wordsEl) wordsEl.textContent = stats.words;

    rows.innerHTML = '';
    lines.forEach(l => {
      const row = document.createElement('div');
      row.className = 'wc-row';
      row.innerHTML = '<span class="wc-label">' + l.label + '</span><span class="wc-value">' + l.value + '</span>';
      rows.appendChild(row);
    });
  }

  /* ---- schedule update ---- */
  function _scheduleUpdate() {
    clearTimeout(_updateTimer);
    _updateTimer = setTimeout(_render, 80);
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

    // pin button
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'wc-pin';
    pin.title = _pinned ? 'Открепить окно' : 'Закрепить окно';
    pin.textContent = '📌';
    if (_pinned) pin.classList.add('active');
    pin.onclick = e => {
      e.stopPropagation();
      _pinned = !_pinned;
      localStorage.setItem('wc-pinned', String(_pinned));
      pin.classList.toggle('active', _pinned);
      pin.title = _pinned ? 'Открепить окно' : 'Закрепить окно';
    };
    _popup.appendChild(pin);

    // words block (hero)
    const wordsBlock = document.createElement('div');
    wordsBlock.className = 'wc-words-block';
    wordsBlock.innerHTML = '<div class="wc-words-label">Слова</div><div class="wc-words-value">0</div>';
    _popup.appendChild(wordsBlock);

    // rows
    const rows = document.createElement('div');
    rows.className = 'wc-rows';
    _popup.appendChild(rows);

    // drag
    wordsBlock.style.cursor = 'grab';
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
      _popup.style.left = (e.clientX - _dragOffset.x) + 'px';
      _popup.style.top = (e.clientY - _dragOffset.y) + 'px';
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
    localStorage.setItem('wc-popup-pos', JSON.stringify({ x: rect.left, y: rect.top }));
  }

  /* ---- open / close ---- */
  function open(ta) {
    _ta = ta;
    _createPopup();
    _popup.style.display = 'block';
    _isOpen = true;
    _btn?.classList.add('active');
    _render();
    _attachListeners();
  }

  function close() {
    if (_popup) _popup.style.display = 'none';
    _isOpen = false;
    _btn?.classList.remove('active');
    _detachListeners();
  }

  function toggle(ta) {
    if (_isOpen && _ta === ta) { close(); return; }
    open(ta);
  }

  /* ---- listeners ---- */
  function _onInput() { _scheduleUpdate(); }

  function _onSelection() {
    if (!_ta) return;
    const sel = _ta.selectionStart + ':' + _ta.selectionEnd;
    if (sel !== _lastSelection) {
      _lastSelection = sel;
      _scheduleUpdate();
    }
  }

  function _onFocusIn(e) {
    const newTa = e.target;
    if (newTa.classList?.contains('block-textarea') && newTa !== _ta) {
      _ta = newTa;
      _lastSelection = newTa.selectionStart + ':' + newTa.selectionEnd;
      _scheduleUpdate();
    }
  }

  function _onKeydown(e) {
    if (e.key === 'Escape' && _isOpen) {
      e.preventDefault();
      close();
    }
  }

  function _onContextMenu(e) {
    if (_pinned) return;
    if (_isOpen && _popup && !_popup.contains(e.target)) {
      e.preventDefault();
      close();
    }
  }

  let _listenersAttached = false;

  function _attachListeners() {
    if (_listenersAttached) return;
    _listenersAttached = true;
    document.addEventListener('input', _onInput, true);
    document.addEventListener('selectionchange', _onSelection, true);
    document.addEventListener('focusin', _onFocusIn, true);
    document.addEventListener('keydown', _onKeydown, true);
    document.addEventListener('contextmenu', _onContextMenu, true);
  }

  function _detachListeners() {
    if (!_listenersAttached) return;
    _listenersAttached = false;
    document.removeEventListener('input', _onInput, true);
    document.removeEventListener('selectionchange', _onSelection, true);
    document.removeEventListener('focusin', _onFocusIn, true);
    document.removeEventListener('keydown', _onKeydown, true);
    document.removeEventListener('contextmenu', _onContextMenu, true);
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
