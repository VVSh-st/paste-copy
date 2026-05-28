# Intelligence Layer / Memory Sync Stage 3

Дата: 2026-05-23

## Общий контекст проекта

Проект: `E:\Cherry_studio` / LLM Prompt Builder.

Рабочий язык ответов пользователю: русский. Если меняется код — возвращать полный код каждого изменённого файла, но при работе через MCP и явной просьбе «код в чат не пиши» давать только краткий отчёт.

Важная директория межчатового контекста:

```text
E:\Cherry_studio\_ai_context
```

Перед изменениями рабочих файлов по проектному workflow нужно читать релевантные места, делать backup в `_ai_backups/YYYY-MM-DD_HH-mm-ss/`, затем править минимально и проверять grep/read/browser.

## Intelligence Layer: архитектура

Цель Intelligence Layer — тихий deterministic слой, а не чат/навязчивый ассистент:

- наблюдает действия пользователя;
- считает prepared actions;
- показывает 1–3 полезные подсказки в smart strip / Smart menu;
- не вызывает LLM автоматически;
- не меняет текст без подтверждения;
- не синхронизирует данные без явного включения.

Главная privacy-граница:

- `UserMemory` и `ProjectGraph` не должны хранить полный пользовательский текст;
- допускаются hashes, fingerprints, block titles, roles, counts, token estimates, structure signatures, timestamps, безопасные метаданные;
- нельзя автоматически менять текст, удалять блоки, вызывать LLM, синхронизировать Gist или сохранять snippets/templates без подтверждения пользователя.

## Актуальный порядок скриптов

В `index.html` порядок Intelligence/Memory скриптов должен быть таким:

```html
<script src="prompt-loom.js"></script>
<script src="user-memory.js"></script>
<script src="quality-detectors.js"></script>
<script src="project-graph.js"></script>
<script src="memory-sync.js"></script>
<script src="smart-suggestions.js"></script>
<script src="intelligence-core.js"></script>
<script src="app.js"></script>
```

`memory-sync.js` подключается после `project-graph.js`, потому что использует `UserMemory.exportData/importData` и `ProjectGraph.exportData/importData`.

`smart-suggestions.js` остаётся до `intelligence-core.js`, потому что `Intelligence.init()` делает refresh и должен уже видеть `window.SmartSuggestions`.

Smart suggestions strip должен находиться внутри `preview-panel` между `preview-bar` и `preview-content`.

## Stage 1 — UserMemory / Quality / Intelligence / Smart UI

Считать практически закрытым.

Основные файлы:

- `prompt-loom.js`
- `user-memory.js`
- `quality-detectors.js`
- `intelligence-core.js`
- `smart-suggestions.js`

`prompt-loom.js` должен экспортировать:

- `classify`
- `hashText`
- `similarityScore`
- `tokenSignature`

`user-memory.js`:

- localStorage key: `llm-pb-user-profile-v1`;
- хранит локальный privacy-safe профиль, counters, behavior, style, promptPatterns, personalScores, suggestions;
- recent events должны хранить только безопасные метаданные, без полного текста;
- есть `exportData()` / `importData()` для Stage 3.

`quality-detectors.js`:

- deterministic-анализ preview/tab;
- duplicates, placeholders, format conflicts, structure, heavy blocks;
- `splitIntoSections`, `findStructureCandidate`.

`intelligence-core.js` публичный API:

- `init`
- `track`
- `trackEdit`
- `getContext`
- `getSuggestions`
- `getMenuSuggestions`
- `acceptSuggestion`
- `dismissSuggestion`
- `hashText`
- `refresh`
- `openPreparedReport`

Stage 1 suggestions:

- `compress-large-text`
- `detect-duplicates`
- `save-as-template`
- `structure-pasted-text` — только preview/confirm перед изменением структуры;
- `extract-snippet` — только с подтверждением пользователя.

## Stage 2 — ProjectGraph

Считать реализованным примерно на 85–90%, требуется финальная регрессия.

Файл: `project-graph.js`.

localStorage key:

```text
llm-pb-project-graph-v1
```

ProjectGraph хранит privacy-safe структуру:

- snapshots;
- block nodes;
- relations;
- baselines;
- retention config;
- titles/roles/counts/hashes/token estimates/structure signatures;
- без полного текста.

Основные Stage 2 features:

- `similar-prompt-found`
- `often-with-found`
- safe companion skeleton insertion
- semantic title aliases:
  - `Формат` ≈ `Output` ≈ `Вывод`
  - `Контекст` ≈ `Context` ≈ `Background`
  - `Требования` ≈ `Constraints` ≈ `Rules`
  - `Задача` ≈ `Task` ≈ `Goal`
  - `Примеры` ≈ `Examples` ≈ `Samples`
