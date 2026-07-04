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

## Status — ТЕКУЩАЯ СЕССИЯ (2026-07-04)

### Ember.js + ember-styles.css — GPT аудит завершён (2026-07-04)

15 раундов аудита, ~180 фиксов. Ключевые изменения:

**Критичные:**
- BroadcastChannel: tabId !== currentTabId (принимал от СЕБЯ, не от других вкладок)
- storage sync: слушает по STORAGE_KEY_PREFIX (не точный tabId key)
- switchTab(): setupBroadcast() + prevAppliedRemaining reset
- initParticlePool(): после DOM mount
- enableTestMode: !!value вместо !value
- setupEventListeners: listenersBound guard от дублей
- zone cleanup: isExtraZone race condition fix

**3D-рендеринг:**
- createPose: z, coreLift, glowLift, ringDepth, lightX, lightY, shadowTighten
- commitPose: depthTiltX/Y, depthZ, glowDepth, ringDepthVal, gaze-driven lighting
- CSS: perspective 320px, preserve-3d на .ember, .ember-core, .ember-ring
- translateZ на core, glow, ring, crust, haze, segments
- coreEl background: light gradient с --lightX/--lightY

**Motion signatures (8 функций):**
- applySighPose: тяжёлый вздох с coreLift, shadowTighten
- applyCalmBurnPose: микро-glitch, lightX/lightY flicker
- applyWigglePose: burst/jitter/settle, sideBulge
- applyTiltPose: асимметричный lean, massShiftX
- applyStretchPose: extend+rebound, scaleX compression
- applySleepySagPose: drift, glow dimming
- applySmolderPose: emberNoise, flare spikes
- applyGustPose: blast/carry/snapBack, ashShiftX

**Per-type частицы:**
- ash: swirlFactor, heatLift, rotSpeed, alphaBias
- spark: gravity, windInfluence, trail, rotSpeed
- shootingSpark: gravity, windInfluence, rotSpeed
- crumb: bounce, rotSpeed, groundHit
- anomaly: редкие искры из правого верхнего угла в центр экрана
- anomaly-dust: микро-пыль от anomaly

**Performance:**
- setVar() style cache: все hot path → cache Map
- setStyle(): cache для direct style property writes
- acquireEl: free-list O(1) через freeParticleIndices stack
- releaseEl: push back to free-list
- updateParticles: in-place filter (без нового массива)
- applySegments: skip при неизменном remaining
- sampleCaretPosition: skip при не typing
- spawnLandingGlow: пул из 8 элементов
- spawnLandingGlow: skip в reduced/low-fps
- updateHeatZones: cleanup excess zones >3
- updateRingSegments: skip при segmentEffects active
- CSS will-change: conditional на low-fps class
- CSS shimmer: disabled в low-fps

**Reduced motion:**
- Early return с полным набором CSS vars
- rAF в setTimeout callback
- Skip mouse/caret sampling
- Skip hotspots/wind/attention/particles/shimmer

**Tooltip:**
- hideTooltip(): centralized lifecycle
- Click-only (не по hover)
- Refresh при status/edit
- mouseleave/rootBlur: hideTooltip()
- Reuse DOM element

**State sync:**
- normalizeState: sourceTabId
- applyRemoteState: deterministic tie-break (updatedAt > lastEditTime > sourceTabId)
- notifyEdit: sourceTabId

**Safety:**
- destroyed flag: guard setTimeout после destroy
- animate: destroyed || !root guard
- Test mode: auto-stop на blur/hidden

### Git коммиты (ember.js)

```
501aa2d ember.js: anomaly sparks — rare living particles from upper-right
a40aabd ember.js R10: listenersBound, glow pool, tooltip refresh, keyboard UX, CSS perf
fb56266 ember.js: tooltip only on click — remove showTooltip from mouseenter/rootFocus
a048985 ember.js R9: tooltip lifecycle, reduced motion scheduler, state merge, perf
865856d ember.js R8-fix: ring/segments/sparks regression fix
17b633c ember.js: fix updateHeatZones .filter(Boolean) on undefined
9cb2fe9 ember.js R8: memory leaks, state sync, free-list, tooltip guard, shimmer
574320d ember.js R7: UX tooltip fixes, destroyed flag, syncAccessibleLabel
09be34b ember.js R5: BroadcastChannel fix, setVar hot path, reduced motion pipeline, perf
dd0d240 ember.js R4: safe destroy, idempotent broadcast, style cache, perf fixes
5ff4b80 ember.js R3: 3D depth, differentiated motion signatures, per-type particle physics
c62df60 ember.js feel-alive pass: temperament, gaze, anticipation, split heat, breathing
4e0c9fe ember.js R2: defer timers, dblclick cleanup, state versioning, pool limit
```

