// file_name: slash-ai.js
/* ============================================================
   SlashAI — Slash-команды с автодополнением и inline diff
   ============================================================ */
'use strict';

window.SlashAI = (() => {
  let _State = null;
  let _LLMCore = null;

  // ── Команды ───────────────────────────────────────────────
  const COMMANDS = [
    { keyword: 'fix',       prompt: 'Исправь орфографические, грамматические и пунктуационные ошибки. Сохрани смысл и стиль. Верни только исправленный текст.', label: 'Исправить ошибки' },
    { keyword: 'shorter',   prompt: 'Сделай текст более кратким. Убери воду и повторы. Сохрани ключевую информацию. Верни только сокращённый текст.', label: 'Сделать короче' },
    { keyword: 'longer',    prompt: 'Расширь текст добавив детали, примеры или пояснения. Сохрани тон. Верни только расширенный текст.', label: 'Сделать длиннее' },
    { keyword: 'formal',    prompt: 'Перефразируй текст в официальном, деловом стиле. Верни только перефразированный текст.', label: 'Официальный стиль' },
    { keyword: 'casual',    prompt: 'Перефразируй текст в дружеском, разговорном стиле. Верни только перефразированный текст.', label: 'Разговорный стиль' },
    { keyword: 'bullets',   prompt: 'Преобразуй текст в структурированный список с пунктами. Верни только список.', label: 'В список' },
    { keyword: 'summarize', prompt: 'Напиши краткое резюме текста в 2-3 предложениях. Верни только резюме.', label: 'Резюме' },
    { keyword: 'continue',  prompt: 'Продолжи текст от того места, где он обрывается, в том же стиле и тоне. Верни только продолжение — не повторяй существующий текст.', label: 'Продолжить' },
    { keyword: 'translate', prompt: 'Переведи текст на русский язык (если на другом) или на английский (если на русском). Верни только перевод.', label: 'Перевести' },
    { keyword: 'brainstorm', prompt: 'Предложи 5-7 идей или вариантов развития текста/темы. Верни список идей.', label: 'Брейншторм' },
    { keyword: 'table',     prompt: 'Преобразуй текст в таблицу. Верни только таблицу в формате Markdown.', label: 'В таблицу' },
    { keyword: 'emoji',     prompt: 'Добавь релевантные эмодзи для выразительности. Верни только текст с эмодзи.', label: 'Добавить эмодзи' },
  ];

  const COMMAND_MAP = Object.fromEntries(COMMANDS.map(c => [c.keyword, c]));

  // ── Состояние ─────────────────────────────────────────────
  let _dropdown = null;
  let _activeTa = null;
  let _slashPos = -1;
  let _filter = '';
  let _selectedIdx = 0;
  let _visible = [];
  let _diffPanel = null;
  let _originalText = '';
  let _suggestedText = '';
  let _onKeyHandler = null;
  let _onClickHandler = null;

  // ── Утилиты ───────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getLineInfo(ta) {
    const pos = ta.selectionStart;
    const text = ta.value;
    let lineStart = pos;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
    const lineText = text.slice(lineStart, pos);
    return { lineStart, lineText, pos };
  }

  // ── Dropdown ──────────────────────────────────────────────
  function ensureDropdown() {
    if (_dropdown && _dropdown.isConnected) return _dropdown;
    _dropdown = document.createElement('div');
    _dropdown.className = 'slash-ai-dropdown';
    _dropdown.style.cssText = [
      'position:fixed;z-index:8500;min-width:220px;max-height:260px;overflow-y:auto',
      'background:var(--bg2,#1e1e2e);color:var(--text1,#cdd6f4)',
      'border:1px solid var(--border,#45475a);border-radius:8px',
      'padding:4px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.45)',
      'display:none',
    ].join(';');
    document.body.appendChild(_dropdown);
    return _dropdown;
  }

  function positionDropdown(ta) {
    const dd = ensureDropdown();
    // Позиционируем под курсором
    const mirror = document.createElement('span');
    mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
    const text = ta.value;
    const pos = ta.selectionStart;
    mirror.textContent = text.slice(0, pos);
    ta.parentNode.appendChild(mirror);
    const rect = mirror.getBoundingClientRect();
    mirror.remove();

    let left = rect.left;
    let top = rect.bottom + 4;
    dd.style.left = left + 'px';
    dd.style.top = top + 'px';

    // Коррекция если выходит за экран
    requestAnimationFrame(() => {
      const ddRect = dd.getBoundingClientRect();
      if (ddRect.right > window.innerWidth - 10) dd.style.left = (window.innerWidth - ddRect.width - 10) + 'px';
      if (ddRect.bottom > window.innerHeight - 10) dd.style.top = (rect.top - ddRect.height - 4) + 'px';
    });
  }

  function renderDropdown() {
    const dd = ensureDropdown();
    if (!_visible.length) { dd.style.display = 'none'; return; }

    dd.innerHTML = '';
    _visible.forEach((cmd, i) => {
      const item = document.createElement('div');
      item.className = 'slash-ai-item' + (i === _selectedIdx ? ' selected' : '');
      item.style.cssText = [
        'padding:6px 10px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px',
        'transition:background .1s',
      ].join(';');
      if (i === _selectedIdx) item.style.background = 'var(--bg1,#11111b)';

      const kw = document.createElement('span');
      kw.style.cssText = 'font-weight:600;color:var(--accent,#89b4fa);min-width:80px;font-family:monospace';
      kw.textContent = '/' + cmd.keyword;

      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:var(--text3,#a6adc8);font-size:11px';
      lbl.textContent = cmd.label;

      item.appendChild(kw);
      item.appendChild(lbl);

      item.addEventListener('mouseenter', () => { _selectedIdx = i; renderDropdown(); });
      item.addEventListener('click', () => { _applyCommand(cmd); hideDropdown(); });

      dd.appendChild(item);
    });
    dd.style.display = 'block';
  }

  function hideDropdown() {
    if (_dropdown) _dropdown.style.display = 'none';
    _activeTa = null;
    _slashPos = -1;
    _filter = '';
    _visible = [];
  }

  // ── Команда ───────────────────────────────────────────────
  async function _applyCommand(cmd) {
    if (!_activeTa || !_LLMCore) return;
    const ta = _activeTa;

    // Убираем slash-команду из текста
    const text = ta.value;
    const beforeSlash = text.slice(0, _slashPos);
    const afterCursor = text.slice(ta.selectionStart);
    const cleanText = beforeSlash + afterCursor;
    ta.value = cleanText;
    ta.selectionStart = _slashPos;
    ta.selectionEnd = _slashPos;
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Сохраняем оригинальный текст
    _originalText = cleanText.trim();
    if (!_originalText) {
      window.Toast?.show('Нет текста для обработки', 'error');
      return;
    }

    window.Toast?.show(`Выполняю: /${cmd.keyword}...`, 'success');
    window.SlashAI?.showDiffPanel?.('loading');

    try {
      const result = await _LLMCore.request({
        messages: [{ role: 'user', content: cmd.prompt + '\n\n---\n\n' + _originalText }],
        stream: false,
        maxTokens: 2000,
        featureTag: 'slash-' + cmd.keyword,
      });

      if (!result?.trim()) {
        window.Toast?.show('LLM не вернул результат', 'error');
        window.SlashAI?.hideDiffPanel?.();
        return;
      }

      _suggestedText = result.trim();
      window.SlashAI?.showDiffPanel?.('diff', _originalText, _suggestedText);
    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      window.SlashAI?.hideDiffPanel?.();
    }
  }

  // ── Inline Diff Panel ─────────────────────────────────────
  function ensureDiffPanel() {
    if (_diffPanel && _diffPanel.isConnected) return _diffPanel;
    _diffPanel = document.createElement('div');
    _diffPanel.className = 'slash-ai-diff-panel';
    _diffPanel.style.cssText = [
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9000',
      'background:var(--bg2,#1e1e2e);color:var(--text1,#cdd6f4)',
      'border:1px solid var(--border,#45475a);border-radius:10px',
      'padding:12px 16px;box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'max-width:600px;max-height:400px;overflow-y:auto;font-size:13px;line-height:1.6',
      'display:none',
    ].join(';');
    document.body.appendChild(_diffPanel);
    return _diffPanel;
  }

  function showDiffPanel(mode, original, suggested) {
    const panel = ensureDiffPanel();

    if (mode === 'loading') {
      panel.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text3)">⏳ Генерация...</div>';
      panel.style.display = 'block';
      return;
    }

    if (mode === 'diff' && original && suggested) {
      const diff = _computeDiff(original, suggested);
      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:600;font-size:12px;color:var(--text2)">Результат</span>
          <div style="display:flex;gap:6px">
            <button type="button" id="slash-ai-accept" class="slash-ai-btn slash-ai-btn-accept">✓ Принять</button>
            <button type="button" id="slash-ai-discard" class="slash-ai-btn slash-ai-btn-discard">✕ Отменить</button>
          </div>
        </div>
        <div class="slash-ai-diff-content">${diff}</div>
      `;
      panel.style.display = 'block';

      document.getElementById('slash-ai-accept')?.addEventListener('click', () => {
        _acceptDiff();
        hideDiffPanel();
      });
      document.getElementById('slash-ai-discard')?.addEventListener('click', () => {
        hideDiffPanel();
        window.Toast?.show('Отменено', 'info');
      });
      return;
    }

    panel.style.display = 'none';
  }

  function hideDiffPanel() {
    if (_diffPanel) _diffPanel.style.display = 'none';
  }

  function _computeDiff(original, suggested) {
    // Простой word-level diff
    const origWords = original.split(/(\s+)/);
    const sugWords = suggested.split(/(\s+)/);

    // LCS для слов
    const m = origWords.length;
    const n = sugWords.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (origWords[i - 1] === sugWords[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // Восстанавливаем diff
    const parts = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origWords[i - 1] === sugWords[j - 1]) {
        parts.unshift({ type: 'equal', text: origWords[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        parts.unshift({ type: 'added', text: sugWords[j - 1] });
        j--;
      } else {
        parts.unshift({ type: 'removed', text: origWords[i - 1] });
        i--;
      }
    }

    // Группируем подряд идущие
    const html = parts.map(p => {
      if (p.type === 'equal') return esc(p.text);
      if (p.type === 'added') return `<span class="slash-ai-added">${esc(p.text)}</span>`;
      if (p.type === 'removed') return `<span class="slash-ai-removed">${esc(p.text)}</span>`;
      return esc(p.text);
    }).join('');

    return html;
  }

  function _acceptDiff() {
    // Заменяем текст в textarea
    const active = document.activeElement;
    if (active && active.tagName === 'TEXTAREA') {
      active.value = _suggestedText;
      active.dispatchEvent(new Event('input', { bubbles: true }));
      window.Toast?.show('Принято ✓', 'success');
    } else {
      // Копируем в буфер
      navigator.clipboard?.writeText(_suggestedText).then(() => {
        window.Toast?.show('Скопировано в буфер обмена', 'success');
      });
    }
  }

  // ── Обработка ввода ───────────────────────────────────────
  function _onKeyDown(e) {
    if (!_dropdown || _dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selectedIdx = (_selectedIdx + 1) % _visible.length;
      renderDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selectedIdx = (_selectedIdx - 1 + _visible.length) % _visible.length;
      renderDropdown();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (_visible[_selectedIdx]) _applyCommand(_visible[_selectedIdx]);
      hideDropdown();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideDropdown();
    }
  }

  function _onInput(e) {
    const ta = e.target;
    if (!ta || ta.tagName !== 'TEXTAREA' || !ta.classList.contains('block-textarea')) {
      hideDropdown();
      return;
    }

    const { lineStart, lineText } = getLineInfo(ta);

    // Ищем / в начале строки
    const slashMatch = lineText.match(/^\/(\w*)$/);
    if (!slashMatch) {
      hideDropdown();
      return;
    }

    _activeTa = ta;
    _slashPos = lineStart;
    _filter = slashMatch[1].toLowerCase();
    _selectedIdx = 0;

    // Фильтруем команды
    _visible = COMMANDS.filter(c =>
      c.keyword.includes(_filter) || c.label.toLowerCase().includes(_filter)
    );

    if (!_visible.length) {
      hideDropdown();
      return;
    }

    _activeTa = ta;
    positionDropdown(ta);
    renderDropdown();
  }

  // ── Инициализация ─────────────────────────────────────────
  let _inited = false;

  function init(State, LLMCore) {
    if (_inited) return;
    _inited = true;
    _State = State;
    _LLMCore = LLMCore;

    document.addEventListener('input', _onInput, true);
    _onKeyHandler = _onKeyDown;
    document.addEventListener('keydown', _onKeyHandler, true);

    // Добавляем CSS
    if (!document.getElementById('slash-ai-styles')) {
      const style = document.createElement('style');
      style.id = 'slash-ai-styles';
      style.textContent = `
        .slash-ai-item:hover { background: var(--bg1, #11111b) !important; }
        .slash-ai-item.selected { background: var(--bg1, #11111b) !important; }
        .slash-ai-added {
          background: rgba(34,197,94,0.15);
          color: #22c55e;
          padding: 1px 2px;
          border-radius: 2px;
        }
        .slash-ai-removed {
          background: rgba(239,68,68,0.15);
          color: #ef4444;
          text-decoration: line-through;
          padding: 1px 2px;
          border-radius: 2px;
        }
        .slash-ai-btn {
          padding: 4px 12px;
          border-radius: 6px;
          border: 1px solid var(--border, #45475a);
          background: var(--bg1, #11111b);
          color: var(--text1, #cdd6f4);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
        }
        .slash-ai-btn:hover { background: var(--bg2, #1e1e2e); }
        .slash-ai-btn-accept {
          background: #22c55e;
          color: #fff;
          border-color: #22c55e;
        }
        .slash-ai-btn-accept:hover { filter: brightness(1.1); }
        .slash-ai-btn-discard {
          border-color: #ef4444;
          color: #ef4444;
        }
        .slash-ai-btn-discard:hover { background: rgba(239,68,68,0.1); }
        .slash-ai-diff-content { margin-top: 8px; }
      `;
      document.head.appendChild(style);
    }
  }

  return {
    init,
    COMMANDS,
    COMMAND_MAP,
    showDiffPanel,
    hideDiffPanel,
    _acceptDiff,
  };
})();
