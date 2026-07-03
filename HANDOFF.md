# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.

Есть MCP инструменты, используй при необходимости.

Мне отвечай по-русски.

**Сленг пользователя (учить, повторять пока не начнёт писать сам):**
- **пики** = задачи
- **тултип** = dropdown / popup / всплывающая подсказка (он так говорит)
- **колонка** = column
- **ресайзер** = resizer
- **дропдаун** = dropdown
- **блок** = block (элемент UI)

## Status — ТЕКУЩАЯ СЕССИЯ (2026-07-03)

### Column resize + independent scroll fix (2026-07-03)

1. ✅ **Resizer drag** — `applyLayout(ratios)` принимает параметр, не вызывает `State.setLayout()` в mousemove → нет `fullRender()` → ресайзеры живут → drag плавный. State коммитится на mouseUp.
2. ✅ **Independent column scrolling** — `.column { overflow: auto }`, `#workspace { overflow: hidden }`. Каждая колонка скроллится отдельно.
3. ✅ **Scrollbar off by default** — `#workspace { scrollbar-width: none }`. `.col-scrollbar` toggle возвращает.

### Block order fix (2026-07-03)

4. ✅ **Block order numbers** — `buildOrderMap()` и `build()` в preview сортируют блоки по колонке (лево→право, верх→низ). Badge #N и preview следуют порядку колонок.

### CPU optimization (2026-07-03)

5. ✅ **Anchor markers debounce** — `State.onLive(rerender)` → debounce 150ms вместо каждого keystroke.
6. ✅ **Debug console.log удалены** — из blocks.js (spell-click, spell-overlay) и spell-check.js (chunk logging).

### Export current tab (2026-07-03)

7. ✅ **Export tab button** — `#btn-export-tab` рядом с основным экспортом. Экспортирует текущую вкладку в JSON.
8. ✅ **Import single tab** — при импорте 1 вкладки добавляется к существующим (не заменяет). Настройки сохраняются через `State.getLayout()`. Новые ID без коллизий.

### Known issues (текущие)

- **CPU 50W** — подозрение на браузерный spellcheck (`ta.spellcheck`) + anchors `_renderMarkersAll` на каждом keystroke. Дебаунс anchors добавлен. Полное выяснение причины отложено.
- **Spell-check Yandex API** — `SpellCheck.isEnabled()` по умолчанию `false`, не должен работать. Кнопка-переключатель на блоках работает.

### Git коммиты (эта сессия)

```
1d0915c fix: single-tab import preserves current layout/settings
d558a8c fix: single-tab import adds to existing tabs
1589670 feat: export current tab button
0f4631d perf: debounce anchors onLive rerender 150ms
f092595 perf: disable browser spellcheck on all textareas
e67217a fix: block order numbers by column
ba8cf3d fix: columns scroll independently
69d3bb8 fix: resizer drag with applyLayout parameter
4dd0e3c fix: resizer drag apply flex directly
```

**state.js (7 раундов, 58 фиксов)**
- load: фильтрация невалидных tabs, нормализация, dedup, safe serialize, _resetInMemoryState
- migrate: filter invalid blocks, Array.isArray, нормализация, block ID dedup, todo/table
- History: applySnap try/catch, snapshot try/catch, _parseBlockSubtabsSnap, undo/redo _snapEmit
- Event bus: _safeListenerCall, listener validation
- deepMerge: prototype pollution guard, _cloneSavedValue
- setLayout: deep merge + emit + shallow-check + try/catch
- replaceAll: allTabs, beforeCount, skip no-op, normalize
- Удалён дублирующийся blockRedo (критический баг)

**ai-transform.js (6 раундов, 39 фиксов)**
- Race conditions: _requestSeq + _isRunning guard, accept returns boolean, reject uses hidePopup(false)
- Safe error handling: non-Error catch guard, requestAnimationFrame guard, setTimeout handlers
- UX: empty instruction toast, focus return, bottom boundary check, preserve selection, history hint
- Performance: LCS limit (20K chars + 250K tokens), push+reverse instead of unshift, filter empty tokens
- Security: marker color sanitization (CSS.escape fallback), prompt boundary <text> tags
- Readability: HISTORY_LIMIT, MAX_INSTRUCTION_LEN, TRANSFORM_SYSTEM_PROMPT constants, _State usage

