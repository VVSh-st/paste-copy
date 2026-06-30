# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.

Есть MCP инструменты, используй при необходимости.

Мне отвечай по-русски.

**Сленг пользователя (учить, повторять пока не начнёт писать сам):**
- **пики** = задачи
- **тултип** = dropdown / popup / всплывающая подсказка (он так говорит)
- **колонка** = column
- **ресайзер** = resizer
- **дропдаун** = dropdown
- **блок** = block (элемент UI)

## Status — ТЕКУЩАЯ СЕССИЯ

### AiTransform — AI трансформация выделенного текста

1. ✅ **ai-transform.js** — новый модуль (по аналогии с InlineAI для Obsidian)
2. ✅ **Ctrl+K** — popup с полем ввода запроса над выделенным текстом
3. ✅ **Произвольный запрос** — "добавь эмодзи", "сделай короче", "перефразируй" и т.д.
4. ✅ **Inline diff** — зелёный=добавлено, красный=удалено (5 сек)
5. ✅ **Принятие/отмена**: ✓ кнопка, ЛКМ вне=принять, ПКМ=отмена, Esc=отмена

### MiniChat — контекст и кэш

1. ✅ **pushToHistory для всех фич** — `_runOnPreview`, `rephrase`, `expand`, `groom`, `PromptGrader`, `PromptAuditor`, `TokenOptimizer`, `!сум` — все пушат user-text в `_history`
2. ✅ **ensureSession(idx)** — новая функция MiniChat. Если юзер переключил чат во время LLM-запроса, результат попадёт в правильную сессию
3. ✅ **PromptGrader** — короткий user `pushToHistory('user', 'Оцениваю промпт...')` вместо полного текста; явный `pushScorecard(data)` после `ensureSession`
4. ✅ **_runGroomInChat** — `ensureSession(targetSessionIdx)` перед обработкой результата; пустой ответ пушится в `_history` как `system`; убран `pushToHistory('user', text)` — полный текст блока больше не засоряет историю
5. ✅ **Scorecard bars** — двойной `requestAnimationFrame` для анимации полосок (оба: `_renderScorecard` в PromptGrader и `_appendScorecardToDOM` в MiniChat)

### LLM-модуль — ответы и кэш

6. ✅ **Кэш не хранит пустые ответы** — `llm-core.js:658`: `String(result ?? '').trim()` перед `LLMCache.set()`
7. ✅ **reasoning_content fallback** — `||` вместо `??` для content/reasoning_content во всех парсерах: `_extractContent`, `_parseSSE`, `_parseNDJSON`
8. ✅ **Non-stream retry** — повтор запроса при пустом ответе модели (1-2 попытки с паузой 1 сек)
9. ✅ **useStream scope fix** — убран `console.warn` вне блока `try` (переменная не в скоупе)

### Prompt Loom

10. ✅ **pl-list scroll** — `flex: 1` для `.pl-list` + `flex-shrink: 0` для `.pl-card` и `.pl-ultra-card` — карточки не сжимаются, список скроллится

### Превью

11. ✅ **Scroll sync MD/text** — сохранение `scrollTop / (scrollHeight - clientHeight)` перед переключением, восстановление через `requestAnimationFrame`
12. ✅ **Незакрытые бэктики** — `_fixUnclosedBackticks()` считает `` ` `` на строке; нечётное → добавляет закрывающий. Предотвращает "утекание" заголовков в инлайн-код

### Переводчик

13. ✅ **Последовательный перевод** — `Promise.all` → `for...of` с `await`. Причина бага: каждая строка создавала `_activeController` и абортировала предыдущую

### Тезарус

14. ✅ **ПКМ отмена** — правый клик вне попапа: восстанавливает `_thesaurusOrig` через `setRangeText` + `e.preventDefault()` подавляет контекстное меню. Для обоих вариантов (toolbar + блочный)

### Меню груминга

15. ✅ **Тултипы** — `title` для всех 13 пунктов + кастомный тултип через `mouseenter/mouseleave` с задержкой 1800ms, `position: fixed`, fade-in анимация

### SmartPlaceholders

16. ✅ **Регулярка case-insensitive** — `/\{\{llm:...\}\}/gi` вместо `/g`
17. ✅ **Кнопка** — `{{llm:...}}` вместо `{{Ilm:...}}`
18. ✅ **Прямой вызов** — `SmartPlaceholders.fillAll()` вместо `window.SmartPlaceholders?.fillAll?.()`

### Git коммиты (эта сессия)

```
95d4d9e fix: ПКМ тезарус — возврат оригинала перед закрытием
b927b56 feat: ПКМ вне тезаруса — закрывает + подавление контекстного меню
4ed6a20 fix: preview — sync scroll MD/text + fix unclosed backticks
371bcc3 fix: переводчик — последовательный перевод строк вместо parallel (AbortController)
87c1fb9 fix: убран console.warn вне скоупа useStream
12b7b0b fix: повтор non-stream запроса при пустом ответе модели
111f2b1 fix: || вместо ?? для reasoning_content fallback — пустая строка != null
af3de47 fix: fallback reasoning_content для SSE/NDJSON/non-streaming
e839e37 fix: кэш не сохраняет пустые ответы LLM
ba8ae91 debug: логирование пустых ответов LLM в console.warn
6b6aeae fix: scorecard double-RAF + _runGroomInChat ensureSession + history push
27b4c02 fix: Оценка промпта — ensureSession + короткий user + pushScorecard
f9adeca feat: кастомный тултип для меню груминга — 1800ms, position:fixed
eaa7b34 feat: тултипы для пунктов меню груминга
d7a6cd8 fix: regex {{llm:...}} — case-insensitive + кнопка
5ab9c32 fix: SmartPlaceholders — грубый вызов вместо window
f4e4c0c fix: контекст текста в мини-чате — pushToHistory для всех фич
1de74fc fix: pl-list flex:1 — карточки уходят в прокрутку
239cf6d fix: pl-card flex-shrink:0 — карточки не сжимаются, список скроллится
```

## Ключевые файлы

- `llm-features.js` (~4217 строк) — MiniChat, PromptGrader, Thesaurus, _runGroomInChat, SmartPlaceholders
- `llm-core.js` (~1880 строк) — request(), _extractContent, _parseSSE, _parseNDJSON, LLMCache
- `blocks.js` (~2971 строк) — переводчик (sequential), меню груминга (тултипы)
- `ui.js` (~2010 строк) — Preview (scroll sync, backtick fix)
- `prompt-loom.js` (~2349 строк) — pl-list, pl-card CSS
- `translator.js` (~504 строк) — translateProtected, translateOne

## Architecture Decisions

- **ensureSession(idx)** — переключает MiniChat на нужную сессию, если юзер_NAVигировал во время async LLM-запроса
- **reasoning_content fallback** — `||` вместо `??` потому что пустая строка `""` !== `null/undefined`
- **Sequential translate** — `Promise.all` конфликтует с `_activeController.abort()` в Translator
- **Scorecard double-RAF** — первый RAF ждёт layout, второй применяет width к барам
- **_fixUnclosedBackticks** — подсчёт ` на строке; нечётное → закрыть. Работает до marked.parse()
- **Сленг**: пользователь называет dropdown "тултип" — имей в виду

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
