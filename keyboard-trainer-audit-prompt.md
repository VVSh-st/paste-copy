# Промпт-задание: Аудит keyboard-trainer.js + keyboard-trainer.css

## Контекст

Два файла — `keyboard-trainer.js` (541 строк) и `keyboard-trainer.css` (195 строк) — модуль `KeyboardTrainer` для проекта Paste/Copy. Это визуальная плавающая клавиатура для тренировки слепой печати. IIFE, всё приватное, публичный API через `window.KeyboardTrainer` (`toggle`, `setupButton`, `isEnabled`). Зависимости: `Storage._set/_get` (из storage.js). Кнопка создаётся в `blocks.js` и вызывает `setupButton()`.

## Что делает модуль

- **Панель клавиатуры**: singleton-оверлей, `position:fixed`, отрисовка клавиш по физическим кодам (`KeyboardEvent.code`) с таблицами RU/EN.
- **Drag/Resize**: перетаскивание за title bar, ресайз за handle в правом нижнем углу. Механика скопирована из MiniChat (`llm-features.js`).
- **Вспышка клавиш**: при `keydown` — добавление класса `kb-flash` на 250ms.
- **Авто RU/EN**: сверка `event.key` с таблицами по `event.code`. Fallback: `navigator.keyboard.getLayoutMap()` (Chromium), `Storage` для хранения последней раскладки.
- **Auto-show/auto-hide**: `keydown` → показ на полной непрозрачности; `mousemove` через `_autoHideDelay` → fade в фон (opacity 0.15, `pointer-events: none`).
- **Long press → настройки**: Pointer Events, ~450ms, отмена при сдвиге >10px, флаг `_longPressFired`. Настройки: toggle домашнего ряда, opacity slider, RU/EN override, delay slider.
- **Persistence**: `Storage._set/_get('kb-trainer-state')` — enabled, showHomeRow, opacity, autoHideDelay, layout.

## Зоны аудита

### 1. Безопасность (приоритет)

- **innerHTML в `_buildPanel()` (line 165-175)**: шаблонная строка с `_currentLayout`. `_currentLayout` приходит из `Storage._get()` → `JSON.parse()`. Если storage повреждён — `JSON.parse` в `_load()` бросит, ловится catch. Но `_currentLayout` передаётся в innerHTML через конкатенацию (`'...' + (_currentLayout === 'ru' ? 'RU' : 'EN') + '...'`). Достаточно ли проверки `_currentLayout === 'ru'` для предотвращения XSS? (Да, но проверь что `_currentLayout` не может быть注入ирован через `Storage._set` — например, если другой модуль запишет туда произвольную строку.)
- **innerHTML в `_openSettings()` (line 395-420)**: `_showHomeRow` (boolean), `_opacity` (number), `_currentLayout` (string, limited to 'ru'|'en' check в `_load()`), `_autoHideDelay` (number). Все значения типизированы и валидируются в `_load()`. Но `_autoHideDelay` подставляется в `value="..."` атрибут — если `_load()` вернёт строку вместо числа, `parseInt` на line 458 вернёт NaN. Проверь path: `_load()` → `_autoHideDelay = typeof s.autoHideDelay === 'number' ? s.autoHideDelay : 1500` — безопасно, fallback на 1500.
- **CSS injection через `el.textContent`**: `_renderKeys()` использует `textContent`, не innerHTML — безопасно.

### 2. Event listeners и cleanup

- **Утечка document-level listeners**: `document.addEventListener('keydown', _onKeyDown, true)` и `document.addEventListener('mousemove', ...)` добавляются в `toggle()` при включении и удаляются при выключении. Но `_initDragResize()` (line 382-385) добавляет `mousemove`, `mouseup`, `touchmove`, `touchend` на `document` — **никогда не удаляются**. Если панель пересоздаётся (хотя `_buildPanel` проверяет `_panel`), listeners не дублируются thanks to `_dragBound`. Но при `toggle()` off/on — `_initDragResize` не вызывается заново (панель уже есть), а `keydown`/`mousemove` handlers пересоздаются. Проверь: при toggle off → toggle on, document listeners для drag остаются (не удалялись), а keydown/mousemove добавляются заново. Корректно.
- **Settings popup listeners**: `document.addEventListener('mousedown', _onSettingsOutsideClick, true)` добавляется через `setTimeout(0)` в `_openSettings()` и удаляется в `_closeSettings()`. Но если `_openSettings()` вызывается повторно (long press на другой кнопке пока popup открыт) — `_closeSettings()` сначала чистит, потом `_openSettings()` создаёт заново. Корректно.
- **Long press listeners на btn**: `pointerdown/move/up/cancel/leave` добавляются в `_setupLongPress()`. Нет cleanup — но кнопки пересоздаются при каждом `State.update()` (blocks.js footer пересоздаётся), старый DOM уничтожается → listeners GC.

