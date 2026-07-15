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
| `state.js` | Diff-снапшоты: `_computeDelta`, `_deepDiff`, `_applyDelta`, `_rebuildFromHistory`, `_migrateHistory`; `snapshot()`/`undo()`/`redo()`/`canUndo()`/`canRedo()` переписаны на base+deltas; blockHistory аналогично; `_dropBlockHistory` рекурсивен; `closeTab()` чистит `_blockHistory`; лимиты: history 30, namedSnapshots 5, blockHistory 30; **Capture undo:** `_undoRedoInProgress` flag блокирует `snapshot()` во время undo/redo; `cancelPendingSnapshot()` |
| `app.js` | `exportCurrentTab()` — удалены `history`/`historyIdx` из экспорта; `incoming.history = { base: null, deltas: [] }` для импорта |
| `blocks.js` | MD-превью текстовых блоков: кнопка в шапке (toggle + long-press dropdown), `_renderBlockMdPreview`, `b.mdPreview`/`b.mdHighlight`, min-height 110px; sync MD при patchSubtab/undo/redo/translate; dropdown: "🎨 MD + Подсветка", "📋 Копировать HTML", "📝 Копировать Markdown"; active state синей подсветкой; скрытие кнопки при неактивном блоке; **Capture mode:** long-press dropdown ("В строчку"/"С пропуском"), `_captureInsertMode` persistence, `_captureBtns` Set (global toggle), `_captureUndoStack/_captureRedoStack` (↩️/↪️), `_ensureStickyBlock(sourceBlock)` — insert after source block, `State.makeBlock()` + push (no addBlock side effects), `_syncCaptureTextarea()`, `_getStickyBlock()` with stale ID reset, `_closeCaptureDropdown` document listener |
| `ui.js` | Превью: 3-режимная кнопка MD (Text→MD→MD*→Text), `getMdHighlight()`, highlight.js только в режиме md-hl |
| `notepad.js` | MD-превью: кнопка, `_renderMdPreview`, `_toggleMdPreview`, `marked.parse()`; `_loadSaved` возвращает `mdPreview`; A−/A+ работают в MD; render при открытии; SVG "MD"; кнопки MD + "Перевести текст" в header; перевод: `_undoStack`, dropdown (язык/движок), long-press 400ms, без toast, очистка при смене вкладки и закрытии; `_cleanupTranslate` listener; highlight.jsalways on |
| `llm-features.js` | Мини-чат: `_renderChatMd` хелпер (marked.parse + hljs), assistant-сообщения рендерятся как markdown с подсветкой; `finalizeLastMessage` переключает на markdown после стриминга; translate undo сохраняет raw text в `dataset.rawText` |
| `index.html` | highlight.js CSS + JS через CDN; `prev-md` button |
| `styles.css` | `.block-md-content` — стили markdown + min-height 110px; `.block-md-btn` — скрытие по hover, active синяя подсветка; `.notepad-md-content pre code.hljs`, `.llm-chat-msg-text pre code.hljs` — прозрачный фон; **Capture pulse:** `@keyframes capturePulse` 1s infinite, `.capture-active` accent + glow, `prefers-reduced-motion` → animation none |
| `prompt-loom.js` | `renderPalette` — DOM-diff (не пересоздаёт search input); `close-all-palettes` listener; `closePalette` export; фикс `handleBackslashTrigger` |
| `llm-core.js` | `closeAllMenus` в menu trigger и bank trigger |
| `text-linter.js` | `many-commas` regex → comma counting; `ui-menu` на gearDrop; `closeAllMenus` в gearBtn; `ANIM_TOKEN_LIMIT` 300→80; тайминг в `openPreview` (убран) |
| `timer.js` | 12-сегментный периметр: `_buildSegments/_fillSegment/_extinguishSegment/_syncSegments`; `viewBox`; CW для обоих режимов; `completedSegments` state; `timer-value-sm` + `_prevDigitLen`; Segment tick marks perpendicular to path, inward only; **Аудит итерации 1-4:** AudioContext reuse (один на цикл, user-gesture init); `_cachePoints` аналитический (0 layout вместо 800); `_tickRAF` safety (`rafId=null`); `closeInlineInput` comma→if/else; inline-input фидбэк (shake+red); ResizeObserver debounce (`_resizeRaf`); cssText cache (`_cachedDigitCssText/Sig/Font`); `_applyArc` hot path оптимизация (display/r только при смене dir, `_lastHeadIdx` guard, убран strokeDashoffset='0'); AudioContext.resume().catch(); `restoreState` AudioContext init; `_updateDisplay` guards; `void offsetWidth` убран; `setIdleVisual` дубли убраны; `parentNode.style.position` вынесен в init |
| `ember.js` | CPU-оптимизация: кеш `getEmberCenter()` (per-frame), `isSceneIdle()` idle gate (со спавном частиц внутри), `POSE_BUF`/`resetPose()`, particle throttle 30fps, `setVarApprox`, `deferBurst`, `mouseMovedSinceLastFrame`, `updateMood` в `requestIdleCallback`, `passive: true`; `syncLoopState()` — централизация focus/IO/visibility, optimistic geometry, fallback timeout, `_idleCallbackId` cleanup; `Math.hypot`→dist², `flashHeat`/`coreHeatReserve` early skip; layered breathing `breathCore/Glow/Crust/Ash`; `_throttleTimer` fix; crack color-shift `mixRgb()`; anomaly sparks 380-720px; micro-flicker idle; landed ash particles; dying tab guard; idleLevel throttle УДАЛЁН (убивал визуал); **Аудит R1:** `ringImpulse`/`cursorLean` обнуляются в reduce-motion; tooltip debounce 800мс; `startEgg` guard; `--reveal-delay` через `setVar`/`removeVar`; **Аудит R2:** `deferBurst` рекурсия, `updateCrackLayers` через `setVar`, `notifyEdit` tooltip fix, reduceMotion glint reset, `peek.state` reset в idle, mousemove throttle-lock; **Egg rewrite (4(5)-4(10)):** 12-фазный орбитальный сценарий, orbit中心=raw caret (не clamped), tilt к caret в фазах 4-8, старт от ember (0,0), landing point от реального caret, `_baseApproachAngle`, `realCaretX/Y`, `_landX/_landY` clamped к viewport, minDist guard 150px, viewport clamp, reduceMotion early-return, ПКМ-тест включён |
| `ember-styles.css` | Layered breathing: `.ember-core` → `--breathCore`, `.ember-crust` → `--breathCrust`, `.ember-glow` → `--breathGlow`, `.ember-ash-overlay` → `--breathAsh`, `.ember-haze` → `--breathAsh`; Crack color-shift: `--crack-c1`, `--crack-glow-color`, `drop-shadow`; `.ember-ash.landed`; `.ember-micro-sparks` + `.micro-spark`; `color-scheme: dark` на `.ember-slot` и `.ember` (обход Auto Dark Mode); **Аудит:** segment transition `background-color` → `opacity`; `will-change: transform` на `.ember-core` |
| `styles.css` | `capturePulse` infinite → 1; `prefers-reduced-motion` для capturePulse; `.timer-input-error` + `@keyframes timerInputShake` |

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
- **Timer `_cachePoints`**: аналитический расчёт 401 точки по 9 сегментам (4 прямых + 4 дуги + замыкание) для CW и CCW. 0 layout-вызовов вместо 800 (DOM-based). `_lastHeadIdx` guard — `cx/cy` обновляются только при смене индекса.
- **Timer `_applyArc` hot path**: `display`/`r='2'` ставятся только при смене направления; `strokeDashoffset='0'` убран (никогда не меняется); guard `_lastHeadIdx` для `cx/cy`.
- **Timer AudioContext**: переиспользование одного `_audioCtx` на весь жизненный цикл. Создаётся при первом `pointerdown` (user-gesture для iOS). `restoreState` создаёт при восстановлении активного таймера. `.catch()` на `resume()` для Safari.
- **Timer cssText cache**: `_cachedDigitCssText/Sig/Font` — один `getComputedStyle` за жизнь темы. Инвалидация при смене classList или font.
- **Timer ResizeObserver debounce**: `_resizeRaf` через `requestAnimationFrame` — инвалидация кэшей раз за кадр вместо 60 раз/сек.
- **Text Linter perf**: `many-commas` заменён на split by sentence + comma count — O(n) вместо экспоненциального regex.
- **Mini-chat geometry**: `_savedWin` хранит позицию/размер, обновляется при drag/resize end и beforeunload. Восстанавливается в `_open()`.
- **Ember idle gate**: пропускает тяжёлые вычисления (commitPose, updateWind, etc.) но **всегда спавнит частицы** (ash/spark/shootingSpark) и вызывает `updateParticles`. Спавн внутри idle gate перед `return`.
- **Ember color-scheme: dark**: `color-scheme: dark` на `.ember-slot`/`.ember` — обход Auto Dark Mode for Web Contents.
- **Egg (пасхалка)**: 12-фазный орбитальный сценарий. `startEgg()` вычисляет `caretX/Y` (raw, не clamped), `_landX/_landY` (175px от caret, clamped к viewport), `_baseApproachAngle` (ember→caret). `updateEgg()`: phase 1=замах от ember, 2=подлёт к landing, 3=пружинка+взгляд, 4-8=орбиты вокруг caret (R=160-190px, tilt `cos(angle)*-15` = мордочка к caret), 9=отход, 10=сжатие, 11=укутывание кольцом, 12=возврат. Guards: minDist 150px, viewport clamp, reduceMotion early-return. ПКМ-тест: `allowTestMode=true`.
- **Capture mode ("Ща как напишу")**: `_captureMode` global toggle через `_captureBtns` Set. Long-press 400ms → dropdown ("В строчку"/"С пропуском"), `localStorage('capture_insert_mode')`. `_ensureStickyBlock(sourceBlock)` — `State.makeBlock()` + `tab.blocks.splice(idx+1)` (без `State.addBlock` side effects). Sticky вставляется после вызвавшего блока в той же колонке. `_getStickyBlock()` — сброс `_captureStickyId` при потере sticky. `_syncCaptureTextarea()` — sync DOM после изменения `sticky.value`. Pulse: `capturePulse` 1s infinite, 60 BPM. Capture undo: `_captureUndoStack/_captureRedoStack` (лимит 50), ↩️/↪️ на текстовом блоке перехватывают capture undo/redo. `_undoRedoInProgress` flag в `state.js` — блокирует `snapshot()` во время undo/redo.

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

