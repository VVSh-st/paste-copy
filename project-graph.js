// file_name: project-graph.js

/* ============================================================
   ProjectGraph — локальная карта проекта для Intelligence Layer
   ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'llm-pb-project-graph-v1';
  const SCHEMA_VERSION = 1;
  const MAX_SNAPSHOTS = 80;
  const MAX_BLOCK_NODES = 240;
  const MAX_RELATIONS = 300;
  const SNAPSHOT_COOLDOWN = 20_000;
  const SIMILAR_STRUCTURE_THRESHOLD = 0.72;

  const DEFAULT_RETENTION = {
    maxSnapshots: MAX_SNAPSHOTS,
    maxBlockNodes: MAX_BLOCK_NODES,
    maxRelations: MAX_RELATIONS,
    maxAgeDays: 0,
    preserveNamed: true,
    preserveBaselines: true,
    pruneUnreferencedBlocks: false
  };

  const TITLE_ROLE_ALIASES = {
    role: ['role', 'роль', 'persona', 'system', 'система', 'ассистент'],
    context: ['context', 'контекст', 'background', 'фон', 'исходные данные', 'данные', 'материал'],
    task: ['task', 'задача', 'goal', 'цель', 'request', 'запрос', 'что сделать'],
    requirements: ['requirements', 'требования', 'constraints', 'ограничения', 'rules', 'правила', 'условия'],
    format: ['format', 'формат', 'output', 'вывод', 'answer', 'ответ', 'result', 'результат'],
    examples: ['examples', 'примеры', 'example', 'пример', 'samples', 'образцы'],
    code: ['code', 'код', 'script', 'скрипт', 'styles', 'стили', 'css', 'html', 'javascript', 'js'],
    notes: ['notes', 'заметки', 'замечания', 'comments', 'комментарии', 'разное', 'misc'],
    improvements: ['improvements', 'улучшения', 'доработки', 'fixes', 'исправления'],
    snippets: ['snippets', 'сниппеты', 'templates', 'шаблоны', 'commands', 'команды']
  };

  const ROLE_LABELS = {
    role: 'Роль',
    context: 'Контекст',
    task: 'Задача',
    requirements: 'Требования',
    format: 'Формат',
    examples: 'Примеры',
    code: 'Код',
    notes: 'Заметки',
    improvements: 'Улучшения',
    snippets: 'Сниппеты'
  };

  const ROLE_ORDER = [
    'role',
    'context',
    'task',
    'requirements',
    'format',
    'examples',
    'code',
    'notes',
    'improvements',
    'snippets'
  ];

  let graph = normalizeGraph(loadGraph());
  let saveTimer = null;
  let lastSnapshotAt = 0;
  let lastSnapshotHash = '';

  function now() { return Date.now(); }

  /* ---- Import helpers ------------------------------------------------- */
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }

  function safeStr(v, max = 160) {
    return String(v == null ? '' : v).slice(0, max);
  }

  function sanitizeSnapshot(s) {
    if (!isPlainObject(s)) return null;
    const blockHashes = Array.isArray(s.blockHashes)
      ? s.blockHashes.map(x => safeStr(x, 80)).filter(Boolean).slice(0, 64)
      : [];
    return {
      id:             safeStr(s.id, 80),
      ts:             Number(s.ts || 0),
      source:         safeStr(s.source, 80),
      name:           safeStr(s.name, 80),
      tabId:          safeStr(s.tabId, 80),
      tabName:        safeStr(s.tabName, 80),
      textHash:       safeStr(s.textHash, 80),
      structureHash:  safeStr(s.structureHash, 80),
      structureSignature: safeStr(s.structureSignature, 4000),
      roleSignature:  safeStr(s.roleSignature, 4000),
      chars:          Math.max(0, Number(s.chars || 0)),
      tokens:         Math.max(0, Number(s.tokens || 0)),
      blockCount:     Math.max(0, Number(s.blockCount || blockHashes.length)),
      blockHashes,
      blockTitles:    Array.isArray(s.blockTitles) ? s.blockTitles.map(x => safeStr(x, 80)).slice(0, 16) : [],
      blockRoles:     Array.isArray(s.blockRoles) ? s.blockRoles.map(x => safeStr(x, 80)).slice(0, 16) : []
    };
  }

  function limitedEntriesObject(raw, max) {
    if (!isPlainObject(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([k, v]) => k && isPlainObject(v))
        .sort((a, b) => Number(b[1]?.lastSeenAt || 0) - Number(a[1]?.lastSeenAt || 0))
        .slice(0, max)
    );
  }

  let _simCache = new Map();

  function loadGraph() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('[ProjectGraph] load failed', e);
      return {};
    }
  }

  function createDefaultGraph() {
    const ts = now();
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: ts,
      updatedAt: ts,
      counters: {
        snapshots: 0,
        namedSnapshots: 0,
        blockFingerprints: 0,
        relations: 0
      },
      blockNodes: {},
      promptSnapshots: [],
      relations: {
        oftenWith: {},
        derivedFrom: {}
      },
      baselines: {
        byTabId: {}
      },
      retention: { ...DEFAULT_RETENTION }
    };
  }

  function normalizeGraph(raw) {
    const base = createDefaultGraph();
    const g = isPlainObject(raw) ? raw : {};
    const ret = normalizeRetention(g.retention || {});
    return {
      ...base,
      ...g,
      schemaVersion: SCHEMA_VERSION,
      counters: { ...base.counters, ...(g.counters || {}) },
      blockNodes: limitedEntriesObject(g.blockNodes, ret.maxBlockNodes),
      promptSnapshots: Array.isArray(g.promptSnapshots)
        ? g.promptSnapshots.map(sanitizeSnapshot).filter(Boolean).slice(-ret.maxSnapshots)
        : [],
      relations: {
        oftenWith:   limitedEntriesObject(g.relations?.oftenWith, ret.maxRelations),
        derivedFrom: limitedEntriesObject(g.relations?.derivedFrom, ret.maxRelations)
      },
      baselines: {
        byTabId: { ...(g.baselines?.byTabId || {}) }
      },
      retention: ret
    };
  }

  function normalizeRetention(raw = {}) {
    const maxSnapshots = Math.max(20, Math.min(500, Number(raw.maxSnapshots || DEFAULT_RETENTION.maxSnapshots)));
    const maxBlockNodes = Math.max(80, Math.min(2000, Number(raw.maxBlockNodes || DEFAULT_RETENTION.maxBlockNodes)));
    const maxRelations = Math.max(80, Math.min(3000, Number(raw.maxRelations || DEFAULT_RETENTION.maxRelations)));
    const maxAgeDays = Math.max(0, Math.min(365, Number(raw.maxAgeDays || 0)));

    return {
      maxSnapshots,
      maxBlockNodes,
      maxRelations,
      maxAgeDays,
      preserveNamed: raw.preserveNamed !== false,
      preserveBaselines: raw.preserveBaselines !== false,
      pruneUnreferencedBlocks: raw.pruneUnreferencedBlocks === true
    };
  }

  function getRetention() {
    graph.retention = normalizeRetention(graph.retention || {});
    return { ...graph.retention };
  }

  function saveSoon(delay = 500) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      const nextUpdatedAt = now();
      const serialized = JSON.stringify({ ...graph, updatedAt: nextUpdatedAt });
      localStorage.setItem(STORAGE_KEY, serialized);
      graph.updatedAt = nextUpdatedAt;
    } catch (err) {
      console.warn('[ProjectGraph] save failed:', err);
      if (err?.name !== 'QuotaExceededError') {
        saveTimer = setTimeout(saveNow, 5000);
      }
    }
  }

  function hashText(text) {
    if (window.Intelligence?.hashText) return window.Intelligence.hashText(text);
    if (window.PromptLoom?.hashText) return window.PromptLoom.hashText(text);
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function estimateTokens(text) {
    return window.QualityDetectors?.estimateTokens?.(text) || Math.ceil(String(text || '').length / 3.5);
  }

  function normalizeTitle(title) {
    return String(title || 'Блок').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  }

  function titleRole(title) {
    const key = normalizeTitle(title)
      .replace(/[«»"'`.,:;!?()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!key) return 'block';

    for (const [role, aliases] of Object.entries(TITLE_ROLE_ALIASES)) {
      if (aliases.some(alias => key === alias || key.includes(alias))) return role;
    }

    return 'custom:' + key.slice(0, 48);
  }

  function roleLabel(role, fallback = 'Блок') {
    const key = String(role || '').replace(/^custom:/, '').trim();
    return ROLE_LABELS[role] || (key ? key[0].toUpperCase() + key.slice(1) : fallback);
  }

  function getTextBlocks(tab) {
    const out = [];
    const walk = blocks => (blocks || []).forEach(block => {
      if (!block || block.previewDisabled === true) return;
      if (block.type === 'text') {
        const idx = Number.isInteger(block.activeSubtab) ? block.activeSubtab : 0;
        const value = String(block.subtabs?.[idx]?.value || '');
        if (value.trim()) {
          out.push({
            id: block.id,
            title: block.title || 'Блок',
            value,
            chars: value.length,
            column: Number.isFinite(Number(block.column)) ? Number(block.column) : 0,
            kind: window.PromptLoom?.classify?.(value) || 'text'
          });
        }
      } else if (block.type === 'group' && block.enabled !== false) {
        walk(block.children || []);
      }
    });
    walk(tab?.blocks || []);
    return out;
  }

  function makeBlockFingerprint(block) {
    const value = String(block?.value || '');
    const title = String(block?.title || 'Блок').slice(0, 80);
    return {
      id: block?.id || '',
      title,
      titleKey: normalizeTitle(title),
      role: titleRole(title),
      hash: hashText(value),
      chars: value.length,
      tokens: estimateTokens(value),
      column: Number.isFinite(Number(block?.column)) ? Number(block.column) : 0,
      kind: block?.kind || window.PromptLoom?.classify?.(value) || 'text'
    };
  }

  function makeStructureSignature(blocks, mode = 'title') {
    return blocks
      .map(b => mode === 'role' ? (b.role || titleRole(b.title)) : (b.titleKey || normalizeTitle(b.title)))
      .join(' > ');
  }

  function makeRoleSignature(blocks) {
    return makeStructureSignature(blocks, 'role');
  }

  function makePairKey(a, b) {
    if (!a || !b) return '';
    return [a, b].sort().join('::');
  }

  function bumpRelation(bucket, key, meta = {}) {
    const current = bucket[key] || { count: 0, firstSeenAt: now(), lastSeenAt: 0 };
    bucket[key] = {
      ...current,
      ...meta,
      count: (current.count || 0) + 1,
      lastSeenAt: now()
    };
  }

  function trimObjectByLastSeen(obj, max) {
    const entries = Object.entries(obj || {});
    if (entries.length <= max) return obj;
    return Object.fromEntries(
      entries
        .sort((a, b) => Number(b[1]?.lastSeenAt || 0) - Number(a[1]?.lastSeenAt || 0))
        .slice(0, max)
    );
  }

  function getPinnedSnapshotIds() {
    return new Set(Object.values(graph.baselines?.byTabId || {})
      .map(item => item?.snapshotId)
      .filter(Boolean));
  }

  function updateCounters() {
    graph.counters.blockFingerprints = Object.keys(graph.blockNodes || {}).length;
    graph.counters.relations = Object.keys(graph.relations?.oftenWith || {}).length + Object.keys(graph.relations?.derivedFrom || {}).length;
    graph.counters.namedSnapshots = graph.promptSnapshots.filter(snapshot => String(snapshot.name || '').trim()).length;
  }

  function trimSnapshotsByLimit(snapshots, limit, preserveNamed, preserveBaselines) {
    const list = Array.isArray(snapshots) ? snapshots.slice() : [];
    if (list.length <= limit) return list.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    const pinnedIds = preserveBaselines ? getPinnedSnapshotIds() : new Set();
    const keep = [];
    const removable = [];
    list.forEach(snapshot => {
      const protectedSnapshot = (preserveNamed && String(snapshot.name || '').trim()) || pinnedIds.has(snapshot.id);
      (protectedSnapshot ? keep : removable).push(snapshot);
    });

    const roomForRemovable = Math.max(0, limit - keep.length);
    const keptRemovable = removable
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, roomForRemovable);

    return [...keep, ...keptRemovable]
      .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  }

  function pruneOldSnapshots(snapshots, maxAgeDays, preserveNamed, preserveBaselines) {
    const days = Number(maxAgeDays || 0);
    if (!days) return snapshots;

    const cutoff = now() - days * 24 * 60 * 60 * 1000;
    const pinnedIds = preserveBaselines ? getPinnedSnapshotIds() : new Set();
    return snapshots.filter(snapshot => {
      if ((preserveNamed && String(snapshot.name || '').trim()) || pinnedIds.has(snapshot.id)) return true;
      return Number(snapshot.ts || 0) >= cutoff;
    });
  }

  function pruneUnreferencedBlockNodes() {
    const referenced = new Set();
    graph.promptSnapshots.forEach(snapshot => {
      (snapshot.blockHashes || []).forEach(hash => referenced.add(hash));
    });
    Object.keys(graph.blockNodes || {}).forEach(hash => {
      if (!referenced.has(hash)) delete graph.blockNodes[hash];
    });
  }

  function trimGraph(retentionOverride = null) {
    const retention = normalizeRetention(retentionOverride || graph.retention || {});
    graph.retention = retention;

    graph.promptSnapshots = pruneOldSnapshots(
      graph.promptSnapshots,
      retention.maxAgeDays,
      retention.preserveNamed,
      retention.preserveBaselines
    );
    graph.promptSnapshots = trimSnapshotsByLimit(
      graph.promptSnapshots,
      retention.maxSnapshots,
      retention.preserveNamed,
      retention.preserveBaselines
    );

    graph.blockNodes = trimObjectByLastSeen(graph.blockNodes, retention.maxBlockNodes);
    graph.relations.oftenWith = trimObjectByLastSeen(graph.relations.oftenWith, retention.maxRelations);
    graph.relations.derivedFrom = trimObjectByLastSeen(graph.relations.derivedFrom, retention.maxRelations);
    if (retention.pruneUnreferencedBlocks) pruneUnreferencedBlockNodes();
    updateCounters();
  }

  function setRetention(next = {}) {
    graph.retention = normalizeRetention({ ...getRetention(), ...(next || {}) });
    trimGraph(graph.retention);
    saveNow();
    return getRetention();
  }

  function cleanup(options = {}) {
    const before = getDiagnostics();
    const retention = normalizeRetention({ ...getRetention(), ...(options.retention || {}) });
    if (options.pruneUnreferencedBlocks === true) retention.pruneUnreferencedBlocks = true;
    trimGraph(retention);
    saveNow();
    const after = getDiagnostics();
    return {
      before,
      after,
      removed: {
        snapshots: Math.max(0, Number(before.snapshots || 0) - Number(after.snapshots || 0)),
        blockNodes: Math.max(0, Number(before.blockNodes || 0) - Number(after.blockNodes || 0)),
        relations: Math.max(0, Number(before.oftenWith || 0) + Number(before.derivedFrom || 0) - Number(after.oftenWith || 0) - Number(after.derivedFrom || 0))
      },
      retention: getRetention()
    };
  }

  function captureSnapshot(source = 'manual', options = {}) {
    const tab = window.State?.getActive?.();
    if (!tab) return null;

    const text = window.Preview?.getText?.() || '';
    const blocks = getTextBlocks(tab).map(makeBlockFingerprint);
    if (!String(text || '').trim() || blocks.length === 0) return null;

    const textHash = hashText(text);
    const ts = now();
    if (!options.force && textHash === lastSnapshotHash && ts - lastSnapshotAt < SNAPSHOT_COOLDOWN) return null;

    const structureSignature = makeStructureSignature(blocks);
    const roleSignature = makeRoleSignature(blocks);
    const structureHash = hashText(structureSignature);

    lastSnapshotHash = textHash;
    lastSnapshotAt = ts;

    const snapshot = {
      id: 'pg_' + ts.toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      ts,
      source,
      name: String(options.name || '').trim().slice(0, 80),
      tabId: tab.id || '',
      tabName: String(tab.name || '').slice(0, 80),
      textHash,
      structureHash,
      structureSignature,
      roleSignature,
      chars: text.length,
      tokens: estimateTokens(text),
      blockCount: blocks.length,
      blockHashes: blocks.map(b => b.hash),
      blockTitles: blocks.map(b => b.title).slice(0, 16),
      blockRoles: blocks.map(b => b.role || titleRole(b.title)).slice(0, 16)
    };

    blocks.forEach(block => {
      if (!block.hash) return;
      const node = graph.blockNodes[block.hash] || {
        hash: block.hash,
        title: block.title,
        titleKey: block.titleKey,
        role: block.role,
        kind: block.kind,
        chars: block.chars,
        tokens: block.tokens,
        seen: 0,
        usedInFinal: 0,
        firstSeenAt: ts,
        lastSeenAt: 0,
        tabs: {}
      };
      node.title = block.title || node.title;
      node.titleKey = block.titleKey || node.titleKey;
      node.role = block.role || node.role || titleRole(node.title);
      node.kind = block.kind || node.kind;
      node.chars = block.chars || node.chars;
      node.tokens = block.tokens || node.tokens;
      node.seen = (node.seen || 0) + 1;
      node.lastSeenAt = ts;
      node.tabs[tab.id || 'unknown'] = String(tab.name || '').slice(0, 80);
      if (/preview\.(copy|download|exportAll)|file\.export|successful/i.test(source)) {
        node.usedInFinal = (node.usedInFinal || 0) + 1;
      }
      graph.blockNodes[block.hash] = node;
    });

    const relationBlocks = [];
    const seenHashes = new Set();
    blocks.forEach(b => {
      if (!b.hash || seenHashes.has(b.hash)) return;
      seenHashes.add(b.hash);
      relationBlocks.push(b);
    });
    const pairLimit = Math.max(80, Math.min(1200, (graph.retention?.maxRelations || MAX_RELATIONS) * 2));
    let pairCount = 0;
    for (let i = 0; i < relationBlocks.length && pairCount < pairLimit; i += 1) {
      for (let j = i + 1; j < relationBlocks.length && pairCount < pairLimit; j += 1) {
        const key = makePairKey(relationBlocks[i].hash, relationBlocks[j].hash);
        if (!key) continue;
        pairCount += 1;
        bumpRelation(graph.relations.oftenWith, key, {
          aTitle: relationBlocks[i].title,
          bTitle: relationBlocks[j].title,
          tabName: snapshot.tabName,
          aRole: relationBlocks[i].role,
          bRole: relationBlocks[j].role
        });
      }
    }

    const previousSameTab = [...graph.promptSnapshots].reverse().find(s => s.tabId === snapshot.tabId && s.textHash !== snapshot.textHash);
    if (previousSameTab) {
      bumpRelation(graph.relations.derivedFrom, `${previousSameTab.textHash} -> ${snapshot.textHash}`, {
        fromTextHash: previousSameTab.textHash,
        toTextHash: snapshot.textHash,
        fromSnapshotId: previousSameTab.id || '',
        toSnapshotId: snapshot.id,
        tabId: snapshot.tabId,
        fromTabName: previousSameTab.tabName,
        toTabName: snapshot.tabName,
        fromStructureHash: previousSameTab.structureHash,
        toStructureHash: snapshot.structureHash,
        fromBlockTitles: previousSameTab.blockTitles || [],
        toBlockTitles: snapshot.blockTitles || [],
        fromBlockRoles: previousSameTab.blockRoles || [],
        toBlockRoles: snapshot.blockRoles || [],
        fromBlockHashes: previousSameTab.blockHashes || [],
        toBlockHashes: snapshot.blockHashes || [],
        fromTs: previousSameTab.ts || 0,
        toTs: snapshot.ts
      });
    }

    graph.promptSnapshots.push(snapshot);
    graph.counters.snapshots += 1;
    const ret = normalizeRetention(graph.retention || {});
    if (
      graph.promptSnapshots.length > ret.maxSnapshots
      || Object.keys(graph.blockNodes).length > ret.maxBlockNodes
      || Object.keys(graph.relations.oftenWith).length > ret.maxRelations
      || Object.keys(graph.relations.derivedFrom).length > ret.maxRelations
      || ret.maxAgeDays > 0
    ) {
      trimGraph(ret);
    } else {
      updateCounters();
    }
    saveSoon();
    return snapshot;
  }

  function similarityFromSets(a, b) {
    const as = new Set(a || []);
    const bs = new Set(b || []);
    if (!as.size || !bs.size) return 0;
    let hits = 0;
    as.forEach(x => { if (bs.has(x)) hits += 1; });
    const denom = as.size + bs.size - hits;
    const jaccard = denom ? hits / denom : 0;
    const containment = hits / Math.min(as.size, bs.size);
    return Math.max(jaccard, containment * 0.86);
  }

  function roleSimilarity(a, b) {
    const roleA = String(a?.roleSignature || '').split(' > ').filter(Boolean);
    const roleB = String(b?.roleSignature || '').split(' > ').filter(Boolean);
    return similarityFromSets(roleA, roleB);
  }

  function structureSimilarity(a, b) {
    const aId = a?.id || a?.textHash || '';
    const bId = b?.id || b?.textHash || '';
    const ck = aId < bId ? aId + '::' + bId : bId + '::' + aId;
    if (_simCache.has(ck)) return _simCache.get(ck);

    const titleA = String(a?.structureSignature || '').split(' > ').filter(Boolean);
    const titleB = String(b?.structureSignature || '').split(' > ').filter(Boolean);
    const titleScore = similarityFromSets(titleA, titleB);
    const roleScore = roleSimilarity(a, b);
    const blockScore = similarityFromSets(a?.blockHashes || [], b?.blockHashes || []);
    const countA = Math.max(1, Number(a?.blockCount || 0));
    const countB = Math.max(1, Number(b?.blockCount || 0));
    const denom = Math.max(countA, countB) || 1;
    const countScore = 1 - Math.min(1, Math.abs(countA - countB) / denom);
    const semanticScore = Math.max(titleScore, roleScore * 0.94);
    const score = Number(Math.max(semanticScore * 0.48 + blockScore * 0.34 + countScore * 0.18, blockScore, roleScore * 0.82).toFixed(2));
    if (_simCache.size > 1000) _simCache.clear();
    _simCache.set(ck, score);
    return score;
  }

  function findSimilarPrompt(tab, text, options = {}) {
    const currentBlocks = getTextBlocks(tab).map(makeBlockFingerprint);
    const current = {
      tabId: tab?.id || '',
      textHash: hashText(text || ''),
      structureSignature: makeStructureSignature(currentBlocks),
      roleSignature: makeRoleSignature(currentBlocks),
      blockHashes: currentBlocks.map(b => b.hash),
      blockCount: currentBlocks.length
    };

    if (!current.blockCount || !String(text || '').trim()) return null;

    const candidates = [...graph.promptSnapshots]
      .filter(s => s.textHash !== current.textHash)
      .filter(s => options.includeSameTab || s.tabId !== current.tabId)
      .map(s => ({ snapshot: s, score: structureSimilarity(current, s), roleScore: roleSimilarity(current, s) }))
      .filter(x => x.score >= (options.threshold || SIMILAR_STRUCTURE_THRESHOLD))
      .sort((a, b) => b.score - a.score || Number(b.snapshot.ts || 0) - Number(a.snapshot.ts || 0));

    return candidates[0] || null;
  }

  function getFrequentCompanions(blockHash, limit = 5) {
    const hash = String(blockHash || '');
    if (!hash) return [];
    return Object.entries(graph.relations.oftenWith || {})
      .filter(([key]) => key.split('::').includes(hash))
      .map(([key, value]) => {
        const otherHash = key.split('::').find(x => x !== hash) || '';
        return { hash: otherHash, node: graph.blockNodes[otherHash] || null, ...value };
      })
      .filter(item => item.node)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, limit);
  }

  function findOftenWith(tab, options = {}) {
    const minCount = Math.max(2, Number(options.minCount || 2));
    const currentBlocks = getTextBlocks(tab).map(makeBlockFingerprint).filter(block => block.hash);
    const currentHashes = new Set(currentBlocks.map(block => block.hash));
    if (!currentHashes.size) return null;

    const candidates = [];
    currentBlocks.forEach(block => {
      getFrequentCompanions(block.hash, 8)
        .filter(item => !currentHashes.has(item.hash))
        .filter(item => Number(item.count || 0) >= minCount)
        .forEach(item => {
          candidates.push({
            source: {
              id: block.id,
              hash: block.hash,
              title: block.title,
              role: block.role,
              chars: block.chars,
              tokens: block.tokens
            },
            companion: {
              hash: item.hash,
              title: item.node?.title || item.bTitle || item.aTitle || roleLabel(item.node?.role, 'Блок'),
              role: item.node?.role || item.bRole || item.aRole || titleRole(item.node?.title || ''),
              kind: item.node?.kind || 'text',
              chars: item.node?.chars || 0,
              tokens: item.node?.tokens || 0,
              tabs: item.node?.tabs || {}
            },
            count: Number(item.count || 0),
            tabName: item.tabName || '',
            lastSeenAt: Number(item.lastSeenAt || 0)
          });
        });
    });

    const unique = new Map();
    candidates.forEach(item => {
      const key = item.source.hash + '::' + item.companion.hash;
      const prev = unique.get(key);
      if (!prev || item.count > prev.count || item.lastSeenAt > prev.lastSeenAt) unique.set(key, item);
    });

    const items = [...unique.values()]
      .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
      .slice(0, Math.max(1, Number(options.limit || 5)));

    if (!items.length) return null;
    const top = items[0];
    return {
      items,
      top,
      confidence: Math.min(0.9, 0.58 + Math.min(top.count, 8) * 0.04 + Math.min(items.length, 4) * 0.03)
    };
  }

  function roleOrderIndex(role) {
    const key = String(role || '');
    const index = ROLE_ORDER.indexOf(key);
    return index >= 0 ? index : ROLE_ORDER.length + 10;
  }

  function findNearestAnchor(currentBlocks, missingRole, sampleRoles = []) {
    const normalizedSample = Array.isArray(sampleRoles) ? sampleRoles : [];
    const sampleIdx = normalizedSample.indexOf(missingRole);
    const missingIndex = sampleIdx >= 0 ? sampleIdx : roleOrderIndex(missingRole);

    let before = null;
    let after = null;

    currentBlocks.forEach((block, index) => {
      const role = block.role || titleRole(block.title);
      const sIdx = normalizedSample.indexOf(role);
      const orderIndex = sIdx >= 0 ? sIdx : roleOrderIndex(role);
      const candidate = {
        id: block.id,
        title: block.title,
        role,
        column: block.column,
        index,
        orderIndex
      };

      if (orderIndex < missingIndex && (!before || orderIndex > before.orderIndex || (orderIndex === before.orderIndex && index > before.index))) {
        before = candidate;
      }
      if (orderIndex > missingIndex && (!after || orderIndex < after.orderIndex || (orderIndex === after.orderIndex && index < after.index))) {
        after = candidate;
      }
    });

    return { before, after, missingIndex };
  }

  function diffArrays(before = [], after = []) {
    const beforeList = Array.isArray(before) ? before.map(x => String(x || '')).filter(Boolean) : [];
    const afterList = Array.isArray(after) ? after.map(x => String(x || '')).filter(Boolean) : [];
    const beforeCounts = {};
    const afterCounts = {};
    beforeList.forEach(item => { beforeCounts[item] = (beforeCounts[item] || 0) + 1; });
    afterList.forEach(item => { afterCounts[item] = (afterCounts[item] || 0) + 1; });

    const added = [];
    const removed = [];
    Object.entries(afterCounts).forEach(([item, count]) => {
      const delta = count - (beforeCounts[item] || 0);
      for (let i = 0; i < delta; i += 1) added.push(item);
    });
    Object.entries(beforeCounts).forEach(([item, count]) => {
      const delta = count - (afterCounts[item] || 0);
      for (let i = 0; i < delta; i += 1) removed.push(item);
    });

    const beforeJoined = beforeList.join(' > ');
    const afterJoined = afterList.join(' > ');
    return {
      added,
      removed,
      reordered: beforeJoined !== afterJoined && !added.length && !removed.length,
      before: beforeList,
      after: afterList
    };
  }

  function buildSnapshotDiff(fromSnapshot = {}, toSnapshot = {}) {
    const titleDiff = diffArrays(fromSnapshot.blockTitles || [], toSnapshot.blockTitles || []);
    const roleDiff = diffArrays(fromSnapshot.blockRoles || [], toSnapshot.blockRoles || []);
    const hashDiff = diffArrays(fromSnapshot.blockHashes || [], toSnapshot.blockHashes || []);
    const charsDelta = Number(toSnapshot.chars || 0) - Number(fromSnapshot.chars || 0);
    const tokensDelta = Number(toSnapshot.tokens || 0) - Number(fromSnapshot.tokens || 0);
    const blockDelta = Number(toSnapshot.blockCount || 0) - Number(fromSnapshot.blockCount || 0);
    const structureScore = structureSimilarity({
      structureSignature: fromSnapshot.structureSignature,
      roleSignature: fromSnapshot.roleSignature,
      blockHashes: fromSnapshot.blockHashes,
      blockCount: fromSnapshot.blockCount
    }, {
      structureSignature: toSnapshot.structureSignature,
      roleSignature: toSnapshot.roleSignature,
      blockHashes: toSnapshot.blockHashes,
      blockCount: toSnapshot.blockCount
    });

    return {
      titleDiff,
      roleDiff,
      hashDiff,
      charsDelta,
      tokensDelta,
      blockDelta,
      structureScore
    };
  }

  function findDerivedFrom(tab, options = {}) {
    const currentText = options.text != null ? String(options.text || '') : (window.Preview?.getText?.() || '');
    const currentBlocks = getTextBlocks(tab).map(makeBlockFingerprint).filter(block => block.hash);
    const structureSignature = makeStructureSignature(currentBlocks);
    const roleSignature = makeRoleSignature(currentBlocks);
    const current = {
      id: 'current',
      ts: now(),
      tabId: tab?.id || '',
      tabName: String(tab?.name || '').slice(0, 80),
      textHash: hashText(currentText),
      structureHash: hashText(structureSignature),
      structureSignature,
      roleSignature,
      chars: currentText.length,
      tokens: estimateTokens(currentText),
      blockCount: currentBlocks.length,
      blockHashes: currentBlocks.map(b => b.hash),
      blockTitles: currentBlocks.map(b => b.title).slice(0, 16),
      blockRoles: currentBlocks.map(b => b.role || titleRole(b.title)).slice(0, 16)
    };

    if (!current.tabId || !current.blockCount || !currentText.trim()) return null;

    const candidates = [...graph.promptSnapshots]
      .filter(snapshot => snapshot.tabId === current.tabId)
      .filter(snapshot => snapshot.textHash !== current.textHash)
      .map(snapshot => ({
        snapshot,
        diff: buildSnapshotDiff(snapshot, current),
        score: structureSimilarity(snapshot, current),
        ageMs: Math.max(0, current.ts - Number(snapshot.ts || 0))
      }))
      .filter(item => item.score >= (options.threshold || 0.58))
      .sort((a, b) => b.score - a.score || Number(b.snapshot.ts || 0) - Number(a.snapshot.ts || 0));

    const best = candidates[0];
    if (!best) return null;

    const diffWeight = Math.min(0.18, Math.abs(best.diff.blockDelta) * 0.035 + Math.min(0.08, Math.abs(best.diff.tokensDelta) / 12000));
    return {
      from: best.snapshot,
      to: current,
      diff: best.diff,
      score: best.score,
      confidence: Math.min(0.9, 0.54 + best.score * 0.28 + diffWeight),
      candidates: candidates.slice(0, Math.max(1, Number(options.limit || 3)))
    };
  }

  function findRoleGaps(tab, options = {}) {
    const minScore = Math.max(0.45, Math.min(0.95, Number(options.minScore || 0.58)));
    const limit = Math.max(1, Number(options.limit || 4));
    const currentBlocks = getTextBlocks(tab).map(makeBlockFingerprint).filter(block => block.hash);
    const currentRoles = new Set(currentBlocks.map(block => block.role).filter(role => role && !String(role).startsWith('custom:')));
    const current = {
      tabId: tab?.id || '',
      roleSignature: makeRoleSignature(currentBlocks),
      structureSignature: makeStructureSignature(currentBlocks),
      blockHashes: currentBlocks.map(b => b.hash),
      blockCount: currentBlocks.length
    };

    if (!current.blockCount || currentRoles.size < 1) return null;

    const roleStats = {};
    graph.promptSnapshots
      .filter(snapshot => snapshot.tabId !== current.tabId)
      .map(snapshot => ({
        snapshot,
        roleScore: roleSimilarity(current, snapshot),
        structureScore: structureSimilarity(current, snapshot)
      }))
      .filter(match => Math.max(match.roleScore, match.structureScore * 0.82) >= minScore)
      .forEach(match => {
        const roles = String(match.snapshot.roleSignature || '').split(' > ').filter(Boolean);
        roles.forEach((role, roleIndex) => {
          if (!role || String(role).startsWith('custom:') || currentRoles.has(role)) return;
          const anchor = findNearestAnchor(currentBlocks, role, roles);
          const stat = roleStats[role] || {
            role,
            label: roleLabel(role),
            count: 0,
            bestScore: 0,
            lastSeenAt: 0,
            beforeVotes: {},
            afterVotes: {},
            preferredColumnVotes: {},
            sampleRoleIndexTotal: 0,
            sampleRoleIndexCount: 0,
            examples: []
          };
          stat.count += 1;
          stat.bestScore = Math.max(stat.bestScore, match.roleScore, match.structureScore * 0.82);
          stat.lastSeenAt = Math.max(stat.lastSeenAt, Number(match.snapshot.ts || 0));
          stat.sampleRoleIndexTotal += roleIndex;
          stat.sampleRoleIndexCount += 1;
          if (anchor.before?.id) stat.beforeVotes[anchor.before.id] = (stat.beforeVotes[anchor.before.id] || 0) + 1;
          if (anchor.after?.id) stat.afterVotes[anchor.after.id] = (stat.afterVotes[anchor.after.id] || 0) + 1;
          const preferredColumn = Number.isFinite(Number(anchor.before?.column))
            ? Number(anchor.before.column)
            : Number.isFinite(Number(anchor.after?.column)) ? Number(anchor.after.column) : null;
          if (preferredColumn !== null) stat.preferredColumnVotes[preferredColumn] = (stat.preferredColumnVotes[preferredColumn] || 0) + 1;
          if (stat.examples.length < 3) {
            stat.examples.push({
              tabName: match.snapshot.tabName || '',
              ts: match.snapshot.ts || 0,
              score: Math.max(match.roleScore, match.structureScore * 0.82),
              structure: match.snapshot.blockTitles || [],
              roles: match.snapshot.blockRoles || roles,
              roleIndex
            });
          }
          roleStats[role] = stat;
        });
      });

    const topVote = votes => Object.entries(votes || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || null;

    const items = Object.values(roleStats)
      .map(item => {
        const beforeVote = topVote(item.beforeVotes);
        const afterVote = topVote(item.afterVotes);
        const columnVote = topVote(item.preferredColumnVotes);
        const averageRoleIndex = item.sampleRoleIndexCount ? item.sampleRoleIndexTotal / item.sampleRoleIndexCount : roleOrderIndex(item.role);
        return {
          ...item,
          averageRoleIndex,
          placement: {
            insertAfterId: beforeVote?.[0] || '',
            insertBeforeId: !beforeVote && afterVote ? afterVote[0] : '',
            afterVotes: Number(beforeVote?.[1] || 0),
            beforeVotes: Number(afterVote?.[1] || 0),
            preferredColumn: columnVote ? Number(columnVote[0]) : null,
            roleOrderIndex: roleOrderIndex(item.role),
            averageRoleIndex
          },
          confidence: Math.min(0.9, 0.52 + Math.min(item.count, 6) * 0.045 + item.bestScore * 0.18)
        };
      })
      .filter(item => item.confidence >= 0.58)
      .sort((a, b) => b.confidence - a.confidence || b.count - a.count || b.lastSeenAt - a.lastSeenAt)
      .slice(0, limit);

    if (!items.length) return null;
    return {
      items,
      top: items[0],
      currentRoles: [...currentRoles],
      confidence: items[0].confidence
    };
  }

  function getBlockNode(hash) {
    const key = String(hash || '');
    return key ? (graph.blockNodes[key] || null) : null;
  }

  function normalizeTimelineSnapshot(snapshot = {}) {
    const roles = Array.isArray(snapshot.blockRoles) ? snapshot.blockRoles : [];
    const titles = Array.isArray(snapshot.blockTitles) ? snapshot.blockTitles : [];
    return {
      id: snapshot.id || '',
      ts: Number(snapshot.ts || 0),
      source: snapshot.source || '',
      name: String(snapshot.name || '').slice(0, 80),
      tabId: snapshot.tabId || '',
      tabName: snapshot.tabName || '',
      textHash: snapshot.textHash || '',
      structureHash: snapshot.structureHash || '',
      structureSignature: snapshot.structureSignature || '',
      roleSignature: snapshot.roleSignature || '',
      blockCount: Number(snapshot.blockCount || 0),
      chars: Number(snapshot.chars || 0),
      tokens: Number(snapshot.tokens || 0),
      blockTitles: titles.slice(0, 16),
      blockRoles: roles.slice(0, 16),
      blockHashes: Array.isArray(snapshot.blockHashes) ? snapshot.blockHashes.slice(0, 16) : [],
      roleLabels: roles.slice(0, 16).map(role => roleLabel(role, role))
    };
  }

  function findVersionTimeline(tab, options = {}) {
    const tabId = tab?.id || '';
    if (!tabId) return null;

    const limit = Math.max(2, Math.min(12, Number(options.limit || 6)));
    const snapshots = graph.promptSnapshots
      .filter(snapshot => snapshot.tabId === tabId)
      .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

    if (snapshots.length < 2) return null;

    const deduped = [];
    snapshots.forEach(snapshot => {
      const previous = deduped[deduped.length - 1];
      if (previous && previous.textHash === snapshot.textHash) return;
      deduped.push(snapshot);
    });

    if (deduped.length < 2) return null;

    const selected = deduped.slice(-limit).map(normalizeTimelineSnapshot);
    const transitions = [];
    for (let i = 1; i < selected.length; i += 1) {
      const from = selected[i - 1];
      const to = selected[i];
      transitions.push({
        fromId: from.id,
        toId: to.id,
        fromTs: from.ts,
        toTs: to.ts,
        diff: buildSnapshotDiff(from, to),
        score: structureSimilarity(from, to)
      });
    }

    const first = selected[0];
    const last = selected[selected.length - 1];
    const totalDiff = buildSnapshotDiff(first, last);
    const changedCount = transitions.filter(item => {
      const diff = item.diff || {};
      return diff.blockDelta !== 0
        || diff.tokensDelta !== 0
        || diff.titleDiff?.added?.length
        || diff.titleDiff?.removed?.length
        || diff.titleDiff?.reordered
        || diff.roleDiff?.reordered;
    }).length;

    return {
      tabId,
      tabName: last.tabName || tab?.name || '',
      snapshots: selected,
      transitions,
      first,
      last,
      totalDiff,
      versionCount: selected.length,
      changedCount,
      confidence: Math.min(0.88, 0.56 + Math.min(selected.length, 6) * 0.035 + Math.min(changedCount, 5) * 0.025)
    };
  }

  function captureNamedVersion(name) {
    return captureSnapshot('manual.named-version', {
      force: true,
      name: String(name || '').trim() || 'Ручная версия'
    });
  }

  function captureBaselineFromCurrent(name) {
    const snapshot = captureSnapshot('manual.baseline-update', {
      force: true,
      name: String(name || '').trim() || 'Baseline · текущая структура'
    });
    if (!snapshot?.id || !snapshot?.tabId) return null;

    const baseline = pinBaseline(snapshot.id, snapshot.tabId);
    if (!baseline) return null;

    return {
      snapshot: normalizeTimelineSnapshot(snapshot),
      baseline
    };
  }

  function getNamedVersions(tabId = '') {
    const targetTabId = String(tabId || window.State?.getActive?.()?.id || '');
    return graph.promptSnapshots
      .filter(snapshot => String(snapshot.name || '').trim())
      .filter(snapshot => !targetTabId || snapshot.tabId === targetTabId)
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, 12)
      .map(normalizeTimelineSnapshot);
  }

  function getNamedVersionById(id = '') {
    const key = String(id || '');
    if (!key) return null;
    const snapshot = graph.promptSnapshots.find(item => item.id === key && String(item.name || '').trim());
    return snapshot ? normalizeTimelineSnapshot(snapshot) : null;
  }

  function getPinnedBaseline(tabId = '') {
    const targetTabId = String(tabId || window.State?.getActive?.()?.id || '');
    if (!targetTabId) return null;
    const ref = graph.baselines?.byTabId?.[targetTabId];
    if (!ref?.snapshotId) return null;
    const version = getNamedVersionById(ref.snapshotId);
    if (!version) {
      delete graph.baselines.byTabId[targetTabId];
      saveSoon();
      return null;
    }
    return {
      ...ref,
      version,
      missing: false
    };
  }

  function pinBaseline(versionId = '', tabId = '') {
    const version = getNamedVersionById(versionId);
    if (!version) return null;
    const targetTabId = String(tabId || version.tabId || window.State?.getActive?.()?.id || '');
    if (!targetTabId || version.tabId !== targetTabId) return null;
    graph.baselines.byTabId[targetTabId] = {
      snapshotId: version.id,
      tabId: targetTabId,
      name: version.name || 'Baseline',
      textHash: version.textHash || '',
      structureHash: version.structureHash || '',
      pinnedAt: now()
    };
    saveNow();
    return getPinnedBaseline(targetTabId);
  }

  function unpinBaseline(tabId = '') {
    const targetTabId = String(tabId || window.State?.getActive?.()?.id || '');
    if (!targetTabId || !graph.baselines?.byTabId?.[targetTabId]) return false;
    delete graph.baselines.byTabId[targetTabId];
    saveNow();
    return true;
  }

  function comparePinnedBaselineToCurrent(tab = window.State?.getActive?.(), text = window.Preview?.getText?.() || '') {
    const baseline = getPinnedBaseline(tab?.id || '');
    if (!baseline?.version) return null;
    const comparison = compareNamedVersionToCurrent(baseline.version.id, tab, text);
    return comparison ? { baseline, comparison } : null;
  }

  function compareNamedVersions(fromId = '', toId = '') {
    const from = getNamedVersionById(fromId);
    const to = getNamedVersionById(toId);
    if (!from || !to || from.id === to.id) return null;

    return compareSnapshots(from, to);
  }

  function makeCurrentSnapshot(tab, text = '') {
    const currentText = String(text != null ? text : (window.Preview?.getText?.() || ''));
    const blocks = getTextBlocks(tab).map(makeBlockFingerprint).filter(block => block.hash);
    if (!tab?.id || !currentText.trim() || !blocks.length) return null;

    const structureSignature = makeStructureSignature(blocks);
    const roleSignature = makeRoleSignature(blocks);

    return normalizeTimelineSnapshot({
      id: 'current',
      ts: now(),
      source: 'current.preview',
      name: 'Текущая структура',
      tabId: tab.id || '',
      tabName: String(tab.name || '').slice(0, 80),
      textHash: hashText(currentText),
      structureHash: hashText(structureSignature),
      structureSignature,
      roleSignature,
      chars: currentText.length,
      tokens: estimateTokens(currentText),
      blockCount: blocks.length,
      blockHashes: blocks.map(b => b.hash),
      blockTitles: blocks.map(b => b.title).slice(0, 16),
      blockRoles: blocks.map(b => b.role || titleRole(b.title)).slice(0, 16)
    });
  }

  function compareSnapshots(from = null, to = null) {
    if (!from || !to || from.id === to.id) return null;
    const diff = buildSnapshotDiff(from, to);
    const score = structureSimilarity(from, to);
    return {
      from,
      to,
      diff,
      score,
      sameTab: Boolean(from.tabId && from.tabId === to.tabId),
      tabName: to.tabName || from.tabName || '',
      confidence: Math.min(0.92, 0.58 + score * 0.28 + Math.min(0.08, Math.abs(diff.tokensDelta || 0) / 10000))
    };
  }

  function compareNamedVersionToCurrent(versionId = '', tab = window.State?.getActive?.(), text = window.Preview?.getText?.() || '') {
    const from = getNamedVersionById(versionId);
    const to = makeCurrentSnapshot(tab, text);
    if (!from || !to || from.textHash === to.textHash) return null;
    return compareSnapshots(from, to);
  }

  function findNamedVersionDrift(tab, options = {}) {
    const text = options.text != null ? String(options.text || '') : (window.Preview?.getText?.() || '');
    const current = makeCurrentSnapshot(tab, text);
    if (!current) return null;

    const versions = getNamedVersions(current.tabId);
    if (!versions.length) return null;

    const candidates = versions
      .filter(version => version.textHash !== current.textHash)
      .map(version => {
        const comparison = compareSnapshots(version, current);
        const diff = comparison?.diff || {};
        const titleAdded = diff.titleDiff?.added?.length || 0;
        const titleRemoved = diff.titleDiff?.removed?.length || 0;
        const roleAdded = diff.roleDiff?.added?.length || 0;
        const roleRemoved = diff.roleDiff?.removed?.length || 0;
        const structuralDelta = Math.abs(diff.blockDelta || 0) + titleAdded + titleRemoved + roleAdded + roleRemoved;
        const tokenDeltaAbs = Math.abs(diff.tokensDelta || 0);
        const reordered = Boolean(diff.titleDiff?.reordered || diff.roleDiff?.reordered);
        const changed = structuralDelta > 0 || tokenDeltaAbs >= 180 || reordered;
        if (!comparison || !changed) return null;
        const driftScore = Math.min(1, structuralDelta * 0.18 + Math.min(0.32, tokenDeltaAbs / 3500) + (reordered ? 0.12 : 0));
        return {
          version,
          comparison,
          driftScore,
          confidence: Math.min(0.91, 0.6 + driftScore * 0.28 + (String(version.name || '').trim() ? 0.04 : 0))
        };
      })
      .filter(Boolean)
      .filter(item => item.confidence >= (options.minConfidence || 0.64))
      .sort((a, b) => b.confidence - a.confidence || Number(b.version.ts || 0) - Number(a.version.ts || 0));

    const best = candidates[0];
    if (!best) return null;
    return {
      ...best,
      candidates: candidates.slice(0, Math.max(1, Number(options.limit || 4))),
      current
    };
  }

  function getDiagnostics() {
    updateCounters();
    return {
      storageKey: STORAGE_KEY,
      schemaVersion: graph.schemaVersion,
      semanticTitleAliases: Object.keys(TITLE_ROLE_ALIASES).length,
      semanticRoleOrder: ROLE_ORDER.length,
      createdAt: graph.createdAt,
      updatedAt: graph.updatedAt,
      counters: { ...(graph.counters || {}) },
      snapshots: graph.promptSnapshots.length,
      blockNodes: Object.keys(graph.blockNodes || {}).length,
      namedSnapshots: graph.promptSnapshots.filter(snapshot => String(snapshot.name || '').trim()).length,
      pinnedBaselines: Object.keys(graph.baselines?.byTabId || {}).length,
      activeBaseline: getPinnedBaseline(window.State?.getActive?.()?.id || ''),
      retention: getRetention(),
      estimatedBytes: (() => { try { return JSON.stringify(graph).length; } catch (_) { return 0; } })(),
      oftenWith: Object.keys(graph.relations?.oftenWith || {}).length,
      derivedFrom: Object.keys(graph.relations?.derivedFrom || {}).length,
      recentDerivedFrom: Object.values(graph.relations?.derivedFrom || {})
        .sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0))
        .slice(0, 5)
        .map(item => ({
          fromTabName: item.fromTabName || '',
          toTabName: item.toTabName || '',
          count: item.count || 0,
          lastSeenAt: item.lastSeenAt || 0,
          fromBlockTitles: item.fromBlockTitles || [],
          toBlockTitles: item.toBlockTitles || []
        }))
    };
  }

  function reset() {
    graph = createDefaultGraph();
    lastSnapshotAt = 0;
    lastSnapshotHash = '';
    _simCache.clear();
    saveNow();
    return graph;
  }

  function exportData() {
    try {
      return JSON.parse(JSON.stringify(graph));
    } catch (err) {
      console.warn('[ProjectGraph] export failed:', err);
      return normalizeGraph({});
    }
  }

  function importData(raw) {
    graph = normalizeGraph(raw);
    graph.updatedAt = now();
    lastSnapshotAt = 0;
    lastSnapshotHash = '';
    _simCache.clear();
    saveNow();
    return graph;
  }

  window.ProjectGraph = {
    STORAGE_KEY,
    captureSnapshot,
    findSimilarPrompt,
    getFrequentCompanions,
    captureNamedVersion,
    captureBaselineFromCurrent,
    getNamedVersions,
    getNamedVersionById,
    getPinnedBaseline,
    pinBaseline,
    unpinBaseline,
    comparePinnedBaselineToCurrent,
    compareNamedVersions,
    compareNamedVersionToCurrent,
    findNamedVersionDrift,
    getRetention,
    setRetention,
    cleanup,
    findOftenWith,
    findDerivedFrom,
    findVersionTimeline,
    findRoleGaps,
    buildSnapshotDiff,
    normalizeTitle,
    titleRole,
    roleLabel,
    roleOrderIndex,
    getBlockNode,
    getDiagnostics,
    exportData,
    importData,
    reset,
    save: saveNow
  };
})();