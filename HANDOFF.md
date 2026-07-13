# HANDOFF — Paste/Copy

## Текущий статус

### Highlight.js — подсветка кода в markdown

**Подключена** через CDN (`github-dark-dimmed` тема). Автономно, без настроек, авто-определение языка.

**Интегрирована в 4 места:**
1. **Текстовые блоки** (`blocks.js`) — toggle через dropdown кнопки MD (долгий клик → "🎨 MD + Подсветка кода")
2. **Основное превью** (`ui.js`) — кнопка MD циклит: Text → MD → MD* (с подсветкой) → Text
3. **Блокнот** (`notepad.js`) — всегда MD+эффект (без toggle)
4. **Мини-чат** (`llm-features.js`) — assistant-сообщения рендерятся через `marked.parse()` + `hljs`

**Ключевой хелпер:** `_renderBlockMdPreview(text, mdEl, fontSize, highlight)` в blocks.js, `_renderChatMd(span, text)` в llm-features.js.

**CSS:** `.block-md-content pre code.hljs`, `.notepad-md-content pre code.hljs`, `.llm-chat-msg-text pre code.hljs` — прозрачный фон для темы hljs.

**Баг:** `hljs.highlightElement` пропускал уже подсвеченные блоки → исправлено через `delete block.dataset.highlighted` перед повторным рендером.

---

### Текстовые блоки — MD-превью

**Кнопка MD** в шапке текстового блока (перед "Свернуть/Развернуть"):
- Short click = toggle MD preview
- Long press (400ms) = dropdown: "🎨 MD + Подсветка кода", "📋 Копировать HTML", "📝 Копировать Markdown"
- Кнопка скрыта когда блок не в фокусе (как "Причесать текст"), появляется при hover
- Active state — синяя подсветка (`var(--accent)`) когда MD включён

**Реализация:**
- `b.mdPreview` — флаг в данных блока (переживает re-render)
- `b.mdHighlight` — флаг подсветки кода
- `mdContent` div в `renderTextBody` — `min-height: 110px`, `max-height: 60vh`
- A-/A+ обновляют fontSize у textarea и mdContent
- `patchSubtab` обновляет MD при смене вкладок
- Undo/redo обновляют MD
- Translate обновляет MD (результат + откат)

**Коммиты:**
- `b43b70a` — основная реализация MD-превью для текстовых блоков

---

### Превью — 3-режимная кнопка MD

Кнопка "MD" в шапке превью циклит:
- **Text** → клик → **MD** (кнопка "MD", active)
- **MD** → клик → **MD*** (кнопка "MD*", active, подсветка кода)
- **MD*** → клик → **Text** (кнопка "MD", не active)

Состояние: `State.layout.previewMarkdown`: `false`/`'text'` → `'md'` → `'md-hl'`

---

### Блокнот — MD-превью и перевод

**Задача:** добавить в блокнот кнопку "MD" для markdown-превью + перенести кнопку перевода в шапку.

**Реализация:**
1. **Кнопка MD** — SVG-иконка, переключает textarea ↔ markdown div (`marked.parse()`)
2. **Персистентность** — флаг `mdPreview` сохраняется в localStorage
3. **Шапка** — кнопки MD и "Перевести текст" перенесены в header перед свернуть/закрыть
4. **Перевод** — полностью переписан по паттерну из blocks.js:
   - `_undoStack` на кнопке (не `state._translateOriginal` который обнулялся в input handler)
   - Dropdown для выбора языка/движка (долгое нажатие 400мс)
   - Все toast удалены
   - `_undoStack` очищается при смене вкладки
5. **CSS** — кодовые блоки используют `var(--bg3)` как в основном превью
6. **Highlight.js** — всегда включён в MD-режиме (без toggle)

**Баги найдены и исправлены:**
- `_loadSaved()` не возвращал `mdPreview` → после F5 флаг сбрасывался
- A−/A+ не работали в MD-режиме (меняли размер только textarea)
- MD не рендерился при открытии (не вызывался `_renderMdPreview`)
- SVG-иконка рисовала "MN" вместо "MD"
- Откат перевода не работал (`state._translateOriginal` обнулялся в input handler)
- Кросс-табный откат (undoStack не очищался при смене вкладки)
- Утечка document listener при аварийном пересоздании блокнота
- Dropdown позиционировался вверх вместо вниз