**anchors.js (2 раунда, 25 фиксов)**
- State consistency: clearAnchors/updateAll tabs, removeAnchorById via State.update
- Security: marker color sanitization, CSS.escape fallback for blockId
- Race conditions: setTimeout guards for click/focus/contextmenu handlers, palette mousedown leak fix
- UX: pointer events for long press, suppress click after long press, Escape closes palette, del.contains() guard
- Performance: mirror text optimization, dedup getComputedStyle, _createLineMarker helper
- Readability: magic numbers → constants, remove unused code (escHtml, _charW, _isScrolling)

**Коммиты:**
```
0aaa687 anchors: GPT audit round 2 — 8 fixes (navIdx, CSS.escape, palette leak, State consistency, visibility, mirror width, line marker helper)
3b02fc2 anchors: GPT audit round 1 — 17 fixes (clearAnchors, color sanitize, blockId escape, setAnchor guard, _jumpToAnchor, marker cleanup, word-break, negative height, pointer events, long press, Escape, del.contains, mirror optimize, getComputedStyle, unused code, constants)
9e88d90 ai-transform: GPT audit round 6 — 5 fixes (setTimeout guards, contextmenu guard, comment fix, history hint)
b652248 ai-transform: GPT audit round 5 — 8 fixes (contextmenu cleanup, rAF guard, null input, preserve selection, history cache, instruction limit, constants)
0faaa17 ai-transform: GPT audit round 4 — 7 fixes (accept boolean, reject hidePopup, error handling, bottom boundary, toast, filter tokens, save diffFontSize, normalize size)
ff2870e ai-transform: GPT audit round 3 — 3 fixes (_isRunning, empty toast, absolute LCS limit)
805055c ai-transform: GPT audit round 2 — 9 fixes (raw selection, textarea changed guard, accept guard, click handler removal, focus return, split arrays, push+reverse, getBoundingClientRect, try/finally)
741e497 ai-transform: GPT audit round 1 — 7 fixes (accept cleanup, requestSeq, LCS limit, history validation, clipboard error, prompt boundary, _State usage)
2a33a87 blocks: GPT audit round 2 — document.addEventListener leak, _appendCaptureText race, jump-highlight guard
59d8017 blocks: GPT audit round 1 — cache cleanup, scroll race, timer cleanup, todo blocked, line highlight debounce
```

**Итого: 130 фиксов за 17 раундов аудита**

**Текущий статус:**
- ✅ blocks.js: аудит завершён
- ✅ state.js: аудит завершён
- ✅ ai-transform.js: аудит завершён
- ✅ anchors.js: аудит завершён
- ❌ **ТЕКУЩИЙ БАГ:** подсветка текущей строки смещается вниз к 400-й строке ( drift накапливается)
- ⏳ app.js: ожидает аудит (969 строк)

### Flowchart — Query menu

1. ✅ **Query menu** — левый верхний угол, proximity reveal (ratio 0.25), 5 пресетов + custom input + история (FIFO, localStorage)
2. ✅ **Пресеты** — "Структура документа", "Ключевые понятия", "Поток действий", "Связи между блоками", "Краткое резюме"
3. ✅ **История** — 5 последних ручных запросов, удаление по ✕, пресеты не сохраняются
4. ✅ **_fetchWithQuery** — принимает произвольный запрос, передаёт в промпт LLM
5. ✅ **Menu width** — 220px, адаптивный текст (ellipsis)
6. ⏸ **Spell-check toggle** — скрыт из настроек (пока не доработан)

### Flowchart — Sugiyama layout engine (v2 — переписан 2026-07-02)

