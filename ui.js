// file_name: ui.js

/* ============================================================
   ui.js — Toast, Tabs, Preview, Search, Snapshots, Templates
   ============================================================ */

'use strict';

/* ---- Shared escape utility ---- */
function escHtmlUi(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---- scheduleSave bridge (set by app.js after load) ---- */
let _uiScheduleSave = () => {};
function setUiSaveBridge(fn) { _uiScheduleSave = fn; }

/* ============================================================
   Toast
   ============================================================ */
const Toast = (() => {
  const el = document.getElementById('toast');

  if (!el) {
    console.error('[Toast] #toast element not found');
  } else {
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
  }

  let timer = null;

  /**
   * Показать toast-уведомление.
   * @param {*}      msg      Текст сообщения (null/undefined → пустая строка)
   * @param {string} [type]   Дополнительный CSS-класс (например, 'error', 'success')
   * @param {number} [duration=2200] Время показа в мс
   */
  function show(msg, type = '', duration = 2200) {
    if (!el) return;

    el.textContent = msg ?? '';

    const suffix = type ? ' ' + type.trim() : '';
    el.className = 'toast show' + suffix;

    clearTimeout(timer);
    timer = setTimeout(
      () => el.classList.remove('show'),
      Number(duration) || 2200
    );
  }

  return { show };
})();

/* ============================================================
   Tabs
   ============================================================ */
const Tabs = (() => {
  const bar = document.getElementById('tabbar');
  if (!bar) {
    console.error('[Tabs] #tabbar element not found');
    return { render() {} };
  }

  bar.setAttribute('role', 'tablist');

  let lastTabClickId = null;
  let lastTabClickAt = 0;
  let _dragTabId = null;

  // Делегированная клавиатурная навигация (WAI-ARIA Tabs Pattern)
  bar.addEventListener('keydown', e => {
    // Не перехватываем события от полей ввода и contenteditable
    if (e.target.closest('input, textarea, [contenteditable]')) return;

    const tab = e.target.closest('.tab');
    if (!tab) return;

    const tabs = Array.from(bar.querySelectorAll('.tab'));
    const idx = tabs.indexOf(tab);
    let nextIdx = -1;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        nextIdx = idx > 0 ? idx - 1 : tabs.length - 1;
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextIdx = idx < tabs.length - 1 ? idx + 1 : 0;
        break;
      case 'Home':
        e.preventDefault();
        nextIdx = 0;
        break;
      case 'End':
        e.preventDefault();
        nextIdx = tabs.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        State.setActive(tab.dataset.id);
        return;
      default:
        return;
    }

    if (nextIdx >= 0 && tabs[nextIdx]) {
      State.setActive(tabs[nextIdx].dataset.id);
    }
  });

  function render() {
    if (!bar) return;

    const hadFocus = bar.contains(document.activeElement)
                     && !document.activeElement?.classList?.contains('tab-rename-input');

    bar.innerHTML = '';
    const active = State.getActive();

    State.getAll().forEach(tab => {
      const isActive = !!(active && tab.id === active.id);

      const el = document.createElement('div');
      el.className = 'tab' + (isActive ? ' active' : '');
      el.dataset.id = tab.id;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(isActive));
      el.tabIndex = isActive ? 0 : -1;
      el.draggable = true;

      // --- Название вкладки ---
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;
      name.title = tab.name || '';

      // dblclick — inline-переименование
      const startRename = e => {
        if (e) e.stopPropagation();
        if (el.querySelector('.tab-rename-input')) return;
        const inp = document.createElement('input');
        inp.className   = 'tab-rename-input';
        inp.value       = tab.name;
        inp.spellcheck  = false;
        inp.maxLength   = 60;
        const commit = () => {
          const v = inp.value.trim() || 'Без имени';
          State.renameTab(tab.id, v);
        };
        inp.onblur    = commit;
        inp.onkeydown = ev => {
          if (ev.key === 'Enter')  { ev.preventDefault(); inp.blur(); }
          if (ev.key === 'Escape') { inp.value = tab.name; inp.blur(); }
          ev.stopPropagation();
        };
        // Предотвращаем всплытие клика, чтобы не сработал setActive (уничтожил бы инпут)
        inp.onclick     = ev => ev.stopPropagation();
        inp.onmousedown = ev => ev.stopPropagation();
        name.replaceWith(inp);
        requestAnimationFrame(() => { inp.focus(); inp.select(); });
      };

      name.ondblclick = startRename;

      // --- Счётчик заполненных блоков ---
      const count = document.createElement('span');
      count.className = 'tab-count';

      const filled = (tab.blocks || []).filter(b => {
        try {
          if (b.type === 'text') {
            const idx = b.activeSubtab ?? 0;
            return ((b.subtabs?.[idx]?.value) || '').trim().length > 0;
          }
          if (b.type === 'snippets') return (b.items || []).some(i => i.enabled);
        } catch (_) {}
        return false;
      }).length;

      count.textContent = filled;

      const labelPrefix = tab._countLabel
        ? tab._countLabel + ' · '
        : (tab.name ? tab.name + ' · ' : '');
      count.title = labelPrefix + filled + ' блоков с содержимым';

      count.ondblclick = e => {
        e.stopPropagation();
        const cur = tab._countLabel || tab.name || '';
        const newLabel = prompt('Название для тултипа вкладки:', cur);
        if (newLabel === null) return;
        tab._countLabel = newLabel.trim();
        count.title = (tab._countLabel ? tab._countLabel + ' · ' : '')
          + filled + ' блоков с содержимым';
      };

      // --- Кнопка закрытия ---
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.innerHTML = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>`;
      close.setAttribute('role', 'button');
      close.setAttribute('tabindex', '0');
      close.setAttribute('aria-label', 'Закрыть вкладку');
      close.title = 'Закрыть (Ctrl+W)';
      close.onclick = e => { e.stopPropagation(); State.closeTab(tab.id); };
      close.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          State.closeTab(tab.id);
        }
      };

      // --- События вкладки ---
      el.onclick = e => {
        if (e.target.closest('.tab-close, .tab-count, .tab-rename-input')) return;

        const now = Date.now();
        const isSecondClick = lastTabClickId === tab.id && now - lastTabClickAt < 450;
        lastTabClickId = tab.id;
        lastTabClickAt = now;

        if (e.detail >= 2 || isSecondClick) { startRename(e); return; }
        State.setActive(tab.id);
        if (typeof Ember !== 'undefined') Ember.triggerReaction('tabSwitch');
      };
      el.onmousedown = e => {
        if (e.button === 1) { e.preventDefault(); State.closeTab(tab.id); }
      };

      // --- Drag & Drop для перетаскивания вкладок ---
      el.ondragstart = e => {
        _dragTabId = tab.id;
        el.classList.add('tab-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
      };
      el.ondragend = () => {
        el.classList.remove('tab-dragging');
        bar.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
        _dragTabId = null;
      };
      el.ondragover = e => {
        if (!_dragTabId || _dragTabId === tab.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        bar.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
        el.classList.add('tab-drag-over');
      };
      el.ondrop = e => {
        e.preventDefault();
        el.classList.remove('tab-drag-over');
        if (_dragTabId && _dragTabId !== tab.id) {
          State.moveTab(_dragTabId, tab.id);
        }
        _dragTabId = null;
      };

      el.appendChild(name);
      el.appendChild(count);
      el.appendChild(close);
      bar.appendChild(el);
    });

    // --- Кнопка «Новая вкладка» ---
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-add';
    add.textContent = '+';
    add.title = 'Новая вкладка (Ctrl+T)';
    add.setAttribute('aria-label', 'Новая вкладка');
    add.onclick = () => State.newTab();
    bar.appendChild(add);

    // Восстанавливаем фокус на активной вкладке, если он был внутри tabbar
    if (hadFocus) {
      const activeEl = bar.querySelector('.tab.active');
      if (activeEl) activeEl.focus();
    }
  }

  return { render };
})();

/* ============================================================
   Preview
   ============================================================ */
const Preview = (() => {
  const panel  = document.getElementById('preview-panel');
  const textEl = document.getElementById('preview-text');
  const mdEl   = document.getElementById('preview-md-content');
  const cnt    = document.getElementById('char-count');

  // Читаем mdMode из State каждый раз в render() — устраняет баг
  // когда IIFE инициализировался до State.load() и значение оставалось false
  // previewMarkdown: true|'md'|'md-hl' = MD; false|'text' = text
  const getMdMode = () => {
    const v = State.getLayout().previewMarkdown;
    return v === true || v === 'md' || v === 'md-hl';
  };
  const getMdHighlight = () => State.getLayout().previewMarkdown === 'md-hl';

  const _enc = new TextEncoder();
  function _byteLen(s) { return _enc.encode(s).length; }
  function estimateTokens(s) { return Math.ceil(s.length / 3.5); }

  /** Безопасный вызов _uiScheduleSave (может отсутствовать при тестах / частичной загрузке) */
  function _safeSave() {
    if (typeof _uiScheduleSave === 'function') _uiScheduleSave();
  }

  function _sanitizeMarkdownHtml(html) {
    // =защита markdown=
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html ?? '');

    const blockedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'META', 'LINK']);
    tpl.content.querySelectorAll('*').forEach(el => {
      if (blockedTags.has(el.tagName)) {
        el.remove();
        return;
      }

      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value ?? '').trim();
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
          el.removeAttribute(attr.name);
          return;
        }
        if ((name === 'href' || name === 'src') && /^(javascript|data:text\/html|vbscript):/i.test(value)) {
          el.removeAttribute(attr.name);
        }
      });
    });

    tpl.content.querySelectorAll('a[target="_blank"]').forEach(a => {
      a.setAttribute('rel', 'noopener noreferrer');
    });

    return tpl.innerHTML;
  }

  function _closeOpenFences(text) {
    const lines = text.split('\n');
    let fence = null;
    for (const line of lines) {
      const m = line.match(/^\s*(```|~~~)/);
      if (m) {
        if (!fence) fence = m[1];
        else if (line.trim().startsWith(fence)) fence = null;
      }
    }
    return fence ? text + '\n' + fence : text;
  }

  // Рендер одного блока в markdown-кусок для превью (используется и для top-level, и для детей группы)
  function _renderBlockPreview(b, vars, showHeaders) {
    if (b.previewDisabled === true) return null;
    const applyVars = str =>
      str.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key] : `{{${key}}}`));

    if (b.type === 'text') {
      const idx = b.activeSubtab ?? 0;
      const raw = (b.subtabs?.[idx]?.value || '').trim();
      const val = applyVars(raw);
      return val ? _closeOpenFences(showHeaders ? `# ${b.title}\n${val}` : val) : null;

    } else if (b.type === 'snippets') {
      const items = (b.items || []).filter(i => i.enabled && (i.value || '').trim());
      if (!items.length) return null;
      const showTitles = b.showTitles !== false;
      const content = items.map(i =>
        (showTitles && i.title) ? `## ${i.title}\n${i.value.trim()}` : i.value.trim()
      ).join('\n\n');
      return _closeOpenFences(showHeaders ? `# ${b.title}\n${applyVars(content)}` : applyVars(content));

    } else if (b.type === 'todo') {
      const sub = b.subtabs?.[b.activeSubtab];
      if (!sub || !sub.items?.length) return null;
      const lines = sub.items
        .filter(it => (it.text || '').trim())
        .map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`);
      if (!lines.length) return null;
      if (sub.name) return `## ${sub.name}\n${_closeOpenFences(showHeaders ? `# ${b.title}\n${lines.join('\n')}` : lines.join('\n'))}`;
      return _closeOpenFences(showHeaders ? `# ${b.title}\n${lines.join('\n')}` : lines.join('\n'));

    } else if (b.type === 'table') {
      const sub = b.subtabs?.[b.activeSubtab];
      if (!sub || !sub.rows?.length) return null;
      const cols = sub.cols || 2;
      const header = sub.rows[0] || [];
      const data = sub.rows.slice(1).filter(r => r.some(c => (c || '').trim()));
      if (!header.some(c => (c || '').trim()) && !data.length) return null;
      const tsep = '| ' + Array(cols).fill('---').join(' | ') + ' |';
      const hdr = '| ' + header.slice(0, cols).map(c => (c || '').trim() || ' ').join(' | ') + ' |';
      const body = data.map(r => '| ' + r.slice(0, cols).map(c => (c || '').trim() || ' ').join(' | ') + ' |');
      const md = [hdr, tsep, ...body].join('\n');
      if (sub.name) return `## ${sub.name}\n${showHeaders ? `# ${b.title}\n${md}` : md}`;
      return showHeaders ? `# ${b.title}\n${md}` : md;
    }
    return null;
  }

  function build() {
    const tab = State.getActive();
    if (!tab) return '';

    const sep         = tab.separator ?? '\n\n';
    const showHeaders = State.getLayout().previewHeaders !== false;

    // Собираем переменные
    const vars = {};
    (tab.blocks || []).filter(b => b.type === 'variable').forEach(v => {
      if (v.variableName) vars[v.variableName] = v.variableValue || '';
    });
    const applyVars = str =>
      str.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key] : `{{${key}}}`));

    const parts = [];

    // Sort blocks by column (left→right) then position (top→bottom) for preview order
    const sortedBlocks = (tab.blocks || []).slice().sort((a, b) => {
      const ca = a.column || 0, cb = b.column || 0;
      if (ca !== cb) return ca - cb;
      return (tab.blocks || []).indexOf(a) - (tab.blocks || []).indexOf(b);
    });

    sortedBlocks.forEach(b => {
      if (b.type === 'commands' || b.type === 'variable') return;
      if (b.type === 'sticky') return;

      if (b.type === 'group' && b.enabled !== false) {
        (b.children || []).forEach(child => {
          const md = _renderBlockPreview(child, vars, showHeaders);
          if (md) parts.push(md);
        });
      } else {
        const md = _renderBlockPreview(b, vars, showHeaders);
        if (md) parts.push(md);
      }
    });

    const raw = parts.join(sep);
    return raw;
  }

  function _syncPanelButtons() {
    const mdBtn = document.getElementById('prev-md');
    if (mdBtn) {
      const v = State.getLayout().previewMarkdown;
      const isHl = v === 'md-hl';
      const isMd = getMdMode();
      mdBtn.classList.toggle('active-btn', isMd);
      mdBtn.textContent = isHl ? 'MD*' : 'MD';
      mdBtn.title = isHl ? 'MD + подсветка кода → Text' : isMd ? 'Markdown → MD + подсветка' : 'Text → Markdown';
    }
    document.getElementById('prev-wrap')
      ?.classList.toggle('active-btn', State.getLayout().previewWrap === false);
  }

  function _fixUnclosedBackticks(text) {
    const lines = text.split('\n');
    let inFence = false;

    return lines.map(line => {
      const trimmed = line.trimStart();

      // Detect fenced code block boundaries (``` or ~~~)
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        inFence = !inFence;
        return line;
      }

      // Inside a code fence — leave untouched
      if (inFence) return line;

      // Outside fences — fix odd inline backtick counts only
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '`' && (i === 0 || line[i - 1] !== '\\')) count++;
      }
      if (count % 2 !== 0) line += '`';
      return line;
    }).join('\n');
  }

  function render() {
    let t = '';
    try { t = build(); } catch (err) {
      console.error('[Preview.render] build() threw:', err);
      if (textEl) textEl.textContent = '[Preview error — см. консоль]';
      _syncPanelButtons();
      return;
    }

    const chars  = t.length;
    const kb     = (_byteLen(t) / 1024).toFixed(2);
    const tokens = estimateTokens(t);
    const lines  = t ? t.split('\n').length : 0;

    if (cnt) {
      cnt.textContent = `${chars.toLocaleString()} симв · ${lines} стр · ${kb} KB · ~${tokens.toLocaleString()} токенов`;
    }

    const mdMode = getMdMode();
    const contentEl = document.getElementById('preview-content');
    const prevScrollPct = contentEl ? contentEl.scrollTop / Math.max(1, contentEl.scrollHeight - contentEl.clientHeight) : 0;

    if (mdMode) {
      if (textEl) textEl.style.display = 'none';
      if (mdEl)   mdEl.style.display   = '';
      if (mdEl) {
        try {
          if (typeof marked !== 'undefined') {
            const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            mdEl.innerHTML = _sanitizeMarkdownHtml(marked.parse(_fixUnclosedBackticks(safe)));
            if (getMdHighlight() && typeof hljs !== 'undefined') {
              mdEl.querySelectorAll('pre code').forEach(block => {
                delete block.dataset.highlighted;
                hljs.highlightElement(block);
              });
            }
          } else {
            mdEl.textContent = t;
          }
        } catch (err) {
          console.error('[Preview.render] marked.parse() threw:', err);
          mdEl.textContent = t;
        }
      }
    } else {
      if (mdEl)   mdEl.style.display   = 'none';
      if (textEl) textEl.style.display = '';
      if (textEl) textEl.textContent   = t;
    }

    if (contentEl) {
      requestAnimationFrame(() => {
        contentEl.scrollTop = prevScrollPct * Math.max(1, contentEl.scrollHeight - contentEl.clientHeight);
      });
    }

    applyFontSize();
    applyWrap();
    _syncPanelButtons();
    renderStructureMenu();
  }

  function applyFontSize() {
    const size = State.getLayout().previewFontSize || 12;
    if (textEl) textEl.style.fontSize = size + 'px';
    if (mdEl)   mdEl.style.fontSize   = size + 'px';
  }

  function applyWrap() {
    if (textEl) textEl.classList.toggle('nowrap', State.getLayout().previewWrap === false);
  }

  function applyHeight() {
    if (panel) panel.style.height = (State.getLayout().previewHeight || 220) + 'px';
  }

  function _trackPreviewCopy(text) {
    window.Intelligence?.track?.('preview.copy', {
      chars: String(text || '').length,
      textHash: window.Intelligence?.hashText?.(text),
      tokens: estimateTokens(String(text || ''))
    });
  }

  /* Учитываем флаг opt-clipboard-api */
  function copy() {
    let t;
    try { t = build(); } catch (err) {
      console.error('[Preview.copy] build() threw:', err);
      Toast.show('Ошибка построения текста', 'error');
      return;
    }
    if (!t) { Toast.show('Нечего копировать', 'error'); return; }

    const clipboardEnabled = window._clipboardApiEnabled !== false;

    if (clipboardEnabled && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t)
        .then(() => {
          Toast.show('Скопировано ✓', 'success');
          _trackPreviewCopy(t);
        })
        .catch(err => { console.warn('[Preview.copy] clipboard API failed:', err); _legacyCopy(t); });
    } else {
      _legacyCopy(t);
    }
  }

  function _legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) {
        Toast.show('Скопировано ✓', 'success');
        _trackPreviewCopy(text);
      } else {
        Toast.show('Не удалось скопировать', 'error');
      }
    } catch (err) {
      console.error('[Preview._legacyCopy]', err);
      Toast.show('Ошибка копирования', 'error');
    }
  }

  function fontInc() {
    State.setLayout({ previewFontSize: Math.min(28, (State.getLayout().previewFontSize || 12) + 1) });
    applyFontSize();
    _safeSave();
  }

  function fontDec() {
    State.setLayout({ previewFontSize: Math.max(8, (State.getLayout().previewFontSize || 12) - 1) });
    applyFontSize();
    _safeSave();
  }

  function toggleMarkdown() {
    const cur = State.getLayout().previewMarkdown;
    let next;
    if (!cur || cur === false || cur === 'text') next = 'md';
    else if (cur === true || cur === 'md') next = 'md-hl';
    else next = 'text';
    State.setLayout({ previewMarkdown: next });
    window.Intelligence?.track?.('preview.markdown.toggle', { mode: next });
    _safeSave();
    render();
  }

  function toggleCollapse() {
    if (!panel) return;
    const wasCollapsed = panel.classList.contains('collapsed');
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('prev-toggle');
    if (btn) btn.classList.toggle('collapsed', panel.classList.contains('collapsed'));
    if (wasCollapsed && typeof Ember !== 'undefined') Ember.onPreviewOpen();
  }

  function toggleWrap() {
    // previewWrap === false → текст не переносится (nowrap)
    // previewWrap !== false → текст переносится нормально
    const wrapEnabled = State.getLayout().previewWrap !== false;
    State.setLayout({ previewWrap: !wrapEnabled });
    window.Intelligence?.track?.('preview.wrap.toggle', {
      nowrap: State.getLayout().previewWrap === false
    });
    _safeSave();
    applyWrap();
    document.getElementById('prev-wrap')
      ?.classList.toggle('active-btn', State.getLayout().previewWrap === false);
  }

  function getText() { return build(); }

  /* ── Structure menu ──────────────────────────────────────────────── */
  const structMenu      = document.getElementById('preview-structure-menu');
  const structBody      = structMenu?.querySelector('.structure-menu-body');
  const structToggleBtn = structMenu?.querySelector('.structure-menu-toggle');
  let _structVisible    = true;
  let _structScrollRaf  = null;
  let _structActiveBg   = null;

  const _typeIcons = {
    text:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5.5h6M5 8h4M5 10.5h5"/></svg>',
    snippets: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4h10M3 7h7M3 10h8M3 13h5"/></svg>',
    group:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
    todo:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 7l1.5 1.5 3-3"/><path d="M5.5 11l1.5 1.5 3-3" opacity=".4"/></svg>',
    table:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/></svg>',
  };

  function _getBlockType(b) {
    if (b.type === 'group') return 'group';
    if (b.type === 'snippets') return 'snippets';
    if (b.type === 'todo') return 'todo';
    if (b.type === 'table') return 'table';
    return 'text';
  }

  function _isBlockEmpty(block) {
    if (block.type === 'snippets') {
      return !(block.items || []).some(i => i.enabled && (i.value || '').trim());
    }
    if (block.type === 'todo') {
      const sub = block.subtabs?.[block.activeSubtab ?? 0];
      return !(sub?.items || []).some(i => (i.text || '').trim());
    }
    if (block.type === 'table') {
      const sub = block.subtabs?.[block.activeSubtab ?? 0];
      return !(sub?.rows || []).some(r => r.some(c => (c || '').trim()));
    }
    if (block.type === 'group') {
      return !(block.children || []).some(c => {
        if (c.previewDisabled === true) return false;
        if (c.type === 'text') {
          const idx = c.activeSubtab ?? 0;
          return (c.subtabs?.[idx]?.value || '').trim();
        }
        if (c.type === 'snippets') {
          return (c.items || []).some(i => i.enabled && (i.value || '').trim());
        }
        if (c.type === 'todo') {
          const sub = c.subtabs?.[c.activeSubtab ?? 0];
          return (sub?.items || []).some(i => (i.text || '').trim());
        }
        if (c.type === 'table') {
          const sub = c.subtabs?.[c.activeSubtab ?? 0];
          return (sub?.rows || []).some(r => r.some(cc => (cc || '').trim()));
        }
        return false;
      });
    }
    if (block.type === 'text') {
      const idx = block.activeSubtab ?? 0;
      return !(block.subtabs?.[idx]?.value || '').trim();
    }
    return true;
  }

  function _extractPreviewText(block) {
    if (block.type === 'snippets') {
      const items = (block.items || []).filter(i => i.enabled && (i.value || '').trim());
      return items.map(i => i.title ? `${i.title}: ${i.value.trim()}` : i.value.trim()).join(' ').slice(0, 120);
    }
    if (block.type === 'group') {
      return (block.children || []).filter(c => c.previewDisabled !== true).map(c => {
        if (c.type === 'text') {
          const idx = c.activeSubtab ?? 0;
          return (c.subtabs?.[idx]?.value || '').trim();
        }
        if (c.type === 'snippets') {
          const items = (c.items || []).filter(i => i.enabled && (i.value || '').trim());
          return items.map(i => i.title ? `${i.title}: ${i.value.trim()}` : i.value.trim()).join(' ');
        }
        if (c.type === 'todo') {
          const idx = c.activeSubtab ?? 0;
          const items = c.subtabs?.[idx]?.items || [];
          return items.filter(i => i.text?.trim()).map(i => `${i.done ? '☑' : '☐'} ${i.text}`).join(' ');
        }
        if (c.type === 'table') {
          const idx = c.activeSubtab ?? 0;
          const sub = c.subtabs?.[idx];
          if (!sub?.rows?.length) return '';
          return sub.rows.map(r => r.join(' | ')).join(' / ');
        }
        return '';
      }).filter(Boolean).join(' ').slice(0, 120);
    }
    if (block.type === 'text') {
      const idx = block.activeSubtab ?? 0;
      return (block.subtabs?.[idx]?.value || '').trim().slice(0, 120);
    }
    if (block.type === 'todo') {
      const idx = block.activeSubtab ?? 0;
      const items = block.subtabs?.[idx]?.items || [];
      return items.filter(i => i.text?.trim()).map(i => `${i.done ? '☑' : '☐'} ${i.text}`).join(' ').slice(0, 120);
    }
    if (block.type === 'table') {
      const idx = block.activeSubtab ?? 0;
      const sub = block.subtabs?.[idx];
      if (!sub?.rows?.length) return '';
      return sub.rows.map(r => r.join(' | ')).join(' / ').slice(0, 120);
    }
    return '';
  }

  function _isCodeOnlyBlock(b) {
    if (b.type !== 'text') return false;
    const idx = b.activeSubtab ?? 0;
    const raw = (b.subtabs?.[idx]?.value || '').trim();
    if (!raw) return false;
    const lines = raw.split('\n');
    let inFence = false;
    let codeLines = 0;
    let totalLines = 0;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      totalLines++;
      if (inFence) codeLines++;
    }
    return totalLines > 0 && codeLines / totalLines > 0.8;
  }

  function _buildMenu() {
    if (!structBody) return;
    const tab = State.getActive();
    if (!tab) { structBody.innerHTML = ''; return; }

    const entries = [];

    // Sort by column (left→right) then position — same as getText() preview order
    const ordered = (tab.blocks || []).slice().sort((a, b) => {
      const ca = a.column || 0, cb = b.column || 0;
      if (ca !== cb) return ca - cb;
      return (tab.blocks || []).indexOf(a) - (tab.blocks || []).indexOf(b);
    });

    ordered.forEach(b => {
      if (b.type === 'commands' || b.type === 'variable') return;
      if (b.type === 'todo' || b.type === 'table') {
        if (b.previewDisabled === true) return;
        if (_isBlockEmpty(b)) return;
        entries.push({ id: b.id, title: b.title || 'Без названия', type: _getBlockType(b), text: _extractPreviewText(b) });
        return;
      }
      if (b.previewDisabled === true) return;
      if (_isBlockEmpty(b)) return;
      if (_isCodeOnlyBlock(b)) return;

      if (b.type === 'group' && b.enabled !== false) {
        (b.children || []).forEach(child => {
          if (child.previewDisabled === true) return;
          if (_isBlockEmpty(child)) return;
          if (child.type === 'text' && _isCodeOnlyBlock(child)) return;
          entries.push({ id: child.id, title: child.title || 'Без названия', type: _getBlockType(child), text: _extractPreviewText(child) });
        });
      } else {
        entries.push({ id: b.id, title: b.title || 'Без названия', type: _getBlockType(b), text: _extractPreviewText(b) });
      }
    });

    if (!entries.length) { structBody.innerHTML = ''; if (_structActiveBg) structBody.appendChild(_structActiveBg); return; }

    structBody.innerHTML = entries.map(e => {
      const icon = _typeIcons[e.type] || _typeIcons.text;
      const title = escHtmlUi(e.title);
      const preview = escHtmlUi(e.text.slice(0, 120));
      return `<div class="structure-item" data-block-id="${e.id}">
        <span class="structure-item-icon">${icon}</span>
        <div class="structure-item-body">
          <div class="structure-item-name">${title}</div>
          <div class="structure-item-text">${preview}</div>
        </div>
      </div>`;
    }).join('');
    if (_structActiveBg) structBody.appendChild(_structActiveBg);
    _lastActiveId = null;
    _highlightActiveByScroll();
  }

  let _lastActiveId = null;
  let _structIO = null;
  let _structVisibleSet = new Set();

  function _highlightActiveByScroll() {
    if (!structBody) return;
    const isMd = getMdMode();
    const src = isMd ? mdEl : textEl;
    if (!src) return;
    const container = src.closest('#preview-content');
    if (!container) return;

    const items = [...structBody.querySelectorAll('.structure-item')];
    if (!items.length) return;

    const scrollMax = container.scrollHeight - container.clientHeight;
    const ratio = scrollMax > 0 ? Math.min(1, Math.max(0, container.scrollTop / scrollMax)) : 0;

    const totalH = structBody.clientHeight;
    const bgH = items[0].offsetHeight;
    const maxTop = Math.max(0, totalH - bgH);
    const targetY = Math.min(maxTop, ratio * maxTop);

    if (_structActiveBg) {
      _structActiveBg.style.top = targetY + 'px';
      _structActiveBg.style.height = bgH + 'px';
    }

    if (!isMd || !mdEl) {
      let bestIdx = 0;
      let bestDist = Infinity;
      items.forEach((item, i) => {
        const dist = Math.abs(item.offsetTop - targetY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      });
      const newName = items[bestIdx].querySelector('.structure-item-name')?.textContent?.trim() || '';
      if (newName !== _lastActiveId) {
        _lastActiveId = newName;
        items.forEach((i, idx) => i.classList.toggle('active', idx === bestIdx));
      }
    } else {
      items.forEach(item => {
        const nameEl = item.querySelector('.structure-item-name');
        const name = nameEl?.textContent?.trim() || '';
        item.classList.toggle('active', _structVisibleSet.has(name));
      });
    }
  }

  function _setupStructIO() {
    if (_structIO) { _structIO.disconnect(); _structIO = null; }
    _structVisibleSet.clear();
    if (!getMdMode() || !mdEl) return;
    const container = mdEl.closest('#preview-content');
    if (!container) return;

    const headings = mdEl.querySelectorAll('h1, h2, h3');
    if (!headings.length) return;

    _structIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const hText = e.target.textContent.replace(/^\s*#+\s*/, '').trim();
        if (e.isIntersecting) _structVisibleSet.add(hText);
        else _structVisibleSet.delete(hText);
      }
      _highlightActiveByScroll();
    }, { root: container, threshold: 0 });

    headings.forEach(h => {
      if (h.closest('pre, code')) return;
      _structIO.observe(h);
    });
  }

  function _onPreviewScroll() {
    if (_structScrollRaf) return;
    _structScrollRaf = requestAnimationFrame(() => {
      _structScrollRaf = null;
      _highlightActiveByScroll();
    });
  }

  function _setupStructScroll() {
    const container = mdEl?.closest('#preview-content') || textEl?.closest('#preview-content');
    if (!container) return;
    container.removeEventListener('scroll', _onPreviewScroll);
    container.addEventListener('scroll', _onPreviewScroll, { passive: true });
    _setupStructIO();
    _highlightActiveByScroll();
  }

  function _initStructMenu() {
    if (structToggleBtn) {
      structToggleBtn.addEventListener('click', () => {
        structMenu.classList.toggle('collapsed');
        const isCollapsed = structMenu.classList.contains('collapsed');
        structToggleBtn.textContent = isCollapsed ? '▼' : '▲';
      });
    }

    const structTitle = structMenu?.querySelector('.structure-menu-title');
    if (structTitle) {
      structTitle.addEventListener('dblclick', () => {
        structMenu.classList.toggle('collapsed');
        const isCollapsed = structMenu.classList.contains('collapsed');
        if (structToggleBtn) structToggleBtn.textContent = isCollapsed ? '▼' : '▲';
      });
    }

    if (structBody) {
      structBody.style.position = 'relative';
      _structActiveBg = document.createElement('div');
      _structActiveBg.className = 'structure-active-bg';
      structBody.appendChild(_structActiveBg);
    }

    if (structBody) {
      structBody.addEventListener('click', (e) => {
        const item = e.target.closest('.structure-item');
        if (!item) return;
        const blockId = item.dataset.blockId;
        const nameEl = item.querySelector('.structure-item-name');
        const blockTitle = nameEl?.textContent?.trim() || '';
        const isMd = getMdMode();

        // MD-режим: ищем заголовок в превью (только свободные h1-h3, не внутри code/pre)
        if (isMd && mdEl && blockTitle) {
          const headings = mdEl.querySelectorAll('h1, h2, h3');
          for (const h of headings) {
            if (h.closest('pre, code')) continue;
            const hText = h.textContent.replace(/^\s*#+\s*/, '').trim();
            if (hText === blockTitle) {
              const container = mdEl.closest('#preview-content');
              if (container) {
                const hTop = h.offsetTop - container.offsetTop;
                container.scrollTo({ top: Math.max(0, hTop - 10), behavior: 'smooth' });
              }
              h.classList.add('block-flash');
              setTimeout(() => h.classList.remove('block-flash'), 1200);
              return;
            }
          }
          // Fallback: если заголовок не найден как элемент, ищем по тексту в превью
          const titlePat = blockTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const mdText = mdEl.innerText || mdEl.textContent || '';
          const match = mdText.match(new RegExp('(?:^|\\n)#\\s*' + titlePat + '(?:\\n|$|\\s)', 'm'));
          if (match) {
            const container = mdEl.closest('#preview-content');
            if (container) {
              const approxTop = (match.index / mdText.length) * mdEl.scrollHeight;
              container.scrollTo({ top: Math.max(0, approxTop - 10), behavior: 'smooth' });
            }
            return;
          }
        }

        // Текстовый режим: ищем позицию блока в превью по тексту
        if (!isMd && textEl && blockTitle) {
          const previewText = textEl.innerText || textEl.textContent || '';
          const titlePat = blockTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = previewText.match(new RegExp('(?:^|\\n)#\\s*' + titlePat + '(?:\\n|$|\\s)', 'm'));
          if (match) {
            const container = textEl.closest('#preview-content');
            if (container) {
              const pos = match.index;
              const approxTop = (pos / previewText.length) * textEl.scrollHeight;
              container.scrollTo({ top: Math.max(0, approxTop - 10), behavior: 'smooth' });
            }
            return;
          }
        }

        // Fallback — фокус на textarea в редакторе
        if (blockId) {
          const el = document.querySelector(`.block[data-id="${blockId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('block-flash');
            setTimeout(() => el.classList.remove('block-flash'), 1200);
            const ta = el.querySelector('textarea.block-textarea, textarea');
            if (ta) ta.focus();
          }
        }
      });
    }
  }

  function _getPreviewClickBlockId(e) {
    const items = [...structBody.querySelectorAll('.structure-item')];
    if (!items.length) return null;

    const target = e.target;
    const isMd = getMdMode();

    if (isMd && mdEl && mdEl.contains(target)) {
      const allH1 = [...mdEl.querySelectorAll('h1')].filter(h => !h.closest('pre, code'));
      let node = target;
      while (node && node !== mdEl) {
        if (/^H[1-3]$/.test(node.tagName) && !node.closest('pre, code')) {
          let h = node;
          while (h && h.tagName !== 'H1' && h !== mdEl) h = h.previousElementSibling || h.parentElement;
          if (h && h.tagName === 'H1') {
            const idx = allH1.indexOf(h);
            if (idx >= 0 && idx < items.length) return items[idx].dataset.blockId;
          }
        }
        let sib = node.previousElementSibling;
        while (sib) {
          if (/^H[1-3]$/.test(sib.tagName) && !sib.closest('pre, code')) {
            let h = sib;
            while (h && h.tagName !== 'H1' && h !== mdEl) h = h.previousElementSibling || h.parentElement;
            if (h && h.tagName === 'H1') {
              const idx = allH1.indexOf(h);
              if (idx >= 0 && idx < items.length) return items[idx].dataset.blockId;
            }
          }
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      return items[0]?.dataset.blockId || null;
    }

    if (!isMd && textEl && textEl.contains(target)) {
      const clickY = e.clientY;
      let bestItem = null;
      let bestDist = Infinity;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(clickY - mid);
        if (dist < bestDist) { bestDist = dist; bestItem = item; }
      }
      return bestItem?.dataset.blockId || null;
    }

    return null;
  }

  function _initPreviewClickToBlock() {
    const previewContainer = document.getElementById('preview-content');
    if (!previewContainer) return;
    previewContainer.addEventListener('click', (e) => {
      if (e.target.closest('.structure-menu')) return;
      const blockId = _getPreviewClickBlockId(e);
      if (!blockId) return;
      const el = document.querySelector(`.block[data-id="${blockId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const ta = el.querySelector('textarea.block-textarea, textarea');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      }
      panel.classList.add('collapsed');
      const btn = document.getElementById('prev-toggle');
      if (btn) btn.classList.add('collapsed');
    }, false);
  }

  function renderStructureMenu() {
    if (!_structVisible) return;
    _buildMenu();
    _setupStructScroll();
  }

  /* ── Preview Logo: Ambient proximity animation ── */
  (() => {
    const brand = document.querySelector('.preview-brand');
    const logo = brand?.querySelector('.preview-logo');
    const svgPath = logo?.querySelector('.preview-logo-path');
    const reflection = logo?.querySelector('.preview-logo-reflection');
    const grain = logo?.querySelector('.preview-logo-grain');
    const panelGlow = brand?.querySelector('.preview-logo-panel-glow');
    if (!brand || !logo || !svgPath || !reflection || !grain || !panelGlow) return;

    const RANGE = 100;
    const FADE_SPEED = 3;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    let mouseX = -999, mouseY = -999;
    let current = 0;
    let reflectionPos = 0;
    let rafId = null;
    let lastTs = 0;

    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function rect() { return logo.getBoundingClientRect(); }

    function tick(ts) {
      if (!lastTs) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, 0.1);
      lastTs = ts;

      /* Proximity */
      const r = rect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(mouseX - cx, mouseY - cy);
      const t = clamp(1 - dist / RANGE, 0, 1);
      const target = smoothstep(t);

      /* Exponential decay */
      current += (target - current) * dt * FADE_SPEED;
      if (Math.abs(current) < 0.001 && target === 0) {
        current = 0;
        rafId = null;
        applyState(0);
        return;
      }

      applyState(current);

      /* Reflection drift — 8s full cycle, 2px amplitude */
      reflectionPos += dt * 0.05;
      const refShift = Math.sin(reflectionPos) * 2;
      reflection.style.backgroundPosition = `${50 + refShift}% ${50 + refShift}%`;

      rafId = requestAnimationFrame(tick);
    }

    function applyState(p) {
      /* Material: brightness 1→..., contrast 1→..., saturate 1→... */
      const b = 1 + p * 0.83;
      const c = 1 + p * 0.18;
      const s = 1 + p * 0.45;
      svgPath.style.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;

      /* Reflection opacity: 0→0.10 */
      reflection.style.opacity = String(p * 0.10);

      /* Inner cut edge brightening — subtle stroke glow via drop-shadow */
      if (p > 0.01) {
        const e = p * 0.16;
        svgPath.style.filter += ` drop-shadow(0 0 1px rgba(255,255,255,${e}))`;
      }

      /* Grain: 2%→4% */
      grain.style.opacity = String(0.02 + p * 0.02);

      /* Panel glow: 0→0.03 */
      panelGlow.style.opacity = String(p * 0.03);
    }

    brand.addEventListener('mousemove', e => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(tick); }
    });

    brand.addEventListener('mouseleave', () => {
      mouseX = -999;
      mouseY = -999;
      if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(tick); }
    });
  })();

  _initStructMenu();
  _initPreviewClickToBlock();

  return {
    render, copy, applyHeight, fontInc, fontDec,
    toggleMarkdown, toggleCollapse, toggleWrap, getText,
    renderStructureMenu,
  };
})();