### idleLevel rAF throttle (задание 3.6) — УДАЛЁН

**Причина удаления:** `idleLevel >= 2` использовал `setTimeout(130ms)` вместо `requestAnimationFrame`, что давало ~8fps. Эмбер "еле двигался", частицы не спавнились. Idle gate уже достаточно экономит CPU.

---

### Ember — аудит исправления (задание 3.13)

**`ringImpulse`/`cursorLean` в reduce-motion:** `ringImpulse = 0` + сброс `cursorLean.*` в начале reduce-motion ветки. Раньше кольцо дёргалось при возврате фокуса, уголёк подпрыгивал.

**Tooltip debounce:** `_editTooltipTimer` 800мс — tooltip появляется после паузы в печати, а не на каждом keystroke.

**`startEgg` guard:** `if (previewScare.active) return;` — egg не запускается во время previewScare.

**Segment CSS:** `transition: background-color` → `transition: opacity` (3-5% GPU).

**`will-change: transform`** на `.ember-core` — подсказка браузеру для compositing layer.

**`--reveal-delay`:** `setVar`/`removeVar` вместо прямого `setProperty`/`removeProperty` (консистентность кеша).

---

### Layered breathing — breathCore/Glow/Crust/Ash (задание 3.7)

**Файлы:** `ember.js`, `ember-styles.css`

