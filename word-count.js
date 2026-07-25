// file_name: word-count.js

/* ============================================================
   Word Count — floating statistics popup
   ============================================================ */
const WordCount = (() => {
  'use strict';

  let _popup = null;
  let _wrapper = null;
  let _btn = null;
  let _ta = null;
  let _isOpen = false;
  let _pinned = localStorage.getItem('wc-pinned') === 'true';
  let _updateTimer = null;
  let _lastSourceText = '';
  let _lastSelStart = -1;
  let _lastSelEnd = -1;
  let _rowValueEls = new Map();
  let _wordsValEl = null;

  /* ---- stats panel state ---- */
  let _statsOpen = localStorage.getItem('wc-stats-open') === 'true';
  let _statsPanelEl = null;
  let _wordFreqEl = null;
  let _charFreqEl = null;
  let _statsBtnEl = null;
  let _statsHoverTimer = null;

  /* ---- user selection tracking (survives navigation) ---- */
  let _userSelStart = -1;
  let _userSelEnd = -1;

  /* ---- word navigation state ---- */
  let _navWord = '';
  let _navPositions = [];
  let _navIdx = -1;
  let _navScopeKey = '';
  let _navSelStart = -1;
  let _navSelEnd = -1;

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

  /* ---- cached regex (module-level) ---- */
  const RE_SPACES = /\s/g;
  const RE_WORDS = /\s+/;
  const RE_SENTENCES = /[.!?]+(?:\s|$)/g;
  const RE_PARAGRAPHS = /\n\s*\n/;

  /* ---- stats computation ---- */
  function computeStats(text) {
    const trimmed = text.trim();
    if (!trimmed) {
      return { words: 0, chars: text.length, charsNoSpaces: text.length, sentences: 0, paragraphs: 0, readingTime: '< 1 мин' };
    }
    const words = trimmed.split(RE_WORDS).length;
    const chars = text.length;
    const spaces = (text.match(RE_SPACES) || []).length;
    const charsNoSpaces = chars - spaces;
    const sentences = (trimmed.match(RE_SENTENCES) || []).length || 1;
    const paragraphs = text.split(RE_PARAGRAPHS).filter(s => s.trim()).length || 1;
    const readingMinutes = Math.ceil(words / 200);
    const readingTime = words < 200 ? '< 1 мин' : readingMinutes + ' мин';
    return { words, chars, charsNoSpaces, sentences, paragraphs, readingTime };
  }

  /* ---- frequency computation ---- */
  function computeFrequency(text) {
    const trimmed = text.trim();
    if (!trimmed) return { words: [], chars: [] };

    const RE_CODEWORD = /^[a-zа-яё]{2,}(?:[-'][a-zа-яё]+)*$/i;
    const RE_TRIM_PUNCT = /^[^\p{L}]+|[^\p{L}]+$/gu;
    const wordMap = new Map();
    const words = trimmed.split(/\s+/).filter(Boolean);
    for (const w of words) {
      const clean = w.replace(RE_TRIM_PUNCT, '');
      if (!clean || !RE_CODEWORD.test(clean)) continue;
      const lower = clean.toLowerCase();
      wordMap.set(lower, (wordMap.get(lower) || 0) + 1);
    }
    const wordsSorted = [...wordMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    const charMap = new Map();
    for (const ch of text) {
      charMap.set(ch, (charMap.get(ch) || 0) + 1);
    }
    const charsSorted = [...charMap.entries()]
      .sort((a, b) => b[1] - a[1]);

    return { words: wordsSorted, chars: charsSorted };
  }

  /* ---- determine source text for stats ---- */
  function _getSourceText() {
    if (!_ta) return '';
    // Есть выделение пользователя → считать по выделению
    if (_userSelStart >= 0 && _userSelEnd > _userSelStart) {
      return _ta.value.substring(_userSelStart, _userSelEnd);
    }
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

    const strWords = String(stats.words);
    if (_wordsValEl && _wordsValEl.textContent !== strWords) {
      _wordsValEl.textContent = strWords;
    }

    for (const def of _ROW_DEFS) {
      const el = _rowValueEls.get(def.stat);
      const newVal = String(stats[def.stat]);
      if (el && el.textContent !== newVal) {
        el.textContent = newVal;
      }
    }

    if (_statsOpen) _renderStats(src);
  }

  /* ---- schedule update ---- */
  function _scheduleUpdate() {
    clearTimeout(_updateTimer);
    _updateTimer = setTimeout(_render, 80);
  }

  /* ---- render frequency stats ---- */
  function _renderStats(src) {
    if (!_wordFreqEl || !_charFreqEl) return;
    const freq = computeFrequency(src || _getSourceText());

    const wordHtml = freq.words.map(([w, c]) => {
      const display = w.length > 25 ? _escHtml(w.slice(0, 25)) + '…' : _escHtml(w);
      return `<div class="wc-freq-item"><span class="wc-freq-word">${display}</span><span class="wc-freq-count">= ${c}</span></div>`;
    }).join('');
    if (_wordFreqEl.innerHTML !== wordHtml) _wordFreqEl.innerHTML = wordHtml;

    const charHtml = freq.chars.map(([ch, c]) => {
      const display = ch === ' ' ? '_' : ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : _escHtml(ch);
      return `<div class="wc-freq-item"><span class="wc-freq-word">${display}</span><span class="wc-freq-count">= ${c}</span></div>`;
    }).join('');
    if (_charFreqEl.innerHTML !== charHtml) _charFreqEl.innerHTML = charHtml;
  }

  function _escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- toggle stats panel ---- */
  function _toggleStats() {
    _statsOpen = !_statsOpen;
    localStorage.setItem('wc-stats-open', String(_statsOpen));
    if (_statsPanelEl) _statsPanelEl.classList.toggle('open', _statsOpen);
    if (_statsBtnEl) _statsBtnEl.classList.toggle('active', _statsOpen);
    if (_statsOpen) _renderStats();
    _lastSourceText = '\x00';
    _scheduleUpdate();
  }

  /* ================================================================
     WORD NAVIGATION — click word in frequency list → jump in text
     ================================================================ */

  /* Find all whole-word occurrences in a text scope */
  function _findOccurrences(word, scopeText, scopeOffset) {
    const lower = word.toLowerCase();
    const len = word.length;
    const positions = [];
    let i = 0;
    while (i <= scopeText.length - len) {
      if (scopeText.substring(i, i + len).toLowerCase() === lower) {
        const before = i === 0 || /[^a-zа-яё0-9_]/i.test(scopeText[i - 1]);
        const after = i + len >= scopeText.length || /[^a-zа-яё0-9_]/i.test(scopeText[i + len]);
        if (before && after) positions.push(scopeOffset + i);
      }
      i++;
    }
    return positions;
  }

  /* Scroll textarea to position and highlight word */
  function _scrollToOccurrence(start, len) {
    if (!_ta) return;
    _ta.focus({ preventScroll: true });
    _ta.setSelectionRange(start, start + len);
    // Approximate scroll by line count (immediate)
    const linesBefore = _ta.value.substring(0, start).split('\n').length - 1;
    const lineHeight = parseInt(getComputedStyle(_ta).lineHeight, 10) || 18;
    _ta.scrollTop = Math.max(0, linesBefore * lineHeight - _ta.clientHeight / 2);
    // Precise correction via mirror (next frame)
    requestAnimationFrame(() => {
      const cs = getComputedStyle(_ta);
      const pt = parseFloat(cs.paddingTop) || 0;
      const mirror = document.createElement('div');
      mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;' +
        'font:' + cs.font + ';padding:' + cs.padding + ';width:' + _ta.clientWidth + 'px;' +
        'line-height:' + cs.lineHeight + ';letter-spacing:' + cs.letterSpacing;
      mirror.textContent = _ta.value.substring(0, start);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const mr = marker.getBoundingClientRect();
      const mir = mirror.getBoundingClientRect();
      const contentPos = mr.top - mir.top - pt;
      document.body.removeChild(mirror);
      _ta.scrollTop = Math.max(0, Math.min(
        contentPos - _ta.clientHeight / 2,
        _ta.scrollHeight - _ta.clientHeight
      ));
    });
  }

  /* Click handler for word frequency list */
  function _onWordClick(e) {
    const wordEl = e.target.closest('.wc-freq-word');
    if (!wordEl || !_ta) return;
    const word = wordEl.textContent.trim();
    if (!word) return;

    // Determine navigation scope based on user's selection
    const hasUserSel = _userSelStart >= 0 && _userSelEnd > _userSelStart;
    const scopeText = hasUserSel ? _ta.value.substring(_userSelStart, _userSelEnd) : _ta.value;
    const scopeOffset = hasUserSel ? _userSelStart : 0;
    const scopeKey = scopeOffset + ':' + scopeText.length;

    // Same word + same scope → cycle to next occurrence
    if (word === _navWord && scopeKey === _navScopeKey && _navPositions.length) {
      _navIdx = (_navIdx + 1) % _navPositions.length;
    } else {
      // New word or scope changed → find all occurrences
      _navPositions = _findOccurrences(word, scopeText, scopeOffset);
      if (!_navPositions.length) return;
      _navIdx = 0;
      _navWord = word;
      _navScopeKey = scopeKey;
    }

    // Navigate to the occurrence
    _navSelStart = _navPositions[_navIdx];
    _navSelEnd = _navPositions[_navIdx] + word.length;
    _scrollToOccurrence(_navSelStart, word.length);

    // Flash animation
    wordEl.classList.remove('wc-flash');
    void wordEl.offsetWidth;
    wordEl.classList.add('wc-flash');
    setTimeout(() => wordEl.classList.remove('wc-flash'), 400);
  }

  /* ---- clamp position to viewport ---- */
  function _clampPosition() {
    if (!_wrapper) return;
    const r = _wrapper.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.round(r.left);
    let top = Math.round(r.top);
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + r.width > vw) left = Math.max(0, Math.round(vw - r.width));
    if (top + r.height > vh) top = Math.max(0, Math.round(vh - r.height));
    _wrapper.style.left = left + 'px';
    _wrapper.style.top = top + 'px';
  }

  /* ---- create popup DOM ---- */
  function _createPopup() {
    if (_popup) return _popup;

    const wrapper = document.createElement('div');
    wrapper.className = 'wc-wrapper';

    _popup = document.createElement('div');
    _popup.className = 'wc-popup';
    _popup.setAttribute('role', 'dialog');
    _popup.setAttribute('aria-label', 'Подсчёт слов');

    const saved = localStorage.getItem('wc-popup-pos');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        wrapper.style.left = p.x + 'px';
        wrapper.style.top = p.y + 'px';
      } catch (_) {}
    }
    if (!wrapper.style.left) {
      wrapper.style.right = '20px';
      wrapper.style.bottom = '80px';
    }

    // words block (hero)
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
    _wordsValEl = wordsVal;
    wordsBlock.append(pin, wordsLabel, wordsVal);

    // stats toggle button
    const statsBtn = document.createElement('button');
    statsBtn.type = 'button';
    statsBtn.className = 'wc-stats-btn';
    statsBtn.title = 'Статистика частоты / клик по слову — переход к вхождению';
    statsBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect x="2" y="9" width="3" height="5" rx="0.5"/><rect x="6.5" y="5" width="3" height="9" rx="0.5"/><rect x="11" y="2" width="3" height="12" rx="0.5"/></svg>';
    if (_statsOpen) statsBtn.classList.add('active');
    statsBtn.onclick = e => { e.stopPropagation(); _toggleStats(); };
    statsBtn.addEventListener('mouseenter', () => {
      clearTimeout(_statsHoverTimer);
      _statsHoverTimer = setTimeout(() => _toggleStats(), 350);
    });
    statsBtn.addEventListener('mouseleave', () => { clearTimeout(_statsHoverTimer); });
    _statsBtnEl = statsBtn;
    wordsBlock.appendChild(statsBtn);

    _popup.appendChild(wordsBlock);

    // rows container
    const rows = document.createElement('div');
    rows.className = 'wc-rows';
    _popup.appendChild(rows);

    // stats panel
    const statsPanel = document.createElement('div');
    statsPanel.className = 'wc-stats-panel';
    if (_statsOpen) statsPanel.classList.add('open');
    const grid = document.createElement('div');
    grid.className = 'wc-stats-grid';
    const wordCol = document.createElement('div');
    wordCol.className = 'wc-col';
    const wordFreq = document.createElement('div');
    wordFreq.className = 'wc-freq-list';
    wordCol.appendChild(wordFreq);
    _wordFreqEl = wordFreq;
    wordCol.addEventListener('click', _onWordClick);
    const charCol = document.createElement('div');
    charCol.className = 'wc-col';
    const charFreq = document.createElement('div');
    charFreq.className = 'wc-freq-list';
    charCol.appendChild(charFreq);
    _charFreqEl = charFreq;
    grid.append(wordCol, charCol);
    statsPanel.appendChild(grid);
    _statsPanelEl = statsPanel;

    wrapper.append(_popup, statsPanel);

    // drag handlers
    function _onDragMove(e) {
      if (!_dragging || !wrapper) return;
      let left = e.clientX - _dragOffset.x;
      let top = e.clientY - _dragOffset.y;
      const ww = wrapper.offsetWidth;
      const wh = wrapper.offsetHeight;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + ww > window.innerWidth) left = window.innerWidth - ww;
      if (top + wh > window.innerHeight) top = window.innerHeight - wh;
      wrapper.style.left = left + 'px';
      wrapper.style.top = top + 'px';
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
    }

    function _onDragEnd() {
      document.removeEventListener('mousemove', _onDragMove);
      document.removeEventListener('mouseup', _onDragEnd);
      if (_dragging) {
        _dragging = false;
        if (wrapper) wordsBlock.style.cursor = 'grab';
        _savePosition();
      }
    }

    wordsBlock.addEventListener('mousedown', e => {
      if (e.target === pin || pin.contains(e.target)) return;
      if (e.target === statsBtn || statsBtn.contains(e.target)) return;
      _dragging = true;
      const rect = wrapper.getBoundingClientRect();
      _dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wordsBlock.style.cursor = 'grabbing';
      document.addEventListener('mousemove', _onDragMove, { passive: true });
      document.addEventListener('mouseup', _onDragEnd);
      e.preventDefault();
    });

    document.body.appendChild(wrapper);
    wrapper.style.display = 'none';
    _wrapper = wrapper;
    return _popup;
  }

  function _savePosition() {
    if (!_wrapper) return;
    const rect = _wrapper.getBoundingClientRect();
    localStorage.setItem('wc-popup-pos', JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
  }

  /* ---- open / close ---- */
  function open(ta) {
    _ta = ta;
    _createPopup();
    _wrapper.style.display = 'flex';
    _clampPosition();
    _isOpen = true;
    _btn?.classList.add('active');
    _lastSourceText = '\x00';
    _lastSelStart = -1;
    _lastSelEnd = -1;
    _render();
    _attachListeners();
  }

  function close() {
    if (_wrapper) _wrapper.style.display = 'none';
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
    _navWord = '';
    _navPositions = [];
    _navIdx = -1;
    _navScopeKey = '';
    _userSelStart = -1;
    _userSelEnd = -1;
    _scheduleUpdate();
  }

  function _onSelection() {
    if (!_ta) return;
    const s = _ta.selectionStart;
    const e = _ta.selectionEnd;
    if (s !== _lastSelStart || e !== _lastSelEnd) {
      _lastSelStart = s;
      _lastSelEnd = e;
      // Skip if this selection matches what navigation just set
      if (!(s === _navSelStart && e === _navSelEnd)) {
        _userSelStart = s;
        _userSelEnd = e;
      }
      _scheduleUpdate();
    }
  }

  function _onFocusIn(e) {
    let newTa = e.target;
    if (!newTa.classList?.contains('block-textarea')) {
      const isNotepadTextarea = newTa.tagName === 'TEXTAREA' && newTa.closest('.notepad-body');
      if (isNotepadTextarea) { /* ok */ }
      else {
        const block = newTa.closest?.('.block');
        newTa = block?.querySelector('textarea.block-textarea') || null;
        if (!newTa) return;
      }
    }
    if (newTa === _ta) return;
    _ta = newTa;
    _lastSourceText = '\x00';
    _lastSelStart = -1;
    _lastSelEnd = -1;
    if (_isOpen) _scheduleUpdate();
  }

  function _onKeydown(e) {
    if (e.key === 'Escape' && _isOpen) {
      e.preventDefault();
      close();
    }
  }

  function _onContextMenu(e) {
    if (_pinned) return;
    if (_isOpen && _wrapper && !_wrapper.contains(e.target)) {
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
    clearTimeout(_statsHoverTimer);
    _statsHoverTimer = null;
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

  return { setupButton, open, close, toggle, computeStats, computeFrequency };
})();
