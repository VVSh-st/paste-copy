# Intelligence Layer / ProjectGraph notes

Дата: 2026-05-22

## Что добавлено

- Stage 1 уже содержит:
  - `user-memory.js`
  - `quality-detectors.js`
  - `intelligence-core.js`
  - `smart-suggestions.js`
  - Smart strip, Smart menu, diagnostics/reset controls.
- Stage 2 начат минимальным `project-graph.js`.

## Важная связка файлов

Порядок скриптов в `index.html` важен:

```html
<script src="prompt-loom.js"></script>
<script src="user-memory.js"></script>
<script src="quality-detectors.js"></script>
<script src="project-graph.js"></script>
<script src="smart-suggestions.js"></script>
<script src="intelligence-core.js"></script>
<script src="app.js"></script>
```

`smart-suggestions.js` должен быть до `intelligence-core.js`, потому что `Intelligence.init()` делает refresh по таймеру и должен уже видеть `window.SmartSuggestions`.

## LocalStorage keys

- `llm-pb-user-profile-v1` — локальный профиль поведения пользователя.
- `llm-pb-project-graph-v1` — локальная карта проекта без хранения полного текста.

## Privacy

`ProjectGraph` не хранит полный текст блоков/prompts. Хранит fingerprints/hash, titles, counts, structure signatures, token estimates и связи:

- `oftenWith`
- `derivedFrom`

## Новые suggestions

- `similar-prompt-found`

Показывает, что похожая структура уже встречалась в другой вкладке/снимке. Действие только report, текст не меняет.

- `often-with-found`

Использует `ProjectGraph.relations.oftenWith`: если текущий блок раньше часто встречался вместе с другим блоком, которого сейчас нет в prompt, показывает prepared preview. Полный текст не хранится, поэтому действие умеет вставлять только безопасный каркас блока с названием/placeholder после явного подтверждения пользователя.

## Edge cases

- Empty preview не записывается в ProjectGraph.
- Snapshot refresh имеет cooldown.
- Copy/download/export пишут snapshot с `force: true`.
- Diagnostics показывает ProjectGraph metrics и умеет сбросить ProjectGraph отдельно от UserMemory.

## Следующие шаги