// =глобальный доступ=
// LLM-модуль живёт в отдельном файле и читает Preview через window.
window.Preview = Preview;
window.Toast = Toast;
window.Tabs = Tabs;

/* ============================================================
   Search  (floating panel, no overlay)
   ============================================================ */
const Search = (() => {
  const panel        = document.getElementById('search-panel');
  const searchInput  = document.getElementById('search-input');
  const replaceInput = document.getElementById('replace-input');
  const caseCheck    = document.getElementById('search-case');
  const regexCheck   = document.getElementById('search-regex');
  const wordCheck    = document.getElementById('search-word');
  const allTabsCheck = document.getElementById('search-all-tabs');
  const countEl      = document.getElementById('search-count');
  const resultsEl    = document.getElementById('search-results');

  let lastResults     = [];
  let flatMatches     = [];
  let currentMatch    = -1;
  let _open           = false;
  let _highlightTimer = null;

  // Живая область для скринридеров
  if (countEl) {
    countEl.setAttribute('aria-live', 'polite');
    countEl.setAttribute('aria-atomic', 'true');
  }

  /* ---- open / close ---- */

  function open(presetQuery) {
    if (!panel) return;
    _open = true;
    panel.style.display = 'flex';
    if (presetQuery && searchInput) {
      searchInput.value = presetQuery;
    }
    searchInput?.focus();
    searchInput?.select();
    doSearch();
    _syncClearBtn();
  }

  function close() {
    _open = false;
    if (_highlightTimer) {
      clearTimeout(_highlightTimer);
      _highlightTimer = null;
    }
    if (!panel) return;
    panel.style.display = 'none';
    document.querySelectorAll('.block.search-active').forEach(el =>
      el.classList.remove('search-active')
    );
  }

  function isOpen() {
    return _open;
  }

  /* ---- options ---- */

  function getOpts() {
    return {
      caseSensitive: caseCheck?.checked    ?? false,
      regex:         regexCheck?.checked   ?? false,
      wholeWord:     wordCheck?.checked    ?? false,
      allTabs:       allTabsCheck?.checked ?? false,
    };
  }

  function makeRe(q, opts, global = false) {
    const flags = (opts.caseSensitive ? '' : 'i') + (global ? 'g' : '');
    try {
      let pattern = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (opts.wholeWord) pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
      return new RegExp(pattern, flags + 'u');
    } catch (_) { return null; }
  }

  /* ---- search ---- */

  function doSearch() {
    const q = searchInput?.value ?? '';
    if (!q) {
      if (countEl)   countEl.textContent = '';
      if (resultsEl) resultsEl.innerHTML = '';
      lastResults  = [];
      flatMatches  = [];
      currentMatch = -1;
      updateNavButtons();
      return;
    }

    lastResults = State.searchAll(q, getOpts());
    const total = lastResults.reduce((s, r) => s + r.matches.length, 0);

    flatMatches  = [];
    lastResults.forEach(r => r.matches.forEach((_, mi) => flatMatches.push({ result: r, matchIdx: mi })));
    currentMatch = flatMatches.length ? 0 : -1;

    if (countEl) {
      countEl.textContent = total ? `${total} совп.` : 'Не найдено';
      countEl.style.color = total ? 'var(--green)' : 'var(--red)';
    }

    updateNavButtons();
    renderResults(q);
  }

  /* ---- prev / next navigation ---- */

  function updateNavButtons() {
    const has = flatMatches.length > 0;
    const prevBtn = document.getElementById('search-prev');
    const nextBtn = document.getElementById('search-next');
    if (prevBtn) prevBtn.disabled = !has;
    if (nextBtn) nextBtn.disabled = !has;
  }

  function updateCountForCurrent() {
    if (!countEl) return;
    countEl.textContent = flatMatches.length
      ? `${currentMatch + 1} / ${flatMatches.length}`
      : '';
    countEl.style.color = 'var(--green)';
  }

  function gotoMatch(delta) {
    if (!flatMatches.length) return;
    currentMatch = (currentMatch + delta + flatMatches.length) % flatMatches.length;
    const { result, matchIdx } = flatMatches[currentMatch];
    navigateTo(result, matchIdx);
    updateCountForCurrent();
  }

  function navigateTo(result, matchIdx = 0) {
    if (result.tabId && result.tabId !== State.getActive()?.id) {
      State.setActive(result.tabId);
    }

    State.update(tab => {
      const blk = State.findBlock(tab.blocks, result.blockId);
      if (!blk) return;
      if (result.subtabIdx != null) blk.activeSubtab = result.subtabIdx;
      if (blk.collapsed) blk.collapsed = false;
    });

    requestAnimationFrame(() => {
      const blockEl = document.querySelector(`.block[data-id="${result.blockId}"]`);
      if (!blockEl) return;

      blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Подсветка блока с контролируемым таймером
      blockEl.classList.remove('search-active');
      void blockEl.offsetWidth;
      blockEl.classList.add('search-active');

      if (_highlightTimer) clearTimeout(_highlightTimer);
      _highlightTimer = setTimeout(() => {
        blockEl.classList.remove('search-active');
        _highlightTimer = null;
      }, 1400);

      const match = result.matches[matchIdx];
      if (!match) return;

      const ta = blockEl.querySelector('textarea.block-textarea');
      if (ta) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(match.index, match.index + match.length);
        const linesBefore = ta.value.slice(0, match.index).split('\n').length - 1;
        const lineHeight  = parseInt(getComputedStyle(ta).lineHeight, 10) || 18;
        ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
      }
    });
  }

  /* ---- render result list ---- */

  function renderResults(q) {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';

    const opts     = getOpts();
    const showTabs = opts.allTabs;

    let snipRe = null;
    try {
      const escaped = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pat     = opts.wholeWord
        ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
        : escaped;
      snipRe = new RegExp(pat, (opts.caseSensitive ? 'g' : 'gi') + 'u');
    } catch (_) { /* невалидный regex — не подсвечиваем */ }

    lastResults.slice(0, 20).forEach(r => {
      const div = document.createElement('div');
      div.className = 'search-result-item';

      const header = document.createElement('div');
      header.className = 'search-result-header';
      header.innerHTML =
        (showTabs && r.tabName ? `<span class="search-tab-badge">${escHtmlUi(r.tabName)}</span>` : '') +
        `<strong>${escHtmlUi(r.blockTitle)}</strong>` +
        (r.subtabLabel ? `<span class="search-subtab">· вкладка ${escHtmlUi(r.subtabLabel)}</span>` : '') +
        (r.itemTitle   ? `<span class="search-subtab">· ${escHtmlUi(r.itemTitle)}</span>` : '') +
        `<span class="search-match-count">${r.matches.length}</span>`;

      const preview = document.createElement('div');
      preview.className = 'search-result-preview';

      if (snipRe && r.matches.length) {
        const firstIdx = r.matches[0].index;
        const start = Math.max(0, firstIdx - 80);
        const end = Math.min(r.value.length, firstIdx + 120);
        const prefix = start > 0 ? '…' : '';
        const suffix = end < r.value.length ? '…' : '';
        const snip = escHtmlUi(prefix + r.value.slice(start, end) + suffix);
        preview.innerHTML = snip.replace(snipRe, m => `<mark>${m}</mark>`);
      } else if (snipRe) {
        const snip = escHtmlUi(r.value.slice(0, 200));
        preview.innerHTML = snip.replace(snipRe, m => `<mark>${m}</mark>`);
      } else {
        preview.textContent = r.value.slice(0, 200);
      }

      div.appendChild(header);
      div.appendChild(preview);

      // Синхронизируем currentMatch при клике по результату
      div.addEventListener('click', () => {
        const idx = flatMatches.findIndex(fm => fm.result === r);
        if (idx !== -1) {
          currentMatch = idx;
          updateCountForCurrent();
        }
        navigateTo(r, 0);
      });

      resultsEl.appendChild(div);
    });
  }

  /* ---- replace ---- */

  function replaceOne() {
    const q   = searchInput?.value  ?? '';
    const rep = replaceInput?.value ?? '';
    if (!q) return;
    if (!flatMatches.length) { Toast.show('Совпадений не найдено', 'error'); return; }

    const { result, matchIdx } = flatMatches[currentMatch];
    const opts     = getOpts();
    const globalRe = makeRe(q, opts, true);
    if (!globalRe) { Toast.show('Неверное регулярное выражение', 'error'); return; }

    State.update(tab => {
      const blk = State.findBlock(tab.blocks, result.blockId);
      if (!blk) return;

      // Заменяет N-е вхождение (matchIdx), а не первое попавшееся
      const applyReplace = (value) => {
        let nth = 0;
        return value.replace(globalRe, m => (nth++ === matchIdx ? rep : m));
      };

      if (blk.type === 'text' && result.subtabIdx != null) {
        blk.subtabs[result.subtabIdx].value = applyReplace(blk.subtabs[result.subtabIdx].value);
      } else if (blk.type === 'snippets' && result.itemId) {
        const item = (blk.items || []).find(i => i.id === result.itemId);
        if (item) item.value = applyReplace(item.value);
      }
    });

    Toast.show('Заменено ✓', 'success');
    doSearch();
  }

  function replaceAll() {
    const q   = searchInput?.value  ?? '';
    const rep = replaceInput?.value ?? '';
    if (!q) return;

    const count = State.replaceAll(q, rep, getOpts());
    if (count) {
      Toast.show(`Заменено ${count} вхождений ✓`, 'success');
      doSearch();
    } else {
      Toast.show('Совпадений не найдено', 'error');
    }
  }

  /* ---- resize handle ---- */
  (function initSearchPanelResize() {
    const handle = document.getElementById('sp-resize-handle');
    if (!panel || !handle) return;
    const STORAGE_KEY = 'searchPanelHeight';
    const MIN_H = 120;
    function maxH() { return Math.floor(window.innerHeight * 0.8); }
    function applyHeight(h) {
      const clamped = Math.min(Math.max(h, MIN_H), maxH());
      panel.style.height = clamped + 'px';
      return clamped;
    }
    const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (!Number.isNaN(saved)) applyHeight(saved);
    let dragging = false, startY = 0, startH = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true; startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      panel.classList.add('sp-resizing'); e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      applyHeight(startH + (e.clientY - startY));
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; panel.classList.remove('sp-resizing');
      localStorage.setItem(STORAGE_KEY, Math.round(panel.getBoundingClientRect().height));
    });
    window.addEventListener('resize', () => {
      applyHeight(panel.getBoundingClientRect().height);
    });
  })();

  /* ---- event wiring ---- */

  if (searchInput)   searchInput.addEventListener('input',   doSearch);
  if (caseCheck)     caseCheck.addEventListener('change',    doSearch);
  if (regexCheck)    regexCheck.addEventListener('change',   doSearch);
  if (wordCheck)     wordCheck.addEventListener('change',    doSearch);
  if (allTabsCheck)  allTabsCheck.addEventListener('change', doSearch);

  /* ---- clear buttons ---- */
  const clearBtn = document.getElementById('search-clear');
  function _syncClearBtn() { if (clearBtn) clearBtn.style.display = searchInput?.value ? 'flex' : 'none'; }
  if (searchInput) searchInput.addEventListener('input', _syncClearBtn);
  clearBtn?.addEventListener('click', () => {
    if (searchInput) { searchInput.value = ''; searchInput.focus(); doSearch(); _syncClearBtn(); }
  });

  const clearReplaceBtn = document.getElementById('replace-clear');
  function _syncClearReplaceBtn() { if (clearReplaceBtn) clearReplaceBtn.style.display = replaceInput?.value ? 'flex' : 'none'; }
  if (replaceInput) replaceInput.addEventListener('input', _syncClearReplaceBtn);
  clearReplaceBtn?.addEventListener('click', () => {
    if (replaceInput) { replaceInput.value = ''; replaceInput.focus(); _syncClearReplaceBtn(); }
  });

  document.getElementById('search-close')?.addEventListener('click', close);
  document.getElementById('btn-replace-one')?.addEventListener('click', replaceOne);
  document.getElementById('btn-replace-all')?.addEventListener('click', replaceAll);
  document.getElementById('search-prev')?.addEventListener('click', () => gotoMatch(-1));
  document.getElementById('search-next')?.addEventListener('click', () => gotoMatch(+1));

  searchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? gotoMatch(-1) : gotoMatch(+1); }
    if (e.key === 'Escape') close();
  });

  document.addEventListener('keydown', e => {
    const ctrl    = e.ctrlKey || e.metaKey;
    const inField = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);

    if (ctrl && e.code === 'KeyF') {
      if (!inField || !isOpen()) { e.preventDefault(); open(); }
    }
    if (e.key === 'F3') {
      e.preventDefault();
      if (!isOpen()) { open(); return; }
      e.shiftKey ? gotoMatch(-1) : gotoMatch(+1);
    }
    // Не дёргаем close() дважды — searchInput уже обработал свой Escape
    if (e.key === 'Escape' && isOpen() && e.target !== searchInput) {
      close();
    }
  });

  document.addEventListener('click', e => {
    if (isOpen() && panel && !panel.contains(e.target)) {
      const btnSearch = document.getElementById('btn-search');
      if (!btnSearch?.contains(e.target) && !e.target.closest('.block-search-btn')) close();
    }
  });

  return { open, close, isOpen };
})();

