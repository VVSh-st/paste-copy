# HANDOFF — Paste/Copy

## Текущий статус

### Поиск и замена — кнопка поиска на текстовых блоках

- Кнопка «Поиск» (лупа) в тулбаре текстового блока между «Вставить из буфера» и «Вставить сниппет`
- SVG-иконка `search` (лупа) в стиле UI
- Клик: если выделен текст → вставляет в строку поиска (Ctrl+F) и открывает; если нет → просто открывает поиск
- `Search.open(presetQuery)` — принимает необязательный параметр для предзаполнения
- Крестик очистки в поле поиска (`#search-clear`) и в поле «Заменить на...» (`#replace-clear`)
- Обработчик клика на `document` проверяет `.block-search-btn` чтобы не закрывать панель

### Keyboard Trainer — новые фичи (сессия)

**Slim-режим**
- Прозрачная панель (фон/бордер/тень = transparent), клавиши сохраняют собственный фон
- Клавиши: `rgba(30, 32, 40, var(--kb-key-bg-alpha, 0.85))`
- Зоны пальцев: усиленная opacity (0.18-0.25) для видимости на тёмном фоне
- Чекбокс «Slim» в меню настроек

**Прозрачность клавиш — слайдер**
- `--kb-key-bg-alpha` управляет фоном клавиш во всех режимах
- Finger zones: зоны пальцев через `box-shadow` (inset), не перезаписывают `background`
- Focus layer: комбинируется с зонами через `var(--kb-finger-shadow, none)`
- Слайдер «Прозрачн. клавиш» в меню (0-100%)

**Экранный режим (on-screen keyboard)**
- Чекбокс «Экранный режим» в настройках
- Клик по клавише → вставка символа в активный элемент (`_insertChar`)
- Долгий клик (450ms) → вставка `spec.shift || spec.base.toUpperCase()` (заглавные/символы)
- `_lastFocusedEl` — запоминает фокус до клика, восстанавливает после вставки
- `e.preventDefault()` на `pointerdown` панели (исключая resize/drag) — фокус не уходит
- Клик между клавишами не теряет фокус
- Автоскрытие: клик будит панель из фона
- Extra-клавиши (только в on-screen):
  - Backspace — col 27, span 1 (пустая кнопка)
  - Enter — col 25, span 3, подпись «Enter»
  - Зоны пальцев: Backspace = `l-pinky`, Enter = `r-pinky`
- RU/EN handle кликабельный — переключает раскладку
- Mouse-through отключается в on-screen режиме
- Ghost mode работает в on-screen (explicit CSS override)
- Resize handle кликабельный в on-screen + mouse-through

**Меню настроек — спойлер**
- Спойлер «Визуал» (свернут по умолчанию): подсветка дом.ряда, все слайдеры, раскладка
- Авто-скрытие: слайдер + «Оставаться видимой в фоне»
- Чекбоксы: зоны пальцев, символы со Shift, ghost, slim, on-screen, проблемные, фокусный слой, пропуск кликов

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `blocks.js` | Кнопка поиска (лупа) в тулбаре текстового блока |
| `ui.js` | `Search.open(presetQuery)`, крестик поиска/замены, обработчик `.block-search-btn` |
| `index.html` | Кнопки `#search-clear`, `#replace-clear` |
| `styles.css` | Стили `.search-clear-btn` |
| `keyboard-trainer.js` | Slim mode, on-screen mode, extra keys (Backspace/Enter), спойлер меню, key opacity slider, long press → uppercase |
| `keyboard-trainer.css` | Slim, on-screen, finger zones через box-shadow, focus layer combo, ghost override, extra keys, spoiler |

## Как работает
- **KeyboardTrainer**: singleton-панель → toggle кнопкой → keydown → flash + auto RU/EN → drag/resize с viewport clamp + сохранением → настройки через long-press → ghost/slim/on-screen/problem/focus/mouse-through режимы → зоны пальцев → shifted-символы → цвет символов → прозрачность букв/фона клавиш → stay visible → экстранный режим (клик = ввод, long press = uppercase)

### Аудиторские фиксы (Доработка 3)
- `_clampPanelToViewport()`: `getComputedStyle()` вместо inline `display` проверки — clamp не работает на скрытой панели
- `_save()`: bounds всегда через `getBoundingClientRect()`, `boundsVisible` через `getComputedStyle()`
- `_applySavedBounds()`: убран clamp — bounds применяются как есть, clamp только в `_show()`
- `_insertChar/_insertKey`: `_isTextInput()` helper для проверки input type, fallback `selectionStart` на `value.length`
- contentEditable: сохранение/восстановление `Range` через `_lastEditableRange`
- `_updateLayoutLabels()`: пропуск `.kb-key-extra` (Enter label не очищается)
- `PointerEvent.button`: `e.pointerType === 'mouse'` guard для touch/pen совместимости
- `e.target.closest` guard в drag-start
- Auto-hide: `_scheduleAutoHide()` отменяет предыдущий таймер, on-screen toggle чистит таймер
- Settings: `pointerdown` вместо `mousedown` для outside click
- `toggle()`: `_buildPanel()` до `_save()`, `_closeSettings()` при disable, `_cancelMetricsUpdate()`, disconnect ResizeObserver
- `setupButton()`: guard `_kbTrainerBound` от повторных обработчиков
- `_tryDetectInitialLayout()`: `_save()` при изменении раскладки
- `focusin`/`selectionchange` слушатели для отслеживания `_lastFocusedEl`
- `_clearKeyLongPressTimers()` перед `_renderKeys()`
- **WordCount + Блокнот**: `_onFocusIn` в `word-count.js` подхватывает `textarea` из `.notepad-body` — popup подсчёта слов автоматически переключается на текст Блокнота при фокусе
- **Тезаурус/антонимы**: контекст = полное предложение вокруг курсора (до-после `.!?…`), обрезка до 500 символов с центрированием на курсоре
- **Блокнот**: убрано переименование по dblclick, перетаскивание за шапку (cursor: grab)
- **block-counter-badge**: шрифт 8→9px
- **Поиск**: кнопка лупы на текстовом блоке → `Search.open(sel)` → крестик очистки в полях ввода

## Следующий шаг
1. Проверить клавиатуру в браузере (все режимы, настройки, resize, on-screen)
2. Next-key hint (подсказка следующей клавиши)
3. Статистика ошибок по пальцам/клавишам