**Суть:** вместо одного `--breathScale` для всех слоёв — 4 независимые фазы с разной амплитудой:
- `--breathCore` (×1.0) — ядро, синхронно с breathScale
- `--breathGlow` (×0.85) — свечение, отстаёт (восходящий жар)
- `--breathCrust` (×1.1) — корка, опережает (первая реагирует)
- `--breathAsh` (×0.6) — пепел, сильно отстаёт (оседает когда жар отступил)

**CSS:**
- `.ember-core` — `scale()` через `--breathCore`
- `.ember-crust` — `translateZ` + `scale` через `--breathCrust` (приподнимается при вдохе)
- `.ember-glow` — `translateZ` + `scale` через `--breathGlow` (отстаёт)
- `.ember-ash-overlay` — `opacity * --breathAsh`, `translate` через `--breathAsh`
- `.ember-haze` — `translateZ` + `scaleX` через `--breathAsh`

**Доп:** `_throttleTimer` — `clearTimeout` в `stopLoop()` и перед `setTimeout` в `animate()`.

---

### Crack color-shift + Anomaly sparks (задание 3.8)

**Файлы:** `ember.js`, `ember-styles.css`

**Crack color-shift:**
- `mixRgb()` — линейная интерполяция RGB между двумя цветами
- `updateCrackLayers`: `heat` 0→1→0.3 через ignition cycle
  - 0→1 за первые 15% (зажигание, `easeOutQuad`)
  - 1→0.3 за остаток (остывание, `1 - 0.7 * easeInQuad`)
- CSS variables: `--crack-c1` (цвет трещины), `--crack-glow-color` (свечение), `--crack-opacity`
- `.ignited` → `drop-shadow` с цветом glow вместо `brightness(1.5)`

