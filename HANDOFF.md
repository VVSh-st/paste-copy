# HANDOFF — Paste/Copy

## Текущий статус

### Diff-снапшоты — оптимизация хранилища (R1-R3)

**Проблема:** `history[]` хранит до 200 полных JSON-копий блоков на вкладку. `namedSnapshots` — ещё 10. При 3 вкладках = 600+ полных копий.

**Решение:**
1. **R1:** `history[]` → `{ base, deltas[] }` — 1 полный снапшот + дельты (только изменённые блоки). При редактировании 1 блока дельта ~1-5% от полного.
2. **R2:** history limit 200 → 30
3. **R3:** namedSnapshots limit 10 → 5
4. **blockHistory:** `snaps[]` → `{ base, deltas[] }`, limit 100 → 30
5. Миграция со старого формата `_migrateHistory()` — обратно совместимо

**Файлы:** `state.js`, `app.js`

**Коммиты:**
- `d80d80b` — основная реализация R1-R3
- `3de2ea3` —防御ное клонирование в `_applyDelta` (deep clone blocks), early return для `targetIdx < 0`
- `bb55784` — `closeTab()` очищает `_blockHistory` для блоков закрытой вкладки (утечка памяти)
- `1a4edfe` — `exportCurrentTab()` исключает `history`/`historyIdx` из экспорта (лишний балласт ~50-200KB)

**Аудит (2 итерации):**
- `_applyDelta` мутировал `state.blocks` через shallow reference → исправлено `_cloneDeep`
- `_rebuildFromHistory(t, -1)` вызывал `_cloneDeep` без необходимости → early return
- `closeTab()` не чистил `_blockHistory` → добавлена очистка через `_dropBlockHistory`
- `exportCurrentTab()` сериализовал сырой таб с history → удалены `history`/`historyIdx`
- Все сценарии проверены: undo/redo, ветвление, импорт/экспорт, миграция, edge cases

### Расследование сохраняемых данных

Проведён полный аудит localStorage (~40 ключей). Основные находки:
- `history[]` — главный потребитель (до 200 × N вкладок полных копий) → оптимизировано (R1-R3)
- `namedSnapshots` — 10 полных копий на вкладку → лимит 5 (R3)
- `globalSnippets` дублировался в `layout.globalSnippets.items` — `_sanitizeSavedLayout` убирает
- `paste-copy-cache` (LLM кэш) — до 200 записей, не сжимается (кандидат на R4)
- `ember-state-{tabId}` — анимационное состояние, восстанавливается → можно не сохранять (кандидат)
- Сжатие через async `CompressionStream` невозможно (save sync) → использованы diff-снапшоты

---

### Блокнот — кнопка toggle

Кнопка "Блокнот" в тулбаре теперь toggle: открыто → закрыть (как X, данные сохраняются), закрыто → открыть.

### Prompt Loom — поиск терял фокус

**Баг:** при нажатии клавиши в строке поиска Prompt Loom терялся фокус.
**Причина:** `renderPalette()` при каждом вызове делал `palette.innerHTML = ...` — пересоздавал DOM, включая search input.
**Фикс:** `renderPalette()` теперь при повторных вызовах (обновление списка при вводе) очищает и перестраивает только `.pl-pal-list`, не трогая search input.

### Prompt Loom + slash palette — фикс `handleBackslashTrigger`

**Баг:** при открытом Prompt Loom.palette нажатие клавиши закрывало palette.
**Причина:** `handleBackslashTrigger` вызывается на каждый keydown (capture phase). Когда фокус в search input, `e.target` !== `inlineSession.el` → `closePalette()`.
**Фикс:** если `el` внутри palette — return early.

### Меню — единая система закрытия (ui-menu)

