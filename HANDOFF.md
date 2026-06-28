# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.

Есть MCP инструменты, используй при необходимости.

Мне отвечай по-русски.

## Status — В РАБОТЕ

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
5. ✅ **Grammar diff** — проверка `_alwaysDiff.includes(mode)` (原始ный mode, не alias)
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

**Активные файлы:**

- `llm-features.js` (~4150 строк): MiniChat (сессии, шрифт, навигация), groomBlock (роутинг), _runGroomInChat, pushToHistory
- `llm-core.js` (~1880 строк): chat_system промпт (русский), visualDiff настройка, _saveGeneral/_syncGeneral
- `text-linter.js` (~1395 строк): renderHints (кликабельные ссылки), навигация по строкам
- `styles.css` (~5905 строк): мини-чат (кнопки, скроллбар, scorecard), font-size variable
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

## Commits (последняя сессия)

```
(ещё не коммитилось в этой сессии)
```
