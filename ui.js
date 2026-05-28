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

    const hadFocus = bar.contains(document.activeElement);

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

      // --- Название вкладки ---
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;
      name.title = tab.name || '';

      // dblclick — inline-переименование
      name.ondblclick = e => {
        e.stopPropagation();
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
      el.onclick = () => State.setActive(tab.id);
      el.onmousedown = e => {
        if (e.button === 1) { e.preventDefault(); State.closeTab(tab.id); }
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
  const getMdMode = () => State.getLayout().previewMarkdown === true;

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

    (tab.blocks || []).forEach(b => {
      if (b.type === 'commands' || b.type === 'variable') return;

      // Блок может быть скрыт из превью флагом previewDisabled
      if (b.previewDisabled === true) return;

      if (b.type === 'snippets') {
        const items = (b.items || []).filter(i => i.enabled && (i.value || '').trim());
        if (!items.length) return;
        const showTitles = b.showTitles !== false;
        const content = items.map(i =>
          (showTitles && i.title) ? `## ${i.title}\n${i.value.trim()}` : i.value.trim()
        ).join('\n\n');
        parts.push(showHeaders ? `# ${b.title}\n${applyVars(content)}` : applyVars(content));

      } else if (b.type === 'text') {
        const idx = b.activeSubtab ?? 0;
        const raw = (b.subtabs?.[idx]?.value || '').trim();
        const val = applyVars(raw);
        if (val) parts.push(showHeaders ? `# ${b.title}\n${val}` : val);

      } else if (b.type === 'group' && b.enabled !== false) {
        (b.children || []).forEach(child => {
          // Дочерние блоки тоже могут быть скрыты из превью
          if (child.previewDisabled === true) return;
          if (child.type === 'text') {
            const idx = child.activeSubtab ?? 0;
            const raw = (child.subtabs?.[idx]?.value || '').trim();
            const val = applyVars(raw);
            if (val) parts.push(showHeaders ? `# ${child.title}\n${val}` : val);
          }
        });
      }
    });

    return parts.join(sep);
  }

  function _syncPanelButtons() {
    document.getElementById('prev-md')
      ?.classList.toggle('active-btn', getMdMode());
    document.getElementById('prev-wrap')
      ?.classList.toggle('active-btn', State.getLayout().previewWrap === false);
  }

  function render() {
    let t = '';
    try { t = build(); } catch (err) {
      console.error('[Preview.render] build() threw:', err);
      if (textEl) textEl.textContent = '[Preview error — см. консоль]';
      _syncPanelButtons(); // держим кнопки в sync даже при ошибке
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

    if (mdMode) {
      if (textEl) textEl.style.display = 'none';
      if (mdEl)   mdEl.style.display   = '';
      if (mdEl) {
        try {
          if (typeof marked !== 'undefined') {
            mdEl.innerHTML = _sanitizeMarkdownHtml(marked.parse(t));
          } else {
            mdEl.textContent = t;
          }
        } catch (err) {
          console.error('[Preview.render] marked.parse() threw:', err);
          mdEl.textContent = t; // fallback — показываем сырой текст
        }
      }
    } else {
      if (mdEl)   mdEl.style.display   = 'none';
      if (textEl) textEl.style.display = '';
      if (textEl) textEl.textContent   = t;
    }

    applyFontSize();
    applyWrap();
    _syncPanelButtons();
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
    const next = !getMdMode();
    State.setLayout({ previewMarkdown: next });
    window.Intelligence?.track?.('preview.markdown.toggle', { enabled: next });
    _safeSave();
    render();
  }

  function toggleCollapse() {
    if (!panel) return;
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('prev-toggle');
    if (btn) btn.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
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

  return {
    render, copy, applyHeight, fontInc, fontDec,
    toggleMarkdown, toggleCollapse, toggleWrap, getText,
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

  function open() {
    if (!panel) return;
    _open = true;
    panel.style.display = 'flex';
    searchInput?.focus();
    searchInput?.select();
    doSearch();
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
      if (opts.wholeWord) pattern = `\\b${pattern}\\b`;
      return new RegExp(pattern, flags);
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
      const pat     = opts.wholeWord ? `\\b${escaped}\\b` : escaped;
      snipRe = new RegExp(pat, opts.caseSensitive ? 'g' : 'gi');
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

      if (snipRe) {
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

  /* ---- event wiring ---- */

  if (searchInput)   searchInput.addEventListener('input',   doSearch);
  if (caseCheck)     caseCheck.addEventListener('change',    doSearch);
  if (regexCheck)    regexCheck.addEventListener('change',   doSearch);
  if (wordCheck)     wordCheck.addEventListener('change',    doSearch);
  if (allTabsCheck)  allTabsCheck.addEventListener('change', doSearch);

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

    if (ctrl && e.key.toLowerCase() === 'f') {
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
      if (!btnSearch?.contains(e.target)) close();
    }
  });

  return { open, close };
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

      acts.appendChild(restoreBtn);
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
    // fallback: padEnd гарантирует ровно 8 символов
    return Math.random().toString(36).substring(2, 10).padEnd(8, '0');
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
      id: uid(), type: 'commands', title: 'Быстрые команды', icon: '⚡', column: col, collapsed: false,
      items: [
        { id: uid(), label: 'Объясни',   value: 'Объясни простыми словами:' },
        { id: uid(), label: 'Сократи',   value: 'Сократи текст, оставив главное:' },
        { id: uid(), label: 'Код-ревью', value: 'Сделай детальное код-ревью:' },
      ],
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
      return Storage.loadTemplates() || [];
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

  function getAll() {
    return [...BUILTIN, ..._loadUserTemplates()];
  }

  function open()  { if (modal) modal.style.display = 'flex'; renderList(); }
  function close() { if (modal) modal.style.display = 'none'; }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    const all = getAll();

    if (!all.length) {
      listEl.innerHTML = '<div class="snap-empty">Нет шаблонов</div>';
      return;
    }

    all.forEach(tpl => {
      const row = document.createElement('div'); row.className = 'snap-row';
      const info = document.createElement('div'); info.className = 'snap-info';
      const isBuiltin = tpl.id.startsWith('tpl-');

      info.innerHTML =
        `<span class="snap-name">${escHtmlUi(tpl.name)}</span>` +
        `<span class="snap-date">${isBuiltin ? 'Встроенный' : 'Пользовательский'} · ${tpl.blocks?.length || 0} блоков</span>`;

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

      /* ── Кнопка удаления (только для пользовательских) ── */
      if (!isBuiltin) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-snap-del';
        delBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10M6 5V3h4v2M12 5l-1 8H5L4 5"/></svg>`;
        delBtn.setAttribute('aria-label', 'Удалить шаблон');
        delBtn.title = 'Удалить шаблон';
        delBtn.onclick = () => {
          if (!confirm(`Удалить шаблон «${tpl.name}»? Это действие нельзя отменить.`)) return;

          const saved = _loadUserTemplates().filter(t => t.id !== tpl.id);
          if (!_saveUserTemplates(saved)) return;

          if (State.getDefaultTemplateId() === tpl.id) {
            State.setDefaultTemplateId(null);
            _scheduleSave();
          }
          renderList();
          renderDropdown();
          Toast.show(`Шаблон «${tpl.name}» удалён`, 'success');
        };
        acts.appendChild(delBtn);
      }

      row.appendChild(info);
      row.appendChild(acts);
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
  }

  function saveCurrentAsTemplate() {
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) { Toast.show('Введите название шаблона', 'error'); return; }

    const t = State.getActive();
    if (!t) { Toast.show('Нет активной вкладки', 'error'); return; }

    const saved = _loadUserTemplates();
    saved.push({
      id: 'user-' + uid(),
      name,
      blocks: JSON.parse(JSON.stringify(t.blocks)),
    });

    if (!_saveUserTemplates(saved)) return;

    nameInput.value = '';
    renderList();
    renderDropdown();
    Toast.show(`Шаблон «${name}» сохранён ✓`, 'success');
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
  if (modal)    modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') close();
  });

  renderDropdown();

  return { open, close, renderDropdown, _getAll: getAll };
})();

window.Search = Search;
window.Snapshots = Snapshots;
window.Templates = Templates;