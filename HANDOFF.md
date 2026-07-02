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
83bdcc2 docs: update HANDOFF — spell-check improvements, LLM fixes, code fence filter
e55cf02 debug: add position tracking logs for spell-check overlay drift investigation
65b4ac1 feat: spell-check skips code fences (```/~~~)
9d3135f feat: spell-check rejection tracking — 3 reverts per-block or globally hides word
84dadbf fix: spell-check position offset — leadingTrim compensation
9de8b16 fix: spell-check blur handler — add _spellApplying guard
392f666 fix: spell-check click handler — e.target !== ta guard
3b3be8a feat: spell-check click-to-accept with toggle, commit/revert, visual debounce
7984255 fix: MiniChat featureKey → 'chat' in error handler
1a54a8a fix: stale index protection for LLM async operations
```

### Ключевые файлы

- `spell-check.js` (~250 строк) — Yandex Speller API, code fence masking, placeholder masking, position offset compensation
- `blocks.js` (~3640 строк) — spell-check integration: click-to-accept, toggle, rejection tracking, visual debounce, blocked subtab
- `llm-features.js` (~4510 строк) — stale index protection, MiniChat featureKey fix
- `flowchart.js` (~940 строк) — Round 9: style.fill, Segoe font, no bar, ratio proximity, nodeSize word-wrap
- `styles.css` (~6100 строк) — blocked subtab CSS, spell-check overlay/popup
- `ui.js` (~2073 строк) — structure menu, _fixUnclosedBackticks fence-aware, _closeOpenFences per-block
- `state.js` — spellCheck: false in DEFAULT_LAYOUT

## Architecture Decisions

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

## Ожидают решения

- **Structure menu scrollbar** — баг с `|` в тексте последнего блока. Нужна живая отладка
- **Spell-check overlay drift** — после ~10 строк фон сдвигается вправо на 1-2 символа. Debug-логи на месте, требует investigation

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