- `title-role-gap`
- role-gap placement
- manual placement selector
- `derived-from-version` privacy-safe diff
- `version-timeline` report
- capture named version
- compare named versions
- `named-version-compare` drift
- pinned baseline
- quick baseline update
- baseline status badge in Smart menu
- ProjectGraph suggestion priority policy
- cleanup/retention controls

ProjectGraph priority policy:

```text
pinned-baseline-compare
  > named-version-compare
  > derived-from-version
  > version-timeline
  > similar-prompt-found
  > title-role-gap
  > often-with-found
```

Если более сильная ProjectGraph-подсказка уже есть, более слабые должны уходить только в Smart menu, а не шуметь в strip.

Недавняя важная правка Stage 2:

- `PROJECT_GRAPH_MENU_ONLY_WHEN_SUPERSEDED` в `intelligence-core.js` должен включать все ProjectGraph-типы, включая `title-role-gap` и `often-with-found`.
- Иначе слабые подсказки могут остаться strip-кандидатами при наличии более сильной ProjectGraph-подсказки.

Cleanup/retention:

- В Settings → Intelligence есть кнопка `🧹 Очистка ProjectGraph`.
- `ProjectGraph` API:
  - `getRetention()`
  - `setRetention(next)`
  - `cleanup(options)`
  - `exportData()`
  - `importData(raw)`
- `DEFAULT_RETENTION` примерно:

```js
{
  maxSnapshots: 80,
  maxBlockNodes: 240,
  maxRelations: 300,
  maxAgeDays: 0,
  preserveNamed: true,
  preserveBaselines: true,
  pruneUnreferencedBlocks: false
}
```

Diagnostics:

- показывает storage size и retention;
- `maxAgeDays` выводить через `??`, чтобы `0` отображался как `0d`, а не пустое значение;
- в diagnostics footer добавлен быстрый вход в `Очистка ProjectGraph`.

## Stage 3 — Memory Sync

Stage 3 начат и базово реализован.

Главный принцип: `memory-sync.js` — отдельный модуль синхронизации privacy-safe метаданных, не расширение основного `GistSync` и не синхронизация полного документа.

Файл:

```text
memory-sync.js
```

Связанные файлы:

- `index.html`
- `app.js`
- `project-graph.js`
- `user-memory.js`
- `gist-sync.js` только как транспорт/источник Gist settings/API, но не как payload основного документа.

UI:

- В Settings → Intelligence добавлена кнопка:

```text
☁ Синхронизация памяти
```

- ID кнопки: `btn-memory-sync`.
- В `app.js` должен быть один handler для `btn-memory-sync`.
- `MemorySync.init()` вызывается после `GistSync.init()`.

MemorySync storage key:

```text
llm-pb-memory-sync-v1
```

Sync должен быть disabled by default.

`memory-sync.js` должен:

- экспортировать `window.MemorySync`;
- иметь `init()`;
- открывать отдельный modal через `openDialog()` / аналогичный публичный метод;
- делать push/pull только после явного включения пользователем;
- отправлять в Gist отдельный файл `llm-memory.json`;
- не трогать основной gist payload документа;
- не синхронизировать полный текст prompt/block/snippets;
- использовать только явные safe exports:
  - `UserMemory.exportData()`
  - `ProjectGraph.exportData()`
- импортировать только через:
  - `UserMemory.importData(raw)`
  - `ProjectGraph.importData(raw)`

Важная privacy-правка:

- В `MemorySync` убран fallback на `UserMemory.getProfile()`.
- Причина: даже если текущий профиль privacy-safe, future regression не должен случайно расширить sync до более широкого объекта.
- Экспорт памяти должен идти только через явный `exportData()`.

Важная auto-push/dirty правка:

- Изначально `wrapSaveHooks()` был недостаточен, потому что `UserMemory` и `ProjectGraph` часто сохраняются внутренними `saveNow()`, а не через публичный `.save()`.
- Нужно оборачивать реальные публичные mutator-методы, чтобы dirty-state/auto-push срабатывал после фактических изменений.
- При `pull()` должен включаться suppression, чтобы импорт из Gist не запускал обратный auto-push.
- `schedulePush()` должен проверять suppress-флаг и не планировать push во время импортной фазы.

Публичные mutators, которые важно учитывать при dirty/auto-push:

UserMemory:

- `recordEvent`
- `recordSuggestion`
- `markSuggestionAccepted`
- `markSuggestionDismissed`
- `importData`
- `reset` / аналогичные safe-mutators, если есть

ProjectGraph:

- `captureSnapshot`
- `captureNamedVersion`
- `captureBaselineFromCurrent`
- `pinBaseline`
- `unpinBaseline`
- `setRetention`
- `cleanup`
- `importData`
- `reset`

Не обязательно все имена есть в файле; перед следующими правками нужно проверить фактический API через grep/read.

GitHub Gist PATCH для memory sync:

