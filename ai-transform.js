// file_name: ai-transform.js
/* ============================================================
   AiTransform — Inline AI трансформации выделенного текста
   ============================================================ */
'use strict';

window.AiTransform = (() => {
  let _State = null;
  let _LLMCore = null;

  // ── Состояние ─────────────────────────────────────────────
  let _popup = null;
  let _ta = null;
  let _origStart = 0;
  let _origEnd = 0;
  let _origText = '';
  let _suggestedText = '';
  let _autoTimer = null;
  let _onClickOutside = null;
  let _onContextMenu = null;

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
    _origText = ta.value.slice(_origStart, _origEnd);
    _suggestedText = '';
    clearTimeout(_autoTimer);

    popup.innerHTML = `
      <div class="ai-transform-row">
        <input type="text" id="ai-transform-input"
               placeholder="Что сделать с текстом?"
               autocomplete="off" spellcheck="false">
        <button type="button" id="ai-transform-send" title="Выполнить (Enter)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8l12-5-5 12-2-5z"/><path d="M14 3l-5 5"/></svg>
        </button>
        <button type="button" id="ai-transform-accept" title="Принять" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 8l4 4 6-7"/></svg>
        </button>
        <button type="button" id="ai-transform-cancel" title="Отменить (Esc)" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>
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

    const sendBtn = popup.querySelector('#ai-transform-send');
    const acceptBtn = popup.querySelector('#ai-transform-accept');
    const cancelBtn = popup.querySelector('#ai-transform-cancel');

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _runTransform(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); hidePopup(true); }
    });

    sendBtn.addEventListener('click', e => { e.stopPropagation(); _runTransform(input.value); });
    acceptBtn.addEventListener('click', e => { e.stopPropagation(); _acceptChange(); hidePopup(); });
    cancelBtn.addEventListener('click', e => { e.stopPropagation(); hidePopup(true); });
  }

  function hidePopup(restore = false) {
    clearTimeout(_autoTimer);
    if (restore && _ta && _origText != null) {
      _ta._skipWordComplete = true;
      _ta.setRangeText(_origText, _origStart, _origEnd, 'end');
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;
    }
    if (_popup) _popup.style.display = 'none';
    _removeDiffPanel();
    _ta = null;
    _suggestedText = '';
    if (_onClickOutside) { document.removeEventListener('click', _onClickOutside, true); _onClickOutside = null; }
    if (_onContextMenu) { document.removeEventListener('contextmenu', _onContextMenu, true); _onContextMenu = null; }
  }

  function _showLoading() {
    const popup = ensurePopup();
    const input = popup.querySelector('#ai-transform-input');
    const sendBtn = popup.querySelector('#ai-transform-send');
    if (input) { input.disabled = true; input.placeholder = 'Выполняю...'; }
    if (sendBtn) sendBtn.style.display = 'none';
  }

  function _showResult() {
    const popup = ensurePopup();
    const input = popup.querySelector('#ai-transform-input');
    const sendBtn = popup.querySelector('#ai-transform-send');
    const acceptBtn = popup.querySelector('#ai-transform-accept');
    const cancelBtn = popup.querySelector('#ai-transform-cancel');
    if (input) { input.disabled = false; input.placeholder = 'Новый запрос...'; }
    if (sendBtn) sendBtn.style.display = '';
    if (acceptBtn) acceptBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
  }

  // ── Запрос к LLM ─────────────────────────────────────────
  async function _runTransform(instruction) {
    if (!instruction?.trim() || !_ta || !_LLMCore) return;
    if (!_origText?.trim()) { window.Toast?.show('Нет выделенного текста', 'error'); return; }

    _showLoading();
    _removeDiffPanel();

    const systemPrompt = `Ты — AI-ассистент для трансформации текста.
Пользователь выделил текст и даёт инструкцию что с ним сделать.
Выполни инструкцию и верни ТОЛЬКО результат без пояснений, Markdown-обёрток и лишнего текста.
Язык результата — такой же как у исходного текста.`;

    try {
      const result = await _LLMCore.request({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Текст: "${_origText}"\n\nИнструкция: ${instruction}` }
        ],
        stream: false,
        maxTokens: 2000,
        featureTag: 'ai-transform',
      });

      if (!result?.trim()) {
        window.Toast?.show('LLM не вернул результат', 'error');
        _showResult();
        return;
      }

      _suggestedText = result.trim();

      // Diff-панель
      _showDiffPanel(_origText, _suggestedText);

      // Применяем текст
      _ta._skipWordComplete = true;
      _ta.setRangeText(_suggestedText, _origStart, _origEnd, 'select');
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;

      _showResult();

      // Автоприменение через 5 сек
      _autoTimer = setTimeout(() => {
        if (_suggestedText) { _acceptChange(); hidePopup(); }
      }, 5000);

      // Клик вне — закрыть без принятия
      _onClickOutside = (e) => {
        if (_popup && !_popup.contains(e.target) && e.target !== _ta) {
          hidePopup();
        }
      };
      setTimeout(() => document.addEventListener('click', _onClickOutside, true), 0);

      // ПКМ — отмена
      _onContextMenu = (e) => {
        if (_popup && !_popup.contains(e.target) && e.target !== _ta) {
          e.preventDefault();
          hidePopup(true);
        }
      };
      setTimeout(() => document.addEventListener('contextmenu', _onContextMenu, true), 0);

    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      _showResult();
    }
  }

  // ── Diff-панель (как snap-diff) ───────────────────────────
  let _diffPanel = null;

  function _removeDiffPanel() {
    if (_diffPanel) { _diffPanel.remove(); _diffPanel = null; }
  }

  function _showDiffPanel(origText, sugText) {
    _removeDiffPanel();

    const origWords = origText.split(/(\s+)/);
    const sugWords = sugText.split(/(\s+)/);

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

    const diffHtml = parts.map(p => {
      if (p.type === 'eq') return `<span class="diff-eq">${esc(p.text)}</span>`;
      if (p.type === 'ins') return `<span class="diff-ins">${esc(p.text)}</span>`;
      if (p.type === 'del') return `<span class="diff-del">${esc(p.text)}</span>`;
      return esc(p.text);
    }).join('');

    const added = parts.filter(p => p.type === 'ins').length;
    const removed = parts.filter(p => p.type === 'del').length;

    _diffPanel = document.createElement('div');
    _diffPanel.className = 'snap-diff-overlay';
    _diffPanel.style.display = 'flex';
    _diffPanel.innerHTML = `
      <div class="snap-diff-panel" style="max-height:200px">
        <div class="snap-diff-header">
          <span class="snap-diff-title">Diff</span>
          <span class="snap-diff-stats">+${added} −${removed}</span>
          <button type="button" class="snap-diff-close" aria-label="Закрыть">✕</button>
        </div>
        <div class="snap-diff-body">${diffHtml}</div>
      </div>
    `;

    _diffPanel.querySelector('.snap-diff-close')?.addEventListener('click', () => _removeDiffPanel());

    const container = _ta?.closest('.block-body, .subtab-content, .code-block');
    if (container) container.appendChild(_diffPanel);
  }

  // ── Принятие ──────────────────────────────────────────────
  function _acceptChange() {
    clearTimeout(_autoTimer);
    if (_ta && _suggestedText) window.Toast?.show('Принято ✓', 'success');
    _removeDiffPanel();
  }

  // ── Публичный API ────────────────────────────────────────
  function openForSelection(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    if (!sel) { window.Toast?.show('Выделите текст', 'error'); return; }

    const start = ta.selectionStart;
    const text = ta.value;
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    const lineIdx = text.slice(0, lineStart).split('\n').length - 1;
    const charHeight = parseInt(getComputedStyle(ta).lineHeight) || 18;
    const rect = ta.getBoundingClientRect();
    const y = rect.top + lineIdx * charHeight;
    const x = rect.left + 10;

    showPopup(ta, x, y);
  }

  // ── Инициализация ─────────────────────────────────────────
  let _inited = false;
  function init(State, LLMCore) {
    if (_inited) return;
    _inited = true;
    _State = State;
    _LLMCore = LLMCore;
  }

  return {
    init,
    openForSelection,
    hidePopup,
  };
})();
