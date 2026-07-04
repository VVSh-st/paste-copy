# Аудит project-graph.js

## Контекст

Это GPT-раунд аудита файла `project-graph.js` (1249 строк) — локальная карта проекта для Intelligence Layer. Модуль хранит fingerprint'ы блоков, снапшоты промптов, связи (oftenWith, derivedFrom), именованные версии, baselines и role gaps. Данныеersist через localStorage с debounce.

Файл уже прошёл предварительный анализ. Ты проводишь **отдельный независимый раунд** аудита.

## Формат ответа

Для каждого замечания:
1. **Тип:** Критично / UX / Производительность / Читаемость
2. **Проблема:** что не так
3. **Строки:** номера строк (приблизительно)
4. **Влияние:** что сломается
5. **Патч:** unified diff или описание изменения

## Что НЕ предлагать

Уже исправлено в предыдущих модулях (не повторяй эти паттерны):

- Fault isolation: safeCall, try/catch в track/refresh/getContext/acceptSuggestion
- Privacy: normalizePayload strips text/value/content/html/prompt/markdown
- Array.isArray guards: snippets, items, prepared.duplicates/heavyBlocks/oftenWith
- History/undo: pushHistory, MAX_HISTORY, per-tab history, _syncActiveTabValue
- Async safety: paste/translate sourceValue checks, runningSuggestionActions
- XSS: escapeHtml, sanitizeReportText, sanitizeUserTitle
- Performance: getContext cache, snapshot throttle, snippet Set, computeFinality single pass
- UX: hasMeaningfulDiff, dismiss by hash, previewCompanionBlock selectable, tab check
- Double-click guards, Escape value restore, titleEditing/renameEditing flags

## На что обратить особое внимание

1. **Потеря данных при сбое localStorage** — `saveNow()` делает `JSON.stringify(graph)` и `localStorage.setItem()`. Если graph содержит circular reference или localStorage переполнен, данные могут потеряться без восстановления.
2. **O(n²) в captureSnapshot** — вложенный цикл `for (let i...) for (let j...)` для oftenWith. При 240 блоках это ~28K итераций.
3. **Сравнение снапшотов** — `structureSimilarity()` вызывается много раз при `findSimilarPrompt`, `findDerivedFrom`, `findRoleGaps`, `findVersionTimeline`. Нет кэша промежуточных результатов.
4. **trimGraph() при каждом captureSnapshot** — полная пересортировка + обрезка всех снапшотов/узлов/связей.
5. **exportData()** — `JSON.parse(JSON.stringify(graph))` без защиты от circular references.
6. **importData()** — нет валидации входных данных.
7. **Счётчики** — `updateCounters()` пересчитывает всё с нуля при каждом вызове.
8. **getTextBlocks()** — обходит дерево блоков рекурсивно, вызывается при каждом `captureSnapshot` и каждом `findXxx`.
9. **Публичный API** — `window.ProjectGraph` экспортирует внутренние методы (`normalizeTitle`, `titleRole`, `roleLabel`), которые могут быть вызваны некорректно.
10. **Безопасность** — `importData()` принимает любой объект без валидации, может засорить localStorage.

Подавай результат на русском языке.