**Anomaly sparks:**
- `travel`: 380–720px (×1.5–2), `dur`: 1200–2400ms (×1.5)
- `horizontalBias`: 40% летят вбок ±180px
- `easeInOut` вместо `easeOut` — разгон→полёт→затухание
- 3-фазное затухание: разгон (0–0.2) → пульсация ±18% (0.2–0.7) → сжатие+затухание (0.7–1.0)
- Trail: квадратичное затухание `(1-t)² × 14 + 1.5`, красный color shift

---

### Micro-flicker + landed ash + dying tab guard (задание 3.9)

**Файлы:** `ember.js`, `ember-styles.css`

**Micro-flicker idle:**
- `Math.random() < dt * 0.6` — редкая микро-вспышка glow
- `idlePulse = pow(random, 3) * 0.2` — большая часть ~0, редко >0.1
- `glowTrackX/Y += rand(-3, 3)` — блик смещается в случайную точку
- `idleGlow += idlePulse`, `idleBright += idlePulse * 0.3`

**Landed ash particles:**
- `spawnLandingGlow`: 60% вероятность создать `type: 'landed'` частицу
- 3-фазное затухание: проявление (0–0.15) → стабильность (0.15–0.85) → угасание (0.85–1.0)
- `dur`: 8–18 сек, `alphaBias`: 0.4–0.8
- CSS: `.ember-ash.landed` — тёмный фон, inset shadow, blur

**Dying tab guard:**
- `DYING_STORAGE_KEY` — localStorage флаг при `destroy()`
- Очистка при `init()`
- `applyRemoteState`: пропуск обновлений от умирающих вкладок

---

### Dark theme + micro-sparks (задание 3.10)

**Файлы:** `ember.js`, `ember-styles.css`

**Dark theme adaptation:**
- `matchMedia('(prefers-color-scheme: dark)')` detection в commitPose и idle gate
- `darkBoost = 0.15`: glow += 0.15, brightness += 0.15×1.3
- `shadowAlpha += 0.1` на тёмном фоне
- Автоматическая адаптация при смене темы OS

**Micro-sparks on core:**
- 4–7 CSS-only мерцающих точек (1.2px) на ядре
- `mix-blend-mode: screen`, `box-shadow` glow
- Keyframes: opacity 0.15→0.95→0.4→0.75, scale 0.8→1.25→0.95→1.1
- `rand(1.6–2.8s)` duration, `rand(0–2s)` delay
- `prefers-reduced-motion`: opacity 0.6 без анимации
- Не требует rAF, pool, или JS-обновлений

---

### Color-scheme: dark — обход Auto Dark Mode (задание 3.11)

**Файл:** `ember-styles.css`

**Проблема:** `Auto Dark Mode for Web Contents` в `chrome://flags` применяет принудительный тёмный фильтр ко всем страницам, искажая цвета/glow/blend-режимы Ember.

**Решение:** `color-scheme: dark` на `.ember-slot` и `.ember` — говорит браузеру "этот элемент уже тёмный", Auto Dark Mode не применяет фильтр. Тот же подход что в "Блок-схеме" (`flowchart.css:10`).

**Баг fixes в idle gate:**
- Спавн частиц (ash/spark/shootingSpark) и `updateParticles` добавлены **внутрь** idle gate перед `return`. Раньше `return` был ДО спавна — частицы не появлялись когда idle gate был активен.

---

### CPU-расследование в простое (задание 3.12)

**Расследование:** что нагружает CPU в простое (кроме Ember и Timer).

**Найдено:**
- **memory-sync `scheduleAutoPullCheck`** — рекурсивный `setTimeout` каждые 5 сек. Лёгкая нагрузка, но непрерывная.
- **word-complete `setInterval`** — автосохранение раз в 2 часа. Минимальная нагрузка.
- **blocks.js ResizeObserver × N** — на каждый текстовый блок. В idle не стреляет.
- **CSS `backdrop-filter: blur()`** — 15+ элементов, все скрыты в idle.
- **CSS infinite анимации** — `capturePulse` на `.capture-active` (2.5s infinite).

**Реализовано:**
- `capturePulse` изменён с `infinite` на `1` — пульс срабатывает один раз при активации
- Добавлен `prefers-reduced-motion` для `capturePulse`

---

### Ember — аудит и исправления (задание 3.13)

**Файл:** `ember.js`, `ember-styles.css`

**Исправленные баги:**
1. **`ringImpulse` + `cursorLean` в reduce-motion** — `ringImpulse = 0` + сброс `cursorLean.*` в начале reduce-motion ветки. Раньше: кольцо дёргалось при возврате фокуса.
2. **Tooltip на каждом keystroke** — debounce 800мс через `_editTooltipTimer`. Раньше: tooltip висел всю сессию печати.
3. **`startEgg` без guard на previewScare** — добавлен `if (previewScare.active) return;`. Раньше: egg мог запуститься во время previewScare.

**Улучшения:**
4. **Segment CSS transition** — `background-color` → `opacity` (3-5% GPU на 12 сегментах)
5. **`will-change: transform`** на `.ember-core` (уменьшает composite)
6. **`--reveal-delay` через `setVar`/`removeVar`** вместо прямого `setProperty` (консистентность кеша)

---

### Timer — аудит и оптимизации (задание 4, итерации 1-4)

**Файл:** `timer.js`, `styles.css`

**Итерация 1 — основные фиксы:**
1. **AudioContext — переиспользование** — один `_audioCtx` на весь жизненный цикл. Создаётся при первом `pointerdown` (user-gesture для iOS Safari). Убран `ctx.close()` через 2 сек.
2. **`_tickRAF` safety** — `rafId = null` при early return (prevent RAF leak)
3. **`closeInlineInput` — comma → if/else** — устранена ловушка для рефакторинга
4. **Inline-input: фидбэк при невалидном вводе** — красный бордер + shake-анимация (400мс)
5. **`_cachePoints` — аналитический расчёт** — замена DOM-based (800 layout-вызовов) на чистую математику (0 layout). 9 сегментов (4 прямых + 4 дуги + замыкание), CW и CCW.

**Итерация 2 — edge cases:**
6. **`_cachePoints` segment search** — `< d` → `<= d` (финальная точка попадала не в последний сегмент)
7. **ResizeObserver debounce** — `_resizeRaf` через `requestAnimationFrame` (60× меньше вычислений при drag-resize)
8. **`_updateDisplay` cssText cache** — `_cachedDigitCssText` (один `getComputedStyle` за жизнь модуля). Инвалидация через `_cachedDigitCssSig` (classList + font).
9. **`_playCompletionSound` iOS fallback** — `if (!_audioCtx) return` вместо создания контекста без user-gesture

**Итерация 3 — hot path:**
10. **AudioContext в `restoreState`** — создаётся при восстановлении активного таймера (F5)
11. **`_updateDisplay` guards** — `display !== 'flex'`, `classList.contains('dim')`, `+textContent !== minutes`
12. **`void offsetWidth` в `setIdleVisual`** — убран (не нужен, нет animation restart)

**Итерация 4 — финальная оптимизация:**
13. **`_applyArc` hot path** — `display`/`r='2'` ставятся только при смене направления; guard `_lastHeadIdx` для `cx/cy`; убран `strokeDashoffset='0'` (никогда не меняется)
14. **`AudioContext.resume().catch()`** — обработка Promise для Safari
15. **`setIdleVisual` — убраны дубли `_hideArc()`** — `arcTail.style.stroke/opacity` больше не снимаются повторно
16. **`_cachedDigitFont`** — кэш font отдельно (один `getComputedStyle` за жизнь темы)
17. **`valueEl.parentNode.style.position`** — вынесен в `init()` (один раз вместо каждой смены цифры)
18. **`void valueEl.offsetWidth` в `_updateDisplay`** — убран (redundant после `textContent`)

---

### Ember — аудит раунд 2 (задание 4 (4))

**Файл:** `ember.js`

**Исправленные баги:**
1. **`deferBurst` утечка таймеров** — рекурсивный `nid` не удалялся из `timers` при следующем шаге. Переписан на рекурсию `deferBurst(fn, count-1, interval)` — каждый вызов сам управляет своим id.
2. **`updateCrackLayers` мимо кеша** — `layer.el.style.setProperty()` напрямую минуя `setVar`/`styleCache`. Заменено на `setVar()`/`setStyle()` — кеш консистентен с DOM.
3. **`notifyEdit` tooltip race** — `tooltipHideTimer` не сбрасывался при debounce → tooltip мог скрыться и снова появиться. Добавлен `clearDeferred(tooltipHideTimer)`.
4. **`reduceMotion` не очищает glint** — при выходе из reduceMotion `--glintOpacity/X/Y/Rot` прыгали к старым значениям. Добавлен `removeVar()` для всех 4 переменных.
5. **`peek.state` зависает при idle** — при focus loss peek.state не сбрасывался → возврат в active вызывал glitch. Добавлен `peek.state = 'idle'; peek.cooldown = 5000;` в idle-ветку.
6. **`mousemove` throttle-lock** — mouse.x/y обновлялись на КАЖДОМ DOM-событии (200+ раз/сек), а RAF тикает 60 раз. Throttle-lock: `_lastMouseEvent` буфер в handler, `sampleMousePosition` читает 1 раз за кадр. Точность mouse.speed возросла (нет джиттера от рассинхрона).

**Пропущено (аргументы):**
- П.5 аудита (двойное `let crackLayers`) — уже исправлено в предыдущем раунде.
- П.17/18 (defer + reveal-delay race) — уже исправлено (`clearAllDeferred` в destroy + `if (!root) return` в defer).
- П.A (breathPhase throttle до 30fps) — опасно: уже были проблемы с throttling (idleLevel rAF throttle удалён за убивание визуала).
- П.11 (updateHeatZones split) — микро-оптимизация, нет реального эффекта в idle (idle gate уже пропускает).

---

### Egg — 12-фазный орбитальный сценарий (задания 4 (5)–4 (10))

**Файл:** `ember.js`

**Суть:** полная замена `startEgg()` + `updateEgg()`. 12 фаз ~10 сек. Orbit вокруг РЕАЛЬНОЙ каретки, мордочка к caret.

**Фазы:**

| Фаза | Название | Длительность | Описание |
|------|----------|-------------|----------|
| 1 | ЗАМАХ | 110мс | Приседает от ember ПРОТИВ caret |
| 2 | ПОДЛЁТ | 280мс | Ease к landing point + дуга 14px |
| 3 | ПРИЗЕМЛЕНИЕ | 900мс | Пружинка + взгляд на caret |
| 4 | ОБЛЁТ 1 | 1300мс | Дуга R=175±18px, смотрю на caret |
| 5 | ЗАВИСАНИЕ | 950мс | Пауза R=175±12, смотрю на caret |
| 6 | ПЕРЕЛЁТ | 1500мс | Дуга на противоположную сторону R=190±20 |
| 7 | ОБЛЁТ 2 | 1100мс | R=165±12, смотрю на caret |
| 8 | ОБЛЁТ 3 | 1100мс | R=160±15 + «пиши-пиши» |
| 9 | ОТХОД | 700мс | R→225, от кольца |
| 10 | СЖАТИЕ | 320мс | В точку |
| 11 | УКУТЫВАНИЕ | 600мс | Кольцо вокруг |
| 12 | ВОЗВРАЩЕНИЕ | 700мс | Вырастает обратно |

**Архитектура:**
- `egg.caretX/Y` = raw ember-local (orbit中心 = реальная каретка)
- `egg._landX/_landY` = landing point (175px от caret), clamped к viewport
- `egg.realCaretX/Y` = viewport-абсолютные (для landing-glow)
- `egg._baseApproachAngle` = угол ember→caret (для phases 1-3)
- Tilt: `cos(orbitAngle) * -15` — мордочка к caret на каждой точке дуги
- Guards: minDist 150px от caret + viewport clamp + reduceMotion early-return
- ПКМ-тест: `allowTestMode = true`

---

---

### Settings UI cleanup (сессия 2026-07-14)

**Файлы:** `index.html`, `styles.css`, `app.js`, `state.js`

**Изменения:**
1. **Color picker для "Цвет строки"** — `<input type="color">` + текстовый инпут + палитра из 8 swatch-цветов. "Цвет маркеров" (anchor) остался простым `<input type="color">`.
2. **Переименование** — "Настройки LLM" → "Настройки" везде (заголовок, кнопка, toast).
3. **Spoiler state persistence** — все `<details class="llm-settings-fold">` сохраняют open/close в `localStorage` (`llm-spoiler-state`). По умолчанию `open`.
4. **"Автозавершение слов"** — перенесена в col3 первым пунктом.
5. **"Полоса прокрутки колонок"** — удалена полностью (настройка + CSS).
6. **Inline-hint color** — `a375030` ошибочно изменил `rgba(176,188,207,0.35)` → `rgba(200,210,225,0.55)`. **Отменено** — цвет вернуть как было (специально подобран).

**Коммиты:**
- `ee1e9d0` — color picker circle for "Цвет строки"
- `07e5e8b` — move word-complete to col3 first, rename, spoiler state
- `65fecf3` — removed col-scrollbar setting
- `a375030` — inline-hint color 35%→55% (**ОШИБКА — отменить**)

---

### Word-complete — расследование dropdown (незавершено)

