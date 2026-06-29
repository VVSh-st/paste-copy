# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.

Есть MCP инструменты, используй при необходимости.

Мне отвечай по-русски.

## Status — В РАБОТЕ

### Prompt Loom Ultra Light режим

**Выполнено:**

1. ✅ **Настройка `panelUltraLight`** — сохраняется в localStorage
2. ✅ **Кнопка Ultra Light** — в шапке панели, переключает режим
3. ✅ **Взаимоисключение** — Ultra Light и Compact не включаются вместе
4. ✅ **Узкая панель 140px** — визуальная полоска справа
5. ✅ **Минималистичные карточки** — только текст (9.5px, 3 строки), цветной маркер слева, разный фон
6. ✅ **Word-break: break-all** — текст заполняет ширину карточки, ломается на любом символе
7. ✅ **Copy icon** — `position: absolute`, плавает поверх текста справа вверху при наведении
8. ✅ **Клик по карточке** — вставляет текст в активное поле ввода
9. ✅ **Клик по иконке** — копирует в буфер обмена
10. ✅ **Шапка в ultra-light** — только `⌁` слева и `×` справа, кнопка выхода видна

### Структура в Превью — доработка

**Выполнено в этой сессии:**

1. ✅ **Маркер прокрутки 0→100%** — живёт своей жизнью, плавно от scrollTop/scrollMax. Убран `atBottom` snap и привязка к позициям заголовков
2. ✅ **Синяя подсветка видимых заголовков** — `IntersectionObserver` на `h1/h2/h3` в `#preview-content`. Заголовки в viewport → `.active` (синий), вышли → теряют синий
3. ✅ **Клик в превью → переход к блоку** — сворачивает панель превью (`panel.classList.add('collapsed')`), скроллит к блоку, фокус textarea в начале (`setSelectionRange(0,0)` + `scrollTop=0`)
4. ✅ **Скрыт системный скроллбар** — `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` на `#preview-content`

**Известные ограничения:**

- При одинаковых заголовках в разных блоках клик определяет блок по позиции заголовка среди h1 — может выбрать не тот блок. В реальности маловероятный кейс.

**Изменённые файлы:**

- `ui.js`: `_highlightActiveByScroll()` (marкер 0-100%), `_setupStructIO()` (IntersectionObserver), `_getPreviewClickBlockId()` (DOM traversal к h1), `_initPreviewClickToBlock()` (сворачивание превью + фокус)
- `styles.css`: `#preview-content` — `scrollbar-width: none` + webkit скрытие

### LLM-модуль: улучшения

**Выполнено в этой сессии:**

1. ✅ **Мини-чат** — A-/A+ (размер шрифта, шаг 0.5, CSS-переменная `--chat-font`), ◀▶ навигация по сессиям, + новый чат, индикатор 1/N, заголовок чата
2. ✅ **История чата** — сессии сохраняются в localStorage, `pushToHistory()` для внешних запросов, `beforeunload` хук
3. ✅ **Scorecard** — бары рендерятся сразу без анимации (`data-bar` + `requestAnimationFrame`), CSS `white-space: normal` убран для assistant
4. ✅ **Долгое нажатие "Очистить"** — 800мс = очистить все сессии, короткое = текущую
5. ✅ **Кнопка отправки** — мягкая выпуклость (тонкий круг с точкой), `inset`-тень
6. ✅ **Компактность** — padding header 4px/6px, gap 3px, SVG 11px, textarea padding 5px/6px
7. ✅ **Промпт чата** — русский, personality для Paste/Copy, дружелюбный но не болтливый

### Меню "Причесать текст"

**Выполнено:**

1. ✅ **Настройка "Показывать визуальный diff"** — чекбокс в Разное → Предпросмотр, по умолчанию ВЫКЛ
2. ✅ **Роутинг режимов:**
   - Чат (`positive_instr`, `negatives`, `summary`, `variations`) → MiniChat
   - Всегда diff (`grammar`) → diff-панель
   - Всегда замена (`edit`, `format`, `expand`, tone, shrink) → прямая замена
3. ✅ **`_runGroomInChat`** — открывает MiniChat, стримит, сохраняет в `_history` через `pushToHistory()`
4. ✅ **`pushToHistory(role, content)`** — новая функция MiniChat для сохранения внешних ответов
5. ✅ **Grammar diff** — проверка `_alwaysDiff.includes(mode)` (оригинальный mode, не alias)
6. ✅ **Язык промптов** — `positive_instr` и `variations` получают `_LANG_INSTR` (отвечают на русском)

### Подсказки с навигацией

1. ✅ **text-linter.js** — "стр. N" кликабельная ссылка `<a class="text-lint-hint-link" data-line="N">`
2. ✅ **Навигация** — клик → `setSelectionRange` + `scrollTop` к строке в textarea
3. ✅ **CSS** — accent цвет, пунктирная линия, hover-эффект