- должен отправлять только изменяемый файл `llm-memory.json`;
- не нужно отправлять весь объект `gist.files`, чтобы случайно не повредить основной Gist payload.

Ожидаемый bundle `llm-memory.json`:

- версия/тип bundle;
- timestamp;
- `userMemory` из `UserMemory.exportData()`;
- `projectGraph` из `ProjectGraph.exportData()`;
- без полного пользовательского текста.

## Текущее состояние проверок

Stage 3 после живой браузерной регрессии 2026-05-23 можно считать базово закрытым.

Статически и в браузере проверено:

- `memory-sync.js` существует и подключается в `index.html` ровно один раз;
- `app.js` содержит один `window.MemorySync?.init()` и один обработчик `btn-memory-sync`;
- `ProjectGraph.exportData/importData` добавлены;
- `UserMemory.exportData/importData` есть;
- `GistSync.openDialog()` существует;
- `window.MemorySync`, `window.UserMemory`, `window.ProjectGraph`, `window.GistSync`, `window.Intelligence` доступны в runtime;
- modal `#memory-sync-modal` создаётся в одном экземпляре и не дублируется при повторном открытии;
- sync выключен по умолчанию: `enabled:false`, `autoPush:false`, `autoPull:false`, `dirty:false`;
- кнопки `Отправить сейчас` и `Загрузить из Gist` disabled, если sync выключен, Gist не подключён, идёт локальная пауза, rate-limit пауза или исчерпан локальный request budget;
- в modal показывается `Квота запросов` и короткая подсказка, почему запрос сейчас недоступен;
- push-блок делает один `PATCH` и отправляет только файл `llm-memory.json`, без предварительного `GET`;
- pull использует `GET`, импортирует `userMemory/projectGraph` под `suppressSchedule` и не должен провоцировать обратный auto-push;
- hash bundle считается по стабильному содержимому safe-метаданных, без `updatedAt` и шумной телеметрии;
- `recordEvent`/собственная telemetry MemorySync не запускают sync-loop;
- после GitHub rate limit включается локальная пауза, pending auto-push очищается;
- auto-push сильно throttled: большой debounce, большой minimum interval, локальная квота запросов;
- scoped CSS для `#memory-sync-modal` переносит длинные статусы, даты, метрики и ошибки.

Живая проверка `file:///E:/Cherry_studio/index.html`:

```js
window.MemorySync.openDialog()
```

Подтверждено:

- `memory-sync.js` scripts count: `1`;
- `#btn-memory-sync` count: `1`;
- `#memory-sync-modal` count: `1`;
- modal display: `flex` после открытия;
- default settings: sync выключен, autoPush/autoPull выключены;
- при выключенном sync manual push/pull кнопки disabled;
- текст modal содержит `Квота запросов`, privacy warning и локальные метрики.

## Что считать завершённым в Stage 3

Stage 3 MemorySync/Gist metadata sync реализован как отдельный privacy-safe слой:

- файл: `memory-sync.js`;
- localStorage key: `llm-pb-memory-sync-v1`;
- Gist file: `llm-memory.json`;
- disabled by default;
- работает только после ручного включения;
- не синхронизирует полный текст;
- использует только `UserMemory.exportData()` и `ProjectGraph.exportData()`;
- не смешивается с основным payload `GistSync`;
- push не трогает остальные файлы gist;
- request budget защищает от сжигания GitHub limit.

## Что можно улучшать позже, но не блокирует Stage 3

- Dry-run preview содержимого `llm-memory.json` перед первым push.
- Более подробный UI с причиной disabled state для `not_connected` и `disabled`.
- Кнопка «Сбросить локальную паузу» только для диагностики/разработки.
- Более глубокий тест с реальным Gist после сброса GitHub API rate limit.
- Optional export/import локального `llm-memory.json` без GitHub.

## Важные edge cases для Stage 1/2/3

- нет активной вкладки;
- пустой preview;
- нет named versions;
- baseline указывает на удалённый snapshot;
- cleanup с preserve flags off;
- duplicate suggestion между strip/menu;
- Smart menu events не дублируются после reload;
- placement column сохраняется;
- medium-confidence suggestions не теряются;
- Memory Sync disabled by default;
- Memory Sync не синхронизирует полный текст;
- Memory Sync pull не провоцирует обратный push;
- Memory Sync repeated modal open не дублирует handlers;
- Memory Sync не делает GET перед PATCH при push;
- Memory Sync уважает локальный request budget и GitHub rate-limit паузу.

## Дальнейшее направление

После Stage 3:

- Stage 3 считать базово завершённым;
- next polish: dry-run preview bundle, улучшение подсказок disabled-state, ручной локальный export/import;
- Stage 4 — optional semantic/LLM layer, только когда deterministic layer не уверен;
- Stage 4 не должен включаться автоматически и не должен нарушать privacy-границы.
