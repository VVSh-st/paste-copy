// file_name: text-expander.js
'use strict';

/**
 * TextExpander — текстовый эспандер для Paste/Copy.
 *
 * Функциональность:
 *  - Short click на кнопке → автосоздание сокращения из выделенного текста
 *  - Long click на кнопке → открытие панели управления
 *  - Trigger-клавиша (Backquote/ё) → dropdown с фильтрацией
 *  - Вставка сокращения с обработкой регистра и undo
 *  - Категории, динамические токены, синхронизация через Gist
 */
const TextExpander = (() => {

  // ========================
  // CONFIG
  // ========================

  const STORE_KEY = 'text-expander-v1';
  const TRIGGER_CODE = 'Backquote';
  const AUTO_LENGTH_DEFAULT = 4;
  const LONG_PRESS_MS = 450;
  const DRAG_THRESHOLD = 10;
  const PANEL_DEFAULT_W = 400;
  const PANEL_DEFAULT_H = 600;
  const PANEL_MIN_W = 350;
  const PANEL_MIN_H = 500;
  const MAX_SHORTCUT_LEN = 20;
  const MAX_DROPDOWN_ITEMS = 100;
  const VISIBLE_DROPDOWN_ITEMS = 8;

  const STOP_WORDS = new Set([
    'и','в','на','не','с','по','для','от','до','из','к','о','а','но',
    'что','как','это','все','так','уже','при','об','за','или','ни',
    'да','нет','его','её','их','мы','вы','он','она','оно','они','я','ты'
  ]);

  const DEFAULT_CATEGORIES = ['General', 'AI Prompts', 'Scripts', 'Outreach'];

  // ========================
  // STATE
  // ========================

  let _inited = false;
  let _shortcuts = new Map();
  let _settings = {
    triggerCode: TRIGGER_CODE,
    autoLength: AUTO_LENGTH_DEFAULT,
    email: '',
    categories: [...DEFAULT_CATEGORIES],
    panelPosition: null,
    panelSize: null
  };
  let _dropdownEl = null;
  let _panelEl = null;
  let _activeTa = null;
  let _activeBlockId = null;
  let _dropdownQuery = '';
  let _dropdownStart = 0;
  let _dropdownFocusedIdx = 0;
  let _dropdownItems = [];
  let _panelDragging = false;
  let _panelResizing = false;

  // Stored listener refs for cleanup
  let _triggerHandler = null;
  let _dropdownKeyHandler = null;
  let _outsideClickHandler = null;
  let _escapePanelHandler = null;

  // ========================
  // STORAGE
  // ========================

  function _normalizeShortcut(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.trigger !== 'string' || !raw.trigger) return null;
    return {
      id: raw.id,
      trigger: raw.trigger.slice(0, MAX_SHORTCUT_LEN),
      category: typeof raw.category === 'string' && raw.category ? raw.category : 'General',
      text: typeof raw.text === 'string' ? raw.text : '',
      enabled: raw.enabled !== false,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now()
    };
  }

  function _normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    if (typeof raw.triggerCode === 'string') out.triggerCode = raw.triggerCode;
    if (Number.isFinite(Number(raw.autoLength))) out.autoLength = Math.max(2, Math.min(20, Number(raw.autoLength)));
    if (typeof raw.email === 'string') out.email = raw.email;
    if (Array.isArray(raw.categories) && raw.categories.length) {
      out.categories = [...new Set(raw.categories.filter(c => typeof c === 'string' && c.trim()))];
    }
    if (raw.panelPosition && typeof raw.panelPosition === 'object' && !Array.isArray(raw.panelPosition)) {
      out.panelPosition = raw.panelPosition;
    }
    if (raw.panelSize && typeof raw.panelSize === 'object' && !Array.isArray(raw.panelSize)) {
      out.panelSize = raw.panelSize;
    }
    return out;
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.shortcuts)) {
        _shortcuts.clear();
        for (const s of data.shortcuts) {
          const normalized = _normalizeShortcut(s);
          if (normalized) _shortcuts.set(normalized.id, normalized);
        }
      }
      if (data.settings && typeof data.settings === 'object') {
        Object.assign(_settings, _normalizeSettings(data.settings));
      }
    } catch (_) {}
  }

  function _save() {
    try {
      const payload = JSON.stringify({
        shortcuts: [..._shortcuts.values()],
        settings: _settings
      });
      localStorage.setItem(STORE_KEY, payload);
    } catch (err) {
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: ошибка сохранения', 'error');
    }
  }

  function _generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'te-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  // ========================
  // AUTO SHORTENER
  // ========================

  function exists(candidate) {
    for (const s of _shortcuts.values()) {
      if (s.trigger === candidate) return true;
    }
    return false;
  }

  function _nextCandidate(base) {
    // Truncate base if too long
    let b = base.slice(0, MAX_SHORTCUT_LEN);
    if (!exists(b)) return b;
    for (let i = 2; i < 100; i++) {
      const suffix = String(i);
      const c = b.slice(0, MAX_SHORTCUT_LEN - suffix.length) + suffix;
      if (!exists(c)) return c;
    }
    return b.slice(0, MAX_SHORTCUT_LEN - 3) + Date.now().toString(36).slice(-3);
  }

  function _normalizeWord(w) {
    return (w || '').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  }

  function generateSmartShortName(text) {
    const words = (text || '').split(/\s+/).filter(w => w.length > 0);
    if (!words.length) return _nextCandidate('txt');

    const maxLen = _settings.autoLength;

    // L1: первое значимое слово (без предлогов/союзов)
    for (const w of words) {
      const lower = _normalizeWord(w);
      if (lower.length > 0 && !STOP_WORDS.has(lower)) {
        return _nextCandidate(lower.slice(0, maxLen));
      }
    }

    // L2: акроним из первых букв значимых слов
    const sigWords = words.filter(w => !STOP_WORDS.has(_normalizeWord(w)));
    if (sigWords.length >= 2) {
      const acr = sigWords.map(w => {
        const n = _normalizeWord(w);
        return n ? n[0] : '';
      }).filter(Boolean).join('').slice(0, maxLen);
      if (acr.length >= 2) return _nextCandidate(acr);
    }

    // L3: первые N букв из склеенных слов
    const joined = words.map(w => _normalizeWord(w)).filter(Boolean).join('');
    const candidate = joined.slice(0, maxLen) || 'txt';
    return _nextCandidate(candidate);
  }

  // ========================
  // TOKEN ENGINE
  // ========================

  // Sync: replaces all tokens EXCEPT {{clipboard}} (needs async read)
  function expandDynamicTokens(text) {
    if (!text) return text;
    const now = new Date();
    return text
      .replace(/\{\{date\}\}/g, () => now.toLocaleDateString('ru-RU'))
      .replace(/\{\{time\}\}/g, () => now.toLocaleTimeString('ru-RU'))
      .replace(/\{\{url\}\}/g, () => window.location.href)
      .replace(/\{\{email\}\}/g, () => _settings.email || '');
    // NOTE: {{clipboard}} is intentionally NOT replaced here — see expandDynamicTokensAsync
  }

  async function expandDynamicTokensAsync(text) {
    if (!text) return text;
    let result = expandDynamicTokens(text);
    // Only attempt clipboard read if token is still present
    if (result.includes('{{clipboard}}')) {
      try {
        const clip = (typeof navigator !== 'undefined' && navigator.clipboard?.readText)
          ? await navigator.clipboard.readText()
          : '';
        result = result.replace(/\{\{clipboard\}\}/g, clip || '');
      } catch (_) {
        result = result.replace(/\{\{clipboard\}\}/g, '');
      }
    }
    return result;
  }

  // ========================
  // UI PANEL
  // ========================

  function openPanel() {
    if (_panelEl) {
      _panelEl.style.display = 'flex';
      // Refresh table in case shortcuts changed externally
      const body = _panelEl.querySelector('.te-body');
      if (body) _refreshPanelTable(body);
      return;
    }
    _buildPanel();
  }

  function closePanel() {
    if (_panelEl) { _panelEl.remove(); _panelEl = null; }
  }

  function _buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'text-expander-panel';
    panel.style.minWidth = PANEL_MIN_W + 'px';
    panel.style.minHeight = PANEL_MIN_H + 'px';

    // Восстановление позиции и размера (нормализация)
    const _cssSize = (val, fallback) => {
      if (typeof val === 'number') return val + 'px';
      if (typeof val === 'string' && val) return val;
      return fallback + 'px';
    };
    if (_settings.panelSize) {
      panel.style.width = _cssSize(_settings.panelSize.w, PANEL_DEFAULT_W);
      panel.style.height = _cssSize(_settings.panelSize.h, PANEL_DEFAULT_H);
    } else {
      panel.style.width = PANEL_DEFAULT_W + 'px';
      panel.style.height = PANEL_DEFAULT_H + 'px';
    }
    if (_settings.panelPosition) {
      panel.style.left = _settings.panelPosition.left || '100px';
      panel.style.top = _settings.panelPosition.top || '100px';
    } else {
      panel.style.left = Math.max(20, (window.innerWidth - PANEL_DEFAULT_W) / 2) + 'px';
      panel.style.top = Math.max(20, (window.innerHeight - PANEL_DEFAULT_H) / 2) + 'px';
    }

    // Clamp panel position to viewport
    requestAnimationFrame(() => {
      if (!_panelEl) return;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      if (rect.left > maxLeft) panel.style.left = maxLeft + 'px';
      if (rect.top > maxTop) panel.style.top = maxTop + 'px';
    });

    // Header (drag handle)
    const header = document.createElement('div');
    header.className = 'te-header';
    const title = document.createElement('span');
    title.className = 'te-title';
    title.textContent = 'Text Expander';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'te-close-btn';
    closeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    closeBtn.onclick = () => closePanel();
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'te-body';

    // --- Shortcut input ---
    const shortcutRow = document.createElement('div');
    shortcutRow.className = 'te-row';
    const shortcutLabel = document.createElement('span');
    shortcutLabel.className = 'te-label';
    shortcutLabel.textContent = 'Shortcut';
    const shortcutInput = document.createElement('input');
    shortcutInput.type = 'text';
    shortcutInput.className = 'te-input';
    shortcutInput.placeholder = '/shortcut';
    shortcutInput.maxLength = MAX_SHORTCUT_LEN;
    shortcutRow.appendChild(shortcutLabel);
    shortcutRow.appendChild(shortcutInput);

    // --- Category select ---
    const catRow = document.createElement('div');
    catRow.className = 'te-row';
    const catLabel = document.createElement('span');
    catLabel.className = 'te-label';
    catLabel.textContent = 'Category';
    const catSelect = document.createElement('select');
    catSelect.className = 'te-select';
    _settings.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
    catRow.appendChild(catLabel);
    catRow.appendChild(catSelect);

    // --- Add button ---
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'te-add-btn';
    addBtn.textContent = 'Add Key';
    addBtn.onclick = () => {
      const trigger = shortcutInput.value.trim().replace(/^\/+/, '');
      const text = textarea.value.trim();
      const category = catSelect.value;
      if (!trigger || !text) {
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: введите shortcut и текст', 'error');
        return;
      }
      // Проверка коллизий
      for (const s of _shortcuts.values()) {
        if (s.trigger === trigger && s.category === category) {
          if (typeof Toast !== 'undefined') Toast.show('TextExpander: такой shortcut уже есть в категории', 'error');
          return;
        }
      }
      const id = _generateId();
      _shortcuts.set(id, {
        id,
        trigger,
        category,
        text,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      _save();
      shortcutInput.value = '';
      textarea.value = '';
      _refreshPanelTable(body);
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: добавлено "' + trigger + '"', 'success');
    };

    const inputRow = document.createElement('div');
    inputRow.className = 'te-input-row';
    inputRow.appendChild(shortcutRow);
    inputRow.appendChild(catRow);
    inputRow.appendChild(addBtn);

    // --- Textarea ---
    const textarea = document.createElement('textarea');
    textarea.className = 'te-textarea';
    textarea.placeholder = 'Текст сокращения... Поддерживает {{date}}, {{time}}, {{clipboard}}, {{url}}, {{email}}';
    textarea.rows = 5;

    // --- Token buttons ---
    const tokenBar = document.createElement('div');
    tokenBar.className = 'te-token-bar';
    const tokens = [
      { label: 'date', token: '{{date}}' },
      { label: 'time', token: '{{time}}' },
      { label: 'clipboard', token: '{{clipboard}}' },
      { label: 'url', token: '{{url}}' },
      { label: 'email', token: '{{email}}' }
    ];
    tokens.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-token-btn';
      btn.textContent = t.label;
      btn.title = 'Вставить ' + t.token;
      btn.onclick = () => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, start) + t.token + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + t.token.length;
        textarea.focus();
      };
      tokenBar.appendChild(btn);
    });

    // --- Auto length ---
    const autoRow = document.createElement('div');
    autoRow.className = 'te-row te-auto-row';
    const autoLabel = document.createElement('span');
    autoLabel.className = 'te-label';
    autoLabel.textContent = 'Auto Length';
    const autoSlider = document.createElement('input');
    autoSlider.type = 'range';
    autoSlider.min = '2';
    autoSlider.max = '20';
    autoSlider.value = String(_settings.autoLength);
    autoSlider.className = 'te-slider';
    const autoValue = document.createElement('span');
    autoValue.className = 'te-auto-value';
    autoValue.textContent = String(_settings.autoLength);
    autoSlider.oninput = () => {
      _settings.autoLength = parseInt(autoSlider.value, 10);
      autoValue.textContent = autoSlider.value;
      _save();
    };
    autoRow.appendChild(autoLabel);
    autoRow.appendChild(autoSlider);
    autoRow.appendChild(autoValue);

    // --- Category filter ---
    const filterRow = document.createElement('div');
    filterRow.className = 'te-filter-row';
    const filterAll = document.createElement('button');
    filterAll.type = 'button';
    filterAll.className = 'te-filter-btn active';
    filterAll.textContent = 'All';
    filterRow.appendChild(filterAll);
    _settings.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-filter-btn';
      btn.textContent = cat;
      filterRow.appendChild(btn);
    });

    // Filter logic
    filterRow.addEventListener('click', e => {
      const btn = e.target.closest('.te-filter-btn');
      if (!btn) return;
      filterRow.querySelectorAll('.te-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _refreshPanelTable(body);
    });

    // --- Table ---
    const tableContainer = document.createElement('div');
    tableContainer.className = 'te-table-container';

    body.appendChild(inputRow);
    body.appendChild(textarea);
    body.appendChild(tokenBar);
    body.appendChild(autoRow);
    body.appendChild(filterRow);
    body.appendChild(tableContainer);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
    _panelEl = panel;

    // Drag
    _setupDrag(panel, header);
    // Resize
    _setupResize(panel);

    _refreshPanelTable(body);
  }

  function _refreshPanelTable(body) {
    const container = body?.querySelector('.te-table-container');
    if (!container) return;
    container.innerHTML = '';

    const activeFilter = body.querySelector('.te-filter-btn.active')?.textContent || 'All';
    const items = [..._shortcuts.values()]
      .filter(s => activeFilter === 'All' || s.category === activeFilter)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'te-empty';
      empty.textContent = 'Нет сокращений';
      container.appendChild(empty);
      return;
    }

    // Table header
    const thead = document.createElement('div');
    thead.className = 'te-table-head';
    ['Enabled', 'Shortcut', 'Category', 'Preview', ''].forEach(label => {
      const span = document.createElement('span');
      span.textContent = label;
      thead.appendChild(span);
    });
    container.appendChild(thead);

    items.forEach(s => {
      const row = document.createElement('div');
      row.className = 'te-table-row';

      // Enabled toggle
      const toggle = document.createElement('label');
      toggle.className = 'te-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = s.enabled;
      checkbox.onchange = () => {
        s.enabled = checkbox.checked;
        s.updatedAt = Date.now();
        _save();
      };
      const slider = document.createElement('span');
      slider.className = 'te-toggle-slider';
      toggle.appendChild(checkbox);
      toggle.appendChild(slider);

      // Shortcut
      const shortcut = document.createElement('span');
      shortcut.className = 'te-table-shortcut';
      shortcut.textContent = s.trigger;

      // Category
      const cat = document.createElement('span');
      cat.className = 'te-table-category';
      cat.textContent = s.category;

      // Preview
      const preview = document.createElement('span');
      preview.className = 'te-table-preview';
      const previewText = (s.text || '').length > 25 ? s.text.slice(0, 25) + '...' : (s.text || '');
      preview.textContent = previewText;
      preview.title = s.text || '';

      // Delete
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'te-delete-btn';
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      del.onclick = () => {
        _shortcuts.delete(s.id);
        _save();
        _refreshPanelTable(body);
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: удалено "' + s.trigger + '"', 'success');
      };

      row.appendChild(toggle);
      row.appendChild(shortcut);
      row.appendChild(cat);
      row.appendChild(preview);
      row.appendChild(del);
      container.appendChild(row);
    });
  }

  // ========================
  // TRIGGER ENGINE
  // ========================

  function _handleTrigger(e) {
    if (e.code !== _settings.triggerCode) return;
    // Не триггерить если панель открыта или модальное окно активно
    if (_panelEl && _panelEl.contains(document.activeElement)) return;
    if (document.querySelector('.gs-modal')?.style.display === 'flex') return;

    // Ищем активный textarea
    const ta = document.activeElement;
    if (!ta || ta.tagName !== 'TEXTAREA') return;

    const pos = ta.selectionStart;
    if (pos === undefined || pos === null) return;

    // Проверяем что перед курсором нет текста (начало строки, пробел, или открытие скобки/кавычки)
    const before = ta.value.slice(0, pos);
    const lastChar = before.slice(-1);
    const triggerChars = new Set([' ', '\n', '\t', '(', '[', '{', '"', "'", '\u2014', ':']);
    if (lastChar && !triggerChars.has(lastChar)) return;

    e.preventDefault();
    e.stopPropagation();

    _activeTa = ta;
    _activeBlockId = ta.closest('.block')?.dataset?.id || null;
    _dropdownQuery = '';
    _dropdownStart = pos;
    _dropdownFocusedIdx = 0;

    _showDropdown(ta, pos);
  }

  // ========================
  // DROPDOWN MENU
  // ========================

  function _showDropdown(ta, pos) {
    _hideDropdown();

    const dd = document.createElement('div');
    dd.className = 'text-expander-dropdown';
    dd.setAttribute('role', 'listbox');
    document.body.appendChild(dd);
    _dropdownEl = dd;

    _renderDropdownItems();

    // Позиционирование по caret
    _positionDropdownAtCaret(ta, dd);

    // Обновляем при вводе
    const onInput = () => {
      const curPos = ta.selectionStart;
      const textAfter = ta.value.slice(_dropdownStart, curPos);

      // Close on whitespace after trigger
      if (/\s/.test(ta.value.slice(pos, curPos)) && _dropdownQuery.length > 0) {
        _hideDropdown();
        return;
      }

      // Close if cursor moved before dropdown start
      if (curPos < _dropdownStart) {
        _hideDropdown();
        return;
      }

      _dropdownQuery = textAfter;
      _dropdownFocusedIdx = 0;
      _renderDropdownItems();
      _positionDropdownAtCaret(ta, dd);
    };

    // Close on blur (with small delay to allow click on dropdown)
    const onBlur = () => {
      setTimeout(() => {
        if (_dropdownEl && !_dropdownEl.contains(document.activeElement)) {
          _hideDropdown();
        }
      }, 150);
    };

    ta.addEventListener('input', onInput);
    ta.addEventListener('blur', onBlur);
    dd._cleanupInput = () => {
      ta.removeEventListener('input', onInput);
      ta.removeEventListener('blur', onBlur);
    };
  }

  function _hideDropdown() {
    if (_dropdownEl) {
      _dropdownEl._cleanupInput?.();
      _dropdownEl.remove();
      _dropdownEl = null;
    }
    _dropdownItems = [];
    _activeTa = null;
    _activeBlockId = null;
  }

  function _filterDropdownItems(query) {
    const q = (query || '').toLowerCase();
    const items = [..._shortcuts.values()].filter(s => s.enabled);
    if (!q) return items.slice(0, MAX_DROPDOWN_ITEMS);

    // exact match first, then startsWith, then includes
    const exact = items.filter(s => s.trigger.toLowerCase() === q);
    const starts = items.filter(s => s.trigger.toLowerCase().startsWith(q) && s.trigger.toLowerCase() !== q);
    const includes = items.filter(s => !s.trigger.toLowerCase().startsWith(q) && s.trigger.toLowerCase().includes(q));
    return [...exact, ...starts, ...includes].slice(0, MAX_DROPDOWN_ITEMS);
  }

  function _renderDropdownItems() {
    if (!_dropdownEl) return;
    const dd = _dropdownEl;
    dd.innerHTML = '';

    _dropdownItems = _filterDropdownItems(_dropdownQuery);

    // Clamp focused index
    if (_dropdownItems.length === 0) {
      _dropdownFocusedIdx = 0;
    } else {
      _dropdownFocusedIdx = Math.min(_dropdownFocusedIdx, _dropdownItems.length - 1);
    }

    if (!_dropdownItems.length) {
      const empty = document.createElement('div');
      empty.className = 'te-dd-empty';
      empty.textContent = 'Нет совпадений';
      dd.appendChild(empty);
      return;
    }

    const visibleCount = Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS);

    _dropdownItems.forEach((item, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'te-dd-item' + (idx === _dropdownFocusedIdx ? ' focused' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', idx === _dropdownFocusedIdx ? 'true' : 'false');

      const shortcut = document.createElement('span');
      shortcut.className = 'te-dd-shortcut';
      shortcut.textContent = item.trigger;

      const catBadge = document.createElement('span');
      catBadge.className = 'te-dd-category';
      catBadge.textContent = item.category;

      const preview = document.createElement('span');
      preview.className = 'te-dd-preview';
      const previewText = (item.text || '').length > 40 ? item.text.slice(0, 40) + '...' : (item.text || '');
      preview.textContent = previewText;

      row.appendChild(shortcut);
      row.appendChild(catBadge);
      row.appendChild(preview);

      row.onmousedown = e => {
        e.preventDefault();
        _insertExpansion(item);
      };

      dd.appendChild(row);
    });

    if (_dropdownItems.length > visibleCount) {
      dd.style.maxHeight = (visibleCount * 36 + 10) + 'px';
    } else {
      dd.style.maxHeight = '';
    }
  }

  function _positionDropdownAtCaret(ta, dd) {
    const cs = window.getComputedStyle(ta);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;

    const m = document.createElement('div');
    const syncProps = [
      'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
      'paddingTop','paddingRight','paddingBottom','paddingLeft',
      'fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
      'lineHeight','textTransform','textIndent','wordBreak','overflowWrap','tabSize'
    ];
    syncProps.forEach(p => { m.style[p] = cs[p]; });
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
      if (!_dropdownEl) return;
      const pw = _dropdownEl.offsetWidth || 248;
      const ph = _dropdownEl.offsetHeight || 180;
      if (cx + pw > window.innerWidth - 8) cx = Math.max(4, window.innerWidth - pw - 8);
      if (cy + ph > window.innerHeight - 8) cy = Math.max(4, cy - lh - ph - 8);
      dd.style.left = cx + 'px';
      dd.style.top = cy + 'px';
    });
    dd.style.left = cx + 'px';
    dd.style.top = cy + 'px';
  }

  // ========================
  // INSERTION ENGINE
  // ========================

  async function _insertExpansion(item) {
    const ta = _activeTa;
    if (!ta) return;

    const startPos = _dropdownStart;
    const endPos = ta.selectionStart;

    // Snapshot BEFORE change for proper undo
    if (_activeBlockId && typeof State !== 'undefined') {
      State.blockSnapshot(_activeBlockId);
    }

    // Готовим текст
    let expansion = await expandDynamicTokensAsync(item.text);

    // Обработка регистра
    if (_dropdownQuery) {
      const q0 = _dropdownQuery[0];
      if (q0 === q0.toUpperCase() && q0 !== q0.toLowerCase()) {
        // Capitalized or UPPER — capitalize first alphabetic char
        const idx = expansion.search(/[a-zа-яё]/i);
        if (idx >= 0) {
          expansion = expansion.slice(0, idx) + expansion[idx].toUpperCase() + expansion.slice(idx + 1);
        }
      }
    }

    // Вставка через setRangeText
    ta.setRangeText(expansion + ' ', startPos, endPos, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Snapshot AFTER change
    if (_activeBlockId && typeof State !== 'undefined') {
      State.snapshot();
    }

    _hideDropdown();
    ta.focus();
  }

  // ========================
  // LONG PRESS FSM
  // ========================

  function _setupLongPress(btn, ta, blockId) {
    // Prevent duplicate listeners
    if (btn.dataset.teLongPressAttached === '1') return;
    btn.dataset.teLongPressAttached = '1';

    let timer = null;
    let longFired = false;
    let startX = 0, startY = 0;

    btn.addEventListener('pointerdown', e => {
      longFired = false;
      startX = e.clientX;
      startY = e.clientY;

      timer = setTimeout(() => {
        longFired = true;
        openPanel();
      }, LONG_PRESS_MS);
    });

    btn.addEventListener('pointermove', e => {
      if (!timer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        clearTimeout(timer);
        timer = null;
      }
    });

    btn.addEventListener('pointerup', () => {
      clearTimeout(timer);
      timer = null;
    });

    btn.addEventListener('pointercancel', () => {
      clearTimeout(timer);
      timer = null;
    });

    btn.addEventListener('click', e => {
      if (longFired) {
        e.preventDefault();
        e.stopPropagation();
        longFired = false;
        return;
      }
      // Short click — create from selection
      if (ta && ta.selectionStart !== ta.selectionEnd) {
        const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        if (selected.length > 0) {
          createFromSelection(selected, ta, blockId);
        }
      }
    });
  }

  // ========================
  // PUBLIC: createFromSelection
  // ========================

  function createFromSelection(selectedText, ta, blockId) {
    const trigger = generateSmartShortName(selectedText);
    const category = _settings.categories[0] || 'General';

    const id = _generateId();
    _shortcuts.set(id, {
      id,
      trigger,
      category,
      text: selectedText,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    _save();

    if (typeof Toast !== 'undefined') {
      Toast.show('TextExpander: создано "' + trigger + '"', 'success');
    }
  }

  // ========================
  // PUBLIC: handleInput
  // ========================

  function handleInput(ta, blockId) {
    if (!_dropdownEl || _activeTa !== ta) return;

    const pos = ta.selectionStart;
    if (pos === undefined) return;

    const textAfter = ta.value.slice(_dropdownStart, pos);

    // Если trigger символ удалён — закрыть
    if (textAfter.length === 0 && _dropdownStart >= pos) {
      _hideDropdown();
      return;
    }

    _dropdownQuery = textAfter;
    _dropdownFocusedIdx = 0;
    _renderDropdownItems();
  }

  // ========================
  // PANEL DRAG
  // ========================

  function _setupDrag(panel, handle) {
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();

      const rect = panel.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const startL = rect.left, startT = rect.top;
      panel.style.transform = 'none';
      panel.style.left = startL + 'px';
      panel.style.top = startT + 'px';
      document.body.style.userSelect = 'none';
      _panelDragging = true;

      const onMove = mv => {
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = Math.max(0, Math.min(maxLeft, startL + (mv.clientX - startX))) + 'px';
        panel.style.top = Math.max(0, Math.min(maxTop, startT + (mv.clientY - startY))) + 'px';
      };

      const onUp = () => {
        document.body.style.userSelect = '';
        _panelDragging = false;
        _settings.panelPosition = { left: panel.style.left, top: panel.style.top };
        _save();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });
  }

  // ========================
  // PANEL RESIZE
  // ========================

  function _setupResize(panel) {
    const handle = document.createElement('div');
    handle.className = 'te-resize-handle';
    handle.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M10 2L2 10M10 6L6 10"/></svg>';

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const startW = panel.offsetWidth, startH = panel.offsetHeight;
      document.body.style.userSelect = 'none';
      _panelResizing = true;

      const onMove = mv => {
        const rect = panel.getBoundingClientRect();
        const maxW = Math.max(PANEL_MIN_W, window.innerWidth - rect.left);
        const maxH = Math.max(PANEL_MIN_H, window.innerHeight - rect.top);
        panel.style.width = Math.max(PANEL_MIN_W, Math.min(maxW, startW + (mv.clientX - startX))) + 'px';
        panel.style.height = Math.max(PANEL_MIN_H, Math.min(maxH, startH + (mv.clientY - startY))) + 'px';
      };

      const onUp = () => {
        document.body.style.userSelect = '';
        _panelResizing = false;
        _settings.panelSize = { w: panel.style.width, h: panel.style.height };
        _save();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });

    panel.appendChild(handle);
  }

  // ========================
  // KEYBOARD NAVIGATION (dropdown)
  // ========================

  function _handleDropdownKeydown(e) {
    if (!_dropdownEl) return;
    if (!_dropdownItems.length) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _hideDropdown();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      _dropdownFocusedIdx = Math.min(_dropdownFocusedIdx + 1, _dropdownItems.length - 1);
      _updateDropdownFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      _dropdownFocusedIdx = Math.max(_dropdownFocusedIdx - 1, 0);
      _updateDropdownFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const item = _dropdownItems[_dropdownFocusedIdx];
      if (item) _insertExpansion(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _hideDropdown();
    }
  }

  function _updateDropdownFocus() {
    if (!_dropdownEl) return;
    const items = _dropdownEl.querySelectorAll('.te-dd-item');
    items.forEach((el, i) => {
      el.classList.toggle('focused', i === _dropdownFocusedIdx);
      el.setAttribute('aria-selected', i === _dropdownFocusedIdx ? 'true' : 'false');
    });
    items[_dropdownFocusedIdx]?.scrollIntoView({ block: 'nearest' });
  }

  // ========================
  // PUBLIC API: serialize / load
  // ========================

  function serialize() {
    return {
      shortcuts: [..._shortcuts.values()],
      settings: JSON.parse(JSON.stringify(_settings))
    };
  }

  function load(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.shortcuts)) {
      for (const s of data.shortcuts) {
        const normalized = _normalizeShortcut(s);
        if (!normalized) continue;
        const existing = _shortcuts.get(normalized.id);
        if (existing) {
          if ((normalized.updatedAt || 0) > (existing.updatedAt || 0)) {
            Object.assign(existing, normalized);
          }
        } else {
          _shortcuts.set(normalized.id, normalized);
        }
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      Object.assign(_settings, _normalizeSettings(data.settings));
    }
    _save();
  }

  // ========================
  // INIT
  // ========================

  function init() {
    if (_inited) return;
    _inited = true;

    _load();

    // Глобальный keydown для trigger
    _triggerHandler = _handleTrigger;
    document.addEventListener('keydown', _triggerHandler, true);

    // Глобальный keydown для dropdown навигации
    _dropdownKeyHandler = _handleDropdownKeydown;
    document.addEventListener('keydown', _dropdownKeyHandler, true);

    // Закрытие dropdown по клику вне
    _outsideClickHandler = e => {
      if (_dropdownEl && !_dropdownEl.contains(e.target)) {
        _hideDropdown();
      }
    };
    document.addEventListener('mousedown', _outsideClickHandler);

    // Закрытие panel по Escape
    _escapePanelHandler = e => {
      if (e.key === 'Escape' && _panelEl) {
        closePanel();
      }
    };
    document.addEventListener('keydown', _escapePanelHandler);
  }

  function destroy() {
    if (!_inited) return;
    _inited = false;
    if (_triggerHandler) document.removeEventListener('keydown', _triggerHandler, true);
    if (_dropdownKeyHandler) document.removeEventListener('keydown', _dropdownKeyHandler, true);
    if (_outsideClickHandler) document.removeEventListener('mousedown', _outsideClickHandler);
    if (_escapePanelHandler) document.removeEventListener('keydown', _escapePanelHandler);
    _triggerHandler = null;
    _dropdownKeyHandler = null;
    _outsideClickHandler = null;
    _escapePanelHandler = null;
    _hideDropdown();
    closePanel();
  }

  return {
    init,
    destroy,
    openPanel,
    closePanel,
    createFromSelection,
    handleInput,
    generateSmartShortName,
    expandDynamicTokens,
    serialize,
    load,
    exists,
    _setupLongPress
  };
})();

window.TextExpander = TextExpander;
