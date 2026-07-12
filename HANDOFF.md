# HANDOFF — Paste/Copy

## Текущий статус

### Аудиты MiniMax-M3 (задания 6-12)

Обработаны аудиты 7 файлов. Применены безопасные фиксы, опасные/ложные пропущены.

| Файл | Аудит | Что починено |
|------|-------|-------------|
| **app.js** | #6 | Хоткеи в полях ввода: `Ctrl+Z/Y/T/W` пропускаются при `inField` (нативный undo работает, вкладки не закрываются случайно) |
| **blocks.js** | #7 | Копирование таблицы: `% 5` → `State.SUBTABS_COUNT` |
| **ui.js** | #8 | `_dragTabId` перенесена в IIFE-scope; `hadFocus` исключает `tab-rename-input` |
| **state.js** | #9 | `fontSize` в `migrate()`: `12` → `13.5` |
| **timer.js** | #11 | `_ensurePaths()` zero-size guard; `_playCompletionSound()` → `ctx.resume()` |
| **intelligence-core.js** | #12 | 5 фиксов (см. ниже) |

### Аудит intelligence-core.js (задание 12) — 5 фиксов

| # | Категория | Что исправлено |
|---|-----------|---------------|
| **#1/#2** | важно | Устаревшая подсказка удаляется из `lastSuggestions`/`lastMenuSuggestions` после `refresh()` |
| **#4** | важно | `hasMeaningfulDiff` — diff выбирается по типу suggestion |
| **#5** | минорно | Ключи дедупа в `prepareSuggestions` включают `prev.id` как fallback |
| **#7** | минорно | `computeFinality` — `Number.isFinite(score)` guard |
| **#8** | важно | `refresh()` — `lastRefreshSnapshotKey` обновляется только при успешном `captureSnapshot` |

### Emoji Picker — полная реализация (задания 4-17)

**Файл:** `emoji-picker.js` (~900 строк)

**Архитектура:** IIFE, zero dependencies, CSS-in-JS. `_EMOJI_UNIQUE` — дедуплицированный массив. 11-уровневый PRIORITY sorting.

**Фичи:** поиск по name/tags/aliases, acronym/fuzzy/cycle match, shortcode, `::` sticky, DOM-diffing, recents (частотно-взвешенные), canvas-мера с кешем, debounce 35ms.

**Команды:** навигация (`:настройки`, `:промпты`, `:бро`, `:автопоэт`, `:разное`) + блоки (`:текстовый`, `:сниппеты`, `:группа`, `:переменная`, `:заметка`, `:чеклист`, `:таблица`). Блоки фокусируют созданный элемент через `_focusBlock()`.

**Фиксы (аудиты 3-17):** `_insert` TypeError, команды убирают триггер, Escape, дедупликация, clone box-sizing, `_triggerStart`, width reset, resize close, `destroy()`, `_position` cache.

### Таймер — CPU-оптимизация (задания 3)

**6 оптимизаций:**
1. `maskImage` conic-gradient → `opacity: 0.55`
2. `getPointAtLength()` 60/сек → кэш 400 точек через временный SVG path (приаттачен в arcSvg)
3. `_applyWarmGlow` inline `drop-shadow` → CSS-класс `.timer-warm`
4. `btn.offsetWidth/Height` кэшированы (убран Forced Reflow)
5. 60fps → throttle ~30fps
6. `setAttribute('d')` только при смене CW/CCW

**Доп. фиксы:** `_perim` удалён (периметр из `_pts.len`), `_lastTs = 0` в `startTick()`, opacity в блок смены направления, удалены неиспользуемые `_btnW`/`_btnH`.

### Структура превью (фикс порядка)

`_buildMenu()` в `ui.js` — блоки сортируются по колонке (left→right), как и в `getText()`.

### Блоки — автоименование

При добавлении текстового блока вместо `prompt()` генерируется `NEW 1`, `NEW 2`, ...

### Хранилище — множественные банки (тикет 20)

- `_getBanks/_saveBanks/_getBankEntries/_saveBankEntries/_ensureActiveBank/_addBank`
- `_isStorageKey(key)` для guard'ов (ключ `__storage__:<bankId>`)
- Миграция legacy `entries[]` → `banks[]`
- Переключатель банков в шапке карточки (бейдж + dropdown + создание)

