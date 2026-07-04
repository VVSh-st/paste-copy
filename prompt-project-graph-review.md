# Prompt: project-graph.js — GPT audit round 6

Ты — GPT-5, coding agent. Проведи аудит файла `project-graph.js`.

**Контекст проекта:**
- IIFE-модуль, vanilla JS, localStorage persistence
- Граф проекта для Intelligence Layer: снапшоты промптов, relations, block nodes, baselines
- Используется Intelligence-core.js для подсказок, сравнений, таймлайнов

## Исключить (уже исправлено в предыдущих раундах)
- Sanitize import: sanitizeSnapshot, isPlainObject, safeStr, limitedEntriesObject, sanitizeImportedGraph, sanitizeBaselines
- Safe save/export/import: serialize→save→assign, try/catch fallback
- Pair dedup + trimGraph guard + structureSimilarity cache (cacheId with 'current' exclusion)
- normalizeGraph: limitedEntriesObject, sanitizeBaselines, migrateGraph
- counters: updateCounters sets snapshots to promptSnapshots.length
- trimSnapshotsByLimit: protected capped at limit
- MAX_SNAPSHOT_BLOCK_META=64, blockHashes limit 64, titleRole word-boundary
- rememberBlockNodes: blockNodes populated during captureSnapshot
- simCache: cleared in captureSnapshot, setRetention, cleanup, importData, reset
- findDerivedFrom: only earlier snapshots, tie-break by closest time
- trimObjectByLastSeen: preserve function for protected blockNodes/relations
- findRoleGaps: uses blockRoles directly instead of re-parsing roleSignature
- findSimilarPrompt: linear scan (no full sort for top-1)
- captureSnapshot cooldown: checks both textHash AND structureHash
- findVersionTimeline: named snapshots preserved in dedup
- snapshotView: shared helper for snapshot shape, normalizeTimelineSnapshot uses it
- compareNamedVersionToCurrent: returns { unchanged: true } when textHash matches
- getPinnedBaseline: options.cleanupMissing for read-only use in getDiagnostics

## Что искать (НОВЫЕ проблемы)
1. **Критично**: data loss, race conditions, silent corruption
2. **Производительность**: O(n²) без лимитов, лишние пересчёты
3. **UX**: невидимые ошибки, потеря данных
4. **Читаемость**: сложная логика, неочевидные зависимости

**Формат:** Номер, тип, описание, строки, влияние, патч (diff).