- Усилить similarity: учитывать порядок блоков и semantic title aliases.
- `often-with-found` теперь умеет безопасно вставлять каркас связанного блока после preview/confirm; полный текст по privacy-причинам не восстанавливается.
- Semantic title aliases добавлены в `project-graph.js`: `Формат`, `Output`, `Вывод` → `format`; `Контекст`, `Context`, `Background` → `context`; `Требования`, `Constraints`, `Rules` → `requirements` и т.д.
- `similar-prompt-found` теперь учитывает `roleSignature` помимо точных title/hash совпадений.
- `often-with-found` хранит role у source/companion и может лучше объяснять связи при разных языках названий.
- `title-role-gap` добавлен: ProjectGraph сравнивает semantic `roleSignature` текущей структуры с похожими snapshot и предлагает недостающую роль блока, например «Формат». Действие безопасное: сначала report/preview, затем вставка только пустого каркаса после подтверждения.
- `role-gap placement` реализован: `findRoleGaps()` теперь готовит `placement` с ближайшим предыдущим/следующим anchor-блоком по semantic order из похожих структур. `Intelligence.insertRoleGapSkeleton()` вставляет каркас после/перед anchor, а не просто append, и логирует только безопасный `placementMode`.
- `title-role-gap` preview modal теперь поддерживает ручной выбор: можно выбрать конкретную недостающую роль из списка и место вставки (`auto`, append, before/after существующего блока). Это защищает от неоднозначных anchors при низкой/средней уверенности placement.
- `derived-from-version` добавлен: ProjectGraph теперь умеет сравнивать текущую структуру с прошлым snapshot той же вкладки и строить privacy-safe diff по titles/roles/hashes/counts/tokens без хранения полного текста.
- Исправлен скрытый баг placement: `ProjectGraph.getTextBlocks()` больше не делегирует в `QualityDetectors.getTextBlocks()`, потому что тот не возвращал `column`; из-за этого role-gap placement мог терять колонку anchor-блока.
- Diagnostics показывает последние `derivedFrom` связи в ProjectGraph.
- `version-timeline` добавлен: ProjectGraph умеет строить mini timeline последних snapshot текущей вкладки через `findVersionTimeline(tab, { limit })`; отчёт показывает версии структуры, источники snapshot, изменение блоков/токенов и итоговый diff. Полный текст не хранится.
- `Intelligence` добавляет `versionTimeline` в context snapshot и показывает prepared action `version-timeline`, если есть минимум 3 версии и хотя бы одно структурное изменение.
- Проверено в браузере: API загружаются, `ProjectGraph.findVersionTimeline` экспортирован, `Intelligence.getContext()` содержит `versionTimeline`, runtime errors не пойманы.
- `capture named version` реализован: в Settings → Intelligence добавлена команда `🧭 Сохранить версию структуры`. Она открывает modal, просит имя версии и сохраняет privacy-safe snapshot через `ProjectGraph.captureNamedVersion(name)` с `source: manual.named-version`.
- Именованные версии хранят только `name`, titles, roles, counts, hashes, structure/role signatures, chars/tokens; полный текст не сохраняется.
- `ProjectGraph.getNamedVersions(tabId)` экспортирован и используется в modal для показа последних именованных версий текущей вкладки.
- Timeline report теперь показывает имя версии, если snapshot был сохранён вручную.
- Diagnostics показывает `Named` snapshot count.
- `named-version compare/report` реализован: в Settings → Intelligence добавлена команда `🔎 Сравнить версии структуры`. Она открывает modal с выбором двух именованных версий текущей вкладки и показывает privacy-safe diff по titles/roles/counts/tokens/structureScore без полного текста.
- `ProjectGraph.getNamedVersionById(id)` и `ProjectGraph.compareNamedVersions(fromId, toId)` экспортированы.
- `SmartSuggestions.openNamedVersionCompare()` добавлен и пишет безопасное событие `projectGraph.namedVersion.compare.opened` только после явного подтверждения просмотра diff.
- `named-version-compare` suggestion реализован: `ProjectGraph.findNamedVersionDrift(tab, { text })` сравнивает текущую структуру с последними именованными версиями текущей вкладки и возвращает privacy-safe drift, если есть заметное отличие по titles/roles/counts/tokens/order.
- `ProjectGraph.compareNamedVersionToCurrent(versionId, tab, text)` экспортирован для прямого сравнения именованной версии с текущим preview.
- `Intelligence` добавляет `namedVersionDrift` в context и показывает prepared action `named-version-compare`: “Структура изменилась после версии … · [Сравнить]”. Действие только открывает report `named-version-drift`, ничего не меняет.
- Исправлен скрытый баг diff именованных версий: `normalizeTimelineSnapshot()` теперь сохраняет `blockHashes`, иначе `structureSimilarity()` в compare/report терял hash-состав и мог занижать/искажать similarity.
- Проверено в браузере: `ProjectGraph.findNamedVersionDrift` и `compareNamedVersionToCurrent` экспортированы, suggestion появляется после изменения структуры после named version, report “Изменение после именованной версии” открывается без runtime errors.
- `pinned baseline` реализован: в Settings → Intelligence добавлена команда `📌 Baseline структуры`, которая позволяет закрепить одну именованную версию текущей вкладки как baseline или снять закрепление.
- `ProjectGraph` теперь хранит `baselines.byTabId` внутри `llm-pb-project-graph-v1`; это только ссылка на named snapshot (`snapshotId`, `tabId`, `name`, hashes, `pinnedAt`), без полного текста.
- Экспортированы `ProjectGraph.getPinnedBaseline(tabId)`, `pinBaseline(versionId, tabId)`, `unpinBaseline(tabId)`, `comparePinnedBaselineToCurrent(tab, text)`.
- `Intelligence` добавляет `pinnedBaselineDrift` в context и показывает prepared action `pinned-baseline-compare`, если текущая структура отличается от закреплённого baseline. Report использует тот же privacy-safe diff, что и named version drift.
- Diagnostics показывает количество baselines и active baseline для текущей вкладки.
- `quick baseline update` реализован: в Settings → Intelligence добавлена команда `⚡ Сделать текущую baseline`. Она открывает confirm modal, создаёт privacy-safe snapshot через `ProjectGraph.captureBaselineFromCurrent(name)` с `source: manual.baseline-update` и сразу закрепляет его как baseline текущей вкладки.
- Добавлен экспорт `ProjectGraph.captureBaselineFromCurrent(name)`.
- `SmartSuggestions.openQuickBaselineUpdate()` добавлен; Enter в поле имени baseline работает так же, как в save-version modal.
- Исправлен UX-баг в `pinned-baseline-compare`: reason теперь берёт имя из `baseline.version.name`, а не только из ref, чтобы UI показывал актуальное имя snapshot.
- `baseline status badge / quick compare` реализован в Smart menu: теперь панель показывает текущий baseline текущей вкладки, краткий drift (`+N блоков`, `+N токенов`, reorder), кнопки `Сравнить` и `Обновить`.
- Для quick compare добавлен `Intelligence.openPreparedReport(report, prepared)`, чтобы Smart menu мог открыть privacy-safe `pinned-baseline-drift` report напрямую из актуального `ctx.pinnedBaselineDrift`, даже если suggestion сейчас не видна в strip/menu.
- Если baseline не закреплён, Smart menu показывает спокойный статус и кнопку `Сделать baseline`, которая открывает уже существующий safe flow `SmartSuggestions.openQuickBaselineUpdate()`.
- ProjectGraph suggestion priority policy реализована в `intelligence-core.js`: приоритеты теперь такие — `pinned-baseline-compare` > `named-version-compare` > `derived-from-version` > `version-timeline` > `similar-prompt-found` > `title-role-gap` > `often-with-found`.
- Подсказки ProjectGraph с меньшим приоритетом больше не конкурируют шумно со старшими: часть уходит только в Smart menu (`menuOnly`), а слабые/дублирующие `similar-prompt-found` скрываются, когда уже есть baseline/named drift.
- Добавлены guards `hasMeaningfulDiff()` и `applyProjectGraphPriorityPolicy()`, чтобы не показывать version/drift подсказки без реального изменения структуры, ролей, hashes, tokens или порядка.
- Проверено в браузере: при активном pinned baseline в strip остаётся `pinned-baseline-compare`, а `named-version-compare`, `derived-from-version`, `version-timeline` уходят в Smart menu с `menuOnly: true`; runtime errors не пойманы.
- `ProjectGraph cleanup/retention controls` реализован: в Settings → Intelligence добавлена команда `🧹 Очистка ProjectGraph`.
- `ProjectGraph` теперь хранит `retention` внутри `llm-pb-project-graph-v1` и экспортирует `getRetention()`, `setRetention(next)`, `cleanup(options)`.
- Retention ограничивает snapshots/blockNodes/relations, опционально чистит старые snapshots по age и умеет сохранять именованные версии/baseline сверх лимита. Полный текст по-прежнему не хранится и не удаляется, потому что его нет в ProjectGraph.
- Diagnostics теперь показывает storage size и retention-параметры ProjectGraph.
- В cleanup modal доступны max snapshots, max block nodes, max relations, max age days, preserve named, preserve baselines, prune unreferenced blocks.
- Исправлен маленький UI-баг diagnostics: `maxAgeDays = 0` теперь отображается как `0d`, а не пустое `d`.
- Проверено в браузере: `ProjectGraph.cleanup/getRetention/setRetention` экспортированы, кнопка `btn-intelligence-cleanup` есть, modal “Очистка ProjectGraph” открывается, поля retention есть, cleanup выполняется без runtime errors.
- Следующий Stage 2 шаг: финальная регрессия всех Intelligence UI-кнопок и проверка edge cases после retention.
- Позже добавить `memory-sync.js`, но sync disabled by default.
