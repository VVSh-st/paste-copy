// file_name: ai-transform.js
/* ============================================================
   AiTransform — Inline AI трансформации выделенного текста
   ============================================================ */
'use strict';

window.AiTransform = (() => {
  let _State = null;
  let _LLMCore = null;

  let _popup = null;
  let _ta = null;
  let _origStart = 0;
  let _origEnd = 0;
  let _origText = '';
  let _suggestedText = '';
  let _onClickOutside = null;
  let _onContextMenu = null;
  let _diffPanel = null;
  let _useWholeText = false;

  // ── История запросов ──────────────────────────────────────
  const HISTORY_KEY = 'ai-transform-history';
  let _history = [];
  let _historyIdx = -1;

  function _loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) _history = JSON.parse(raw);
      if (!Array.isArray(_history)) _history = [];
    } catch { _history = []; }
  }

  function _saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(_history.slice(-50))); } catch {}
  }

  function _addToHistory(text) {
    if (!text?.trim()) return;
    _history = _history.filter(h => h !== text);
    _history.push(text);
    if (_history.length > 50) _history = _history.slice(-50);
    _saveHistory();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Popup ─────────────────────────────────────────────────
  function ensurePopup() {
    if (_popup && _popup.isConnected) return _popup;
    _popup = document.createElement('div');
    _popup.className = 'ai-transform-popup';
    document.body.appendChild(_popup);
    return _popup;
  }

  function showPopup(ta, x, y) {
    const popup = ensurePopup();
    _ta = ta;
    _origStart = ta.selectionStart;
    _origEnd = ta.selectionEnd;
    const sel = ta.value.slice(_origStart, _origEnd).trim();

    if (sel) {
      _origText = sel;
      _useWholeText = false;
    } else {
      _origText = ta.value;
      _useWholeText = true;
    }

    _suggestedText = '';
    _removeDiffPanel();
    _loadHistory();
    _historyIdx = _history.length;

    popup.innerHTML = `
      <div class="ai-transform-row">
        <input type="text" id="ai-transform-input"
               placeholder="${_useWholeText ? 'Запрос ко всему тексту...' : 'Что сделать с текстом?'}"
               autocomplete="off" spellcheck="false">
        <button type="button" id="ai-transform-send" title="Выполнить (Enter)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8l12-5-5 12-2-5z"/><path d="M14 3l-5 5"/></svg>
        </button>
      </div>
    `;

    popup.style.display = 'block';
    popup.style.left = x + 'px';
    popup.style.top = (y - 44) + 'px';

    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.top < 10) popup.style.top = (y + 10) + 'px';
      if (rect.right > window.innerWidth - 10) popup.style.left = (window.innerWidth - rect.width - 10) + 'px';
      if (rect.left < 10) popup.style.left = '10px';
    });

    const input = popup.querySelector('#ai-transform-input');
    setTimeout(() => input?.focus(), 50);

    popup.querySelector('#ai-transform-send')?.addEventListener('click', e => {
      e.stopPropagation();
      _runTransform(input.value);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _runTransform(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); hidePopup(true); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_history.length && _historyIdx > 0) {
          _historyIdx--;
          input.value = _history[_historyIdx] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_historyIdx < _history.length - 1) {
          _historyIdx++;
          input.value = _history[_historyIdx] || '';
        } else {
          _historyIdx = _history.length;
          input.value = '';
        }
      }
    });
  }

  function hidePopup(restore = false) {
    if (restore && _ta && _origText != null) {
      if (_useWholeText) {
        _ta._skipWordComplete = true;
        _ta.value = _origText;
        _ta.dispatchEvent(new Event('input', { bubbles: true }));
        _ta._skipWordComplete = false;
      } else {
        _ta._skipWordComplete = true;
        _ta.setRangeText(_origText, _origStart, _origEnd, 'end');
        _ta.dispatchEvent(new Event('input', { bubbles: true }));
        _ta._skipWordComplete = false;
      }
    }
    if (_popup) _popup.style.display = 'none';
    _removeDiffPanel();
    _ta = null;
    _suggestedText = '';
    _useWholeText = false;
    if (_onClickOutside) { document.removeEventListener('click', _onClickOutside, true); _onClickOutside = null; }
    if (_onContextMenu) { document.removeEventListener('contextmenu', _onContextMenu, true); _onContextMenu = null; }
  }

  // ── Запрос к LLM ─────────────────────────────────────────
  async function _runTransform(instruction) {
    if (!instruction?.trim() || !_ta || !_LLMCore) return;
    if (!_origText?.trim()) { window.Toast?.show('Нет текста для обработки', 'error'); return; }

    _addToHistory(instruction.trim());
    _removeDiffPanel();

    const popup = ensurePopup();
    const input = popup.querySelector('#ai-transform-input');
    const sendBtn = popup.querySelector('#ai-transform-send');
    if (input) { input.disabled = true; input.placeholder = 'Выполняю...'; }
    if (sendBtn) sendBtn.style.display = 'none';

    try {
      const result = await _LLMCore.request({
        messages: [
          { role: 'system', content: 'Ты — AI-ассистент для трансформации текста. Выполни инструкцию и верни ТОЛЬКО результат без пояснений. Язык результата — такой же как у исходного текста.' },
          { role: 'user', content: `Текст: "${_origText}"\n\nИнструкция: ${instruction}` }
        ],
        stream: false,
        maxTokens: 2000,
        featureTag: 'ai-transform',
      });

      if (!result?.trim()) {
        window.Toast?.show('LLM не вернул результат', 'error');
        if (input) { input.disabled = false; input.placeholder = 'Новый запрос...'; }
        if (sendBtn) sendBtn.style.display = '';
        return;
      }

      _suggestedText = result.trim();

      // Скрываем popup, показываем diff
      if (_popup) _popup.style.display = 'none';
      _showDiffPanel(_origText, _suggestedText);

      // ПКМ — отмена с возвратом оригинала
      _onContextMenu = (e) => {
        if (_diffPanel && !_diffPanel.contains(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          hidePopup(true);
        }
      };
      setTimeout(() => document.addEventListener('contextmenu', _onContextMenu, true), 0);

    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      if (input) { input.disabled = false; input.placeholder = 'Новый запрос...'; }
      if (sendBtn) sendBtn.style.display = '';
    }
  }

  // ── Diff-панель ──────────────────────────────────────────
  function _removeDiffPanel() {
    if (_diffPanel) { _diffPanel.remove(); _diffPanel = null; }
  }

  function _isLargeChange(orig, sug) {
    const origLen = orig.length;
    const sugLen = sug.length;
    if (origLen === 0) return true;
    const ratio = Math.abs(sugLen - origLen) / origLen;
    return ratio > 0.5;
  }

  function _showDiffPanel(origText, sugText) {
    _removeDiffPanel();
    if (!_ta) return;

    const lay = window.State?.getLayout?.();
    const savedSize = lay?.llm?.diffFontSize || 12;
    const isLarge = _isLargeChange(origText, sugText);

    let diffHtml;
    if (isLarge) {
      diffHtml = esc(sugText);
    } else {
      diffHtml = _renderAdditionsOnly(origText, sugText);
    }

    _diffPanel = document.createElement('div');
    _diffPanel.className = 'llm-result-panel';
    _diffPanel.style.setProperty('--text-lint-diff-font-size', savedSize + 'px');
    _diffPanel.style.setProperty('--text-lint-diff-line-height', Math.round(savedSize * 1.65 * 100) / 100 + 'px');
    _diffPanel.innerHTML =
      `<div class="llm-result-toolbar text-lint-result-toolbar">` +
        `<span class="llm-result-stats text-lint-result-stats">AI-трансформация</span>` +
        `<span class="text-lint-diff-size-controls">` +
          `<button type="button" class="btn-sm text-lint-diff-size-btn" data-diff-size="dec" title="Уменьшить">A−</button>` +
          `<span class="text-lint-diff-size-value">${savedSize}px</span>` +
          `<button type="button" class="btn-sm text-lint-diff-size-btn" data-diff-size="inc" title="Увеличить">A+</button>` +
        `</span>` +
        `<button type="button" class="btn-sm" data-action="copy" title="Скопировать">⧉</button>` +
        `<button type="button" class="btn-sm btn-sm-accent" data-action="accept">✓</button>` +
        `<button type="button" class="btn-sm" data-action="reject">✕</button>` +
      `</div>` +
      `<div class="llm-result-content text-lint-result-content">${diffHtml}</div>`;

    const parent = _ta.parentNode;
    if (parent) parent.insertBefore(_diffPanel, _ta.nextSibling);

    _diffPanel.addEventListener('click', e => e.stopPropagation());

    _diffPanel.querySelector('[data-action="accept"]')?.addEventListener('click', () => {
      _acceptChange();
      _removeDiffPanel();
    });
    _diffPanel.querySelector('[data-action="reject"]')?.addEventListener('click', () => {
      hidePopup(true);
    });
    _diffPanel.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(_suggestedText);
      window.Toast?.show('Скопировано', 'success');
    });
    _diffPanel.querySelectorAll('[data-diff-size]').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = btn.dataset.diffSize === 'inc' ? 0.5 : -0.5;
        const current = parseFloat(_diffPanel.style.getPropertyValue('--text-lint-diff-font-size')) || 12;
        const next = Math.max(8, Math.min(32, Math.round((current + step) * 2) / 2));
        _diffPanel.style.setProperty('--text-lint-diff-font-size', next + 'px');
        _diffPanel.style.setProperty('--text-lint-diff-line-height', Math.round(next * 1.65 * 100) / 100 + 'px');
        const val = _diffPanel.querySelector('.text-lint-diff-size-value');
        if (val) val.textContent = next + 'px';
      });
    });
  }

  function _renderAdditionsOnly(orig, sug) {
    const origWords = orig.split(/(\s+)/);
    const sugWords = sug.split(/(\s+)/);

    const m = origWords.length;
    const n = sugWords.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = origWords[i - 1] === sugWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const parts = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origWords[i - 1] === sugWords[j - 1]) {
        parts.unshift({ type: 'eq', text: origWords[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        parts.unshift({ type: 'ins', text: sugWords[j - 1] });
        j--;
      } else {
        parts.unshift({ type: 'del', text: origWords[i - 1] });
        i--;
      }
    }

    return parts.map(p => {
      if (p.type === 'eq') return esc(p.text);
      if (p.type === 'ins') return `<span class="ai-transform-ins">${esc(p.text)}</span>`;
      return '';
    }).join('');
  }

  // ── Принятие ──────────────────────────────────────────────
  function _acceptChange() {
    if (_ta && _suggestedText) {
      _ta._skipWordComplete = true;
      if (_useWholeText) {
        _ta.value = _suggestedText;
      } else {
        _ta.setRangeText(_suggestedText, _origStart, _origEnd, 'select');
      }
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;
      window.Toast?.show('Принято ✓', 'success');
    }
  }

  // ── Публичный API ────────────────────────────────────────
  function openForSelection(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    showPopup(ta, ta.getBoundingClientRect().left + 10, ta.getBoundingClientRect().top);
  }

  let _inited = false;
  function init(State, LLMCore) {
    if (_inited) return;
    _inited = true;
    _State = State;
    _LLMCore = LLMCore;

    if (!document.getElementById('ai-transform-css')) {
      const style = document.createElement('style');
      style.id = 'ai-transform-css';
      style.textContent = `
        .ai-transform-ins {
          background: rgba(34,197,94,0.2);
          color: #a6e3a1;
          padding: 1px 2px;
          border-radius: 2px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  return {
    init,
    openForSelection,
    hidePopup,
  };
})();