7. ✅ **Cycle removal** — DFS, back-edges reversed для layering
8. ✅ **Layer assignment** — longest-path + компактация (удаление пустых слоёв)
9. ✅ **Dummy nodes** — для рёбер spanning >1 layer, резервируют track в ordering
10. ✅ **Crossing minimization** — median heuristic, **20 итераций**, выбор лучшего ordering по score пересечений
11. ✅ **Coordinate assignment** — центрирование слоёв, интерполяция dummy-узлов (3 прохода), min-spacing bounds + repulsion (3 прохода)
12. ✅ **Edge routing** — прямые линии через waypoints, orthogonal для back-edges (side arcs)
13. ✅ **Crossing counter** — попарный подсчёт по слоям через Set (не глобальный)
14. ✅ **Edge labels** — прямоугольник-фон + текст посередине ребра, стоят на месте (не сдвигаются), визуально отличаются от карточек
15. ✅ **LAYER_GAP** — 90, **NODE_GAP** — 40

### TextSkeletonizer (v4 — 2026-07-03, итерации 1-5)

16. ✅ **TextSkeletonizer** — клиентское сжатие текста для LLM
17. ✅ **Compression levels** — light (заголовки+статистика), medium (+термины), aggressive (+списки+код+ссылки)
18. ✅ **Адаптивный порог** — `recommendLevel()` определяет уровень по размеру текста
19. ✅ **Защита от отрицаний** — regex `[a-zа-яё0-9-]+` ловит короткие `не`/`ни`/`без`, `NEGATIONS.has()` работает
20. ✅ **LRU кэш** — hash(text):level → skeleton, до 50 записей. Активен в `_processSync`, `processAsync` и `onmessage`
21. ✅ **Web Worker** — `processAsync` синхронно для <20K, через Worker для ≥20K. Fallback при error/timeout/postMessage throw
22. ✅ **Лемматизация** — упрощённый стемминг для русского (suffix stripping), RU_SUFFIXES без дублей
23. ✅ **Интеграция** — flowchart.js + mindmap.js переключены на `await processAsync()`
24. ✅ **processAsync** — Worker при ≥20K, `_processViaWorker` с try/catch, clearTimeout, fallback
25. ✅ **Worker lifecycle** — `_fallbackWorkerCallbacks` + `_resetWorker` helpers. onerror/timeout/postMessage catch — все fallback в sync. Worker terminate при ошибке/timeout
26. ✅ **Code fences** — `inFence` в `_extractSections`, `_extractTitle`, `_extractLists`. Поддержка ``` и ~~~. Направленные spaces перед `#` (`^ {0,3}`)
27. ✅ **_extractKeyTerms** — чистка пунктуации через regex, удаление fenced blocks + inline code spans перед анализом
28. ✅ **_extractCodeBlocks** — `([^\s`]*)` для блоков без языка, backref `\1` для закрытия
29. ✅ **_extractFirstSentence** — char-by-char scanner, `ABBREVIATIONS` Set (т.е., prof., dr., inc.), digits-between-dots check
30. ✅ **_computeStats** — вынесена в worker (паритет с main)
31. ✅ **Нет паритета sync/worker** — worker инлайнит статистику → вынесено в `_computeStats`
32. ⏸ **Fence length tracking** — nested fences разной длины (`````...```...`````) не поддерживаются. Edge case, deferred
33. ⏸ **Аудит** — тикет `TICKET-text-skeletonizer.md`, ответы в `Bigbrat_govorit/`

### Flowchart — Известные баги (ЗАБЛОКИРОВАНО)

25. ❌ **Белые карточки** — backing и shape имеют правильный computed fill (`rgba(16,18,26,0.78)` и `rgba(25,28,40,0.92)`), но рендерятся белыми. Пробовали: `style.fill`, `setAttribute('fill')`, CSS-классы `.fc-shape`/`.fc-backing` в flowchart.css. DevTools подтверждает правильный computed fill. Причина не найдена.

### "Ща как напишу" — capture mode (2026-07-03)

