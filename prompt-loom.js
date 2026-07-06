// file_name: prompt-loom.js

/* ============================================================
   Prompt Loom — внутренняя история copy/paste и быстрый ввод через \
   Скелет модуля: автономный, безопасно подключается после ui.js/state.js.
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'promptLoom.v1';
  const SETTINGS_KEY = 'promptLoom.settings.v1';
  const MAX_ITEMS = 500;
  const QUICK_LIMIT = 20;
  const PAGE_SIZE = 10;
  const MIN_TEXT_LEN = 3;
  const SNIPPET_MIN_REPEATS = 3;
  const SNIPPET_DAYS = 7;
  const SNIPPET_SIMILARITY = 0.58;
  const MERGE_SIMILARITY = 0.84;
  const SNIPPET_TOAST_COOLDOWN = 3 * 60 * 1000;

  const DEFAULT_SETTINGS = {
    enabled: true,
    skipLLM: false,
    skipCode: false,
    maxChars: 30000,
    panelOpen: false,
    panelCompact: false,
    panelUltraLight: false,
    quickPinned: true,
    hoverOpen: true,
    toggleTop: null,
    ignoreSimilar: []
  };

  const TYPE_META = {
    copy:    { label: 'COPY',    color: '#60a5fa', icon: iconCopy() },
    paste:   { label: 'PASTE',   color: '#34d399', icon: iconPaste() },
    llm:     { label: 'LLM',     color: '#a78bfa', icon: iconSpark() },
    autopoet:{ label: 'POET',    color: '#86efac', icon: iconQuill() },
    snippet: { label: 'SNIP',    color: '#fb7185', icon: iconBolt() },
    manual:  { label: 'TEXT',    color: '#67e8f9', icon: iconText() }
  };

  const CLASS_META = {
    code:        { label: 'code',        color: '#fbbf24' },
    error:       { label: 'error',       color: '#ef4444' },
    instruction: { label: 'instruction', color: '#67e8f9' },
    json:        { label: 'json',        color: '#22c55e' },
    markdown:    { label: 'md',          color: '#93c5fd' },
    text:        { label: 'text',        color: '#94a3b8' },
    llmAnswer:   { label: 'answer',      color: '#c084fc' }
  };

  let state = loadState();
  let settings = loadSettings();
  let panel = null;
  let palette = null;
  let activeFilter = 'all';
  let activeQuery = '';
  let inlineSession = null;
  let paletteWrapHold = '';
  let clearArmed = false;
  let clearTimer = null;
  let patchedClipboard = false;
  let originalWriteText = null;
  let lastStorageToastAt = 0;
  let lastInputEl = null;
  let lastExternalInputEl = null;

  let hoverOpenTimer = null;
  let toggleDragActive = false;

  let lastSuggestionKey = '';
  let lastSuggestionAt = 0;
  let lastCreatedSnippet = null;
  let internalPasteHash = '';
  let internalPasteUntil = 0;
  let internalCopyHash = '';
  let internalCopyUntil = 0;
  let suppressTriggerUntil = 0;
  let paletteOutsideClickBlockedUntil = 0;
  let installed = false;
  let mirrorEl = null;
  let mirrorBefore = null;
  let mirrorMarker = null;

  const VALID_SOURCES = Object.keys(TYPE_META);
  const VALID_KINDS = Object.keys(CLASS_META);

  function normalizeItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (!item.id || typeof item.id !== 'string') item.id = uid();
    item.text = String(item.text || '').slice(0, 300000);
    if (!item.text) return null;
    item.source = VALID_SOURCES.includes(item.source) ? item.source : 'manual';
    item.kind = VALID_KINDS.includes(item.kind) ? item.kind : 'text';
    item.hash = String(item.hash || hashText(item.text));
    item.sig = String(item.sig || '');
    item.variants = Array.isArray(item.variants)
      ? item.variants.slice(0, 5).map(v => ({
          text: String(v?.text || '').slice(0, 300000),
          hash: String(v?.hash || hashText(v?.text || '')),
          source: VALID_SOURCES.includes(v?.source) ? v.source : item.source,
          createdAt: Number(v?.createdAt) || item.createdAt
        })).filter(v => v.text)
      : [];
    item.lastSource = String(item.lastSource || item.source);
    item.createdAt = Number(item.createdAt) || Date.now();
    item.updatedAt = Number(item.updatedAt) || item.createdAt;
    item.usedAt = Number(item.usedAt) || 0;
    item.uses = Math.min(999, Math.max(0, Number(item.uses) || 0));
    item.seen = Math.min(999, Math.max(1, Number(item.seen) || 1));
    item.pinned = !!item.pinned;
    item.meta = (item.meta && typeof item.meta === 'object') ? sanitizeMeta(item.meta) : {};
    return item;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const raw = Array.isArray(parsed.items) ? parsed.items : [];
      const items = raw.map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS);
      return { items };
    } catch (_) {
      return { items: [] };
    }
  }

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
      return {
        enabled: raw.enabled !== false,
        skipLLM: !!raw.skipLLM,
        skipCode: !!raw.skipCode,
        maxChars: Math.max(100, Math.min(300000, parseInt(raw.maxChars, 10) || DEFAULT_SETTINGS.maxChars)),
        panelOpen: !!raw.panelOpen,
        panelCompact: !!raw.panelCompact,
        panelUltraLight: !!raw.panelUltraLight,
        quickPinned: raw.quickPinned !== false,
        hoverOpen: raw.hoverOpen !== false,
        toggleTop: typeof raw.toggleTop === 'number' ? raw.toggleTop : null,
        ignoreSimilar: Array.isArray(raw.ignoreSimilar) ? raw.ignoreSimilar.slice(-300) : []
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      const now = Date.now();
      if (now - lastStorageToastAt > 30000) {
        lastStorageToastAt = now;
        toast('Не удалось сохранить историю Prompt Loom', 'error');
      }
      return false;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (err) {
      const now = Date.now();
      if (now - lastStorageToastAt > 30000) {
        lastStorageToastAt = now;
        toast('Не удалось сохранить настройки Prompt Loom', 'error');
      }
      return false;
    }
  }

  function uid() {
    return 'pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function hashText(text) {
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  const TOKEN_SYNONYMS = new Map([
    ['ответь', 'отвечай'], ['отвечать', 'отвечай'], ['пиши', 'напиши'], ['написать', 'напиши'],
    ['коротко', 'кратко'], ['лаконично', 'кратко'], ['сжато', 'кратко'],
    ['конкретные', 'конкретно'], ['конкретными', 'конкретно'], ['воды', 'вода'], ['водичку', 'вода'],
    ['пример', 'примеры'], ['примерами', 'примеры'], ['примеров', 'примеры'],
    ['структурируй', 'структура'], ['структурно', 'структура'], ['структурировано', 'структура']
  ]);
  const TOKEN_STOP_WORDS = new Set([
    'и','в','во','на','с','со','к','ко','а','но','или','что','это','как','для','по','при','из','от','до','же','ли','бы','не','ни','то','та','те','за','у','об','о',
    'the','a','an','to','of','in','on','and','or','is','are','be','with','for'
  ]);

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[ё]/g, 'е')
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function signature(text) {
    return tokenSignature(text).slice(0, 18).join(' ');
  }

  function tokenSignature(text) {
    return normalizeText(text)
      .split(' ')
      .map(w => TOKEN_SYNONYMS.get(w) || w)
      .filter(w => w.length > 2 && !TOKEN_STOP_WORDS.has(w));
  }

  function similarityScore(a, b) {
    const at = new Set(tokenSignature(a));
    const bt = new Set(tokenSignature(b));
    if (!at.size || !bt.size) return 0;
    let hits = 0;
    at.forEach(t => { if (bt.has(t)) hits++; });
    const jaccard = hits / (at.size + bt.size - hits);
    const containment = hits / Math.min(at.size, bt.size);
    return Math.max(jaccard, containment * 0.82);
  }

  function classify(text, source) {
    const raw = String(text || '').trim();
    const low = raw.toLowerCase();

    if (source === 'llm' || source === 'autopoet') return 'llmAnswer';

    if ((raw.startsWith('{') || raw.startsWith('[')) && raw.length < 150000) {
      try { JSON.parse(raw); return 'json'; } catch (_) {}
    }

    if (/\b(typeerror|referenceerror|syntaxerror|uncaught|traceback|exception|error:|stack trace|at\s+\S+\s*\(|line\s+\d+)\b/i.test(raw)) {
      return 'error';
    }

    if (/(```|^\s*import\s|^\s*export\s|\b(function|const|let|var|class|return|async|await)\b|=>|<[a-z][\s\S]*>|\{\s*[\w-]+\s*:|\.[\w-]+\s*\{)/m.test(raw)) {
      return 'code';
    }

    if (/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(raw)) {
      return 'markdown';
    }

    if (/^(отвечай|ответь|напиши|сделай|используй|объясни|проверь|найди|сократи|переведи|оформи|не\s+добавляй|ты\s+[—-])/i.test(low) ||
        /(без воды|кратко|структурируй|markdown|пример|формат|роль|сразу к делу|конкретн)/i.test(low)) {
      return 'instruction';
    }

    return 'text';
  }

  function shouldSkip(text, source, kind) {
    const t = String(text || '').trim();
    const skip = getSkipReason(t, source, kind);
    if (skip) {
      debugSkip(skip, t, source, kind);
      return true;
    }
    return false;
  }

  function getSkipReason(text, source, kind) {
    if (!settings.enabled) return 'paused';
    if (text.length < MIN_TEXT_LEN) return 'too-short';
    if (text.length > settings.maxChars) return 'too-long';
    if (settings.skipLLM && (source === 'llm' || source === 'autopoet')) return 'llm-disabled';
    if (settings.skipCode && kind === 'code') return 'code-disabled';
    if (looksSensitive(text)) return 'sensitive';
    return '';
  }

  function looksSensitive(text) {
    const t = String(text || '').trim();
    if (/^(sk-|ghp_|github_pat_|eyJ[a-zA-Z0-9_-]{20,})/.test(t)) return true;
    if (/\b(api[_-]?key|access[_-]?token|auth[_-]?token|bearer|password|passwd|secret)\b\s*[:=]\s*['"]?[A-Za-z0-9._\-+/=]{12,}/i.test(t)) return true;
    if (/\bauthorization\s*:\s*bearer\s+[A-Za-z0-9._\-+/=]{12,}/i.test(t)) return true;
    if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*:\s*[^\s]{8,}/.test(t)) return true;
    if (/-----BEGIN\s+(RSA|OPENSSH|EC|DSA)?\s*PRIVATE\s+KEY-----/i.test(t)) return true;
    if (/\b(AKIA|ASIA)[A-Z0-9]{16}\b/.test(t)) return true;
    if (/\bAIza[0-9A-Za-z_-]{35}\b/.test(t)) return true;
    if (/\bxox[baprs]-[A-Za-z0-9\-]{10,}/.test(t)) return true;
    if (/\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}/.test(t)) return true;
    if (/\b[A-Za-z][A-Za-z0-9+.\-]*:\/\/[^:\s/]+:[^@\s/]+@/.test(t)) return true;
    if (/\b(cookie|set-cookie)\s*:/i.test(t)) return true;
    if (/\b(sessionid|connect\.sid|csrftoken|xsrf-token|refresh_token)\b\s*[:=]/i.test(t)) return true;
    if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(t)) return true;
    if (/^\s*[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*.{8,}/im.test(t)) return true;
    return false;
  }

  const META_WHITELIST = ['via', 'lastVia', 'lastSeenBumpAt', 'featureKey', 'mode', 'blockId', 'prompt'];

  function sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return {};
    const out = {};
    for (const key of META_WHITELIST) {
      if (key in meta) {
        const val = meta[key];
        out[key] = typeof val === 'string' ? val.slice(0, 500) : typeof val === 'number' ? val : String(val).slice(0, 500);
      }
    }
    return out;
  }

  function record(text, source = 'manual', meta = {}) {
    const safeSource = TYPE_META[source] ? source : 'manual';
    const safeMeta = sanitizeMeta(meta);
    const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\s+$/u, '');
    const kind = classify(clean, safeSource);
    if (shouldSkip(clean, safeSource, kind)) return null;

    const hash = hashText(clean);
    const now = Date.now();
    const recentSame = state.items.find(x => x.hash === hash && now - (x.updatedAt || x.createdAt) < 15000);
    if (recentSame) {
      const lastSeenBumpAt = Number(recentSame.meta?.lastSeenBumpAt || 0);
      const nextMeta = { ...(recentSame.meta || {}), lastVia: safeMeta?.via || safeSource };
      if (now - lastSeenBumpAt > 1000) {
        recentSame.seen = Math.min(999, Number(recentSame.seen || 1) + 1);
        nextMeta.lastSeenBumpAt = now;
      }
      recentSame.meta = nextMeta;
      recentSame.updatedAt = now;
      saveState();
      renderPanelList();
      maybeSuggestSnippet(recentSame);
      return recentSame;
    }

    const mergeTarget = findMergeTarget(clean, safeSource, kind, hash, now);
    if (mergeTarget) {
      mergeSimilarItem(mergeTarget, clean, safeSource, safeMeta, now);
      saveState();
      renderPanelList();
      maybeSuggestSnippet(mergeTarget);
      return mergeTarget;
    }

    const item = {
      id: uid(),
      text: clean,
      source: safeSource,
      kind,
      hash,
      sig: signature(clean),
      variants: [],
      lastSource: safeSource,
      createdAt: now,
      updatedAt: now,
      usedAt: 0,
      uses: 0,
      seen: 1,
      pinned: false,
      meta: safeMeta
    };

    state.items.unshift(item);
    if (state.items.length > MAX_ITEMS) {
      const pinned = state.items.filter(x => x.pinned).slice(0, MAX_ITEMS);
      const rest = state.items.filter(x => !x.pinned).slice(0, Math.max(0, MAX_ITEMS - pinned.length));
      state.items = [...pinned, ...rest];
    }
    saveState();
    renderPanelList();
    maybeSuggestSnippet(item);
    return item;
  }

  function findMergeTarget(text, source, kind, hash, now) {
    const mergeable = ['instruction', 'text', 'markdown', 'llmAnswer'];
    if (!mergeable.includes(kind)) return null;
    if (String(text || '').length > 900) return null;

    const targetSig = signature(text);
    const horizon = now - 14 * 86400000;
    const candidates = state.items.filter(item =>
      (item.hash === hash && (source !== 'snippet' || item.source === 'snippet')) ||
      ((item.updatedAt || item.createdAt) >= horizon &&
       item.kind === kind &&
       item.source === source &&
       mergeable.includes(item.kind) &&
       String(item.text || '').length <= 900)
    );

    return candidates.find(item =>
      item.hash === hash ||
      (targetSig && item.sig === targetSig) ||
      similarityScore(item.text, text) >= MERGE_SIMILARITY
    ) || null;
  }

  function mergeSimilarItem(item, text, source, meta, now) {
    const hash = hashText(text);
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const alreadyKnown = item.hash === hash || variants.some(v => v.hash === hash);
    if (!alreadyKnown && normalizeText(item.text) !== normalizeText(text)) {
      variants.unshift({ text, hash, source, createdAt: now });
      item.variants = variants.slice(0, 5);
    } else {
      item.variants = variants;
    }

    item.seen = Math.min(999, Number(item.seen || 1) + 1);
    item.updatedAt = now;
    item.lastSource = source;
    item.meta = { ...(item.meta || {}), lastVia: meta?.via || source };

    if (!item.pinned && String(text).length > String(item.text || '').length && String(text).length <= 500) {
      const oldText = item.text;
      const oldHash = item.hash;
      if (oldText && oldHash !== hash && !variants.some(v => v.hash === oldHash)) {
        variants.unshift({ text: oldText, hash: oldHash, source: item.source, createdAt: item.createdAt || now });
        item.variants = variants.slice(0, 5);
      }
      item.text = text;
      item.hash = hash;
    }

    const canonical = [item.text, ...item.variants.map(v => v.text || '')]
      .filter(Boolean)
      .sort((a, b) => String(b).length - String(a).length)[0] || item.text || text;
    item.sig = signature(canonical);
  }

  function getItems(filter = activeFilter, query = activeQuery, limit = null) {
    const q = normalizeText(query);
    let items = [...state.items];

    if (filter && filter !== 'all') {
      items = items.filter(item => item.source === filter || item.kind === filter);
    }

    if (q) {
      items = items.filter(item => itemMatchesQuery(item, q));
    }

    items.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    return limit ? items.slice(0, limit) : items;
  }

  function itemMatchesQuery(item, normalizedQuery) {
    const variantText = Array.isArray(item.variants) ? item.variants.map(v => v.text).join(' ') : '';
    const haystack = normalizeText(item.text + ' ' + variantText + ' ' + item.source + ' ' + item.kind);

    if (haystack.includes(normalizedQuery)) return true;

    const qTokens = tokenSignature(normalizedQuery);
    if (!qTokens.length) return false;

    const itemTokens = new Set(tokenSignature(item.text + ' ' + variantText + ' ' + item.source + ' ' + item.kind));

    return qTokens.every(token => itemTokens.has(token));
  }

  function getQuickItems(query = '', limit = QUICK_LIMIT) {
    const q = normalizeText(query);
    const pool = q ? state.items.filter(item => itemMatchesQuery(item, q)) : [...state.items];
    const scoredRecent = pool
      .sort((a, b) => quickRankScore(b) - quickRankScore(a) || Number(b.createdAt || 0) - Number(a.createdAt || 0));

    if (!settings.quickPinned) return scoredRecent.slice(0, limit);

    const pinned = scoredRecent.filter(item => item.pinned).slice(0, 3);
    const pinnedIds = new Set(pinned.map(item => item.id));
    const recent = scoredRecent
      .filter(item => !pinnedIds.has(item.id))
      .slice(0, Math.max(0, limit - pinned.length));

    return [...pinned, ...recent];
  }

  function quickRankScore(item) {
    const now = Date.now();
    const usedAt = Number(item.usedAt || 0);
    const updatedAt = Number(item.updatedAt || 0);
    const createdAt = Number(item.createdAt || 0);
    const lastTouch = Math.max(usedAt, updatedAt, createdAt);
    const ageMinutes = Math.max(0, (now - lastTouch) / 60000);
    const recency = 1000000 - Math.min(ageMinutes, 60 * 24 * 30);
    const usesBoost = Math.min(Math.max(0, Number(item.uses || 0)), 20) * 360;
    const seenBoost = Math.min(Math.max(0, Number(item.seen || 1) - 1), 20) * 90;
    const pinnedBoost = item.pinned ? 2000 : 0;
    const usedBoost = usedAt ? 720 : 0;
    return recency + pinnedBoost + usedBoost + usesBoost + seenBoost;
  }

  function markItemUsed(item, via = 'unknown') {
    if (!item || !item.id) return;
    const found = state.items.find(x => x.id === item.id);
    if (!found) return;
    found.uses = Math.min(999, Number(found.uses || 0) + 1);
    found.usedAt = Date.now();
    found.lastUsedVia = via;
    saveState();
    renderPanelList();
  }

  function markTextUsed(text, via = 'unknown') {
    const clean = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return null;
    const hash = hashText(clean);
    const kind = classify(clean, 'manual');
    const candidates = state.items.filter(item =>
      item.hash === hash ||
      (item.kind === kind && String(item.text || '').length <= 900 && clean.length <= 900)
    );
    const found = candidates.find(item => {
      const variants = Array.isArray(item.variants) ? item.variants : [];
      return item.hash === hash ||
        variants.some(v => v.hash === hash) ||
        similarityScore(item.text, clean) >= MERGE_SIMILARITY ||
        variants.some(v => similarityScore(v.text, clean) >= MERGE_SIMILARITY);
    });
    if (found) markItemUsed(found, via);
    return found || null;
  }

  function install() {
    if (installed) return;
    installed = true;
    injectStyles();
    installTooltips();
    createPanel();
    patchClipboard();
    bindGlobalEvents();
    settings.panelOpen ? openPanel() : closePanel();
  }


  function patchClipboard() {
    if (patchedClipboard || !navigator.clipboard?.writeText) return;
    try {
      originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function patchedWriteText(text) {
        const p = originalWriteText(text);
        try {
          const active = document.activeElement;
          if (active?.closest?.('[data-private], [data-no-loom]')) return p;
          if (!isLoomInternalCopy(text)) {
            Promise.resolve(p).then(() => {
              record(text, 'copy', { via: 'clipboard.writeText' });
            }).catch(() => {});
          }
        } catch (_) {}
        return p;
      };
      patchedClipboard = true;
    } catch (_) {}
  }

  function bindGlobalEvents() {
    document.addEventListener('focusin', e => {
      if (!isEditable(e.target)) return;
      lastInputEl = e.target;
      if (!isInsidePromptLoom(e.target)) lastExternalInputEl = e.target;
    });

    document.addEventListener('copy', e => {
      if (isInsidePromptLoom(e.target)) return;
      if (e.target?.closest?.('[data-private], [data-no-loom]')) return;
      const sel = String(window.getSelection?.() || '').trim();
      if (sel && !isLoomInternalCopy(sel)) record(sel, 'copy', { via: 'copy-event' });
    });

    document.addEventListener('paste', e => {
      const target = e.target;
      if (target?.closest?.('[data-private], [data-no-loom]')) return;
      if (target?.tagName === 'INPUT') {
        const t = (target.type || 'text').toLowerCase();
        if (t === 'password' || t === 'hidden') return;
        if (target.autocomplete === 'current-password' || target.autocomplete === 'new-password' || target.autocomplete === 'one-time-code') return;
      }
      if (isInsidePromptLoom(target)) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text || isLoomInternalPaste(text)) return;
      setTimeout(() => {
        if (!e.defaultPrevented) record(text, 'paste', { via: 'paste-event' });
      }, 0);
    }, true);

    document.addEventListener('input', e => {
      if (!isEditable(e.target)) return;
      lastInputEl = e.target;
      if (!isInsidePromptLoom(e.target)) lastExternalInputEl = e.target;
      if (!e.isTrusted) return;
      handleBackslashTrigger(e.target);
    }, true);

    document.addEventListener('keydown', handlePaletteKeydown, true);
    document.addEventListener('click', e => {
      if (!palette) return;
      if (Date.now() < paletteOutsideClickBlockedUntil) return;
      if (palette.contains(e.target) || e.target?.closest?.('[data-prompt-loom-trigger]')) return;
      closePalette();
    });

    document.addEventListener('mousemove', e => {
      const btn = document.getElementById('prompt-loom-toggle');
      if (!btn || document.body.classList.contains('prompt-loom-open')) return;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      btn.classList.toggle('pl-nearby', dist < 150);
    }, { passive: true });

    document.addEventListener('mouseover', e => {
      if (!settings.hoverOpen || toggleDragActive) return;
      const btn = e.target?.closest?.('#prompt-loom-toggle');
      if (!btn || document.body.classList.contains('prompt-loom-open')) return;
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = setTimeout(() => openPanel(true), 300);
    });
    document.addEventListener('mouseout', e => {
      const btn = e.target?.closest?.('#prompt-loom-toggle');
      if (btn) clearTimeout(hoverOpenTimer);
    });
    document.addEventListener('contextmenu', e => {
      if (!document.body.classList.contains('prompt-loom-open')) return;
      if (isInsidePromptLoom(e.target)) return;
      e.preventDefault();
      closePanel(true);
    });
  }

  function createPanel() {
    if (panel) return;

    const toggle = document.createElement('button');
    toggle.id = 'prompt-loom-toggle';
    toggle.type = 'button';
    toggle.title = 'Prompt Loom: история copy/paste';
    toggle.setAttribute('aria-label', 'Открыть Prompt Loom');
    toggle.innerHTML = iconLoom();

    if (settings.toggleTop != null) {
      toggle.style.top = settings.toggleTop + 'px';
      toggle.style.setProperty('--pl-toggle-top', settings.toggleTop + 'px');
    }

    let dragOccurred = false;
    toggle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const startY = e.clientY;
      const startTop = parseFloat(toggle.style.top) || (window.innerHeight / 2 - 18);
      dragOccurred = false;
      toggleDragActive = false;
      const onMove = ev => {
        if (Math.abs(ev.clientY - startY) > 5) {
          dragOccurred = true;
          toggleDragActive = true;
          clearTimeout(hoverOpenTimer);
        }
        if (!dragOccurred) return;
        const newY = Math.max(10, Math.min(window.innerHeight - 46, startTop + (ev.clientY - startY)));
        toggle.style.top = newY + 'px';
        toggle.style.setProperty('--pl-toggle-top', newY + 'px');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragOccurred) {
          settings.toggleTop = parseFloat(toggle.style.top);
          saveSettings();
          setTimeout(() => { toggleDragActive = false; }, 400);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    toggle.addEventListener('click', e => {
      if (dragOccurred) { dragOccurred = false; return; }
      settings.panelOpen ? closePanel(true) : openPanel(true);
    });
    document.body.appendChild(toggle);

    const hoverCb = document.getElementById('pl-hover-open');
    if (hoverCb) {
      hoverCb.checked = settings.hoverOpen;
      hoverCb.addEventListener('change', () => {
        settings.hoverOpen = hoverCb.checked;
        saveSettings();
      });
    }

    panel = document.createElement('aside');
    panel.id = 'prompt-loom-panel';
    panel.setAttribute('aria-label', 'Prompt Loom');
    panel.innerHTML = `
      <header class="pl-head">
        <div class="pl-title"><span class="pl-mark">⌁</span><span>Loom</span></div>
        <div class="pl-tools" aria-label="Настройки истории">
          <button type="button" data-pl-toggle="enabled" title="Пауза записи" aria-label="Пауза записи">${iconPause()}</button>
          <button type="button" data-pl-toggle="skipLLM" title="Не сохранять LLM" aria-label="Не сохранять LLM">${iconSpark()}</button>
          <button type="button" data-pl-toggle="skipCode" title="Не сохранять код" aria-label="Не сохранять код">${iconCode()}</button>
          <button type="button" data-pl-compact title="Компактный режим" aria-label="Компактный режим">${iconCollapse()}</button>
          <button type="button" data-pl-ultra title="Ultra Light режим" aria-label="Ultra Light режим">${iconUltraLight()}</button>
          <button type="button" data-pl-quick-pinned title="Закреплённые в быстром меню" aria-label="Закреплённые в быстром меню">${iconPin()}</button>
          <button type="button" data-pl-max title="Лимит длины" aria-label="Лимит длины">${iconRuler()}</button>
          <button type="button" data-pl-clear title="Очистить историю" aria-label="Очистить историю">${iconTrash()}</button>
          <button type="button" data-pl-close title="Закрыть" aria-label="Закрыть">${iconX()}</button>
        </div>
      </header>
      <div class="pl-search-row">
        <input class="pl-search" type="search" placeholder="поиск…" autocomplete="off" aria-label="Поиск по истории">
      </div>
      <nav class="pl-filters" aria-label="Фильтры Prompt Loom"></nav>
      <div class="pl-list" role="list"></div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('[data-pl-close]').addEventListener('click', () => closePanel(true));
    panel.querySelector('[data-pl-clear]').addEventListener('click', handleClearClick);
    panel.querySelector('[data-pl-max]').addEventListener('click', editMaxChars);
    panel.querySelector('[data-pl-compact]').addEventListener('click', toggleCompactPanel);
    panel.querySelector('[data-pl-ultra]').addEventListener('click', toggleUltraLightPanel);
    panel.querySelector('[data-pl-quick-pinned]').addEventListener('click', toggleQuickPinned);
    panel.querySelectorAll('[data-pl-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.plToggle;
        if (key === 'enabled') settings.enabled = !settings.enabled;
        else settings[key] = !settings[key];
        saveSettings();
        syncPanelControls();
      });
    });

    const search = panel.querySelector('.pl-search');
    let searchTimer = null;
    search.addEventListener('input', () => {
      activeQuery = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderPanelList, 120);
    });

    renderFilters();
    syncPanelControls();
    renderPanelList();
  }

  function renderFilters() {
    const filters = [
      ['all', 'Все'],
      ['copy', 'Copy'],
      ['paste', 'Paste'],
      ['llm', 'LLM'],
      ['autopoet', 'Poet'],
      ['code', 'Code'],
      ['snippet', 'Snippet']
    ];
    const wrap = panel?.querySelector('.pl-filters');
    if (!wrap) return;
    wrap.innerHTML = '';
    filters.forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pl-chip' + (activeFilter === key ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        activeFilter = key;
        renderFilters();
        renderPanelList();
      });
      wrap.appendChild(btn);
    });
  }

  function syncPanelControls() {
    if (!panel) return;
    panel.querySelector('[data-pl-toggle="enabled"]')?.classList.toggle('active', !settings.enabled);
    panel.querySelector('[data-pl-toggle="skipLLM"]')?.classList.toggle('active', settings.skipLLM);
    panel.querySelector('[data-pl-toggle="skipCode"]')?.classList.toggle('active', settings.skipCode);
    panel.querySelector('[data-pl-compact]')?.classList.toggle('active', settings.panelCompact);
    panel.querySelector('[data-pl-ultra]')?.classList.toggle('active', settings.panelUltraLight);
    panel.querySelector('[data-pl-quick-pinned]')?.classList.toggle('active', settings.quickPinned);
    const maxBtn = panel.querySelector('[data-pl-max]');
    if (maxBtn) maxBtn.title = 'Лимит длины: ' + settings.maxChars + ' символов';
    panel.classList.toggle('compact', !!settings.panelCompact);
    panel.classList.toggle('ultra-light', !!settings.panelUltraLight);
  }


  function toggleCompactPanel() {
    settings.panelCompact = !settings.panelCompact;
    if (settings.panelCompact) settings.panelUltraLight = false;
    saveSettings();
    syncPanelControls();
    renderPanelList();
  }

  function toggleUltraLightPanel() {
    settings.panelUltraLight = !settings.panelUltraLight;
    if (settings.panelUltraLight) settings.panelCompact = false;
    saveSettings();
    syncPanelControls();
    renderPanelList();
  }

  function toggleQuickPinned() {
    settings.quickPinned = !settings.quickPinned;
    saveSettings();
    syncPanelControls();
    refreshPaletteItems(false);
  }

  function renderPanelList() {
    if (!panel) return;
    if (!document.body.classList.contains('prompt-loom-open')) return;
    const list = panel.querySelector('.pl-list');
    if (!list) return;
    const items = getItems();
    list.innerHTML = '';

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'pl-empty';
      empty.textContent = activeQuery ? 'Ничего не найдено' : 'История пока пуста';
      list.appendChild(empty);
      return;
    }

    const pinned = items.filter(item => item.pinned);
    const recent = items.filter(item => !item.pinned);

    if (pinned.length) {
      list.appendChild(renderSectionTitle('Закреплено', pinned.length));
      pinned.forEach(item => list.appendChild(renderCard(item)));
      if (recent.length) list.appendChild(renderSectionTitle(activeQuery || activeFilter !== 'all' ? 'Найдено' : 'Недавнее', recent.length));
      recent.forEach(item => list.appendChild(renderCard(item)));
      return;
    }

    items.forEach(item => list.appendChild(renderCard(item)));
  }

  function renderSectionTitle(label, count) {
    const node = document.createElement('div');
    node.className = 'pl-section-title';
    node.innerHTML = `<span>${escapeHtml(label)}</span><b>${count}</b>`;
    return node;
  }

  function renderCard(item) {
    const source = TYPE_META[item.source] || TYPE_META.manual;
    if (settings.panelUltraLight) return renderUltraLightCard(item, source);
    const kind = CLASS_META[item.kind] || CLASS_META.text;
    const card = document.createElement('article');
    card.className = 'pl-card pl-kind-' + item.kind;
    card.style.setProperty('--pl-color', source.color);
    card.setAttribute('role', 'listitem');
    const cardTip = buildItemTitle(item);
    const timeLabel = formatTime(item.updatedAt || item.createdAt);
    const hasMoreSuggestions = Array.isArray(item.variants) && item.variants.length > 0;
    card.innerHTML = `
      <div class="pl-card-top">
        <span class="pl-source"><span class="pl-source-icon">${source.icon}</span><b>${source.label}</b></span>
        <span class="pl-kind" style="--kind-color:${kind.color}">${escapeHtml(kind.label)}</span>
        ${item.seen > 1 ? `<span class="pl-seen" title="Похожее встречалось ${item.seen} раз">≈${item.seen}</span>` : ''}
        ${item.uses ? `<span class="pl-uses" title="Использовано ${item.uses} раз">×${item.uses}</span>` : ''}
        <span class="pl-card-tools">
          <span class="pl-time" title="${escapeHtml(timeLabel)}">${escapeHtml(timeLabel)}</span>
          <button type="button" class="pl-icon-btn ${item.pinned ? 'active' : ''}" data-pl-pin title="${item.pinned ? 'Открепить' : 'Закрепить'}" aria-label="${item.pinned ? 'Открепить' : 'Закрепить'}" aria-pressed="${item.pinned ? 'true' : 'false'}">${iconPin()}</button>
          <button type="button" class="pl-icon-btn" data-pl-delete title="Удалить" aria-label="Удалить">${iconX()}</button>
        </span>
      </div>
      <pre class="pl-preview"></pre>
      <div class="pl-actions">
        <button type="button" data-pl-insert title="Вставить">${iconInsert()}<span>Вставить</span></button>
        <button type="button" data-pl-pretty title="Вставить красиво">${iconWand()}<span>Красиво</span></button>
        <button type="button" data-pl-snippet title="Сделать сниппетом">${iconBolt()}<span>Сниппет</span></button>
        <button type="button" class="pl-icon-btn" data-pl-copy title="Копировать" aria-label="Копировать">${iconCopy()}</button>
        <button type="button" class="pl-icon-btn${hasMoreSuggestions ? ' has-suggestions' : ''}" data-pl-more title="Ещё" aria-label="Ещё">${iconDots()}</button>
      </div>
      <div class="pl-more" hidden>
        <button type="button" data-pl-var>${iconText()}<span>Переменная</span></button>
        <button type="button" data-pl-variants ${Array.isArray(item.variants) && item.variants.length ? '' : 'hidden'}>${iconLayers()}<span>Варианты</span></button>
      </div>
    `;
    if (cardTip) card.querySelector('.pl-source-icon').dataset.plTip = cardTip;
    const preview = card.querySelector('.pl-preview');
    const previewValue = previewLines(item.text, item.kind, 3, 260);
    preview.textContent = previewValue.text;
    preview.classList.toggle('pl-preview-one-line', previewValue.lineCount === 1);
    if (previewValue.clipped) preview.dataset.plTip = item.text;
    bindCardActions(card, item);
    return card;
  }

  function bindCardActions(card, item) {
    card.querySelector('[data-pl-insert]').addEventListener('click', () => insertItem(item, false));
    card.querySelector('[data-pl-pretty]').addEventListener('click', () => insertItem(item, true));
    card.querySelector('[data-pl-snippet]').addEventListener('click', () => createSnippetFromItem(item));
    card.querySelector('[data-pl-var]').addEventListener('click', () => createVariableFromItem(item));
    card.querySelector('[data-pl-copy]').addEventListener('click', () => {
      markInternalCopy(item.text);
      navigator.clipboard?.writeText(item.text).then(() => {
        markItemUsed(item, 'loom-copy');
        toast('Скопировано ✓', 'success');
      }).catch(() => toast('Не удалось скопировать', 'error'));
    });
    card.querySelector('[data-pl-variants]')?.addEventListener('click', () => toggleVariants(card, item));
    card.querySelector('[data-pl-pin]').addEventListener('click', e => {
      item.pinned = !item.pinned;
      saveState();
      const btn = e.currentTarget;
      btn.classList.toggle('active', !!item.pinned);
      btn.setAttribute('aria-pressed', item.pinned ? 'true' : 'false');
      btn.title = item.pinned ? 'Открепить' : 'Закрепить';
      renderPanelList();
    });
    card.querySelector('[data-pl-more]').addEventListener('click', () => {
      const more = card.querySelector('.pl-more');
      more.hidden = !more.hidden;
    });

    const del = card.querySelector('[data-pl-delete]');
    let armed = false;
    let timer = null;
    del.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        del.classList.add('danger-armed');
        timer = setTimeout(() => { armed = false; del.classList.remove('danger-armed'); }, 2200);
        return;
      }
      clearTimeout(timer);
      state.items = state.items.filter(x => x.id !== item.id);
      saveState();
      renderPanelList();
    });
  }

  function renderUltraLightCard(item, source) {
    const card = document.createElement('article');
    card.className = 'pl-card pl-ultra-card pl-kind-' + item.kind;
    card.style.setProperty('--pl-color', source.color);
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');

    const raw = String(item.text || '').replace(/\t/g, '  ').replace(/[ \f\v]+/g, ' ').trim();
    const lines = raw.split('\n');
    const clipped = lines.length > 3;
    const displayText = clipped ? lines.slice(0, 3).join('\n') + '...' : lines.join('\n');
    const textEl = document.createElement('div');
    textEl.className = 'pl-ultra-text';
    textEl.textContent = displayText;
    if (clipped) textEl.dataset.plTip = item.text;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'pl-ultra-copy';
    copyBtn.innerHTML = iconCopy();
    copyBtn.title = 'Копировать';
    copyBtn.setAttribute('aria-label', 'Копировать');

    card.appendChild(textEl);
    card.appendChild(copyBtn);

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      markInternalCopy(item.text);
      navigator.clipboard?.writeText(item.text).then(() => {
        markItemUsed(item, 'loom-copy');
        toast('Скопировано ✓', 'success');
      }).catch(() => toast('Не удалось скопировать', 'error'));
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('.pl-ultra-copy')) return;
      const target = getInsertTarget({ preferExternal: true });
      if (!target) {
        markInternalCopy(item.text);
        navigator.clipboard?.writeText(item.text).then(() => toast('Нет поля — скопировано', 'success'));
        return;
      }
      const snapshot = makeAcceptSnapshot(target, item.text);
      markInternalPaste(item.text);
      const ok = insertIntoEditable(target, item.text, null, null, { smartSpacing: false });
      if (!ok) { toast('Не удалось вставить', 'error'); return; }
      markItemUsed(item, 'loom-insert');
      playAcceptEffect(snapshot, item.text);
    });

    return card;
  }

  function toggleVariants(card, item) {
    const old = card.querySelector('.pl-variants');
    if (old) {
      old.remove();
      return;
    }

    const variants = Array.isArray(item.variants) ? item.variants.slice(0, 5) : [];
    if (!variants.length) return;

    const box = document.createElement('div');
    box.className = 'pl-variants';
    variants.forEach((variant, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = variant.text || '';
      btn.innerHTML = `<b>${idx + 1}</b><span></span>`;
      btn.querySelector('span').textContent = previewText(variant.text, item.kind, 120);
      btn.addEventListener('click', () => {
        const target = getInsertTarget({ preferExternal: true });
        if (!target) { toast('Нет поля для вставки', 'error'); return; }
        const snapshot = makeAcceptSnapshot(target, variant.text);
        const ok = insertIntoEditable(target, variant.text, null, null, { smartSpacing: false });
        if (!ok) { toast('Не удалось вставить', 'error'); return; }
        markItemUsed(item, 'loom-variant');
        playAcceptEffect(snapshot, variant.text);
      });
      box.appendChild(btn);
    });
    card.appendChild(box);
  }

  function handleClearClick(e) {
    const btn = e.currentTarget;
    if (!clearArmed) {
      clearArmed = true;
      btn.classList.add('danger-armed');
      clearTimer = setTimeout(() => {
        clearArmed = false;
        btn.classList.remove('danger-armed');
      }, 2500);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    btn.classList.remove('danger-armed');
    state.items = [];
    saveState();
    renderPanelList();
    toast('История очищена', 'success');
  }

  function editMaxChars() {
    const value = prompt('Не сохранять элементы длиннее N символов:', String(settings.maxChars));
    if (value == null) return;
    const n = Math.max(100, Math.min(300000, parseInt(value, 10) || DEFAULT_SETTINGS.maxChars));
    settings.maxChars = n;
    saveSettings();
    toast('Лимит: ' + n + ' символов', 'success');
    syncPanelControls();
  }


  function openPanel(persist = false) {
    createPanel();
    document.body.classList.add('prompt-loom-open');
    renderPanelList();
    if (persist) {
      settings.panelOpen = true;
      saveSettings();
    }
  }

  function closePanel(persist = false) {
    document.body.classList.remove('prompt-loom-open');
    if (persist) {
      settings.panelOpen = false;
      saveSettings();
    }
  }

  function handleBackslashTrigger(el) {
    if (Date.now() < suppressTriggerUntil) return;
    if (inlineSession?.el && inlineSession.el !== el) closePalette();
    const value = getEditableValue(el);
    const pos = getSelectionStart(el);
    if (pos == null) return;
    const before = value.slice(0, pos);
    const match = before.match(/(^|[\n\s])\\([^\s\n]*)$/);
    if (!match) { closePalette(); return; }

    const query = match[2] || '';
    const start = pos - match[0].length + match[1].length;
    const items = getQuickItems(query, QUICK_LIMIT);
    if (!items.length) { closePalette(); return; }

    const previousPage = inlineSession?.el === el && inlineSession?.query === query && inlineSession?.mode === 'trigger' ? inlineSession.page : 0;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    inlineSession = {
      el,
      mode: 'trigger',
      query,
      start,
      end: pos,
      page: Math.min(previousPage, totalPages - 1),
      items
    };
    paletteWrapHold = '';
    renderPalette();
  }

  function refreshPaletteItems(resetPage = true) {
    if (!inlineSession) return;
    const query = String(inlineSession.query || '').trim();
    inlineSession.items = getQuickItems(query, QUICK_LIMIT);
    if (resetPage) inlineSession.page = 0;
    const totalPages = Math.max(1, Math.ceil(inlineSession.items.length / PAGE_SIZE));
    inlineSession.page = Math.max(0, Math.min(totalPages - 1, inlineSession.page));
    paletteWrapHold = '';
    renderPalette();
  }

  function renderPalette() {
    if (!inlineSession) return;
    if (!palette) {
      palette = document.createElement('div');
      palette.className = 'pl-palette slash-palette';
      palette.setAttribute('role', 'listbox');
      palette.setAttribute('aria-label', 'Последние фрагменты Prompt Loom');
      paletteOutsideClickBlockedUntil = Date.now() + 80;
      document.body.appendChild(palette);
    } else {
      paletteOutsideClickBlockedUntil = Date.now() + 30;
    }

    const totalPages = Math.max(1, Math.ceil(inlineSession.items.length / PAGE_SIZE));
    inlineSession.page = Math.max(0, Math.min(totalPages - 1, inlineSession.page));
    const pageItems = inlineSession.items.slice(inlineSession.page * PAGE_SIZE, inlineSession.page * PAGE_SIZE + PAGE_SIZE);
    const showSearch = inlineSession.mode === 'direct';

    palette.innerHTML = `
      ${showSearch ? '<div class="pl-pal-search-wrap"><input class="pl-pal-search" type="search" placeholder="искать в истории…" autocomplete="off" aria-label="Поиск по истории"></div>' : ''}
      <div class="pl-pal-list"></div>
      <div class="pl-pal-foot">
        <button type="button" data-pl-page="prev" title="Предыдущие" aria-label="Предыдущие">${iconChevronLeft()}</button>
        <span>${getPaletteFootText(totalPages)}</span>
        <button type="button" data-pl-page="next" title="Следующие" aria-label="Следующие">${iconChevronRight()}</button>
      </div>
    `;

    const searchInput = palette.querySelector('.pl-pal-search');
    if (searchInput) {
      searchInput.value = inlineSession.query || '';
      searchInput.addEventListener('input', () => {
        inlineSession.query = searchInput.value;
        refreshPaletteItems(true);
      });
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          palette.querySelector('.pl-pal-item.focused')?.focus?.();
        }
      });
      requestAnimationFrame(() => {
        if (palette && inlineSession?.mode === 'direct') {
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      });
    }

    const list = palette.querySelector('.pl-pal-list');
    if (!pageItems.length) {
      const empty = document.createElement('div');
      empty.className = 'pl-pal-empty';
      empty.textContent = inlineSession.query ? 'ничего не найдено' : 'история пуста';
      list.appendChild(empty);
    }
    pageItems.forEach((item, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pl-pal-item slash-item dropdown-item' + (idx === 0 ? ' focused' : '') + (item.pinned ? ' pinned' : '');
      row.dataset.idx = String(idx);
      row.dataset.hotkey = idx === 9 ? '0' : String(idx + 1);
      row.dataset.itemId = item.id || '';
      row.dataset.type = (item.source === 'llm' || item.source === 'autopoet') ? 'command' : 'snippet';

      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      row.title = item.text || '';

      row.style.setProperty('--pl-color', (TYPE_META[item.source] || TYPE_META.manual).color);
      row.innerHTML = `
        <span class="pl-num">${idx === 9 ? 0 : idx + 1}</span>
        <span class="pl-pal-icon" aria-hidden="true">${(TYPE_META[item.source] || TYPE_META.manual).icon}</span>
        <span class="pl-pal-text"></span>
      `;
      const textEl = row.querySelector('.pl-pal-text');
      const palText = previewText(item.text, item.kind, 72);
      if (inlineSession.query) textEl.innerHTML = highlightQuery(palText, inlineSession.query);
      else textEl.textContent = palText;
      row.addEventListener('mousedown', ev => {
        ev.preventDefault();
        acceptPaletteIndex(idx);
      });
      list.appendChild(row);
    });

    palette.querySelector('[data-pl-page="prev"]').addEventListener('mousedown', e => {
      e.preventDefault();
      inlineSession.page = (inlineSession.page - 1 + totalPages) % totalPages;
      paletteWrapHold = '';
      renderPalette();
    });
    palette.querySelector('[data-pl-page="next"]').addEventListener('mousedown', e => {
      e.preventDefault();
      inlineSession.page = (inlineSession.page + 1) % totalPages;
      paletteWrapHold = '';
      renderPalette();
    });

    positionPalette();
  }

  function getPaletteFootText(totalPages) {
    const left = inlineSession.query
      ? escapeHtml(previewText(inlineSession.query, 'text', 18))
      : settings.quickPinned
        ? 'pin · ' + QUICK_LIMIT
        : String(QUICK_LIMIT);
    return left + ' · ' + (inlineSession.page + 1) + '/' + totalPages;
  }

  function positionPalette() {
    if (!palette || !inlineSession?.el) return;
    if (!document.contains(inlineSession.el)) { closePalette(); return; }
    const r = inlineSession.el.getBoundingClientRect();
    let left = r.left + 12;
    let top = r.top + 36;

    if (inlineSession.mode === 'direct' && inlineSession.anchor) {
      const ar = inlineSession.anchor.getBoundingClientRect();
      left = ar.left;
      top = ar.bottom + 5;
    } else if (inlineSession.el.tagName === 'TEXTAREA' || inlineSession.el.tagName === 'INPUT') {
      const caret = getTextareaCaretPoint(inlineSession.el, inlineSession.end);
      if (caret) {
        left = caret.left;
        top = caret.top + caret.lineHeight + 4;
      } else {
        top = Math.min(r.bottom - 4, r.top + 90);
      }
    }

    requestAnimationFrame(() => {
      if (!palette) return;
      const pr = palette.getBoundingClientRect();
      if (left + pr.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pr.width - 8);
      if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 8);
      palette.style.left = left + 'px';
      palette.style.top = top + 'px';
    });
  }

  function handlePaletteKeydown(e) {
    if (!palette || !inlineSession) return;

    const rows = [...palette.querySelectorAll('.pl-pal-item')];
    if (!rows.length) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
      return;
    }

    const current = Math.max(0, rows.findIndex(x => x.classList.contains('focused')));
    const focus = idx => {
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

    const totalPages = Math.max(1, Math.ceil(inlineSession.items.length / PAGE_SIZE));
    const turnPage = dir => {
      inlineSession.page = (inlineSession.page + dir + totalPages) % totalPages;
      paletteWrapHold = '';
      renderPalette();
    };

    const searchInputActive = document.activeElement === palette.querySelector('.pl-pal-search');
    if (!searchInputActive && /^[0-9]$/.test(e.key)) {
      const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
      if (rows[idx]) {
        e.preventDefault();
        acceptPaletteIndex(idx);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = current === -1 ? 0 : current;
      if (cur >= rows.length - 1) {
        // Поведение как у slash-палитры: удержание не зацикливает, повторный нажим — зацикливает.
        if (e.repeat) { focus(rows.length - 1); paletteWrapHold = 'down'; }
        else if (paletteWrapHold === 'down') { focus(0); paletteWrapHold = ''; }
        else { focus(rows.length - 1); paletteWrapHold = 'down'; }
      } else {
        focus(cur + 1);
        paletteWrapHold = '';
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = current === -1 ? 0 : current;
      if (cur <= 0) {
        // Поведение как у slash-палитры: удержание не зацикливает, повторный нажим — зацикливает.
        if (e.repeat) { focus(0); paletteWrapHold = 'up'; }
        else if (paletteWrapHold === 'up') { focus(rows.length - 1); paletteWrapHold = ''; }
        else { focus(0); paletteWrapHold = 'up'; }
      } else {
        focus(cur - 1);
        paletteWrapHold = '';
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptPaletteIndex(current);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      turnPage(1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      turnPage(-1);
    } else if (e.key === 'Backspace' && inlineSession.mode === 'direct' && !inlineSession.query && document.activeElement?.classList?.contains('pl-pal-search')) {
      e.preventDefault();
      const target = inlineSession.el;
      closePalette();
      target?.focus?.();
    } else if (inlineSession.mode === 'direct' && isPlainSearchKey(e)) {
      const searchInput = palette.querySelector('.pl-pal-search');
      if (searchInput && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.setRangeText(e.key, searchInput.selectionStart, searchInput.selectionEnd, 'end');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  }

  function acceptPaletteIndex(idx) {
    const item = inlineSession?.items[inlineSession.page * PAGE_SIZE + idx];
    if (!item) return;
    if (!inlineSession?.el || !document.contains(inlineSession.el)) { closePalette(); return; }

    if (inlineSession.mode === 'trigger') {
      const val = getEditableValue(inlineSession.el);
      const range = val.slice(inlineSession.start, inlineSession.end);
      if (range !== '\\' + inlineSession.query) { closePalette(); return; }
    }

    const target = inlineSession.el;
    const start = inlineSession.start;
    const end = inlineSession.end;
    const snapshot = makeAcceptSnapshot(target, item.text, start);
    markInternalPaste(item.text);
    const ok = insertIntoEditable(target, item.text, start, end, { smartSpacing: false });
    if (!ok) {
      toast('Не удалось вставить', 'error');
      closePalette();
      return;
    }
    markItemUsed(item, 'loom-quick');
    playAcceptEffect(snapshot, item.text);
    closePalette();
  }

  function openQuickFor(el, query = '') {
    const target = isEditable(el) ? el : getInsertTarget();
    if (!target) {
      toast('Нет поля для вставки', 'error');
      return false;
    }

    const pos = getSelectionStart(target);
    if (pos == null) return false;

    const cleanQuery = String(query || '').trim();
    const items = getQuickItems(cleanQuery, QUICK_LIMIT);
    if (!items.length && !cleanQuery) {
      toast('История пуста', 'info');
      return false;
    }

    target.focus();
    paletteWrapHold = '';
    inlineSession = {
      el: target,
      anchor: el?.getBoundingClientRect ? el : null,
      mode: 'direct',
      query: cleanQuery,
      start: pos,
      end: pos,
      page: 0,
      items
    };
    renderPalette();
    return true;
  }

  function closePalette() {
    if (palette) {
      palette.remove();
      palette = null;
    }
    inlineSession = null;
    paletteWrapHold = '';
  }

  function insertItem(item, pretty) {
    const text = pretty ? formatPretty(item) : item.text;
    const target = getInsertTarget({ preferExternal: true });
    if (!target) {
      markInternalCopy(text);
      navigator.clipboard?.writeText(text).then(() => toast('Нет поля — скопировано', 'success'));
      return;
    }
    const insertOptions = pretty ? { smartSpacing: true, blockSpacing: true } : { smartSpacing: false };
    const snapshot = makeAcceptSnapshot(target, text, null, insertOptions);
    markInternalPaste(text);
    const ok = insertIntoEditable(target, text, null, null, insertOptions);
    if (!ok) {
      toast('Не удалось вставить', 'error');
      return;
    }
    markItemUsed(item, pretty ? 'loom-pretty' : 'loom-insert');
    playAcceptEffect(snapshot, text);
  }

  function getInsertTarget(options = {}) {
    const preferExternal = !!options.preferExternal;
    const active = document.activeElement;
    if (!preferExternal && isEditable(active) && !isInsidePromptLoom(active)) return active;
    if (isEditable(lastExternalInputEl) && document.contains(lastExternalInputEl)) return lastExternalInputEl;
    if (isEditable(lastInputEl) && document.contains(lastInputEl) && !isInsidePromptLoom(lastInputEl)) return lastInputEl;
    const focusedBlock = document.querySelector('.block-textarea:focus');
    if (focusedBlock) return focusedBlock;
    if (!preferExternal) return null;
    return [...document.querySelectorAll('.block-textarea')].find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight;
    }) || null;
  }

  function isInsidePromptLoom(el) {
    return !!el?.closest?.('#prompt-loom-panel, #prompt-loom-toggle, .pl-palette, .pl-suggest-toast, .pl-created-toast, .pl-variable-tip');
  }

  function insertIntoEditable(el, text, start = null, end = null, options = {}) {
    if (!isEditable(el)) return false;
    const smartSpacing = options.smartSpacing !== false;
    const blockSpacing = !!options.blockSpacing;
    markInternalPaste(text);
    suppressTriggerUntil = Date.now() + 250;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const s = start == null ? el.selectionStart : start;
      const e = end == null ? el.selectionEnd : end;
      const prefix = smartSpacing && needsSpacingBefore(el.value, s) ? (blockSpacing ? '\n\n' : '\n') : '';
      const suffix = smartSpacing && needsSpacingAfter(el.value, e) ? (blockSpacing ? '\n\n' : '\n') : '';
      el.setRangeText(prefix + text + suffix, s, e, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const value = getEditableValue(el);
    const s = start == null ? getSelectionStart(el) : start;
    const currentEnd = getSelectionEnd(el);
    const e = end == null ? (currentEnd == null ? s : currentEnd) : end;
    if (s == null || e == null || !setContentEditableSelection(el, s, e)) return false;

    const prefix = smartSpacing && needsSpacingBefore(value, s) ? (blockSpacing ? '\n\n' : '\n') : '';
    const suffix = smartSpacing && needsSpacingAfter(value, e) ? (blockSpacing ? '\n\n' : '\n') : '';
    const fullText = prefix + text + suffix;
    let inserted = false;
    if (document.execCommand('insertText', false, fullText)) {
      inserted = true;
    } else {
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(fullText);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
        inserted = true;
      }
    }
    if (!inserted) return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function markInternalPaste(text) {
    internalPasteHash = hashText(String(text || '').trim());
    internalPasteUntil = Date.now() + 900;
  }

  function isLoomInternalPaste(text) {
    return internalPasteHash && Date.now() < internalPasteUntil && hashText(String(text || '').trim()) === internalPasteHash;
  }

  function markInternalCopy(text) {
    internalCopyHash = hashText(String(text || '').trim());
    internalCopyUntil = Date.now() + 900;
  }

  function isLoomInternalCopy(text) {
    return internalCopyHash && Date.now() < internalCopyUntil && hashText(String(text || '').trim()) === internalCopyHash;
  }

  function getTextareaCaretPoint(el, pos) {
    if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return null;
    try {
      const cs = window.getComputedStyle(el);
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.4;

      if (!mirrorEl) {
        mirrorEl = document.createElement('div');
        mirrorEl.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;top:-9999px;left:-9999px;';
        mirrorBefore = document.createElement('span');
        mirrorMarker = document.createElement('span');
        mirrorEl.append(mirrorBefore, mirrorMarker);
        document.body.appendChild(mirrorEl);
      }

      const sameEl = mirrorEl._lastEl === el;
      if (!sameEl) {
        const props = [
          'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
          'lineHeight', 'textTransform', 'textIndent', 'wordBreak', 'overflowWrap', 'tabSize'
        ];
        props.forEach(prop => { mirrorEl.style[prop] = cs[prop]; });
        mirrorEl.style.boxSizing = cs.boxSizing || 'content-box';
        mirrorEl._lastEl = el;
      }

      const bl = parseFloat(cs.borderLeftWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const mirrorWidth = cs.boxSizing === 'border-box'
        ? el.clientWidth + bl + br
        : el.clientWidth - pl - pr;
      mirrorEl.style.width = Math.max(20, mirrorWidth) + 'px';

      mirrorBefore.textContent = String(el.value || '').slice(0, pos);
      mirrorMarker.textContent = String(el.value || '').slice(pos, pos + 1) || '.';

      const elRect = el.getBoundingClientRect();
      const mirrorRect = mirrorEl.getBoundingClientRect();
      const markerRect = mirrorMarker.getBoundingClientRect();
      const left = markerRect.left + (elRect.left - mirrorRect.left) - el.scrollLeft;
      const top = markerRect.top + (elRect.top - mirrorRect.top) - el.scrollTop;
      return { left, top, lineHeight: lh };
    } catch (_) {
      return null;
    }
  }

  function computeInsertPrefix(el, pos, options = {}) {
    if (!isEditable(el) || !options.smartSpacing) return '';
    const value = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : getEditableValue(el);
    if (!needsSpacingBefore(value, pos)) return '';
    return options.blockSpacing ? '\n\n' : '\n';
  }

  function needsSpacingBefore(value, pos) {
    if (!pos) return false;
    return !/\n\s*$/.test(value.slice(0, pos));
  }

  function needsSpacingAfter(value, pos) {
    if (pos >= value.length) return false;
    return !/^\s*\n/.test(value.slice(pos));
  }

  function formatPretty(item) {
    const text = item.text.trim();
    if (item.kind === 'json') return '```json\n' + prettyJson(text) + '\n```';
    if (item.kind === 'code') return '```' + detectLang(text) + '\n' + text + '\n```';
    if (item.kind === 'error') return 'Ошибка:\n\n```text\n' + text + '\n```';
    if (item.kind === 'markdown') return normalizeMarkdown(text);
    if (item.kind === 'instruction') return 'Инструкция:\n' + ensureSentence(text);
    if (item.kind === 'llmAnswer') return 'Вариант ответа:\n' + text;
    if (/^\s*[-*•]\s/m.test(text)) return normalizeMarkdown(text);
    return normalizePlainText(text);
  }

  function prettyJson(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (_) { return text; }
  }

  function normalizePlainText(text) {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeMarkdown(text) {
    return normalizePlainText(text)
      .split('\n')
      .map(line => line.replace(/^\s*[•*]\s+/, '- ').replace(/^\s+-\s+/, '- '))
      .join('\n');
  }

  function ensureSentence(text) {
    const clean = normalizePlainText(text);
    if (!clean || /[.!?…]$/.test(clean)) return clean;
    return clean + '.';
  }

  function detectLang(text) {
    if (/^\s*</.test(text)) return 'html';
    if (/\b(function|const|let|=>|import|export)\b/.test(text)) return 'js';
    if (/\.[\w-]+\s*\{|#[\w-]+\s*\{/.test(text)) return 'css';
    return 'text';
  }

  function createSnippetFromItem(item) {
    const title = suggestSnippetTitle(item.text);
    if (isExistingSnippetValue(item.text)) {
      toast('Такой сниппет уже есть', 'info');
      return;
    }
    if (addSnippet(title, item.text)) {
      record(item.text, 'snippet', { via: 'create-snippet' });
      playSmallAcceptEffect('+' + title);
      showSnippetCreatedToast(title, lastCreatedSnippet);
    } else {
      toast('Не найден блок сниппетов', 'error');
    }
  }

  function createVariableFromItem(item) {
    showVariableTip(item);
  }

  function showVariableTip(item) {
    const anchor = document.activeElement?.closest?.('[data-pl-var]') || panel?.querySelector(`[data-pl-var]`);
    const old = document.querySelector('.pl-variable-tip');
    old?.remove();

    const box = document.createElement('div');
    box.className = 'pl-variable-tip';
    box.innerHTML = `
      <div class="pl-var-title">${iconText()}<span>Создать переменную</span></div>
      <label>Имя</label>
      <input type="text" value="${escapeHtml(suggestVariableName(item))}" autocomplete="off" spellcheck="false">
      <div class="pl-var-preview">{{<span></span>}}</div>
      <div class="pl-var-actions">
        <button type="button" data-cancel>Отмена</button>
        <button type="button" data-create>Создать</button>
      </div>
    `;
    document.body.appendChild(box);

    const input = box.querySelector('input');
    const preview = box.querySelector('.pl-var-preview span');
    const normalize = value => String(value || '').replace(/[{}\s]/g, '').replace(/[^\w]/g, '') || 'value';
    const sync = () => { preview.textContent = normalize(input.value); };
    input.addEventListener('input', sync);
    sync();

    const close = () => box.remove();
    box.querySelector('[data-cancel]').addEventListener('click', close);
    box.querySelector('[data-create]').addEventListener('click', () => {
      if (!window.State?.addBlock) {
        toast('State недоступен', 'error');
        close();
        return;
      }
      const beforeIds = new Set(getActiveBlocks().filter(b => b.type === 'variable').map(b => b.id));
      State.addBlock('variable');
      const block = getActiveBlocks().filter(b => b.type === 'variable').find(b => !beforeIds.has(b.id));
      if (block) {
        State.update(() => {
          block.variableName = normalize(input.value);
          block.variableValue = item.text;
          block.title = '{{' + block.variableName + '}}';
        });
        toast('Переменная создана', 'success');
      }
      close();
    });

    const r = anchor?.getBoundingClientRect?.() || panel?.getBoundingClientRect?.() || { left: window.innerWidth - 340, top: 120, bottom: 120 };
    requestAnimationFrame(() => {
      const br = box.getBoundingClientRect();
      let left = Math.max(8, Math.min(window.innerWidth - br.width - 8, r.left - br.width - 8));
      let top = Math.max(8, Math.min(window.innerHeight - br.height - 8, r.bottom + 6));
      box.style.left = left + 'px';
      box.style.top = top + 'px';
      input.focus();
      input.select();
    });
  }

  function isExistingSnippetValue(value) {
    const needle = normalizeText(value);
    if (!needle) return false;
    if (window.State?.getGlobalSnippets?.().some(item => normalizeText(item?.value || '') === needle)) return true;
    return getAllBlocks().some(block =>
      block.type === 'snippets' &&
      Array.isArray(block.items) &&
      block.items.some(item => normalizeText(item?.value || '') === needle)
    );
  }

  function addSnippet(title, value) {
    const globalSnippet = window.State?.addGlobalSnippet?.(title, value, { via: 'prompt-loom' });
    if (globalSnippet) {
      lastCreatedSnippet = { global: true, snippetId: globalSnippet.id, blockTitle: 'Глобальные сниппеты', title, value };
      window.GistSync?.schedulePush?.();
      return true;
    }

    const activeBlocks = getActiveBlocks();
    const blocks = getAllBlocks();
    let snipBlock = activeBlocks.find(b => b.type === 'snippets') || blocks.find(b => b.type === 'snippets');
    if (!snipBlock && window.State?.addBlock) {
      State.addBlock('snippets');
      snipBlock = getActiveBlocks().find(b => b.type === 'snippets') || getAllBlocks().find(b => b.type === 'snippets');
    }
    if (!snipBlock) return false;

    const snippet = { id: uid(), title, value, enabled: false };
    State.update(() => {
      if (!Array.isArray(snipBlock.items)) snipBlock.items = [];
      snipBlock.items.unshift(snippet);
    });
    lastCreatedSnippet = { blockId: snipBlock.id, blockTitle: snipBlock.title || 'Сниппеты', snippetId: snippet.id, title, value };
    window.GistSync?.schedulePush?.();
    return true;
  }

  function undoLastSnippet() {
    return undoSnippet(lastCreatedSnippet);
  }

  function undoSnippet(created) {
    if (!created) return false;
    if (created.global) {
      const removed = window.State?.removeGlobalSnippet?.(created.snippetId);
      if (removed) window.GistSync?.schedulePush?.();
      return !!removed;
    }

    const block = getAllBlocks().find(b => b.id === created.blockId && b.type === 'snippets');
    if (!block || !Array.isArray(block.items)) return false;
    State.update(() => {
      block.items = block.items.filter(item => item.id !== created.snippetId);
    });
    window.GistSync?.schedulePush?.();
    return true;
  }

  function getActiveBlocks() {
    return window.State?.getActive?.()?.blocks || [];
  }

  function getAllBlocks() {
    const out = [];
    const walk = blocks => (blocks || []).forEach(b => {
      out.push(b);
      if (b.children) walk(b.children);
    });
    window.State?.getAll?.().forEach(tab => walk(tab.blocks));
    return out;
  }

  function maybeSuggestSnippet(item) {
    if (item.kind === 'code' || item.kind === 'error' || item.text.length < 20 || item.text.length > 500) return;
    if (!['instruction', 'text'].includes(item.kind)) return;

    const sig = item.sig;
    if (!sig || isIgnoredSimilar(sig) || isExistingSnippetValue(item.text)) return;

    const now = Date.now();
    if (lastSuggestionKey === sig && now - lastSuggestionAt < SNIPPET_TOAST_COOLDOWN) return;

    const since = now - SNIPPET_DAYS * 86400000;
    const pool = state.items.filter(x =>
      x.id !== item.id &&
      (x.updatedAt || x.createdAt) >= since &&
      ['instruction', 'text'].includes(x.kind) &&
      x.kind !== 'code' &&
      x.kind !== 'error' &&
      x.text.length >= 20 &&
      x.text.length <= 500
    );

    const virtualRepeats = Math.max(1, Number(item.seen || 1));
    const matches = [
      ...Array.from({ length: Math.min(virtualRepeats, SNIPPET_MIN_REPEATS) }, () => item),
      ...pool.filter(x => x.sig === sig || similarityScore(item.text, x.text) >= SNIPPET_SIMILARITY)
    ];
    if (matches.length < SNIPPET_MIN_REPEATS) return;

    lastSuggestionKey = sig;
    lastSuggestionAt = now;
    showSuggestionToast(item, sig);
  }

  function isIgnoredSimilar(sig) {
    return (settings.ignoreSimilar || []).some(saved => saved === sig || similarityScore(saved, sig) >= 0.72);
  }

  function showSuggestionToast(item, sig) {
    document.querySelector('.pl-suggest-toast')?.remove();
    const box = document.createElement('div');
    box.className = 'pl-suggest-toast';
    const title = suggestSnippetTitle(item.text);
    box.innerHTML = `
      <div class="pl-suggest-title">💡 Часто повторяется</div>
      <div class="pl-suggest-text"></div>
      <div class="pl-suggest-question">Сниппет «${escapeHtml(title)}»?</div>
      <div class="pl-suggest-actions">
        <button type="button" data-add>Добавить</button>
        <button type="button" data-ignore>Игнор</button>
        <button type="button" data-never>Больше нет</button>
      </div>
    `;
    box.querySelector('.pl-suggest-text').textContent = previewText(item.text, item.kind, 120);
    document.body.appendChild(box);

    const close = () => box.remove();
    const timer = setTimeout(close, 12000);
    box.querySelector('[data-add]').addEventListener('click', () => {
      clearTimeout(timer);
      if (isExistingSnippetValue(item.text)) {
        close();
        toast('Такой сниппет уже есть', 'info');
        return;
      }
      if (!addSnippet(title, item.text)) {
        close();
        toast('Не найден блок сниппетов', 'error');
        return;
      }
      close();
      playSmallAcceptEffect('+' + title);
      showSnippetCreatedToast(title, lastCreatedSnippet);
    });
    box.querySelector('[data-ignore]').addEventListener('click', () => {
      clearTimeout(timer);
      close();
    });
    box.querySelector('[data-never]').addEventListener('click', () => {
      clearTimeout(timer);
      settings.ignoreSimilar = [...new Set([...(settings.ignoreSimilar || []), sig])].slice(-300);
      saveSettings();
      close();
    });
  }

  function showSnippetCreatedToast(title, created) {
    document.querySelector('.pl-created-toast')?.remove();
    const box = document.createElement('div');
    box.className = 'pl-created-toast';
    box.innerHTML = `
      <div class="pl-created-main">${iconBolt()}<span>Сниппет создан</span></div>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(created?.blockTitle || 'Сниппеты')}</small>
      <div class="pl-created-actions">
        <button type="button" data-open>Открыть</button>
        <button type="button" data-undo>Отменить</button>
      </div>
    `;
    document.body.appendChild(box);
    const close = () => box.remove();
    const timer = setTimeout(close, 7000);

    box.querySelector('[data-open]').addEventListener('click', () => {
      clearTimeout(timer);
      openPanel(true);
      close();
    });
    box.querySelector('[data-undo]').addEventListener('click', () => {
      clearTimeout(timer);
      if (undoSnippet(created)) toast('Сниппет удалён', 'success');
      else toast('Не удалось отменить создание сниппета', 'error');
      close();
    });
  }

  function suggestSnippetTitle(text) {
    const n = normalizeText(text);
    if (/кратк/.test(n) && /пример/.test(n)) return 'Кратко + примеры';
    if (/без воды/.test(n)) return 'Без воды';
    if (/markdown/.test(n)) return 'Markdown формат';
    if (/json/.test(n)) return 'JSON ответ';
    if (/таблиц/.test(n)) return 'Таблица';
    const words = n.split(' ').filter(w => w.length > 3).slice(0, 3);
    return words.length ? words.map(capitalize).join(' ') : 'Новый сниппет';
  }

  function suggestVariableName(item) {
    if (item.kind === 'code') return 'codeFragment';
    if (item.kind === 'error') return 'errorText';
    if (item.kind === 'instruction') return 'instruction';
    return 'value';
  }

  function makeAcceptSnapshot(el, text, pos = null, options = {}) {
    if (!isEditable(el) || !String(text || '').trim()) return null;
    if (String(text).length > 120 || String(text).includes('\n')) return null;
    const cfg = window.WordDict?.getConfig?.() || {};
    const lay = window.State?.getLayout?.() || {};
    if (cfg.acceptEffect === false || lay.wcAcceptEffect === false) return null;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;

    const cs = window.getComputedStyle(el);
    const index = pos == null ? getSelectionStart(el) : pos;
    const prefix = computeInsertPrefix(el, index || 0, options);
    const effectPos = (index || 0) + prefix.length;
    const point = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? getTextareaCaretPoint(el, effectPos) : null;
    const r = el.getBoundingClientRect();
    const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.4;
    return {
      ta: el,
      left: point?.left ?? (r.left + 12),
      insertLeft: point?.left ?? (r.left + 12),
      top: point?.top ?? (r.top + 10),
      maxWidth: Math.max(80, r.right - (point?.left ?? r.left) - 12) + 'px',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight || lineHeight + 'px',
      letterSpacing: cs.letterSpacing
    };
  }

  function playAcceptEffect(snapshot, text) {
    if (!snapshot || !window.WordAcceptEffect?.play) return;
    const clean = String(text || '').replace(/\s+$/u, '');
    if (!clean || clean.length > 120 || /\n/.test(clean)) return;
    const cfg = window.WordDict?.getConfig?.() || {};
    window.WordAcceptEffect.play(snapshot, clean, cfg);
  }

  function playSmallAcceptEffect(text) {
    const target = getInsertTarget({ preferExternal: true });
    const snapshot = makeAcceptSnapshot(target, text);
    if (snapshot) playAcceptEffect(snapshot, text);
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel'].includes(type) && !el.disabled && !el.readOnly;
    }
    return false;
  }

  function getEditableValue(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.textContent || '';
  }

  function getSelectionStart(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.selectionStart;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !selectionBelongsTo(el, sel)) return null;
    const range = sel.getRangeAt(0);
    return getContentEditableOffset(el, range.startContainer, range.startOffset);
  }

  function getSelectionEnd(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.selectionEnd;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !selectionBelongsTo(el, sel)) return null;
    const range = sel.getRangeAt(0);
    return getContentEditableOffset(el, range.endContainer, range.endOffset);
  }

  function selectionBelongsTo(el, sel) {
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    return !!el && !!anchor && !!focus && (el === anchor || el.contains(anchor)) && (el === focus || el.contains(focus));
  }

  function getContentEditableOffset(root, container, offset) {
    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(container, offset);
      return range.toString().length;
    } catch (_) {
      return null;
    }
  }

  function setContentEditableSelection(root, start, end = start) {
    const startPoint = getContentEditablePoint(root, start);
    const endPoint = getContentEditablePoint(root, end);
    if (!startPoint || !endPoint) return false;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function getContentEditablePoint(root, offset) {
    const targetOffset = Math.max(0, Number(offset || 0));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let seen = 0;

    while (node) {
      const len = node.nodeValue.length;
      if (seen + len >= targetOffset) return { node, offset: targetOffset - seen };
      seen += len;
      node = walker.nextNode();
    }

    if (root.lastChild) return { node: root, offset: root.childNodes.length };
    root.appendChild(document.createTextNode(''));
    return { node: root.firstChild, offset: 0 };
  }

  function buildItemTitle(item) {
    const meta = item?.meta || {};
    const parts = [];
    if (meta.via) parts.push('Добавлено: ' + describeLoomSource(meta.via));
    if (meta.lastVia && meta.lastVia !== meta.via) parts.push('Последнее обновление: ' + describeLoomSource(meta.lastVia));
    if (item?.lastUsedVia) parts.push('Использовано: ' + describeLoomSource(item.lastUsedVia));
    if (meta.featureKey) parts.push('Функция: ' + meta.featureKey);
    if (meta.mode) parts.push('Режим: ' + meta.mode);
    if (meta.blockId) parts.push('Блок: ' + meta.blockId);
    if (meta.prompt) parts.push('Промпт: ' + previewText(meta.prompt, 'text', 120));
    return parts.length ? parts.join('\n') : '';
  }

  function describeLoomSource(value) {
    const map = {
      'clipboard.writeText': 'копирование через приложение',
      'copy-event': 'копирование пользователем',
      'paste-event': 'вставка пользователем',
      'block-copy': 'копирование блока',
      'loom-copy': 'скопировано из Loom',
      'loom-insert': 'вставлено из Loom',
      'loom-pretty': 'вставлено красиво из Loom',
      'loom-quick': 'быстрая вставка из Loom',
      'loom-variant': 'выбран вариант из Loom'
    };
    return map[value] || String(value || '').replace(/[-_.]/g, ' ');
  }

  function previewText(text, kind, max) {
    const compact = String(text || '').replace(/\t/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
    const single = kind === 'code' || kind === 'json' ? compact : compact.replace(/\s+/g, ' ');
    return single.length > max ? single.slice(0, max - 1) + '…' : single;
  }

  function previewLines(text, kind, maxLines = 3, maxChars = 260) {
    const compact = String(text || '').replace(/\t/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
    const source = kind === 'code' || kind === 'json' ? compact : compact.replace(/[ \t]+/g, ' ');
    const lines = source.split('\n');
    const clippedByLines = lines.length > maxLines;
    let out = lines.slice(0, maxLines).join('\n');
    const clippedByChars = out.length > maxChars;
    if (clippedByChars) out = out.slice(0, Math.max(1, maxChars - 3)).trimEnd();
    const clipped = clippedByLines || clippedByChars;
    return {
      text: clipped ? out.replace(/\s+$/g, '') + '...' : out,
      clipped,
      lineCount: Math.max(1, out.split('\n').length)
    };
  }

  function highlightQuery(text, query) {
    const source = String(text || '');
    const q = normalizeText(query);
    if (!q) return escapeHtml(source);
    const words = q.split(' ').filter(Boolean).slice(0, 4).map(escapeRegExp);
    if (!words.length) return escapeHtml(source);
    const re = new RegExp('(' + words.join('|') + ')', 'ig');
    return source.replace(re, '\u0000$1\u0001').split(/(\u0000[^\u0001]+\u0001)/).map(part => {
      if (part.startsWith('\u0000') && part.endsWith('\u0001')) {
        return '<mark>' + escapeHtml(part.slice(1, -1)) + '</mark>';
      }
      return escapeHtml(part);
    }).join('');
  }

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isPlainSearchKey(e) {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }

  function formatTime(ts) {
    if (!ts || ts > Date.now()) return 'только что';
    const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return sec + 'с';
    const min = Math.round(sec / 60);
    if (min < 60) return min + 'м';
    const h = Math.round(min / 60);
    if (h < 24) return h + 'ч';
    return Math.round(h / 24) + 'д';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function debugSkip(reason, text, source, kind) {
    if (localStorage.getItem('promptLoom.debug') !== '1') return;
    console.debug('[PromptLoom] skipped:', reason, {
      source,
      kind,
      length: String(text || '').length,
      preview: previewText(text, kind || 'text', 80)
    });
  }

  function toast(message, type) {
    if (window.Toast?.show) window.Toast.show(message, type);
    else console.log('[PromptLoom]', message);
  }

  function installTooltips() {
    if (document.getElementById('pl-smart-tooltip')) return;
    const tip = document.createElement('div');
    tip.id = 'pl-smart-tooltip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let active = null;
    let showTimer = null;

    const hide = () => {
      clearTimeout(showTimer);
      active = null;
      tip.classList.remove('show');
    };

    const show = el => {
      const text = String(el?.dataset?.plTip || '').trim();
      if (!text) return hide();
      active = el;
      tip.textContent = text.length > 2000 ? text.slice(0, 2000) + '…' : text;
      const r = el.getBoundingClientRect();
      requestAnimationFrame(() => {
        const tr = tip.getBoundingClientRect();
        let left = Math.min(window.innerWidth - tr.width - 8, Math.max(8, r.left + r.width / 2 - tr.width / 2));
        let top = r.top - tr.height - 7;
        if (top < 8) top = r.bottom + 7;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        tip.classList.add('show');
      });
    };

    document.addEventListener('pointerover', e => {
      const el = e.target?.closest?.('[data-pl-tip]');
      if (!el || !isInsidePromptLoom(el)) return;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => show(el), 260);
    }, true);

    document.addEventListener('pointerout', e => {
      clearTimeout(showTimer);
      if (active && !e.relatedTarget?.closest?.('[data-pl-tip]')) hide();
    }, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
  }

  function injectStyles() {
    if (document.getElementById('prompt-loom-styles')) return;
    const style = document.createElement('style');
    style.id = 'prompt-loom-styles';
    style.textContent = `
      :root { --z-prompt-loom: 930; --z-prompt-loom-palette: 1200; }
      #prompt-loom-toggle {
        position: fixed; right: 0; top: var(--pl-toggle-top, 50%); z-index: var(--z-prompt-loom);
        width: 30px; height: 36px; border-radius: 10px 0 0 10px;
        border: 1px solid var(--border2); border-right: 0;
        color: var(--text1); background: rgba(30,42,58,.86); backdrop-filter: blur(14px);
        cursor: pointer; display: grid; place-items: center;
        box-shadow: var(--shadow-md);
        opacity: 0; transform: translateX(100%);
        transition: opacity .3s ease, transform .3s ease, color var(--trans), background var(--trans);
        pointer-events: none;
      }
      #prompt-loom-toggle.pl-nearby { opacity: 1; transform: translateX(0); pointer-events: auto; }
      #prompt-loom-toggle.pl-nearby:hover { color: var(--text0); background: rgba(79,142,247,.18); }
      #prompt-loom-toggle svg { width: 16px; height: 16px; }
      #prompt-loom-panel {
        position: fixed; top: 84px; right: 10px; bottom: 12px; z-index: var(--z-prompt-loom);
        width: min(390px, calc(100vw - 20px)); display: flex; flex-direction: column; gap: 8px;
        padding: 10px; border: 1px solid var(--border2); border-radius: var(--radius-lg);
        background: rgba(19,25,31,.92); backdrop-filter: blur(18px); box-shadow: var(--shadow-lg);
        transform: translateX(calc(100% + 18px)); opacity: 0; pointer-events: none;
        transition: transform .22s cubic-bezier(.16,1,.3,1), opacity .18s ease;
      }
      .prompt-loom-open #prompt-loom-panel { transform: none; opacity: 1; pointer-events: auto; }
      .prompt-loom-open #prompt-loom-toggle { opacity: 0; pointer-events: none; }
      .pl-head, .pl-card-top, .pl-actions, .pl-tools, .pl-filters, .pl-pal-head, .pl-pal-foot, .pl-suggest-actions { display: flex; align-items: center; gap: 6px; }
      .pl-head { justify-content: space-between; }
      .pl-title { display: flex; align-items: center; gap: 7px; font-weight: 700; letter-spacing: .02em; color: var(--text0); }
      .pl-mark { color: var(--accent); font-size: 18px; }
      .pl-tools button, .pl-icon-btn, .pl-pal-foot button {
        width: 28px; height: 28px; display: inline-grid; place-items: center; border-radius: 8px;
        border: 1px solid var(--border); background: var(--surface); color: var(--text2); cursor: pointer;
        transition: background var(--trans), color var(--trans), border-color var(--trans), box-shadow var(--trans);
      }
      .pl-tools button:hover, .pl-icon-btn:hover, .pl-pal-foot button:hover { color: var(--text0); background: var(--surface2); border-color: var(--border2); }
      .pl-tools button.active, .pl-icon-btn.active { color: #fbbf24; background: rgba(251,191,36,.13); border-color: rgba(251,191,36,.38); box-shadow: 0 0 0 1px rgba(251,191,36,.14) inset, 0 0 12px rgba(251,191,36,.08); }
      .pl-tools button.danger-armed, .pl-icon-btn.danger-armed, .pl-more button.danger-armed { color: #fff; background: rgba(239,68,68,.32); border-color: rgba(239,68,68,.72); }
      .pl-tools svg, .pl-icon-btn svg, .pl-pal-foot svg, .pl-source svg, .pl-more svg, .pl-variants svg { width: 15px; height: 15px; stroke: currentColor; fill: none; }
      .pl-source-icon { display: inline-flex; align-items: center; justify-content: center; }
      .pl-search-row { display: flex; }
      .pl-search { width: 100%; min-height: 32px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg0); color: var(--text0); padding: 6px 10px; outline: none; font: inherit; }
      .pl-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-glow2); }
      .pl-filters { flex-wrap: wrap; }
      .pl-chip { border: 1px solid var(--border); background: var(--surface); color: var(--text2); border-radius: 999px; padding: 4px 9px; font-size: 11px; cursor: pointer; transition: var(--trans); }
      .pl-chip:hover, .pl-chip.active { color: var(--text0); background: rgba(79,142,247,.16); border-color: rgba(79,142,247,.42); }
      .pl-list { overflow: auto; display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; padding-right: 2px; }
      .pl-empty { color: var(--text3); text-align: center; padding: 28px 8px; }
      .pl-section-title { display: flex; align-items: center; gap: 7px; margin: 2px 2px -2px; color: var(--text3); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
      .pl-section-title::before, .pl-section-title::after { content: ''; height: 1px; flex: 1; background: var(--border); opacity: .7; }
      .pl-section-title b { color: var(--text2); font-size: 10px; font-weight: 600; }
      .pl-card {
        border: 1px solid var(--border); border-left: 3px solid var(--pl-color); border-radius: 12px;
        background: color-mix(in srgb, var(--pl-color) 8%, transparent); padding: 8px;
        transition: border-color var(--trans), background var(--trans), transform var(--trans-fast);
        flex-shrink: 0;
      }
      .pl-card:hover { border-color: var(--border2); transform: translateY(-1px); }
      .pl-card-top { min-width: 0; }
      .pl-source { display: inline-flex; align-items: center; gap: 5px; color: var(--text1); font-size: 10px; letter-spacing: .05em; }
      .pl-kind { font-size: 10px; color: var(--kind-color); border: 1px solid color-mix(in srgb, var(--kind-color) 40%, transparent); background: color-mix(in srgb, var(--kind-color) 10%, transparent); border-radius: 999px; padding: 1px 6px; }
      .pl-seen, .pl-uses { color: #86efac; border: 1px solid rgba(52,211,153,.22); background: rgba(52,211,153,.08); border-radius: 999px; padding: 1px 5px; font-size: 10px; line-height: 1.3; }
      .pl-seen { margin-left: auto; color: #fde68a; border-color: rgba(251,191,36,.24); background: rgba(251,191,36,.08); }
      .pl-card-tools { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; }
      .pl-time { color: var(--text3); cursor: default; font-size: 10px; }
      .pl-preview { margin: 7px 0; min-height: calc(1.45em * 1); max-height: calc(1.45em * 3); overflow: hidden; white-space: pre-wrap; color: var(--text1); font: 11px/1.45 var(--mono); }
      .pl-kind-instruction .pl-preview, .pl-kind-text .pl-preview, .pl-kind-llmAnswer .pl-preview { font-family: inherit; font-size: 12px; }
      .pl-preview.pl-preview-one-line { font-size: 12px; }
      .pl-kind-instruction .pl-preview.pl-preview-one-line, .pl-kind-text .pl-preview.pl-preview-one-line, .pl-kind-llmAnswer .pl-preview.pl-preview-one-line { font-size: 13px; }
      .pl-actions button:not(.pl-icon-btn) { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.045); color: var(--text1); padding: 4px 8px; font-size: 11px; cursor: pointer; transition: var(--trans); }
      .pl-actions button:not(.pl-icon-btn) span { color: color-mix(in srgb, var(--text2) 70%, transparent); }
      .pl-actions button:not(.pl-icon-btn) svg { width: 13px; height: 13px; stroke: currentColor; fill: none; }
      .pl-actions button:hover { background: var(--surface2); color: var(--text0); border-color: var(--border2); }
      .pl-actions button:not(.pl-icon-btn):hover span { color: var(--text1); }
      .pl-actions .pl-icon-btn { margin-left: auto; }
      .pl-actions .pl-icon-btn + .pl-icon-btn { margin-left: 0; }
      .pl-icon-btn.has-suggestions { color: #d7c47a; border-color: rgba(251,191,36,.28); background: rgba(251,191,36,.1); box-shadow: 0 0 0 1px rgba(251,191,36,.08) inset; }
      .pl-icon-btn.has-suggestions:hover { color: #fde68a; border-color: rgba(251,191,36,.44); background: rgba(251,191,36,.16); }
      .pl-more { margin-top: 6px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
      .pl-more[hidden] { display: none; }
      .pl-more button { display: flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text2); padding: 5px; font-size: 11px; cursor: pointer; }
      .pl-more button[hidden] { display: none; }
      .pl-variants { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
      .pl-variants button { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 6px; width: 100%; border: 1px solid rgba(251,191,36,.18); border-radius: 8px; background: rgba(251,191,36,.06); color: var(--text1); padding: 5px 7px; cursor: pointer; text-align: left; font-size: 11px; }
      .pl-variants button:hover { color: var(--text0); border-color: rgba(251,191,36,.36); background: rgba(251,191,36,.11); }
      .pl-variants b { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 5px; color: #fde68a; background: rgba(251,191,36,.13); font-size: 10px; }
      .pl-variants span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #prompt-loom-panel.compact { width: min(330px, calc(100vw - 20px)); gap: 7px; }
      #prompt-loom-panel.compact .pl-title span:last-child, #prompt-loom-panel.compact .pl-actions button:not(.pl-icon-btn) span, #prompt-loom-panel.compact .pl-more span { display: none; }
      #prompt-loom-panel.compact .pl-card { padding: 7px; border-radius: 11px; }
      #prompt-loom-panel.compact .pl-preview { max-height: calc(1.45em * 3); margin: 5px 0; font-size: 11px; }
      #prompt-loom-panel.compact .pl-preview.pl-preview-one-line { font-size: 12px; }
      #prompt-loom-panel.compact .pl-actions button:not(.pl-icon-btn) { width: 28px; height: 26px; padding: 0; }
      #prompt-loom-panel.compact .pl-more { grid-template-columns: repeat(4, 28px); justify-content: end; }

      #prompt-loom-panel.ultra-light { width: min(140px, calc(100vw - 20px)); gap: 4px; padding: 6px; }
      #prompt-loom-panel.ultra-light .pl-tools button:not([data-pl-ultra]):not([data-pl-close]) { display: none; }
      #prompt-loom-panel.ultra-light .pl-search-row, #prompt-loom-panel.ultra-light .pl-filters, #prompt-loom-panel.ultra-light .pl-title span:last-child { display: none; }
      #prompt-loom-panel.ultra-light .pl-head { justify-content: space-between; }
      #prompt-loom-panel.ultra-light .pl-list { gap: 4px; scrollbar-width: none; }
      #prompt-loom-panel.ultra-light .pl-list::-webkit-scrollbar { display: none; }
      .pl-ultra-card { padding: 4px 5px; border-radius: 6px; cursor: pointer; position: relative; overflow: hidden; min-height: 0; flex-shrink: 0; }
      .pl-ultra-card:hover { transform: none; }
      .pl-ultra-text { font-size: 9.5px; line-height: 1.35; font-family: inherit; color: var(--text1); white-space: pre-wrap; overflow: clip; max-height: calc(1.35em * 3 + 2px); word-break: break-all; overflow-wrap: anywhere; letter-spacing: -0.01em; }
      .pl-ultra-copy { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 4px; border: none; background: rgba(0,0,0,0.45); color: rgba(255,255,255,0.6); cursor: pointer; opacity: 0; transition: opacity 0.12s ease; padding: 0; z-index: 2; }
      .pl-ultra-copy svg { width: 11px; height: 11px; stroke: currentColor; fill: none; }
      .pl-ultra-card:hover .pl-ultra-copy { opacity: 1; }
      .pl-ultra-copy:hover { background: rgba(0,0,0,0.7); color: #fff; }

      .pl-palette.slash-palette {
        z-index: var(--z-prompt-loom-palette);
        width: min(248px, calc(100vw - 16px));
        max-height: min(282px, calc(100vh - 18px));
        overflow: hidden;
        padding: 5px;
        animation: plDrop .12s cubic-bezier(.16,1,.3,1);
      }
      @keyframes plDrop { from { opacity: 0; transform: translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
      .pl-pal-foot { justify-content: space-between; color: var(--text3); font-size: 10px; line-height: 1; padding: 4px 1px 0; }
      .pl-pal-foot button { width: 22px; height: 20px; border-radius: 6px; }
      .pl-pal-search-wrap { padding: 0 0 4px; }
      .pl-pal-search {
        width: 100%; height: 26px; border: 1px solid var(--border); border-radius: 8px;
        background: rgba(0,0,0,.18); color: var(--text0); outline: none; padding: 4px 7px;
        font: 11px/1.2 inherit;
      }
      .pl-pal-search:focus { border-color: rgba(79,142,247,.55); box-shadow: 0 0 0 2px rgba(79,142,247,.14); }
      .pl-pal-list { display: flex; flex-direction: column; gap: 1px; max-height: min(242px, calc(100vh - 58px)); overflow: auto; }
      .pl-pal-list .dropdown-item { flex: 0 0 auto; }
      .pl-pal-empty { padding: 9px 8px; color: var(--text3); font-size: 11px; text-align: center; }
      .pl-pal-item.pl-pal-item.slash-item {
        display: grid; grid-template-columns: 18px 14px minmax(0, 1fr); align-items: center; gap: 5px;
        min-height: 28px; padding: 5px 8px 5px 5px; border-left: 2px solid var(--pl-color); width: 100%;
      }
      .pl-pal-item.pl-pal-item.slash-item.focused {
        background: linear-gradient(90deg, color-mix(in srgb, var(--pl-color) 34%, transparent), rgba(79,142,247,.13));
        border-color: color-mix(in srgb, var(--pl-color) 58%, transparent);
        color: #fff;
      }
      .pl-pal-item.pl-pal-item.slash-item:hover { border-left-color: var(--pl-color); }
      .pl-pal-item.pinned { box-shadow: inset 0 0 0 1px rgba(251,191,36,.12); }
      .pl-pal-item.pinned .pl-num { color: #fde68a; background: rgba(251,191,36,.16); }
      .pl-pal-item.pinned .pl-pal-icon::after { content: ''; position: absolute; right: -2px; top: -2px; width: 4px; height: 4px; border-radius: 50%; background: #fbbf24; box-shadow: 0 0 7px rgba(251,191,36,.9); }
      .pl-num { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 5px; background: rgba(255,255,255,.08); color: var(--text0); font-weight: 700; font-size: 10px; }
      .pl-pal-icon { position: relative; display: grid; place-items: center; width: 14px; height: 14px; color: var(--pl-color); opacity: .9; }
      .pl-pal-icon svg { width: 13px; height: 13px; stroke: currentColor; fill: none; }
      .pl-pal-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 1.35; font-weight: 500; }
      .pl-pal-text mark { color: #d9f99d; background: rgba(132,204,22,.22); border-radius: 4px; padding: 0 2px; }
      .pl-suggest-toast {
        position: fixed; right: 18px; bottom: 18px; z-index: var(--z-toast); width: min(360px, calc(100vw - 36px));
        border: 1px solid rgba(251,191,36,.35); border-radius: 14px; padding: 12px;
        background: rgba(24,30,38,.96); box-shadow: var(--shadow-lg); backdrop-filter: blur(18px); animation: plDrop .16s cubic-bezier(.16,1,.3,1);
      }
      .pl-suggest-title { color: #fbbf24; font-weight: 700; margin-bottom: 5px; }
      .pl-suggest-text { color: var(--text1); font-size: 12px; margin-bottom: 7px; }
      .pl-suggest-question { color: var(--text0); font-size: 12px; margin-bottom: 8px; }
      .pl-suggest-actions button { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text1); padding: 5px 8px; cursor: pointer; font-size: 11px; }
      .pl-suggest-actions button:first-child { color: #fff; background: rgba(79,142,247,.24); border-color: rgba(79,142,247,.44); }
      .pl-created-toast {
        position: fixed; right: 18px; bottom: 18px; z-index: var(--z-toast); width: min(300px, calc(100vw - 36px));
        border: 1px solid rgba(52,211,153,.34); border-radius: 14px; padding: 11px;
        background: rgba(20,29,27,.96); box-shadow: var(--shadow-lg); backdrop-filter: blur(18px); animation: plDrop .16s cubic-bezier(.16,1,.3,1);
      }
      .pl-created-main { display: flex; align-items: center; gap: 7px; color: #86efac; font-size: 12px; margin-bottom: 4px; }
      .pl-created-main svg { width: 15px; height: 15px; stroke: currentColor; fill: none; }
      .pl-created-toast strong { display: block; color: var(--text0); font-size: 13px; margin-bottom: 3px; }
      .pl-created-toast small { display: block; color: var(--text3); font-size: 10px; margin-bottom: 8px; }
      .pl-created-actions { display: flex; gap: 6px; }
      .pl-created-actions button { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text1); padding: 5px 8px; cursor: pointer; font-size: 11px; }
      .pl-created-actions button:hover { color: var(--text0); border-color: var(--border2); background: var(--surface2); }
      #pl-smart-tooltip {
        position: fixed; z-index: calc(var(--z-toast) + 2); max-width: min(280px, calc(100vw - 18px));
        padding: 6px 8px; border: 1px solid rgba(148,163,184,.28); border-radius: 8px;
        background: rgba(14,19,25,.96); color: var(--text1); box-shadow: var(--shadow-md);
        font: 11px/1.35 var(--font); white-space: pre-wrap; pointer-events: none;
        opacity: 0; transform: translateY(3px); transition: opacity .12s ease, transform .12s ease;
      }
      #pl-smart-tooltip.show { opacity: 1; transform: none; }
      .pl-variable-tip {
        position: fixed; z-index: var(--z-toast); width: 250px; padding: 10px;
        border: 1px solid rgba(103,232,249,.28); border-radius: 13px;
        background: rgba(18,26,34,.97); box-shadow: var(--shadow-lg); backdrop-filter: blur(16px);
      }
      .pl-var-title { display: flex; align-items: center; gap: 7px; color: var(--text0); font-weight: 700; font-size: 12px; margin-bottom: 8px; }
      .pl-var-title svg { width: 15px; height: 15px; stroke: currentColor; fill: none; }
      .pl-variable-tip label { display: block; color: var(--text3); font-size: 10px; margin-bottom: 4px; }
      .pl-variable-tip input { width: 100%; border: 1px solid var(--border); border-radius: 9px; background: var(--bg0); color: var(--text0); padding: 6px 8px; outline: none; }
      .pl-variable-tip input:focus { border-color: rgba(103,232,249,.5); box-shadow: 0 0 0 2px rgba(103,232,249,.12); }
      .pl-var-preview { margin: 7px 0 9px; color: #67e8f9; font: 12px/1.3 var(--mono); }
      .pl-var-actions { display: flex; justify-content: flex-end; gap: 6px; }
      .pl-var-actions button { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text1); padding: 5px 8px; cursor: pointer; font-size: 11px; }
      .pl-var-actions [data-create] { color: #fff; border-color: rgba(79,142,247,.44); background: rgba(79,142,247,.22); }
      .pl-matrix-accept {
        position: fixed; z-index: var(--z-toast); max-width: 280px; pointer-events: none;
        color: #86efac; font: 12px/1.35 var(--mono); text-shadow: 0 0 10px rgba(34,197,94,.8);
        opacity: 0; animation: plMatrix 1.8s ease forwards; mix-blend-mode: screen;
      }
      @keyframes plMatrix {
        0% { opacity: 0; filter: blur(3px); transform: translateY(8px); letter-spacing: .22em; }
        24% { opacity: 1; filter: blur(0); transform: none; letter-spacing: .08em; }
        100% { opacity: 0; transform: translateY(-10px); letter-spacing: normal; }
      }
      @media (prefers-reduced-motion: reduce) {
        #prompt-loom-toggle, #prompt-loom-panel, .pl-card, .pl-palette.slash-palette, .pl-suggest-toast, .pl-created-toast, .pl-matrix-accept, #pl-smart-tooltip { animation: none !important; transition: none !important; }
      }
      @media (max-width: 760px) {
        #prompt-loom-panel { top: 58px; right: 6px; bottom: 6px; width: calc(100vw - 12px); }
      }
    `;
    document.head.appendChild(style);
  }

  function iconCopy() { return '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/></svg>'; }
  function iconPaste() { return '<svg viewBox="0 0 16 16"><rect x="4" y="5" width="9" height="10" rx="1.5"/><path d="M6 5V3.5C6 3 6.5 2 8 2s2 1 2 1.5V5"/></svg>'; }
  function iconSpark() { return '<svg viewBox="0 0 16 16"><path d="M8 1.8l.9 2.8 2.8.9-2.8.9L8 9.2l-.9-2.8-2.8-.9 2.8-.9z"/><path d="M12 9l.5 1.5L14 11l-1.5.5L12 13l-.5-1.5L10 11l1.5-.5z"/></svg>'; }
  function iconQuill() { return '<svg viewBox="0 0 16 16"><path d="M13.5 2.5c-3.8.5-7.1 3.2-8.7 7.1L3 14l4.3-1.8c3.9-1.6 6.6-4.9 7.1-8.7z"/><path d="M5.2 10.8L2.8 13.2"/><path d="M8 5.5l2.5 2.5"/></svg>'; }
  function iconBolt() { return '<svg viewBox="0 0 16 16"><path d="M9 1L3.5 8.5H8L7 15l5.5-8H8z"/></svg>'; }
  function iconText() { return '<svg viewBox="0 0 16 16"><path d="M3 4h10M5 4v9M11 4v9M4 13h3M9 13h3"/></svg>'; }
  function iconLoom() { return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5c4 0 8 10 12 10"/><path d="M4 15c4 0 8-10 12-10"/><path d="M5 10h10"/></svg>'; }
  function iconPause() { return '<svg viewBox="0 0 16 16"><path d="M5 3v10M11 3v10"/></svg>'; }
  function iconCode() { return '<svg viewBox="0 0 16 16"><path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"/></svg>'; }
  function iconRuler() { return '<svg viewBox="0 0 16 16"><path d="M2 11l9-9 3 3-9 9H2z"/><path d="M9 4l1 1M7 6l1 1M5 8l1 1"/></svg>'; }
  function iconTrash() { return '<svg viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.5h4V4M5 6v7M8 6v7M11 6v7"/></svg>'; }
  function iconX() { return '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'; }
  function iconPin() { return '<svg viewBox="0 0 16 16"><path d="M6 2h4l-.5 4 2.5 2v1H4V8l2.5-2z"/><path d="M8 9v5"/></svg>'; }
  function iconDots() { return '<svg viewBox="0 0 16 16"><path d="M4 8h.01M8 8h.01M12 8h.01" stroke-width="2.8"/></svg>'; }
  function iconCollapse() { return '<svg viewBox="0 0 16 16"><path d="M6 3H3v3M10 3h3v3M6 13H3v-3M10 13h3v-3"/><path d="M3.5 3.5L7 7M12.5 3.5L9 7M3.5 12.5L7 9M12.5 12.5L9 9"/></svg>'; }
  function iconUltraLight() { return '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5 5h6M5 8h6M5 11h3"/></svg>'; }
  function iconInsert() { return '<svg viewBox="0 0 16 16"><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>'; }
  function iconWand() { return '<svg viewBox="0 0 16 16"><path d="M3 13l8-8"/><path d="M9 3l4 4"/><path d="M3 3h.01M6 2h.01M13 11h.01M11 14h.01" stroke-width="2.2"/></svg>'; }
  function iconChevronLeft() { return '<svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg>'; }
  function iconChevronRight() { return '<svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>'; }
  function iconLayers() { return '<svg viewBox="0 0 16 16"><path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3"/><path d="M2 11l6 3 6-3"/></svg>'; }

  window.PromptLoom = {
    install,
    record,
    open: () => openPanel(true),
    close: () => closePanel(true),
    openQuickFor,
    getItems: () => [...state.items],
    markUsed: markTextUsed,
    clear: () => { state.items = []; saveState(); renderPanelList(); },
    settings: () => ({ ...settings }),
    classify,
    hashText,
    similarityScore,
    tokenSignature,
    getSkipReason: (text, source = 'manual') => {
      const clean = String(text || '').trim();
      return getSkipReason(clean, source, classify(clean, source));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
