// file_name: user-memory.js

/* ============================================================
   UserMemory — локальный профиль поведения для Intelligence Layer
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'llm-pb-user-profile-v1';
  const SCHEMA_VERSION = 1;
  const MAX_RECENT_EVENTS = 120;
  const MAX_STRUCTURES = 20;
  const MAX_MAP_KEYS = 300;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

  function now() { return Date.now(); }

  function safeParse(raw) {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  // Безопасное чтение localStorage (в приватных режимах может бросать)
  function safeStorageGet(key) {
    try { return localStorage.getItem(key); }
    catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }

  function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function calculateSuggestionScore(stats) {
    const total = Math.max(1, stats.shown || 0);
    return clamp01(
      0.5 +
      (stats.accepted || 0) / (total + 2) * 0.45 -
      (stats.dismissed || 0) / (total + 2) * 0.35 -
      (stats.ignored || 0) / (total + 3) * 0.2
    );
  }

  // Безопасный глубокий клон с откатом на пустой объект
  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch (_) {}
      }
      return Array.isArray(value) ? [] : {};
    }
  }

  function safePlainObject(obj, maxKeys) {
    const out = Object.create(null);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    let count = 0;
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (maxKeys && ++count > maxKeys) break;
      out[key] = obj[key];
    }
    return out;
  }

  function pruneObjectKeys(obj, maxKeys) {
    if (!obj || typeof obj !== 'object') return;
    const keys = Object.keys(obj);
    if (keys.length <= maxKeys) return;
    for (let i = 0; i < keys.length - maxKeys; i++) {
      delete obj[keys[i]];
    }
  }

  function createDefaultProfile() {
    const ts = now();
    return {
      schemaVersion: SCHEMA_VERSION,
      userId: 'local-default',
      createdAt: ts,
      updatedAt: ts,

      counters: {
        events: 0,
        sessions: 0,
        acceptedSuggestions: 0,
        dismissedSuggestions: 0,
        ignoredSuggestions: 0
      },

      behavior: {
        actionTransitions: {},
        contextScores: {},
        featureScores: {},
        recentEvents: []
      },

      style: {
        language: { ru: 0, en: 0 },
        format: { markdown: 0, plain: 0, json: 0 },
        verbosity: { short: 0, balanced: 0, detailed: 0 }
      },

      promptPatterns: {
        successfulStructures: [],
        frequentBlockTitles: {},
        frequentSnippetHashes: {}
      },

      personalScores: {
        decisiveness: 0.5,
        chaos: 0.5,
        reuse: 0.5,
        promptDiscipline: 0.5,
        finishing: 0.5
      },

      suggestions: {
        byType: {},
        dismissedUntil: {},
        disabledTypes: {}
      }
    };
  }

  function normalizeProfile(profile) {
    const base = createDefaultProfile();
    const p = profile && typeof profile === 'object' ? profile : {};

    return {
      ...base,
      ...p,
      schemaVersion: SCHEMA_VERSION,
      counters: { ...base.counters, ...(p.counters || {}) },
      behavior: {
        ...base.behavior,
        ...(p.behavior || {}),
        actionTransitions: safePlainObject(p.behavior?.actionTransitions, MAX_MAP_KEYS),
        contextScores: safePlainObject(p.behavior?.contextScores, MAX_MAP_KEYS),
        featureScores: safePlainObject(p.behavior?.featureScores, MAX_MAP_KEYS),
        recentEvents: Array.isArray(p.behavior?.recentEvents)
          ? p.behavior.recentEvents.slice(-MAX_RECENT_EVENTS)
          : []
      },
      style: {
        language: { ...base.style.language, ...(p.style?.language || {}) },
        format: { ...base.style.format, ...(p.style?.format || {}) },
        verbosity: { ...base.style.verbosity, ...(p.style?.verbosity || {}) }
      },
      promptPatterns: {
        successfulStructures: Array.isArray(p.promptPatterns?.successfulStructures)
          ? p.promptPatterns.successfulStructures.slice(-MAX_STRUCTURES)
          : [],
        frequentBlockTitles: safePlainObject(p.promptPatterns?.frequentBlockTitles, MAX_MAP_KEYS),
        frequentSnippetHashes: safePlainObject(p.promptPatterns?.frequentSnippetHashes, MAX_MAP_KEYS)
      },
      personalScores: { ...base.personalScores, ...(p.personalScores || {}) },
      suggestions: {
        byType: safePlainObject(p.suggestions?.byType, MAX_MAP_KEYS),
        dismissedUntil: safePlainObject(p.suggestions?.dismissedUntil, MAX_MAP_KEYS),
        disabledTypes: safePlainObject(p.suggestions?.disabledTypes, MAX_MAP_KEYS)
      }
    };
  }

  let profile = normalizeProfile(safeParse(safeStorageGet(STORAGE_KEY)));
  profile.counters.sessions += 1;
  profile.updatedAt = now();

  let saveTimer = null;

  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  function saveSoon(delay = 300) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      profile.updatedAt = now();
      const payload = JSON.stringify(profile);
      if (!safeStorageSet(STORAGE_KEY, payload)) {
        console.warn('[UserMemory] save skipped: storage unavailable');
      }
    } catch (err) {
      console.warn('[UserMemory] save failed:', err);
    }
  }

  function sanitizeEvent(type, payload = {}) {
    const ts = Number(payload.ts) || now();
    const event = {
      type: String(type || 'unknown'),
      ts,
      tabId: payload.tabId == null ? null : String(payload.tabId).slice(0, 80),
      blockId: payload.blockId == null ? null : String(payload.blockId).slice(0, 80),
      title: String(payload.title || '').slice(0, 80),
      kind: String(payload.kind || '').slice(0, 32),
      chars: Math.max(0, Number(payload.chars) || 0),
      tokens: Math.max(0, Number(payload.tokens) || 0),
      textHash: payload.textHash ? String(payload.textHash).slice(0, 80) : ''
    };

    if (typeof payload.selection === 'boolean') event.selection = payload.selection;
    if (payload.action) event.action = String(payload.action).slice(0, 64);
    if (payload.featureKey) event.featureKey = String(payload.featureKey).slice(0, 64);
    if (payload.message) event.message = String(payload.message).slice(0, 160);
    if (payload.label) event.label = String(payload.label).slice(0, 80);
    if (payload.via) event.via = String(payload.via).slice(0, 64);
    if (payload.role) event.role = String(payload.role).slice(0, 64);
    if (payload.sourceTitle) event.sourceTitle = String(payload.sourceTitle).slice(0, 80);
    if (payload.placementMode) event.placementMode = String(payload.placementMode).slice(0, 64);
    if (Number.isFinite(Number(payload.outputChars))) event.outputChars = Math.max(0, Number(payload.outputChars));
    if (Number.isFinite(Number(payload.inputTokens))) event.inputTokens = Math.max(0, Number(payload.inputTokens));
    if (Number.isFinite(Number(payload.outputTokens))) event.outputTokens = Math.max(0, Number(payload.outputTokens));
    if (Number.isFinite(Number(payload.sectionCount))) event.sectionCount = Math.max(0, Number(payload.sectionCount));

    return event;
  }

  function updateStyleHints(event) {
    if (event.kind === 'markdown') profile.style.format.markdown += 1;
    else if (event.kind === 'json') profile.style.format.json += 1;
    else if (event.kind) profile.style.format.plain += 1;

    const langText = (event.title || '') + ' ' + (event.message || '');
    if (/[а-яё]/i.test(langText)) profile.style.language.ru += 1;
    if (/[a-z]/i.test(langText)) profile.style.language.en += 1;

    if (event.chars > 0) {
      if (event.chars < 600) profile.style.verbosity.short += 1;
      else if (event.chars < 2400) profile.style.verbosity.balanced += 1;
      else profile.style.verbosity.detailed += 1;
    }

    if (event.title) {
      const key = event.title.trim().toLowerCase();
      if (key) {
        profile.promptPatterns.frequentBlockTitles[key] =
          (profile.promptPatterns.frequentBlockTitles[key] || 0) + 1;
        pruneObjectKeys(profile.promptPatterns.frequentBlockTitles, MAX_MAP_KEYS);
      }
    }
  }

  function updateTransitions(event) {
    const prev = getLastEvent();
    if (!prev) return;
    if (prev.type === event.type) {
      const key = event.type + ' -> repeat';
      profile.behavior.actionTransitions[key] = (profile.behavior.actionTransitions[key] || 0) + 1;
      pruneObjectKeys(profile.behavior.actionTransitions, MAX_MAP_KEYS);
      return;
    }
    const key = prev.type + ' -> ' + event.type;
    profile.behavior.actionTransitions[key] = (profile.behavior.actionTransitions[key] || 0) + 1;
    pruneObjectKeys(profile.behavior.actionTransitions, MAX_MAP_KEYS);
  }

  function updatePersonalScores(event) {
    const recent = profile.behavior.recentEvents;
    const edits = recent.filter(e => /block\.edit/.test(e.type)).length;
    const exports = recent.filter(e => /preview\.(copy|download|exportAll)|file\.export/.test(e.type)).length;
    const dismisses = Object.values(profile.suggestions.byType).reduce((sum, s) => sum + (s.dismissed || 0), 0);
    const accepts = Object.values(profile.suggestions.byType).reduce((sum, s) => sum + (s.accepted || 0), 0);

    profile.personalScores.chaos = clamp01(0.35 + Math.min(0.45, edits / 120) + Math.min(0.2, dismisses / 80));
    profile.personalScores.finishing = clamp01(0.35 + Math.min(0.5, exports / 25));
    const total = accepts + dismisses + 1;
    profile.personalScores.decisiveness = clamp01(
      0.45 +
      Math.min(0.35, accepts / total) -
      Math.min(0.15, dismisses / 60)
    );

    // Дисциплина промпта: растёт при экспортах/копировании, мягко падает при множественных правках
    if (event.type === 'preview.copy' || event.type === 'preview.download' || event.type === 'preview.exportAll') {
      profile.personalScores.promptDiscipline = clamp01(profile.personalScores.promptDiscipline + 0.01);
    } else if (event.type && /block\.edit/.test(event.type)) {
      profile.personalScores.promptDiscipline = clamp01(profile.personalScores.promptDiscipline - 0.002);
    }

    // Reuse: основан на доле повторяющихся заголовков/хэшей сниппетов
    const titleCounts = Object.values(profile.promptPatterns.frequentBlockTitles || {});
    const snippetCounts = Object.values(profile.promptPatterns.frequentSnippetHashes || {});
    const all = titleCounts.concat(snippetCounts);
    if (all.length > 0) {
      const repeats = all.reduce((sum, n) => sum + Math.max(0, (Number(n) || 0) - 1), 0);
      const total = all.reduce((sum, n) => sum + (Number(n) || 0), 0);
      profile.personalScores.reuse = clamp01(0.3 + (total > 0 ? repeats / total : 0) * 0.6);
    }
  }

  function recordEvent(type, payload = {}) {
    const event = sanitizeEvent(type, payload);
    updateTransitions(event);
    profile.behavior.recentEvents.push(event);
    if (profile.behavior.recentEvents.length > MAX_RECENT_EVENTS) {
      profile.behavior.recentEvents.splice(0, profile.behavior.recentEvents.length - MAX_RECENT_EVENTS);
    }
    profile.counters.events += 1;
    updateStyleHints(event);
    updatePersonalScores(event);
    saveSoon();
    return event;
  }

  function getLastEvent() {
    const arr = profile.behavior.recentEvents;
    return arr.length ? arr[arr.length - 1] : null;
  }

  function getFeatureStats(type) {
    if (!type) return null;
    return profile.suggestions.byType[String(type)] || null;
  }

  function ensureFeatureStats(type) {
    if (!type) return null;
    const key = String(type);
    if (!profile.suggestions.byType[key]) {
      profile.suggestions.byType[key] = {
        shown: 0, accepted: 0, dismissed: 0, ignored: 0, score: 0.5, lastShownAt: 0
      };
    }
    return profile.suggestions.byType[key];
  }

  function updateFeatureScore(type, outcome, contextKey) {
    // Без типа нечего оценивать — избегаем мусорных ключей вида "undefined"
    if (!type) return null;
    const typeKey = String(type);

    const stats = ensureFeatureStats(typeKey);
    const key = String(outcome || 'shown');
    stats[key] = (stats[key] || 0) + 1;

    if (key === 'shown') stats.lastShownAt = now();
    if (key === 'accepted') profile.counters.acceptedSuggestions += 1;
    if (key === 'dismissed') profile.counters.dismissedSuggestions += 1;
    if (key === 'ignored') profile.counters.ignoredSuggestions += 1;

    stats.score = calculateSuggestionScore(stats);

    if (contextKey) {
      const ctxKey = String(contextKey);
      const ctx = profile.behavior.contextScores[ctxKey] || {
        shown: 0, accepted: 0, dismissed: 0, ignored: 0, score: 0.5
      };
      ctx[key] = (ctx[key] || 0) + 1;
      ctx.score = calculateSuggestionScore(ctx);
      profile.behavior.contextScores[ctxKey] = ctx;
      pruneObjectKeys(profile.behavior.contextScores, MAX_MAP_KEYS);
    }

    // Автоотключение: только когда пользователь реально видел тип хотя бы 3 раза
    // и стабильно отклонял без принятий
    if (stats.shown >= 3 && stats.dismissed >= 3 && stats.accepted === 0) {
      profile.suggestions.disabledTypes[typeKey] = true;
    }

    saveSoon();
    return stats;
  }

  function dismiss(type, ms = 24 * 60 * 60 * 1000) {
    if (!type) return;
    const typeKey = String(type);
    profile.suggestions.dismissedUntil[typeKey] = now() + Math.max(60_000, Number(ms) || 0);
    updateFeatureScore(typeKey, 'dismissed');
  }

  function isSuggestionAllowed(type) {
    if (!type) return false;
    const typeKey = String(type);
    if (profile.suggestions.disabledTypes[typeKey]) return false;
    const until = Number(profile.suggestions.dismissedUntil[typeKey] || 0);
    return !until || until < now();
  }

  function addSuccessfulStructure(structure) {
    if (!structure || typeof structure !== 'object') return;
    profile.promptPatterns.successfulStructures.push({ ...structure, ts: now() });
    if (profile.promptPatterns.successfulStructures.length > MAX_STRUCTURES) {
      profile.promptPatterns.successfulStructures.splice(
        0,
        profile.promptPatterns.successfulStructures.length - MAX_STRUCTURES
      );
    }
    saveSoon();
  }

  function getProfile() {
    return profile;
  }

  function resetSuggestionLearning() {
    profile.suggestions.byType = {};
    profile.suggestions.dismissedUntil = {};
    profile.suggestions.disabledTypes = {};
    profile.behavior.contextScores = {};
    profile.behavior.featureScores = {};
    profile.counters.acceptedSuggestions = 0;
    profile.counters.dismissedSuggestions = 0;
    profile.counters.ignoredSuggestions = 0;
    saveNow();
    return profile;
  }

  function enableSuggestionType(type) {
    if (!type) return profile;
    const typeKey = String(type);
    delete profile.suggestions.disabledTypes[typeKey];
    delete profile.suggestions.dismissedUntil[typeKey];
    const stats = profile.suggestions.byType[typeKey];
    if (stats) {
      stats.dismissed = 0;
      stats.ignored = 0;
    }
    saveSoon();
    return profile;
  }

  function reset() {
    profile = createDefaultProfile();
    saveNow();
    return profile;
  }

  function getDiagnostics() {
    const byType = profile.suggestions.byType || {};
    const disabledTypes = Object.keys(profile.suggestions.disabledTypes || {})
      .filter(type => profile.suggestions.disabledTypes[type]);
    const dismissedNow = Object.entries(profile.suggestions.dismissedUntil || {})
      .filter(([, until]) => Number(until) > now())
      .map(([type, until]) => ({ type, until: Number(until) }));

    return {
      storageKey: STORAGE_KEY,
      schemaVersion: profile.schemaVersion,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      counters: { ...(profile.counters || {}) },
      recentEvents: profile.behavior?.recentEvents?.length || 0,
      successfulStructures: profile.promptPatterns?.successfulStructures?.length || 0,
      suggestionTypes: Object.keys(byType).map(type => ({ type, ...byType[type] })),
      disabledTypes,
      dismissedNow,
      personalScores: { ...(profile.personalScores || {}) },
      style: deepClone(profile.style || {})
    };
  }

  window.UserMemory = {
    STORAGE_KEY,
    getProfile,
    exportData: () => deepClone(profile),
    importData(raw) {
      // Поддерживаем как объект, так и JSON-строку
      const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
      profile = normalizeProfile(parsed);
      profile.updatedAt = now();
      saveNow();
      return profile;
    },
    recordEvent,
    updateFeatureScore,
    getFeatureStats,
    getLastEvent,
    dismiss,
    isSuggestionAllowed,
    addSuccessfulStructure,
    getDiagnostics,
    resetSuggestionLearning,
    enableSuggestionType,
    save: saveNow,
    reset
  };
})();