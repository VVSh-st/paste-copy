# Prompt: project-graph.js — GPT audit round 2

Ты — GPT-5, coding agent. Проведи аудит файла `project-graph.js`.

**Контекст проекта:**
- IIFE-модуль, vanilla JS, localStorage persistence
- Граф проекта для Intelligence Layer: снапшоты промптов, relations, block nodes, baselines
- Используется Intelligence-core.js для подсказок, сравнений, таймлайнов

## Исключить (уже исправлено в предыдущих раундах)
- Sanitize import: sanitizeSnapshot, isPlainObject, safeStr, limitedEntriesObject, sanitizeImportedGraph
- Safe save: copy→JSON.stringify→assign updatedAt on success, retry on non-quota error
- Safe export: try/catch fallback to empty normalizeGraph({})
- Pair dedup: dedup blocks by hash before O(n²) loop, pair limit (2×maxRelations), skip self-pairs
- trimGraph guard: only call when limits actually exceeded, else just updateCounters()
- structureSimilarity cache: Map keyed by sorted id/textHash pairs, cleared on reset/import
- normalizeGraph: blockNodes/relations use limitedEntriesObject with retention limits
- exportData/importData: try/catch on serialization

## Что искать (НОВЫЕ проблемы, не из списка выше)
1. **Критично**: data loss, race conditions, silent corruption
2. **Производительность**: O(n²) без лимитов, лишние пересчёты, memory leaks
3. **UX**: невидимые ошибки, потеря данных при экспорте/импорте
4. **Читаемость**: сложная логика, неочевидные зависимости

Если предыдущий раунд уже исправил проблему — НЕ предлагай её снова.

**Формат вывода:**
- Номер, тип (Критично/Перф/UX/Чит), краткое описание проблемы
- Строки (номера или ~номера)
- Влияние (1-2 предложения)
- Патч (diff)
