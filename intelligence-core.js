// intelligence-core.js

/* ============================================================
   IntelligenceCore — события, context snapshot, scoring, prediction
   ============================================================ */
(function () {
  'use strict';

  const SAME_SUGGESTION_COOLDOWN = 10 * 60 * 1000;
  const RENDER_DEBOUNCE = 450;
  const EDIT_SETTLE_MS = 1300;
  const LARGE_CHANGE_CHARS = 900;
  const PROJECT_GRAPH_PRIORITY = {
    'pinned-baseline-compare': 100,
    'named-version-compare': 90,
    'derived-from-version': 80,
    'version-timeline': 70,
    'similar-prompt-found': 60,
    'title-role-gap': 52,
    'often-with-found': 50
  };
  const PROJECT_GRAPH_MENU_ONLY_WHEN_SUPERSEDED = new Set([
    'pinned-baseline-compare',
    'named-version-compare',
    'derived-from-version',
    'version-timeline',
    'similar-prompt-found',
    'title-role-gap',
    'often-with-found'
  ]);

  let initialized = false;
  let lastSuggestions = [];
  let lastMenuSuggestions = [];
  let lastContext = null;
  let lastContextKey = '';
  let refreshTimer = null;
  let lastRefreshAt = 0;
  const editSessions = new Map();
  const MAX_EDIT_SESSIONS = 200;

  function safeCall(fn, fallback = null, label = 'call') {
    try {
      return typeof fn === 'function' ? fn() : fallback;
    } catch (err) {
      console.warn(`[Intelligence] ${label} failed:`, err);
      return fallback;
    }
  }

  function cleanupEditSessions(force = false) {
    const ts = now();
    for (const [key, session] of editSessions) {
      if (force || ts - Number(session?.startedAt || 0) > 5 * 60 * 1000) {
        clearTimeout(session?.timer);
        editSessions.delete(key);
      }
    }
  }

  function now() { return Date.now(); }

  function hashText(text) {
    if (window.PromptLoom?.hashText) return window.PromptLoom.hashText(text);
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function safePreviewText() {
    try { return window.Preview?.getText?.() || ''; } catch (_) { return ''; }
  }

  function estimateTokens(text) {
    return window.QualityDetectors?.estimateTokens?.(text) || Math.ceil(String(text || '').length / 3.5);
  }

  function normalizeSnippetText(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  }

  function makeSnippetTitle(text, fallback = 'Умный сниппет') {
    const clean = normalizeSnippetText(text).replace(/^[-*#>\s]+/, '').trim();
    const first = clean.split(/[\n.!?]/).find(Boolean) || fallback;
    return first.length > 48 ? first.slice(0, 45).trim() + '…' : first;
  }

  function sanitizeUserTitle(value, fallback = '') {
    const clean = String(value || fallback || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.slice(0, 80);
  }

  function isExistingGlobalSnippet(value) {
    const needle = normalizeSnippetText(value).toLowerCase();
    if (!needle) return true;
    return (window.State?.getGlobalSnippets?.() || []).some(item => normalizeSnippetText(item?.value).toLowerCase() === needle);
  }

  function findSnippetCandidate() {
    const recent = window.UserMemory?.getProfile?.()?.behavior?.recentEvents || [];
    let lastSuccess = null;
    for (let i = recent.length - 1; i >= 0 && !lastSuccess; i -= 1) {
      const e = recent[i];
      if (!lastSuccess && e?.type && e?.ts && /preview\.(copy|download|exportAll)|file\.export/.test(e.type)) lastSuccess = e;
    }
    if (!lastSuccess || now() - lastSuccess.ts > 15 * 60 * 1000) return null;

    const existingSnippetSet = new Set(
      (window.State?.getGlobalSnippets?.() || [])
        .map(item => normalizeSnippetText(item?.value).toLowerCase())
        .filter(Boolean)
    );

    const items = window.PromptLoom?.getItems?.() || [];
    const candidates = items
      .map(item => ({
        item,
        text: normalizeSnippetText(item?.text),
        uses: Math.max(0, Number(item?.uses) || 0),
        seen: Math.max(1, Number(item?.seen) || 1),
        updatedAt: Math.max(Number(item?.usedAt) || 0, Number(item?.updatedAt) || 0, Number(item?.createdAt) || 0),
        kind: item?.kind || window.PromptLoom?.classify?.(item?.text) || 'text'
      }))
      .filter(x => x.text.length >= 40 && x.text.length <= 1400)
      .filter(x => !existingSnippetSet.has(x.text.toLowerCase()))
      .filter(x => x.uses >= 2 || x.seen >= 3 || /instruction|markdown|text/.test(x.kind));

    const scoreCandidate = x => x.uses * 5 + x.seen * 2 + (x.updatedAt > lastSuccess.ts - 30 * 60 * 1000 ? 4 : 0);
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return null;
    const confidence = Math.min(0.92, 0.72 + Math.min(best.uses, 5) * 0.04 + Math.min(best.seen, 5) * 0.025);
    if (confidence < 0.78) return null;

    return {
      title: makeSnippetTitle(best.text),
      value: best.text,
      chars: best.text.length,
      kind: best.kind,
      uses: best.uses,
      seen: best.seen,
      textHash: hashText(best.text),
      confidence: Number(confidence.toFixed(2))
    };
  }

  function normalizePayload(type, payload = {}) {
    const tab = window.State?.getActive?.();
    const clean = {
      ...payload,
      type,
      tabId: payload.tabId || tab?.id || null,
      tabName: payload.tabName || tab?.name || '',
      ts: now()
    };
    if (!clean.textHash && typeof clean.text === 'string') clean.textHash = hashText(clean.text);
    delete clean.text;
    return clean;
  }

  function track(type, payload = {}) {
    if (!type) return null;
    let event = null;
    try {
      event = window.UserMemory?.recordEvent?.(type, normalizePayload(type, payload)) || null;
    } catch (err) {
      console.warn('[Intelligence] recordEvent failed:', err);
    }

    if (/preview\.(copy|download|exportAll)|file\.export/.test(type)) {
      try {
        window.ProjectGraph?.captureSnapshot?.(type, { force: true });
      } catch (err) {
        console.warn('[Intelligence] ProjectGraph snapshot failed:', err);
      }
      try {
        rememberSuccessfulStructure(type);
      } catch (err) {
        console.warn('[Intelligence] rememberSuccessfulStructure failed:', err);
      }
    }

    scheduleRefresh(shouldRefreshImmediately(type) ? 60 : RENDER_DEBOUNCE);
    return event;
  }

  function shouldRefreshImmediately(type) {
    return /preview\.(copy|download|exportAll)|block\.paste|llm\.action/.test(type);
  }

  function trackEdit(payload = {}) {
    cleanupEditSessions(false);
    if (editSessions.size > MAX_EDIT_SESSIONS) {
      const oldestKey = editSessions.keys().next().value;
      const oldest = editSessions.get(oldestKey);
      clearTimeout(oldest?.timer);
      editSessions.delete(oldestKey);
    }
    const key = String(payload.blockId || 'active');
    const chars = Math.max(0, Number(payload.chars) || 0);
    let session = editSessions.get(key);

    if (!session) {
      session = { startedAt: now(), lastChars: chars, timer: null, payload: { ...payload } };
      editSessions.set(key, session);
      track('block.edit.started', { ...payload, chars });
    } else if (Math.abs(chars - session.lastChars) >= LARGE_CHANGE_CHARS) {
      track('block.edit.large-change', { ...payload, chars, delta: chars - session.lastChars });
      session.lastChars = chars;
      session.payload = { ...payload };
    } else {
      session.lastChars = chars;
      session.payload = { ...payload };
    }
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      const latest = editSessions.get(key);
      if (!latest) return;
      track('block.edit.settled', {
        ...latest.payload,
        chars: latest.lastChars,
        durationMs: now() - latest.startedAt
      });
      editSessions.delete(key);
    }, EDIT_SETTLE_MS);
  }

  function computeFinality(tab, text, analysis) {
    const recent = window.UserMemory?.getProfile?.()?.behavior?.recentEvents || [];
    const ts = now();
    let lastCopy = null;
    let lastExport = null;
    for (let i = recent.length - 1; i >= 0 && (!lastCopy || !lastExport); i -= 1) {
      const e = recent[i];
      if (!lastCopy && e?.type === 'preview.copy') lastCopy = e;
      if (!lastExport && (e?.type === 'preview.download' || e?.type === 'preview.exportAll' || e?.type === 'file.export')) {
        lastExport = e;
      }
    }
    const editsAfterCopy = lastCopy ? recent.filter(e => e.ts > lastCopy.ts && (e.type === 'block.edit.large-change' || e.type === 'block.paste')).length : null;

    const copySignal = lastCopy && editsAfterCopy !== null && editsAfterCopy === 0 && ts - lastCopy.ts > 25_000 && ts - lastCopy.ts < 12 * 60 * 1000 ? 1 : 0;
    const exportSignal = lastExport && ts - lastExport.ts < 12 * 60 * 1000 ? 1 : 0;
    const stabilitySignal = lastCopy && editsAfterCopy !== null && editsAfterCopy === 0 ? 0.8 : 0.35;
    const structureSignal = analysis?.structure?.disciplineScore || 0;
    const lowConflictSignal = (analysis?.conflicts?.length || analysis?.duplicates?.length || analysis?.placeholders?.length) ? 0.25 : 1;
    const reuseSignal = Math.min(1, (window.UserMemory?.getProfile?.()?.personalScores?.reuse || 0.5));

    const score = copySignal * 0.25
      + exportSignal * 0.20
      + stabilitySignal * 0.20
      + structureSignal * 0.15
      + lowConflictSignal * 0.10
      + reuseSignal * 0.10;

    if (!String(text || '').trim() || !tab) return 0;
    return Number(Math.max(0, Math.min(1, score)).toFixed(2));
  }

  function getContext() {
    const tab = window.State?.getActive?.();
    const text = safePreviewText();
    const textHash = hashText(text);
    const contextKey = `${tab?.id || ''}\x00${textHash}\x00${tab?.blocks?.length || 0}`;

    if (lastContext && lastContextKey === contextKey && now() - lastContext.ts < 1500) {
      return lastContext;
    }

    const analysis = safeCall(() => window.QualityDetectors?.analyzePreview?.(text, tab), null, 'QualityDetectors.analyzePreview');
    const lastEvent = safeCall(() => window.UserMemory?.getLastEvent?.(), null, 'UserMemory.getLastEvent');

    lastContext = {
      ts: now(),
      tabId: tab?.id || null,
      tabName: tab?.name || '',
      blockCount: tab?.blocks?.length || 0,
      previewChars: text.length,
      previewTokens: estimateTokens(text),
      textHash,
      lastEvent,
      finalityScore: computeFinality(tab, text, analysis),
      structureCandidate: safeCall(() => window.QualityDetectors?.findStructureCandidate?.(tab, lastEvent), null, 'findStructureCandidate'),
      snippetCandidate: safeCall(() => findSnippetCandidate(), null, 'findSnippetCandidate'),
      similarPrompt: safeCall(() => window.ProjectGraph?.findSimilarPrompt?.(tab, text, { threshold: 0.72 }), null, 'ProjectGraph.findSimilarPrompt'),
      oftenWith: safeCall(() => window.ProjectGraph?.findOftenWith?.(tab, { minCount: 2, limit: 5 }), null, 'ProjectGraph.findOftenWith'),
      derivedFrom: safeCall(() => window.ProjectGraph?.findDerivedFrom?.(tab, { text, threshold: 0.58, limit: 3 }), null, 'ProjectGraph.findDerivedFrom'),
      versionTimeline: safeCall(() => window.ProjectGraph?.findVersionTimeline?.(tab, { limit: 6 }), null, 'ProjectGraph.findVersionTimeline'),
      namedVersionDrift: safeCall(() => window.ProjectGraph?.findNamedVersionDrift?.(tab, { text, minConfidence: 0.64, limit: 4 }), null, 'ProjectGraph.findNamedVersionDrift'),
      pinnedBaselineDrift: safeCall(() => window.ProjectGraph?.comparePinnedBaselineToCurrent?.(tab, text), null, 'ProjectGraph.comparePinnedBaselineToCurrent'),
      roleGaps: safeCall(() => window.ProjectGraph?.findRoleGaps?.(tab, { minScore: 0.58, limit: 4 }), null, 'ProjectGraph.findRoleGaps'),
      analysis
    };
    lastContextKey = contextKey;

    return lastContext;
  }

  function makeContextKey(ctx, suggestion) {
    const ev = ctx.lastEvent;
    const size = ev?.chars > 2500 ? 'huge' : ev?.chars > 1200 ? 'large' : ev?.chars > 300 ? 'medium' : 'small';
    const kind = ev?.kind || 'any';
    return `${ev?.type || 'none'}:${size}:${kind.split('.')[0]} -> ${suggestion.type}`;
  }

  function stableStringify(value, seen = new WeakSet()) {
    if (value === undefined) return '"__undefined__"';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (seen.has(value)) return '"__cycle__"';
    seen.add(value);
    if (Array.isArray(value)) return '[' + value.map(item => stableStringify(item, seen)).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => {
      return JSON.stringify(key) + ':' + stableStringify(value[key], seen);
    }).join(',') + '}';
  }

  function makePreparedHash(suggestion, ctx) {
    const compact = {
      type: suggestion.type,
      tabId: ctx.tabId || '',
      textHash: ctx.textHash || '',
      action: suggestion.action || {},
      prepared: suggestion.prepared || null
    };
    return hashText(stableStringify(compact)).slice(0, 16);
  }

  function personalizeConfidence(suggestion, ctx, profile) {
    const stats = profile?.suggestions?.byType?.[suggestion.type];
    const featureScore = typeof stats?.score === 'number' ? stats.score : 0.5;
    const contextKey = makeContextKey(ctx, suggestion);
    const ctxScore = profile?.behavior?.contextScores?.[contextKey]?.score;
    const ctxBoost = typeof ctxScore === 'number' ? (ctxScore - 0.5) * 0.24 : 0;
    const featureBoost = (featureScore - 0.5) * 0.18;
    const ignoredPenalty = stats?.ignored >= 5 ? 0.18 : 0;

    return {
      ...suggestion,
      contextKey,
      preparedHash: suggestion.preparedHash || makePreparedHash(suggestion, ctx),
      confidence: Number(Math.max(0, Math.min(0.99, suggestion.confidence + featureBoost + ctxBoost - ignoredPenalty)).toFixed(2))
    };
  }

  function projectGraphPriority(type) {
    return PROJECT_GRAPH_PRIORITY[type] || 0;
  }

  function isProjectGraphSuggestion(type) {
    return projectGraphPriority(type) > 0;
  }

  function hasMeaningfulDiff(prepared = {}, type = '') {
    const drift = prepared.pinnedBaselineDrift || prepared.namedVersionDrift || null;
    const derived = prepared.derivedFrom || null;
    const timeline = prepared.versionTimeline || null;
    const diff = drift?.comparison?.diff || derived?.diff || timeline?.totalDiff || null;

    if (type === 'version-timeline') return (timeline?.versionCount || 0) >= 3 && (timeline?.changedCount || 0) >= 1;
    if (!diff) return type === 'similar-prompt-found' || type === 'often-with-found' || type === 'title-role-gap';

    const titleChanges = (diff.titleDiff?.added?.length || 0) + (diff.titleDiff?.removed?.length || 0);
    const roleChanges = (diff.roleDiff?.added?.length || 0) + (diff.roleDiff?.removed?.length || 0);
    const hashChanges = (diff.hashDiff?.added?.length || 0) + (diff.hashDiff?.removed?.length || 0);
    const tokenDelta = Math.abs(Number(diff.tokensDelta || 0));
    return titleChanges > 0
      || roleChanges > 0
      || hashChanges > 0
      || Math.abs(Number(diff.blockDelta || 0)) > 0
      || tokenDelta >= 180
      || Boolean(diff.titleDiff?.reordered || diff.roleDiff?.reordered);
  }

  function applyProjectGraphPriorityPolicy(suggestions) {
    const items = Array.isArray(suggestions) ? suggestions : [];
    const strongest = items
      .filter(s => isProjectGraphSuggestion(s.type))
      .sort((a, b) => projectGraphPriority(b.type) - projectGraphPriority(a.type))[0] || null;

    return items.map(s => {
      if (!isProjectGraphSuggestion(s.type)) return s;

      const priority = projectGraphPriority(s.type);
      const strongestPriority = strongest ? projectGraphPriority(strongest.type) : priority;
      const superseded = strongest && strongest.type !== s.type && strongestPriority > priority;
      const menuOnly = superseded && PROJECT_GRAPH_MENU_ONLY_WHEN_SUPERSEDED.has(s.type);
      const hidden = superseded && priority <= 60 && strongestPriority >= 90;
      const meaningful = hasMeaningfulDiff(s.prepared, s.type);
      const suggestedConfidence = Number(s.confidence || 0);
      const cappedConfidence = hidden || !meaningful
        ? Math.min(suggestedConfidence, 0.54)
        : menuOnly ? Math.max(0.55, Math.min(suggestedConfidence, 0.69)) : suggestedConfidence;

      return {
        ...s,
        confidence: cappedConfidence,
        hidden: Boolean(s.hidden || hidden || !meaningful),
        menuOnly: Boolean(s.menuOnly || menuOnly),
        priorityGroup: 'project-graph',
        priorityScore: priority,
        supersededBy: superseded ? strongest.type : ''
      };
    });
  }

  function suggestionSortScore(s) {
    const priority = Number(s.priorityScore || 0);
    const confidence = Number(s.confidence || 0);
    const confidenceBucket = Math.floor(confidence * 20) / 20;
    return confidenceBucket + priority / 10000 + confidence / 100;
  }

  function prepareSuggestions(items, profile, ctx) {
    const ts = now();
    const previousSuggestions = [...lastSuggestions, ...lastMenuSuggestions];
    const previousKeys = new Set(previousSuggestions.map(prev =>
      `${prev.type}\x00${prev.contextKey || ''}\x00${prev.preparedHash || ''}`
    ));
    const previousVisibleKeys = new Set(previousSuggestions
      .filter(prev => !prev.menuOnly)
      .map(prev => `${prev.type}\x00${prev.contextKey || ''}\x00${prev.preparedHash || ''}`)
    );
    const personalized = applyProjectGraphPriorityPolicy(items)
      .filter(s => s && s.type && !s.hidden && window.UserMemory?.isSuggestionAllowed?.(s.type) !== false)
      .map(s => personalizeConfidence(s, ctx, profile))
      .map(s => s.menuOnly ? { ...s, confidence: Math.min(Math.max(s.confidence, 0.55), 0.69) } : s);

    let allowed = personalized
      .filter(s => {
        const stats = profile?.suggestions?.byType?.[s.type];
        const key = `${s.type}\x00${s.contextKey || ''}\x00${s.preparedHash || ''}`;
        const isSamePreparedAction = previousKeys.has(key);
        // Не прячем уже показанную подсказку при обычном refresh того же контекста.
        if (!isSamePreparedAction && stats?.lastShownAt && ts - stats.lastShownAt < SAME_SUGGESTION_COOLDOWN) return false;
        return s.confidence >= 0.55;
      })
      .sort((a, b) => suggestionSortScore(b) - suggestionSortScore(a));

    if (!allowed.length) {
      allowed = personalized
        .filter(s => s.confidence >= 0.45)
        .sort((a, b) => suggestionSortScore(b) - suggestionSortScore(a))
        .slice(0, 1)
        .map(s => ({ ...s, menuOnly: true, lowConfidenceFallback: true }));
    }

    allowed = allowed
      // id нужен для идентификации; primary назначается позже отдельно для visible и menu
      .map((s, idx) => ({ ...s, id: s.id || `sug_${s.type}_${ctx.textHash}_${idx}` }));

    const visible = allowed
      .filter(s => {
        if (s.menuOnly) return false;
        const key = `${s.type}\x00${s.contextKey || ''}\x00${s.preparedHash || ''}`;
        const isAlreadyVisible = previousVisibleKeys.has(key);
        if (isAlreadyVisible) return true;
        if (s.confidence >= 0.88) return true;
        if (s.confidence >= 0.72 && !lastSuggestions.length) return true;
        return false;
      })
      .slice(0, 3)
      .map((s, idx) => ({ ...s, primary: idx === 0 }));

    const visibleKeys = new Set(visible.map(s => `${s.type}\x00${s.contextKey || ''}\x00${s.preparedHash || s.id || ''}`));
    const menu = allowed
      .filter(s => !visibleKeys.has(`${s.type}\x00${s.contextKey || ''}\x00${s.preparedHash || s.id || ''}`))
      .slice(0, 8)
      .map(s => ({ ...s, primary: false }));

    return {
      visible,
      menu
    };
  }

  function predict(ctx, profile) {
    const out = [];
    const analysis = ctx.analysis || {};

    if (ctx.structureCandidate?.sections?.length >= 2) {
      out.push({
        type: 'structure-pasted-text',
        label: 'Разбить на блоки',
        reason: `Похоже на сырой контекст · найдено частей: ${ctx.structureCandidate.sections.length}`,
        confidence: Math.min(0.9, 0.76 + ctx.structureCandidate.sections.length * 0.02),
        prepared: { structureCandidate: ctx.structureCandidate },
        action: { kind: 'structure-last-paste' }
      });
    }

    if (ctx.previewTokens > 2000 || ctx.previewChars > 6000) {
      const hasLLM = !!window.LLMFeatures?.handleAction;
      out.push({
        type: 'compress-large-text',
        label: hasLLM ? 'Сжать LLM' : 'Показать тяжёлые блоки',
        reason: `Промпт уже ~${ctx.previewTokens} токенов`,
        confidence: ctx.previewTokens > 3200 ? 0.88 : 0.78,
        prepared: { heavyBlocks: analysis.heavyBlocks || [], estimatedTokens: ctx.previewTokens },
        action: hasLLM ? { kind: 'llm-feature', feature: 'compress' } : { kind: 'open-report', report: 'heavy-blocks' }
      });
    }

    if ((analysis.duplicates || []).length && ctx.previewChars > 1800) {
      out.push({
        type: 'detect-duplicates',
        label: 'Показать повторы',
        reason: `Найдено похожих блоков: ${analysis.duplicates.length}`,
        confidence: Math.min(0.94, 0.82 + analysis.duplicates.length * 0.03),
        prepared: { duplicates: analysis.duplicates },
        action: { kind: 'open-report', report: 'duplicates' }
      });
    }

    if (ctx.snippetCandidate) {
      out.push({
        type: 'extract-snippet',
        label: 'Сохранить сниппет',
        reason: `Эта инструкция часто используется · ${ctx.snippetCandidate.chars} симв`,
        confidence: ctx.snippetCandidate.confidence,
        prepared: { snippetCandidate: ctx.snippetCandidate },
        action: { kind: 'save-snippet' }
      });
    }

    if (ctx.similarPrompt?.snapshot) {
      const snap = ctx.similarPrompt.snapshot;
      out.push({
        type: 'similar-prompt-found',
        label: 'Показать',
        reason: `Похожая структура уже была: «${snap.tabName || 'вкладка'}» · ${Math.round(ctx.similarPrompt.score * 100)}%`,
        confidence: Math.min(0.9, 0.68 + ctx.similarPrompt.score * 0.22),
        prepared: { similarPrompt: ctx.similarPrompt },
        action: { kind: 'open-report', report: 'similar-prompt' }
      });
    }

    if (ctx.oftenWith?.items?.length) {
      const top = ctx.oftenWith.top || ctx.oftenWith.items[0];
      out.push({
        type: 'often-with-found',
        label: 'Посмотреть',
        reason: `С «${top.source?.title || 'этим блоком'}» часто был «${top.companion?.title || 'другой блок'}» · ${top.count}×`,
        confidence: ctx.oftenWith.confidence || 0.66,
        prepared: { oftenWith: ctx.oftenWith },
        action: { kind: 'preview-companion-block' }
      });
    }

    if (ctx.derivedFrom?.from && ctx.derivedFrom?.diff) {
      const from = ctx.derivedFrom.from;
      const diff = ctx.derivedFrom.diff;
      const added = diff.titleDiff?.added?.length || diff.roleDiff?.added?.length || Math.max(0, diff.blockDelta || 0);
      const removed = diff.titleDiff?.removed?.length || diff.roleDiff?.removed?.length || Math.max(0, -(diff.blockDelta || 0));
      const deltaText = added || removed
        ? `${added ? '+' + added : ''}${added && removed ? ' / ' : ''}${removed ? '-' + removed : ''} блоков`
        : diff.tokensDelta ? `${diff.tokensDelta > 0 ? '+' : ''}${diff.tokensDelta} токенов` : 'структура изменилась';
      out.push({
        type: 'derived-from-version',
        label: 'Показать изменения',
        reason: `Похоже на новую версию вкладки «${from.tabName || 'без имени'}» · ${deltaText}`,
        confidence: ctx.derivedFrom.confidence || 0.66,
        prepared: { derivedFrom: ctx.derivedFrom },
        action: { kind: 'open-report', report: 'derived-from' }
      });
    }

    if (ctx.versionTimeline?.versionCount >= 3 && ctx.versionTimeline?.changedCount >= 1) {
      const timeline = ctx.versionTimeline;
      const delta = timeline.totalDiff || {};
      const deltaText = delta.blockDelta
        ? `${delta.blockDelta > 0 ? '+' : ''}${delta.blockDelta} блоков`
        : delta.tokensDelta ? `${delta.tokensDelta > 0 ? '+' : ''}${delta.tokensDelta} токенов` : `${timeline.versionCount} версий`;
      out.push({
        type: 'version-timeline',
        label: 'Показать timeline',
        reason: `История структуры вкладки · ${timeline.versionCount} версий · ${deltaText}`,
        confidence: timeline.confidence || 0.66,
        prepared: { versionTimeline: timeline },
        action: { kind: 'open-report', report: 'version-timeline' }
      });
    }

    if (ctx.pinnedBaselineDrift?.comparison) {
      const drift = ctx.pinnedBaselineDrift;
      const baseline = drift.baseline || {};
      const diff = drift.comparison.diff || {};
      const deltaText = diff.blockDelta
        ? `${diff.blockDelta > 0 ? '+' : ''}${diff.blockDelta} блоков`
        : diff.tokensDelta ? `${diff.tokensDelta > 0 ? '+' : ''}${diff.tokensDelta} токенов` : 'структура изменилась';
      const baselineName = baseline.version?.name || baseline.name || 'Baseline';
      out.push({
        type: 'pinned-baseline-compare',
        label: 'Сравнить baseline',
        reason: `Структура отличается от baseline «${baselineName}» · ${deltaText}`,
        confidence: Math.max(0.76, Math.min(0.92, drift.comparison.confidence || 0.76)),
        prepared: { pinnedBaselineDrift: drift },
        action: { kind: 'open-report', report: 'pinned-baseline-drift' }
      });
    }

    if (ctx.namedVersionDrift?.comparison) {
      const drift = ctx.namedVersionDrift;
      const version = drift.version || drift.comparison.from || {};
      const diff = drift.comparison.diff || {};
      const deltaText = diff.blockDelta
        ? `${diff.blockDelta > 0 ? '+' : ''}${diff.blockDelta} блоков`
        : diff.tokensDelta ? `${diff.tokensDelta > 0 ? '+' : ''}${diff.tokensDelta} токенов` : 'структура изменилась';
      out.push({
        type: 'named-version-compare',
        label: 'Сравнить',
        reason: `Структура изменилась после версии «${version.name || 'именованной версии'}» · ${deltaText}`,
        confidence: drift.confidence || drift.comparison.confidence || 0.66,
        prepared: { namedVersionDrift: drift },
        action: { kind: 'open-report', report: 'named-version-drift' }
      });
    }

    if (ctx.roleGaps?.items?.length) {
      const top = ctx.roleGaps.top || ctx.roleGaps.items[0];
      out.push({
        type: 'title-role-gap',
        label: 'Добавить каркас',
        reason: `В похожих структурах обычно есть блок «${top.label || 'Блок'}»`,
        confidence: ctx.roleGaps.confidence || top.confidence || 0.62,
        prepared: { roleGaps: ctx.roleGaps },
        action: { kind: 'preview-role-gap-block' }
      });
    }

    if (ctx.finalityScore > 0.82 && ctx.blockCount >= 2) {
      out.push({
        type: 'save-as-template',
        label: 'Сохранить шаблон',
        reason: 'Похоже на финальную структуру',
        confidence: Math.min(0.94, ctx.finalityScore + 0.04),
        prepared: { finalityScore: ctx.finalityScore, structure: analysis.structure },
        action: { kind: 'save-template' }
      });
    }

    return prepareSuggestions(out, profile, ctx);
  }

  function refresh() {
    try {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      lastRefreshAt = now();
      const profile = window.UserMemory?.getProfile?.() || null;
      const ctx = getContext();
      if (ctx.previewChars > 0) {
        safeCall(() => window.ProjectGraph?.captureSnapshot?.('intelligence.refresh'), null, 'ProjectGraph.captureSnapshot');
      }
      const prepared = predict(ctx, profile);
      lastSuggestions = prepared.visible || [];
      lastMenuSuggestions = prepared.menu || [];
      window.SmartSuggestions?.render?.(lastSuggestions, ctx);
      window.SmartSuggestions?.updateMenu?.(lastMenuSuggestions, ctx);
    } catch (err) {
      console.error('[Intelligence] refresh failed:', err);
    }
  }

  function scheduleRefresh(delay = RENDER_DEBOUNCE) {
    clearTimeout(refreshTimer);
    const elapsed = now() - lastRefreshAt;
    const minDelay = elapsed < 250 ? 250 - elapsed : 0;
    refreshTimer = setTimeout(refresh, Math.max(delay, minDelay));
  }

  function getSuggestions() {
    return lastSuggestions.map(s => ({ ...s }));
  }

  function getMenuSuggestions() {
    return lastMenuSuggestions.map(s => ({ ...s }));
  }

  function findSuggestion(idOrType) {
    return lastSuggestions.find(s => s.id === idOrType || s.type === idOrType)
      || lastMenuSuggestions.find(s => s.id === idOrType || s.type === idOrType)
      || null;
  }

  function acceptSuggestion(idOrType) {
    const suggestion = findSuggestion(idOrType);
    if (!suggestion) return false;
    const ok = runSuggestionAction(suggestion);
    if (ok) {
      window.UserMemory?.updateFeatureScore?.(suggestion.type, 'accepted', suggestion.contextKey);
      track('suggestion.accepted', { action: suggestion.type });
    } else {
      track('suggestion.failed', { action: suggestion.type });
    }
    return ok;
  }

  function dismissSuggestion(idOrType, temporary = false) {
    const suggestion = findSuggestion(idOrType) || { type: idOrType };
    if (!suggestion.type) return;
    if (temporary) {
      window.UserMemory?.updateFeatureScore?.(suggestion.type, 'ignored', suggestion.contextKey);
    } else {
      window.UserMemory?.dismiss?.(suggestion.type, 24 * 60 * 60 * 1000);
    }
    track(temporary ? 'suggestion.hidden' : 'suggestion.dismissed', { action: suggestion.type });
    const sameSuggestion = s => {
      if (suggestion.id && s.id === suggestion.id) return true;
      if (suggestion.preparedHash) return s.type === suggestion.type && s.preparedHash === suggestion.preparedHash;
      return s.type === suggestion.type;
    };
    lastSuggestions = lastSuggestions.filter(s => !sameSuggestion(s));
    lastMenuSuggestions = lastMenuSuggestions.filter(s => !sameSuggestion(s));
    window.SmartSuggestions?.render?.(lastSuggestions, lastContext);
    window.SmartSuggestions?.updateMenu?.(lastMenuSuggestions, lastContext);
  }

  function renderReportLines(title, subtitle, lines) {
    if (window.SmartSuggestions?.openReport) {
      window.SmartSuggestions.openReport({ title, subtitle, lines });
      return;
    }
    alert([title, subtitle, '', ...(lines || [])].filter(Boolean).join('\n'));
  }

  function openPreparedReport(report, prepared = {}) {
    const reportType = String(report || '').trim();
    if (!reportType) return false;

    return openReport({
      type: reportType,
      prepared: prepared || {},
      action: { kind: 'open-report', report: reportType }
    });
  }

  function openReport(suggestion) {
    const report = suggestion.action?.report;
    if (report === 'duplicates') {
      const pairs = suggestion.prepared?.duplicates || [];
      renderReportLines(
        'Найденные повторы',
        'Это только отчёт: текст блоков не меняется автоматически.',
        pairs.map((p, i) => {
          const aTitle = p?.a?.title || 'Блок A';
          const bTitle = p?.b?.title || 'Блок B';
          const score = Number.isFinite(Number(p?.score)) ? p.score : '—';
          return `${i + 1}. «${aTitle}» ↔ «${bTitle}» · similarity ${score}`;
        })
      );
      return true;
    }
    if (report === 'heavy-blocks') {
      const blocks = suggestion.prepared?.heavyBlocks || [];
      renderReportLines(
        'Тяжёлые блоки',
        `Оценка размера prompt: ~${suggestion.prepared?.estimatedTokens || 0} токенов.`,
        blocks.map((b, i) => `${i + 1}. «${b.title}» · ${b.chars} симв · ~${b.tokens} токенов · ${b.kind}`)
      );
      return true;
    }
    if (report === 'similar-prompt') {
      const match = suggestion.prepared?.similarPrompt;
      const snap = match?.snapshot || {};
      renderReportLines(
        'Похожий prompt уже встречался',
        'Это локальная ProjectGraph-память: текст не хранится, сравниваются fingerprints структуры и блоков.',
        [
          `Вкладка: «${snap.tabName || 'без имени'}»`,
          `Сходство структуры: ${Math.round((match?.score || 0) * 100)}%${match?.roleScore ? ' · роли: ' + Math.round(match.roleScore * 100) + '%' : ''}`,
          `Блоков: ${snap.blockCount || 0} · ~${snap.tokens || 0} токенов · ${snap.chars || 0} симв`,
          `Когда: ${snap.ts ? new Date(snap.ts).toLocaleString() : '—'}`,
          `Структура: ${snap.blockTitles?.join(' → ') || snap.structureSignature || '—'}`
        ]
      );
      return true;
    }
    if (report === 'often-with') {
      const items = suggestion.prepared?.oftenWith?.items || [];
      renderReportLines(
        'Частые связки блоков',
        'ProjectGraph заметил, что эти блоки раньше часто использовались вместе. Текст не вставляется автоматически.',
        items.map((item, i) => {
          const tabs = Object.values(item.companion?.tabs || {}).filter(Boolean).slice(0, 3).join(', ');
          return `${i + 1}. «${item.source?.title || 'Блок'}» обычно рядом с «${item.companion?.title || 'Блок'}» · ${item.count}×${tabs ? ' · вкладки: ' + tabs : ''}`;
        })
      );
      return true;
    }
    if (report === 'version-timeline') {
      const timeline = suggestion.prepared?.versionTimeline || {};
      const snapshots = Array.isArray(timeline.snapshots) ? timeline.snapshots : [];
      const transitions = Array.isArray(timeline.transitions) ? timeline.transitions : [];
      renderReportLines(
        'Timeline версий вкладки',
        'Мини-история структуры без хранения полного текста: только названия, роли, размеры и fingerprints.',
        [
          `Вкладка: «${timeline.tabName || 'без имени'}»`,
          `Версий: ${timeline.versionCount || snapshots.length} · изменений: ${timeline.changedCount || 0}`,
          `Итог: блоков ${timeline.first?.blockCount || 0} → ${timeline.last?.blockCount || 0} (${timeline.totalDiff?.blockDelta > 0 ? '+' : ''}${timeline.totalDiff?.blockDelta || 0})`,
          `Итог: токенов ~${timeline.first?.tokens || 0} → ~${timeline.last?.tokens || 0} (${timeline.totalDiff?.tokensDelta > 0 ? '+' : ''}${timeline.totalDiff?.tokensDelta || 0})`,
          '',
          ...snapshots.map((snapshot, index) => {
            const transition = index > 0 ? transitions[index - 1] : null;
            const diff = transition?.diff || null;
            const marker = diff
              ? ` · ${diff.blockDelta ? (diff.blockDelta > 0 ? '+' : '') + diff.blockDelta + ' блоков' : 'структура'}${diff.tokensDelta ? ' · ' + (diff.tokensDelta > 0 ? '+' : '') + diff.tokensDelta + ' токенов' : ''}`
              : '';
            const name = snapshot.name ? ` · "${snapshot.name}"` : '';
            const source = snapshot.source ? ` · ${snapshot.source}` : '';
            return `${index + 1}. ${snapshot.ts ? new Date(snapshot.ts).toLocaleString() : '—'}${name}${source}${marker}\n   ${snapshot.blockTitles?.join(' → ') || snapshot.structureSignature || '—'}`;
          })
        ]
      );
      track('projectGraph.versionTimeline.report.opened', {
        chars: 0,
        tabId: timeline.tabId || '',
        tabName: timeline.tabName || '',
        sectionCount: snapshots.length
      });
      return true;
    }
    if (report === 'pinned-baseline-drift' || report === 'named-version-drift') {
      const isPinned = report === 'pinned-baseline-drift';
      const drift = isPinned ? (suggestion.prepared?.pinnedBaselineDrift || {}) : (suggestion.prepared?.namedVersionDrift || {});
      const comparison = drift.comparison || {};
      const from = comparison.from || drift.version || {};
      const to = comparison.to || drift.current || {};
      const diff = comparison.diff || {};
      const roleAdded = (diff.roleDiff?.added || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
      const roleRemoved = (diff.roleDiff?.removed || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
      renderReportLines(
        isPinned ? 'Изменение относительно закреплённого baseline' : 'Изменение после именованной версии',
        'Сравнение privacy-safe: используются только названия, роли, размеры и fingerprints. Полный текст не хранится и не показывается.',
        [
          `Версия: «${from.name || 'без имени'}» · ${from.ts ? new Date(from.ts).toLocaleString() : '—'}`,
          `Сходство структуры: ${Math.round((comparison.score || diff.structureScore || 0) * 100)}%`,
          `Блоков: ${from.blockCount || 0} → ${to.blockCount || 0} (${diff.blockDelta > 0 ? '+' : ''}${diff.blockDelta || 0})`,
          `Токенов: ~${from.tokens || 0} → ~${to.tokens || 0} (${diff.tokensDelta > 0 ? '+' : ''}${diff.tokensDelta || 0})`,
          `Добавлены блоки: ${(diff.titleDiff?.added || []).join(', ') || '—'}`,
          `Удалены блоки: ${(diff.titleDiff?.removed || []).join(', ') || '—'}`,
          `Добавлены роли: ${roleAdded.join(', ') || '—'}`,
          `Удалены роли: ${roleRemoved.join(', ') || '—'}`,
          diff.titleDiff?.reordered || diff.roleDiff?.reordered ? 'Порядок блоков/ролей изменился без явных добавлений/удалений.' : '',
          `Текущая структура: ${(to.blockTitles || []).join(' → ') || '—'}`
        ].filter(Boolean)
      );
      track(isPinned ? 'projectGraph.pinnedBaseline.drift.report.opened' : 'projectGraph.namedVersion.drift.report.opened', {
        chars: 0,
        tabId: to.tabId || from.tabId || '',
        tabName: to.tabName || from.tabName || '',
        title: from.name || '',
        textHash: `${from.textHash || ''}->${to.textHash || ''}`,
        sectionCount: 2
      });
      return true;
    }
    if (report === 'derived-from') {
      const version = suggestion.prepared?.derivedFrom || {};
      const from = version.from || {};
      const to = version.to || {};
      const diff = version.diff || {};
      const roleAdded = (diff.roleDiff?.added || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
      const roleRemoved = (diff.roleDiff?.removed || []).map(role => window.ProjectGraph?.roleLabel?.(role, role) || role);
      renderReportLines(
        'Изменения версии структуры',
        'Это privacy-safe отчёт: сравниваются только fingerprints, названия блоков, роли и размеры. Полный текст не хранится.',
        [
          `База: «${from.tabName || 'без имени'}» · ${from.ts ? new Date(from.ts).toLocaleString() : '—'}`,
          `Сходство структуры: ${Math.round((version.score || diff.structureScore || 0) * 100)}%`,
          `Блоков: ${from.blockCount || 0} → ${to.blockCount || 0} (${diff.blockDelta > 0 ? '+' : ''}${diff.blockDelta || 0})`,
          `Токенов: ~${from.tokens || 0} → ~${to.tokens || 0} (${diff.tokensDelta > 0 ? '+' : ''}${diff.tokensDelta || 0})`,
          `Добавлены блоки: ${(diff.titleDiff?.added || []).join(', ') || '—'}`,
          `Удалены блоки: ${(diff.titleDiff?.removed || []).join(', ') || '—'}`,
          `Добавлены роли: ${roleAdded.join(', ') || '—'}`,
          `Удалены роли: ${roleRemoved.join(', ') || '—'}`,
          diff.titleDiff?.reordered || diff.roleDiff?.reordered ? 'Порядок блоков/ролей изменился без явных добавлений/удалений.' : '',
          `Текущая структура: ${(to.blockTitles || []).join(' → ') || '—'}`
        ].filter(Boolean)
      );
      track('projectGraph.derivedFrom.report.opened', {
        chars: 0,
        textHash: to.textHash || '',
        tabId: to.tabId || '',
        tabName: to.tabName || ''
      });
      return true;
    }
    return false;
  }

  function saveSnippetFromSuggestion(suggestion) {
    const candidate = suggestion?.prepared?.snippetCandidate;
    const value = normalizeSnippetText(candidate?.value);
    if (!value) return false;

    if (isExistingGlobalSnippet(value)) {
      window.Toast?.show?.('Такой сниппет уже сохранён', 'info');
      return true;
    }

    const rawTitle = prompt('Название сниппета:', candidate.title || makeSnippetTitle(value));
    if (rawTitle === null) return false;
    const title = sanitizeUserTitle(rawTitle);
    if (!title) {
      window.Toast?.show?.('Название сниппета не может быть пустым', 'info');
      return false;
    }

    try {
      const snippet = window.State?.addGlobalSnippet?.(title, value, {
        source: 'intelligence',
        score: suggestion.confidence || candidate.confidence || 0,
        createdFrom: 'successful-prompt',
        textHash: candidate.textHash || hashText(value),
        uses: candidate.uses || 0,
        seen: candidate.seen || 0
      });

      if (!snippet) {
        window.Toast?.show?.('Не удалось сохранить сниппет', 'error');
        return false;
      }

      track('snippet.saved', {
        title: snippet.title || title,
        chars: value.length,
        textHash: candidate.textHash || hashText(value),
        via: 'intelligence'
      });
      window.Toast?.show?.(`Сниппет «${snippet.title || title}» сохранён ✓`, 'success');
      return true;
    } catch (err) {
      console.error('[Intelligence] save snippet failed:', err);
      window.Toast?.show?.('Не удалось сохранить сниппет', 'error');
      return false;
    }
  }

  function saveTemplateFromSuggestion() {
    const tab = window.State?.getActive?.();
    if (!tab) return false;
    const rawName = prompt('Название шаблона:', tab.name || 'Новый шаблон');
    if (rawName === null) return false;
    const name = sanitizeUserTitle(rawName, 'Новый шаблон');
    if (!name) {
      window.Toast?.show?.('Название шаблона не может быть пустым', 'info');
      return false;
    }

    try {
      const storageApi = window.Storage || (typeof Storage !== 'undefined' ? Storage : null);
      if (!storageApi?.loadTemplates || !storageApi?.saveTemplates) {
        window.Toast?.show?.('Сохранение шаблонов недоступно', 'error');
        return false;
      }
      const saved = storageApi.loadTemplates() || [];
      saved.push({
        id: 'user-intel-' + Date.now().toString(36),
        name,
        blocks: JSON.parse(JSON.stringify(tab.blocks || [])),
        source: 'intelligence'
      });
      storageApi.saveTemplates(saved);
      window.Templates?.renderDropdown?.();
      track('template.saved', {
        title: name,
        tabId: tab.id || '',
        tabName: tab.name || '',
        blockCount: tab.blocks?.length || 0,
        via: 'intelligence'
      });
      window.Toast?.show?.(`Шаблон «${name}» сохранён ✓`, 'success');
      return true;
    } catch (err) {
      console.error('[Intelligence] save template failed:', err);
      window.Toast?.show?.('Не удалось сохранить шаблон', 'error');
      return false;
    }
  }

  function getStructureSections(candidate) {
    const tab = window.State?.getActive?.();
    const block = candidate?.blockId ? window.State?.findBlock?.(tab?.blocks || [], candidate.blockId) : null;
    const idx = block?.activeSubtab ?? 0;
    const value = String(block?.subtabs?.[idx]?.value || '');
    return window.QualityDetectors?.splitIntoSections?.(value) || [];
  }

  function applyStructureCandidate(candidate) {
    const tab = window.State?.getActive?.();
    const sections = getStructureSections(candidate);
    if (!tab || !candidate?.blockId || sections.length < 2) return false;

    let applied = false;

    try {
      window.State.update(activeTab => {
        const source = window.State.findBlock(activeTab.blocks || [], candidate.blockId);
        if (!source || source.type !== 'text') {
          console.warn('[Intelligence] invalid source block');
          return;
        }
        const sourceIdx = source.activeSubtab ?? 0;

        const sourceColumn = Number.isFinite(Number(source.column)) ? source.column : 0;
        const newBlocks = sections.map(section => {
          const block = window.State.makeBlock(section.title, '📄', sourceColumn, '', 'text');
          block.subtabs[0].value = section.value;
          block.activeSubtab = 0;
          return block;
        });

        const insertAfter = (list) => {
          const index = list.findIndex(item => item.id === source.id);
          if (index >= 0) {
            list.splice(index + 1, 0, ...newBlocks);
            return true;
          }
          for (const item of list) {
            if (item.type === 'group' && Array.isArray(item.children) && insertAfter(item.children)) return true;
          }
          return false;
        };

        const inserted = insertAfter(activeTab.blocks);
        if (!inserted) activeTab.blocks.push(...newBlocks);
        if (source.subtabs?.[sourceIdx]) source.subtabs[sourceIdx].value = '';
        applied = true;
      });
    } catch (err) {
      console.error('[Intelligence] apply structure failed:', err);
      window.Toast?.show?.('Не удалось разбить текст на блоки', 'error');
      return false;
    }

    if (!applied) {
      window.Toast?.show?.('Не удалось найти исходный блок для разбиения', 'error');
      return false;
    }

    track('block.structure.applied', { blockId: candidate.blockId, chars: candidate.chars || 0, sectionCount: sections.length });
    window.Toast?.show?.(`Разбито на блоки: ${sections.length}`, 'success');
    return true;
  }

  function structureLastPaste(suggestion) {
    const candidate = suggestion.prepared?.structureCandidate;
    const sections = getStructureSections(candidate);
    if (!candidate || sections.length < 2) {
      window.Toast?.show?.('Не удалось подготовить разбиение', 'error');
      return false;
    }

    if (!window.SmartSuggestions?.openReport) {
      return confirm(`Разбить текст на ${sections.length} блоков?`) && applyStructureCandidate(candidate);
    }

    window.SmartSuggestions.openReport({
      title: 'Предпросмотр разбиения',
      subtitle: `Источник: «${candidate.title}». Исходный блок будет очищен, новые блоки появятся после него.`,
      renderBody(body) {
        const list = document.createElement('div');
        list.className = 'intelligence-report-list';
        sections.forEach((section, index) => {
          const item = document.createElement('div');
          item.className = 'intelligence-report-line intelligence-report-section';
          const preview = section.value.replace(/\s+/g, ' ').trim().slice(0, 180);
          item.innerHTML = `<strong>${index + 1}. ${escapeHtml(section.title)}</strong><span>${section.chars} симв · ~${section.tokens} токенов</span><small>${escapeHtml(preview)}${section.value.length > 180 ? '…' : ''}</small>`;
          list.appendChild(item);
        });
        body.appendChild(list);
      },
      actions: [
        {
          label: 'Применить разбиение',
          className: 'primary',
          onClick: () => applyStructureCandidate(candidate)
        }
      ]
    });
    return true;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function findCurrentBlockByHash(tab, hash) {
    const target = String(hash || '');
    if (!tab || !target) return null;

    const walk = blocks => {
      for (const block of blocks || []) {
        if (!block) continue;
        if (block.type === 'text') {
          const idx = block.activeSubtab ?? 0;
          const value = String(block.subtabs?.[idx]?.value || '');
          if (hashText(value) === target) return block;
        }
        if (block.type === 'group') {
          const found = walk(block.children || []);
          if (found) return found;
        }
      }
      return null;
    };

    return walk(tab.blocks || []);
  }

  function preferredColumnForNewBlock(tab) {
    let left = 0;
    let right = 0;
    const walk = blocks => {
      (blocks || []).forEach(block => {
        if (!block) return;
        if (Number(block.column || 0) === 0) left += 1;
        if (Number(block.column || 0) === 1) right += 1;
        if (block.type === 'group' && Array.isArray(block.children)) walk(block.children);
      });
    };
    walk(tab?.blocks || []);
    return left <= right ? 0 : 1;
  }

  function insertBlockAfter(blocks, sourceId, newBlock) {
    const list = blocks || [];
    const index = list.findIndex(item => item?.id === sourceId);
    if (index >= 0) {
      list.splice(index + 1, 0, newBlock);
      return true;
    }

    for (const item of list) {
      if (item?.type === 'group' && Array.isArray(item.children) && insertBlockAfter(item.children, sourceId, newBlock)) return true;
    }
    return false;
  }

  function insertBlockBefore(blocks, targetId, newBlock) {
    const list = blocks || [];
    const index = list.findIndex(item => item?.id === targetId);
    if (index >= 0) {
      list.splice(index, 0, newBlock);
      return true;
    }

    for (const item of list) {
      if (item?.type === 'group' && Array.isArray(item.children) && insertBlockBefore(item.children, targetId, newBlock)) return true;
    }
    return false;
  }

  function insertCompanionSkeleton(item) {
    const tab = window.State?.getActive?.();
    const companion = item?.companion || null;
    if (!tab || !companion?.title) return false;

    let inserted = false;
    window.State.update(activeTab => {
      const source = item.source?.id
        ? window.State.findBlock(activeTab.blocks || [], item.source.id)
        : findCurrentBlockByHash(activeTab, item.source?.hash);
      const sourceColumn = Number.isFinite(Number(source?.column)) ? Number(source.column) : 0;
      const block = window.State.makeBlock(
        companion.title,
        '📎',
        sourceColumn,
        `Блок часто использовался рядом с «${item.source?.title || 'текущим блоком'}». Заполните содержимое вручную.`,
        'text'
      );
      block.meta = {
        ...(block.meta || {}),
        source: 'project-graph',
        companionHash: companion.hash || '',
        suggestedFrom: item.source?.hash || ''
      };

      if (source?.id) inserted = insertBlockAfter(activeTab.blocks || [], source.id, block);
      if (!inserted) {
        activeTab.blocks.push(block);
        inserted = true;
      }
    });

    if (inserted) {
      track('projectGraph.companion.inserted', {
        title: companion.title,
        sourceTitle: item.source?.title || '',
        chars: 0,
        textHash: companion.hash || ''
      });
      window.Toast?.show?.(`Добавлен каркас блока «${companion.title}»`, 'success');
    }
    return inserted;
  }

  function getInsertionTargets(tab) {
    const targets = [];
    const walk = (blocks, depth = 0) => {
      (blocks || []).forEach(block => {
        if (!block) return;
        if (block.type === 'text') {
          targets.push({
            id: block.id,
            title: block.title || 'Блок',
            column: Number.isFinite(Number(block.column)) ? Number(block.column) : 0,
            depth
          });
        }
        if (block.type === 'group' && Array.isArray(block.children)) walk(block.children, depth + 1);
      });
    };
    walk(tab?.blocks || []);
    return targets;
  }

  function parsePlacementChoice(value) {
    const raw = String(value || 'auto');
    if (raw === 'auto') return null;
    if (raw === 'append') return { mode: 'append' };
    const match = raw.match(/^(after|before):(.+)$/);
    if (!match) return null;
    return { mode: match[1], id: match[2] };
  }

  function insertRoleGapSkeleton(item, manualPlacement = null) {
    const tab = window.State?.getActive?.();
    if (!tab || !item?.label) return false;

    let inserted = false;
    let placementMode = 'append';
    window.State.update(activeTab => {
      const placement = item.placement || {};
      const manual = manualPlacement && typeof manualPlacement === 'object' ? manualPlacement : null;
      const afterId = manual?.mode === 'after' ? manual.id : placement.insertAfterId;
      const beforeId = manual?.mode === 'before' ? manual.id : placement.insertBeforeId;
      const afterBlock = afterId ? window.State.findBlock(activeTab.blocks || [], afterId) : null;
      const beforeBlock = beforeId ? window.State.findBlock(activeTab.blocks || [], beforeId) : null;
      const fallbackColumn = Number.isFinite(Number(placement.preferredColumn))
        ? Number(placement.preferredColumn)
        : preferredColumnForNewBlock(activeTab);
      const column = Number.isFinite(Number(afterBlock?.column))
        ? Number(afterBlock.column)
        : Number.isFinite(Number(beforeBlock?.column)) ? Number(beforeBlock.column) : fallbackColumn;

      const block = window.State.makeBlock(
        item.label,
        '🧩',
        column,
        `ProjectGraph часто видел блок роли «${item.label}» в похожих структурах. Заполните содержимое вручную.`,
        'text'
      );
      block.meta = {
        ...(block.meta || {}),
        source: 'project-graph',
        suggestedRole: item.role || '',
        suggestionType: 'title-role-gap',
        placementMode: manual?.mode ? `manual-${manual.mode}` : placement.insertAfterId ? 'after-role-anchor' : placement.insertBeforeId ? 'before-role-anchor' : 'append'
      };

      if (manual?.mode === 'append') {
        activeTab.blocks.push(block);
        inserted = true;
        placementMode = 'manual-append';
      }
      if (!inserted && afterBlock?.id) {
        inserted = insertBlockAfter(activeTab.blocks || [], afterBlock.id, block);
        placementMode = manual?.mode === 'after' ? 'manual-after' : 'after-role-anchor';
      }
      if (!inserted && beforeBlock?.id) {
        inserted = insertBlockBefore(activeTab.blocks || [], beforeBlock.id, block);
        placementMode = manual?.mode === 'before' ? 'manual-before' : 'before-role-anchor';
      }
      if (!inserted) {
        activeTab.blocks.push(block);
        inserted = true;
        placementMode = manual?.mode ? 'manual-fallback-append' : 'append';
      }
    });

    if (inserted) {
      track('projectGraph.roleGap.inserted', {
        title: item.label,
        role: item.role || '',
        placementMode,
        chars: 0,
        textHash: hashText(item.role || item.label)
      });
      window.Toast?.show?.(`Добавлен каркас блока «${item.label}»`, 'success');
    }
    return inserted;
  }

  function previewRoleGapBlock(suggestion) {
    const items = suggestion?.prepared?.roleGaps?.items || [];
    const top = items[0];
    if (!top) return false;

    if (!window.SmartSuggestions?.openReport) {
      return confirm(`Добавить каркас блока «${top.label || 'Блок'}»?`) && insertRoleGapSkeleton(top);
    }

    let selectedItem = top;
    let placementSelect = null;
    const tab = window.State?.getActive?.();
    const targets = getInsertionTargets(tab);

    window.SmartSuggestions.openReport({
      title: 'Возможный недостающий блок',
      subtitle: 'ProjectGraph сравнил роли блоков в похожих структурах. Ничего не добавляется без подтверждения.',
      renderBody(body) {
        const list = document.createElement('div');
        list.className = 'intelligence-report-list';
        items.forEach((item, index) => {
          const examples = (item.examples || [])
            .map(example => example.tabName ? `«${example.tabName}»` : '')
            .filter(Boolean)
            .slice(0, 3)
            .join(', ');
          const placement = item.placement || {};
          const placementText = placement.insertAfterId
            ? 'будет вставлен после ближайшего предыдущего блока роли'
            : placement.insertBeforeId ? 'будет вставлен перед ближайшим следующим блоком роли' : 'будет добавлен в подходящую колонку';
          const row = document.createElement('label');
          row.className = 'intelligence-report-line intelligence-report-section intelligence-choice-line';
          row.innerHTML = `
            <span class="intelligence-choice-head">
              <input type="radio" name="role-gap-choice" value="${index}" ${index === 0 ? 'checked' : ''}>
              <strong>${index + 1}. ${escapeHtml(item.label || 'Блок')}</strong>
            </span>
            <span>${item.count || 0}× в похожих структурах · confidence ${Math.round((item.confidence || 0) * 100)}%</span>
            <small>${escapeHtml(placementText)}${examples ? ' · Примеры: ' + escapeHtml(examples) : ' · Локальная role-signature память ProjectGraph'}</small>
          `;
          row.querySelector('input')?.addEventListener('change', () => {
            selectedItem = items[index] || top;
          });
          list.appendChild(row);
        });
        body.appendChild(list);

        if (targets.length) {
          const placementBox = document.createElement('div');
          placementBox.className = 'intelligence-placement-box';
          const options = targets.slice(0, 30).map(target => {
            const prefix = target.depth ? '↳ '.repeat(Math.min(2, target.depth)) : '';
            const title = `${prefix}${target.title}${target.column ? ' · колонка ' + (target.column + 1) : ''}`;
            return `
              <option value="after:${escapeHtml(target.id)}">После: ${escapeHtml(title)}</option>
              <option value="before:${escapeHtml(target.id)}">Перед: ${escapeHtml(title)}</option>
            `;
          }).join('');
          placementBox.innerHTML = `
            <label>
              <span>Место вставки</span>
              <select class="intelligence-placement-select">
                <option value="auto">Автоматически по semantic anchor</option>
                <option value="append">В конец активной вкладки</option>
                ${options}
              </select>
            </label>
          `;
          placementSelect = placementBox.querySelector('.intelligence-placement-select');
          body.appendChild(placementBox);
        }
      },
      actions: [
        {
          label: 'Добавить выбранный каркас',
          className: 'primary',
          onClick: () => insertRoleGapSkeleton(selectedItem, parsePlacementChoice(placementSelect?.value))
        }
      ]
    });
    return true;
  }

  function previewCompanionBlock(suggestion) {
    const items = suggestion?.prepared?.oftenWith?.items || [];
    const top = items[0];
    if (!top) return openReport({ ...suggestion, action: { kind: 'open-report', report: 'often-with' } });

    if (!window.SmartSuggestions?.openReport) {
      return confirm(`Добавить каркас блока «${top.companion?.title || 'Блок'}»?`) && insertCompanionSkeleton(top);
    }

    window.SmartSuggestions.openReport({
      title: 'Частая связка блоков',
      subtitle: 'ProjectGraph не хранит полный текст, поэтому можно безопасно вставить только каркас связанного блока.',
      renderBody(body) {
        const list = document.createElement('div');
        list.className = 'intelligence-report-list';
        items.forEach((item, index) => {
          const tabs = Object.values(item.companion?.tabs || {}).filter(Boolean).slice(0, 3).join(', ');
          const row = document.createElement('div');
          row.className = 'intelligence-report-line intelligence-report-section';
          row.innerHTML = `
            <strong>${index + 1}. ${escapeHtml(item.source?.title || 'Блок')} → ${escapeHtml(item.companion?.title || 'Блок')}</strong>
            <span>${item.count || 0}× · ${item.companion?.chars || 0} симв · ~${item.companion?.tokens || 0} токенов</span>
            <small>${tabs ? 'Встречалось во вкладках: ' + escapeHtml(tabs) : 'Локальная связь из ProjectGraph'}</small>
          `;
          list.appendChild(row);
        });
        body.appendChild(list);
      },
      actions: [
        {
          label: `Вставить каркас «${String(top.companion?.title || 'Блок')}»`,
          className: 'primary',
          onClick: () => insertCompanionSkeleton(top)
        },
        {
          label: 'Только отчёт',
          className: 'secondary',
          onClick: () => openReport({ ...suggestion, action: { kind: 'open-report', report: 'often-with' } })
        }
      ]
    });
    return true;
  }

  function runSuggestionAction(suggestion) {
    const action = suggestion.action || {};
    if (action.kind === 'llm-feature' && action.feature) {
      const handler = window.LLMFeatures?.handleAction;
      if (typeof handler !== 'function') {
        window.Toast?.show?.('LLM-функция сейчас недоступна', 'error');
        return false;
      }
      handler(action.feature);
      return true;
    }
    if (action.kind === 'open-report') return openReport(suggestion);
    if (action.kind === 'save-snippet') return saveSnippetFromSuggestion(suggestion);
    if (action.kind === 'save-template') return saveTemplateFromSuggestion();
    if (action.kind === 'structure-last-paste') return structureLastPaste(suggestion);
    if (action.kind === 'preview-role-gap-block') return previewRoleGapBlock(suggestion);
    if (action.kind === 'preview-companion-block') return previewCompanionBlock(suggestion);
    return false;
  }

  function rememberSuccessfulStructure(source) {
    const tab = window.State?.getActive?.();
    const text = safePreviewText();
    if (!tab || !text.trim()) return;
    const textHash = hashText(text);
    const analysis = lastContext?.tabId === tab.id && lastContext?.textHash === textHash
      ? lastContext.analysis
      : window.QualityDetectors?.analyzePreview?.(text, tab);
    window.UserMemory?.addSuccessfulStructure?.({
      source,
      tabName: tab.name || '',
      blockCount: tab.blocks?.length || 0,
      textHash,
      chars: text.length,
      structure: analysis?.structure || null
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    scheduleRefresh(800);
    window.addEventListener('beforeunload', () => {
      cleanupEditSessions(true);
      window.UserMemory?.save?.();
    });
  }

  window.Intelligence = {
    init,
    track,
    trackEdit,
    getContext,
    getSuggestions,
    getMenuSuggestions,
    acceptSuggestion,
    dismissSuggestion,
    openPreparedReport,
    refresh,
    hashText
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();