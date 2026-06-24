# HANDOFF

## Objective
Реализовать функцию "Якорь" (Anchor) — per-block bookmarking с 3 кнопками, визуальными маркерами и навигацией.

## Status
- Кнопки (⚓, ⟳, ✕) работают, расположены в block-tools каждого текстового блока
- Palette меню при длинном нажатии на кнопку навигации работает
- Hotkeys Ctrl+Shift+1/2/3 работают
- State хранится в tab.anchors, persistence через State.updateLive()
- Мерцание блоков при установке якоря исправлено (State.updateLive вместо State.emit)
- **ОСТАЛСЯ БАГ**: позиция маркера (зелёная полоса + подсветка) не совпадает с реальным положением выделения в textarea. Ошибка накапливается на длинных текстах (>10 строк).

## Active Files
- `E:\CODE\Paste_copy\anchors.js` — основной файл фичи (381 строка)
- `E:\CODE\Paste_copy\blocks.js:905` — вызов `Anchors.createBlockAnchorButtons(b.id, ta)` в renderTextBody
- `E:\CODE\Paste_copy\styles.css:451,459` — textarea стили (background-color вместо background shorthand!)
- `E:\CODE\Paste_copy\app.js:737` — `Anchors.init()`

## Decisions
- Кнопки в block-tools (undo/redo row), НЕ в toolbar — `block-tool-btn` класс
- Маркеры — DOM div-ы внутри `.current-line-wrap` (position:relative), НЕ CSS background-image (не работало)
- Скролл — event delegation `document.addEventListener('scroll', ..., true)` на textarea
- State — `State.updateLive()` вместо `State.emit()` чтобы не пересобирать DOM блоков
- Mirror-div для измерения координат: скрытый div с теми же CSS-параметрами что textarea, textContent = text.substring(0, charPos), scrollHeight = Y-координата
- Canvas `measureText()` для X-координаты

## Tried (and failed)
1. CSS background-image с `background-attachment: local` — не работало, `background` shorthand затирал фокус-стили
2. `getComputedStyle(ta).lineHeight` — даёт CSS-значение, не реальное отрисованное
3. `(scrollHeight - padTop - padBottom) / totalLines` — завышено из-за min-height textarea
4. `fontSize * 0.602` для ширины символа — неточно

## Current Bug (ПРИОРИТЕТ)
`_measurePos(ta, charPos)` в anchors.js:195 — mirror-div измеряет Y через `mirror.scrollHeight`, но позиция маркера всё равно уезжает. Подозрения:
- Mirror div не учитывает `box-sizing: border-box` textarea
- textarea имеет `border: 1px solid` — `clientWidth` не включает border, а `paddingLeft` включает
- mirror div positioned at `top:0; left:0` на document.body — может быть проблема с width

Ключевой файл для поиска бага: `anchors.js:177-207` (_getMirror, _measurePos).

## Verification
1. Открыть `E:\CODE\Paste_copy\index.html` в браузере
2. Ввести 20+ строк текста в текстовый блок
3. Выделить текст на 15+ строке, нажать ⚓
4. Проверить: зелёная полоса и подсветка должны точно совпадать с выделенным текстом
5. Прокрутить — маркеры должны следовать за текстом

## Next Step
Исправить `_measurePos` — замер координат через mirror div не совпадает с реальным позиционированием textarea. Нужно проверить width/box-sizing mirror div, возможно использовать другой подход (например, `document.caretPositionFromPoint` или прямой замер через textarea API).