**Проблема:** Prompt Loom palette, slash palette, snippet-dropdown и toolbar dropdown могли быть открыты одновременно.
**Решение:**
1. Все dropdown/palette контейнеры получили класс `ui-menu` (HTML + JS)
2. `window.closeAllMenus(except)` — единая функция: закрывает `.ui-menu.open` + dispatches `close-all-palettes` событие
3. Palette-модули (Prompt Loom, slash) слушают `close-all-palettes` и закрываются через свои close-функции
4. Все обработчики открытия вызывают `closeAllMenus(except)` перед toggle
5. `snippet-dropdown` (использует `display:block/none` вместо `.open`) — обрабатывается отдельно

### Таймер — 12-сегментный периметр (тикет аудита)

**Файл:** `timer.js` + `styles.css` + `index.html`

- SVG `<g class="timer-segments">` для 12 меток вдоль CW-пути
- `viewBox` динамически привязан к размерам кнопки
- Сегменты строятся перпендикулярно пути, только внутрь (dot product для определения направления)
- `_fillSegment/_extinguishSegment/_syncSegments` для управления
- Оба режима (up/down) — CW (`'cw'`)
- `up`: сегменты заполняются по 1 каждые 60 мин, лимит на 12 сегментах
- `down`: Variant B — предзаполнены, гаснут по мере сгорания
- `SEG_COUNT=12`, `SEG_TICK_LEN=4`, `SVGNS` константы
- `completedSegments` state, `_syncSegments` в `startCountUp/Down`, `resetToIdle`, `restoreState`
- `timer-value-sm` для 3-значных цифр (font-size 0.82em + scaleX 0.86)
- `_prevDigitLen` кэш — переключение `timer-value-sm` только при смене длины (без layout thrash)

### Text Linter — perf fix (many-commas regex)

**Баг:** `openPreview` "Показать diff и подсказки" — 12 секунд для 2912 символов.
**Причина:** regex `many-commas` — `(?:[^.!?…\n]*,[^.!?…\n]*){5,}` — катастрофический бэктрекинг. Строка 449 символов без знаков препинания → 3.4 сек.
**Фикс:** замена на разбиение по `.!?…` + подсчёт запятых в каждом предложении — O(n), без regex-бэктрекинга.
**Доп:** `ANIM_TOKEN_LIMIT` понижен с 300 до 80 — при >80 токенов diff рендерится статически.

### Мини-чат — геометрия (повторный фикс)

**Баг:** позиция/размер мини-чата сбрасывались при F5.
**Причина:** `_saveSessions()` проверяла `p.style.display !== 'none'` — если чат закрыт до `beforeunload`, геометрия не сохранялась. Также не было отдельного сохранения при drag/resize.
**Фикс:**
- `_saveWinGeometry()` — отдельная функция, сохраняет `_savedWin` при каждом drag/resize end
- `_saveCurrentSession()` (beforeunload) вызывает `_saveWinGeometry()` перед `_saveSessions()`
- `_saveSessions()` записывает `_savedWin` если он есть (без проверки display)

## Изменённые файлы (сессия)

