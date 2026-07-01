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

## Status — ТЕКУЩАЯ СЕССИЯ (2026-07-01)

### start-server — Python Embedded

1. ✅ **start-server.bat** — `start /min` вместо `start /b` для надёжного запуска Python Embedded
2. ✅ **start-server.vbs** — скрытый запуск без окна, прямой вызов python.exe через WScript.Shell
3. ✅ **start-server-debug.bat** — для отладки, прямой запуск в консоли (видны ошибки)
4. ✅ **stop-server.bat** — taskkill по имени + по PID через порт 8080, проверка результата
5. ✅ **Кириллица в BAT** — убрана, латиница для совместимости кодировок

### Flowchart — Round 7

6. ✅ **getScreenCTM координаты** — `_canvasCoords`, pan, wheel, zoom через `_svg.getScreenCTM().inverse()` вместо ручного `VCW/rect.width`
7. ✅ **Фикс позиции нового блока** — `(VCW / 2 - _panX) / _zoom` вместо `VCW / 2 - _panX / _zoom`
8. ✅ **Визуал: fill-opacity 0.18** — все формы (diamond, circle, stadium, rect), stroke 2px + color+90
9. ✅ **Цветная полоса** — `rect` слева у rect/stadium/cylinder, `data-role="bar"`
10. ✅ **Шрифт 13px** — `_fontSize` в localStorage, `_nodeSize` зависит от `_fontSize`
11. ✅ **Долгий клик удаление вкладки** — 600ms hold на пилюлю, `_confirmDeleteCanvas`, защита от удаления последнего
12. ✅ **Зум кнопки** — −/100%/+ вместо слайдера, `_zoomBy(delta)`, кнопка-центр = `_fitToContent()`
13. ✅ **Force layout: movable-only** — `n._movable` флаг, размещённые узлы неподвижны
14. ✅ **Auto layout: dynamic spacing** — `Math.max(240, node.w + 40)` вместо фиксированного 240
15. ✅ **Тултип добавления блока** — SVG-иконки 5 форм, `_showAddNodeTooltip`, `SHAPE_ICONS`
16. ✅ **patchSubtab в API** — добавлен в `Blocks` public API

### Flowchart — Round 8

17. ✅ **_fitToContent min zoom** — `minZoomForText` через `getScreenCTM().a` + `_fontSize`, `MIN_READABLE_PX=10`
18. ✅ **data-role вместо rx** — backing/shape/shape-body/shape-top/bar, `_updateNodePosition` по ролям
19. ✅ **Force layout锚点** — `_forceLayout`: movable фильтр, только новые узлы двигаются

### Чеклист — LLM TODO

20. ✅ **Промпт thesaurus_checklist** — `BUILTIN_PROMPTS`, `PROMPT_META`, `PROMPT_GROUPS`
21. ✅ **Пункт меню "+ чеклист"** — в `_thesaurusModeLabels` и `modes` array, 6-й режим
22. ✅ **_thesaurusChecklistAtBlock** — LLM запрос, парсинг тире/нумерации, поиск/создание todo-блока
23. ✅ **_showChecklistSubtabPicker** — popup выбора подвкладки когда все 5 заняты
24. ✅ **Глобальный режим** — `localStorage('thesaurus_mode')`, обновление title всех кнопок при смене
25. ✅ **Селектор textarea** — `data-id` + `textarea.block-textarea` (как в `_thesaurusAtBlock`)
26. ✅ **Навигация на подвкладку** — double `requestAnimationFrame` после `State.update()`

### Todo-блоки — подвкладки

27. ✅ **_renderItems: elPool** — Map с DOM-элементами, переиспользование без `innerHTML = ''`
28. ✅ **patchSubtab для todo** — `b._renderItems()` вместо `body.innerHTML = ''`
29. ✅ **Активная подвкладка动态** — `renderItems` читает `b.subtabs[b.activeSubtab]` при каждом вызове
30. ✅ **Скролл при галочке** — `State.updateLive()` вместо `State.update()`, без полного re-render
31. ✅ **Скролл при "Отметка выполнения"** — `State.updateLive()` вместо `State.update()`
32. ✅ **Subtab count** — `b.subtabs?.length` вместо `State.SUBTABS_COUNT` в clampOffset/buildTabs/patchSubtab

### Preview — обновление при смене подвкладок

33. ✅ **Preview.render()** — вызывается при переключении подвкладок (text + todo), обновляет "симв · стр · KB"

### Mindmap — Timeline текст