### 3. Состояние и гонки

- **`_longPressFired` флаг**: установлен в `true` в long press timer, сброс в `false` в `onStart` и в click handler. Но: click handler проверяет `if (_longPressFired)` и делает `return` без сброса. Значит `_longPressFired` остаётся `true` до следующего `pointerdown`. Если между long press и следующим кликом прошло >450ms, таймер сработал, флаг=true, click handler пропустил. При следующем клике — `onStart` сбросит флаг. Корректно.
- **`_isForeground` vs CSS `kb-active`/`kb-background`**: состояние синхронизировано в `_show()` и `_goBackground()`. Но `_hide()` снимает оба класса — если панель была в background и пользователь toggle off, `_hide()` корректно чистит.
- **`_panel` singleton**: `_buildPanel()` проверяет `if (_panel) return _panel`. Но при toggle off → on, `_buildPanel()` вернёт существующую панель. `_show()` установит `display:flex`. Корректно.
- **Race: `_tryDetectInitialLayout()` async**: вызывается после `_show()`. Если пользователь нажмёт клавишу до завершения async — `_onKeyDown` вызовет `_detectLayout()` который обновит `_currentLayout`. Затем async завершится и перезапишет `_currentLayout`. Возможен brief flicker RU→EN→RU. Минорно.

### 4. Корректность логики

- **Layout detection (`_detectLayout`)**: Сравнивает `e.key.toLowerCase()` с `LAYOUT_RU[e.code]` и `LAYOUT_EN[e.code]`. Проблема: для символьных клавиш (Digit1-0, Minus, Equal, Backquote, Bracket, Semicolon, Quote, Comma, Period, Slash) — `e.key` возвращает символ напрямую, а `LAYOUT_RU` для этих клавиш содержит ту же строку что и `LAYOUT_EN` (цифры/знаки одинаковы в обеих раскладках). Значит `_detectLayout` **не сможет определить раскладку** по цифровому ряду — `actual === ruChar` и `actual === enChar` оба true. `if/else if` — RU сработает первым, раскладка зафиксируется как RU. Это **баг**: при нажатии цифры на EN-раскладке detection вернёт RU.
- **`_detectLayout` пропускает modifer-only keys**: `['Shift','Control','Alt','Meta'].includes(e.key)` — корректно.
- **`_tryDetectInitialLayout`**: `if (_currentLayout) return` — `_currentLayout` инициализирован `'ru'` (line 78). Значит **async fallback никогда не сработает** — `_currentLayout` уже не falsy. Это **баг**: `_tryDetectInitialLayout` мёртвый код.
- **Home row codes**: `['KeyA','KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL','Semicolon']` — соответствует ФЫВА/ОЛДЖ. Корректно для RU. Для EN это A S D F J K L ; — тоже домашний ряд. Физические коды не зависят от раскладки. Корректно.
- **`_flashKey`**: добавляет класс, через 250ms убирает. Если нажать клавишу дважды быстро — первый таймер уберёт класс, второй добавит. Корректно (class toggle через add/remove).
- **Resize min dimensions**: `Math.max(420, ...)` и `Math.max(120, ...)` — панель не может стать меньше 420×120. Но `min-width: 420px` в CSS тоже задан. Дублирование, но не конфликт.
- **`_onSettingsOutsideClick`**: клик по `.kb-trainer-btn` не закрывает popup. Но если кликнуть по самой панели клавиатуры (не по кнопке) — popup закроется. Это корректно? Пользователь может кликнуть по панели чтобы закрыть настройки — ок.

### 5. Производительность