**Итого ember.js: ~180 фиксов за 15 раундов аудита + feel-alive pass**

### Текущий статус аудитов

- ✅ blocks.js: аудит завершён
- ✅ state.js: аудит завершён
- ✅ ai-transform.js: аудит завершён
- ✅ anchors.js: аудит завершён
- ✅ translator.js: аудит завершён (5 раундов, 78 фиксов)
- ✅ notepad.js: аудит завершён (5 раундов, 83 фикса)
- ✅ intelligence-core.js: аудит завершён (6 раундов, 69 фиксов)
- ✅ project-graph.js: аудит завершён (5 раундов, 29 фиксов)
- ✅ **ember.js + ember-styles.css: аудит завершён** (15 раундов, ~180 фиксов)

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

**translator.js (5 раундов, 78 фиксов)**
- Security: Google key validation, fetchWithTimeout abort, credentials/referrerPolicy, response size limit
- Race conditions: shared GoogleKey/MsToken promises, AbortError handling, translate race guard (notepad)
- Cache: dirty flag fix, TTL for old entries, MAX_CACHE_TEXT_LEN, cacheKey string concat, loadCache stale filter
- API: HTTP error handling (!r.ok), Retry-After header, MS Chinese mapping, Legacy max query/stop/breaker, Google key reset 401/403
- UX: needsTranslation in pipeline, translateProtected token-history, formatting preservation, null→original fallback, history dedup
- Settings: normalizeTargetLang, ENGINES constant, loadSettings validation, targetLang/engine setter validation
- Performance: decodeHtmlEntities DOM reuse, loadCache 5MB guard, TTL constants, countChars helper
- Readability: accept echo detection, retry readability, templateSeq counter, HAN_RE/NON_LETTER constants
- Template protection: TMPL_RE \b fix, length limits, Unicode sentinels (⟦...⟧), %VAR% regex

