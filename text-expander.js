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
  const DEFAULT_TRIGGER = 'ё';
  const MAX_TRIGGER_LEN = 3;
  const AUTO_LENGTH_DEFAULT = 4;
  const LONG_PRESS_MS = 450;
  const DRAG_THRESHOLD = 10;
  const PANEL_DEFAULT_W = 400;
  const PANEL_DEFAULT_H = 600;
  const PANEL_MIN_W = 350;
  const PANEL_MIN_H = 500;
  const MAX_SHORTCUT_LEN = 20;
  const MAX_DROPDOWN_ITEMS = 100;
  const VISIBLE_DROPDOWN_ITEMS = 6;
  const DROPDOWN_ROW_HEIGHT = 26;
  const MAX_SELECTION_LEN = 50000;

  const SHORTENER_MODES = { WORD: 'word', ACRONYM: 'acronym', GLUE: 'glue' };
  const DEFAULT_SHORTENER_MODE = SHORTENER_MODES.WORD;

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
    trigger: DEFAULT_TRIGGER,
    autoLength: AUTO_LENGTH_DEFAULT,
    shortener: {
      mode: DEFAULT_SHORTENER_MODE,
      digits: false
    },
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
  let _insertingExpansion = false;
  let _dropdownPositionSeq = 0;
  let _panelDragging = false;
  let _panelResizing = false;
  let _panelInteractionCleanup = null;
  let _caretMirrorEl = null;
  let _caretMirrorSource = null;
  let _caretMirrorSignature = '';
  let _caretMirrorBefore = null;
  let _caretMirrorMarker = null;
  let _lastSavedPayload = '';
  let _editingId = null; // ID shortcut в режиме редактирования
  let _formShortcutInput = null;
  let _formTriggerInput = null;
  let _formTextarea = null;
  let _formCatSelect = null;
  let _formAddBtn = null;
  let _formBody = null;

  let _dropdownCleanup = null;

  // Stored listener refs for cleanup
  let _dropdownKeyHandler = null;
  let _outsideClickHandler = null;
  let _focusInHandler = null;
  let _escapePanelHandler = null;
  let _windowBlurHandler = null;
  let _visibilityChangeHandler = null;

  // ========================
  // STORAGE
  // ========================

  function _getShortcutValue(s) {
    return String(s.shortcut || s.trigger || '');
  }

  function _normalizeGlobalTrigger(value) {
    return String(value || '')
      .trim()
      .replace(/[\u0000-\u001F\u007F\s]+/g, '')
      .slice(0, MAX_TRIGGER_LEN);
  }

  function _normalizeShortcutText(value) {
    return String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/[\u0000-\u001F\u007F\s]+/g, '')
      .slice(0, MAX_SHORTCUT_LEN);
  }

  function _normalizeShortcut(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;

    const rawShortcut = typeof raw.shortcut === 'string' ? raw.shortcut : raw.trigger;
    if (typeof rawShortcut !== 'string') return null;

    const shortcut = _normalizeShortcutText(rawShortcut);
    if (!shortcut) return null;

    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim().slice(0, 80)
      : 'General';

    const text = typeof raw.text === 'string'
      ? raw.text.slice(0, MAX_SELECTION_LEN)
      : '';

    return {
      id: raw.id,
      shortcut,
      trigger: shortcut,
      category,
      text,
      enabled: raw.enabled !== false,
      useCount: typeof raw.useCount === 'number' ? Math.max(0, Math.floor(raw.useCount)) : 0,
      lastUsedAt: Number.isFinite(Number(raw.lastUsedAt)) ? Number(raw.lastUsedAt) : 0,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now()
    };
  }

  function _normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};

    if (typeof raw.trigger === 'string') {
      const trigger = _normalizeGlobalTrigger(raw.trigger);
      if (trigger) out.trigger = trigger;
    }
    if (!out.trigger && typeof raw.triggerCode === 'string') {
      if (raw.triggerCode === 'Backquote') out.trigger = 'ё';
    }

    if (Number.isFinite(Number(raw.autoLength))) out.autoLength = Math.max(2, Math.min(20, Number(raw.autoLength)));

    if (raw.shortener && typeof raw.shortener === 'object' && !Array.isArray(raw.shortener)) {
      const mode = String(raw.shortener.mode || '');
      const allowed = new Set([SHORTENER_MODES.WORD, SHORTENER_MODES.ACRONYM, SHORTENER_MODES.GLUE]);
      out.shortener = {
        mode: allowed.has(mode) ? mode : DEFAULT_SHORTENER_MODE,
        digits: raw.shortener.digits === true
      };
    }

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

  function _dedupeShortcutsByKey() {
    const seen = new Map();
    const entries = [..._shortcuts.entries()];
    for (const [id, s] of entries) {
      const key = _shortcutKey(s);
      const prev = seen.get(key);
      if (!prev) {
        seen.set(key, { id, updatedAt: s.updatedAt || 0 });
        continue;
      }
      if ((s.updatedAt || 0) > prev.updatedAt) {
        _shortcuts.delete(prev.id);
        seen.set(key, { id, updatedAt: s.updatedAt || 0 });
      } else {
        _shortcuts.delete(id);
      }
    }
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      _lastSavedPayload = raw;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      _shortcuts.clear();
      if (Array.isArray(data.shortcuts)) {
        for (const s of data.shortcuts) {
          const normalized = _normalizeShortcut(s);
          if (normalized) _shortcuts.set(normalized.id, normalized);
        }
      }
      _dedupeShortcutsByKey();
      if (data.settings && typeof data.settings === 'object') {
        Object.assign(_settings, _normalizeSettings(data.settings));
      }
      _ensureKnownCategories();
    } catch (err) {
      _shortcuts.clear();
      _lastSavedPayload = '';
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: повреждены сохранённые данные', 'error');
    }
  }

  function _save() {
    try {
      const payload = JSON.stringify({
        shortcuts: [..._shortcuts.values()],
        settings: _settings
      });
      if (payload === _lastSavedPayload) return true;
      localStorage.setItem(STORE_KEY, payload);
      _lastSavedPayload = payload;
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
    const c = _normalizeShortcutText(candidate).toLowerCase();
    for (const s of _shortcuts.values()) {
      if (_getShortcutValue(s).toLowerCase() === c) return true;
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

  function _getNormalizedWords(text) {
    return String(text || '').split(/\s+/).map(_normalizeWord).filter(Boolean);
  }

  function _getSignificantWords(text) {
    return _getNormalizedWords(text).filter(w => !STOP_WORDS.has(w));
  }

  function _makeWordBase(text, maxLen) {
    const significant = _getSignificantWords(text);
    if (significant.length) return significant[0].slice(0, maxLen);
    const all = _getNormalizedWords(text);
    if (all.length) return all[0].slice(0, maxLen);
    return 'txt'.slice(0, maxLen);
  }

  function _makeAcronymBase(text, maxLen) {
    const significant = _getSignificantWords(text);
    const source = significant.length ? significant : _getNormalizedWords(text);
    const acronym = source.map(w => w[0]).filter(Boolean).join('').slice(0, maxLen);
    if (acronym.length >= 2) return acronym;
    return _makeWordBase(text, maxLen);
  }

  function _makeGlueBase(text, maxLen) {
    const significant = _getSignificantWords(text);
    const source = significant.length ? significant : _getNormalizedWords(text);
    const glued = source.join('').slice(0, maxLen);
    return glued || 'txt'.slice(0, maxLen);
  }

  function _makeShortcutBase(text, mode) {
    const maxLen = Math.max(2, Math.min(20, Number(_settings.autoLength) || AUTO_LENGTH_DEFAULT));
    if (mode === SHORTENER_MODES.ACRONYM) return _normalizeShortcutText(_makeAcronymBase(text, maxLen));
    if (mode === SHORTENER_MODES.GLUE) return _normalizeShortcutText(_makeGlueBase(text, maxLen));
    return _normalizeShortcutText(_makeWordBase(text, maxLen));
  }

  function _getWordCandidates(text, maxLen) {
    const out = [];
    const significant = _getSignificantWords(text);
    for (const w of significant) {
      out.push(_normalizeShortcutText(w.slice(0, maxLen)));
    }
    if (!out.length) {
      const all = _getNormalizedWords(text);
      for (const w of all) {
        out.push(_normalizeShortcutText(w.slice(0, maxLen)));
      }
    }
    if (!out.length) out.push(_normalizeShortcutText('txt'.slice(0, maxLen)));
    return [...new Set(out.filter(Boolean))];
  }

  function _getAcronymCandidates(text, maxLen) {
    const out = [];
    const significant = _getSignificantWords(text);
    const source = significant.length ? significant : _getNormalizedWords(text);
    if (source.length >= 2) {
      const full = source.map(w => w[0]).filter(Boolean).join('').slice(0, maxLen);
      if (full.length >= 2) out.push(_normalizeShortcutText(full));
    }
    if (!out.length) {
      const all = _getNormalizedWords(text);
      for (const w of all) {
        out.push(_normalizeShortcutText(w.slice(0, maxLen)));
      }
    }
    if (!out.length) out.push(_normalizeShortcutText('txt'.slice(0, maxLen)));
    return [...new Set(out.filter(Boolean))];
  }

  function _getGlueCandidates(text, maxLen) {
    const out = [];
    const significant = _getSignificantWords(text);
    const source = significant.length ? significant : _getNormalizedWords(text);
    if (source.length >= 2) {
      const glued = source.join('').slice(0, maxLen);
      if (glued) out.push(_normalizeShortcutText(glued));
      const half = source.slice(0, Math.max(2, Math.floor(source.length / 2)));
      const halfGlue = half.join('').slice(0, maxLen);
      if (halfGlue && halfGlue !== glued) out.push(_normalizeShortcutText(halfGlue));
    }
    const all = _getNormalizedWords(text);
    for (const w of all) {
      const v = _normalizeShortcutText(w.slice(0, maxLen));
      if (!out.includes(v)) out.push(v);
    }
    if (!out.length) out.push(_normalizeShortcutText('txt'.slice(0, maxLen)));
    return [...new Set(out.filter(Boolean))];
  }

  function _firstFreeCandidate(candidates) {
    for (const c of candidates) {
      if (!c) continue;
      if (!exists(c)) return c;
    }
    return null;
  }

  function _nextNumberedCandidate(base) {
    const normalizedBase = _normalizeShortcutText(base) || 'txt';
    for (let i = 1; i < 1000; i++) {
      const suffix = String(i);
      const maxBaseLen = Math.max(1, MAX_SHORTCUT_LEN - suffix.length);
      const candidate = normalizedBase.slice(0, maxBaseLen) + suffix;
      if (!exists(candidate)) return candidate;
    }
    const fallbackSuffix = Date.now().toString(36).slice(-3);
    const maxBaseLen = Math.max(1, MAX_SHORTCUT_LEN - fallbackSuffix.length);
    return normalizedBase.slice(0, maxBaseLen) + fallbackSuffix;
  }

  function generateSmartShortName(text) {
    const sh = _getShortenerSettings();

    if (sh.digits) {
      // Digits mode: pure number — first available from 1
      for (let i = 1; i < 10000; i++) {
        if (!exists(String(i))) return String(i);
      }
      return String(Date.now() % 10000);
    }

    const maxLen = Math.max(2, Math.min(20, Number(_settings.autoLength) || AUTO_LENGTH_DEFAULT));

    let candidates = [];
    if (sh.mode === SHORTENER_MODES.ACRONYM) {
      candidates = _getAcronymCandidates(text, maxLen);
    } else if (sh.mode === SHORTENER_MODES.GLUE) {
      candidates = _getGlueCandidates(text, maxLen);
    } else {
      candidates = _getWordCandidates(text, maxLen);
    }

    const free = _firstFreeCandidate(candidates);
    if (free) return free;

    const base = candidates[0] || 'txt';
    return _nextCandidate(base);
  }

  // ========================
  // TOKEN ENGINE
  // ========================

  function _formatDateTime(now) {
    return now.toLocaleString('ru-RU', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function _getBlockElByContext(ta, blockId) {
    if (ta?.closest) { const b = ta.closest('.block'); if (b) return b; }
    if (blockId) return document.querySelector('.block[data-id="' + CSS.escape(blockId) + '"]');
    return null;
  }

  function _getBlockTitle(ta, blockId) {
    const block = _getBlockElByContext(ta, blockId);
    if (!block) return '';
    const el = block.querySelector('input.block-title');
    return el ? String(el.value || '').trim() : '';
  }

  function _getBlockIndex(ta, blockId) {
    const block = _getBlockElByContext(ta, blockId);
    if (!block) return '';
    const blocks = [...document.querySelectorAll('.block')];
    const idx = blocks.indexOf(block);
    return idx >= 0 ? String(idx + 1) : '';
  }

  function expandDynamicTokens(text, context) {
    if (!text) return text;
    if (!String(text).includes('{{')) return text;
    const now = new Date();
    const ta = context?.ta || null;
    const blockId = context?.blockId || null;

    return String(text)
      .replace(/\{\{date\}\}/g, () => now.toLocaleDateString('ru-RU'))
      .replace(/\{\{time\}\}/g, () => now.toLocaleTimeString('ru-RU'))
      .replace(/\{\{datetime\}\}/g, () => _formatDateTime(now))
      .replace(/\{\{title\}\}/g, () => _getBlockTitle(ta, blockId))
      .replace(/\{\{blockIndex\}\}/g, () => _getBlockIndex(ta, blockId));
  }

  async function expandDynamicTokensAsync(text, context) {
    if (!text) return text;
    if (!String(text).includes('{{')) return text;
    let result = expandDynamicTokens(text, context);
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
    return String(s.category || 'General') + '\u0000' + _getShortcutValue(s).toLowerCase();
  }

  function _addShortcut(shortcut, text, category) {
    shortcut = _normalizeShortcutText(shortcut);
    text = String(text || '').trim();
    category = category || 'General';
    if (!shortcut || !text) return { ok: false, reason: 'empty' };
    for (const s of _shortcuts.values()) {
      if (_shortcutKey(s) === _shortcutKey({ shortcut, trigger: shortcut, category })) return { ok: false, reason: 'duplicate' };
    }
    const id = _generateId();
    const item = { id, shortcut, trigger: shortcut, category, text, enabled: true, useCount: 0, lastUsedAt: 0, createdAt: Date.now(), updatedAt: Date.now() };
    _shortcuts.set(id, item);
    if (!_save()) { _shortcuts.delete(id); return { ok: false, reason: 'save' }; }
    return { ok: true, item };
  }

  function _showAddShortcutError(result) {
    if (!result || result.ok) return;
    if (typeof Toast === 'undefined') return;
    if (result.reason === 'empty') Toast.show('TextExpander: введите shortcut и текст', 'error');
    else if (result.reason === 'duplicate') Toast.show('TextExpander: такой shortcut уже есть в категории', 'error');
    else if (result.reason === 'save') Toast.show('TextExpander: ошибка сохранения', 'error');
  }

  function _getShortenerSettings() {
    const sh = _settings.shortener && typeof _settings.shortener === 'object' ? _settings.shortener : {};
    const mode = [SHORTENER_MODES.WORD, SHORTENER_MODES.ACRONYM, SHORTENER_MODES.GLUE].includes(sh.mode)
      ? sh.mode : DEFAULT_SHORTENER_MODE;
    return { mode, digits: sh.digits === true };
  }

  function _setShortenerMode(mode) {
    if (![SHORTENER_MODES.WORD, SHORTENER_MODES.ACRONYM, SHORTENER_MODES.GLUE].includes(mode)) return;
    if (!_settings.shortener || typeof _settings.shortener !== 'object') {
      _settings.shortener = { mode: DEFAULT_SHORTENER_MODE, digits: false };
    }
    _settings.shortener.mode = mode;
    _save();
  }

  function _toggleShortenerDigits() {
    if (!_settings.shortener || typeof _settings.shortener !== 'object') {
      _settings.shortener = { mode: DEFAULT_SHORTENER_MODE, digits: false };
    }
    _settings.shortener.digits = !_settings.shortener.digits;
    _save();
  }

  function _saveTriggerFromInput(input) {
    const next = _normalizeGlobalTrigger(input?.value);
    if (!next) {
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: trigger не может быть пустым', 'error');
      if (input) input.value = _settings.trigger || DEFAULT_TRIGGER;
      return false;
    }
    if (next !== _settings.trigger) {
      _settings.trigger = next;
      _hideDropdown();
      _save();
    }
    if (input) input.value = next;
    return true;
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
    _formTriggerInput = null;
    _formTextarea = null;
    _formCatSelect = null;
    _formAddBtn = null;
    _formBody = null;
  }

  function _clearPanelForm() {
    _editingId = null;
    if (_formShortcutInput) _formShortcutInput.value = '';
    if (_formTextarea) _formTextarea.value = '';
    if (_formCatSelect) _formCatSelect.value = _settings.categories[0] || 'General';
    if (_formAddBtn) _formAddBtn.textContent = 'Добавить';
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
    title.textContent = 'Текстовый экспандер';
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

    const inputRow = document.createElement('div');
    inputRow.className = 'te-input-row te-input-row-compact';

    // Global trigger input
    const triggerInput = document.createElement('input');
    triggerInput.type = 'text';
    triggerInput.className = 'te-input te-trigger-input';
    triggerInput.placeholder = 'ё';
    triggerInput.maxLength = MAX_TRIGGER_LEN;
    triggerInput.value = _settings.trigger || DEFAULT_TRIGGER;
    triggerInput.title = 'Глобальный триггер для всех сокращений';

    // Shortcut input
    const shortcutInput = document.createElement('input');
    shortcutInput.type = 'text';
    shortcutInput.className = 'te-input te-shortcut-input';
    shortcutInput.placeholder = 'сокращение';
    shortcutInput.maxLength = MAX_SHORTCUT_LEN;
    shortcutInput.value = '';

    // Category select (no label)
    const catSelect = document.createElement('select');
    catSelect.className = 'te-select te-category-select';
    _settings.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });

    // Add button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'te-add-btn';
    addBtn.textContent = 'Добавить';

    addBtn.onclick = () => {
      // Save global trigger first
      if (!_saveTriggerFromInput(triggerInput)) return;

      if (_editingId) {
        const existing = _shortcuts.get(_editingId);
        if (!existing) { _clearPanelForm(); return; }
        const newShortcut = _normalizeShortcutText(shortcutInput.value);
        const newText = textarea.value.trim();
        const newCat = catSelect.value;
        if (!newShortcut || !newText) {
          if (typeof Toast !== 'undefined') Toast.show('TextExpander: введите shortcut и текст', 'error');
          return;
        }
        for (const s of _shortcuts.values()) {
          if (s.id !== _editingId && _shortcutKey(s) === _shortcutKey({ shortcut: newShortcut, trigger: newShortcut, category: newCat })) {
            if (typeof Toast !== 'undefined') Toast.show('TextExpander: такой shortcut уже есть в категории', 'error');
            return;
          }
        }
        const prev = {
          shortcut: existing.shortcut,
          trigger: existing.trigger,
          text: existing.text,
          category: existing.category,
          updatedAt: existing.updatedAt
        };

        existing.shortcut = newShortcut;
        existing.trigger = newShortcut;
        existing.text = newText;
        existing.category = newCat;
        existing.updatedAt = Date.now();

        if (!_save()) {
          Object.assign(existing, prev);
          return;
        }
        _clearPanelForm();
        _refreshPanelTable(body);
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: обновлено "' + newShortcut + '"', 'success');
        return;
      }
      // Add mode
      const result = _addShortcut(shortcutInput.value, textarea.value, catSelect.value);
      if (!result.ok) {
        _showAddShortcutError(result);
        return;
      }
      _clearPanelForm();
      _refreshPanelTable(body);
      if (typeof Toast !== 'undefined') Toast.show('TextExpander: добавлено "' + _getShortcutValue(result.item) + '"', 'success');
    };

    inputRow.appendChild(triggerInput);
    inputRow.appendChild(shortcutInput);
    inputRow.appendChild(catSelect);
    inputRow.appendChild(addBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'te-textarea';
    textarea.placeholder = 'Текст подстановки... {{date}}, {{time}}, {{datetime}}, {{title}}, {{clipboard}}, {{cursor}}, {{blockIndex}}';
    textarea.rows = 5;

    const tokenBar = document.createElement('div');
    tokenBar.className = 'te-token-bar';
    [
      { label: 'date', token: '{{date}}' },
      { label: 'time', token: '{{time}}' },
      { label: 'datetime', token: '{{datetime}}' },
      { label: 'title', token: '{{title}}' },
      { label: 'clipboard', token: '{{clipboard}}' },
      { label: 'cursor', token: '{{cursor}}' },
      { label: 'blockIndex', token: '{{blockIndex}}' }
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
    autoLabel.textContent = 'Длина';
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

    // Shortener mode icons
    const modeGroup = document.createElement('div');
    modeGroup.className = 'te-shortener-modes';
    modeGroup.setAttribute('aria-label', 'Механизм автогенерации сокращения');

    const WORD_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h10M3 15h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const ACRONYM_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15L7.5 5h1L12 15M5.2 12h5.6M14 5v10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const GLUE_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 7.5l5 5M6.5 12.5l-1 1a3 3 0 104.2 4.2l1-1M13.5 7.5l1-1a3 3 0 10-4.2-4.2l-1 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    const DIGITS_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h2v10M5 15h4M12 7.5a2.5 2.5 0 115 0c0 1.2-.8 2.1-1.8 3L12 15h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function _createShortenerModeButton(mode, title, svg) {
      const sh = _getShortenerSettings();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-shortener-mode-btn';
      btn.dataset.mode = mode;
      btn.title = title;
      btn.innerHTML = svg;
      btn.classList.toggle('active', sh.mode === mode && !sh.digits);
      btn.setAttribute('aria-pressed', sh.mode === mode && !sh.digits ? 'true' : 'false');
      btn.onclick = () => {
        _setShortenerMode(mode);
        // Disable digits when selecting a mode
        if (sh.digits) { _toggleShortenerDigits(); }
        const group = btn.closest('.te-shortener-modes');
        if (group) {
          group.querySelectorAll('.te-shortener-mode-btn[data-mode]').forEach(b => {
            const isActive = b.dataset.mode === mode;
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          });
          // Update digits button state
          const digitsBtn = group.querySelector('.te-shortener-digits-btn');
          if (digitsBtn) {
            digitsBtn.classList.remove('active');
            digitsBtn.setAttribute('aria-pressed', 'false');
          }
        }
      };
      return btn;
    }

    function _createDigitsModeButton(svg) {
      const sh = _getShortenerSettings();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'te-shortener-mode-btn te-shortener-digits-btn';
      btn.dataset.digits = '1';
      btn.title = 'Только цифры: 1, 2, 3... (первая свободная)';
      btn.innerHTML = svg;
      btn.classList.toggle('active', sh.digits);
      btn.setAttribute('aria-pressed', sh.digits ? 'true' : 'false');
      btn.onclick = () => {
        _toggleShortenerDigits();
        const next = _getShortenerSettings();
        btn.classList.toggle('active', next.digits);
        btn.setAttribute('aria-pressed', next.digits ? 'true' : 'false');
        // When digits is ON, deselect all mode buttons (digits works independently)
        const group = btn.closest('.te-shortener-modes');
        if (group) {
          group.querySelectorAll('.te-shortener-mode-btn[data-mode]').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
          });
        }
      };
      return btn;
    }

    modeGroup.appendChild(_createShortenerModeButton(SHORTENER_MODES.WORD, 'Первое значимое слово', WORD_ICON));
    modeGroup.appendChild(_createShortenerModeButton(SHORTENER_MODES.ACRONYM, 'Акроним из первых букв', ACRONYM_ICON));
    modeGroup.appendChild(_createShortenerModeButton(SHORTENER_MODES.GLUE, 'Склейка слов', GLUE_ICON));
    modeGroup.appendChild(_createDigitsModeButton(DIGITS_ICON));

    autoRow.appendChild(autoLabel);
    autoRow.appendChild(autoSlider);
    autoRow.appendChild(autoValue);
    autoRow.appendChild(modeGroup);

    const filterRow = document.createElement('div');
    filterRow.className = 'te-filter-row';
    const filterAll = document.createElement('button');
    filterAll.type = 'button';
    filterAll.className = 'te-filter-btn active';
    filterAll.textContent = 'Все';
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
    _formTriggerInput = triggerInput;
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

  function _getPanelItems(activeFilter) {
    return [..._shortcuts.values()]
      .filter(s => activeFilter === 'Все' || s.category === activeFilter)
      .sort((a, b) => {
        const au = a.useCount || 0;
        const bu = b.useCount || 0;
        if (au !== bu) return bu - au;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
  }

  function _refreshPanelTable(body) {
    const container = body?.querySelector('.te-table-container');
    if (!container) return;
    container.replaceChildren();

    const activeFilter = body.querySelector('.te-filter-btn.active')?.textContent || 'Все';
    const items = _getPanelItems(activeFilter);

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
    ['Вкл', 'Сокращение', 'Категория', 'Текст', ''].forEach(label => {
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
      checkbox.onchange = () => {
        const prev = s.enabled;
        s.enabled = checkbox.checked;
        if (!_save()) {
          s.enabled = prev;
          checkbox.checked = prev;
        }
      };
      const slider = document.createElement('span');
      slider.className = 'te-toggle-slider';
      toggle.appendChild(checkbox);
      toggle.appendChild(slider);

      const shortcut = document.createElement('span');
      shortcut.className = 'te-table-shortcut';
      shortcut.textContent = _getShortcutValue(s);

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
        if (_formShortcutInput) _formShortcutInput.value = _getShortcutValue(s);
        if (_formTextarea) _formTextarea.value = s.text || '';
        if (_formCatSelect) _formCatSelect.value = s.category;
        if (_formAddBtn) _formAddBtn.textContent = 'Сохранить';
        if (_formBody) _formBody.scrollTop = 0;
      };

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'te-delete-btn';
      del.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      del.onclick = () => {
        _shortcuts.delete(s.id);
        if (!_save()) {
          _shortcuts.set(s.id, s);
          _refreshPanelTable(body);
          return;
        }
        if (_editingId === s.id) _clearPanelForm();
        _refreshPanelTable(body);
        if (typeof Toast !== 'undefined') Toast.show('TextExpander: удалено "' + _getShortcutValue(s) + '"', 'success');
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

  // ========================
  // LAYOUT NORMALIZATION
  // ========================

  // ЙЦУКЕН ↔ QWERTY mapping (letters only, lowercase)
  const _LAT_TO_RUS = {
    'q': 'й', 'w': 'ц', 'e': 'у', 'r': 'к', 't': 'е', 'y': 'н',
    'u': 'г', 'i': 'ш', 'o': 'щ', 'p': 'з', '[': 'х', ']': 'ъ',
    'a': 'ф', 's': 'ы', 'd': 'в', 'f': 'а', 'g': 'п', 'h': 'р',
    'j': 'о', 'k': 'л', 'l': 'д', ';': 'ж', "'": 'э',
    'z': 'я', 'x': 'ч', 'c': 'с', 'v': 'м', 'b': 'и', 'n': 'т',
    'm': 'ь', ',': 'б', '.': 'ю', '/': '.'
  };
  const _RUS_TO_LAT = {};
  for (const [lat, rus] of Object.entries(_LAT_TO_RUS)) {
    _RUS_TO_LAT[rus] = lat;
  }

  function _convertLayout(str, mapping) {
    return String(str).split('').map(ch => {
      const lower = ch.toLowerCase();
      const converted = mapping[lower];
      if (!converted) return ch;
      return ch === lower ? converted : converted.toUpperCase();
    }).join('');
  }

  function _getLayoutAlternatives(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return [];
    const alt = _convertLayout(q, _LAT_TO_RUS).toLowerCase();
    const altRev = _convertLayout(q, _RUS_TO_LAT).toLowerCase();
    const out = [];
    if (alt !== q) out.push(alt);
    if (altRev !== q && !out.includes(altRev)) out.push(altRev);
    return out;
  }

  function _escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function _getGlobalTrigger() {
    return _settings.trigger || DEFAULT_TRIGGER;
  }

  function _getTriggerPattern() {
    if (_getGlobalTrigger().toLowerCase() === 'ё') {
      return '(?:ё|Ё|`)';
    }
    return _escapeRe(_getGlobalTrigger());
  }

  function _startsWithTrigger(fragment) {
    const trigger = _getGlobalTrigger();
    if (trigger.toLowerCase() === 'ё') {
      return fragment.startsWith('ё') || fragment.startsWith('Ё') || fragment.startsWith('`');
    }
    return fragment.startsWith(trigger);
  }

  function _stripTrigger(fragment) {
    if (_getGlobalTrigger().toLowerCase() === 'ё') {
      if (fragment[0] === 'ё' || fragment[0] === 'Ё' || fragment[0] === '`') return fragment.slice(1);
    }
    return fragment.startsWith(_getGlobalTrigger()) ? fragment.slice(_getGlobalTrigger().length) : fragment;
  }

  function _findExactEnabledShortcut(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return null;
    const alts = _getLayoutAlternatives(query);
    for (const s of _shortcuts.values()) {
      if (!s.enabled) continue;
      const sv = _getShortcutValue(s).toLowerCase();
      if (sv === q) return s;
      for (const a of alts) {
        if (sv === a) return s;
      }
    }
    return null;
  }

  function _findTriggerQueryBeforeCaret(ta) {
    const pos = ta.selectionStart;
    if (pos == null) return null;
    const before = ta.value.slice(0, pos);
    const re = new RegExp('(^|[\\n\\s])(' + _getTriggerPattern() + ')([^\\s\\n]*)$', 'i');
    const m = before.match(re);
    if (!m) return null;
    return { query: m[3].toLowerCase(), start: pos - m[0].length + m[1].length, end: pos };
  }

  function _findCompletedShortcutBeforeCaret(ta) {
    const pos = ta.selectionStart;
    if (pos == null) return null;
    const before = ta.value.slice(0, pos);
    const re = new RegExp('(^|[\\n\\s])(' + _getTriggerPattern() + ')([^\\s\\n]+)([\\s\\n])$', 'i');
    const m = before.match(re);
    if (!m) return null;
    return { query: m[3].toLowerCase(), start: pos - m[0].length + m[1].length, end: pos, delimiter: m[4] };
  }

  function _handleTriggerInTextarea(ta, blockId) {
    const pos = ta.selectionStart;
    if (pos === undefined || pos === null) return;

    const before = ta.value.slice(0, pos);

    // 1. Check completed form: trigger + shortcut + space
    const completed = _findCompletedShortcutBeforeCaret(ta);
    if (completed) {
      const item = _findExactEnabledShortcut(completed.query);
      if (item) {
        _activeTa = ta;
        _activeBlockId = blockId || ta.closest('.block')?.dataset?.id || null;
        _dropdownStart = completed.start;
        _dropdownQuery = completed.query;
        _insertExpansion(item, completed.end);
        return;
      }
    }

    // 2. Check incomplete trigger+query for dropdown
    const active = _findTriggerQueryBeforeCaret(ta);
    if (active) {
      _activeTa = ta;
      _activeBlockId = blockId || ta.closest('.block')?.dataset?.id || null;
      _dropdownStart = active.start;
      _dropdownQuery = active.query;

      if (!_dropdownEl) {
        _dropdownFocusedIdx = 0;
        _showDropdown(ta);
        // _showDropdown calls _hideDropdown internally which clears _activeTa — restore it
        _activeTa = ta;
        _activeBlockId = blockId || ta.closest('.block')?.dataset?.id || null;
        _dropdownStart = active.start;
        _dropdownQuery = active.query;
      } else {
        _dropdownFocusedIdx = 0;
        _renderDropdownItems();
        if (!_dropdownItems.length) { _hideDropdown(); return; }
        _positionDropdownAtCaret(ta, _dropdownEl);
      }
      return;
    }

    if (_dropdownEl && _activeTa === ta) {
      _hideDropdown();
    }
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
    if (!_dropdownEl || _dropdownEl !== dd || !dd.isConnected) {
      return;
    }

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
      const queryPart = _stripTrigger(fragment);
      if (!fragment || !_startsWithTrigger(fragment) || /\s/.test(queryPart)) {
        _hideDropdown();
        return;
      }

      const nextQuery = queryPart.toLowerCase();
      if (nextQuery !== _dropdownQuery) {
        _dropdownQuery = nextQuery;
        _dropdownFocusedIdx = 0;
        _renderDropdownItems();
        if (!_dropdownEl) return;
      }

      _positionDropdownAtCaret(ta, dd);
    };

    // Mouse wheel navigation
    const onWheel = (e) => {
      if (!_dropdownItems.length) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const visibleCount = Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS);
      _dropdownFocusedIdx = Math.max(0, Math.min(visibleCount - 1, _dropdownFocusedIdx + dir));
      _updateDropdownFocus();
    };

    ta.addEventListener('blur', onBlur);
    document.addEventListener('selectionchange', onSelectionChange);
    dd.addEventListener('wheel', onWheel, { passive: false });

    _dropdownCleanup = () => {
      ta.removeEventListener('blur', onBlur);
      document.removeEventListener('selectionchange', onSelectionChange);
      dd.removeEventListener('wheel', onWheel);
    };
    dd._cleanupInput = _dropdownCleanup;
  }

  function _hideDropdown() {
    _dropdownSession++;
    _dropdownPositionSeq++;
    _insertingExpansion = false;
    if (_dropdownCleanup) {
      _dropdownCleanup();
      _dropdownCleanup = null;
    }
    if (_dropdownEl) {
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

    if (!q) {
      const out = [];
      for (const s of _shortcuts.values()) {
        if (!s.enabled) continue;
        out.push(s);
        if (out.length >= MAX_DROPDOWN_ITEMS) break;
      }
      return out;
    }

    // Collect all query variants (original + layout alternatives)
    const queries = [q, ..._getLayoutAlternatives(query)];

    const exact = [];
    const starts = [];
    const includes = [];
    for (const s of _shortcuts.values()) {
      if (!s.enabled) continue;
      const tl = _getShortcutValue(s).toLowerCase();
      let matched = false;
      for (const qv of queries) {
        if (tl === qv) { exact.push(s); matched = true; break; }
        else if (tl.startsWith(qv) && !matched) { starts.push(s); matched = true; break; }
        else if (tl.includes(qv) && !matched) { includes.push(s); matched = true; break; }
      }
      if (exact.length + starts.length + includes.length >= MAX_DROPDOWN_ITEMS * 2) break;
    }

    const _rankCompare = (a, b) => {
      const at = _getShortcutValue(a).toLowerCase();
      const bt = _getShortcutValue(b).toLowerCase();
      if (at.length !== bt.length) return at.length - bt.length;
      // Find best query match for position comparison
      let aIdx = -1, bIdx = -1;
      for (const qv of queries) {
        const ai = at.indexOf(qv);
        const bi = bt.indexOf(qv);
        if (ai >= 0 && (aIdx < 0 || ai < aIdx)) aIdx = ai;
        if (bi >= 0 && (bIdx < 0 || bi < bIdx)) bIdx = bi;
      }
      if (aIdx !== bIdx) return aIdx - bIdx;
      const au = a.useCount || 0;
      const bu = b.useCount || 0;
      if (au !== bu) return bu - au;
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
    };

    exact.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
    starts.sort(_rankCompare);
    includes.sort(_rankCompare);

    const out = [];
    for (const group of [exact, starts, includes]) {
      for (const s of group) {
        out.push(s);
        if (out.length >= MAX_DROPDOWN_ITEMS) return out;
      }
    }
    return out;
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
    dd.replaceChildren();

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
      shortcut.textContent = _getShortcutValue(item);

      const preview = document.createElement('span');
      preview.className = 'te-dd-preview';
      const pt = (item.text || '').length > 40 ? item.text.slice(0, 40) + '...' : (item.text || '');
      preview.textContent = pt;

      row.appendChild(shortcut);
      row.appendChild(preview);

      row.onmousedown = e => { e.preventDefault(); _insertExpansion(item); };
      dd.appendChild(row);
    });

    const visibleCount = Math.min(_dropdownItems.length, VISIBLE_DROPDOWN_ITEMS);
    dd.style.maxHeight = (visibleCount * DROPDOWN_ROW_HEIGHT + 8) + 'px';
    dd.style.overflowY = 'auto';
  }

  function _positionDropdownAtCaret(ta, dd) {
    const posSeq = ++_dropdownPositionSeq;
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

    const beforeText = ta.value.substring(0, ta.selectionStart);
    const markerText = ta.value.substring(ta.selectionStart, ta.selectionStart + 1) || '.';
    if (_caretMirrorBefore.textContent !== beforeText) _caretMirrorBefore.textContent = beforeText;
    if (_caretMirrorMarker.textContent !== markerText) _caretMirrorMarker.textContent = markerText;

    const taR = ta.getBoundingClientRect();
    const mR = m.getBoundingClientRect();
    const mkR = _caretMirrorMarker.getBoundingClientRect();
    const ox = taR.left - mR.left - ta.scrollLeft;
    const oy = taR.top - mR.top - ta.scrollTop;
    let cx = mkR.left + ox;
    let cy = mkR.top + oy + lh + 4;

    requestAnimationFrame(() => {
      if (posSeq !== _dropdownPositionSeq) return;
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

  function _insertExpansion(item, forcedEndPos) {
    if (_insertingExpansion) return;
    const ta = _activeTa;
    if (!ta) return;
    const insertToken = _generateId();
    _insertingExpansion = true;

    const session = _dropdownSession;
    const startPos = _dropdownStart;
    const endPos = Number.isFinite(forcedEndPos) ? forcedEndPos : ta.selectionStart;
    const expectedQuery = _dropdownQuery;
    const blockId = _activeBlockId;
    const context = { ta, blockId };

    // Increment useCount on successful expansion
    const _bumpUseCount = () => {
      if (item && typeof item === 'object') {
        item.useCount = (item.useCount || 0) + 1;
        item.lastUsedAt = Date.now();
        _save();
      }
    };

    // Синхронная вставка для быстрых токенов
    let expansion = expandDynamicTokens(item.text, context);

    // Для clipboard — async fallback
    if (expansion.includes('{{clipboard}}')) {
      if (_dropdownEl) _dropdownEl.classList.add('te-dd-pending');
      ta._teInsertToken = insertToken;
      expandDynamicTokensAsync(item.text, context).then(result => {
        if (session !== _dropdownSession) return;
        if (ta._teInsertToken !== insertToken) return;
        const ok = _doInsert(ta, result, startPos, endPos, expectedQuery, blockId);
        if (ok) _bumpUseCount();
        else _hideDropdown();
      }).catch(() => {
        if (session !== _dropdownSession) return;
        if (!_doInsert(ta, expansion.replace(/\{\{clipboard\}\}/g, ''), startPos, endPos, expectedQuery, blockId)) _hideDropdown();
      }).finally(() => {
        _insertingExpansion = false;
        if (_dropdownEl) _dropdownEl.classList.remove('te-dd-pending');
      });
      return;
    }

    try {
      const ok = _doInsert(ta, expansion, startPos, endPos, expectedQuery, blockId);
      if (ok) _bumpUseCount();
      else _hideDropdown();
    } finally {
      _insertingExpansion = false;
    }
  }

  function _doInsert(ta, expansion, startPos, endPos, expectedQuery, blockId) {
    if (!ta || !ta.isConnected) return false;
    if (ta !== _activeTa) return false;
    if (ta.selectionStart !== endPos) return false;

    const actualText = ta.value.slice(startPos, endPos);
    const actualTrimmed = actualText.trimEnd();
    if (!actualTrimmed || !_startsWithTrigger(actualTrimmed)) return false;
    if (_stripTrigger(actualTrimmed).toLowerCase() !== String(expectedQuery || '').toLowerCase()) return false;

    if (blockId && typeof State !== 'undefined') State.blockSnapshot(blockId);

    // Handle {{cursor}} token
    const cursorToken = '{{cursor}}';
    let cursorOffset = -1;
    const tokenIndex = expansion.indexOf(cursorToken);
    if (tokenIndex >= 0) {
      cursorOffset = tokenIndex;
      expansion = expansion.replace(cursorToken, '');
    }

    // Case handling
    if (expectedQuery) {
      const letters = String(expectedQuery).match(/[a-zа-яё]/gi) || [];
      const isUpper = letters.length > 0 && letters.every(ch => ch === ch.toUpperCase());
      const q0 = String(expectedQuery)[0];
      if (isUpper) {
        if (expansion.length <= 120 && !/[\n\r]/.test(expansion)) {
          expansion = expansion.toUpperCase();
        }
      } else if (q0 === q0.toUpperCase() && q0 !== q0.toLowerCase()) {
        const idx = expansion.search(/[a-zа-яё]/i);
        if (idx >= 0) expansion = expansion.slice(0, idx) + expansion[idx].toUpperCase() + expansion.slice(idx + 1);
      }
    }

    // Replace trigger+query with expansion + space
    const finalExpansion = expansion.endsWith(' ') ? expansion : expansion + ' ';
    ta.setRangeText(finalExpansion, startPos, endPos, 'end');

    // Position cursor if {{cursor}} was present (before dispatchEvent)
    if (cursorOffset >= 0) {
      const finalCursorPos = startPos + cursorOffset;
      ta.selectionStart = ta.selectionEnd = finalCursorPos;
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));

    if (blockId && typeof State !== 'undefined') State.snapshot();

    _hideDropdown();
    ta.focus();
    return true;
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
    let cancelledByMove = false;
    let startX = 0, startY = 0;

    btn.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      longFired = false;
      cancelledByMove = false;
      startX = e.clientX;
      startY = e.clientY;
      try { btn.setPointerCapture?.(e.pointerId); } catch (_) {}
      timer = setTimeout(() => {
        timer = null;
        longFired = true;
        openPanel();
      }, LONG_PRESS_MS);
    });

    btn.addEventListener('pointermove', e => {
      if (!timer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        cancelledByMove = true;
        clearTimeout(timer);
        timer = null;
      }
    });

    btn.addEventListener('pointerup', e => {
      clearTimeout(timer); timer = null;
      try { btn.releasePointerCapture?.(e.pointerId); } catch (_) {}
    });

    btn.addEventListener('pointercancel', e => {
      clearTimeout(timer);
      timer = null;
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
      if (longFired || cancelledByMove) {
        e.preventDefault();
        e.stopPropagation();
        longFired = false;
        cancelledByMove = false;
        return;
      }
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
    const shortcut = generateSmartShortName(selectedText);
    const category = _settings.categories[0] || 'General';
    const id = _generateId();
    _shortcuts.set(id, { id, shortcut, trigger: shortcut, category, text: selectedText, enabled: true, useCount: 0, lastUsedAt: 0, createdAt: Date.now(), updatedAt: Date.now() });
    if (!_save()) { _shortcuts.delete(id); return; }
    if (typeof Toast !== 'undefined') Toast.show('TextExpander: создано "' + shortcut + '"', 'success');
  }

  // ========================
  // PUBLIC: handleInput
  // ========================

  function handleInput(ta, blockId) {
    if (_dropdownEl && _activeTa && _activeTa !== ta) {
      _hideDropdown();
    }
    _handleTriggerInTextarea(ta, blockId);
  }

  // ========================
  // PANEL DRAG
  // ========================

  function _setupDrag(panel, handle) {
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      _cancelPanelInteraction();
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
      _cancelPanelInteraction();
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
    if (_insertingExpansion) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
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
    } else if (e.key === 'Tab' && _dropdownItems.length === 1) {
      e.preventDefault(); e.stopPropagation();
      _insertExpansion(_dropdownItems[0]);
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
        trigger: DEFAULT_TRIGGER,
        autoLength: AUTO_LENGTH_DEFAULT,
        shortener: { mode: DEFAULT_SHORTENER_MODE, digits: false },
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
      _dedupeShortcutsByKey();
    }
    if (data.settings && typeof data.settings === 'object') {
      Object.assign(_settings, _normalizeSettings(data.settings));
    }
    _ensureKnownCategories();
    _save();
    if (_panelEl) {
      closePanel();
      openPanel();
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

    _focusInHandler = e => {
      if (!_dropdownEl) return;
      if (_activeTa && !_activeTa.isConnected) {
        _hideDropdown();
        return;
      }
      if (e.target !== _activeTa && !_dropdownEl.contains(e.target)) {
        _hideDropdown();
      }
    };
    document.addEventListener('focusin', _focusInHandler);

    _escapePanelHandler = e => {
      if (e.key !== 'Escape' || !_panelEl) return;
      const ae = document.activeElement;
      if (ae && _panelEl.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      closePanel();
    };
    document.addEventListener('keydown', _escapePanelHandler);

    _windowBlurHandler = () => {
      _hideDropdown();
      _cancelPanelInteraction();
    };
    window.addEventListener('blur', _windowBlurHandler);

    _visibilityChangeHandler = () => {
      if (document.hidden) {
        _hideDropdown();
        _cancelPanelInteraction();
      }
    };
    document.addEventListener('visibilitychange', _visibilityChangeHandler);
  }

  function destroy() {
    if (!_inited) return;
    _inited = false;
    if (_dropdownKeyHandler) document.removeEventListener('keydown', _dropdownKeyHandler, true);
    if (_outsideClickHandler) document.removeEventListener('mousedown', _outsideClickHandler);
    if (_focusInHandler) document.removeEventListener('focusin', _focusInHandler);
    if (_escapePanelHandler) document.removeEventListener('keydown', _escapePanelHandler);
    if (_windowBlurHandler) window.removeEventListener('blur', _windowBlurHandler);
    if (_visibilityChangeHandler) document.removeEventListener('visibilitychange', _visibilityChangeHandler);
    _dropdownKeyHandler = null;
    _outsideClickHandler = null;
    _focusInHandler = null;
    _escapePanelHandler = null;
    _windowBlurHandler = null;
    _visibilityChangeHandler = null;
    if (_dropdownCleanup) { _dropdownCleanup(); _dropdownCleanup = null; }
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
