# HANDOFF — Paste/Copy

## Текущий статус

### Завершено в этой сессии
1. **Сниппеты refactor**
   - Убран блок `snippets` из дефолтного layout
   - `commands` переименован в "Сниппеты" (title, меню, help)
   - Глобальные сниппеты (облачные ☁) в блоке "Сниппеты" с edit/delete/on/off
   - Миграция: `snippets` → `commands` при загрузке, фильтрация старых дефолтных значений
   - Дедупликация: несколько `commands` блоков объединяются в один
   - `defaultSnippets()` и `defaultCommands()` возвращают `[]` — без дефолтов
   - Поле названия сниппета увеличено до 160px (~25 символов)
   - Badge "Команд" скрыт для блока "Сниппеты"

2. **Prompt Loom — TDZ исправления**
   - `VALID_SOURCES`, `VALID_KINDS` перенесены до `loadState()`
   - `META_WHITELIST`, `sanitizeMeta` перенесены до `loadState()`
   - `_loadFailed` флаг:防止 `saveState()` перезаписывает данные при ошибке загрузки
   - Cache-busting: `prompt-loom.js?v=3` в `index.html`
   - История Loom корректно переживает F5

3. **On/off тогл для глобальных сниппетов**
   - `addGlobalSnippet`: `enabled: true` по умолчанию
   - `toggleGlobalSnippet(id)`: переключает + `emit()`
   - `getAllSnippetsAndCommands`: проверяет `enabled === false`
   - Кнопка "глаз" обновляется при переключении

4. **Другие правки**
   - `gist-sync.js`: `calcTotalChars` учитывает `commands` + `globalSnippets`
   - `llm-features.js`, `word-complete.js`: `snippets` → `commands`
   - `ui.js`: `makeCmds` создаёт пустой блок, `_typeIcons` без snippets

5. **Подсветка текущей строки — исправлено**
   - Проблема: highlight отстаёт от курсора из-за подсчёта `\n` вместо визуальных строк
   - Решение: div-зеркало + span-маркёр + `getBoundingClientRect()`
   - `getLineMirror(cs)`: div с `pre-wrap`/`word-wrap`, идентичные стили textarea
   - Позиция: `marker.getBoundingClientRect()` относительно `mirror.getBoundingClientRect()`
   - Двойной `requestAnimationFrame` — ждём два кадра для layout settling
   - Удалён мёртвый код: `_hlLineH`, `_hlMirror`, `_ensureHlMirror`, `_measureLineHeight`, `_getCaretTop`

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `state.js` | defaultBlocks, commands title, миграция, дедупликация, clearGlobalSnippets, toggleGlobalSnippet, load: item.enabled !== false |
| `blocks.js` | renderCommandsBody с облачными сниппетами, eye/eyeOff SVG, badge скрыт для commands; **line highlight — div-зеркало + getBoundingClientRect** |
| `ui.js` | makeCmds пустой, _typeIcons без snippets |
| `prompt-loom.js` | TDZ: VALID_SOURCES, META_WHITELIST, _loadFailed до loadState() |
| `index.html` | snippets удалена, commands="Сниппеты", prompt-loom.js?v=3 |
| `styles.css` | global-snippet-section, btn-icon-active, item-title-input 160px |
| `help.js` | Описание блока "Сниппеты" |
| `gist-sync.js` | calcTotalChars: commands + globalSnippets |
| `llm-features.js` | snippets → commands |
| `word-complete.js` | snippets → commands |

### Бэкапы
- `Backup/backup-2026-07-07_22-00/` — полный бэкап после всех правок

## Как работает
- Блок "Сниппеты" (type: `commands`) — локальные команды + облачные сниппеты сверху
- Облачные сниппеты: создаются Loom/Intelligence, хранятся в `globalSnippets`
- On/off: выключенные не попадают в `/` меню
- Миграция: при загрузке `snippets` → `commands` с конвертацией `title` → `label`
- Prompt Loom: история в `localStorage('promptLoom.v1')`, загружается в IIFE
- Line highlight: div-зеркало с теми же стилями, span-маркёр, getBoundingClientRect для точной позиции

## Проверка
1. Новый layout: блок "Сниппеты" без дефолтных items ✓
2. Облачные сниппеты: edit/delete/on-off → `/` меню ✓
3. Миграция: старый snippets → commands ✓
4. Prompt Loom: F5 сохраняет историю ✓
5. Cache-busting: `?v=3` предотвращает кэширование старой версии ✓
6. Line highlight: длинная строка с переносом, ~170+ строк, кириллица ✓

## TDZ-чеклист для IIFE с ранним loadState()

Файлы вида `prompt-loom.js`, где `state = loadState()` вызывается в первых строках IIFE, уязвимы к Temporal Dead Zone. Любая top-level `const`/`let`, объявленная ниже `loadState()` но используемая в цепочке `loadState → normalizeItem → sanitizeMeta → ...`, вызовет `ReferenceError`, который try/catch проглотит → `state.items = []` → `saveState()` перезапишет localStorage пустыми данными.

**Правила:**
1. Все `const`/`function`, нужные `loadState`/`normalizeItem`/`sanitizeMeta`, объявлять **выше** `let state = loadState()`
2. Константы, используемые ТОЛЬКО внутри одной функции — делать **локальными** внутри неё (надёжнее)
3. Добавлять `_loadFailed` флаг: если `loadState` упал, `saveState()` не должен перезаписывать данные
4. При аудите这类 IIFE — первым делом проверять порядок объявления относительно `loadState()`

**История бага:** три TDZ за одну сессию (`VALID_SOURCES`, `META_WHITELIST`, `_loadFailed`) — все приводили к тихой потере данных Loom после F5.