- **`_renderKeys()`**: создаёт ~50 DOM-элементов (klawiatury). Вызывается один раз при `_buildPanel()`. Корректно.
- **`_onKeyDown` на document (capture phase)**: вызывается на каждый keydown в документе, включая ввод в textarea/input. Фильтр `if (!_enabled) return` — дёшево. Но `_detectLayout` делает `LAYOUT_RU[e.code]` lookup + сравнение — O(1). Корректно.
- **`_onMouseMove` на document (passive)**: вызывается при каждом движении мыши. Проверка `if (!_enabled || !_isForeground) return` — дёшево. Но нет throttle. При активном движении мыши — десятки вызовов в секунду, каждый делает `clearTimeout + setTimeout`. Это **дорого**: каждый `mousemove` пересоздаёт таймер. При 60fps × 1000ms / 16ms = ~60 вызовов/сек, каждый с `clearTimeout + setTimeout`. Хуже чем throttle.
- **`_save()` в `_detectLayout()`**: `JSON.stringify + Storage._set` на каждый keydown. Если печатать быстро — десятки save/сек. Это **дорого**: `localStorage.setItem` на каждый keydown. Нужен debounce.

### 6. CSS

- **`!important` на `.kb-flash`** (line 104-105): перебивает inline styles? Панель не использует inline background/border для клавиш. `!important` избыточен, но не опасен.
- **`z-index: 9200`** для панели, `9300` для settings popup. Совместимо с z-index其他 модулей? MiniChat использует `var(--z-notepad)`. Нужно проверить значение `--z-notepad` в styles.css.
- **`transition: opacity 0.3s ease`** на `.kb-trainer-panel`: конфликтует с JS-управлением opacity? JS устанавливает `style.opacity` напрямую + CSS transition плавно анимирует. Корректно.
- **`.kb-key.kb-flash` `!important`**: если в будущем добавится inline style на клавишу — `!important` перебьёт. Потенциальная проблема при расширении.
- **`.kb-key` с `min-width: 28px`**: при ресайзе панели — клавиши не переносятся (flex с `flex-shrink: 0`). При сужении панели — клавиши обрезаются (`overflow: hidden` на `.kb-trainer-body`). Визуально — клавиатура обрезается справа. Это ожидаемо? Или должны пропорционально масштабироваться? Тикет требует "пропорционально масштабировать все клавиши" — текущая реализация этого **не делает**. Это **важный баг**.

### 7. Edge cases

- **Storage quota**: `_save()` в `_detectLayout()` на каждый keydown. localStorage quota ~5MB. Один save — ~100 bytes. Даже при 1000 нажатий/мин × 60 мин = 60KB. Не проблема.
- **Multiple blocks**: кнопки создаются для каждого блока. `_updateAllButtons()` обновляет все `.kb-trainer-btn`. `_setupLongPress` добавляет listeners на каждую кнопку. При long press на одной кнопке → `_openSettings()` → при long press на другой кнопке → `_closeSettings()` + `_openSettings()`. Корректно.
- **Panel off-screen**: drag позволяет тащить панель за пределы viewport. Нет clamp. Пользователь может "потерять" панель. Минорно.
- **No cleanup on module unload**: IIFE не имеет `destroy()`. Если скрипт перезагрузится (hot reload) — старые document listeners останутся. Проблема только при разработке.
- **`_onKeyDown` в capture phase (`true`)**: перехватывает keydown до textarea/input. Если пользователь печатает в textarea — `_flashKey` покажет вспышку на панели (ожидаемо для фичи). Но `_detectLayout` изменит раскладку — тоже ожидаемо. Конфликта с TextExpander/ other keydown handlers нет — они в bubble phase.

## Формат ответа

Для каждого найденного вопроса/проблемы укажи:
- Номер строки (approx)
- Категория: критично / важно / минорно / вопрос
- Описание проблемы
- Предложение по исправлению (если применимо)

Не предлагай исправления для мелочей — просто пометь как "вопрос". Сфокусируйся на критичных и важных проблемах.

## Ограничения

- Файлы: `E:\CODE\Paste_copy\keyboard-trainer.js`, `E:\CODE\Paste_copy\keyboard-trainer.css`
- Модуль: IIFE, всё приватное, публичный API через `window.KeyboardTrainer`
- Зависимости: `Storage._set/_get` (из storage.js)
- Кнопка создаётся в `blocks.js` и вызывает `setupButton(btn)`
- Тикет: `E:\CODE\Paste_copy\TICKET-keyboard-trainer.md`
