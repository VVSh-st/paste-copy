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
  let _autoTimer = null;
  let _onClickOutside = null;
  let _onContextMenu = null;
  let _diffPanel = null;

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
    _removeDiffPanel();

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

    popup.querySelector('#ai-transform-send')?.addEventListener('click', e => { e.stopPropagation(); _runTransform(input.value); });
    popup.querySelector('#ai-transform-accept')?.addEventListener('click', e => { e.stopPropagation(); _acceptChange(); hidePopup(); });
    popup.querySelector('#ai-transform-cancel')?.addEventListener('click', e => { e.stopPropagation(); hidePopup(true); });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _runTransform(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); hidePopup(true); }
    });
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
        _showResult();
        return;
      }

      _suggestedText = result.trim();

      // Diff-панель как в text-linter
      _showDiffPanel(_origText, _suggestedText);

      // Применяем текст в textarea
      _ta._skipWordComplete = true;
      _ta.setRangeText(_suggestedText, _origStart, _origEnd, 'select');
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;

      _showResult();

      // Автоприменение через 5 сек
      _autoTimer = setTimeout(() => {
        if (_suggestedText) { _acceptChange(); hidePopup(); }
      }, 5000);

      // Клик вне — закрыть
      _onClickOutside = (e) => {
        if (_popup && !_popup.contains(e.target) && e.target !== _ta) hidePopup();
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

  // ── Diff-панель (как в text-linter) ───────────────────────
  function _removeDiffPanel() {
    if (_diffPanel) { _diffPanel.remove(); _diffPanel = null; }
  }

  function _showDiffPanel(origText, sugText) {
    _removeDiffPanel();
    if (!_ta) return;

    // Используем DiffEngine если доступен
    let diffHtml;
    const engine = window.DiffEngine;
    if (engine?.compute && engine?.renderHtml) {
      diffHtml = engine.renderHtml(engine.compute(origText, sugText), 'classic', { durationMs: 3500 });
    } else {
      diffHtml = esc(sugText);
    }

    _diffPanel = document.createElement('div');
    _diffPanel.className = 'llm-result-panel';
    _diffPanel.innerHTML =
      `<div class="llm-result-toolbar">` +
        `<span class="llm-result-stats">AI-трансформация</span>` +
        `<button type="button" class="btn-sm btn-sm-accent" data-action="accept">✓ Принять</button>` +
        `<button type="button" class="btn-sm" data-action="reject">✕ Отменить</button>` +
      `</div>` +
      `<div class="llm-result-content">${diffHtml}</div>`;

    // Вставляем после textarea
    const parent = _ta.parentNode;
    if (parent) parent.insertBefore(_diffPanel, _ta.nextSibling);

    // Обработчики кнопок
    _diffPanel.querySelector('[data-action="accept"]')?.addEventListener('click', () => {
      _acceptChange();
      hidePopup();
    });
    _diffPanel.querySelector('[data-action="reject"]')?.addEventListener('click', () => {
      hidePopup(true);
    });
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