/* ============================================================
   Snapshots
   ============================================================ */
const Snapshots = (() => {
  const modal     = document.getElementById('snapshots-modal');
  const listEl    = document.getElementById('snapshots-list');
  const nameInput = document.getElementById('snap-name-input');

  /* ---- Внутреннее состояние модуля ---- */
  let lastFocusedEl = null;
  let saveLock      = false;

  /* ---- Управление модальным окном ---- */
  function open() {
    if (!modal) return;
    lastFocusedEl = document.activeElement;
    modal.style.display = 'flex';
    modal.setAttribute('aria-modal', 'true');
    if (!modal.hasAttribute('role')) modal.setAttribute('role', 'dialog');
    renderList();
    // requestAnimationFrame даёт браузеру отрисовать элемент перед focus()
    if (nameInput) requestAnimationFrame(() => nameInput.focus());
  }

  function close() {
    if (!modal) return;
    modal.style.display = 'none';
    modal.removeAttribute('aria-modal');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  /* ---- Diff overlay ---- */
  let _diffFontSize = 13;
  let _diffChanges = [];
  let _diffCurrent = 0;

  function showDiff(snap) {
    try {
      const snapData = JSON.parse(snap.data);
      const snapText = DiffEngine.extractTextFromSnapshot(snapData);
      const curTab = State.getActive();
      const curText = DiffEngine.extractTextFromSnapshot({ blocks: curTab?.blocks, separator: curTab?.separator });
      const ops = DiffEngine.computeDiff(snapText, curText);
      const stats = DiffEngine.renderStats(ops);
      const html = DiffEngine.renderInlineDiff(ops);

      let overlay = document.getElementById('snap-diff-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'snap-diff-overlay';
        overlay.className = 'snap-diff-overlay';
        overlay.innerHTML = `
          <div class="snap-diff-panel">
            <div class="snap-diff-header">
              <span class="snap-diff-title">Diff</span>
              <span class="snap-diff-stats"></span>
              <span class="snap-diff-nav">
                <button type="button" class="snap-diff-nav-btn" data-dir="-1" title="Предыдущее изменение" aria-label="Предыдущее изменение">▲</button>
                <span class="snap-diff-counter">0/0</span>
                <button type="button" class="snap-diff-nav-btn" data-dir="1" title="Следующее изменение" aria-label="Следующее изменение">▼</button>
              </span>
              <span class="snap-diff-font-ctrl">
                <button type="button" class="snap-diff-font-btn" data-diff-font="dec" title="Уменьшить шрифт" aria-label="Уменьшить шрифт">A−</button>
                <button type="button" class="snap-diff-font-btn" data-diff-font="inc" title="Увеличить шрифт" aria-label="Увеличить шрифт">A+</button>
              </span>
              <button type="button" class="snap-diff-copy-btn" title="Копировать изменения" aria-label="Копировать изменения">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11"/></svg>
              </button>
              <button type="button" class="snap-diff-close" aria-label="Закрыть">✕</button>
            </div>
            <div class="snap-diff-body"></div>
          </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        overlay.querySelector('.snap-diff-close').addEventListener('click', () => overlay.style.display = 'none');

        overlay.querySelector('.snap-diff-nav').addEventListener('click', e => {
          const btn = e.target.closest('[data-dir]');
          if (!btn) return;
          _diffNavigate(Number(btn.dataset.dir));
        });

        overlay.querySelectorAll('.snap-diff-font-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            _diffFontSize = Math.max(9, Math.min(22, _diffFontSize + (btn.dataset.diffFont === 'inc' ? 1 : -1)));
            overlay.querySelector('.snap-diff-body').style.fontSize = _diffFontSize + 'px';
          });
        });

        overlay.querySelector('.snap-diff-copy-btn').addEventListener('click', _diffCopyChanges);
      }

      overlay.querySelector('.snap-diff-title').textContent = `Diff: «${snap.name}» vs текущее`;
      overlay.querySelector('.snap-diff-stats').textContent = stats.ins || stats.del ? `+${stats.ins} / −${stats.del}` : '';

      const body = overlay.querySelector('.snap-diff-body');
      body.innerHTML = html;
      body.style.fontSize = _diffFontSize + 'px';

      _diffChanges = Array.from(body.querySelectorAll('.diff-del, .diff-ins'));
      _diffCurrent = 0;
      _diffUpdateCounter();

      if (_diffChanges.length) {
        _diffChanges[0].classList.add('snap-diff-highlight');
        const lineHeight = parseFloat(getComputedStyle(body).lineHeight) || 21;
        body.scrollTop = _diffChanges[0].offsetTop - body.offsetTop - lineHeight * 2;
      }

      overlay.style.display = 'flex';
    } catch (err) {
      console.error('Snapshots: diff failed', err);
      Toast.show('Ошибка построения diff', 'error');
    }
  }

  function _diffNavigate(dir) {
    if (!_diffChanges.length) return;
    _diffChanges[_diffCurrent]?.classList.remove('snap-diff-highlight');
    _diffCurrent = (_diffCurrent + dir + _diffChanges.length) % _diffChanges.length;
    _diffChanges[_diffCurrent].classList.add('snap-diff-highlight');
    const body = document.getElementById('snap-diff-overlay')?.querySelector('.snap-diff-body');
    if (body) {
      const el = _diffChanges[_diffCurrent];
      const lineHeight = parseFloat(getComputedStyle(body).lineHeight) || 21;
      body.scrollTop = el.offsetTop - body.offsetTop - lineHeight * 2;
    }
    _diffUpdateCounter();
  }

  function _diffUpdateCounter() {
    const overlay = document.getElementById('snap-diff-overlay');
    if (!overlay) return;
    const counter = overlay.querySelector('.snap-diff-counter');
    if (counter) counter.textContent = _diffChanges.length ? `${_diffCurrent + 1}/${_diffChanges.length}` : '0/0';
  }

  function _diffCopyChanges() {
    const overlay = document.getElementById('snap-diff-overlay');
    if (!overlay) return;
    const body = overlay.querySelector('.snap-diff-body');
    if (!body) return;

    const parts = [];
    body.querySelectorAll('.diff-del, .diff-ins').forEach(el => {
      const prefix = el.classList.contains('diff-del') ? '− ' : '+ ';
      parts.push(prefix + el.textContent);
    });

    if (!parts.length) {
      Toast.show('Нет изменений для копирования', 'warning');
      return;
    }

    navigator.clipboard.writeText(parts.join('\n')).then(
      () => Toast.show('Изменения скопированы ✓', 'success'),
      () => Toast.show('Не удалось скопировать', 'error')
    );
  }

  /* ---- Рендер списка ---- */
  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';

    let snaps;
    try {
      snaps = State.getNamedSnapshots();
    } catch (err) {
      console.error('Snapshots: failed to load list', err);
      listEl.innerHTML = '<div class="snap-empty" role="alert">Ошибка загрузки</div>';
      return;
    }

    if (!snaps.length) {
      listEl.innerHTML = '<div class="snap-empty" role="status">Нет сохранённых версий</div>';
      return;
    }

    snaps.forEach(snap => {
      const row  = document.createElement('div');
      row.className = 'snap-row';

      const info = document.createElement('div');
      info.className = 'snap-info';
      info.innerHTML =
        `<span class="snap-name">${escHtmlUi(snap.name)}</span>` +
        `<span class="snap-date">${new Date(snap.date).toLocaleString('ru')}</span>`;

      const acts = document.createElement('div');
      acts.className = 'snap-acts';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'btn-snap-restore';
      restoreBtn.textContent = '↩ Восстановить';
      restoreBtn.addEventListener('click', () => {
        try {
          State.restoreNamedSnapshot(snap.id);
          close();
          Toast.show('Версия восстановлена ✓', 'success');
        } catch (err) {
          console.error('Snapshots: restore failed', err);
          Toast.show('Ошибка восстановления', 'error');
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-snap-del';
      delBtn.setAttribute('aria-label', 'Удалить версию');
      delBtn.title = 'Удалить версию';
      delBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3h4v2M12 5l-1 8H5L4 5"/></svg>`;
      delBtn.addEventListener('click', () => {
        try {
          State.deleteNamedSnapshot(snap.id);
          renderList();
        } catch (err) {
          console.error('Snapshots: delete failed', err);
          Toast.show('Ошибка удаления', 'error');
        }
      });

      const diffBtn = document.createElement('button');
      diffBtn.type = 'button';
      diffBtn.className = 'btn-snap-diff';
      diffBtn.setAttribute('aria-label', 'Показать diff');
      diffBtn.title = 'Сравнить с текущим';
      diffBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4"/></svg>`;
      diffBtn.addEventListener('click', () => showDiff(snap));

      acts.appendChild(restoreBtn);
      acts.appendChild(diffBtn);
      acts.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(acts);
      listEl.appendChild(row);
    });
  }

  /* ---- Сохранение ---- */
  function save() {
    if (saveLock || !nameInput) return;
    saveLock = true;
    try {
      const name = nameInput.value.trim() || new Date().toLocaleString('ru');
      State.saveNamedSnapshot(name);
      nameInput.value = '';
      renderList();
      Toast.show('Версия сохранена ✓', 'success');
    } catch (err) {
      console.error('Snapshots: save failed', err);
      Toast.show('Ошибка сохранения', 'error');
    } finally {
      saveLock = false;
    }
  }

  /* ---- Привязка событий ---- */
  const saveBtn  = document.getElementById('btn-snap-save');
  const closeBtn = document.getElementById('snapshots-close');
  const openBtn  = document.getElementById('btn-snapshots');

  if (saveBtn)  saveBtn.addEventListener('click', save);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (openBtn)  openBtn.addEventListener('click', open);
  if (modal)    modal.addEventListener('click', e => { if (e.target === modal) close(); });
  if (nameInput) {
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();   // защита от случайного submit'а формы
        save();
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      close();
    }
  });

  return { open, close, render: renderList };
})();