### Python Embedded

1. ✅ **python/** — Python 3.11.9 portable (~20MB распакованный)
2. ✅ **start-server.bat** — ищет встроенный Python → системный → ошибка
3. ✅ **stop-server.bat** — убивает python.exe и pythonw.exe
4. ✅ **.gitignore** — python/ и python-embed.zip

### Фиксы

1. ✅ **Переносы строк в мини-чате** — убран `white-space: normal` с `.llm-chat-msg.assistant`
2. ✅ **Правый отступ** — `max-width: 88%` на assistant, `scrollbar-gutter` + кастомный скроллбар
3. ✅ **Resize плавный** — кэширование `_resizeStartPos`/`_resizeStartRect` при mousedown, delta-расчёт
4. ✅ **Аудит промпта + Сжать токены** — добавлен `pushToHistory('assistant', result)` в `PromptAudit.audit()` и `TokenOptimizer.compress()` (ответы теперь сохраняются в историю мини-чата)
5. ✅ **Переключение чатов — прокрутка в начало** — `_noAutoScroll` флаг блокирует `scrollTop = scrollHeight` в `_appendMsg`/`_appendScorecardToDOM` при восстановлении сессии, затем `scrollTop = 0`
6. ✅ **Кнопки копирования и перевода** — `_addCopyButton` и `_addTranslateButton` вызываются в `_appendMsg` для `assistant` сообщений (восстанавливаются при переключении сессий)
7. ✅ **Кнопка "вниз" на пустом чате** — `_updateScrollDownBtn()` вызывается в `_switchSession` и `_newSession` после очистки DOM

**Активные файлы:**

- `ui.js` (~1970 строк): Preview (marкер 0-100%, IntersectionObserver, клик→блок), structure menu
- `llm-features.js` (~4170 строк): MiniChat (сессии, шрифт, навигация, _noAutoScroll), groomBlock (роутинг), _runGroomInChat, pushToHistory
- `llm-core.js` (~1880 строк): chat_system промпт (русский), visualDiff настройка, _saveGeneral/_syncGeneral
- `text-linter.js` (~1395 строк): renderHints (кликабельные ссылки), навигация по строкам
- `styles.css` (~5905 строк): мини-чат, structure-active-bg, scrollbar скрытие, font-size variable
- `index.html` (~1775 строк): кнопки мини-чат, настройка visualDiff
- `start-server.bat` — встроенный Python + fallback на системный
- `python/` — Python 3.11.9 Embedded

### Архив предыдущих сессий

**Sticky Note + TODO + Table + IndexedDB Backup** — local-backup.js, Sticky 5 цветов, TODO 5 подвкладок, Table с сеткой
**Уголёк (ember.js)** — Economy Mode + 3D Glow + weighted geometry + пасхалка
**Anchor gutter background highlight bug** — race condition fix
**Переводчик** — Google→MS→legacy fallback, 9 языков
**Кнопки перевода** — в блоках, блокноте, мини-чате
**Структура превью** — навигация + подсветка фона
**Якоря** — TreeWalker+Range позиционирование

## Architecture Decisions

- MiniChat сессии: `{ id, history, title }` в localStorage, ключ `llmChatSessions`
- Scorecard в истории: `{ role: 'scorecard', content: JSON.stringify(data) }`
- CSS-переменная `--chat-font` на панели — все элементы наследуют размер
- `pushToHistory()` — отдельный API для внешних вызовов (groom modes), не зависит от `send()`
- `data-bar` атрибут + rAF — бары рендерятся после DOM-вставки для корректного paint
- Groom роутинг: `_chatModes` / `_alwaysDiff` / `_alwaysDirect` — три категории поведения
- Python Embedded в `python/` — .gitignore, start.bat с fallback
- Маркер структуры: `ratio * (totalH - bgH)` — плавно 0→100%, без привязки к заголовкам
- Подсветка заголовков: IntersectionObserver с `root: #preview-content`, `_structVisibleSet` Set
- Клик в превью: DOM traversal от `e.target` вверх к ближайшему `h1`, сворачивание `panel.collapsed`
- `_noAutoScroll` флаг: блокирует автоскролл в `_appendMsg`/`_appendScorecardToDOM` при восстановлении сессии
- Кнопки перевода/копирования: добавляются в `_appendMsg` для `assistant` (а не только в `finalizeLastMessage`)
- Ultra Light: CSS `word-break: break-all` + `overflow: clip` + `max-height: calc(1.35em * 3 + 2px)` — текст заполняет ширину, 3 строки, без JS-переноса

## Commits (последняя сессия)

```
(ещё не коммитилось в этой сессии)
```
