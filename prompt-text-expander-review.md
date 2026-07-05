# Prompt: text-expander.js — GPT audit round 1

Ты — старший фронтенд-разработчик и аудитор безопасности. Проведи детальный аудит файла `text-expander.js` (~1130 строк) из веб-приложения Paste/Copy для работы с текстовыми промптами.

## Контекст проекта

- **Архитектура**: vanilla JS, IIFE object-modular, без фреймворков
- **Модуль**: `TextExpander` — текстовый эспандер с триггером, dropdown-меню, панелью управления
- **Интеграция**: подключается к `blocks.js` (кнопка в footer текстового блока), `state.js` (undo/snapshot), `gist-sync.js` (синхронизация через Gist)
- **Хранение**: localStorage с ключом `text-expander-v1`, merge в `State.serialize()`/`State.load()`
- **Триггер**: `KeyboardEvent.code === Backquote` (работает RU/EN ё/`)
- **Dropdown**: positioned at caret, startsWith→includes фильтрация, навигация ↑↓EnterEscape
- **Панель**: draggable, resizable, 400x600, сохраняет позицию/размер
- **Long press FSM**: pointerdown/pointermove/pointerup/pointercancel, 450ms threshold
- **Динамические токены**: {{date}}, {{time}}, {{clipboard}}, {{url}}, {{email}}
- **Auto shortener**: generateSmartShortName с 4 уровнями (слово → акроним → склейка → коллизии)
- **Категории**: General, AI Prompts, Scripts, Outreach
- **Gist sync**: State.serialize() включает `textExpander`, State.load() восстанавливает через `TextExpander.load()`

## Место в кодовой базе

- `text-expander.js` — основной модуль ( создание, хранение, UI, вставка)
- `blocks.js` — кнопка в footer (`teBtn`), вызов `TextExpander.handleInput()` в input handler
- `state.js` — `serialize()` включает `textExpander`, `load()` вызывает `TextExpander.load()`
- `app.js` — `TextExpander.init()` вызывается при старте
- `index.html` — `<script src="text-expander.js">` перед mindmap.js
- `styles.css` — CSS для `.text-expander-*`, `.te-*` классов

## Что искать

### Приоритет 1: Критичные баги
- Race conditions: dropdown может зависнуть при быстром вводе/переключении вкладок
- Memory leaks: event listeners на document/window без cleanup, duplicate listeners при повторном init
- State corruption: невалидные shortcuts в localStorage ломают UI
- Undo: blockSnapshot/snapshot порядок может нарушаться
- Clipboard: navigator.clipboard.readText() может вызвать unhandled rejection
- Long press: pointerleave может сбросить состояние раньше pointerup
- Dropdown: не закрывается при blur/whitespace/перемещении курсора

### Приоритет 2: Производительность
- _filterDropdownItems: создаёт новый массив при каждом рендере
- _positionDropdownAtCaret: создаёт DOM-элемент для измерения позиции
- _refreshPanelTable: innerHTML очищает и пересоздаёт весь контент
- expandDynamicTokens: цепочка replace() на каждой вставке

### Приоритет 3: UX
- Dropdown: нет группировки по категориям, нет сортировки по usage
- Panel: нет редактирования существующих shortcuts, нет управления категориями
- Trigger: не работает в contenteditable (только textarea)
- Insertion: всегда добавляет пробел после expansion
- Case handling: простая логика для кириллицы/латиницы

### Приоритет 4: Читаемость кода
- _buildPanel: длинная функция (~200 строк) с вложенными замыканиями
- _renderDropdownItems: смешивает рендеринг и навигацию
- serialize/load: дублирование логики нормализации
- Глобальные переменные: _activeTa, _activeBlockId, _dropdownQuery и т.д.

## ОГРАНИЧЕНИЯ (важно!)

- **Не предлагай добавлять тесты**
- **Не предлагай менять публичный API** (`window.TextExpander`)
- **Не предлагай добавлять зависимости** (оставить vanilla JS)
- **Не предлагай TypeScript/migration/переписывание на классы**
- **Не предлагай менять архитектуру** (оставить IIFE object-modular)
- **Не предлагай новые фичи** (управление категориями, appendSpace, usageCount и т.д.)
- **Каждое улучшение должно быть САМОСТОЯТЕЛЬНЫМ** — не требовать других изменений из этого списка
- **Если предложение требует изменения `state.js` / `blocks.js`** — укажи это явно, но лучше избегай
- **Не предлагай косметические правки** — только проблемы, влияющие на stability, performance или memory

## Формат вывода

Для каждого улучшения:

```
### [N] [Критично/Перф/UX/Чит] Краткое описание

**Проблема:** Что не так (1-2 предложения)
**Строки:** диапазон или конкретная строка
**Влияние:** На что влияет (1-2 предложения)
**Патч:**
```diff
- старый код
+ новый код
```
```

После списка — краткую итоговую сводку:
- Сколько критических
- Сколько UX
- Сколько перф
- Сколько читаемость
- Общая оценка качества кода (1-10)
- Топ-3 приоритетных исправления

## Файл для ревью

Вставь содержимое `text-expander.js` сюда:
