// file_name: blocks.js
const Blocks = (() => {
  'use strict';

  const colLeft  = document.getElementById('col-left');
  const colRight = document.getElementById('col-right');

  const VISIBLE_SUBTABS = 5;

  // Transient UI state: subtab scroll offsets keyed by block id.
  const subtabOffsets = new Map();

  // [FIX] Хранилище ResizeObserver-ов по block.id — для очистки при перерендере
  const observerMap = new Map();

  // Кеш индикаторов линтера: не гоняем анализ текста на каждом render без нужды.
  const textLintBadgeCache = new Map();
  const TEXT_LINT_BADGE_CACHE_LIMIT = 80;

  // [FIX] Таймер debounce для глобального счётчика символов
  let _wordCountTimer = null;

  /* ================================================================
     Очистка ResizeObserver-ов (вызывается перед каждым render)
  ================================================================ */
  function cleanupObservers() {
    observerMap.forEach(ro => ro.disconnect());
    observerMap.clear();
  }

  /* ================================================================
     Column DnD — attached once by setupColumns()
  ================================================================ */
  function setupColumns() {
    [colLeft, colRight].forEach(col => {
      col.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes('text/block')) return;
        e.preventDefault(); col.classList.add('drop-target');
      });
      col.addEventListener('dragleave', e => {
        if (col.contains(e.relatedTarget)) return;
        col.classList.remove('drop-target');
      });
      col.addEventListener('drop', e => {
        if (!e.dataTransfer.types.includes('text/block')) return;
        e.preventDefault(); col.classList.remove('drop-target');
        const srcId     = e.dataTransfer.getData('text/block');
        const targetCol = parseInt(col.dataset.col, 10);
        State.update(tab => { const src = State.findBlock(tab.blocks, srcId); if (src) src.column = targetCol; });
      });

      // сохраняем прокрутку при ручном скроллинге колонки
      col.addEventListener('scroll', _saveColScroll, { passive: true });
    });
  }

  /* ================================================================
     Rendering
  ================================================================ */
  // Запоминаем позиции прокрутки колонок — persisted в localStorage
  const COL_SCROLL_KEY = 'llm-pb-col-scroll-v1';
  const _colScrollMap  = new Map();
  let   _displayedTabId = null;   // id вкладки, чей контент сейчас в колонках
  let   _scrollSaveTimer = null;

  /* ---- загрузка / сохранение в localStorage ------------------------ */
  function _loadColScrollMap() {
    try {
      const raw = localStorage.getItem(COL_SCROLL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || !parsed) return;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.l === 'number' && typeof v.r === 'number') {
          _colScrollMap.set(k, v);
        }
      }
    } catch (_) {/* corrupted — start clean */}
  }

  function _persistColScrollMap() {
    clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
      try {
        const obj = Object.create(null);
        for (const [k, v] of _colScrollMap) obj[k] = v;
        localStorage.setItem(COL_SCROLL_KEY, JSON.stringify(obj));
      } catch (_) {/* quota */}
    }, 300);
  }

  /** Немедленный flush — для beforeunload */
  function _flushColScrollMap() {
    try {
      const obj = Object.create(null);
      for (const [k, v] of _colScrollMap) obj[k] = v;
      localStorage.setItem(COL_SCROLL_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  /* ---- save / restore ---------------------------------------------- */

  function _saveColScroll() {
    // Сохраняем прокрутку для вкладки, ЧЕЙ контент сейчас отображается
    // (а не для «активной», которая при переключении уже обновилась)
    if (!_displayedTabId) return;
    _colScrollMap.set(_displayedTabId, {
      l: colLeft.scrollTop,
      r: colRight.scrollTop,
    });
    _persistColScrollMap();
  }

  function _restoreColScroll(maxAttempts = 10) {
    const tab = State.getActive();
    if (!tab) return;
    const saved = _colScrollMap.get(tab.id);
    if (!saved) return;
    let attempts = 0;

    const tryRestore = () => {
      if (attempts >= maxAttempts) return true; // стоп после лимита
      attempts++;
      const maxL = colLeft.scrollHeight  - colLeft.clientHeight;
      const maxR = colRight.scrollHeight - colRight.clientHeight;
      if (saved.l > maxL + 1 || saved.r > maxR + 1) return false;
      colLeft.scrollTop  = saved.l;
      colRight.scrollTop = saved.r;
      return true;
    };

    if (!tryRestore()) {
      requestAnimationFrame(() => {
        if (!tryRestore()) {
          requestAnimationFrame(tryRestore);
        }
      });
    }
  }

  /* ---- загрузка при старте модуля ----------------------------------- */
  _loadColScrollMap();

  /* ---- сохраняем скролл при уходе со страницы ----------------------- */
  window.addEventListener('beforeunload', () => {
    _saveColScroll();   // захватываем текущую позицию
    clearTimeout(_scrollSaveTimer);
    _flushColScrollMap(); // немедленный sync в localStorage
    clearTimeout(_taScrollSaveTimer);
    _flushTaScrollMap();  // немедленный sync прокруток текста в localStorage
  });

  // Запоминаем позиции прокрутки textarea внутри блоков — persisted в localStorage
  const TA_SCROLL_KEY = 'llm-pb-ta-scroll-v1';
  const _taScrollMap  = new Map();
  let   _taScrollSaveTimer = null;

  function _loadTaScrollMap() {
    try {
      const raw = localStorage.getItem(TA_SCROLL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || !parsed) return;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number') _taScrollMap.set(k, v);
      }
    } catch (_) {/* corrupted — start clean */}
  }

  function _persistTaScrollMap() {
    clearTimeout(_taScrollSaveTimer);
    _taScrollSaveTimer = setTimeout(() => {
      try {
        const obj = Object.create(null);
        for (const [k, v] of _taScrollMap) obj[k] = v;
        localStorage.setItem(TA_SCROLL_KEY, JSON.stringify(obj));
      } catch (_) {/* quota */}
    }, 500);
  }

  function _flushTaScrollMap() {
    try {
      const obj = Object.create(null);
      for (const [k, v] of _taScrollMap) obj[k] = v;
      localStorage.setItem(TA_SCROLL_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  _loadTaScrollMap();

  // Кэш для дедупликации быстрых вызовов render
  let _renderScheduled = false;

  function render() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    requestAnimationFrame(() => {
      _renderScheduled = false;
      _doRender();
    });
  }

  const _pendingTaScrolls = [];

  function _doRender() {
    // 1. Сохраняем прокрутку ПРЕДЫДУЩЕЙ отображаемой вкладки
    _saveColScroll();

    const tab = State.getActive();

    // 2. Отключаем все живые ResizeObserver-ы перед очисткой DOM
    cleanupObservers();

    colLeft.innerHTML  = '';
    colRight.innerHTML = '';

    if (!tab) { _displayedTabId = null; return; }

    // 3. Запоминаем, чей контент теперь в колонках
    _displayedTabId = tab.id;

    const orderMap = buildOrderMap(tab.blocks);
    tab.blocks.forEach(b => {
      (b.column === 1 ? colRight : colLeft).appendChild(renderBlock(b, orderMap));
    });

    applyLayout();
    updateGlobalWordCount();

    for (const { ta, blockId, subIdx } of _pendingTaScrolls) {
      const savedTop = _taScrollMap.get(blockId + ':' + subIdx);
      if (savedTop != null && ta.isConnected) ta.scrollTop = savedTop;
    }
    _pendingTaScrolls.length = 0;

    // 4. Восстанавливаем прокрутку колонок после того как layout завершён
    requestAnimationFrame(() => requestAnimationFrame(_restoreColScroll));
  }

  function buildOrderMap(blocks) {
    const map = {};
    let order = 1;
    function walk(list) {
      list.forEach(b => {
        if (b.type === 'text') {
          const val = (b.subtabs[b.activeSubtab]?.value || '').trim();
          map[b.id] = (val && b.previewDisabled !== true) ? order++ : null;
        } else if (b.type === 'snippets') {
          map[b.id] = (b.items || []).some(i => i.enabled && (i.value || '').trim()) ? order++ : null;
        } else if (b.type === 'group') {
          map[b.id] = null;
          if (b.enabled !== false) walk(b.children || []);
        } else {
          map[b.id] = null;
        }
      });
    }
    walk(blocks);
    return map;
  }

  // [FIX] Debounce: не пересчитываем на каждый keystroke, только через 120 мс тишины
  function updateGlobalWordCount() {
    clearTimeout(_wordCountTimer);
    _wordCountTimer = setTimeout(_doUpdateWordCount, 120);
  }

  function _doUpdateWordCount() {
    const tab = State.getActive();
    const el  = document.getElementById('global-word-count');
    if (!tab || !el) return;

    let total = 0;
    function count(blocks) {
      blocks.forEach(b => {
        if (b.type === 'text') {
          total += (b.subtabs[b.activeSubtab]?.value || '').length;
        } else if (b.type === 'snippets') {
          (b.items || []).filter(i => i.enabled).forEach(i => { total += (i.value || '').length; });
        } else if (b.type === 'group' && b.children) {
          count(b.children);
        }
      });
    }
    count(tab.blocks);

    el.textContent = total.toLocaleString() + ' симв';
    el.className   = 'char-badge' + (total > 50000 ? ' danger' : total > 20000 ? ' warning' : '');
    el.title       = 'Всего символов в активных вкладках: ' + total.toLocaleString();
  }

  function applyLayout() {
    const lay  = State.getLayout();
    const r    = Math.max(0.15, Math.min(0.85, lay.colRatio || 0.5));
    const hide = lay.rightColHidden === true;
    colLeft.style.flex   = hide ? '1' : r + '';
    colRight.style.flex  = hide ? '0' : (1 - r) + '';
    colRight.style.display = hide ? 'none' : '';
    document.getElementById('col-resizer').style.display = hide ? 'none' : '';
  }

  function renderBlock(b, orderMap) {
    const el = document.createElement('div');
    el.className = 'block block-type-' + b.type + (b.collapsed ? ' collapsed' : '');
    el.dataset.id = b.id;
    if (b.type === 'sticky') el.setAttribute('data-color', b.color || 'yellow');

    el.appendChild(createHeader(b, orderMap[b.id]));

    if (!b.collapsed) {
      if (b.type !== 'group') {
        const body = document.createElement('div');
        body.className = 'block-body';
        if      (b.type === 'text')     renderTextBody(b, body);
        else if (b.type === 'snippets') renderSnippetsBody(b, body);
        else if (b.type === 'commands') renderCommandsBody(b, body);
        else if (b.type === 'variable') renderVariableBody(b, body);
        else if (b.type === 'sticky')   renderStickyBody(b, body);
        else if (b.type === 'todo')     renderTodoBody(b, body);
        el.appendChild(body);
      } else {
        renderGroupBody(b, el, orderMap);
      }
    }

    setupBlockDnD(el, b);
    return el;
  }

  /* ================================================================
     Header
  ================================================================ */
  function createHeader(b, orderNum) {
    const h = document.createElement('div');
    h.className = 'block-header';

    // --- drag handle ---
    const handle = document.createElement('span');
    handle.className = 'block-handle';
    handle.innerHTML = '↕';
    handle.draggable = true;
    handle.ondragstart = e => {
      e.dataTransfer.setData('text/block', b.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { if (h.isConnected) h.parentElement?.classList.add('dragging'); }, 0);
    };
    handle.ondragend = () => {
      h.parentElement?.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    };

    // --- icon ---
    const icon = document.createElement('span');
    icon.className = 'block-icon';
    icon.innerHTML = getBlockSvgIcon(b.type);

    // --- title input ---
    const title = document.createElement('input');
    title.className  = 'block-title block-title-wide';
    title.value      = b.title;
    title.spellcheck = false;
    title.onclick    = e => e.stopPropagation();
    title.oninput = () => State.updateLive(() => { b.title = title.value; });
    title.onblur  = () => { State.snapshot(); _stopMarquee(title); };

    // Улучшение 6: бесшовная круговая прокрутка названия при наведении (задержка 300ms)
    let _mqTimer = null;
	let _mqRaf   = null;
	let _mqOrigValue = null;

	function _stopMarquee(el) {
	clearTimeout(_mqTimer);
	cancelAnimationFrame(_mqRaf);
	if (_mqOrigValue !== null) { el.value = _mqOrigValue; _mqOrigValue = null; }
	el.scrollLeft = 0;
}

	title.addEventListener('mouseenter', () => {
	_mqTimer = setTimeout(() => {
    if (title === document.activeElement) return;
    const ovf = title.scrollWidth - title.clientWidth;
    if (ovf <= 2) return;

    _mqOrigValue = title.value;
    const sep = '   🚗 .  .  .  .  ';

    // Ширина одного повторения (текст + разделитель)
    title.value = _mqOrigValue + sep;
    void title.offsetWidth;
    const unitW = title.scrollWidth;

    // Скорость
    const dur   = Math.max(350, unitW * 6);
    const speed = unitW / dur;

    // Повторений хватит на ≈2 мин; при исчерпании — мягкий перезапуск
    const reps = Math.ceil(120000 / dur) + 2;
    title.value = (_mqOrigValue + sep).repeat(reps);

    let pos   = 0;
    let lastT = performance.now();

    const tick = now => {
      const dt = now - lastT;
      lastT = now;
      pos += dt * speed;

     // Мягкий перезапуск при исчерпании запаса
     if (pos >= unitW * (reps - 1)) {
       pos -= Math.floor(pos / unitW) * unitW;
      }

      title.scrollLeft = Math.round(pos);
      _mqRaf = requestAnimationFrame(tick);
    };
    _mqRaf = requestAnimationFrame(tick);
  }, 300);
});

title.addEventListener('mouseleave', () => _stopMarquee(title));
title.addEventListener('focus',     () => _stopMarquee(title));

    // --- badge / preview toggle ---
    const badge = document.createElement('button');
    badge.type      = 'button';
    badge.className = 'block-order block-order-btn';

    function updateBadge() {
      if (b.type === 'text') {
        const disabled = b.previewDisabled === true;
        badge.classList.toggle('block-order-disabled', disabled);
        badge.textContent = disabled ? '✕' : (orderNum != null ? '#' + orderNum : '—');
        badge.title = disabled
          ? 'Блок скрыт из превью (нажми чтобы включить)'
          : orderNum != null ? 'Блок #' + orderNum + ' в превью (нажми чтобы скрыть)' : 'Пустой — в превью не войдёт';
      } else if (b.type === 'snippets') {
        const en = (b.items || []).filter(i => i.enabled).length;
        badge.textContent = en + '/' + (b.items || []).length;
        badge.title = 'Включено / всего';
      } else if (b.type === 'commands') {
        badge.textContent = (b.items || []).length;
        badge.title = 'Команд';
      } else if (b.type === 'group') {
        badge.textContent = (b.children || []).length;
        badge.title = 'Блоков в группе';
      } else if (b.type === 'variable') {
        badge.textContent = '{{' + (b.variableName || '?') + '}}';
        badge.title = 'Переменная';
      } else if (b.type === 'sticky') {
        badge.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5.5h4M6 8h3M6 10.5h2"/></svg>';
        badge.title = 'Личная заметка — не попадёт в превью';
        badge.style.cursor = 'default';
      } else if (b.type === 'todo') {
        const sub = b.subtabs[b.activeSubtab];
        const items = sub?.items || [];
        const done = items.filter(i => i.done).length;
        const total = items.length;
        badge.className = 'block-order block-order-btn block-todo-count' + (done === total && total ? ' all-done' : '');
        badge.textContent = `${done}/${total}`;
        badge.title = 'Выполнено / всего';
      }
    }
    updateBadge();

    if (b.type === 'text') {
      badge.onclick = e => {
        e.stopPropagation();
        State.update(() => { b.previewDisabled = !b.previewDisabled; });
      };
    } else {
      badge.style.cursor = 'default';
      badge.onclick = e => e.stopPropagation();
    }

    h.appendChild(handle);
    h.appendChild(icon);
    h.appendChild(title);
    h.appendChild(badge);

    // --- type-specific extras ---
    if (b.type === 'snippets') {
      const stog = document.createElement('label');
      stog.className = 'snippet-show-title-label' + (b.showTitles !== false ? ' active' : '');
      stog.title     = 'Заголовки в превью';
      const scb  = document.createElement('input');
      scb.type    = 'checkbox';
      scb.checked = b.showTitles !== false;
      scb.onchange = () => State.update(() => { b.showTitles = scb.checked; });
      stog.appendChild(scb);
      stog.appendChild(document.createTextNode(' Загол.'));
      h.appendChild(stog);

    } else if (b.type === 'group') {
      const tog = document.createElement('label');
      tog.className = 'group-enable-label';
      const cb  = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = b.enabled !== false;
      cb.onchange = () => State.update(() => { b.enabled = cb.checked; });
      tog.appendChild(cb);
      tog.appendChild(document.createTextNode(' вкл'));
      h.appendChild(tog);

    } else if (b.type === 'text') {
      // Кнопка авто-заголовка ПЕРЕД <12345> (#5)
      const autoTitleBtn = document.createElement('button');
      autoTitleBtn.type      = 'button';
      autoTitleBtn.className = 'llm-block-btn';
      autoTitleBtn.title     = 'Авто-заголовок (LLM)';
      autoTitleBtn.setAttribute('aria-label', 'Авто-заголовок через LLM');
      autoTitleBtn.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
        '<path d="M8 2l.9 1.8 2 .3-1.45 1.4.34 2L8 6.7l-1.79.8.34-2L5.1 4.1l2-.3z"/>' +
        '<path d="M3 11h10M3 14h6"/></svg>';
      autoTitleBtn.addEventListener('click', e => {
        e.stopPropagation();
        window.LLMFeatures?.AutoTitle?.autoTitle(b.id);
      });
      h.appendChild(autoTitleBtn);
      h.appendChild(createSubtabNav(b));

    } else if (b.type === 'sticky') {
      const sp = document.createElement('span');
      sp.style.flex = '1';
      h.appendChild(sp);

      const palette = document.createElement('span');
      palette.className = 'color-palette';
      palette.style.display = 'none';
      const colors = ['yellow', 'green', 'blue', 'pink', 'gray'];
      const colorVars = { yellow: '#d4c373', green: '#7fb389', blue: '#7aa7d4', pink: '#cf8fb3', gray: '#9aa0a6' };
      colors.forEach(c => {
        const dot = document.createElement('span');
        dot.className = 'color-dot' + (b.color === c ? ' active' : '');
        dot.style.background = colorVars[c];
        dot.onclick = e => {
          e.stopPropagation();
          State.update(() => { b.color = c; });
          palette.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
          dot.classList.add('active');
          palette.style.display = 'none';
          el.setAttribute('data-color', c);
          el.style.setProperty('--note-color', colorVars[c]);
        };
        palette.appendChild(dot);
      });

      const colorBtn = document.createElement('button');
      colorBtn.type = 'button';
      colorBtn.className = 'block-btn';
      colorBtn.title = 'Цвет заметки';
      colorBtn.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + (colorVars[b.color] || colorVars.yellow) + ';vertical-align:middle;"></span>';
      colorBtn.onclick = e => {
        e.stopPropagation();
        palette.style.display = palette.style.display === 'none' ? 'flex' : 'none';
      };
      h.appendChild(colorBtn);
      h.appendChild(palette);

    } else if (b.type === 'todo') {
      const sp = document.createElement('span');
      sp.style.flex = '1';
      h.appendChild(sp);
      h.appendChild(createTodoSubtabNav(b));

    } else {
      const sp = document.createElement('span');
      sp.style.flex = '1';
      h.appendChild(sp);
    }

    // --- collapse + delete ---
    const actions = document.createElement('span');
    actions.className = 'block-actions';

    if (b.type === 'group') {
      const addBtn = makeIconBtn(svgIcon('plus'), 'Добавить блок в группу');
      addBtn.style.color = 'var(--green)';
      addBtn.onclick = e => {
        e.stopPropagation();
        const type = prompt('Тип (text/snippets/commands/variable/sticky/todo):', 'text');
        if (type) State.addBlock(type, b.id);
      };
      actions.appendChild(addBtn);
    }

    // ── Dropdown 🪮 Причёска — локальная уборка + LLM-редактура ─────────────
    if (b.type === 'text' || b.type === 'snippets') {
      const groomDd = document.createElement('div');
      groomDd.className = 'dropdown';

      const groomTrigger = document.createElement('button');
      groomTrigger.type      = 'button';
      groomTrigger.className = 'block-btn llm-block-btn llm-groom-trigger' + (b.type === 'text' ? ' text-groom-trigger' : '');
      groomTrigger.title     = b.type === 'text' ? 'Причесать текст' : 'Причесать текст (LLM)';
      groomTrigger.setAttribute('aria-label', b.type === 'text' ? 'Причесать текст' : 'Причесать через LLM');
      groomTrigger.setAttribute('aria-haspopup', 'menu');
      groomTrigger.setAttribute('aria-expanded', 'false');
      groomTrigger.innerHTML =
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"` +
        ` stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="M3 4h10M3 7h10M3 10h10"/>` +
        `<path d="M5 13c2.2-1.2 4.2-1.2 6 0"/></svg>`;

      const lintBadge = getTextLintBadgeInfo(b);
      if (lintBadge) {
        groomTrigger.dataset.lintBadge = lintBadge.label;
        groomTrigger.classList.add(lintBadge.className);
        groomTrigger.title += ' · ' + lintBadge.title;
        groomTrigger.setAttribute('aria-label', `${groomTrigger.getAttribute('aria-label')} (${lintBadge.title})`);
      }

      const groomMenu = document.createElement('nav');
      groomMenu.className = 'dropdown-menu llm-groom-menu';
      groomMenu.style.minWidth = b.type === 'text' ? '184px' : '175px';
      groomMenu.setAttribute('aria-label', 'Режим причёсывания');
      const textLint = window.TextLinter;

      groomMenu.innerHTML =
        (b.type === 'text'
          ? `<div class="menu-section-label">Локальная причёска</div>` +
            `<button type="button" class="text-lint-local-action" data-lint-action="quick"${textLint ? '' : ' disabled title="text-linter.js ещё не загружен"'}>🪮 Быстро причесать</button>` +
            `<button type="button" data-lint-action="preview"${textLint ? '' : ' disabled title="text-linter.js ещё не загружен"'}>👁 Показать diff и подсказки</button>` +
            `<div class="menu-sep"></div>`
          : '') +
        `<div class="menu-section-label">LLM-редактура</div>` +
        `<button type="button" data-groom="edit">✏️ Правка грамматики</button>` +
        `<button type="button" data-groom="format">📐 Форматирование</button>` +
        `<div class="menu-sep"></div>` +
        `<div class="menu-section-label">Сокращение</div>` +
        `<button type="button" data-groom="shrink_20">✂️ −20%</button>` +
        `<button type="button" data-groom="shrink_40">✂️ −40%</button>` +
        `<button type="button" data-groom="shrink_60">✂️ −60%</button>` +
        `<div class="menu-sep"></div>` +
        `<div class="menu-section-label">Расширение и тон</div>` +
        `<button type="button" data-groom="expand">📈 Расширить</button>` +
        `<button type="button" data-groom="formal">🎩 Формальный</button>` +
        `<button type="button" data-groom="casual">😊 Неформальный</button>` +
        `<button type="button" data-groom="tech">💻 Технический</button>` +
        `<button type="button" data-groom="friendly">🤝 Дружелюбный</button>` +
        `<div class="menu-sep"></div>` +
        `<button type="button" data-groom="positive_instr">➕ Позитивные инструкции</button>`;

      const setGroomOpen = open => {
        groomDd.classList.toggle('open', open);
        groomTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      };

      groomTrigger.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.dropdown.open').forEach(d => {
          if (d !== groomDd) closeDropdownElement(d);
        });
        setGroomOpen(!groomDd.classList.contains('open'));
      });

      groomMenu.addEventListener('click', e => e.stopPropagation());

      groomMenu.querySelectorAll('[data-lint-action]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          setGroomOpen(false);
          if (btn.dataset.lintAction === 'preview') window.TextLinter?.openPreview?.(b.id);
          else window.TextLinter?.runQuick?.(b.id);
        });
      });

      groomMenu.querySelectorAll('[data-groom]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          setGroomOpen(false);
          window.LLMFeatures?.groomBlock(b.id, btn.dataset.groom);
        });
      });

      groomDd.appendChild(groomTrigger);
      groomDd.appendChild(groomMenu);
      actions.appendChild(groomDd);
    }

    const collapseBtn = makeIconBtn(svgIcon('chevron'), 'Свернуть / развернуть');
    collapseBtn.classList.add('block-toggle-collapse');
    collapseBtn.onclick = e => { e.stopPropagation(); State.update(() => { b.collapsed = !b.collapsed; }); if (typeof Ember !== 'undefined') Ember.triggerReaction('blockCollapse', { collapsed: b.collapsed }); };
    actions.appendChild(collapseBtn);

    const delBtn = makeIconBtn(svgIcon('trash'), '');
    delBtn.classList.add('block-remove');
    let delPending = false, delTimer = null;
    delBtn.onclick = e => {
      e.stopPropagation();
      if (!delPending) {
        delPending = true;
        delBtn.classList.add('block-remove-pending');
        delTimer = setTimeout(() => { delPending = false; delBtn.classList.remove('block-remove-pending'); }, 2500);
      } else {
        clearTimeout(delTimer);
        delBtn.classList.remove('block-remove-pending');
        // Очищаем ResizeObserver блока перед удалением
        if (observerMap.has(b.id)) {
          observerMap.get(b.id).disconnect();
          observerMap.delete(b.id);
        }
        State.update(tab => { State.removeBlock(tab.blocks, b.id); });
        if (typeof Ember !== 'undefined') Ember.triggerReaction('delete');
      }
    };
    actions.appendChild(delBtn);
    h.appendChild(actions);

    // Dblclick на заголовке сворачивает блок (пропускаем интерактивные элементы)
    h.addEventListener('dblclick', e => {
      if (e.target.closest('input, button, label, span.block-toggle, span.block-handle, span.block-actions')) return;
      e.stopPropagation();
      State.update(() => { b.collapsed = !b.collapsed; });
    });

    return h;
  }

  /* ================================================================
     Inline subtab switch (без полного re-render)
  ================================================================ */
  function patchSubtab(b, newIdx) {
    if (newIdx === b.activeSubtab) return;

    const blockEl = colLeft.querySelector(`.block[data-id="${b.id}"]`)
                 || colRight.querySelector(`.block[data-id="${b.id}"]`);
    if (!blockEl) { State.update(() => { b.activeSubtab = newIdx; }); return; }

    const ta = blockEl.querySelector('textarea.block-textarea');
    if (ta) {
      _taScrollMap.set(b.id + ':' + b.activeSubtab, ta.scrollTop);
      b.activeSubtab = newIdx;
      ta.value = b.subtabs[newIdx].value || '';
      const savedTop = _taScrollMap.get(b.id + ':' + newIdx);
      if (savedTop != null) ta.scrollTop = savedTop;
    } else {
      b.activeSubtab = newIdx;
    }

    const tabs = blockEl.querySelectorAll('.block-subtabs .block-subtab');
    tabs.forEach(btn => {
      const idx = Number(btn.dataset.subtabIdx);
      btn.classList.toggle('active', idx === newIdx);
      const sub = b.subtabs[idx];
      if (sub) {
        btn.classList.toggle('filled', !!(sub.value || '').trim());
      }
    });

    const arrows = blockEl.querySelectorAll('.subtab-arrow');
    if (arrows[0]) arrows[0].disabled = newIdx <= 0;
    if (arrows[1]) arrows[1].disabled = newIdx >= State.SUBTABS_COUNT - 1;

    State.snapshot();
  }

  /* ================================================================
     Subtab nav
  ================================================================ */
  function createSubtabNav(b) {
    const nav  = document.createElement('div');
    nav.className = 'block-subtabs-nav';

    const prevBtn = document.createElement('button');
    prevBtn.type        = 'button';
    prevBtn.className   = 'subtab-arrow';
    prevBtn.textContent = '◀';
    prevBtn.title       = 'Предыдущая вкладка';

    const wrap = document.createElement('div');
    wrap.className = 'block-subtabs-wrap';
    const row  = document.createElement('div');
    row.className = 'block-subtabs';

    const nextBtn = document.createElement('button');
    nextBtn.type        = 'button';
    nextBtn.className   = 'subtab-arrow';
    nextBtn.textContent = '▶';
    nextBtn.title       = 'Следующая вкладка';

    function clampOffset() {
      let off = subtabOffsets.get(b.id) || 0;
      if (b.activeSubtab < off) off = b.activeSubtab;
      if (b.activeSubtab >= off + VISIBLE_SUBTABS) off = b.activeSubtab - VISIBLE_SUBTABS + 1;
      off = Math.max(0, Math.min(off, State.SUBTABS_COUNT - VISIBLE_SUBTABS));
      subtabOffsets.set(b.id, off);
      return off;
    }

    function buildTabs() {
      const offset = clampOffset();
      row.innerHTML = '';
      const end = Math.min(offset + VISIBLE_SUBTABS, State.SUBTABS_COUNT);
      for (let i = offset; i < end; i++) {
        const sub = b.subtabs[i];
        const displayName = sub.name || sub.label;
        const btn = document.createElement('span');
        btn.className = 'block-subtab' + (i === b.activeSubtab ? ' active' : '');
        btn.dataset.subtabIdx = i;
        if ((sub.value || '').trim()) btn.classList.add('filled');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'block-subtab-label';
        labelSpan.textContent = displayName;
        btn.appendChild(labelSpan);

        const renameInput = document.createElement('input');
        renameInput.className = 'block-subtab-rename';
        renameInput.maxLength = 20;
        renameInput.spellcheck = false;
        renameInput.style.display = 'none';
        btn.appendChild(renameInput);

        let _mqTimer = null;
        let _mqRaf = null;
        let _tipEl = null;

        function _removeTooltip() {
          clearTimeout(_mqTimer);
          cancelAnimationFrame(_mqRaf);
          _mqTimer = null;
          _mqRaf = null;
          if (_tipEl) { _tipEl.remove(); _tipEl = null; }
        }

        function _startMarquee(txt) {
          const sep = '   \u00b7   ';
          _tipEl.textContent = txt + sep;
          void _tipEl.offsetWidth;
          const unitW = _tipEl.scrollWidth;
          const dur = Math.max(350, unitW * 6);
          const speed = unitW / dur;
          const reps = Math.ceil(120000 / dur) + 2;
          _tipEl.textContent = (txt + sep).repeat(reps);
          let pos = 0;
          let lastT = performance.now();
          const tick = now => {
            const dt = now - lastT;
            lastT = now;
            pos += dt * speed;
            if (pos >= unitW * (reps - 1)) pos -= Math.floor(pos / unitW) * unitW;
            _tipEl.scrollLeft = Math.round(pos);
            _mqRaf = requestAnimationFrame(tick);
          };
          _mqRaf = requestAnimationFrame(tick);
        }

        btn.addEventListener('mouseenter', () => {
          const txt = sub.name || '';
          if (!txt || txt.length <= 6) return;
          _mqTimer = setTimeout(() => {
            _tipEl = document.createElement('div');
            _tipEl.className = 'subtab-marquee-tip';
            _tipEl.textContent = txt;
            document.body.appendChild(_tipEl);
            const r = btn.getBoundingClientRect();
            _tipEl.style.left = (r.left + r.width / 2) + 'px';
            _tipEl.style.top = (r.top - 6) + 'px';
            if (_tipEl.scrollWidth - _tipEl.clientWidth > 2) {
              _startMarquee(txt);
            }
          }, 500);
        });

        btn.addEventListener('mouseleave', _removeTooltip);

        let _clickTimer = null;
        btn.addEventListener('dblclick', e => {
          e.stopPropagation();
          _removeTooltip();
          clearTimeout(_clickTimer);
          labelSpan.style.display = 'none';
          renameInput.style.display = '';
          renameInput.value = sub.name || '';
          requestAnimationFrame(() => { renameInput.focus(); renameInput.select(); });
        });

        btn.onclick = e => {
          _removeTooltip();
          clearTimeout(_clickTimer);
          _clickTimer = setTimeout(() => {
            const dir = i > b.activeSubtab ? 1 : -1;
            patchSubtab(b, i);
            if (typeof Ember !== 'undefined') Ember.triggerReaction('subtabSwitch', { dir });
          }, 220);
        };

        const commitRename = () => {
          const v = renameInput.value.trim();
          State.update(() => { sub.name = v; });
          renameInput.style.display = 'none';
          labelSpan.textContent = v || sub.label;
          labelSpan.style.display = '';
        };
        renameInput.onblur = commitRename;
        renameInput.onkeydown = ev => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); renameInput.blur(); }
          if (ev.key === 'Escape') {
            renameInput.style.display = 'none';
            labelSpan.style.display = '';
          }
        };
        renameInput.onclick = ev => ev.stopPropagation();

        row.appendChild(btn);
      }
      prevBtn.disabled = b.activeSubtab <= 0;
      nextBtn.disabled = b.activeSubtab >= State.SUBTABS_COUNT - 1;
    }

    prevBtn.onclick = e => {
      e.stopPropagation();
      if (b.activeSubtab > 0) { patchSubtab(b, b.activeSubtab - 1); if (typeof Ember !== 'undefined') Ember.triggerReaction('subtabSwitch', { dir: -1 }); }
    };
    nextBtn.onclick = e => {
      e.stopPropagation();
      if (b.activeSubtab < State.SUBTABS_COUNT - 1) { patchSubtab(b, b.activeSubtab + 1); if (typeof Ember !== 'undefined') Ember.triggerReaction('subtabSwitch', { dir: 1 }); }
    };

    buildTabs();
    wrap.appendChild(row);
    nav.appendChild(prevBtn);
    nav.appendChild(wrap);
    nav.appendChild(nextBtn);
    return nav;
  }

  /* ================================================================
     Text body
  ================================================================ */
  function renderTextBody(b, body) {
    const tools = document.createElement('div');
    tools.className = 'block-tools';

    const ta = document.createElement('textarea');

    // Синхронизация disabled-состояния кнопок по текущей истории блока

    const _syncBtns = () => {

      undoBtn.disabled = !State.canBlockUndo(b.id);

      redoBtn.disabled = !State.canBlockRedo(b.id);

    };

    const undoBtn  = makeToolBtn(svgIcon('undo'), 'Отменить (блок)', () => {
      State.blockUndo(b.id);
      if (typeof Ember !== 'undefined') Ember.triggerReaction('undoRedo', { dir: -1 });
      requestAnimationFrame(() => {
        const val = b.subtabs[b.activeSubtab]?.value ?? '';
        if (ta.value !== val) {
          const ss = ta.selectionStart, se = ta.selectionEnd;
          ta.value = val;
          ta.setSelectionRange(Math.min(ss, val.length), Math.min(se, val.length));
        }
        ta.focus();
        _syncBtns();
      });
    });

    const redoBtn  = makeToolBtn(svgIcon('redo'), 'Повторить (блок)', () => {
      State.blockRedo(b.id);
      if (typeof Ember !== 'undefined') Ember.triggerReaction('undoRedo', { dir: 1 });
      requestAnimationFrame(() => {
        const val = b.subtabs[b.activeSubtab]?.value ?? '';
        if (ta.value !== val) {
          const ss = ta.selectionStart, se = ta.selectionEnd;
          ta.value = val;
          ta.setSelectionRange(Math.min(ss, val.length), Math.min(se, val.length));
        }
        ta.focus();
        _syncBtns();
      });
    });

    undoBtn.disabled = true;

    redoBtn.disabled = true;
    undoBtn.addEventListener('mousedown', e => e.preventDefault());
    redoBtn.addEventListener('mousedown', e => e.preventDefault());
    const cutBtn   = makeToolBtn(svgIcon('cut'),   'Вырезать выделение', () => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (!sel) return;
      navigator.clipboard.writeText(sel).catch(() => {});
      window.PromptLoom?.record?.(sel, 'copy', {
        via: 'block-cut',
        blockId: b.id,
        title: b.title || ''
      });
      window.Intelligence?.track?.('block.cut', {
        blockId: b.id,
        title: b.title || '',
        chars: sel.length,
        selection: true,
        kind: window.PromptLoom?.classify?.(sel) || ''
      });
      ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    });
    const copyBtn  = makeToolBtn(svgIcon('copy'),  'Копировать блок',    () => {
      const text = ta.selectionStart !== ta.selectionEnd
        ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : ta.value;
      navigator.clipboard.writeText(text)
        .then(() => {
          window.PromptLoom?.record?.(text, 'copy', {
            via: ta.selectionStart !== ta.selectionEnd ? 'block-copy-selection' : 'block-copy',
            blockId: b.id,
            title: b.title || ''
          });
          window.Intelligence?.track?.('block.copy', {
            blockId: b.id,
            title: b.title || '',
            chars: text.length,
            selection: ta.selectionStart !== ta.selectionEnd,
            kind: window.PromptLoom?.classify?.(text) || ''
          });
          Toast.show('Скопировано ✓', 'success');
          if (typeof Ember !== 'undefined') Ember.triggerReaction('copy');
        })
        .catch(() => Toast.show('Ошибка копирования', 'error'));
    });

    // Управление положением курсора после вставки.
    // Старое поведение для служебных блоков сохраняем как дефолт, но теперь его можно переключить кнопкой в футере.
    const _scrollTopTitles = ['скрипт', 'код', 'css', 'js'];
    function _getDefaultPasteCursor() {
      return _scrollTopTitles.includes((b.title || '').trim().toLowerCase()) ? 'start' : 'end';
    }
    function _getPasteCursorMode() {
      return b.pasteCursor === 'start' || b.pasteCursor === 'end' ? b.pasteCursor : _getDefaultPasteCursor();
    }
    function _applyPasteCursor() {
      const mode = _getPasteCursorMode();
      if (mode !== 'start') return;
      requestAnimationFrame(() => {
        if (!ta.isConnected) return;
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      });
    }

    const pasteBtn = makeToolBtn(svgIcon('paste'), 'Вставить из буфера', () => {
      ta.focus();
      if (navigator.clipboard?.readText) {
        navigator.clipboard.readText()
          .then(text => {
            ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
            ta.dispatchEvent(new Event('input'));
            window.PromptLoom?.record?.(text, 'paste', {
              via: 'block-toolbar-paste',
              blockId: b.id,
              title: b.title || ''
            });
            window.Intelligence?.track?.('block.paste', {
              blockId: b.id,
              title: b.title || '',
              chars: text.length,
              kind: window.PromptLoom?.classify?.(text) || ''
            });
            _applyPasteCursor();
          })
          .catch(() => {
            Toast.show('Нажмите Ctrl+V для вставки', 'info');
          });
      } else {
        Toast.show('Нажмите Ctrl+V для вставки', 'info');
      }
    });

    const insertBtn   = makeToolBtn(svgIcon('lightning'), 'Вставить сниппет', e => { e.stopPropagation(); showSnippetDropdown(insertBtn, ta); });
    const loomBtn     = makeToolBtn(svgIcon('loom'),      'Prompt Loom: последние фрагменты (\\)', e => {
      e.stopPropagation();
      ta.focus();
      if (!window.PromptLoom?.openQuickFor?.(loomBtn, '')) {
        Toast.show('Prompt Loom ещё не готов или история пуста', 'info');
      }
    });
    const clearBtn    = makeToolBtn(svgIcon('x'),         'Очистить (выделение или вкладку)', () => {
      if (ta.selectionStart !== ta.selectionEnd) {
        ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      } else if (ta.value) {
        State.update(() => { b.subtabs[b.activeSubtab].value = ''; });
      }
    });
    const saveBtn     = makeToolBtn(svgIcon('save'),      'Сохранить в .txt', () => {
      const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }));
      Object.assign(document.createElement('a'), { href: url, download: (b.title || 'block') + '.txt' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      Toast.show('Файл скачан ✓', 'success');
    });

    const transferBtn = makeToolBtn(svgIcon('transfer'), 'Скопировать текст на следующую вкладку', () => {
      if (!ta.value.trim()) return;
      let target = (b.activeSubtab + 1) % State.SUBTABS_COUNT;
      for (let i = 1; i < State.SUBTABS_COUNT; i++) {
        const idx = (b.activeSubtab + i) % State.SUBTABS_COUNT;
        if (!b.subtabs[idx].value.trim()) { target = idx; break; }
      }
      b.subtabs[target].value += (b.subtabs[target].value ? '\n' : '') + b.subtabs[b.activeSubtab].value;
      patchSubtab(b, target);
      Toast.show('Скопировано ✓', 'success');
    });

    [undoBtn, redoBtn, cutBtn, copyBtn, pasteBtn, makeDivider(), insertBtn, loomBtn, makeDivider(), clearBtn, saveBtn, transferBtn, makeDivider(), Anchors.createBlockAnchorButtons(b.id, ta)]
      .forEach(el => tools.appendChild(el));
    body.appendChild(tools);

    ta.className   = 'block-textarea';
    ta.spellcheck  = b.spellcheck !== false;
    ta.value       = b.subtabs[b.activeSubtab].value || '';
    ta.placeholder = b.placeholder || 'Введите текст...';
    ta.style.fontSize = (b.fontSize || 12) + 'px';
    ta.rows = 5;
    if (b.height) ta.style.height = b.height + 'px';

    // Сохраняем прокрутку textarea при скроллинге
    ta.addEventListener('scroll', () => {
      _taScrollMap.set(b.id + ':' + b.activeSubtab, ta.scrollTop);
      _persistTaScrollMap();
    }, { passive: true });

    _pendingTaScrolls.push({ ta, blockId: b.id, subIdx: b.activeSubtab });

    // [FIX] Сохраняем ResizeObserver в Map для последующей очистки
    let _roSkipFirst = true;
    const _ro = new ResizeObserver(() => {
      if (!ta.isConnected) { _ro.disconnect(); observerMap.delete(b.id); return; }
      if (_roSkipFirst) { _roSkipFirst = false; return; }
      const h = ta.offsetHeight;
      if (h > 0 && h !== b.height) {
        b.height = h;
        clearTimeout(ta._heightSnapTimer);
        ta._heightSnapTimer = setTimeout(() => State.snapshot(), 600);
      }
    });
    _ro.observe(ta);
    observerMap.set(b.id, _ro); // [FIX] регистрируем для cleanupObservers()

    // Дебаунс-таймер для blockSnapshot этого блока

    let _bsTimer = null;

    const _scheduleBlockSnap = () => {

      clearTimeout(_bsTimer);

      _bsTimer = setTimeout(() => { State.blockSnapshot(b.id); _syncBtns(); }, 800);

    };



    ta.addEventListener('input', () => {

      const val = ta.value;

      State.updateLive(() => { b.subtabs[b.activeSubtab].value = val; });

      updateBlockCounter(ta, b, body);

      WordDict.scheduleBuild();

      WordComplete.handleInput(ta);

      SmartList.handleInput(ta);

      updateGlobalWordCount(); // debounced

      _handleSlashTrigger(ta); // улучш. #4

      _scheduleBlockSnap();    // фиксируем состояние блока в историю

      window.Intelligence?.trackEdit?.({
        blockId: b.id,
        title: b.title || '',
        chars: val.length,
        kind: window.PromptLoom?.classify?.(val) || ''
      });

    });

    ta.addEventListener('keydown', e => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
      ) {
        if (window.LLMFeatures?.BroTags?.handle(e, ta, b.id)) return;
      }
      WordComplete.handleKeydown(e, ta);
      SmartList.handleKeydown(e, ta);
    });

    ta.addEventListener('paste', e => {
      const pasted = e.clipboardData?.getData('text/plain') || '';
      window.Intelligence?.track?.('block.paste', {
        blockId: b.id,
        title: b.title || '',
        chars: pasted.length,
        kind: window.PromptLoom?.classify?.(pasted) || ''
      });
      requestAnimationFrame(() => {
        ta.dispatchEvent(new Event('input'));
        _applyPasteCursor();
      });
    });
    ta.addEventListener('blur', e => {
      // Если фокус ушёл на undo/redoBtn — не фиксируем снапшот:
      // кнопка вернёт фокус обратно в ta после отката
      if (e.relatedTarget === undoBtn || e.relatedTarget === redoBtn) return;
      clearTimeout(_bsTimer);
      State.blockSnapshot(b.id);
      _syncBtns();
      State.snapshot();
    });

    const lineWrap = document.createElement('div');
    lineWrap.className = 'current-line-wrap';
    const lineHighlight = document.createElement('div');
    lineHighlight.className = 'current-line-highlight';
    lineWrap.appendChild(lineHighlight);
    lineWrap.appendChild(ta);

    let lineMirror = null;
    const lineMirrorProps = [
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures',
      'fontFeatureSettings', 'fontKerning', 'letterSpacing', 'lineHeight',
      'textTransform', 'textIndent', 'wordBreak', 'overflowWrap', 'tabSize',
    ];

    function getLineMirror(cs) {
      if (!lineMirror) {
        lineMirror = document.createElement('div');
        lineMirror.style.position = 'absolute';
        lineMirror.style.visibility = 'hidden';
        lineMirror.style.pointerEvents = 'none';
        lineMirror.style.top = '0';
        lineMirror.style.left = '0';
        lineMirror.style.overflow = 'hidden';
        lineMirror.style.whiteSpace = 'pre-wrap';
        lineMirror.style.wordWrap = 'break-word';
        lineWrap.appendChild(lineMirror);
      }

      for (const prop of lineMirrorProps) lineMirror.style[prop] = cs[prop];
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      lineMirror.style.boxSizing = 'content-box';
      lineMirror.style.width = Math.max(0, ta.clientWidth - pl - pr) + 'px';
      return lineMirror;
    }

    function updateCurrentLineHighlight() {
      const lay = State.getLayout();
      const enabled = lay.currentLineHighlight === true && document.activeElement === ta;
      lineWrap.classList.toggle('current-line-enabled', enabled);
      if (!enabled) return;

      const cs = getComputedStyle(ta);
      const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.65;
      const mirror = getLineMirror(cs);
      mirror.textContent = '';

      const before = document.createElement('span');
      before.textContent = ta.value.substring(0, ta.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = ta.value.substring(ta.selectionStart, ta.selectionStart + 1) || '.';
      mirror.appendChild(before);
      mirror.appendChild(marker);

      const markerRect = marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const taRect = ta.getBoundingClientRect();
      const wrapRect = lineWrap.getBoundingClientRect();
      const glyphOffset = Math.max(0, (lineHeight - markerRect.height) / 2) - 1;
      const top = (taRect.top - wrapRect.top) +
        (markerRect.top - mirrorRect.top) -
        glyphOffset -
        ta.scrollTop;

      lineHighlight.style.top = top + 'px';
      lineHighlight.style.height = lineHeight + 'px';
      lineHighlight.style.left = (parseFloat(cs.borderLeftWidth) || 0) + 'px';
      lineHighlight.style.right = (parseFloat(cs.borderRightWidth) || 0) + 'px';
      lineHighlight.style.background = lay.currentLineColor || 'rgba(79,142,247,0.18)';
    }

    ['focus', 'click', 'keyup', 'select', 'input', 'scroll'].forEach(evt => {
      ta.addEventListener(evt, () => {
        requestAnimationFrame(updateCurrentLineHighlight);
        requestAnimationFrame(() => requestAnimationFrame(updateCurrentLineHighlight));
      });
    });
    ta.addEventListener('blur', () => {
      updateCurrentLineHighlight();
      if (lineMirror?.parentNode) lineMirror.parentNode.removeChild(lineMirror);
      lineMirror = null;
    });

    body.appendChild(lineWrap);

    // Футер с кнопками размера шрифта и счётчиком
    const footer = document.createElement('div');
    footer.className = 'block-footer block-footer-compact';

    const fDecBtn = mkBtn('font-ctrl-btn', 'A−', 'Уменьшить шрифт');
    fDecBtn.onclick = e => { e.stopPropagation(); State.update(() => { b.fontSize = Math.max(8, (b.fontSize || 12) - 1); }); };

    const fIncBtn = mkBtn('font-ctrl-btn', 'A+', 'Увеличить шрифт');
    fIncBtn.onclick = e => { e.stopPropagation(); State.update(() => { b.fontSize = Math.min(24, (b.fontSize || 12) + 1); }); };

    const pasteCursorBtn = mkBtn('font-ctrl-btn paste-cursor-btn', '', '');
    pasteCursorBtn.setAttribute('aria-label', 'Положение курсора после вставки');

    function _syncPasteCursorBtn() {
      const mode = _getPasteCursorMode();
      pasteCursorBtn.innerHTML = '<span class="paste-cursor-triangle" aria-hidden="true"></span>';
      pasteCursorBtn.title = mode === 'start'
        ? 'После вставки курсор будет в начале. Нажми, чтобы включить обычную вставку.'
        : 'Обычная вставка: курсор остаётся после вставленного текста. Нажми, чтобы переносить курсор в начало.';
      pasteCursorBtn.setAttribute('aria-pressed', mode === 'start' ? 'true' : 'false');
      pasteCursorBtn.dataset.cursor = mode;
    }

    _syncPasteCursorBtn();
    pasteCursorBtn.onclick = e => {
      e.stopPropagation();
      State.update(() => { b.pasteCursor = _getPasteCursorMode() === 'start' ? 'end' : 'start'; });
    };

    const spellcheckBtn = document.createElement('button');
    spellcheckBtn.type = 'button';
    spellcheckBtn.className = 'font-ctrl-btn';
    spellcheckBtn.title = 'Проверка орфографии';
    function _syncSpellcheckBtn() {
      const on = b.spellcheck !== false;
      spellcheckBtn.innerHTML = on
        ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M2.5 8.5l3 3 5-6"/><path d="M10.5 3l2 2 3-3"/></svg>'
        : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;opacity:0.35"><path d="M2.5 8.5l3 3 5-6"/><path d="M10.5 3l2 2 3-3"/></svg>';
      spellcheckBtn.title = on ? 'Орфография: вкл. Нажми чтобы выключить' : 'Орфография: выкл. Нажми чтобы включить';
      spellcheckBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    _syncSpellcheckBtn();
    spellcheckBtn.onclick = e => {
      e.stopPropagation();
      b.spellcheck = b.spellcheck === false ? true : false;
      ta.spellcheck = b.spellcheck !== false;
      _syncSpellcheckBtn();
    };

    function _jumpBlockScroll(toEnd) {
      const pos = toEnd ? ta.value.length : 0;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(pos, pos);
      ta.scrollTop = toEnd ? ta.scrollHeight : 0;
    }

    const scrollTopBtn = mkBtn('font-ctrl-btn block-scroll-btn block-scroll-up', '', 'Прокрутить блок вверх');
    scrollTopBtn.innerHTML = '<span class="block-scroll-triangle" aria-hidden="true"></span>';
    scrollTopBtn.setAttribute('aria-label', 'Прокрутить блок вверх');
    scrollTopBtn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      _jumpBlockScroll(false);
    };

    const scrollBottomBtn = mkBtn('font-ctrl-btn block-scroll-btn block-scroll-down', '', 'Прокрутить блок вниз');
    scrollBottomBtn.innerHTML = '<span class="block-scroll-triangle" aria-hidden="true"></span>';
    scrollBottomBtn.setAttribute('aria-label', 'Прокрутить блок вниз');
    scrollBottomBtn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      _jumpBlockScroll(true);
    };

    const counterSpan = document.createElement('span');
    counterSpan.className = 'block-counter-badge';
    body._counterSpan = counterSpan;
    updateBlockCounter(ta, b, body);

    const anchorCountEl = document.createElement('span');
    anchorCountEl.className = 'block-anchor-count';
    anchorCountEl.title = 'Якоря в блоке';
    body._anchorCountEl = anchorCountEl;
    _updateAnchorCount(b.id, anchorCountEl);

    const scrollControls = document.createElement('div');
    scrollControls.className = 'block-scroll-controls';
    scrollControls.appendChild(scrollTopBtn);
    scrollControls.appendChild(scrollBottomBtn);
    scrollControls.appendChild(anchorCountEl);
    scrollControls.appendChild(counterSpan);

    // ── Translate button ───────────────────────────────────────
    const TRANSLATE_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15"/><path d="M10 2.5c2.5 2.5 3.5 5 3.5 7.5s-1 5-3.5 7.5"/><path d="M10 2.5c-2.5 2.5-3.5 5-3.5 7.5s1 5 3.5 7.5"/></svg>';
    const translateBtn = mkBtn('font-ctrl-btn translate-btn', '', 'Перевести');
    translateBtn.innerHTML = TRANSLATE_SVG;
    translateBtn.setAttribute('aria-label', 'Перевести текст');
    translateBtn.dataset.lang = Translator.targetLang;

    const translateDropdown = document.createElement('div');
    translateDropdown.className = 'translate-dropdown';
    translateDropdown.style.display = 'none';

    function _buildTranslateMenu() {
      translateDropdown.innerHTML = '';

      // ── Engine selector ──
      const engineRow = document.createElement('div');
      engineRow.className = 'translate-engine-row';
      const engines = [
        { id: 'auto', label: 'Auto', svg: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 1.5"/></svg>' },
        { id: 'google', label: 'G', svg: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.2 6.8v2.6h3.7c-.15 1-.55 1.7-1.15 2.2l1.9 1.5c1.1-1 1.8-2.5 1.8-4.3 0-.4-.04-.8-.1-1.2H8.2z" opacity=".9"/><path d="M3.4 9.7l-.7.5-1.2 1C2.7 13.4 5.2 15 8.2 15c2.3 0 4.2-.8 5.6-2.1l-1.9-1.5c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8l-.3-.8z" opacity=".7"/><path d="M1.5 4.8C2 3.6 2.8 2.6 3.8 1.8L5.4 3c-.6.6-1 1.3-1.3 2.1L1.5 4.8z" opacity=".5"/><path d="M8 3c1.3 0 2.4.4 3.3 1.3L13 2.8C11.5 1.5 9.9.8 8 .8 5.2.8 2.7 2.4 1.5 4.8l2.4 1.9C4.4 5.1 6.1 3 8 3z" opacity=".6"/></svg>' },
        { id: 'microsoft', label: 'MS', svg: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6.5" height="6.5" rx=".5" opacity=".9"/><rect x="8.5" y="1" width="6.5" height="6.5" rx=".5" opacity=".7"/><rect x="1" y="8.5" width="6.5" height="6.5" rx=".5" opacity=".7"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx=".5" opacity=".5"/></svg>' },
      ];
      const curEngine = Translator.engine;
      engines.forEach(eng => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'translate-engine-btn' + (eng.id === curEngine ? ' active' : '');
        btn.innerHTML = eng.svg + eng.label;
        btn.onclick = e => {
          e.stopPropagation();
          Translator.engine = eng.id;
          _buildTranslateMenu();
        };
        engineRow.appendChild(btn);
      });
      translateDropdown.appendChild(engineRow);

      Translator.LANGUAGES.forEach(lang => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'translate-lang-opt' + (lang.code === Translator.targetLang ? ' active' : '');
        opt.textContent = lang.flag + ' ' + lang.name;
        opt.onclick = e => {
          e.stopPropagation();
          Translator.targetLang = lang.code;
          translateBtn.dataset.lang = lang.code;
          translateBtn.title = 'Перевести → ' + lang.name;
          _buildTranslateMenu();
          translateDropdown.style.display = 'none';
        };
        translateDropdown.appendChild(opt);
      });
    }
    _buildTranslateMenu();

    let translateLongPressTimer = null;
    let translateLongPressed = false;

    translateBtn.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      translateLongPressed = false;
      translateLongPressTimer = setTimeout(() => {
        translateLongPressed = true;
        const rect = translateBtn.getBoundingClientRect();
        translateDropdown.style.left = rect.left + 'px';
        translateDropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        translateDropdown.style.display = translateDropdown.style.display === 'none' ? 'block' : 'none';
      }, 400);
    });

    translateBtn.addEventListener('mouseup', () => {
      clearTimeout(translateLongPressTimer);
    });

    translateBtn.addEventListener('mouseleave', () => {
      clearTimeout(translateLongPressTimer);
    });

    translateBtn.onclick = e => {
      e.stopPropagation();
      clearTimeout(translateLongPressTimer);
      if (translateLongPressed) { translateLongPressed = false; return; }
      translateDropdown.style.display = 'none';

      const selStart = ta.selectionStart;
      const selEnd = ta.selectionEnd;
      const hasSelection = selEnd > selStart;

      // Откат: только если нет нового выделения
      if (!hasSelection && translateBtn._undoStack?.length) {
        const prev = translateBtn._undoStack.pop();
        ta.value = prev.value;
        ta.setSelectionRange(prev.selStart, prev.selEnd);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        Toast.show('↩ Откат (' + translateBtn._undoStack.length + ' осталось)');
        if (!translateBtn._undoStack.length) {
          translateBtn._undoStack = null;
          translateBtn.dataset.state = '';
        }
        return;
      }

      const sel = ta.value.substring(selStart, selEnd);
      const textToTranslate = sel.trim() || ta.value;
      if (!textToTranslate.trim()) return;

      // Запоминаем пробелы в начале/конце выделения
      const leadSpace = sel.match(/^(\s*)/)[1];
      const trailSpace = sel.match(/(\s*)$/)[1];

      const targetLang = Translator.targetLang;
      const srcLang = Translator.detectLang(textToTranslate);

      if (srcLang && srcLang.code === targetLang) {
        Toast.show('Текст уже на ' + (srcLang?.name || targetLang));
        return;
      }

      const langName = Translator.LANG_BY_CODE[targetLang]?.name || targetLang;
      translateBtn.classList.add('translating');
      translateBtn.textContent = '⏳';
      Toast.show('Перевод → ' + langName + '...');

      // Построчно, сохраняя переносы и шаблоны
      const lines = textToTranslate.split('\n');
      const translatePromise = lines.length > 1
        ? Promise.all(lines.map(l => Translator.translateProtected(l, targetLang))).then(r => r.join('\n'))
        : Translator.translateProtected(textToTranslate, targetLang);

      translatePromise.then(result => {
        if (!result || result === textToTranslate) {
          Toast.show('Не удалось перевести');
          return;
        }

        Translator.addHistory(textToTranslate, result, srcLang?.code || '?', targetLang);

        // Сохраняем в стек отката
        if (!translateBtn._undoStack) translateBtn._undoStack = [];
        translateBtn._undoStack.push({
          value: ta.value,
          selStart, selEnd,
        });
        translateBtn.dataset.state = 'translated';

        // Восстанавливаем пробелы и заменяем выделение
        const finalResult = leadSpace + result + trailSpace;
        if (hasSelection) {
          ta.setRangeText(finalResult, selStart, selEnd, 'end');
        } else {
          ta.value = finalResult;
        }
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        Toast.show('✓ Переведено → ' + langName + ' (клик ↩ — откат ' + translateBtn._undoStack.length + ')');
        if (typeof Ember !== 'undefined') Ember.triggerReaction('translate');
      }).catch(err => {
        console.error('[Translator]', err);
        Toast.show('Ошибка перевода: ' + err.message);
      }).finally(() => {
        translateBtn.classList.remove('translating');
        translateBtn.innerHTML = TRANSLATE_SVG;
      });
    };

    document.addEventListener('mousedown', e => {
      if (!translateDropdown.contains(e.target) && e.target !== translateBtn) {
        translateDropdown.style.display = 'none';
      }
    });

    footer.appendChild(fDecBtn);
    footer.appendChild(fIncBtn);
    footer.appendChild(pasteCursorBtn);
    footer.appendChild(spellcheckBtn);
    footer.appendChild(translateBtn);
    footer.appendChild(scrollControls);
    body.appendChild(footer);
    body.appendChild(translateDropdown);
  }

  const _byteEnc = new TextEncoder();

  function _byteLen(s) { return _byteEnc.encode(s).length; }

  function updateBlockCounter(ta, b, body) {
    const span = body._counterSpan;
    if (!span) return;
    const text  = ta.value;
    const chars = text.length;
    const lines = text ? text.split('\n').length : 0;
    const kb    = (_byteLen(text) / 1024).toFixed(1);
    span.textContent = chars + '/' + lines + '/' + kb + 'KB';
  }

  const ANCHOR_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="4.5" r="2.5"/><line x1="10" y1="7" x2="10" y2="18"/><path d="M6 12.5H4a8 8 0 0 0 12 0h-2"/></svg>';

  function _updateAnchorCount(blockId, el) {
    if (!el) return;
    const tab = State.getActive();
    const anchors = (tab && tab.anchors) || [];
    const count = anchors.filter(a => a.blockId === blockId).length;
    el.innerHTML = ANCHOR_SVG + (count > 0 ? '<span>' + count + '</span>' : '');
    el.classList.toggle('has-anchors', count > 0);
    el.title = count ? count + ' якорей в блоке' : 'Нет якорей';
  }

  function refreshAllAnchorCounts() {
    document.querySelectorAll('.block[data-id]').forEach(el => {
      const body = el.querySelector('.block-body');
      if (body && body._anchorCountEl) {
        _updateAnchorCount(el.dataset.id, body._anchorCountEl);
      }
    });
  }

  /* ================================================================
     Slash-палитра: сниппеты/команды по «/» в textarea (улучш. #4)
  ================================================================ */
  let _slashPalette  = null;
  let _slashTa       = null;
  let _slashWrapHold = '';
  let _slashMode     = 'slash';
  let _slashAccept   = null;


  function _closeSlashPalette() {
    if (_slashPalette) { _slashPalette.remove(); _slashPalette = null; _slashTa = null; _slashWrapHold = ''; _slashMode = 'slash'; _slashAccept = null; }
  }


  function _slashFilterItems(query) {
    const allItems = (State.getAllSnippetsAndCommands?.()) || [];
    const q = (query || '').trim().toLowerCase();
    const items = q
      ? allItems.filter(i => (i.label + ' ' + i.value + ' ' + i.type).toLowerCase().includes(q))
      : allItems;

    const commands = items.filter(i => i.type === 'command');
    const snippets = items.filter(i => i.type !== 'command');

    // =slash order=
    // Компактно: быстрые команды первыми, но меню не раздуваем.
    return q ? [...commands, ...snippets].slice(0, 10) : [...commands.slice(0, 5), ...snippets.slice(0, 5)];
  }

  function _broTagFilterItems(query) {
    return window.LLMFeatures?.BroTags?.getQuickMenuItems?.(query) || [];
  }

  function _insertSlashItem(ta, item, slashStart, pos) {
    ta.setRangeText(item.value + ' ', slashStart, pos, 'end');
    ta.dispatchEvent(new Event('input'));
    State.snapshot();
    _notifySnippetUsed(item, item.type === 'command' ? 'slash-command' : 'slash-snippet');
    _closeSlashPalette();
    ta.focus();
  }

  function _insertBroTagItem(ta, item, bangStart, pos) {
    const tagText = String(item?.tag || '').trim();
    if (!tagText) return;
    const triggerText = ta.value.slice(bangStart, pos);
    const tagName = tagText.replace(/^!+/, '');
    const insertText = (triggerText.startsWith('!!') ? '!!' : '!') + tagName;
    ta.setRangeText(insertText + ' ', bangStart, pos, 'end');
    ta.dispatchEvent(new Event('input'));
    State.snapshot();
    _closeSlashPalette();
    ta.focus();
  }

  function _slashPreviewText(item) {
    const src = String(item.value || item.label || '').replace(/\s+/g, ' ').trim();
    return src.length > 30 ? src.slice(0, 30) + '…' : src;
  }

  function _broTagPreviewText(item) {
    return String(item?.tag || item?.label || '').trim();
  }

  function _notifySnippetUsed(item, via = 'slash-snippet') {
    // Сообщаем Prompt Loom о реальном использовании сниппета/команды, но не плодим дубли.
    const value = String(item?.value || '').trim();
    if (!value) return;

    try {
      const marked = window.PromptLoom?.markUsed?.(value, via);
      if (!marked) {
        window.PromptLoom?.record?.(value, 'snippet', {
          via,
          label: item?.label || '',
          type: item?.type || 'snippet'
        });
      }

      window.Intelligence?.track?.('snippet.used', {
        title: item?.label || item?.title || '',
        label: item?.label || item?.title || '',
        via,
        kind: item?.type || 'snippet',
        chars: value.length,
        textHash: window.Intelligence?.hashText?.(value) || window.PromptLoom?.hashText?.(value) || ''
      });
    } catch (_) {}
  }

  function _renderSlashPalette(ta, mode, query, triggerStart, pos, filtered) {
    if (!_slashPalette || _slashTa !== ta) {
      _closeSlashPalette();
      _slashPalette = document.createElement('div');
      _slashPalette.className = 'slash-palette';
      _slashPalette.setAttribute('role', 'listbox');
      document.body.appendChild(_slashPalette);
      _slashTa = ta;
    }

    _slashMode = mode;
    _slashPalette.setAttribute('aria-label', mode === 'bro' ? 'БРО-теги' : 'Сниппеты и быстрые команды');
    _slashPalette.innerHTML = '';
    _slashPalette.dataset.query = query;
    _slashPalette.dataset.mode = mode;

    filtered.forEach((item, idx) => {
      const row = document.createElement('button');
      const hotkey = !query && idx < 10 ? (idx < 9 ? String(idx + 1) : '0') : '';
      row.type = 'button';
      row.className = 'slash-item dropdown-item' + (idx === 0 ? ' focused' : '');
      row.dataset.type = mode === 'bro' ? 'bro-tag' : (item.type === 'command' ? 'command' : 'snippet');
      if (hotkey) row.dataset.hotkey = hotkey;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      row.title = mode === 'bro' ? (item.tag || item.label || '') : (item.value || item.label || '');

      if (mode === 'bro') {
        row.innerHTML = '<span class="slash-hotkey" aria-hidden="true">' + escHtml(hotkey) + '</span>'
          + '<span class="slash-kind" aria-hidden="true">!</span>'
          + '<span class="slash-text">' + escHtml(_broTagPreviewText(item)) + '</span>';
        row.onmousedown = ev => {
          ev.preventDefault();
          _insertBroTagItem(ta, item, triggerStart, pos);
        };
      } else {
        row.innerHTML = '<span class="slash-hotkey" aria-hidden="true">' + escHtml(hotkey) + '</span>'
          + '<span class="slash-kind" aria-hidden="true">' + escHtml(item.type === 'command' ? '⌘' : (item.icon || '•')) + '</span>'
          + '<span class="slash-text">' + escHtml(_slashPreviewText(item)) + '</span>';
        row.onmousedown = ev => {
          ev.preventDefault();
          _insertSlashItem(ta, item, triggerStart, pos);
        };
      }

      _slashPalette.appendChild(row);
    });

    if (!query && filtered.length) {
      const footer = document.createElement('div');
      footer.className = 'slash-footer';
      footer.textContent = '1–9,0 вставить · Esc';
      _slashPalette.appendChild(footer);
    }

    _slashWrapHold = '';

    (function _positionAtCaret() {
      const cs = window.getComputedStyle(ta);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const m = document.createElement('div');
      ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
       'paddingTop','paddingRight','paddingBottom','paddingLeft',
       'fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
       'lineHeight','textTransform','textIndent','wordBreak','overflowWrap','tabSize'
      ].forEach(p => { m.style[p] = cs[p]; });
      m.style.boxSizing = 'content-box';
      m.style.width = (ta.clientWidth - pl - pr) + 'px';
      m.style.position = 'absolute';
      m.style.visibility = 'hidden';
      m.style.pointerEvents = 'none';
      m.style.top = '-9999px';
      m.style.left = '-9999px';
      m.style.whiteSpace = 'pre-wrap';
      m.style.wordWrap = 'break-word';
      document.body.appendChild(m);
      const before = document.createElement('span');
      before.textContent = ta.value.substring(0, ta.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = ta.value.substring(ta.selectionStart, ta.selectionStart + 1) || '.';
      m.appendChild(before);
      m.appendChild(marker);
      const taR = ta.getBoundingClientRect();
      const mR = m.getBoundingClientRect();
      const mkR = marker.getBoundingClientRect();
      const ox = taR.left - mR.left - ta.scrollLeft;
      const oy = taR.top - mR.top - ta.scrollTop;
      let cx = mkR.left + ox;
      let cy = mkR.top + oy + lh + 4;
      document.body.removeChild(m);
      requestAnimationFrame(() => {
        if (!_slashPalette) return;
        const pw = _slashPalette.offsetWidth || 220;
        const ph = _slashPalette.offsetHeight || 180;
        if (cx + pw > window.innerWidth - 8) cx = Math.max(4, window.innerWidth - pw - 8);
        if (cy + ph > window.innerHeight - 8) cy = Math.max(4, cy - lh - ph - 8);
        _slashPalette.style.left = cx + 'px';
        _slashPalette.style.top = cy + 'px';
      });
      if (!_slashPalette) return;
      _slashPalette.style.left = cx + 'px';
      _slashPalette.style.top = cy + 'px';
    }());
  }

  function _handleSlashTrigger(ta) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const slashMatch = before.match(/(^|[\n\s])\/([^\s\n]*)$/);
    const broMatch = before.match(/(^|[\n\s])(!{1,2})([^\s\n!]*)$/);

    if (slashMatch) {
      const query = slashMatch[2].toLowerCase();
      const slashStart = pos - slashMatch[0].length + slashMatch[1].length;
      const filtered = _slashFilterItems(query);
      if (!filtered.length) { _closeSlashPalette(); return; }
      _renderSlashPalette(ta, 'slash', query, slashStart, pos, filtered);
      return;
    }

    if (broMatch) {
      const query = broMatch[3].toLowerCase();
      const bangStart = pos - broMatch[0].length + broMatch[1].length;
      const filtered = _broTagFilterItems(query);
      if (!filtered.length) { _closeSlashPalette(); return; }
      _renderSlashPalette(ta, 'bro', query, bangStart, pos, filtered);
      return;
    }

    _closeSlashPalette();
  }

  document.addEventListener('click',   e => { if (_slashPalette && !_slashPalette.contains(e.target)) _closeSlashPalette(); });
  document.addEventListener('keydown',  e => {
    if (!_slashPalette) return;
    const rows = [..._slashPalette.querySelectorAll('.dropdown-item')];
    if (!rows.length) return;
    const fi = rows.findIndex(x => x.classList.contains('focused'));

    const focusRow = idx => {
      rows.forEach(x => {
        x.classList.remove('focused');
        x.setAttribute('aria-selected', 'false');
      });
      if (rows[idx]) {
        rows[idx].classList.add('focused');
        rows[idx].setAttribute('aria-selected', 'true');
        rows[idx].scrollIntoView({ block: 'nearest' });
      }
    };

    const stopHandledKey = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    const hotkeyIndex = e.key === '0' ? 9 : (/^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1);
    if ((_slashPalette.dataset.query || '') === '' && hotkeyIndex >= 0 && rows[hotkeyIndex]) {
      stopHandledKey();
      rows[hotkeyIndex].dispatchEvent(new MouseEvent('mousedown'));
      return;
    }

    if (e.key === 'ArrowDown') {
      stopHandledKey();
      const cur = fi === -1 ? 0 : fi;
      if (cur >= rows.length - 1) {
        // =slash wrap=
        // Автоповтор клавиши только держит край, а новый физический нажим зацикливает список.
        if (e.repeat) { focusRow(rows.length - 1); _slashWrapHold = 'down'; }
        else if (_slashWrapHold === 'down') { focusRow(0); _slashWrapHold = ''; }
        else { focusRow(rows.length - 1); _slashWrapHold = 'down'; }
      } else {
        focusRow(cur + 1); _slashWrapHold = '';
      }
    } else if (e.key === 'ArrowUp') {
      stopHandledKey();
      const cur = fi === -1 ? 0 : fi;
      if (cur <= 0) {
        // =slash wrap=
        // Автоповтор клавиши только держит край, а новый физический нажим зацикливает список.
        if (e.repeat) { focusRow(0); _slashWrapHold = 'up'; }
        else if (_slashWrapHold === 'up') { focusRow(rows.length - 1); _slashWrapHold = ''; }
        else { focusRow(0); _slashWrapHold = 'up'; }
      } else {
        focusRow(cur - 1); _slashWrapHold = '';
      }
    }
    else if (e.key === 'Enter')   { const f = rows[fi===-1?0:fi]; if (f) { stopHandledKey(); f.dispatchEvent(new MouseEvent('mousedown')); } }
    else if (e.key === 'Escape')  { stopHandledKey(); _closeSlashPalette(); }
  }, true);


  /* ================================================================
     Snippet insert dropdown
  ================================================================ */
  function showSnippetDropdown(btn, ta) {
    const dd    = document.getElementById('snippet-dropdown');
    const items = (State.getAllSnippetsAndCommands?.()) || [];
    dd.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:10px 12px;color:var(--text3);font-size:11px;';
      empty.textContent   = 'Нет сниппетов и команд';
      dd.appendChild(empty);
    } else {
      items.forEach(item => {
        const btn2 = document.createElement('button');
        btn2.type = 'button';
        btn2.innerHTML = '<span class="snip-icon">' + escHtml(item.icon || '💬') + '</span>'
                       + '<span class="snip-label">' + escHtml(item.label) + '</span>'
                       + (item.global ? '<span class="snip-cloud" title="Глобальный сниппет">☁</span>' : '');
        btn2.title  = item.value;
        btn2.onclick = e => {
          e.stopPropagation();
          const pos = ta.selectionStart;
          ta.setRangeText(item.value + ' ', pos, ta.selectionEnd, 'end');
          ta.dispatchEvent(new Event('input'));
          State.snapshot();
          _notifySnippetUsed(item, item.type === 'command' ? 'dropdown-command' : 'dropdown-snippet');
          dd.style.display = 'none';
          ta.focus();
        };
        dd.appendChild(btn2);
      });
    }

    const rect = btn.getBoundingClientRect();
    dd.style.display = 'block';
    dd.style.left    = rect.left + 'px';
    dd.style.top     = (rect.bottom + 4) + 'px';

    requestAnimationFrame(() => {
      const r2 = dd.getBoundingClientRect();
      if (r2.right > window.innerWidth - 8)
        dd.style.left = Math.max(4, window.innerWidth - r2.width - 8) + 'px';
    });

    setTimeout(() => document.addEventListener('click', () => { dd.style.display = 'none'; }, { once: true }), 0);
  }

  /* ================================================================
     Snippets body
  ================================================================ */
  function renderSnippetsBody(b, body) {
    const list = document.createElement('div');
    list.className = 'items-list';

    (b.items || []).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'item-row';

      const drag = document.createElement('span');
      drag.className   = 'item-drag-handle';
      drag.textContent = '↕';
      drag.draggable   = true;
      drag.ondragstart = e => { e.dataTransfer.setData('snip-idx', idx); row.classList.add('item-dragging'); };
      drag.ondragend   = () => row.classList.remove('item-dragging');
      row.ondragover   = e => { e.preventDefault(); row.classList.add('item-drag-over'); };
      row.ondragleave  = e => { if (!row.contains(e.relatedTarget)) row.classList.remove('item-drag-over'); };
      row.ondrop = e => {
        e.preventDefault(); row.classList.remove('item-drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('snip-idx'), 10);
        if (isNaN(fromIdx) || fromIdx === idx) return;
        State.update(() => { const [x] = b.items.splice(fromIdx, 1); b.items.splice(idx, 0, x); });
      };

      const cb = document.createElement('input');
      cb.type      = 'checkbox';
      cb.className = 'item-check';
      cb.checked   = !!item.enabled;
      cb.onchange  = () => State.update(() => { item.enabled = cb.checked; });

      const titleInp = document.createElement('input');
      titleInp.className   = 'item-title-input';
      titleInp.value       = item.title || '';
      titleInp.placeholder = 'Заголовок';
      titleInp.oninput = () => State.updateLive(() => { item.title = titleInp.value; });
      titleInp.onblur  = () => State.snapshot();

      const valInp = document.createElement('textarea');
      valInp.className   = 'item-value';
      valInp.value       = item.value || '';
      valInp.placeholder = 'Текст...';
      valInp.rows = 2;
      valInp.oninput = () => State.updateLive(() => { item.value = valInp.value; });
      valInp.onblur  = () => State.snapshot();

      const delBtn = document.createElement('button');
      delBtn.type      = 'button';
      delBtn.className = 'btn-icon btn-icon-danger';
      delBtn.innerHTML = svgIcon('trash');
      delBtn.title     = 'Удалить';
      delBtn.onclick   = () => State.update(() => { b.items.splice(idx, 1); });

      row.appendChild(drag); row.appendChild(cb); row.appendChild(titleInp);
      row.appendChild(valInp); row.appendChild(delBtn);
      list.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type      = 'button';
    addBtn.className = 'btn-add-compact';
    addBtn.innerHTML = svgIcon('plus') + ' Добавить';
    addBtn.onclick = () => State.update(() => {
      b.items.push({ id: State.uid(), title: '', value: '', enabled: false });
    });

    body.appendChild(list); body.appendChild(addBtn);
  }

  /* ================================================================
     Commands body
  ================================================================ */
  function renderCommandsBody(b, body) {
    const list = document.createElement('div');
    list.className = 'items-list';

    (b.items || []).forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'item-row item-actions-row';

      const drag = document.createElement('span');
      drag.className   = 'item-drag-handle';
      drag.textContent = '↕';
      drag.draggable   = true;
      drag.ondragstart = e => { e.dataTransfer.setData('cmd-idx', idx); row.classList.add('item-dragging'); };
      drag.ondragend   = () => row.classList.remove('item-dragging');
      row.ondragover   = e => { e.preventDefault(); row.classList.add('item-drag-over'); };
      row.ondragleave  = e => { if (!row.contains(e.relatedTarget)) row.classList.remove('item-drag-over'); };
      row.ondrop = e => {
        e.preventDefault(); row.classList.remove('item-drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('cmd-idx'), 10);
        if (isNaN(fromIdx) || fromIdx === idx) return;
        State.update(() => { const [x] = b.items.splice(fromIdx, 1); b.items.splice(idx, 0, x); });
      };

      const labelInp = document.createElement('input');
      labelInp.className   = 'item-label-input';
      labelInp.value       = item.label || '';
      labelInp.placeholder = 'Метка';
      labelInp.oninput = () => State.updateLive(() => { item.label = labelInp.value; });
      labelInp.onblur  = () => State.snapshot();

      const valInp = document.createElement('textarea');
      valInp.className   = 'item-value';
      valInp.value       = item.value || '';
      valInp.placeholder = 'Команда...';
      valInp.rows = 1;
      valInp.oninput = () => State.updateLive(() => { item.value = valInp.value; });
      valInp.onblur  = () => State.snapshot();

      const delBtn = document.createElement('button');
      delBtn.type      = 'button';
      delBtn.className = 'btn-icon btn-icon-danger';
      delBtn.innerHTML = svgIcon('trash');
      delBtn.title     = 'Удалить';
      delBtn.onclick   = () => State.update(() => { b.items.splice(idx, 1); });

      row.appendChild(drag); row.appendChild(labelInp); row.appendChild(valInp); row.appendChild(delBtn);
      list.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type      = 'button';
    addBtn.className = 'btn-add-compact';
    addBtn.innerHTML = svgIcon('plus') + ' Добавить';
    addBtn.onclick = () => State.update(() => {
      b.items.push({ id: State.uid(), label: '', value: '' });
    });

    body.appendChild(list); body.appendChild(addBtn);
  }

  /* ================================================================
     Variable body
  ================================================================ */
  function renderVariableBody(b, body) {
    const wrap = document.createElement('div');
    wrap.className = 'variable-block-body';
    const row  = document.createElement('div');
    row.className = 'variable-row';

    const nameInp = document.createElement('input');
    nameInp.className   = 'variable-name-input';
    nameInp.value       = b.variableName || '';
    nameInp.placeholder = 'имя';
    nameInp.oninput = () => {
      b.variableName = nameInp.value.replace(/[^\w]/g, '');
      State.updateLive(() => {}); hint.innerHTML = hintText();
    };
    nameInp.onblur = () => State.snapshot();

    const eq = document.createElement('span');
    eq.className   = 'variable-eq';
    eq.textContent = '=';

    const valInp = document.createElement('textarea');
    valInp.className   = 'variable-value-input';
    valInp.value       = b.variableValue || '';
    valInp.placeholder = 'Значение...';
    valInp.rows = 2;
    valInp.oninput = () => { b.variableValue = valInp.value; State.updateLive(() => {}); };
    valInp.onblur = () => State.snapshot();

    row.appendChild(nameInp); row.appendChild(eq); row.appendChild(valInp);

    const hint = document.createElement('div');
    hint.className = 'variable-hint';
    const hintText = () => 'Используй <code>{{' + (b.variableName || 'имя') + '}}</code> в любом тексте';
    hint.innerHTML = hintText();

    wrap.appendChild(row); wrap.appendChild(hint);
    body.appendChild(wrap);
  }

  function renderStickyBody(b, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';

    const ta = document.createElement('textarea');
    ta.className = 'block-textarea';
    ta.placeholder = 'Личная заметка, не попадёт в промпт';
    ta.value = b.value || '';
    ta.style.minHeight = '60px';
    ta.style.resize = 'vertical';
    ta.style.fontSize = (b.fontSize || 13) + 'px';
    ta.oninput = () => { b.value = ta.value; State.updateLive(() => {}); autoGrow(ta); };
    ta.onblur = () => State.snapshot();
    ta.addEventListener('input', () => autoGrow(ta));

    const label = document.createElement('div');
    label.className = 'note-private';
    label.textContent = 'private';

    body.appendChild(ta);
    body.appendChild(label);

    requestAnimationFrame(() => autoGrow(ta));
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    const maxH = 400;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
  }

  function renderTodoBody(b, body) {
    body.style.display = 'flex';
    body.style.flexDirection = 'column';

    const sub = b.subtabs[b.activeSubtab];
    if (!sub) return;

    // Subtab nav is in createHeader, skip here

    // Todo list
    const list = document.createElement('div');
    list.className = 'todo-list';

    function renderItems() {
      list.innerHTML = '';
      const items = sub.items || [];
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'todo-empty';
        empty.textContent = 'Нет пунктов. Нажмите «+ Добавить пункт»';
        list.appendChild(empty);
      } else {
        items.forEach((item, idx) => {
          list.appendChild(createTodoItem(b, sub, item, idx, items));
        });
      }
    }

    renderItems();

    // Add button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'todo-add-btn';
    addBtn.textContent = '+ Добавить пункт';
    addBtn.onclick = () => {
      const newItem = { id: State.uid(), text: '', done: false };
      sub.items.push(newItem);
      State.update(() => {});
      renderItems();
      const inputs = list.querySelectorAll('.todo-text');
      inputs[inputs.length - 1]?.focus();
    };

    body.appendChild(list);
    body.appendChild(addBtn);

    // Store re-render for external use
    b._renderItems = renderItems;
  }

  function createTodoSubtabNav(b) {
    const nav = document.createElement('div');
    nav.className = 'block-subtabs-nav';
    const wrap = document.createElement('div');
    wrap.className = 'block-subtabs-wrap';
    const row = document.createElement('div');
    row.className = 'block-subtabs';
    b.subtabs.forEach((sub, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'block-subtab' + (i === b.activeSubtab ? ' active' : '');
      const done = (sub.items || []).filter(x => x.done).length;
      const total = (sub.items || []).length;
      const lbl = document.createElement('span');
      lbl.className = 'block-subtab-label';
      lbl.textContent = sub.label;
      btn.title = sub.name || (total ? `${done}/${total}` : sub.label);
      btn.onclick = (e) => {
        e.stopPropagation();
        b.activeSubtab = i;
        State.update(() => {});
        const blockEl = nav.closest('.block');
        const body = blockEl?.querySelector('.block-body');
        if (body) renderTodoBody(b, body);
      };
      btn.appendChild(lbl);
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    nav.appendChild(wrap);
    return nav;
  }

  function createTodoItem(b, sub, item, idx, items) {
    const row = document.createElement('div');
    row.className = 'todo-item';
    row.dataset.idx = idx;

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'todo-handle';
    handle.innerHTML = '⠿';
    handle.draggable = true;
    handle.ondragstart = e => {
      e.dataTransfer.setData('text/todo-idx', String(idx));
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    };
    handle.ondragend = () => row.classList.remove('dragging');

    // Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'todo-checkbox';
    cb.checked = item.done;
    cb.onchange = () => {
      item.done = cb.checked;
      text.classList.toggle('done', item.done);
      State.update(() => {});
      updateTodoBadge(b);
    };

    // Text input
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'todo-text' + (item.done ? ' done' : '');
    text.value = item.text || '';
    text.placeholder = 'Новый пункт…';
    text.oninput = () => { item.text = text.value; State.updateLive(() => {}); };
    text.onblur = () => State.snapshot();
    text.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const newItem = { id: State.uid(), text: '', done: false };
        items.splice(idx + 1, 0, newItem);
        State.update(() => {});
        b._renderItems?.();
        const blockEl = row.closest('.block');
        const inputs = blockEl?.querySelectorAll('.todo-text') || [];
        inputs[idx + 1]?.focus();
      } else if (e.key === 'Backspace' && !text.value && idx > 0) {
        e.preventDefault();
        items.splice(idx, 1);
        State.update(() => {});
        b._renderItems?.();
        const blockEl = row.closest('.block');
        const inputs = blockEl?.querySelectorAll('.todo-text') || [];
        inputs[idx - 1]?.focus();
      } else if (e.key === 'Enter' && e.shiftKey) {
        // Shift+Enter = newline (allow default for contenteditable, but input doesn't support newlines)
      } else if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= items.length) return;
        [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
        State.update(() => {});
        b._renderItems?.();
        const blockEl = row.closest('.block');
        const inputs = blockEl?.querySelectorAll('.todo-text') || [];
        inputs[newIdx]?.focus();
      }
    };

    // Delete button
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'todo-delete';
    del.textContent = '✕';
    del.onclick = () => {
      items.splice(idx, 1);
      State.update(() => {});
      b._renderItems?.();
    };

    row.appendChild(handle);
    row.appendChild(cb);
    row.appendChild(text);
    row.appendChild(del);

    // Drag over for reorder
    row.ondragover = e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    };
    row.ondrop = e => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/todo-idx'), 10);
      if (isNaN(fromIdx) || fromIdx === idx) return;
      const [moved] = items.splice(fromIdx, 1);
      items.splice(idx, 0, moved);
      State.update(() => {});
      b._renderItems?.();
    };

    return row;
  }

  function updateTodoBadge(b) {
    if (b.type !== 'todo') return;
    const badge = document.querySelector(`.block[data-id="${b.id}"] .block-order-btn`);
    if (!badge) return;
    const sub = b.subtabs[b.activeSubtab];
    const items = sub?.items || [];
    const done = items.filter(i => i.done).length;
    const total = items.length;
    badge.textContent = `${done}/${total}`;
    badge.classList.toggle('all-done', done === total && total > 0);
  }

  /* ================================================================
     Group body
  ================================================================ */
  function renderGroupBody(b, el, orderMap) {
    const wrap = document.createElement('div');
    wrap.className = 'group-body' + (b.enabled === false ? ' group-body-disabled' : '');
    (b.children || []).forEach(child => {
      const childEl = renderBlock(child, orderMap);
      childEl.classList.add('group-child');
      wrap.appendChild(childEl);
    });
    el.appendChild(wrap);
  }

  /* ================================================================
     Block DnD
  ================================================================ */
  function findParentList(blocks, id) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) return { list: blocks, idx: i };
      if (blocks[i].type === 'group' && blocks[i].children) {
        const found = findParentList(blocks[i].children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function setupBlockDnD(el, b) {
    el.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/block')) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', e => {
      if (el.contains(e.relatedTarget)) return;
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', e => {
      if (!e.dataTransfer.types.includes('text/block')) return;
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drag-over');
      const srcId = e.dataTransfer.getData('text/block');
      if (srcId === b.id) return;
      State.update(tab => {
        const src = State.findBlock(tab.blocks, srcId);
        if (!src) return;
        State.removeBlock(tab.blocks, srcId);
        const dest = findParentList(tab.blocks, b.id);
        if (!dest) { tab.blocks.push(src); return; }
        src.column = b.column;
        dest.list.splice(dest.idx, 0, src);
      });
    });
  }

  /* ================================================================
     Helpers
  ================================================================ */
  function getBlockSvgIcon(type) {
    const icons = {
      text:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5.5h6M5 8h4M5 10.5h5"/></svg>',
      snippets: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M3 7h7M3 10h8M3 13h5"/></svg>',
      commands: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 5l4 3-4 3M9 11h4"/></svg>',
      group:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
      variable: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 3c0 0 1 1 1 5s-1 5-1 5M12 3c0 0-1 1-1 5s1 5 1 5M6 8h4"/></svg>',
      sticky:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M6 5.5h4M6 8h3M6 10.5h2"/><circle cx="11" cy="3.5" r="1.2" fill="var(--note-color, #d4c373)" stroke="none"/></svg>',
      todo:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 7l1.5 1.5 3-3"/><path d="M5.5 11l1.5 1.5 3-3" opacity=".4"/></svg>',
    };
    return icons[type] || icons.text;
  }

  function svgIcon(name) {
    const m = {
      plus:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
      chevron:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
      trash:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3h4v2M12 5l-1 8H5L4 5"/></svg>',
      x:         '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
      lightning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2L4 9h5l-2 5 7-7H9l2-5z"/></svg>',
      loom:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4c3 0 7 8 10 8"/><path d="M3 12c3 0 7-8 10-8"/><path d="M4 8h8"/></svg>',
      copy:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>',
      cut:       '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="2"/><circle cx="11" cy="12" r="2"/><path d="M5 10L9.5 5M11 10L6.5 5"/></svg>',
      paste:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="5" width="9" height="10" rx="1.5"/><path d="M6 5V3.5C6 3 6.5 2 8 2s2 1 2 1.5V5"/></svg>',
      save:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 13H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6l3 3v6a1 1 0 0 1-1 1z"/><polyline points="10,13 10,9 6,9 6,13"/><polyline points="6,3 6,6 10,6"/></svg>',
      transfer:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
      undo:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6H9a3.5 3.5 0 0 1 0 7H6"/><polyline points="3.5,2.5 3.5,6 7,6"/></svg>',
      redo:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 6H7a3.5 3.5 0 0 0 0 7h3"/><polyline points="12.5,2.5 12.5,6 9,6"/></svg>',
    };
    return m[name] || '';
  }

  function makeIconBtn(html, title) {
    const s = document.createElement('span');
    s.className = 'block-toggle';
    s.innerHTML = html; s.title = title || '';
    return s;
  }

  function closeDropdownElement(dropdown) {
    if (!dropdown) return;
    dropdown.classList.remove('open');
    dropdown.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
  }

  function hashTextForLintBadge(text) {
    const source = String(text || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function getTextLintSettingsSignature() {
    try {
      const s = window.TextLinter?.getSettings?.() || {};
      return [
        s.trimLines,
        s.collapseSpaces,
        s.punctuationSpacing,
        s.normalizeNbsp,
        s.normalizeAbbreviations,
        s.compactAbbreviations,
        s.collapseBlankLines,
        s.capitalAfterPunctuation,
        s.finalPeriod,
        s.redLine,
        s.paragraphBreaks,
      ].map(Boolean).join('');
    } catch (_) {
      return 'no-settings';
    }
  }

  function rememberTextLintBadge(cacheKey, value) {
    textLintBadgeCache.set(cacheKey, value);
    if (textLintBadgeCache.size <= TEXT_LINT_BADGE_CACHE_LIMIT) return value;

    const firstKey = textLintBadgeCache.keys().next().value;
    if (firstKey) textLintBadgeCache.delete(firstKey);
    return value;
  }

  function getTextLintBadgeInfo(block) {
    if (!block || block.type !== 'text' || !window.TextLinter?.lint) return null;

    const activeIndex = Number.isInteger(block.activeSubtab) ? block.activeSubtab : 0;
    const text = block.subtabs?.[activeIndex]?.value || '';
    if (!String(text).trim()) return null;

    const cacheKey = [
      block.id,
      activeIndex,
      String(text).length,
      hashTextForLintBadge(text),
      getTextLintSettingsSignature(),
    ].join('|');

    if (textLintBadgeCache.has(cacheKey)) return textLintBadgeCache.get(cacheKey);

    try {
      const result = window.TextLinter.lint(text, { showHints: false });
      if (!result?.changed) return rememberTextLintBadge(cacheKey, null);

      const count = Math.max(1, Math.min(99, Number(result.changeCount) || 1));
      return rememberTextLintBadge(cacheKey, {
        label: count >= 99 ? '99+' : String(count),
        className: 'text-groom-trigger-has-fixes',
        title: `найдено безопасных правок: ${count >= 99 ? '99+' : count}`,
      });
    } catch (_) {
      return rememberTextLintBadge(cacheKey, null);
    }
  }

  function makeToolBtn(html, title, onclick) {
    const b = document.createElement('button');
    b.type      = 'button'; // [FIX] явный тип — не триггерит submit в форме
    b.className = 'block-tool-btn';
    b.innerHTML = html; b.title = title; b.onclick = onclick;
    return b;
  }

  function makeDivider() {
    const d = document.createElement('span');
    d.className = 'block-tool-divider';
    return d;
  }

  function mkBtn(cls, text, title) {
    const b = document.createElement('button');
    b.type        = 'button'; // [FIX] явный тип
    b.className   = cls;
    b.textContent = text;
    b.title       = title;
    return b;
  }

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function clearTextLintBadgeCache() {
    textLintBadgeCache.clear();
  }

  return { render, applyLayout, setupColumns, clearTextLintBadgeCache, refreshAllAnchorCounts };
})();

window.Blocks = Blocks;