34. ✅ **Весь текст в карточке** — `_wrapTextLines` с `maxLines=10` вместо 2
35. ✅ **Динамическая высота** — `Math.max(minCardH, contentH)`, pre-calculate max height

### AI-трансформация

36. ✅ **Закрытие по ЛКМ вне** — `_onClickOutside` handler, `document.addEventListener('click', ..., true)`

### Якоря — маркеры

37. ✅ **Маркер скрывается за пределами** — `if (rawTop + lineHeight < 0 || rawTop > wrapH) return;`
38. ✅ **Маркер обновляется при смене подвкладки** — `Anchors._renderMarkersAll()` в patchSubtab и todo-обработчиках

### Git коммиты (эта сессия)

```
a7206f9 fix: bat файлы — убрана кириллица из комментариев
9259421 fix: stop-server — taskkill по PID через порт 8080
5f2a4e3 fix: start-server-debug — сообщение при старте
3d45d17 fix: start-server — VBS скрывает окно BAT
18d6724 fix: start-server — pythonw.exe (не работает с -m http.server)
1b9cb3d удалён start-server.vbs (затем восстановлен)
07ce439 fix: anchors — маркер скрывается за пределами wrap, _renderMarkersAll
c33bd7a fix: AI-трансформация — закрытие тултипа по ЛКМ
420cd35 fix: mindmap timeline — весь текст в карточке без обрезки
101acee fix: Preview.render() при переключении подвкладок
6ae83ee fix: todo subtab — тройное восстановление scrollTop
ff482f3 fix: todo renderItems — elPool переиспользует DOM-элементы
281a690 fix: todo subtab — сохранение scrollTop колонки
55c1b31 fix: todo subtab switch — обход patchSubtab
4cdd707 fix: patchSubtab для todo — перерендер body
011fbbb fix: убран дубликат const maxSubtabs
e9883f4 fix: чеклист — updateLive вместо update, фикс подвкладок
445e8d7 fix: чеклист — глобальный режим, навигация на подвкладку, фикс скролла
e8704b8 feat: '+ чеклист' в Тезаурус
ea13e42 flowchart round 7
44e707f flowchart round 8
6a49128 fix: чеклист — правильный селектор textarea
9afef71 fix: start-server.bat
```

### Ключевые файлы

- `flowchart.js` (~1050 строк) — Flowchart: getScreenCTM координаты, data-role, zoom кнопки, dynamic spacing, elPool-like
- `flowchart.css` (~210 строк) — zoom-bar, checklist picker, glass
- `mindmap.js` (~940 строк) — MindMap: timeline динамическая высота, весь текст
- `llm-features.js` (~4500 строк) — _thesaurusChecklistAtBlock, _showChecklistSubtabPicker
- `llm-core.js` (~1900 строк) — thesaurus_checklist промпт
- `blocks.js` (~3270 строк) — todo elPool, patchSubtab для todo, Preview.render, Anchors._renderMarkersAll
- `ai-transform.js` (~370 строк) — _onClickOutside handler
- `anchors.js` (~570 строк) — rawTop visibility check
- `start-server.vbs` — скрытый запуск через WScript.Shell
- `start-server-debug.bat` — прямой запуск в консоли
- `stop-server.bat` — taskkill по имени + PID

## Architecture Decisions

- **Flowchart getScreenCTM** — `pt.matrixTransform(_svg.getScreenCTM().inverse())` вместо ручного `VCW/rect.width` из-за preserveAspectRatio леттербоксинга
- **Flowchart data-role** — `data-role="backing|shape|shape-body|shape-top|bar"` вместо `rx`-гадания в `_updateNodePosition`
- **Flowchart zoom buttons** — `-`/`100%`/`+` вместо range-слайдера, кнопка-центр = fitToContent
- **Todo elPool** — Map<id, element> для переиспользования DOM без `innerHTML = ''`
- **Todo subtab switch** — обход `patchSubtab`, прямое обновление items/active/checkbox
- **Todo scroll fix** — `State.updateLive()` вместо `State.update()` для checkbox и completion
- **Checklist global mode** — `localStorage('thesaurus_mode')`, чтение при клике, обновление title всех кнопок
- **Anchors visibility** — `rawTop + lineHeight < 0 || rawTop > wrapH` для скрытия за пределами
- **BAT encoding** — латиница в комментариях для совместимости кодировок Windows
- **Mindmap timeline** — динамическая высота карточек, pre-calculate max, `_wrapTextLines(maxLines=10)`
- **AiTransform close** — `_onClickOutside` через `document.addEventListener('click', ..., true)`
- **Сленг**: пользователь называет dropdown "тултип" — имей в виду

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