/* ============================================================
   Templates
   ============================================================ */
const Templates = (() => {
  const modal     = document.getElementById('templates-modal');
  const listEl    = document.getElementById('templates-list');
  const nameInput = document.getElementById('tpl-name-input');
  const dropMenu  = document.getElementById('tpl-menu');
  const counterEl = document.getElementById('tpl-counter');
  const exportBtn = document.getElementById('btn-tpl-export');
  const importBtn = document.getElementById('btn-tpl-import');
  const fileInput = document.getElementById('tpl-file-input');

  const MAX_USER_TEMPLATES = 20;

  const BLOCK_TYPE_LABELS = { text: 'текст', snippets: 'сниппеты', commands: 'команды', sticky: 'заметка', todo: 'чеклист', table: 'таблица' };

  /* ── Безопасный escHtml: использует глобальную, если есть, иначе fallback ── */
  const escHtmlUi = (typeof window !== 'undefined' && typeof window.escHtmlUi === 'function')
    ? window.escHtmlUi.bind(window)
    : (s) => {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
      };

  /* ── Безопасный вызов планировщика сохранения ── */
  function _scheduleSave() {
    if (typeof _uiScheduleSave === 'function') _uiScheduleSave();
  }

  /* ── Стабильный генератор коротких ID ── */
  function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().slice(0, 8);
    }
    return Math.random().toString(36).substring(2, 10).padEnd(8, '0');
  }

  /* ── Миграция: добавить createdAt/useCount к старым шаблонам ── */
  function _migrateTemplate(tpl) {
    if (tpl.createdAt == null) tpl.createdAt = 0;
    if (tpl.useCount == null) tpl.useCount = 0;
    return tpl;
  }

  function _formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}.${mm}.${yy}`;
  }

  function makeTextBlock(title, icon, col, placeholder) {
    return {
      id: uid(), type: 'text', title, icon, column: col, collapsed: false,
      activeSubtab: 0, fontSize: 12,
      subtabs: Array.from({ length: 20 }, (_, i) => ({ label: String(i + 1), value: '' })),
      placeholder: placeholder || '',
    };
  }

  function makeSnippets(col) {
    return {
      id: uid(), type: 'snippets', title: 'Сниппеты', icon: '💬', column: col,
      collapsed: false, showTitles: true,
      items: [
        { id: uid(), title: 'Кратко',    value: 'Отвечай кратко и по делу, без воды.',      enabled: false },
        { id: uid(), title: 'Markdown',  value: 'Используй Markdown форматирование.',        enabled: false },
        { id: uid(), title: 'Пошагово', value: 'Распиши решение по шагам.',                 enabled: false },
      ],
    };
  }

  function makeCmds(col) {
    return {
      id: uid(), type: 'commands', title: 'Сниппеты', icon: '⚡', column: col, collapsed: false,
      items: [],
    };
  }

  function makeSticky(col) {
    return {
      id: uid(), type: 'sticky', title: 'Заметка', icon: '📌', column: col,
      collapsed: false,
      color: 'yellow',
      value: '',
      fontSize: 13,
    };
  }

  function makeTodo(col) {
    return {
      id: uid(), type: 'todo', title: 'Чеклист', icon: '☑️', column: col,
      collapsed: false,
      activeSubtab: 0,
      subtabs: Array.from({ length: 5 }, (_, i) => ({
        label: String(i + 1), name: '',
        items: [],
      })),
    };
  }

  const BUILTIN = [
    {
      id: 'tpl-codereview', name: '🔧 Код-ревью',
      blocks: [
        makeTextBlock('Контекст',   '📋', 0, 'Описание задачи, стек технологий...'),
        makeTextBlock('Код',        '💻', 0, 'Вставьте код для ревью...'),
        makeTextBlock('Фокус',      '🎯', 1, 'На что обратить особое внимание...'),
        makeSnippets(1), makeCmds(1),
      ],
    },
    {
      id: 'tpl-translate', name: '🌍 Перевод',
      blocks: [
        makeTextBlock('Исходный текст', '📝', 0, 'Текст для перевода...'),
        makeTextBlock('Инструкции',     '⚙️', 1, 'Язык перевода, стиль, контекст...'),
        makeSnippets(1),
      ],
    },
    {
      id: 'tpl-refactor', name: '♻️ Рефакторинг',
      blocks: [
        makeTextBlock('Код',          '💻', 0, 'Код для рефакторинга...'),
        makeTextBlock('Требования',   '📋', 1, 'Что улучшить: читаемость, производительность...'),
        makeTextBlock('Ограничения',  '🔒', 1, 'Что нельзя менять...'),
        makeSnippets(0), makeCmds(1),
      ],
    },
    {
      id: 'tpl-explain', name: '📖 Объяснение',
      blocks: [
        makeTextBlock('Тема',        '📋', 0, 'Что нужно объяснить...'),
        makeTextBlock('Аудитория',   '👥', 0, 'Уровень аудитории (новичок, эксперт)...'),
        makeTextBlock('Формат',      '📋', 1, 'Формат ответа: текст, примеры, аналогии...'),
        makeSnippets(1),
      ],
    },
    {
      id: 'tpl-brainstorm', name: '💡 Брейнсторм',
      blocks: [
        makeTextBlock('Задача',       '💡', 0, 'Проблема или вопрос для мозгового штурма...'),
        makeTextBlock('Контекст',     '🌍', 0, 'Дополнительный контекст...'),
        makeTextBlock('Ограничения',  '🔒', 1, 'Чего избегать...'),
        makeSnippets(1),
      ],
    },
    {
      id: 'tpl-debug', name: '🐛 Отладка',
      blocks: [
        makeTextBlock('Ошибка',   '⚠️', 0, 'Описание ошибки, stack trace...'),
        makeTextBlock('Код',      '💻', 0, 'Проблемный код...'),
        makeTextBlock('Ожидание', '✅', 1, 'Ожидаемое поведение...'),
        makeTextBlock('Среда',    '🖥️', 1, 'OS, версии, зависимости...'),
        makeSnippets(1), makeCmds(1),
      ],
    },
  ];

  /* ── Безопасная обёртка над Storage ── */
  function _loadUserTemplates() {
    try {
      return (Storage.loadTemplates() || []).map(_migrateTemplate);
    } catch (e) {
      console.error('[Templates] Storage.loadTemplates failed:', e);
      return [];
    }
  }

  function _saveUserTemplates(templates) {
    try {
      Storage.saveTemplates(templates);
      return true;
    } catch (e) {
      console.error('[Templates] Storage.saveTemplates failed:', e);
      Toast.show('Не удалось сохранить шаблоны — возможно, переполнено хранилище браузера', 'error');
      return false;
    }
  }

  function _updateCounter() {
    if (!counterEl) return;
    const count = _loadUserTemplates().length;
    counterEl.textContent = `${count}/${MAX_USER_TEMPLATES}`;
  }

  function getAll() {
    return [...BUILTIN, ..._loadUserTemplates()];
  }

  const TPL_HEIGHT_KEY = 'tplPanelHeight';
  const TPL_POS_KEY = 'tplPanelPos';
  const TPL_MIN_H = 200;
  function tplMaxH() { return Math.floor(window.innerHeight * 0.8); }

  function _applyTplHeight(h) {
    if (!modal) return;
    const clamped = Math.min(Math.max(h, TPL_MIN_H), tplMaxH());
    modal.style.height = clamped + 'px';
    return clamped;
  }

  function _initTplResize() {
    const handle = document.getElementById('tpl-resize-handle');
    if (!modal || !handle) return;
    const saved = parseInt(localStorage.getItem(TPL_HEIGHT_KEY), 10);
    if (!Number.isNaN(saved)) _applyTplHeight(saved);

    let dragging = false, startY = 0, startH = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true; startY = e.clientY;
      startH = modal.getBoundingClientRect().height;
      modal.classList.add('tpl-resizing'); e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      _applyTplHeight(startH + (e.clientY - startY));
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; modal.classList.remove('tpl-resizing');
      localStorage.setItem(TPL_HEIGHT_KEY, Math.round(modal.getBoundingClientRect().height));
    });
    window.addEventListener('resize', () => {
      if (modal.style.display !== 'none') _applyTplHeight(modal.getBoundingClientRect().height);
    });
  }

  function _initTplDrag() {
    const header = modal?.querySelector('.modal-header');
    if (!modal || !header) return;

    header.style.cursor = 'grab';
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    header.addEventListener('mousedown', e => {
      if (e.target.closest('.modal-close')) return;
      dragging = true;
      const r = modal.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      origLeft = r.left; origTop = r.top;
      modal.style.transform = 'none';
      modal.style.left = origLeft + 'px';
      modal.style.top = origTop + 'px';
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(0, Math.min(window.innerWidth - modal.offsetWidth, origLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 40, origTop + dy));
      modal.style.left = newLeft + 'px';
      modal.style.top = newTop + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      header.style.cursor = 'grab';
      const r = modal.getBoundingClientRect();
      localStorage.setItem(TPL_POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
    });
  }

  function open()  {
    if (modal) { modal.style.display = 'flex'; _applyTplHeight(modal.getBoundingClientRect().height || 650); }
    renderList();
    document.addEventListener('mousedown', _onTplOutsideClick, true);
  }
  function close() {
    if (modal) modal.style.display = 'none';
    document.removeEventListener('mousedown', _onTplOutsideClick, true);
  }

  /* ── Превью блоков шаблона ── */
  function _buildPreviewHtml(blocks) {
    if (!blocks?.length) return '';
    return blocks.map(b => {
      const icon = b.icon || '📄';
      const title = escHtmlUi(b.title || '(без имени)');
      const type = BLOCK_TYPE_LABELS[b.type] || b.type;
      return `<span class="snap-preview-item">${icon} ${title} (${type})</span>`;
    }).join('');
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    const all = getAll();
    _updateCounter();

    if (!all.length) {
      listEl.innerHTML = '<div class="snap-empty">Нет шаблонов</div>';
      return;
    }

    all.forEach(tpl => {
      const row = document.createElement('div'); row.className = 'snap-row';
      const info = document.createElement('div'); info.className = 'snap-info';
      const isBuiltin = tpl.id.startsWith('tpl-');

      /* ── Строка с именем ── */
      const nameSpan = document.createElement('span');
      nameSpan.className = 'snap-name';
      nameSpan.textContent = tpl.name;

      /* ── Переименование: dblclick ── */
      if (!isBuiltin) {
        nameSpan.style.cursor = 'text';
        nameSpan.addEventListener('dblclick', () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'snap-rename-input';
          input.value = tpl.name;
          input.maxLength = 60;
          nameSpan.replaceWith(input);
          input.focus();
          input.select();

          const save = () => {
            const newName = input.value.trim();
            if (newName && newName !== tpl.name) {
              const saved = _loadUserTemplates();
              const t = saved.find(x => x.id === tpl.id);
              if (t) { t.name = newName; _saveUserTemplates(saved); }
              tpl.name = newName;
              renderDropdown();
              Toast.show(`Шаблон переименован в «${newName}»`, 'success');
            }
            renderList();
          };
          input.addEventListener('blur', save);
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); renderList(); }
          });
        });
      }

      /* ── Мета-строка: статистика ── */
      const dateSpan = document.createElement('span');
      dateSpan.className = 'snap-date';
      const blockCount = tpl.blocks?.length || 0;
      if (isBuiltin) {
        dateSpan.textContent = `Встроенный · ${blockCount} блоков`;
      } else {
        const parts = [];
        if (tpl.createdAt) parts.push(`Создан ${_formatDate(tpl.createdAt)}`);
        if (tpl.useCount) parts.push(`использований: ${tpl.useCount}`);
        parts.push(`${blockCount} блоков`);
        dateSpan.textContent = parts.join(' · ');
      }

      /* ── Превью блоков (hover) ── */
      const previewDiv = document.createElement('div');
      previewDiv.className = 'snap-preview';
      previewDiv.innerHTML = _buildPreviewHtml(tpl.blocks);

      info.appendChild(nameSpan);
      info.appendChild(dateSpan);

      const acts = document.createElement('div'); acts.className = 'snap-acts';

      /* ── Кнопка «создать вкладку» ── */
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'btn-snap-restore';
      useBtn.textContent = '+ Создать вкладку';
      useBtn.onclick = () => {
        createFromTemplate(tpl);
        close();
        Toast.show(`«${tpl.name}» создана ✓`, 'success');
      };
      useBtn.addEventListener('mouseenter', () => previewDiv.classList.add('visible'));
      useBtn.addEventListener('mouseleave', () => previewDiv.classList.remove('visible'));
      acts.appendChild(useBtn);

      /* ── Кнопка «шаблон по умолчанию» ── */
      const defBtn = document.createElement('button');
      defBtn.type = 'button';
      defBtn.className = 'btn-snap-del';
      const curDef = State.getDefaultTemplateId();
      const isDefault = curDef === tpl.id;
      defBtn.innerHTML = isDefault
        ? '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.4l-3.7 2 .7-4.1L2 5.4l4.2-.8z"/></svg>'
        : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 1l1.8 3.6L14 5.4l-3 2.9.7 4.1L8 10.4l-3.7 2 .7-4.1L2 5.4l4.2-.8z"/></svg>';
      defBtn.setAttribute('aria-label', isDefault ? 'Убрать шаблон по умолчанию' : 'Установить как шаблон по умолчанию');
      defBtn.title = isDefault ? 'Убрать шаблон по умолчанию' : 'Установить как шаблон по умолчанию для новых вкладок';
      defBtn.style.color = isDefault ? 'var(--orange)' : '';

      defBtn.onclick = () => {
        const newDefId = State.getDefaultTemplateId() === tpl.id ? null : tpl.id;
        State.setDefaultTemplateId(newDefId);
        _scheduleSave();
        renderList();
        renderDropdown();
        Toast.show(newDefId ? 'Шаблон по умолчанию установлен ✓' : 'Шаблон по умолчанию сброшен', 'success');
      };
      acts.appendChild(defBtn);

      /* ── Кнопки пользовательских: дублирование + удаление ── */
      if (!isBuiltin) {
        /* Дублирование */
        const cloneBtn = document.createElement('button');
        cloneBtn.type = 'button';
        cloneBtn.className = 'btn-snap-del';
        cloneBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/></svg>';
        cloneBtn.setAttribute('aria-label', 'Дублировать шаблон');
        cloneBtn.title = 'Дублировать шаблон';
        cloneBtn.onclick = () => {
          const saved = _loadUserTemplates();
          if (saved.length >= MAX_USER_TEMPLATES) {
            Toast.show(`Достигнут лимит шаблонов (${MAX_USER_TEMPLATES})`, 'error');
            return;
          }
          saved.push({
            id: 'user-' + uid(),
            name: tpl.name + ' (копия)',
            blocks: JSON.parse(JSON.stringify(tpl.blocks)),
            createdAt: Date.now(),
            useCount: 0,
          });
          if (!_saveUserTemplates(saved)) return;
          renderList();
          renderDropdown();
          Toast.show(`«${tpl.name}» дублирован ✓`, 'success');
        };
        acts.appendChild(cloneBtn);

        /* Удаление — двойной клик */
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-snap-del';
        delBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10M6 5V3h4v2M12 5l-1 8H5L4 5"/></svg>`;
        delBtn.setAttribute('aria-label', 'Удалить шаблон');
        delBtn.title = 'Нажмите ещё раз для удаления';
        let delPending = false, delTimer = null;
        delBtn.onclick = () => {
          if (!delPending) {
            delPending = true;
            delBtn.classList.add('btn-snap-del-pending');
            delTimer = setTimeout(() => { delPending = false; delBtn.classList.remove('btn-snap-del-pending'); }, 2500);
          } else {
            clearTimeout(delTimer);
            delBtn.classList.remove('btn-snap-del-pending');
            const saved = _loadUserTemplates().filter(t => t.id !== tpl.id);
            if (!_saveUserTemplates(saved)) return;
            if (State.getDefaultTemplateId() === tpl.id) {
              State.setDefaultTemplateId(null);
              _scheduleSave();
            }
            renderList();
            renderDropdown();
            Toast.show(`Шаблон «${tpl.name}» удалён`, 'success');
          }
        };
        acts.appendChild(delBtn);
      }

      row.appendChild(info);
      row.appendChild(acts);
      row.appendChild(previewDiv);
      listEl.appendChild(row);
    });
  }

  function createFromTemplate(tpl) {
    const source = tpl.blocks || [];
    const cloned = JSON.parse(JSON.stringify(source));

    function reId(blocks) {
      return blocks.map(b => {
        b.id = State.uid();
        if (b.children) b.children = reId(b.children);
        if (b.items) b.items = b.items.map(i => ({ ...i, id: State.uid() }));
        return b;
      });
    }

    const tab = State.newTab(tpl.name);
    State.update(t => {
      if (t.id === tab.id) t.blocks = reId(cloned);
    });

    /* Инкремент useCount для пользовательских шаблонов */
    if (!tpl.id.startsWith('tpl-')) {
      const saved = _loadUserTemplates();
      const t = saved.find(x => x.id === tpl.id);
      if (t) { t.useCount = (t.useCount || 0) + 1; _saveUserTemplates(saved); }
    }
  }

  function saveCurrentAsTemplate() {
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) { Toast.show('Введите название шаблона', 'error'); return; }

    const t = State.getActive();
    if (!t) { Toast.show('Нет активной вкладки', 'error'); return; }

    const saved = _loadUserTemplates();
    if (saved.length >= MAX_USER_TEMPLATES) {
      Toast.show(`Достигнут лимит шаблонов (${MAX_USER_TEMPLATES})`, 'error');
      return;
    }

    saved.push({
      id: 'user-' + uid(),
      name,
      blocks: JSON.parse(JSON.stringify(t.blocks)),
      createdAt: Date.now(),
      useCount: 0,
    });

    if (!_saveUserTemplates(saved)) return;

    nameInput.value = '';
    renderList();
    renderDropdown();
    Toast.show(`Шаблон «${name}» сохранён ✓`, 'success');
  }

  /* ── Экспорт ── */
  function _exportTemplates() {
    const userTpls = _loadUserTemplates();
    if (!userTpls.length) { Toast.show('Нет пользовательских шаблонов для экспорта', 'info'); return; }
    const json = JSON.stringify(userTpls, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paste-copy-templates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show(`Экспортировано ${userTpls.length} шаблонов ✓`, 'success');
  }

  /* ── Импорт ── */
  function _importTemplates(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) { Toast.show('Неверный формат файла', 'error'); return; }

        const valid = data.filter(t => t && typeof t.name === 'string' && Array.isArray(t.blocks));
        if (!valid.length) { Toast.show('Файл не содержит валидных шаблонов', 'error'); return; }

        const existing = _loadUserTemplates();
        const existingIds = new Set(existing.map(t => t.id));
        let added = 0;

        for (const tpl of valid) {
          if (existing.length >= MAX_USER_TEMPLATES) break;
          if (existingIds.has(tpl.id)) continue;
          existing.push({
            id: tpl.id,
            name: tpl.name,
            blocks: tpl.blocks,
            createdAt: tpl.createdAt || Date.now(),
            useCount: tpl.useCount || 0,
          });
          added++;
        }

        if (!_saveUserTemplates(existing)) return;
        renderList();
        renderDropdown();
        Toast.show(`Импортировано ${added} шаблонов ✓`, 'success');
      } catch {
        Toast.show('Ошибка чтения JSON-файла', 'error');
      }
    };
    reader.readAsText(file);
  }

  function renderDropdown() {
    if (!dropMenu) return;
    dropMenu.innerHTML = '';

    getAll().forEach(tpl => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = tpl.name;
      if (State.getDefaultTemplateId() === tpl.id) btn.textContent += ' ★';
      btn.onclick = e => {
        e.stopPropagation();
        createFromTemplate(tpl);
        document.getElementById('tpl-dropdown')?.classList.remove('open');
        Toast.show(`«${tpl.name}» создана ✓`, 'success');
      };
      dropMenu.appendChild(btn);
    });

    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    dropMenu.appendChild(sep);

    const manageBtn = document.createElement('button');
    manageBtn.type = 'button';
    manageBtn.textContent = '⚙ Управление шаблонами';
    manageBtn.onclick = e => {
      e.stopPropagation();
      document.getElementById('tpl-dropdown')?.classList.remove('open');
      open();
    };
    dropMenu.appendChild(manageBtn);
  }

  /* ── Инициализация обработчиков ── */
  const saveBtn  = document.getElementById('btn-tpl-save');
  const closeBtn = document.getElementById('templates-modal-close');

  if (saveBtn)  saveBtn.onclick  = saveCurrentAsTemplate;
  if (closeBtn) closeBtn.onclick = close;
  if (exportBtn) exportBtn.onclick = _exportTemplates;
  if (importBtn) importBtn.onclick = () => fileInput?.click();
  if (fileInput) fileInput.onchange = e => { const f = e.target.files?.[0]; if (f) _importTemplates(f); fileInput.value = ''; };

  _initTplResize();
  _initTplDrag();

  /* ── Закрытие по клику вне ── */
  function _onTplOutsideClick(e) {
    if (modal && modal.style.display !== 'none' && !modal.contains(e.target)) close();
  }

  /* Блокировка скролла колонки за меню */
  if (modal) {
    modal.addEventListener('wheel', e => {
      const list = listEl;
      if (!list) return;
      const atTop = list.scrollTop <= 0 && e.deltaY < 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
      if (atTop || atBottom) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') close();
  });

  renderDropdown();

  return { open, close, renderDropdown, _getAll: getAll };
})();

window.Search = Search;
window.Snapshots = Snapshots;
window.Templates = Templates;
