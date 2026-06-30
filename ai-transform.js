// file_name: ai-transform.js
/* ============================================================
   AiTransform — Inline AI трансформации выделенного текста
   Выдели текст → кнопка → поле ввода → запрос → diff → принятие
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
  let _onKeyDown = null;
  let _onClickOutside = null;
  let _onContextMenu = null;

  // ── Утилиты ───────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Popup ─────────────────────────────────────────────────
  function ensurePopup() {
    if (_popup && _popup.isConnected) return _popup;
    _popup = document.createElement('div');
    _popup.className = 'ai-transform-popup';
    _popup.style.cssText = [
      'position:fixed;z-index:9500;background:var(--bg2,#1e1e2e);color:var(--text1,#cdd6f4)',
      'border:1px solid var(--border,#45475a);border-radius:10px',
      'padding:8px 12px;box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'display:none;font-size:13px',
    ].join(';');
    document.body.appendChild(_popup);
    return _popup;
  }

  function showPopup(ta, x, y) {
    const popup = ensurePopup();
    _ta = ta;
    _origStart = ta.selectionStart;
    _origEnd = ta.selectionEnd;
    _origText = ta.value.slice(_origStart, _origEnd);

    popup.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:0">
        <span style="color:var(--text3);font-size:11px;white-space:nowrap">🤖</span>
        <input type="text" id="ai-transform-input" class="ai-transform-input"
               placeholder="Что сделать с текстом?"
               style="flex:1;min-width:200px;padding:5px 10px;background:var(--bg0,#11111b);color:var(--text1);border:1px solid var(--border);border-radius:6px;font-size:13px;outline:none"
               autocomplete="off" spellcheck="false">
        <button type="button" id="ai-transform-send" class="ai-transform-btn ai-transform-btn-send" title="Выполнить">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
            <path d="M2 8l12-5-5 12-2-5z"/><path d="M14 3l-5 5"/>
          </svg>
        </button>
        <button type="button" id="ai-transform-accept" class="ai-transform-btn ai-transform-btn-accept" title="Принять" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px">
            <path d="M3 8l4 4 6-7"/>
          </svg>
        </button>
        <button type="button" id="ai-transform-cancel" class="ai-transform-btn ai-transform-btn-cancel" title="Отменить (Esc)" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
      </div>
    `;

    // Позиционирование
    popup.style.display = 'block';
    popup.style.left = x + 'px';
    popup.style.top = (y - 50) + 'px';

    // Коррекция
    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.top < 10) popup.style.top = (y + 10) + 'px';
      if (rect.right > window.innerWidth - 10) popup.style.left = (window.innerWidth - rect.width - 10) + 'px';
      if (rect.left < 10) popup.style.left = '10px';
    });

    // Фокус на input
    const input = popup.querySelector('#ai-transform-input');
    setTimeout(() => input?.focus(), 50);

    // Обработчики
    const sendBtn = popup.querySelector('#ai-transform-send');
    const acceptBtn = popup.querySelector('#ai-transform-accept');
    const cancelBtn = popup.querySelector('#ai-transform-cancel');

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _runTransform(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); hidePopup(true); }
    });

    sendBtn.addEventListener('click', () => _runTransform(input.value));
    acceptBtn.addEventListener('click', () => { _acceptChange(); hidePopup(); });
    cancelBtn.addEventListener('click', () => { hidePopup(true); });
  }

  function hidePopup(restore = false) {
    if (restore && _ta && _origText != null) {
      _ta._skipWordComplete = true;
      _ta.setRangeText(_origText, _origStart, _origEnd, 'end');
      _ta.dispatchEvent(new Event('input', { bubbles: true }));
      _ta._skipWordComplete = false;
    }
    if (_popup) _popup.style.display = 'none';
    _ta = null;
    _suggestedText = '';

    // Убираем обработчики
    if (_onClickOutside) { document.removeEventListener('click', _onClickOutside, true); _onClickOutside = null; }
    if (_onContextMenu) { document.removeEventListener('contextmenu', _onContextMenu, true); _onContextMenu = null; }
  }

  function _showLoading() {
    const popup = ensurePopup();
    const input = popup.querySelector('#ai-transform-input');
    const sendBtn = popup.querySelector('#ai-transform-send');
    if (input) { input.disabled = true; input.placeholder = '⏳ Выполняю...'; }
    if (sendBtn) sendBtn.style.display = 'none';
  }

  function _showResult() {
    const popup = ensurePopup();
    const input = popup.querySelector('#ai-transform-input');
    const sendBtn = popup.querySelector('#ai-transform-send');
    const acceptBtn = popup.querySelector('#ai-transform-accept');
    const cancelBtn = popup.querySelector('#ai-transform-cancel');
    if (input) { input.disabled = false; input.placeholder = 'Введите новый запрос...'; }
    if (sendBtn) sendBtn.style.display = '';
    if (acceptBtn) acceptBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
  }

  // ── Запрос к LLM ─────────────────────────────────────────
  async function _runTransform(instruction) {
    if (!instruction?.trim() || !_ta || !_LLMCore) return;
    if (!_origText?.trim()) { window.Toast?.show('Нет выделенного текста', 'error'); return; }

    _showLoading();

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

      // Показываем diff в textarea
      _showDiffInTextarea();

      _showResult();
      window.Toast?.show('Результат готов. ✓ Принять / ✕ Отмена / правый клик', 'success');

      // Обработчики кликов вне
      _onClickOutside = (e) => {
        if (_popup && !_popup.contains(e.target)) {
          e.preventDefault();
          _acceptChange();
          hidePopup();
        }
      };
      setTimeout(() => document.addEventListener('click', _onClickOutside, true), 0);

      _onContextMenu = (e) => {
        if (_popup && !_popup.contains(e.target)) {
          e.preventDefault();
          hidePopup(true);
          window.Toast?.show('Отменено ✓', 'info');
        }
      };
      setTimeout(() => document.addEventListener('contextmenu', _onContextMenu, true), 0);

    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      _showResult();
    }
  }

  // ── Inline diff в textarea ────────────────────────────────
  function _showDiffInTextarea() {
    if (!_ta || !_origText || !_suggestedText) return;

    // Word-level diff
    const origWords = _origText.split(/(\s+)/);
    const sugWords = _suggestedText.split(/(\s+)/);

    // LCS
    const m = origWords.length;
    const n = sugWords.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = origWords[i - 1] === sugWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

    // Восстанавливаем
    const parts = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origWords[i - 1] === sugWords[j - 1]) {
        parts.unshift({ type: 'eq', text: origWords[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        parts.unshift({ type: 'add', text: sugWords[j - 1] });
        j--;
      } else {
        parts.unshift({ type: 'del', text: origWords[i - 1] });
        i--;
      }
    }

    // Формируем показ в textarea
    // textarea не поддерживает HTML, поэтому показываем результат как текст,
    // а diff-индикатор — через подсветку фона через overlay
    _ta._skipWordComplete = true;
    _ta.setRangeText(_suggestedText, _origStart, _origEnd, 'select');
    _ta.dispatchEvent(new Event('input', { bubbles: true }));
    _ta._skipWordComplete = false;

    // Показываем overlay с diff-подсветкой
    _showDiffOverlay(parts);
  }

  function _showDiffOverlay(parts) {
    // Удаляем старый overlay
    const old = document.getElementById('ai-transform-diff-overlay');
    if (old) old.remove();

    if (!_ta) return;

    const container = _ta.closest('.block-body, .subtab-content, .code-block');
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.id = 'ai-transform-diff-overlay';
    overlay.className = 'ai-transform-diff-overlay';
    overlay.style.cssText = [
      'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none',
      'font-family:monospace;font-size:13px;line-height:1.6;padding:8px',
      'white-space:pre-wrap;word-break:break-word;overflow:auto',
      'color:transparent;mix-blend-mode:normal;z-index:10',
    ].join(';');

    // Подсвечиваем добавления/удаления
    const html = parts.map(p => {
      if (p.type === 'eq') return esc(p.text);
      if (p.type === 'add') return `<span class="ai-transform-added">${esc(p.text)}</span>`;
      if (p.type === 'del') return `<span class="ai-transform-removed">${esc(p.text)}</span>`;
      return esc(p.text);
    }).join('');

    overlay.innerHTML = `<span style="position:relative">${html}</span>`;

    // Позиционируем относительно textarea
    const style = getComputedStyle(_ta);
    overlay.style.font = style.font;
    overlay.style.lineHeight = style.lineHeight;
    overlay.style.padding = style.padding;
    overlay.style.width = _ta.offsetWidth + 'px';
    overlay.style.height = _ta.offsetHeight + 'px';

    container.style.position = 'relative';
    container.appendChild(overlay);

    // Автоскрытие через 5 сек
    setTimeout(() => overlay.remove(), 5000);
  }

  // ── Принятие/отмена ──────────────────────────────────────
  function _acceptChange() {
    if (_ta && _suggestedText) {
      // Текст уже применён через setRangeText в _showDiffInTextarea
      window.Toast?.show('Принято ✓', 'success');
    }
    // Убираем overlay
    const overlay = document.getElementById('ai-transform-diff-overlay');
    if (overlay) overlay.remove();
  }

  // ── Публичный API ────────────────────────────────────────
  function openForSelection(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    if (!sel) { window.Toast?.show('Выделите текст', 'error'); return; }

    // Позиция popup над выделением
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

    // CSS
    if (!document.getElementById('ai-transform-styles')) {
      const style = document.createElement('style');
      style.id = 'ai-transform-styles';
      style.textContent = `
        .ai-transform-added {
          background: rgba(34,197,94,0.2);
          color: #22c55e;
          padding: 1px 2px;
          border-radius: 2px;
        }
        .ai-transform-removed {
          background: rgba(239,68,68,0.2);
          color: #ef4444;
          text-decoration: line-through;
          padding: 1px 2px;
          border-radius: 2px;
        }
        .ai-transform-diff-overlay .ai-transform-added {
          background: rgba(34,197,94,0.3);
          border-bottom: 2px solid #22c55e;
        }
        .ai-transform-diff-overlay .ai-transform-removed {
          background: rgba(239,68,68,0.3);
          border-bottom: 2px solid #ef4444;
        }
        .ai-transform-btn {
          width:28px;height:28px;border-radius:6px;border:1px solid var(--border);
          background:var(--bg1);color:var(--text1);cursor:pointer;
          display:flex;align-items:center;justify-content:center;transition:all .15s;
        }
        .ai-transform-btn:hover { background:var(--bg2); }
        .ai-transform-btn-send { border-color:var(--accent); color:var(--accent); }
        .ai-transform-btn-send:hover { background:var(--accent); color:#fff; }
        .ai-transform-btn-accept { border-color:#22c55e; color:#22c55e; }
        .ai-transform-btn-accept:hover { background:#22c55e; color:#fff; }
        .ai-transform-btn-cancel { border-color:#ef4444; color:#ef4444; }
        .ai-transform-btn-cancel:hover { background:#ef4444; color:#fff; }
        .ai-transform-input:focus { border-color:var(--accent) !important; }
      `;
      document.head.appendChild(style);
    }
  }

  return {
    init,
    openForSelection,
    showPopup,
    hidePopup,
  };
})();