1. ✅ **Кнопка** — SVG-иконка в футере текстового блока перед «Перевести». `font-ctrl-btn capture-btn`
2. ✅ **Режим захвата** — глобальный: выделение текста в любом текстовом блоке → mouseup → текст добавляется в sticky-блок
3. ✅ **Автосоздание заметки** — если sticky нет, создаётся через `State.addBlock('sticky')`
4. ✅ **Привязка к заметке** — `_captureStickyId` фиксирует целевой sticky при включении режима. Несколько sticky → всегда один
5. ✅ **Тримминг** —.leading spaces + trailing empty lines. `\n\n` между выделениями
6. ✅ **Пульсация** — `@keyframes capturePulse` 2.5s, `box-shadow` glow, класс `.capture-active`
7. ✅ **Кнопка «Копировать заметку»** — SVG `copy` на заголовке sticky-блока рядом с «Цвет заметки». Clipboard API + fallback

### Spell-check (итог)

1. ✅ **Click-to-accept** — клик по ошибке = preview suggestion, повторный клик = toggle, клик мимо = commit
2. ✅ **Rejection tracking** — 3 правых клика на слово → перестаёт предлагаться (per-block + global Map)
3. ✅ **Code fence filter** — ``` и ~~~ блоки не проверяются спеллером (_maskCodeFences)
4. ✅ **Position offset fix** — компенсация leadingTrim для API позиций (trimmed vs full ta.value)
5. ✅ **Blur guard** — `_spellApplying` флаг prevents blur от сброса active error во время setRangeText
6. ✅ **e.target guard** — клик по иконке блока/кнопкам не триггерит spell-check
7. ⏸ **Overlay drift** — floating баг: после ~10 строк фон сдвигается вправо на 1-2 символа. Debug-логи добавлены, отложено до тестирования.

### Тикеты (применены)

8. ✅ **LLM stale index** (`TICKET-stale-index-llm-apply.md`) — CSS pointer-events:none для textarea при groom, валидация `text` перед _applyToScope в groomBlock, валидация `val.slice(job.index, job.end) === job.full` в SmartPlaceholders.fillAll
9. ✅ **MiniChat featureKey crash** (`TICKET-minichat-featureKey-crash.md`) — `featureKey` → `featureKey: 'chat'` в error handler (строка ~3955)

### Основные баги (прошлая сессия)

10. ✅ **Ollama temperature** — `options: { temperature, num_predict: maxTokens }` в `_buildRequestBody`
11. ✅ **Profile race fix** — `_selectedProfileId` снапшот перед await в load-models/test-conn
12. ✅ **Thesaurus meta** — "5 синонимов" → "10 синонимов"
13. ✅ **Group children в preview** — `_renderBlockPreview()` хелпер, snippet/todo/table рендерятся в группах
14. ✅ **Block undo sync** — `State.snapshot()` после `blockUndo()`/`blockRedo()`
15. ✅ **Preview badge** — обновляется сразу при вводе через `buildOrderMap` + DOM update
16. ✅ **Workspace gap** — `flex: 0 1 auto` + preview `flex: 1`

### Blocked subtab (заблокированные подвкладки)

17. ✅ **Долгое нажатие на галочку** — 500ms mousedown → `sub.blocked = !sub.blocked`, `completed` сбрасывается
18. ✅ **Короткий клик** — `sub.completed = !sub.completed`, `blocked` сбрасывается
19. ✅ **Красный цвет** — `.todo-complete-cb.blocked` (рамка + SVG), `.block-subtab.subtab-blocked`, `.subtab-arrow.arrow-blocked`
20. ✅ **Стрелка навигации** — ◀/▶ подсвечивается красным в сторону заблокированного сабтаба
21. ✅ **Обновление при переключении** — `updateSubtabBlockedState(b)` в patchSubtab и обработчиках кликов

### Preview — Structure menu scrollbar

22. ❌ **Scrollbar в структуре** — баг: при `|` в тексте последнего блока появляется scrollbar. Откат всех попыток. Требует живой отладки в браузере.

### Preview — Code fence fix

23. ✅ **`_fixUnclosedBackticks` — fence-aware** — tracks ```/~~~ state, skips lines inside code fences
24. ✅ **`_closeOpenFences` per-block** — each block closes its own fences, prevents fence leak