**notepad.js (3 раунда, 62 фикса)**
- Critical: disconnected DOM cleanup, async paste/translate race guards, Shift+Tab de-indent fix
- State: per-tab undo history, tabOffset persistence, minimized persistence, _translateOriginal per-tab
- UX: chevron on restore, double-click guard, rename maxLength 12, Ctrl+S, undo/redo caret, focus minimized
- Safety: cut clipboard safety, paste type safety, Toast safety (_toast helper), TextEncoder fallback
- Persistence: _loadSaved full validation, cssPx validation, _persist skip identical, strip _history from persist
- Performance: renderTabs optimization (filled-state only), renderTabs fragment, _updateCount threshold, line count
- Readability: magic numbers constants, translate handler extraction, _mkBtn addEventListener, clean FIX comments
- Keyboard: Tab accessibility (Alt+Tab escape, metaKey), undo for Tab/Shift+Tab
- Resize/Drag: abort on close, actual size boundary, resize viewport bounds, position after size

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
60e4df4 translator: GPT audit round 5 (final) — 12 fixes (TMPL_RE \b fix, Unicode sentinels, credentials, Google key reset, Retry-After, forced engine null→original, pagehide, response size, accept echo, loadCache guard, TTL constants)
39e185b translator: GPT audit round 4 — 29 fixes (fetchWithTimeout, input validation, normalizeTargetLang, TMPL_RE limits, HAN_RE, cache limits, getStorage, error details, referrerPolicy, legacy max query/breaker, translate null→original, init guard, visibilitychange, clearCache reset, countChars)
cafe828 translator: GPT audit round 3 — 12 fixes (translateProtected token-history, formatting preservation, history dedup, batch for-loop, MS Chinese mapping, loadCache stale filter, ENGINES constant, retry readability, templateSeq, translateOne no-op, _stats.failed, Legacy engine)
0bdd36d translator: GPT audit round 2 — 16 fixes (AbortError, shared promises, needsTranslation, Legacy defensive, settings validation, URL encoding, DOM reuse, cache key, history, CJK, accept, _stats.failed, Legacy engine)
c086b76 translator: GPT audit round 1 — 9 fixes (withTimeout cleanup, HTTP error handling, Google key validation, cache dirty flag, cache TTL, template token uniqueness, needsTranslation all langs, dead code removal, clearCache bug)
a51c6c8 notepad: GPT audit round 3 — 19 fixes (disconnected DOM cleanup, Shift+Tab fix, chevron on restore, double-click guard, rename maxLength 12, undo for Tab, clear history order, cut without clipboard, paste type safety, translate cancel toast, undo/redo renderTabs, _updateCount threshold, renderTabs cancel click, focus minimized, persist after restore, cssPx non-negative, dead _lastFilled, clean FIX comments, localStorage error reason)
5578f24 notepad: GPT audit round 2 — 21 fixes (loadSaved tabs safety, async paste/translate race, history flush order, per-tab undo, tabOffset persist, position after size, resize viewport bounds, translate original per-tab, commitTitle reset, Escape rename, Tab metaKey, undo caret, persist skip identical, _updateCount KB approx, renderTabs fragment, strip _history from persist, activeTab Math.max, cssPx validation, addEventListener, minimize persist)
59ece03 notepad: GPT audit round 1 — 22 fixes (click timer cleanup, drag/resize abort, singleton guard, cut clipboard safety, history flush, per-tab undo, transfer all-full, translate race/selection, loadSaved validation, position clamp, notepad-container fallback, commitRename guard, filename sanitize, renderTabs optimization, persist error toast, Ctrl+S, toast safety, TextEncoder fallback, line count, Tab accessibility, translate handler, magic numbers)
f2b78f1 notepad: GPT audit round 4 — 13 fixes (closeNotepad pushHistory, MAX_HISTORY histIdx, paste textarea ref, translate sourceValue, tabOffset normalize, title/rename editing guards, Escape restore, cut cancel, translate btn disable, undo/redo conditional render, create cleanup, save Ctrl+S tooltip)
aaef441 notepad: GPT audit round 5 — 8 fixes (_openRenameOnTab sync, ondblclick simplify, undo/redo/input clears translateOriginal, restore pushHistory, minimize flush, clearBtn input event, _syncActiveTabValue helper, viewport margin, keydown early returns)
05100bb intelligence-core: GPT audit round 1 — 20 fixes (safeCall wrapper, refresh try/catch, editSessions cleanup, stableStringify cycles, hasMeaningfulDiff, acceptSuggestion post-check, template tracking, sanitizeUserTitle, snippet Set, prepareSuggestions Set, findSnippetCandidate linear, computeFinality single pass, applyStructureCandidate order, dismissSuggestion by hash, escapeHtml label, scheduleRefresh min interval, trackEdit cleanup, getSuggestions copy, preferredColumn recursive)
221e4f0 intelligence-core: GPT audit round 2 — 12 fixes (track try/catch, suppressed suggestions hidden flag, applyStructureCandidate false success, saveTemplate Storage API check, llm-feature handler check, low confidence fallback, getContext cache, rememberSuccessfulStructure reuse, suggestionSortScore priority, openReport duplicates safety, prompt Cancel vs empty, dead lastExport)
083613b intelligence-core: GPT audit round 3 — 8 fixes (runningSuggestionActions guard, preview return value, previewed tracking, snippet re-check after prompt, structuredClone, template name no fallback, timeline 50 limit, getInsertionTargets limit, DOM placement select)
5391c60 intelligence-core: GPT audit round 4 — 9 fixes (acceptSuggestion catch, normalizePayload strip content, Array.isArray safety, computeFinality settled, trackEdit tabId key, getContext skip empty, openReport array validation, template ID random, previewCompanionBlock selectable)
1653646 intelligence-core: GPT audit round 5 — 10 fixes (makeContextKey String guard, personalizeConfidence NaN, findCurrentBlockByHash subtabs, formatLocalDate, sanitizeReportText, snapshot throttle, acceptSuggestion tab check, FINALITY_SIGNAL_WINDOW_MS, openPreparedReport validation, track skip report events)
f4fffe3 intelligence-core: GPT audit round 6 (final) — 10 fixes (deep clone suggestions, contextTextHash stale check, stableStringify seen.delete, getStructureSections idx+hash, loadTemplates Array.isArray, structuredClone fallback, renderReportLines limits, getContext blockStructureKey, recentEvents Array.isArray, insertBlockNear dedup)
368b76e project-graph: GPT audit round 1 — 7 fixes (import sanitization, safe save/export, pair dedup+limit, trimGraph guard, similarity cache)
7f23bf9 project-graph: GPT audit round 2 — 5 fixes (cache collision, safe import, counters sync, baselines sanitize, blockHashes 64)
3b514c2 project-graph: GPT audit round 3 — 3 fixes (trimSnapshotsByLimit cap protected, MAX_SNAPSHOT_BLOCK_META=64, titleRole word-boundary)
f64d37a project-graph: GPT audit round 4 — 3 fixes (rememberBlockNodes, cacheId skip 'current', importData counters recalc)
2d4a4cc project-graph: GPT audit round 5 — 11 fixes (simCache invalidation, findDerivedFrom earlier-only, trimObjectByLastSeen preserve, findRoleGaps blockRoles, findSimilarPrompt linear scan, cooldown+structureHash, timeline named dedup, snapshotView helper, compareNamedVersionToCurrent unchanged, migrateGraph, getPinnedBaseline read-only)
```

**Итого: ~579 фиксов за 54 раунда аудита**

**Текущий статус:**
- ✅ blocks.js: аудит завершён
- ✅ state.js: аудит завершён
- ✅ ai-transform.js: аудит завершён
- ✅ anchors.js: аудит завершён
- ✅ **translator.js: аудит завершён** (5 раундов, 78 фиксов)
- ✅ **notepad.js: аудит завершён** (5 раундов, 83 фикса)
- ❌ **ТЕКУЩИЙ БАГ:** подсветка текущей строки смещается вниз к 400-й строке ( drift накапливается)
- ⏳ app.js: ожидает аудит (969 строк)
- ✅ **intelligence-core.js: аудит завершён** (6 раундов, 69 фиксов)
- ✅ **project-graph.js: аудит завершён** (5 раундов, 29 фиксов)
- 🔄 **ember.js + ember-styles.css: раунд 1** (10 фиксов, ожидает следующий раунд)

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
- `translator.js` (~763 строк) — Google/MS/Legacy translate, GPT audit fixes (78 fixes, 5 раундов)
- `notepad.js` (~1007 строк) — singleton floating notepad, GPT audit fixes (83 fixes, 5 раундов)
- `intelligence-core.js` (~1699 строк) — ядро интеллектуальных подсказок, scoring, prediction, GPT audit fixes (69 fixes, 6 раундов)
- `project-graph.js` (~1494 строк) — граф проекта для Intelligence Layer, snapshot capture, similarity, GPT audit fixes (29 fixes, 5 раундов)
- `ember.js` (~3800 строк) — "Уголёк", живой индикатор состояния проекта, rAF + particle system + peek state machine, 3D depth, per-type particles, anomaly sparks, GPT audit fixes (~180 fixes, 15 rounds)
- `ember-styles.css` (~650 строк) — стили уголька, CSS custom properties, 3D depth, keyframe animations, anomaly spark CSS
- `text-skeletonizer-worker.js` (~270 строк) — Worker с паритетной логикой
- `prompt-translator-review.md` — GPT audit prompt для translator.js
- `prompt-notepad-review.md` — GPT audit prompt для notepad.js
- `prompt-intelligence-core-review.md` — GPT audit prompt для intelligence-core.js
- `prompt-project-graph-review.md` — GPT audit prompt для project-graph.js
- `prompt-ember-review.md` — GPT audit prompt для ember.js + ember-styles.css
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
- **Ember 3D depth** — perspective 320px + preserve-3d на .ember. translateZ на core (z), glow (glowDepth), ring (ringDepth), crust (+1px), haze (-8px). Gaze-driven lightX/lightY на core gradient.
- **Ember motion signatures** — 8 уникальных pose-функций с разной физикой: sigh (вздох), calmBurn (тление), wiggle (джиттер), tilt (наклон), stretch (упругий rebound), sleepySag (таяние), smolder (вспышки), gust (порыв с инерцией)
- **Ember per-type particles** — ash (swirl+heatLift), spark (gravity+trail), shooting (high speed), crumb (bounce), anomaly (arc+jitter из правого верхнего угла), anomaly-dust (микро-пыль)
- **Ember style cache** — setVar() и setStyle() через Map<el, Map<name, value>>. Кэширует CSS custom properties и прямые style writes. Очищается при destroy и на временных DOM элементах.
- **Ember free-list** — acquireEl O(1) через freeParticleIndices stack. releaseEl push back. Аналогично glowPool из 8 элементов для landing glow.
- **Ember reduced motion** — early return с полным набором CSS vars. setTimeout → rAF scheduler. Skip mouse/caret/hotspots/wind/attention/particles/shimmer.
- **Ember tooltip lifecycle** — hideTooltip(immediate) + showTooltip с reuse DOM element. Click-only. Refresh при status/edit. mouseleave/rootBlur скрывают.
- **Ember state sync** — BroadcastChannel filter: tabId !== currentTabId. storage: startsWith(STORAGE_KEY_PREFIX). Deterministic tie-break: updatedAt > lastEditTime > sourceTabId.

## Ожидают решения

- **ТЕКУЩИЙ БАГ: подсветка строки** — drift вниз к 400-й строке. updateCurrentLineHighlight() в blocks.js. Mirror-based расчёт позиции накапливает ошибку. Возможно несовпадение ширины mirror/textarea из-за scrollbar.
- **Structure menu scrollbar** — баг с `|` в тексте последнего блока
- **Spell-check overlay drift** — после ~10 строк фон сдвигается вправо
- **TextSkeletonizer fence length** — nested fences разной длины
- **TextSkeletonizer мёртвый API** — `shouldCompress()` не используется
- ⏳ app.js: ожидает аудит (969 строк)

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
