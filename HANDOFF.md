# HANDOFF — Paste/Copy

## Текущий статус

### В работе
**Аудит ninja-cursor.js**
- Промпт: `аудит ninja-cursor.txt`
- Файл: `ninja-cursor.js` (~500 строк, IIFE NinjaCursor)
- Назначение: декоративный анимированный курсор-шлейф для textarea
- Ожидание: ответ аудитора

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

4. **Подсветка текущей строки — исправлено**
   - Проблема: highlight отстаёт от курсора из-за подсчёта `\n` вместо визуальных строк
   - 4 итерации аудита: div→textarea→getBoundingClientRect→scrollHeight→откат к div
   - Итог: div-зеркало + span-маркёр + `getBoundingClientRect()` + двойной rAF
   - `getLineMirror(cs)`: div с `pre-wrap`/`word-wrap`, идентичные стили textarea

5. **Хоткеи — проверка на раскладонезависимость**
   - Глобальные (Ctrl+Z/Y/S/T/W/C/D/K): уже на `e.code` ✓
   - Палитры (1-9): на `e.key` — осознанно (продолжение ввода символа)
   - Решение: оставить как есть

6. **Кнопки якоря — новая логика ← ⚓ →**
   - ← клик: предыдущий якорь, долгое: очистить все
   - ⚓ клик: установить якорь, долгое: список якорей
   - → клик: следующий якорь, долгое: очистить все
   - `_makeLongPress()` хелпер для переиспользования

7. **Подсчёт слов — фича (3 раунда аудита)**
   - Новый файл `word-count.js`, IIFE `WordCount`
   - Кнопка в футере блока (после Translate)
   - Статистика: слова (акцент), символы, без пробелов, предложения, абзацы, время чтения
   - Автообновление: input, selectionchange, focusin
   - Перетаскивание, 📌 закрепление, ESC/ПКМ закрытие
   - Аудит round 1: innerHTML→textContent, skeleton, clamp bounds, input filter
   - Аудит round 2: _lastSourceText, _DOC_HANDLERS массив, _ta.isConnected, pin в wordsBlock
   - Аудит round 3: race focusin/click, clearTimeout в close, комментарий B3

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `state.js` | defaultBlocks, commands title, миграция, дедупликация, toggleGlobalSnippet, load: item.enabled !== false |
| `blocks.js` | renderCommandsBody, eye/eyeOff SVG, badge; **line highlight — div-зеркало + getBoundingClientRect**; **кнопка Word Count** |
| `anchors.js` | **Новые кнопки ← ⚓ → с длинным нажатием** |
| `word-count.js` | **Новый файл: Подсчёт слов — floating stats popup** |
| `ui.js` | makeCmds пустой, _typeIcons без snippets |
| `prompt-loom.js` | TDZ: VALID_SOURCES, META_WHITELIST, _loadFailed до loadState() |
| `index.html` | commands="Сниппеты", prompt-loom.js?v=3, word-count.js |
| `styles.css` | global-snippet-section, btn-icon-active, item-title-input 160px, **.wc-popup** |
| `help.js` | Описание блока "Сниппеты" |
| `gist-sync.js` | calcTotalChars: commands + globalSnippets |
| `llm-features.js` | snippets → commands |
| `word-complete.js` | snippets → commands |

## Как работает
- **Сниппеты** (type: `commands`) — локальные команды + облачные сниппеты сверху
- **Облачные сниппеты**: создаются Loom/Intelligence, хранятся в `globalSnippets`
- **On/off**: выключенные не попадают в `/` меню
- **Миграция**: `snippets` → `commands` с конвертацией `title` → `label`
- **Prompt Loom**: история в `localStorage('promptLoom.v1')`, загружается в IIFE
- **Line highlight**: div-зеркало + span-маркёр + `getBoundingClientRect()` + двойной rAF
- **Якоря**: ← ⚓ → с длинным нажатием, перекрестная навигация
- **Подсчёт слов**: skeleton rows + textContent, _lastSourceText diff, _DOC_HANDLERS массив

## Проверка
1. Сниппеты: блок без дефолтных items ✓
2. Облачные сниппеты: edit/delete/on-off → `/` меню ✓
3. Миграция: старый snippets → commands ✓
4. Prompt Loom: F5 сохраняет историю ✓
5. Line highlight: длинная строка, ~170+ строк, кириллица ✓
6. Якоря: ← ⚓ → клик + долгое нажатие ✓
7. Подсчёт слов: stats, drag, pin, ESC, автообновление ✓

## TDZ-чеклист для IIFE с ранним loadState()

Файлы вида `prompt-loom.js`, где `state = loadState()` вызывается в первых строках IIFE, уязвимы к Temporal Dead Zone. Любая top-level `const`/`let`, объявленная ниже `loadState()` но используемая в цепочке `loadState → normalizeItem → sanitizeMeta → ...`, вызовет `ReferenceError`, который try/catch проглотит → `state.items = []` → `saveState()` перезапишет localStorage пустыми данными.

**Правила:**
1. Все `const`/`function`, нужные `loadState`/`normalizeItem`/`sanitizeMeta`, объявлять **выше** `let state = loadState()`
2. Константы, используемые ТОЛЬКО внутри одной функции — делать **локальными** внутри неё (надёжнее)
3. Добавлять `_loadFailed` флаг: если `loadState` упал, `saveState()` не должен перезаписывать данные
4. При аудите这类 IIFE — первым делом проверять порядок объявления относительно `loadState()`

**История бага:** три TDZ за одну сессию (`VALID_SOURCES`, `META_WHITELIST`, `_loadFailed`) — все приводили к тихой потере данных Loom после F5.