**Коммиты:**
- `65c9219` — основная реализация MD-превью (кнопка, рендер, персистентность)
- `ae66c9c` — `_loadSaved()` возвращает `mdPreview`
- `aa07888` — CSS кодовых блоков как в основном превью (`var(--bg3)`)
- `2e550df` — A−/A+ в MD, render при открытии, иконка MN→MD
- `611dda0` — кнопки MD и перевода в шапку, MD обновляется после перевода
- `97a3115` — rewrite translate: `_undoStack`, dropdown, без toast, очистка при смене вкладки
- `133c532` — dropdown вниз, lazy rebuild меню, guard пустого dropdown

**Файлы:** `notepad.js`, `styles.css`

---

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
- `3de2ea3` — defense cloning в `_applyDelta` (deep clone blocks), early return для `targetIdx < 0`
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
| `blocks.js` | MD-превью текстовых блоков: кнопка в шапке (toggle + long-press dropdown), `_renderBlockMdPreview`, `b.mdPreview`/`b.mdHighlight`, min-height 110px; sync MD при patchSubtab/undo/redo/translate; dropdown: "🎨 MD + Подсветка", "📋 Копировать HTML", "📝 Копировать Markdown"; active state синей подсветкой; скрытие кнопки при неактивном блоке |
| `ui.js` | Превью: 3-режимная кнопка MD (Text→MD→MD*→Text), `getMdHighlight()`, highlight.js только в режиме md-hl |
| `notepad.js` | MD-превью: кнопка, `_renderMdPreview`, `_toggleMdPreview`, `marked.parse()`; `_loadSaved` возвращает `mdPreview`; A−/A+ работают в MD; render при открытии; SVG "MD"; кнопки MD + "Перевести текст" в header; перевод: `_undoStack`, dropdown (язык/движок), long-press 400ms, без toast, очистка при смене вкладки и закрытии; `_cleanupTranslate` listener; highlight.jsalways on |
| `llm-features.js` | Мини-чат: `_renderChatMd` хелпер (marked.parse + hljs), assistant-сообщения рендерятся как markdown с подсветкой; `finalizeLastMessage` переключает на markdown после стриминга; translate undo сохраняет raw text в `dataset.rawText` |
| `index.html` | highlight.js CSS + JS через CDN; `prev-md` button |
| `styles.css` | `.block-md-content` — стили markdown + min-height 110px; `.block-md-btn` — скрытие по hover, active синяя подсветка; `.notepad-md-content pre code.hljs`, `.llm-chat-msg-text pre code.hljs` — прозрачный фон |
| `prompt-loom.js` | `renderPalette` — DOM-diff (не пересоздаёт search input); `close-all-palettes` listener; `closePalette` export; фикс `handleBackslashTrigger` |
| `llm-core.js` | `closeAllMenus` в menu trigger и bank trigger |
| `text-linter.js` | `many-commas` regex → comma counting; `ui-menu` на gearDrop; `closeAllMenus` в gearBtn; `ANIM_TOKEN_LIMIT` 300→80; тайминг в `openPreview` (убран) |
| `timer.js` | 12-сегментный периметр: `_buildSegments/_fillSegment/_extinguishSegment/_syncSegments`; `viewBox`; CW для обоих режимов; `completedSegments` state; `timer-value-sm` + `_prevDigitLen`; Segment tick marks perpendicular to path, inward only |
| `ember.js` | CPU-оптимизация: кеш `getEmberCenter()` (per-frame), `isSceneIdle()` idle gate, `POSE_BUF`/`resetPose()` переиспользование позы, particle throttle 30fps, `setVarApprox` epsilon-кеш, `deferBurst` вместо циклов defer, `mouseMovedSinceLastFrame` флаг, `updateMood` в `requestIdleCallback`, `passive: true` на mousemove; `syncLoopState()` — централизация focus/IO/visibility, optimistic geometry check, fallback timeout, `_idleCallbackId` cleanup в destroy |