### Flowchart — Round 9

25. ✅ **Убрана обводка текста** — `paint-order`, `stroke`, `stroke-width` удалены
26. ✅ **Шрифт Segoe UI** — `'Segoe UI', system-ui, sans-serif` для текста узлов
27. ✅ **Тёмные воздушные карточки** — `rgba(255,255,255,0.045)` заливка, `color + '50'` stroke 1.25px, `rgba(16,18,26,0.78)` подложка
28. ✅ **Маркер-полоса удалена** — из `_drawNode` и `_updateNodePosition`
29. ✅ **Proximity ratio** — `ratio` от размера панели (0.22/0.18) вместо фиксированных px

### Flowchart — Inline style fix + NodeSize fix

30. ✅ **style.fill вместо setAttribute('fill')** — inline style имеет приоритет выше CSS
31. ✅ **_nodeSize: ширина растёт со шрифтом** — `220 * (fs / 13)`, max 340
32. ✅ **_nodeSize: word-wrap в высоте** — `_wrapTextLines` внутри `_nodeSize`

### Git коммиты (эта сессия)

```
c8c9f40 fix: abbreviation check uses full prefix, strip inline code from key terms
15e3f9d fix: _fallbackWorkerCallbacks helper, timeout terminates worker, _computeStats in worker, abbreviation-aware first sentence
906386c fix: negation filter now sees short words, worker errors fallback to sync instead of reject
fe9f8eb fix: heading group indices, keyTerms regex eating text after code fence, code blocks without language tag
463de80 feat: enable LRU cache in TextSkeletonizer — lookup in _processSync/processAsync, store on worker resolve
c2a3d4d fix: skeletonizer iteration 2 — inFence in sections, postMessage try/catch, worker recovery, first sentence EOF, ~~~ fences, leading spaces in headings
e21b84a fix: worker lifecycle (onerror reject + clearTimeout), punctuation in key terms, code fences in title/lists
4fac1b8 fix: _extractSections — guard on post-loop push only, not inside loop
316e7b3 feat: TextSkeletonizer — processAsync with Worker, fix _extractLists index, off-by-one in _extractSections, dedup RU_SUFFIXES
c8914a5 fix: capture mode text trim (leading spaces + trailing empty lines) + sticky binding
a864086 feat: 'Ща как напишу' — capture mode for quick text collection + copy note button
31034c8 feat: Sugiyama layout engine — 6 phases: cycle removal, layer assignment, dummy nodes, crossing minimization, coordinate assignment, waypoint edge routing
e8792e9 fix: flowchart BFS infinite loop on cycles — add MAX_ROWS=50 guard
f4e892d fix: narrower query menu (220px), history only stores manual queries
eb8c01f feat: flowchart query menu — 5 presets, custom input, history with FIFO, proximity reveal
```

### Ключевые файлы

- `flowchart.js` (~1300 строк) — блок-схема: Sugiyama v2 layout, query menu, node drag
- `flowchart.css` (~250 строк) — стили блок-схемы
- `spell-check.js` (~250 строк) — Yandex Speller API, code fence masking
- `blocks.js` (~3780 строк) — spell-check, "Ща как напишу" capture mode, sticky copy button, GPT audit fixes
- `llm-features.js` (~4510 строк) — stale index protection, MiniChat featureKey fix
- `styles.css` (~6100 строк) — blocked subtab CSS, capturePulse animation
- `ui.js` (~2073 строк) — structure menu, fence-aware backticks
- `text-skeletonizer.js` (~510 строк) — LRU cache, processAsync, Worker lifecycle, fence-aware extractors
- `state.js` (~1230 строк) — State, Events, persistence, history, search, GPT audit fixes (58 fixes)
- `ai-transform.js` (~450 строк) — AI transform module, GPT audit fixes (39 fixes)
- `anchors.js` (~600 строк) — anchor navigation, markers, palette, GPT audit fixes (25 fixes)
- `text-skeletonizer-worker.js` (~270 строк) — Worker с паритетной логикой
- `flowchart.js` и `mindmap.js` — `_fetchWithQuery` используют `await processAsync()`
- `prompt-blocks-review.md` / `prompt-state-review.md` / `prompt-aitransform-review.md` / `prompt-anchors-review.md` — GPT audit prompts