**Находка:** word-complete имеет ghost-текст (inline hint), но **НЕ** реализует выпадающий список с кандидатами. `maxSuggest=3` ограничивает количество кандидатов в `suggest()`, но только `candidates[0]` показывается как ghost (`handleInput`). Остальные варианты нигде не отображаются. Нет DOM-элемента для dropdown/popup.

**Гипотезы:**
- (a) `wordlist.json` не существует — словарь пуст → fallback на localStorage + gist + текст из вкладок
- (b) `hintsEnabled` может быть `false` в localStorage
- (c) ghost-текст — единственный UI, dropdown/popup **вообще не реализован** (скорее всего)

**Статус:** расследование не завершено, пользователь уточнил "нет списка с словами, мы же разбираемся с 'макс. вариантов'".

---

### MindMap — доработка (задание 3) — ОТКАЧЕНА

Пользователь откатил изменения mindmap. Файлы вернулись в исходное состояние.

---

### Blocks — MD кнопка доработка (задание "доработка")

**Файлы:** `blocks.js`, `styles.css`

**Изменения:**
1. **Размер не меняется** — при переключении MD/text показывается новый элемент ПЕРВЫМ (с `style.height` от предыдущего), потом прячется старый. Блок не схлопывается.
2. **Прокрутка сохраняется пропорционально в ОБЕ стороны** — ratio `scrollTop / scrollable` рассчитывается из текущего элемента и применяется к другому. Текст→MD = MD на той же позиции. MD→Текст = текст на той же позиции. Без `focus()`.
3. **Active state dropdown** — кнопка "🎨 MD + Подсветка кода" получает `active` class (синий текст `var(--accent)`) когда `b.mdHighlight = true`. Обновляется при показе dropdown и при toggle.
4. **F5 persistence** — `mdHighlight` уже сохранялся в block data. Теперь UI корректно отображает active state после перезагрузки.
5. **Resize колонок** — `b.height` обновляется при MD→текст, восстанавливается на mdContent при перерисовке. scrollTop сохраняется в `b._mdScrollTop` и восстанавливается через `requestAnimationFrame` (после layout).
6. **CSS** — `min-height: 80px` (как у textarea), `resize: vertical` (регулятор размера в углу).

**Коммиты:**
- `115900f` — MD button improvements (size, scroll, active state)
- `f14fdcd` — preserve exact textarea scrollTop
- `eaa9d3a` — no focus() on return
- `36c0cbe` — proportional scroll in both directions
- `ace3468` — MD block height preserved on column resize
- `9c40eb1` — MD scrollTop preserved on column resize (rAF)
- `021a6c2` — resize:vertical for .block-md-content
- `ff5df01` — scrollTop restore via rAF

### Word Count — фикс пустого блока

**Баг:** при открытии подсчёта слов на пустом блоке popup не показывал 0. При переключении фокуса на непустой блок и обратно — popup показывал данные предыдущего блока.

**Причины:**
1. `open()` сбрасывал `_lastSourceText = ''` → при пустом блоке `src === _lastSourceText` → early return в `_render()`.
2. `_onFocusIn` проверял только `e.target` на класс `block-textarea`. При клике на div.block-body/div.block `e.target` не textarea → `_ta` не обновлялся.

**Фиксы:**
1. `_lastSourceText = '\x00'` (sentinel) в `open()` и `_onFocusIn` — гарантированно не совпадёт с реальным текстом.
2. `_onFocusIn` ищет textarea через `closest('.block') → querySelector('textarea.block-textarea')` если `e.target` — не textarea.

**Коммиты:**
- `22581c5` — sentinel reset in open/focusin
- `808b590` — focus tracking via block container

**Файл:** `word-count.js`

---

### "Ща как напишу" — capture mode доработка

**Файлы:** `blocks.js`, `state.js`, `styles.css`

**Реализация:**
1. **Долгий клик (400мс)** — dropdown с режимами вставки: "В строчку" / "С пропуском". Сохраняется в localStorage (`capture_insert_mode`).
2. **"В строчку"** — убирает leading пробелы, сохраняет trailing пробелы как есть, если нет — добавляет 1 пробел.
3. **"С пропуском"** — текущее поведение: текст + `\n\n`.
4. **Dropdown** — стили `translate-dropdown` + `translate-lang-opt` (active state). Закрывается при клике вне.
5. **Пульс кнопки** — `capturePulse` 1s infinite (60 BPM), синяя тень `rgba(79,142,247,0.55)`. `prefers-reduced-motion` → `animation: none`.
6. **Глобальная кнопка** — `_captureBtns` Set, `_syncCaptureBtn()` обновляет ВСЕ кнопки.
7. **Sticky позиция** — `_ensureStickyBlock(sourceBlock)` вставляет sticky сразу после вызвавшего текстового блока, в той же колонке. `State.makeBlock()` + `tab.blocks.push()` — без `State.addBlock` side effects.
8. **Undo на ↩️/↪️** — в capture mode кнопки используют `_captureUndoStack/_captureRedoStack`. Хранят `{ stickyId, prevValue, afterValue }`. Лимит 50. Очистка при выключении capture.
9. **Snapshot guard** — `_undoRedoInProgress` флаг в `state.js`. Блокирует `snapshot()` во время `undo()`/`redo()` — предотвращает побочные snapshot'ы от re-render/onblur.

