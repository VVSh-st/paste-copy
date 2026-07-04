## Роль
Ты — старший фронтенд-разработчик и аудитор безопасности. Твоя задача — ревью файла `intelligence-core.js` (1339 строк) из веб-приложения для работы с промптами (vanilla JS, IIFE, нет фреймворков).

## Контекст проекта
- Модульная архитектура: `blocks.js` (UI), `state.js` (State/Events), `ui.js` (preview), `styles.css`, `translator.js`, `notepad.js`
- `intelligence-core.js` — ядро интеллектуальной системы подсказок: события, context snapshot, scoring, prediction, action handlers
- Публичный API: `window.Intelligence` — `init`, `track`, `trackEdit`, `getContext`, `getSuggestions`, `getMenuSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `openPreparedReport`, `refresh`, `hashText`
- Singleton через `initialized` flag
- Зависимости (через `window.*`): `State`, `UserMemory`, `QualityDetectors`, `ProjectGraph`, `SmartSuggestions`, `Toast`, `LLMFeatures`, `PromptLoom`, `Preview`, `Storage`, `Templates`
- Система подсказок: visible (до 3) + menu (до 8), personalization, confidence scoring, cooldown
- Project Graph интеграция: version timeline, derived-from, similar prompt, role gaps, companion blocks, pinned baseline drift, named version drift
- Edit session tracking: debounce 1300ms, large-change detection (≥900 chars)
- Finality score: копирование + экспорт + стабильность + структура + конфликты + reuse
- Сниппеты: автоматическое определение кандидатов из PromptLoom, сохранение через State
- Шаблоны: сохранение текущей вкладки как шаблона через Storage
- Structure splitting: разбиение длинного текста на блоки по секциям
- Event tracking: `track()` → `UserMemory.recordEvent()`, `trackEdit()` → edit sessions
- Сортировка и фильтрация подсказок по confidence, priority, cooldown,重复 detection

## Твоя задача
Проведи детальный аудит `intelligence-core.js` и выдай список конкретных, безопасных улучшений. Каждое улучшение должно содержать:
1. **Что не так** — конкретная проблема или баг
2. **Где** — номер строки и контекст
3. **Почему** — влияние на пользователей или стабильность
4. **Как исправить** — конкретный патч (старый код → новый)

## ПРИОРИТЕТЫ (в порядке важности)
1. **Критические баги** — race conditions, memory leaks, infinite loops, неработающий функционал
2. **UX-проблемы** — что ломает пользовательский опыт или вызывает путаницу
3. **Производительность** — что замедляет UI при большом объёме данных
4. **Читаемость кода** — сложные/дублированные участки, которые стоит упростить

## ОБЛАСТИ АУДИТА (обязательно проверь все)

### 1. Memory & Lifecycle
- `editSessions` Map — растёт ли бесконечно? Очищается ли при закрытии вкладок?
- `lastSuggestions` / `lastMenuSuggestions` — хранят ссылки на DOM-объекты или чистые данные?
- `refreshTimer` — корректно ли отменяется при `init()` повторном вызове?
- `initialized` flag — предотвращает ли повторную инициализацию?
- `beforeunload` listener — удаляется ли?

### 2. State Management
- `lastContext` — перезаписывается при каждом `getContext()`, что если вызов параллельный?
- `getContext()` вызывает `safePreviewText()` + `QualityDetectors.analyzePreview()` — тяжёлые вычисления, нет кэширования
- `refresh()` дублирует вызовы `ProjectGraph.*` из `getContext()` — двойная работа?
- `predict()` зависит от `ctx.analysis` — что если analysis ещё не готов?

### 3. Suggestion System
- `prepareSuggestions()`: фильтрация через `isSamePreparedAction` — O(n²) сравнение?
- `suggestionSortScore()`: priority/1000 может быть менее приоритетным чем confidence
- `personalizeConfidence()`: `ignoredPenalty` только при `ignored >= 5` — порог обоснован?
- `SAME_SUGGESTION_COOLDOWN = 10min` — может ли это блокировать полезные подсказки?
- `confidence >= 0.55` фильтр — что если все подсказки ниже порога?

### 4. Event Tracking
- `track()`: вызывает `UserMemory.recordEvent()` — что если UserMemory не загружен?
- `trackEdit()`: `editSessions.get(key)` после `editSessions.set()` — избыточно?
- `normalizePayload()`: `delete clean.text` — мутирует payload?
- `track()` + `scheduleRefresh()`: каждый вызов перепланирует refresh — может ли это вызвать infinite loop?

### 5. Project Graph Integration
- `getContext()` вызывает 8+ методов ProjectGraph — что если один из них падает?
- `refresh()` заново вызывает все ProjectGraph-методы — дублирование с `getContext()`?
- `applyProjectGraphPriorityPolicy()`: `hidden` и `menuOnly` логика — понятна ли она?
- `hasMeaningfulDiff()`: проверяет diff, но `return true` если `!diff` — значит "значимо"?

### 6. Structure Splitting
- `applyStructureCandidate()`: `State.update()` с мутацией `source.subtabs[idx].value = ''` — очистка исходного блока
- `insertAfter()`: рекурсивный поиск в groups — что если group深度 большая?
- `getStructureSections()`: `QualityDetectors.splitIntoSections()` — может вернуть []

### 7. Snippet & Template Saving
- `saveSnippetFromSuggestion()`: `prompt()` — блокирующий UI
- `saveTemplateFromSuggestion()`: `JSON.parse(JSON.stringify(tab.blocks))` — deep clone, может быть тяжело
- `isExistingGlobalSnippet()`: linear scan по всем snippets — O(n) на каждый вызов

### 8. XSS & Security
- `escapeHtml()` используется в `renderBody` — но `innerHTML` всё равно применяется
- `makeSnippetTitle()`: пользовательский текст в title — XSS через title?
- `renderReportLines()`: fallback на `alert()` — XSS через `\n` в данных?
- `prompt()` в `saveSnippetFromSuggestion` и `saveTemplateFromSuggestion` — user input напрямую

### 9. Edge Cases
- `hashText()`: FNV-1a hash — коллизии возможны, но маловероятны
- `computeFinality()`: `lastCopy` ищется через `[...recent].reverse().find()` — O(n) каждый раз
- `findSnippetCandidate()`: сортировка через `sort()` — мутирует исходный массив?
- `preferredColumnForNewBlock()`: сравнивает left/right count — не учитывает группы

### 10. Performance
- `getContext()`: вызывает `safePreviewText()` + `QualityDetectors.analyzePreview()` + 8 ProjectGraph-запросов — всё синхронно?
- `refresh()`: нет debounce guard — если `scheduleRefresh(60)` вызывается часто, refresh может запускаться каждые 60ms
- `stableStringify()`: рекурсивная сериализация — stack overflow на циклических ссылках?
- `_byteLen()` в notepad.js использует `TextEncoder` — а здесь `hashText()` использует charCodeAt

## ОГРАНИЧЕНИЯ (важно!)
- Не предлагай добавлять тесты
- Не предлагай менять публичный API (`window.Intelligence`)
- Не предлагай добавлять зависимости
- Не предлагай TypeScript/migration/переписывание на классы
- Не предлагай менять архитектуру (оставить IIFE)
- Каждое улучшение должно быть САМОСТОЯТЕЛЬНЫМ — не требовать других изменений из этого списка
- Если предложение требует изменения `state.js` / `UserMemory` / `ProjectGraph` — укажи это явно, но лучше избегай

## Формат вывода
Для каждого улучшения:
```
### [N] [Критично/UX/Производительность/Читаемость] Краткое описание

**Проблема:** Что не так
**Строки:** диапазон или конкретная строка
**Влияние:** На что влияет
**Патч:**
```diff
- старый код
+ новый код
```
```

После списка — краткую итоговую сводку (сколько критических, сколько UX, общая оценка качества кода).

## Файл для ревью

Приложи полное содержимое `intelligence-core.js` (1339 строк) после этого промпта.