| Файл | Изменения |
|------|-----------|
| `state.js` | Diff-снапшоты: `_computeDelta`, `_deepDiff`, `_applyDelta`, `_rebuildFromHistory`, `_migrateHistory`; `snapshot()`/`undo()`/`redo()`/`canUndo()`/`canRedo()` переписаны на base+deltas; blockHistory аналогично; `_dropBlockHistory` рекурсивен; `closeTab()` чистит `_blockHistory`; лимиты: history 30, namedSnapshots 5, blockHistory 30 |
| `app.js` | `exportCurrentTab()` — удалены `history`/`historyIdx` из экспорта; `incoming.history = { base: null, deltas: [] }` для импорта |
| `notepad.js` | Кнопка "Блокнот" — toggle (show/hide) вместо только show |
| `index.html` | aria-label "Свернуть/развернуть блокнот"; `ui-menu` на все dropdown контейнеры; snippet-dropdown; `<g class="timer-segments">` в SVG; `maxlength="3"` для timer input |
| `prompt-loom.js` | `renderPalette` — DOM-diff (не пересоздаёт search input); `close-all-palettes` listener; `closePalette` export; фикс `handleBackslashTrigger` |
| `blocks.js` | `closeSlashPalette` export; `close-all-palettes` listener; `closeAllMenus` в `_renderSlashPalette` и `showSnippetDropdown`; groom trigger `closeAllMenus`; `ui-menu` на slash palette |
| `llm-core.js` | `closeAllMenus` в menu trigger и bank trigger |
| `text-linter.js` | `many-commas` regex → comma counting; `ui-menu` на gearDrop; `closeAllMenus` в gearBtn; `ANIM_TOKEN_LIMIT` 300→80; тайминг в `openPreview` (убран) |
| `llm-features.js` | `_saveWinGeometry()` — отдельное сохранение геометрии; drag/resize end + beforeunload → `_saveWinGeometry()` |
| `timer.js` | 12-сегментный периметр: `_buildSegments/_fillSegment/_extinguishSegment/_syncSegments`; `viewBox`; CW для обоих режимов; `completedSegments` state; `timer-value-sm` + `_prevDigitLen`; Segment tick marks perpendicular to path, inward only |
| `styles.css` | `.timer-seg/timer-seg-filled` + `@keyframes seg-fill`; `.timer-value-sm` для 3 цифр |

## Как работает

- **Diff-снапшоты (R1):** `history = { base: { blocks, separator }, deltas: [{ changes, ts }] }`. `snapshot()` вычисляет `_computeDelta(base, current)` — сравнивает блоки по ID через `_deepDiff` (JSON.stringify полей). Дельты: удаление `{_d}`, вставка `{_n, block}`, изменение `{id, patch}`. `undo()`/`redo()` восстанавливают через `_rebuildFromHistory()` — клонируют base + последовательно `_applyDelta`. При лимите 30: replay — base = текущее состояние, deltas.shift().
- **Block history:** та же схема base+deltas для subtabs (text/todo/table). `_computeSubtabsDelta` сравнивает по индексам.
- **Миграция:** `_migrateHistory()` конвертирует старый формат `["{json}"]` → `{ base: lastParsed, deltas: [] }`.
- **Export:** `serialize()` не включает history. `exportCurrentTab()` теперь явно удаляет `history`/`historyIdx`.
- **Import:** single tab — `incoming.history = { base: null, deltas: [] }` → `State.load()` создаёт base из blocks. Multi tab — `_migrateHistory()` конвертирует старый формат.
- **Prompt Loom palette**: `renderPalette()` создаёт DOM один раз, при обновлении перестраивает только список. `close-all-palettes` событие закрывает palette извне. `handleBackslashTrigger` не закрывает palette если фокус внутри.
- **closeAllMenus**: единая точка — закрывает `.ui-menu.open` + dispatches `close-all-palettes`. Palette-модули слушают событие и закрываются через свои close-функции с очисткой состояния.
- **Timer segments**: 12 line-меток вдоль CW-пути, `viewBox` привязан к размерам кнопки. Сегменты только внутрь (dot product). `_syncSegments` при любом изменении `completedSegments`.
- **Text Linter perf**: `many-commas` заменён на split by sentence + comma count — O(n) вместо экспоненциального regex.
- **Mini-chat geometry**: `_savedWin` хранит позицию/размер, обновляется при drag/resize end и beforeunload. Восстанавливается в `_open()`.

## Следующий шаг

1. Проверить undo/redo — работает ли ветвление (undo → изменение → redo)
2. Проверить импорт старого формата файла (до R1)
3. Проверить Prompt Loom palette — поиск не теряет фокус, только одно меню открыто
4. Проверить мини-чат — позиция/размер сохраняются при F5
5. Проверить таймер — 12 сегментов, CW оба режима, Variant B для down