## Architecture Decisions

- **Sugiyama v2 layout** — pipeline: cycle removal → layer assignment (longest-path + compact) → dummy nodes → crossing minimization (20 iters, best-score selection) → coordinate assignment (centered, dummy interpolation) → orthogonal edge routing. Dummy nodes резервируют track для длинных рёбер.
- **Edge routing** — прямые линии через waypoints для длинных рёбер, прямые для соседних слоёв, orthogonal side arcs для back-edges. Catmull-Rom удалён (создавал хаотичные кривые).
- **Crossing minimization** — median heuristic, 20 итераций с tracking best-score. Попарный подсчёт пересечений по слоям (не глобальный).
- **Auditor answers** — 4 аудитора консультировали по layout engine. Ответы в `Bigbrat_govorit/` с INDEX.md. Выбран подход Auditor 4 (Sugiyama с dummy nodes).

- **Inline style > setAttribute** — SVG fill/stroke через `style.fill`/`style.stroke` для приоритета над CSS
- **nodeSize с word-wrap** — `_nodeSize` вызывает `_wrapTextLines`, возвращает `lines`
- **Proximity ratio** — ratio от размера панели вместо фиксированных px
- **Blocked subtab** — долгое нажатие (500ms) vs короткий клик для blocked vs completed
- **Spell-check batching** — 4000 chars per request, LRU cache
- **Spell-check rejection** — per-block Map + global Map, 3 rejections = permanent ignore
- **Spell-check code fences** — `_maskCodeFences` маскирует содержимое ```/~~~ перед отправкой в API
- **Spell-check position fix** — `leadingTrim = text.length - text.trimStart().length` компенсирует сдвиг API
- **Flowchart fill cascade** — `style.fill` решает проблему приоритета CSS над SVG атрибутами
- **Code fences per-block** — `_closeOpenFences` применяется per-block, fence-aware `_fixUnclosedBackticks`
- **TextSkeletonizer Worker** — `processAsync` синхронно для <20K, Worker для ≥20K. `_fallbackWorkerCallbacks` + `_resetWorker` — единый helper для onerror/timeout/catch
- **TextSkeletonizer cache** — LRU по `level + ':' + _hash(text)`, 50 записей. Lookup в processSync/processAsync/onmessage
- **Capture mode** — глобальный `_captureMode` + `_captureStickyId`. mouseup listener в каждом renderTextBody. Тримминг: leading spaces + trailing empty lines
- **TextSkeletonizer fences** — `inFence` toggle в sections/title/lists. Fence length tracking deferred (rare edge case)

## Ожидают решения

- **ТЕКУЩИЙ БАГ: подсветка строки** — drift вниз к 400-й строке. updateCurrentLineHighlight() в blocks.js. Mirror-based расчёт позиции накапливает ошибку. Возможно несовпадение ширины mirror/textarea из-за scrollbar. Исправить ДО继续 аудита app.js
- **Structure menu scrollbar** — баг с `|` в тексте последнего блока
- **Spell-check overlay drift** — после ~10 строк фон сдвигается вправо
- **TextSkeletonizer fence length** — nested fences разной длины
- **TextSkeletonizer мёртвый API** — `shouldCompress()` не используется

### Column resize + independent scroll fix (2026-07-03)

1. ✅ **Resizer drag** — `applyLayout(ratios)` принимает параметр, не вызывает `State.setLayout()` в mousemove → нет `fullRender()` → ресайзеры живут → drag плавный. State коммитится на mouseUp.
2. ✅ **Independent column scrolling** — `.column { overflow-y: auto }`, `#workspace { overflow: hidden }`. Каждая колонка скроллится отдельно.
3. ✅ **Scrollbar off by default** — `#workspace { scrollbar-width: none }`. `.col-scrollbar` toggle возвращает.

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