## Как работает

- **Diff-снапшоты (R1):** `history = { base: { blocks, separator }, deltas: [{ changes, ts }] }`. `snapshot()` вычисляет `_computeDelta(base, current)` — сравнивает блоки по ID через `_deepDiff` (JSON.stringify полей). Дельты: удаление `{_d}`, вставка `{_n, block}`, изменение `{id, patch}`. `undo()`/`redo()` восстанавливают через `_rebuildFromHistory()` — клонируют base + последовательно `_applyDelta`. При лимите 30: replay — base = текущее состояние, deltas.shift().
- **Block history:** та же схема base+deltas для subtabs (text/todo/table). `_computeSubtabsDelta` сравнивает по индексам.
- **Миграция:** `_migrateHistory()` конвертирует старый формат `["{json}"]` → `{ base: lastParsed, deltas: [] }`.
- **Export:** `serialize()` не включает history. `exportCurrentTab()` теперь явно удаляет `history`/`historyIdx`.
- **Import:** single tab — `incoming.history = { base: null, deltas: [] }` → `State.load()` создаёт base из blocks. Multi tab — `_migrateHistory()` конвертирует старый формат.
- **Text block MD:** кнопка в шапке (opacity:0 → hover:1). Long-press 400ms → dropdown. Toggle `b.mdPreview`/`b.mdHighlight`. `mdContent` div с `min-height:110px`. Sync через patchSubtab, undo/redo, translate.
- **Preview MD:** кнопка циклит Text→MD→MD*. `previewMarkdown` state: `false`/`'text'`→`'md'`→`'md-hl'`. Highlight.js только в `md-hl`.
- **Notepad MD:** всегда MD+highlight. `_renderMdPreview` → `marked.parse()` + `hljs.highlightElement()`.
- **Chat MD:** `_renderChatMd(span, text)` хелпер. Streaming через `textContent`, finalize через `_renderChatMd`. Translate: `dataset.rawText` для undo.
- **Highlight.js:** CDN `github-dark-dimmed`. `hljs.highlightElement(block)` с `delete block.dataset.highlighted` перед повторным рендером. Auto-detect языка.
- **Notepad translate:** паттерн `_undoStack` на кнопке (как в blocks.js). Long-press 400ms → dropdown с engine/lang. `onclick` — если есть `_undoStack` и нет выделения → откат (pop + restore). Иначе → перевод через `Translator.translateProtected()`. `_undoStack` очищается при смене вкладки. `_cleanupTranslate` снимает document listener при закрытии.
- **Prompt Loom palette**: `renderPalette()` создаёт DOM один раз, при обновлении перестраивает только список. `close-all-palettes` событие закрывает palette извне. `handleBackslashTrigger` не закрывает palette если фокус внутри.
- **closeAllMenus**: единая точка — закрывает `.ui-menu.open` + dispatches `close-all-palettes`. Palette-модули слушают событие и закрываются через свои close-функции с очисткой состояния.
- **Timer segments**: 12 line-меток вдоль CW-пути, `viewBox` привязан к размерам кнопки. Сегменты только внутрь (dot product). `_syncSegments` при любом изменении `completedSegments`.
- **Text Linter perf**: `many-commas` заменён на split by sentence + comma count — O(n) вместо экспоненциального regex.
- **Mini-chat geometry**: `_savedWin` хранит позицию/размер, обновляется при drag/resize end и beforeunload. Восстанавливается в `_open()`.

### Ember CPU-оптимизация (задание 3.4)

**Файл:** `ember.js`

