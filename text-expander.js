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
  const MAX_SELECTION_LEN = 50000;

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
  let _dropdownSession = 0;
  let _panelDragging = false;
  let _panelResizing = false;
  let _panelInteractionCleanup = null;
  let _caretMirrorEl = null;
  let _caretMirrorSource = null;
  let _caretMirrorSignature = '';
  let _caretMirrorBefore = null;
  let _caretMirrorMarker = null;
  let _editingId = null; // ID shortcut в режиме редактирования
  let _formShortcutInput = null;
  let _formTextarea = null;
  let _formCatSelect = null;
  let _formAddBtn = null;
  let _formBody = null;

  // Stored listener refs for cleanup
  let _dropdownKeyHandler = null;
  let _outsideClickHandler = null;
  let _escapePanelHandler = null;
  let _windowBlurHandler = null;
  let _visibilityChangeHandler = null;

  // ========================
  // STORAGE
  // ========================

  function _normalizeTrigger(value) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/[\u0000-\u001F\u007F\s]+/g, '')
      .slice(0, MAX_SHORTCUT_LEN);
  }

  function _normalizeShortcut(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.trigger !== 'string') return null;
    const trigger = _normalizeTrigger(raw.trigger);
    if (!trigger) return null;
    return {
      id: raw.id,
      trigger,
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
      const categories = [...new Set(
        raw.categories
          .filter(c => typeof c === 'string' && c.trim())
          .map(c => c.trim().slice(0, 80))
      )];
      if (categories.length) out.categories = categories;
    }
    if (raw.panelPosition && typeof raw.panelPosition === 'object' && !Array.isArray(raw.panelPosition)) {
      const left = parseFloat(raw.panelPosition.left);
      const top = parseFloat(raw.panelPosition.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        out.panelPosition = { left: Math.max(0, left) + 'px', top: Math.max(0, top) + 'px' };
      }
    }
    if (raw.panelSize && typeof raw.panelSize === 'object' && !Array.isArray(raw.panelSize)) {
      const w = parseFloat(raw.panelSize.w);
      const h = parseFloat(raw.panelSize.h);
      if (Number.isFinite(w) && Number.isFinite(h)) {
        out.panelSize = { w: Math.max(PANEL_MIN_W, w) + 'px', h: Math.max(PANEL_MIN_H, h) + 'px' };
      }
    }
    return out;
  }

  function _ensureKnownCategories() {
    const seen = new Set(
      (_settings.categories || [])
        .filter(c => typeof c === 'string' && c.trim())
        .map(c => c.trim())
    );

    for (const s of _shortcuts.values()) {
      const cat = typeof s.category === 'string' && s.category.trim()
        ? s.category.trim().slice(0, 80)
        : 'General';
      s.category = cat;
      seen.add(cat);
    }

    if (!seen.size) seen.add('General');
    _settings.categories = [...seen];
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      _shortcuts.clear();
      if (Array.isArray(data.shortcuts)) {
        for (const s of data.shortcuts) {
          const normalized = _normalizeShortcut(s);
          if (normalized) _shortcuts.set(normalized.id, normalized);
        }
      }
      if (data.settings && typeof data.settings === 'object') {
        Object.assign(_settings, _normalizeSettings(data.settings));
      }
      _ensureKnownCategories();
    } catch (_) {}
  }

  function _save() {
    try {
      const payload = JSON.stringify({
        shortcuts: [..._shortcuts.values()],
        settings: _settings
      });
      localStorage.setItem(STORE_KEY, payload);
      return true;
    } catch (err) {
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: ошибка сохранения', 'error');
      return false;
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
    for (const w of words) {
      const lower = _normalizeWord(w);
      if (lower.length > 0 && !STOP_WORDS.has(lower)) return _nextCandidate(lower.slice(0, maxLen));
    }
    const sigWords = words.filter(w => !STOP_WORDS.has(_normalizeWord(w)));
    if (sigWords.length >= 2) {
      const acr = sigWords.map(w => { const n = _normalizeWord(w); return n ? n[0] : ''; }).filter(Boolean).join('').slice(0, maxLen);
      if (acr.length >= 2) return _nextCandidate(acr);
    }
    return _nextCandidate(words.map(w => _normalizeWord(w)).filter(Boolean).join('').slice(0, maxLen) || 'txt');
  }

  // ========================
  // TOKEN ENGINE
  // ========================

  function expandDynamicTokens(text) {
    if (!text) return text;
    const now = new Date();
    return text
      .replace(/\{\{date\}\}/g, () => now.toLocaleDateString('ru-RU'))
      .replace(/\{\{time\}\}/g, () => now.toLocaleTimeString('ru-RU'))
      .replace(/\{\{url\}\}/g, () => window.location.href)
      .replace(/\{\{email\}\}/g, () => _settings.email || '');
  }

  async function expandDynamicTokensAsync(text) {
    if (!text) return text;
    let result = expandDynamicTokens(text);
    if (result.includes('{{clipboard}}')) {
      try {
        const clip = (typeof navigator !== 'undefined' && navigator.clipboard?.readText)
          ? await navigator.clipboard.readText() : '';
        result = result.replace(/\{\{clipboard\}\}/g, clip || '');
      } catch (_) {
        result = result.replace(/\{\{clipboard\}\}/g, '');
      }
    }
    return result;
  }

  // ========================
  // HELPERS
  // ========================

  function _insertIntoTextarea(ta, value) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + value + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + value.length;
    ta.focus();
  }

  function _shortcutKey(s) {
    return String(s.category || 'General') + '\u0000' + String(s.trigger || '');
  }

  function _addShortcut(trigger, text, category) {
    trigger = _normalizeTrigger(trigger);
    text = String(text || '').trim();
    category = category || 'General';
    if (!trigger || !text) return { ok: false, reason: 'empty' };
    for (const s of _shortcuts.values()) {
      if (_shortcutKey(s) === _shortcutKey({ trigger, category })) return { ok: false, reason: 'duplicate' };
    }
    const id = _generateId();
    const item = { id, trigger, category, text, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
    _shortcuts.set(id, item);
    if (!_save()) { _shortcuts.delete(id); return { ok: false, reason: 'save' }; }
    return { ok: true, item };
  }

  function _clampPanelToViewport(panel) {
    const rect = panel.getBoundingClientRect();
    const maxW = Math.max(PANEL_MIN_W, window.innerWidth - 8);
    const maxH = Math.max(PANEL_MIN_H, window.innerHeight - 8);
    if (rect.width > maxW) panel.style.width = maxW + 'px';
    if (rect.height > maxH) panel.style.height = maxH + 'px';
    const nextRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - nextRect.width);
    const maxTop = Math.max(0, window.innerHeight - nextRect.height);
    const left = parseFloat(panel.style.left) || 0;
    const top = parseFloat(panel.style.top) || 0;
    panel.style.left = Math.max(0, Math.min(maxLeft, left)) + 'px';
    panel.style.top = Math.max(0, Math.min(maxTop, top)) + 'px';
  }

  // ========================
  // UI PANEL
  // ========================

  function _cancelPanelInteraction() {
    if (_panelInteractionCleanup) {
      _panelInteractionCleanup();
      _panelInteractionCleanup = null;
    }
    _panelDragging = false;
    _panelResizing = false;
    document.body.style.userSelect = '';
  }

  function openPanel() {
    if (_panelEl) {
      _panelEl.style.display = 'flex';
      const body = _panelEl.querySelector('.te-body');
      if (body) _refreshPanelTable(body);
      return;
    }
    _buildPanel();
  }

  function closePanel() {
    _cancelPanelInteraction();
    if (_panelEl) { _panelEl.remove(); _panelEl = null; }
    _editingId = null;
    _formShortcutInput = null;
    _formTextarea = null;
    _formCatSelect = null;
    _formAddBtn = null;
    _formBody = null;
  }

  function _clearPanelForm() {
    _editingId = null;
    if (_formShortcutInput) _formShortcutInput.value = '\u0401';
    if (_formTextarea) _formTextarea.value = '';
    if (_formCatSelect) _formCatSelect.value = _settings.categories[0] || 'General';
    if (_formAddBtn) _formAddBtn.textContent = 'Add Key';
  }

  function _buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'text-expander-panel';
    panel.style.minWidth = PANEL_MIN_W + 'px';
    panel.style.minHeight = PANEL_MIN_H + 'px';

    const _cssSize = (val, fallback) => {
      const n = parseFloat(val);
      return Number.isFinite(n) ? n + 'px' : fallback + 'px';
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

    requestAnimationFrame(() => {
      if (!_panelEl) return;
      _clampPanelToViewport(panel);
    });

    // Header
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

    const shortcutRow = document.createElement('div');
    shortcutRow.className = 'te-row';
    const shortcutInput = document.createElement('input');
    shortcutInput.type = 'text';
    shortcutInput.className = 'te-input te-input-wide';
    shortcutInput.placeholder = 'trigger';
    shortcutInput.maxLength = MAX_SHORTCUT_LEN;
    shortcutInput.value = '\u0401'; // Ё по умолчанию
    shortcutRow.appendChild(shortcutInput);

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

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'te-add-btn';
    addBtn.textContent = 'Add Key';

    addBtn.onclick = () => {
      if (_editingId) {
        // Режим редактирования — обновить существующий shortcut
        const existing = _shortcuts.get(_editingId);
        if (!existing) { _clearPanelForm(); return; }
        const newTrigger = _normalizeTrigger(shortcutInput.value);
        const newText = textarea.value.trim();
        const newCat = catSelect.value;
        if (!newTrigger || !newText) {
          if (typeof Toast !== 'undefined') Toast.show('TextExpander: введите shortcut и текст', 'error');
          return;
        }
        // Проверка коллизий (кроме текущего)
        for (const s of _shortcuts.values()) {
          if (s.id !== _editingId && _shortcutKey(s) === _shortcutKey({ trigger: newTrigger, category: newCat })) {
            if (typeof Toast !== 'undefined') Toast.show('TextExpander: такой shortcut уже есть в категории', 'error');
            return;
          }
        }
        existing.trigger = newTrigger;
        existing.text = newText;
        existing.category = newCat;
        existing.updatedAt = Date.now();
        if (!_save()) return;
        _clearPanelForm();
        _refreshPanelTable(body);
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: обновлено "' + newTrigger + '"', 'success');
        return;
      }
      // Режим добавления
      const result = _addShortcut(shortcutInput.value, textarea.value, catSelect.value);
      if (!result.ok && result.reason === 'empty') {
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: введите shortcut и текст', 'error');
        return;
      }
      if (!result.ok && result.reason === 'duplicate') {
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: такой shortcut уже есть в категории', 'error');
        return;
      }
      if (!result.ok) return;
      _clearPanelForm();
      _refreshPanelTable(body);
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: добавлено "' + result.item.trigger + '"', 'success');
    };

    const inputRow = document.createElement('div');
    inputRow.className = 'te-input-row';
    inputRow.appendChild(shortcutRow);
    inputRow.appendChild(catRow);
    inputRow.appendChild(addBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'te-textarea';
    textarea.placeholder = 'Текст сокращения... Поддерживает {{date}}, {{time}}, {{clipboard}}, {{url}}, {{email}}';
    textarea.rows = 5;

    const tokenBar = document.createElement('div');
    tokenBar.className = 'te-token-bar';
    [
      { label: 'date', token: '{{date}}' },
      { label: 'time', token: '{{time}}' },
      { label: 'clipboard', token: '{{clipboard}}' },
      { label: 'url', token: '{{url}}' },
      { label: 'email', token: '{{email}}' }
    ].forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-token-btn';
      btn.textContent = t.label;
      btn.title = 'Вставить ' + t.token;
      btn.onclick = () => _insertIntoTextarea(textarea, t.token);
      tokenBar.appendChild(btn);
    });

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
    };
    autoSlider.onchange = () => {
      _settings.autoLength = parseInt(autoSlider.value, 10);
      autoValue.textContent = autoSlider.value;
      _save();
    };
    autoRow.appendChild(autoLabel);
    autoRow.appendChild(autoSlider);
    autoRow.appendChild(autoValue);

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
    filterRow.addEventListener('click', e => {
      const btn = e.target.closest('.te-filter-btn');
      if (!btn) return;
      filterRow.querySelectorAll('.te-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _refreshPanelTable(body);
    });

    const tableContainer = document.createElement('div');
    tableContainer.className = 'te-table-container';

    body.appendChild(inputRow);
    body.appendChild(textarea);
    body.appendChild(tokenBar);
    body.appendChild(autoRow);
    body.appendChild(filterRow);
    body.appendChild(tableContainer);

    // Store form references for edit mode
    _formShortcutInput = shortcutInput;
    _formTextarea = textarea;
    _formCatSelect = catSelect;
    _formAddBtn = addBtn;
    _formBody = body;

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
    _panelEl = panel;

    _setupDrag(panel, header);
    _setupResize(panel);
    _refreshPanelTable(body);
  }

  function _refreshPanelTable(body) {
    const container = body?.querySelector('.te-table-container');
    if (!container) return;
    container.replaceChildren();

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

    const frag = document.createDocumentFragment();

    const thead = document.createElement('div');
    thead.className = 'te-table-head';
    ['Enabled', 'Shortcut', 'Category', 'Preview', ''].forEach(label => {
      const span = document.createElement('span');
      span.textContent = label;
      thead.appendChild(span);
    });
    frag.appendChild(thead);

    items.forEach(s => {
      const row = document.createElement('div');
      row.className = 'te-table-row';

      const toggle = document.createElement('label');
      toggle.className = 'te-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = s.enabled;
      checkbox.onchange = () => { s.enabled = checkbox.checked; _save(); };
      const slider = document.createElement('span');
      slider.className = 'te-toggle-slider';
      toggle.appendChild(checkbox);
      toggle.appendChild(slider);

      const shortcut = document.createElement('span');
      shortcut.className = 'te-table-shortcut';
      shortcut.textContent = s.trigger;

      const cat = document.createElement('span');
      cat.className = 'te-table-category';
      cat.textContent = s.category;

      const preview = document.createElement('span');
      preview.className = 'te-table-preview';
      const pt = (s.text || '').length > 25 ? s.text.slice(0, 25) + '...' : (s.text || '');
      preview.textContent = pt;
      preview.title = s.text || '';
      preview.style.cursor = 'pointer';
      preview.onclick = () => {
        _editingId = s.id;
        if (_formShortcutInput) _formShortcutInput.value = s.trigger;
        if (_formTextarea) _formTextarea.value = s.text || '';
        if (_formCatSelect) _formCatSelect.value = s.category;
        if (_formAddBtn) _formAddBtn.textContent = 'Save';
        if (_formBody) _formBody.scrollTop = 0;
      };

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'te-delete-btn';
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      del.onclick = () => {
        _shortcuts.delete(s.id);
        if (_editingId === s.id) _clearPanelForm();
        _save();
        _refreshPanelTable(body);
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: удалено "' + s.trigger + '"', 'success');
      };

      row.appendChild(toggle);
      row.appendChild(shortcut);
      row.appendChild(cat);
      row.appendChild(preview);
      row.appendChild(del);
      frag.appendChild(row);
    });

    container.appendChild(frag);
  }

  // ========================
  // TRIGGER ENGINE (input-based, like slash)
  // ========================

  function _escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function _getTriggerChar() {
    return _settings.triggerCode === 'Backquote' ? '\u0401' : '`';
  }

  function _getTriggerPattern() {
    return _settings.triggerCode === 'Backquote'
      ? '[`Ёё]'
      : _escapeRe(_getTriggerChar());
  }

  function _isTriggerChar(ch) {
    if (_settings.triggerCode === 'Backquote') return ch === '`' || ch === 'Ё' || ch === 'ё';
    return ch === _getTriggerChar();
  }

  function _handleTriggerInTextarea(ta, blockId) {
    const pos = ta.selectionStart;
    if (pos === undefined || pos === null) return;

    const before = ta.value.slice(0, pos);
    // Match: start/whitespace + trigger + query (non-whitespace until cursor)
    const re = new RegExp('(^|[\\n\\s])' + _getTriggerPattern() + '([^\\s\\n]*)$', 'i');
    const m = before.match(re);

    if (m) {
      const query = m[2].toLowerCase();
      const triggerStart = pos - m[0].length + m[1].length;

      if (!_dropdownEl) {
        _activeTa = ta;
        _activeBlockId = blockId || ta.closest('.block')?.dataset?.id || null;
        _dropdownStart = triggerStart;
        _dropdownFocusedIdx = 0;
        _dropdownQuery = query;
        _showDropdown(ta);
      } else {
        _dropdownQuery = query;
        _dropdownFocusedIdx = 0;
        _renderDropdownItems();
        if (!_dropdownItems.length) { _hideDropdown(); return; }
        _positionDropdownAtCaret(ta, _dropdownEl);
      }
      return;
    }

    // No regex match — check if space was typed after exact match
    if (_dropdownEl && _dropdownQuery && _activeTa === ta) {
      // Try to find trigger+query in text (including with trailing space)
      const reWithSpace = new RegExp(_getTriggerPattern() + _escapeRe(_dropdownQuery) + '\\s*$', 'i');
      const mSpace = before.match(reWithSpace);
      if (mSpace) {
        // Find the matching shortcut and insert
        for (const s of _shortcuts.values()) {
          if (s.enabled && s.trigger.toLowerCase() === _dropdownQuery) {
            _dropdownStart = pos - mSpace[0].length;
            _insertExpansion(s);
            return;
          }
        }
      }
      _hideDropdown();
      return;
    }

    // No dropdown open — do nothing (trigger char is just regular text)
  }

  // ========================
  // DROPDOWN MENU
  // ========================

  function _showDropdown(ta) {
    _hideDropdown();
    const session = ++_dropdownSession;

    const dd = document.createElement('div');
    dd.className = 'text-expander-dropdown';
    dd.setAttribute('role', 'listbox');
    dd._teSession = session;
    document.body.appendChild(dd);
    _dropdownEl = dd;

    _renderDropdownItems();
    _positionDropdownAtCaret(ta, dd);

    // Close on blur
    const onBlur = () => {
      setTimeout(() => {
        if (_dropdownEl && !_dropdownEl.contains(document.activeElement)) _hideDropdown();
      }, 150);
    };

    // Reposition on selection change
    const onSelectionChange = () => {
      if (session !== _dropdownSession || _dropdownEl !== dd) return;
      if (!_dropdownEl) return;
      if (document.activeElement !== ta) {
        _hideDropdown();
        return;
      }
      const curPos = ta.selectionStart;
      if (curPos < _dropdownStart) { _hideDropdown(); return; }

      const fragment = ta.value.slice(_dropdownStart, curPos);
      if (!fragment || !_isTriggerChar(fragment[0]) || /\s/.test(fragment.slice(1))) {
        _hideDropdown();
        return;
      }

      const nextQuery = fragment.slice(1).toLowerCase();
      if (nextQuery !== _dropdownQuery) {
        _dropdownQuery = nextQuery;
        _dropdownFocusedIdx = 0;
        _renderDropdownItems();
        if (!_dropdownEl) return;
      }

      _positionDropdownAtCaret(ta, dd);
    };

    ta.addEventListener('blur', onBlur);
    document.addEventListener('selectionchange', onSelectionChange);

    dd._cleanupInput = () => {
      ta.removeEventListener('blur', onBlur);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }

  function _hideDropdown() {
    _dropdownSession++;
    if (_dropdownEl) {
      _dropdownEl._cleanupInput?.();
      _dropdownEl.remove();
      _dropdownEl = null;
    }
    _dropdownItems = [];
    _activeTa = null;
    _activeBlockId = null;
    _dropdownQuery = '';
    _dropdownStart = 0;
    _dropdownFocusedIdx = 0;
    if (_caretMirrorSource && !_caretMirrorSource.isConnected) {
      _caretMirrorSource = null;
      _caretMirrorSignature = '';
    }
  }

  function _filterDropdownItems(query) {
    const q = (query || '').toLowerCase();
    const values = _shortcuts.values();

    if (!q) {
      const out = [];
      for (const s of values) {
        if (!s.enabled) continue;
        out.push(s);
        if (out.length >= MAX_DROPDOWN_ITEMS) break;
      }
      return out;
    }

    const exact = [], starts = [], includes = [];
    for (const s of _shortcuts.values()) {
      if (!s.enabled) continue;
      const tl = s.trigger.toLowerCase();
      if (tl === q) exact.push(s);
      else if (tl.startsWith(q)) starts.push(s);
      else if (tl.includes(q)) includes.push(s);
      if (exact.length + starts.length + includes.length >= MAX_DROPDOWN_ITEMS * 2) break;
    }
    return [...exact, ...starts, ...includes].slice(0, MAX_DROPDOWN_ITEMS);
  }

  function _refreshDropdownModel() {
    _dropdownItems = _filterDropdownItems(_dropdownQuery);
    if (_dropdownItems.length === 0) {
      _dropdownFocusedIdx = 0;
      return false;
    }
    _dropdownFocusedIdx = Math.min(
      _dropdownFocusedIdx,
      Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS) - 1
    );
    return true;
  }

  function _renderDropdownItems() {
    if (!_dropdownEl) return;
    const dd = _dropdownEl;
    dd.innerHTML = '';

    if (!_refreshDropdownModel()) {
      _hideDropdown();
      return;
    }

    _dropdownItems.slice(0, VISIBLE_DROPDOWN_ITEMS).forEach((item, idx) => {
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
      const pt = (item.text || '').length > 40 ? item.text.slice(0, 40) + '...' : (item.text || '');
      preview.textContent = pt;

      row.appendChild(shortcut);
      row.appendChild(catBadge);
      row.appendChild(preview);

      row.onmousedown = e => { e.preventDefault(); _insertExpansion(item); };
      dd.appendChild(row);
    });

    const visibleCount = Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS);
    dd.style.maxHeight = _dropdownItems.length > visibleCount ? (visibleCount * 36 + 10) + 'px' : '';
  }

  function _positionDropdownAtCaret(ta, dd) {
    const cs = window.getComputedStyle(ta);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;

    const m = _caretMirrorEl || document.createElement('div');
    if (!_caretMirrorEl) {
      _caretMirrorEl = m;
      m.style.position = 'absolute';
      m.style.visibility = 'hidden';
      m.style.pointerEvents = 'none';
      m.style.top = '-9999px';
      m.style.left = '-9999px';
      m.style.whiteSpace = 'pre-wrap';
      m.style.wordWrap = 'break-word';
      document.body.appendChild(m);
    }
    if (!_caretMirrorBefore || !_caretMirrorMarker) {
      m.replaceChildren();
      _caretMirrorBefore = document.createElement('span');
      _caretMirrorMarker = document.createElement('span');
      m.appendChild(_caretMirrorBefore);
      m.appendChild(_caretMirrorMarker);
    }

    const syncProps = [
      'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
      'paddingTop','paddingRight','paddingBottom','paddingLeft',
      'fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
      'lineHeight','textTransform','textIndent','wordBreak','overflowWrap','tabSize'
    ];

    const signature = syncProps.map(p => cs[p]).join('\x01') + '\x01' + ta.clientWidth;
    if (_caretMirrorSource !== ta || _caretMirrorSignature !== signature) {
      syncProps.forEach(p => { m.style[p] = cs[p]; });
      _caretMirrorSource = ta;
      _caretMirrorSignature = signature;
    }

    m.style.boxSizing = 'content-box';
    m.style.width = (ta.clientWidth - pl - pr) + 'px';

    _caretMirrorBefore.textContent = ta.value.substring(0, ta.selectionStart);
    _caretMirrorMarker.textContent = ta.value.substring(ta.selectionStart, ta.selectionStart + 1) || '.';

    const taR = ta.getBoundingClientRect();
    const mR = m.getBoundingClientRect();
    const mkR = _caretMirrorMarker.getBoundingClientRect();
    const ox = taR.left - mR.left - ta.scrollLeft;
    const oy = taR.top - mR.top - ta.scrollTop;
    let cx = mkR.left + ox;
    let cy = mkR.top + oy + lh + 4;

    requestAnimationFrame(() => {
      if (!_dropdownEl || _dropdownEl !== dd || !dd.isConnected) return;
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

  function _insertExpansion(item) {
    const ta = _activeTa;
    if (!ta) return;

    const session = _dropdownSession;
    const startPos = _dropdownStart;
    const endPos = ta.selectionStart;
    const expectedQuery = _dropdownQuery;
    const blockId = _activeBlockId;

    // Синхронная вставка для быстрых токенов
    let expansion = expandDynamicTokens(item.text);

    // Для clipboard — async fallback
    if (expansion.includes('{{clipboard}}')) {
      if (_dropdownEl) _dropdownEl.classList.add('te-dd-pending');
      expandDynamicTokensAsync(item.text).then(result => {
        if (session !== _dropdownSession) return;
        _doInsert(ta, result, startPos, endPos, expectedQuery, blockId);
      }).catch(() => {
        if (session !== _dropdownSession) return;
        _doInsert(ta, expansion.replace(/\{\{clipboard\}\}/g, ''), startPos, endPos, expectedQuery, blockId);
      });
      return;
    }

    _doInsert(ta, expansion, startPos, endPos, expectedQuery, blockId);
  }

  function _doInsert(ta, expansion, startPos, endPos, expectedQuery, blockId) {
    if (!ta || !ta.isConnected) return;
    if (ta.selectionStart !== endPos) return;
    const actualText = ta.value.slice(startPos, endPos);
    const actualTrimmed = actualText.trimEnd();
    if (!actualTrimmed || !_isTriggerChar(actualTrimmed[0])) return;
    if (actualTrimmed.slice(1).toLowerCase() !== String(expectedQuery || '').toLowerCase()) return;

    if (blockId && typeof State !== 'undefined') State.blockSnapshot(blockId);

    // Case handling
    if (expectedQuery) {
      const letters = String(expectedQuery).match(/[a-zа-яё]/gi) || [];
      const isUpper = letters.length > 0 && letters.every(ch => ch === ch.toUpperCase());
      const q0 = String(expectedQuery)[0];
      if (isUpper) {
        expansion = expansion.toUpperCase();
      } else if (q0 === q0.toUpperCase() && q0 !== q0.toLowerCase()) {
        const idx = expansion.search(/[a-zа-яё]/i);
        if (idx >= 0) expansion = expansion.slice(0, idx) + expansion[idx].toUpperCase() + expansion.slice(idx + 1);
      }
    }

    // Replace trigger+query with expansion
    const nextChar = ta.value.charAt(endPos);
    const needsSpace = !nextChar || !/[\s.,;:!?)]/.test(nextChar);
    ta.setRangeText(expansion + (needsSpace ? ' ' : ''), startPos, endPos, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    if (blockId && typeof State !== 'undefined') State.snapshot();

    _hideDropdown();
    ta.focus();
  }

  // ========================
  // LONG PRESS FSM
  // ========================

  function _setupLongPress(btn, ta, blockId) {
    if (btn.dataset.teLongPressAttached === '1') {
      btn._teLongPressCtx = { ta, blockId };
      return;
    }
    btn.dataset.teLongPressAttached = '1';
    btn._teLongPressCtx = { ta, blockId };

    let timer = null;
    let longFired = false;
    let startX = 0, startY = 0;

    btn.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      longFired = false;
      startX = e.clientX;
      startY = e.clientY;
      try { btn.setPointerCapture?.(e.pointerId); } catch (_) {}
      timer = setTimeout(() => { longFired = true; openPanel(); }, LONG_PRESS_MS);
    });

    btn.addEventListener('pointermove', e => {
      if (!timer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) { clearTimeout(timer); timer = null; }
    });

    btn.addEventListener('pointerup', e => {
      clearTimeout(timer); timer = null;
      try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('pointercancel', e => {
      clearTimeout(timer); timer = null; longFired = false;
      try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('pointerleave', e => {
      if (btn.hasPointerCapture?.(e.pointerId)) return;
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('click', e => {
      if (longFired) { e.preventDefault(); e.stopPropagation(); longFired = false; return; }
      const ctx = btn._teLongPressCtx || {};
      const clickTa = ctx.ta;
      const clickBlockId = ctx.blockId;
      if (clickTa && clickTa.selectionStart !== clickTa.selectionEnd) {
        const selected = clickTa.value.slice(clickTa.selectionStart, clickTa.selectionEnd);
        if (selected.length > 0) createFromSelection(selected, clickTa, clickBlockId);
      }
    });
  }

  // ========================
  // PUBLIC: createFromSelection
  // ========================

  function createFromSelection(selectedText, ta, blockId) {
    if (typeof selectedText !== 'string' || !selectedText.trim()) return;
    if (selectedText.length > MAX_SELECTION_LEN) {
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: выделенный текст слишком большой', 'error');
      return;
    }
    const trigger = generateSmartShortName(selectedText);
    const category = _settings.categories[0] || 'General';
    const id = _generateId();
    _shortcuts.set(id, { id, trigger, category, text: selectedText, enabled: true, createdAt: Date.now(), updatedAt: Date.now() });
    if (!_save()) { _shortcuts.delete(id); return; }
    if (typeof Toast !== 'undefined') Toast.show('TextExpander: создано "' + trigger + '"', 'success');
  }

  // ========================
  // PUBLIC: handleInput
  // ========================

  function handleInput(ta, blockId) {
    _handleTriggerInTextarea(ta, blockId);
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
        panel.style.left = Math.max(0, Math.min(Math.max(0, window.innerWidth - panel.offsetWidth), startL + (mv.clientX - startX))) + 'px';
        panel.style.top = Math.max(0, Math.min(Math.max(0, window.innerHeight - panel.offsetHeight), startT + (mv.clientY - startY))) + 'px';
      };
      const cleanup = () => {
        document.body.style.userSelect = '';
        _panelDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      const onUp = () => {
        cleanup();
        _panelInteractionCleanup = null;
        if (panel.isConnected) {
          _settings.panelPosition = { left: panel.style.left, top: panel.style.top };
          _save();
        }
      };
      _panelInteractionCleanup = cleanup;
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
        panel.style.width = Math.max(PANEL_MIN_W, Math.min(Math.max(PANEL_MIN_W, window.innerWidth - rect.left), startW + (mv.clientX - startX))) + 'px';
        panel.style.height = Math.max(PANEL_MIN_H, Math.min(Math.max(PANEL_MIN_H, window.innerHeight - rect.top), startH + (mv.clientY - startY))) + 'px';
      };
      const cleanup = () => {
        document.body.style.userSelect = '';
        _panelResizing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      const onUp = () => {
        cleanup();
        _panelInteractionCleanup = null;
        if (panel.isConnected) {
          _settings.panelSize = { w: panel.style.width, h: panel.style.height };
          _save();
        }
      };
      _panelInteractionCleanup = cleanup;
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
    if (_activeTa && !_activeTa.isConnected) {
      _hideDropdown();
      return;
    }

    const ae = document.activeElement;
    const isDropdownContext = ae === _activeTa || (_dropdownEl && _dropdownEl.contains(ae));
    if (!isDropdownContext) return;

    if (!_dropdownItems.length) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _hideDropdown(); }
      return;
    }
    const visibleCount = Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS);
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      _dropdownFocusedIdx = Math.min(_dropdownFocusedIdx + 1, visibleCount - 1);
      _updateDropdownFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      _dropdownFocusedIdx = Math.max(_dropdownFocusedIdx - 1, 0);
      _updateDropdownFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      const item = _dropdownItems[_dropdownFocusedIdx];
      if (item) _insertExpansion(item);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
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
      shortcuts: [..._shortcuts.values()].map(s => _normalizeShortcut(s)).filter(Boolean),
      settings: Object.assign({
        triggerCode: TRIGGER_CODE,
        autoLength: AUTO_LENGTH_DEFAULT,
        email: '',
        categories: [...DEFAULT_CATEGORIES],
        panelPosition: null,
        panelSize: null
      }, _normalizeSettings(_settings))
    };
  }

  function load(data) {
    if (!data || typeof data !== 'object') return;
    _hideDropdown();
    if (Array.isArray(data.shortcuts)) {
      for (const s of data.shortcuts) {
        const normalized = _normalizeShortcut(s);
        if (!normalized) continue;
        const existing = _shortcuts.get(normalized.id);
        if (existing) {
          if ((normalized.updatedAt || 0) > (existing.updatedAt || 0)) Object.assign(existing, normalized);
        } else {
          _shortcuts.set(normalized.id, normalized);
        }
      }
      const seen = new Map();
      for (const [id, s] of _shortcuts) {
        const key = _shortcutKey(s);
        const prev = seen.get(key);
        if (!prev) { seen.set(key, { id, updatedAt: s.updatedAt || 0 }); continue; }
        if ((s.updatedAt || 0) > prev.updatedAt) { _shortcuts.delete(prev.id); seen.set(key, { id, updatedAt: s.updatedAt || 0 }); }
        else _shortcuts.delete(id);
      }
    }
    if (data.settings && typeof data.settings === 'object') {
      Object.assign(_settings, _normalizeSettings(data.settings));
    }
    _ensureKnownCategories();
    _save();
    if (_panelEl) {
      const body = _panelEl.querySelector('.te-body');
      if (body) _refreshPanelTable(body);
    }
  }

  // ========================
  // INIT
  // ========================

  function init() {
    if (_inited) return;
    _inited = true;
    _load();

    _dropdownKeyHandler = _handleDropdownKeydown;
    document.addEventListener('keydown', _dropdownKeyHandler, true);

    _outsideClickHandler = e => {
      if (_activeTa && !_activeTa.isConnected) { _hideDropdown(); return; }
      if (_dropdownEl && !_dropdownEl.contains(e.target) && e.target !== _activeTa) _hideDropdown();
    };
    document.addEventListener('mousedown', _outsideClickHandler);

    _escapePanelHandler = e => { if (e.key === 'Escape' && _panelEl) closePanel(); };
    document.addEventListener('keydown', _escapePanelHandler);

    _windowBlurHandler = () => _hideDropdown();
    window.addEventListener('blur', _windowBlurHandler);

    _visibilityChangeHandler = () => { if (document.hidden) _hideDropdown(); };
    document.addEventListener('visibilitychange', _visibilityChangeHandler);
  }

  function destroy() {
    if (!_inited) return;
    _inited = false;
    if (_dropdownKeyHandler) document.removeEventListener('keydown', _dropdownKeyHandler, true);
    if (_outsideClickHandler) document.removeEventListener('mousedown', _outsideClickHandler);
    if (_escapePanelHandler) document.removeEventListener('keydown', _escapePanelHandler);
    if (_windowBlurHandler) window.removeEventListener('blur', _windowBlurHandler);
    if (_visibilityChangeHandler) document.removeEventListener('visibilitychange', _visibilityChangeHandler);
    _dropdownKeyHandler = null;
    _outsideClickHandler = null;
    _escapePanelHandler = null;
    _windowBlurHandler = null;
    _visibilityChangeHandler = null;
    _hideDropdown();
    closePanel();
    if (_caretMirrorEl) { _caretMirrorEl.remove(); _caretMirrorEl = null; }
    _caretMirrorSource = null;
    _caretMirrorSignature = '';
    _caretMirrorBefore = null;
    _caretMirrorMarker = null;
  }

  return {
    init, destroy, openPanel, closePanel,
    createFromSelection, handleInput,
    generateSmartShortName, expandDynamicTokens,
    serialize, load, exists,
    _setupLongPress
  };
})();

window.TextExpander = TextExpander;
