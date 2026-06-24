# HANDOFF

## Objective
Функция "Якорь" (Anchor) — per-block bookmarking с визуальными маркерами, навигацией и palette-меню.

## Status — ГОТОВО
Все основные задачи выполнены. Последний коммит: `e166f1b`.

### Что работает
- **Кнопки** (⚓, ⟳, ✕) в block-tools каждого текстового блока
- **Palette** меню при длинном нажатии на кнопку навигации — показывает все якоря со всех вкладок, крестик ✕ для удаления (двойное нажатие)
- **Hotkeys** Ctrl+Shift+1 (установить), Ctrl+Shift+2 (навигация), Ctrl+Shift+3 (очистить)
- **Cross-tab** — навигация, palette, clear, remove работают со всеми вкладками
- **State** хранится в `tab.anchors`, persistence через `State.updateLive()`
- **Mirror-div** измерение координат — `box-sizing:content-box`, без padding, шириной как content-area textarea
- **Y-координата** — считает высоту текста ДО текущей строки (prevLines через `lastIndexOf('\n')`), корректно при позиции в середине строки
- **Навигация** — scroll через `_measurePos` (учитывает перенос строк), не через подсчёт `\n`
- **Фоновая подсветка** — z-index:3 (gutter), z-index:4 (line), z-index:1 (textarea) — inline-стили синхронизированы
- **Sticky marker** — полоска слева не скрывается при прокрутке, цепляется за край visible area
- **Счётчик якорей** — ⚓ иконка + число в правом нижнем углу блока, обновляется при set/clear/remove

## Active Files
- `anchors.js` (~440 строк) — основной файл фичи
- `blocks.js:1163-1230` — anchor count indicator + refreshAllAnchorCounts()
- `blocks.js:905` — вызов `Anchors.createBlockAnchorButtons(b.id, ta)`
- `styles.css:402-433` — .block-anchor-count стили
- `styles.css:489-502` — .current-line-wrap + textarea z-index
- `styles.css:5341-5356` — anchor-marker-line/gutter z-index
- `app.js:65-78` — fullRender() с `Anchors._renderMarkersAll()` в rAF

## Architecture Decisions
- Маркеры — DOM div-ы внутри `.current-line-wrap` (position:relative)
- Mirror div: `box-sizing:content-box`, `border:none`, `padding:0`, `word-break:break-all`, width = `clientWidth - paddingLeft - paddingRight`
- Y-координата = `paddingTop + mirror.scrollHeight` текста до последнего `\n`
- Скролл навигации — `_measurePos(ta, s)` вместо подсчёта строк
- `State.onLive` + `State.onChange` — оба слушателя для `_renderMarkersAll`
- Palette: DOM-элементы (не innerHTML), двойной клик на ✕ для удаления
- Индикатор якорей хранится на `body._anchorCountEl` (block-body div)

## Known Limitations
- Mirror div не учитывает `text-decoration`, `text-transform` — координаты могут немного отличаться при нестандартных шрифтах
- Palette не группирует якоря по вкладкам (плоский список с preview)

## Verification
1. Открыть `index.html` в браузере
2. Ввести 20+ строк текста, выделить на 15+ строке, нажать ⚓
3. Проверить: полоса и подсветка совпадают с выделением
4. Нажать ⚓ на другом блоке — счётчик обновляется, фон виден сразу
5. Прокрутить — полоска цепляется за край
6. Переключиться на другой блок — подсветка остаётся видимой
7. Palette (длинное нажатие) — показывает все якоря, ✕ удаляет по двойному клику
8. Навигация Ctrl+Shift+2 — переключает вкладку если якорь на другой

## Next Steps (возможные улучшения)
1. Именование якорей — при установке вводить имя, показывать в palette
2. Цветовые метки — 3 цвета как в userscript-образце
3. Экспорт/импорт якорей в JSON
4. Стрелки ↑↓ в palette для навигации, Enter — перейти, Delete — удалить
5. Автоскролл к ближайшему якорю при переключении вкладки

## Commits (Anchor feature)
```
e166f1b Cleanup: remove old backups, _ai_context, unused packages
b441b69 Fix anchor background: inline z-index in JS overrode CSS values
8fe3604 Raise marker line z-index to 4, above gutter at 3
4c21483 Fix anchor background highlight hidden behind textarea z-index
72bc29e Fix anchor count update + background highlight immediate rendering
d82e70c Add anchor count indicator per text block + increase counter font size
365946d Anchor marker line stays visible when scrolling: clamped to top/bottom edge
296a8f1 Anchor palette: replace tab name with double-click delete button
f554607 Anchors work across all tabs: navigation, palette, clear, remove
d3976ed Fix anchor navigation scroll: use _measurePos for wrap-aware Y
dffa77c Fix anchor Y position: measure only lines before current line
782b70d Fix anchor marker positioning: mirror div width and padding corrections
```