**Известный баг (отложен):** Ctrl+Z в шапке (глобальный undo) создаёт много sticky. `_undoRedoInProgress` предотвращает побочные snapshot'ы, но корневая причина не устранена. Возможная причина: `_computeDelta` определяет sticky как новый в каждой дельте.

**Коммиты:**
- `649ce9f` — long-press dropdown + 60bpm pulse
- `4258212` — textarea sync fix (_syncCaptureTextarea)
- `2a16aea` — inline capture: preserve trailing spaces
- `818f058` — global toggle sync across all blocks
- `b30c332` — State.snapshot() for undo/redo support
- `9191937` — mouseup uses _getStickyBlock (no create), remove empty State.update
- `ba15114` — reset _captureStickyId when sticky removed by undo
- `379f41e` — capture undo/redo on ↩️/↪️ buttons
- `c57c9ab` — _ensureStickyBlock uses makeBlock+push (no side effects)
- `374eb64` — Blocks.render() after push
- `5bedddf` — title 'Заметка' instead of emoji
- `39fa09a` — sticky inserted after source block (same column)
- `cefed9b` — _undoRedoInProgress guard in snapshot()

---

### Menu settings — insert-storage button, bank order, input contrast (задание 3)

**Файлы:** `index.html`, `llm-core.js`, `styles.css`

**Изменения:**
1. **Кнопка 📥 «Вставить из хранилища»** — вынесена из меню «⋮» в отдельную кнопку в шапке функции (рядом с бейджем «по умолч.»). Список записей теперь открывается по клику на 📥, а меню «⋮» содержит только «Сбросить все».
2. **Порядок вызовов при создании/переключении банка** — `_selectPromptKey` вызывается перед `_renderPromptFnList`, чтобы избежать лишнего откатывания.
3. **Поле ввода названия банка** — улучшена контрастность: `border2`, `text0`, плейсхолдер `text3`, фокус с `settings-accent`. Добавлена обработка Enter.

**Коммиты:**
- `8840177` — fix: menu settings — separate insert-storage button, bank order, input contrast
- `83da321` — fix: _resetPrompt — explicit ed.value reset before _selectPromptKey

---

### MindMap — CPU-оптимизации (задание 3(1))

**Файлы:** `mindmap.js`, `mindmap.css`

**Изменения (8 оптимизаций):**
1. **Starfield** — количество DOT-ов сокращено в 2 раза (9000→18000 divisor). ~47→24 DOT-а.
2. **Graph physics** — итерации 90/120→50/80 + early skip при dist > 300px. ~40-60% main-thread.
3. **Parallax** — skip элементов с depth < 0.25. ~60% style writes.
4. **Blur** — CSS-классы `mm-blur-soft/mid/hard` вместо inline `style.filter`. 3 квантованных уровня.
5. **SVG Mask** — удалён mask для graph-рёбер. Links рисуются ДО circles. -30 SVG nodes + GPU regen.
6. **backdrop-filter** — blur 20px→12px, saturate 140%→120%.
7. **Proximity reveal** — CSS-only `.mindmap-panel:hover .mindmap-controls` вместо JS mousemove.
8. **Collision detection** — spatial hash (O(n) avg) вместо O(n²) `placed.some()`.

**Пропущено (опасные):**
- #5 Render diffing — слишком большой рефакторинг, ломает структуру
- #6 Event delegation — затрагивает 4 места, высокий риск регрессий

**Коммиты:**
- `658f6f9` — mindmap performance optimizations batch 1
- `pending` — mindmap performance optimizations batch 2

---

## Следующий шаг

1. Решить с пользователем: реализовать ли dropdown/popup для word-complete (список кандидатов)
2. Проверить F5 — эмбер запускается сразу с кольцом и яркостью
3. Проверить highlight.js в превью — цикл Text→MD→MD*, подсветка кода