**Изменения (9 оптимизаций):**
1. **Кеш `getEmberCenter()`** — `_emberCenterCache` с привязкой к `lastFrame`. 5-8 `getBoundingClientRect`/кадр → 1. Сброс в `destroy()`.
2. **Idle gate (`isSceneIdle`)** — когда мышь не двигалась, нет эффектов, нет частиц, `heatBoost`/`ringImpulse`/`residualHeat` стабильны, `focusState === 'active'` → пропускаем `updateWind`, `updateAttention`, `updateGaze`, `updateCursorLean`, `processReactions`, `tryStart`, `commitPose`, частицы. Обновляем только `breathPhase` + `glowTrack`/`ashTrack`.
3. **Переиспользование буфера позы** — `POSE_BUF` (объект с 35+ полями) + `resetPose()` вместо `createPose()`. Убирает GC-давление (~60 аллокаций/сек).
4. **Throttle частиц до 30fps** — `++_particleFrameToggle & 1 || particles.length < 16`. Частицы обновляются ~30 раз/сек.
5. **`setVarApprox`** — epsilon-кеш (0.001) для `--breathScale` в idle gate. Избегает лишних `setProperty` при float-шуме.
6. **`deferBurst`** — вместо циклов `defer(spawnX, i*K)`. Одна цепочка `setTimeout` вместо N. Заменено в: предупреждение сегментов, click handler, typingApproach, processReactions (crackle/gust/ashDrift).
7. **`mouseMovedSinceLastFrame`** — флаг в `mousemove` handler. `isSceneIdle` пропускает.wind/attention если мышь не двигалась.
8. **`updateMood` в `requestIdleCallback`** — уже имел 1с throttle; теперь реально не блокирует кадр.
9. **`passive: true`** на `document.addEventListener('mousemove', ...)` — браузер не ждёт JS перед скроллом.

**Пропущено (аргументы):**
- CSS idle-анимации — idle-ветка уже обновляет CSS-переменные, переход на `@keyframes` рискует потерять плавность при `settling→idle→wakeUp`.
- cssText batching — микро-выигрыш (1-2 мс), `setVar` уже блокирует дубли через `styleCache`.
- `Int32Array` view — микро-optimизация без реального эффекта на V8.
- Epsilon-кеш для heat/brightness/ringOpacity — `setVar` уже отсекает равные значения; допуск 0.001 на float-строках с `.toFixed(3)` бесполезен (равны точь-в-точь).

---

### syncLoopState() — централизация focus/IO/visibility (задание 3.5)

**Проблема:** после F5 `init()` не вызывает `startLoop()` если есть IntersectionObserver — IO callback ещё не пришёл, `onScreen = false`, цикл не стартует. Пользователь должен тыкнуть/прокрутить чтобы получить `window focus`.

**Решение:**
1. **`syncLoopState(reason)`** — единая точка: проверяет `browserFocused && onScreen && !document.hidden`, управляет `focusState` и `rafId`. Заменяет копипасту `startLoop()/stopLoop()` из 4 обработчиков.
2. **Оптимистичная геометрия** — `root.getBoundingClientRect()` в `init()`: если элемент уже видимый, `onScreen = true` до IO callback.
3. **Fallback timeout** — `setTimeout(() => syncLoopState('init-timeout'), 200)`保险如果 IO 延迟。
4. **`_idleCallbackId` cleanup** — `cancelIdleCallback` в `destroy()`, guard `if (destroyed || !root || !state)` в callback.
5. **`_fullUpdateDone`** — сбрасывается только в `init()`/`destroy()`, не в `startLoop()`.

**Заменённые обработчики:**
- `windowFocus` → `syncLoopState('windowFocus')`
- `windowBlur` → `syncLoopState('windowBlur')`
- `visibilitychange` → `syncLoopState('visibility')`
- `reduceMotionChange` → `syncLoopState('reduceMotion')`
- IO callback → `syncLoopState('io')`

---

## Следующий шаг

1. Проверить F5 — эмбер запускается сразу с кольцом и яркостью
2. Проверить highlight.js в превью — цикл Text→MD→MD*, подсветка кода
3. Проверить highlight.js в мини-чате — streaming → finalize → markdown + подсветка
4. Проверить MD-превью текстовых блоков — toggle, long-press dropdown, active state
5. Проверить undo/redo — работает ли ветвление (undo → изменение → redo)
6. Проверить импорт старого формата файла (до R1)
7. Проверить ember idle gate — не дёргается ли эмбер при движении мыши в idle
8. Проверить particle throttle — визуально неотличимо от 60fps