### Мини-чат — улучшения

- **Ширина сообщений:** `width: 100%` на `.llm-chat-msg.assistant` — текст растягивается при ресайзе
- **Долгий клик "Новый чат":** 600ms → удаление текущей сессии (без confirm). Tooltip с подсказкой
- **Геометрия:** позиция/размер сохраняются в localStorage, восстанавливаются при открытии

### Настройки LLM — пакет правок (тикеты 18-19)

- `[hidden]` override для `#llm-prompt-storage-panel`
- `flex: 0 0 auto` для `.llm-prompt-test`
- `#llm-prompt-editor` ID-селектор (фикс видимости промпта записи)
- Кнопка "+" в `.llm-storage-inline-actions` с разделителем
- Подменю "Вставить из хранилища" в ⋮
- Перестановка "Общее" по значимости
- "Якоря" внутри `.llm-misc-col-middle`
- Палитра быстрого выбора цвета (6 свотчей)
- `getSettingMeta` reorder — безопасные первые, рисковые внизу

## Изменённые файлы (сессия)

| Файл | Изменения |
|------|-----------|
| `styles.css` | Редизайн промптов; toggle-switch, горизонтальные табы, зелёный accent; `[hidden]` для storage panel; flex:0 0 auto для test; divider CSS, подменю-стили, color swatches; банки CSS; `.timer-warm` класс; chat `width:100%` |
| `index.html` | Кнопка + в inline-actions, подменю хранилища в ⋮, color swatches, reorder Общее, Якоря в middle-col, bank switcher UI, tooltip "Новый чат" |
| `llm-core.js` | Банки: `_getBanks/_saveBanks/_addBank/_isStorageKey/_bankIdFromKey`, `_activeBankId`, миграция, bank switcher handlers, `_renderInsertStorageMenu`, color swatches handler |
| `llm-features.js` | `_deleteSession/_clearCurrentSession`, long-press delete, chat geometry persistence (save/restore win position+size) |
| `ui.js` | Structure menu column sort order |
| `state.js` | `addBlock` возвращает ID; автоименование `NEW N` |
| `emoji-picker.js` | `_focusBlock()` — double rAF, broad selector chain (textarea → .table-cell → input), команды блоков фокусируют созданный элемент |
| `timer.js` | CPU-opt: opacity вместо maskImage, кэш точек через temp SVG path, CSS-class warm glow, throttle 30fps, `d`-set only on dir change, `_perim` удалён, `_lastTs` reset |
| `text-linter.js` | getSettingMeta reorder — safe items first, risky grouped at bottom |

## Как работает

- **EmojiPicker**: `:` → palette → filter (11 приоритетов) → DOM-diff → insert/close. `::` = sticky. Команды → `State.addBlock()` → `_focusBlock(id)` (double rAF + broad selector). Recents в localStorage с частотным весом.
- **Storage Banks**: `_getBanks()` → `promptStorage.banks[]` (миграция с `entries[]`). Каждый банк `{id, name, entries[]}`. `_activeBankId` определяет текущий. Переключатель в шапке карточки. `_isStorageKey(key)` для guard'ов.
- **Timer CPU**: 30fps throttle, кэш 400 точек, CSS-class warm glow, opacity вместо maskImage, `d`-set only on dir change.
- **Mini-чат**:消息 `width:100%` + `max-width:88%`, долгий клик "Новый чат" → удаление, геометрия в localStorage.

## Следующий шаг

1. Проверить emoji picker — `:улыбка`, `::улыбка`, команды блоков фокусируют созданный элемент
2. Проверить таймер — CPU нагрузка, warm glow, 30fps
3. Проверить структуру превью — порядок блоков совпадает с текстом
4. Проверить блоки — автоименование `NEW N`, фокус при создании через `:`
5. Проверить хранилище — банки, миграция, подменю в ⋮, кнопка + с разделителем
6. Проверить настройки — Общее reorder, Якоря в middle-col, цветовые свотчи
7. Проверить мини-чат — ширина при ресайзе, долгий клик удаление, геометрия после F5
8. Проверить локальную причёску — getSettingMeta порядок (safe → risky)
