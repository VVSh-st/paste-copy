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

## Status — ТЕКУЩАЯ СЕССИЯ (2026-07-02)

### Spell-check (продолжение)

1. ✅ **Click-to-accept** — клик по ошибке = preview suggestion, toggle, клик мимо = commit
2. ✅ **Rejection tracking** — 3 правых клика на слово → перестаёт предлагаться (per-block + global)
3. ✅ **Code fence filter** — ``` и ~~~ блоки не проверяются спеллером
4. ✅ **Position offset fix** — компенсация leadingTrim для API позиций
5. ✅ **Blur guard** — `setRangeText` не сбрасывает active error
6. ✅ **e.target guard** — клик по иконке блока не триггерит spell-check
7. ⏸ **Overlay drift** — floating баг: после ~10 строк фон сдвигается вправо на 1-2 символа. Debug-логи добавлены, отложено до тестирования.

### Тикеты (применены)

8. ✅ **LLM stale index** — блокировка textarea при groom, валидация позиций в SmartPlaceholders
9. ✅ **MiniChat featureKey crash** — `featureKey` → `'chat'` в error handler

### Основные баги (прошлая сессия)

5. ✅ **Ollama temperature** — `options: { temperature, num_predict: maxTokens }` в `_buildRequestBody`
6. ✅ **Profile race fix** — `_selectedProfileId` снапшот перед await в load-models/test-conn
7. ✅ **Thesaurus meta** — "5 синонимов" → "10 синонимов"
8. ✅ **Group children в preview** — `_renderBlockPreview()` хелпер, snippet/todo/table рендерятся в группах
9. ✅ **Block undo sync** — `State.snapshot()` после `blockUndo()`/`blockRedo()`
10. ✅ **Preview badge** — обновляется сразу при вводе через `buildOrderMap` + DOM update
11. ✅ **Workspace gap** — `flex: 0 1 auto` + preview `flex: 1`

### Blocked subtab (заблокированные подвкладки)

12. ✅ **Долгое нажатие на галочку** — 500ms mousedown → `sub.blocked = !sub.blocked`, `completed` сбрасывается
13. ✅ **Короткий клик** — `sub.completed = !sub.completed`, `blocked` сбрасывается
14. ✅ **Красный цвет** — `.todo-complete-cb.blocked` (рамка + SVG), `.block-subtab.subtab-blocked`, `.subtab-arrow.arrow-blocked`
15. ✅ **Стрелка навигации** — ◀/▶ подсвечивается красным в сторону заблокированного сабтаба
16. ✅ **Обновление при переключении** — `updateSubtabBlockedState(b)` в patchSubtab и обработчиках кликов

### Preview — Structure menu scrollbar

17. ❌ **Scrollbar в структуре** — баг: при `|` в тексте последнего блока появляется scrollbar. Откат всех попыток (clientHeight clamp, pipe replacement, CSS hiding). Требует живой отладки в браузере.

### Flowchart — Round 9

18. ✅ **Убрана обводка текста** — `paint-order`, `stroke`, `stroke-width` удалены. Контраст и так достаточный на тёмном фоне
19. ✅ **Шрифт Segoe UI** — `'Segoe UI', system-ui, sans-serif` для текста узлов вместо `var(--mono)`
20. ✅ **Тёмные воздушные карточки:**
    - Заливка: градиент → `rgba(255,255,255,0.045)` (единая для всех)
    - Stroke: `color + '90'` / 2px → `color + '50'` / 1.25px
    - Подложка: `rgba(10,11,16,0.92-0.95)` → `rgba(16,18,26,0.78)`
    - Градиенты удалены из `_buildDefs` и `_ensureGradient`
21. ✅ **Маркер-полоса удалена** — из `_drawNode` и `_updateNodePosition` (data-role="bar")
22. ✅ **Proximity ratio** — фиксированные 150/120px → `ratio` от размера панели (0.22/0.18)

### Flowchart — Inline style fix (CSS override)

23. ✅ **style.fill вместо setAttribute('fill')** — все fill/stroke карточек в `_drawNode` через inline `style`, чтобы внешний CSS не перебивал. Решает два симптома: светлые карточки + просвечивающие ребра

### Flowchart — NodeSize fix

24. ✅ **_nodeSize: potolok ширины растёт со шрифтом** — `220 * (fs / 13)` вместо фиксированных 220, max 340
25. ✅ **_nodeSize: word-wrap в высоте** — `_wrapTextLines` вызывается внутри `_nodeSize`, высота считается по реальным строкам
26. ✅ **_drawNode: lines из _nodeSize** — убран повторный `_wrapTextLines`

### Git коммиты (эта сессия)

```
e55cf02 debug: add position tracking logs for spell-check overlay drift investigation
65b4ac1 feat: spell-check skips code fences (```/~~~) — content inside fenced blocks not sent to Yandex Speller
9d3135f feat: spell-check rejection tracking — 3 reverts per-block or globally hides word from overlay
84dadbf fix: spell-check position offset — API counts from trimmed text but overlay renders from full ta.value, compensate with leadingTrim offset
9de8b16 fix: spell-check blur handler was clearing active error during setRangeText — add _spellApplying guard
392f666 fix: spell-check click handler ignores clicks on block icons (e.target !== ta guard)
3b3be8a feat: spell-check click-to-accept with toggle, commit/revert, visual debounce — no popup needed
7984255 fix: replace undefined featureKey with 'chat' in MiniChat.send() error handler
1a54a8a fix: stale index protection for LLM async operations
e139394 fix: nodeSize scales width with fontSize and accounts for word-wrap
f499a40 fix: use inline style for fill/stroke in _drawNode to override external CSS
f8efc7c fix: restore accidentally deleted variable declarations in flowchart.js
9b0cc05 feat: flowchart round 9 — remove text stroke, dark airy cards, Segoe font, remove bar marker, ratio-based proximity
6c7d654 Revert "fix: replace | in structure menu preview to prevent scrollbar glitch"
121a6ee fix: replace | in structure menu preview to prevent scrollbar glitch
dbdde4d fix: hide structure menu scrollbar, keep scroll-by-wheel
6a6d2d8 fix: structure menu scrollbar flicker — clamp targetY to clientHeight
b9bff0b fix: hide scrollbar in preview structure menu
502686d feat: blocked subtab — long-press checkbox turns red, highlights arrow toward blocked
e85acd6 fix: workspace gap — columns overflow visible, workspace scrolls
e7ccb4b revert: workspace layout changes — broke preview panel
41ee951 fix: workspace gap — preview fills remaining space via flex
336b2d7 fix: remove min-height from workspace to eliminate dark gap
298e83f fix: preview badge updates immediately on text input
78899fc feat: spell-check batching for large texts
6bf9f4c revert: spell-check popup/inline-toggle attempts — back to basic overlay
95afee0 fix: remove _spellCursorHandler — was accepting on every textarea click
628e1cf debug: add console.log to spell-check event handlers
be58dfd fix: spell overlay not visible — move to body with position:fixed
```

### Preview — Code fence fix

18. ✅ **`_fixUnclosedBackticks` — fence-aware** — now tracks ```/~~~ state and skips lines inside code fences,不再 adds backtick to ```` ```javascript ````
19. ✅ **`_closeOpenFences` per-block** — each block closes its own fences, preventing fence leak into subsequent blocks. Per-block → per-block (reverted "final text" approach that broke "Разное")

### Git коммиты (продолжение)

```
8138e77 fix: revert _closeOpenFences to per-block — prevents fence leaking into subsequent blocks
2a72c76 fix: code fence detection — _fixUnclosedBackticks now skips lines inside fences
```

### Ключевые файлы

- `spell-check.js` (~250 строк) — Yandex Speller API, code fence masking, placeholder masking, position offset compensation
- `blocks.js` (~3640 строк) — spell-check integration: click-to-accept, toggle, rejection tracking, visual debounce
- `llm-features.js` (~4510 строк) — stale index protection, MiniChat featureKey fix
- `flowchart.js` (~940 строк) — Round 9: style.fill, Segoe font, no bar, ratio proximity, nodeSize word-wrap
- `flowchart.css` — glass panels, zoom-bar
- `blocks.js` (~3555 строк) — blocked subtab (long-press), updateSubtabBlockedState
- `styles.css` (~6100 строк) — blocked subtab CSS (.todo-complete-cb.blocked, .subtab-blocked, .arrow-blocked)
- `spell-check.js` — Yandex Speller module ( batching, cache, overlay)
- `ui.js` (~2073 строк) — structure menu, _fixUnclosedBackticks fence-aware, _closeOpenFences per-block
- `state.js` — spellCheck: false in DEFAULT_LAYOUT

## Architecture Decisions

- **Inline style > setAttribute** — SVG fill/stroke через `style.fill`/`style.stroke` вместо `setAttribute`, потому что inline style имеет приоритет выше любого CSS-правила в каскаде (кроме `!important`)
- **nodeSize с word-wrap** — `_nodeSize` сам вызывает `_wrapTextLines` и возвращает `lines`, чтобы `_drawNode` не делал повторный вызов
- **Proximity ratio** — фиксированные px заменены на ratio от размера панели, чтобы зона появления масштабировалась
- **Blocked subtab** — долгое нажатие (500ms) vs короткий клик для двух состояний (blocked vs completed)
- **Spell-check batching** — 4000 chars per request к Yandex Speller, LRU cache
- **Flowchart fill cascade** — атрибут `fill` в SVG имеет наименьший приоритет, внешний CSS перебивает; `style.fill` решает это
- **Code fences per-block** — `_closeOpenFences` применяется per-block, не к финальному тексту. Иначе opening ``` из одного блока «утекает» в следующий и оборачивает его содержимое в код. `_fixUnclosedBackticks` теперь fence-aware — не ломает ```javascript добавлением 4-го бэктика

## Ожидают решения

- **Structure menu scrollbar** — баг с `|` в тексте последнего блока. Все автоматические попытки откачены. Нужна живая отладка в браузере (DevTools → inspect → overflow debugging)
- **Spell-check interaction** — popup/inline откатены. Возможен подход через external overlay на body с absolute positioning и API Yandex Speller для получения позиций ошибок

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
