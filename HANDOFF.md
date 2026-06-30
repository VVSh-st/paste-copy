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

## Status — ТЕКУЩАЯ СЕССИЯ (2026-06-30)

### Hotkeys — раскладка

1. ✅ **e.code вместо e.key** — хоткеи работают на любой раскладке (EN/RU). `e.code='KeyT'` вместо `e.key.toLowerCase()==='t'`. Исправлено в app.js, ui.js, notepad.js

### Тезарус — баг-фикс

2. ✅ **Границы слова** — `_thesaurusStart/_thesaurusEnd = start/end` (границы слова), а не `savedStart/savedEnd` (позиция курсора). Иначе setRangeText вставлял в середину слова

### Тезарус — меню

20. ✅ **Меню по долгому клику** — 400мс удержание на кнопке: выпадающее меню (Тезаурус, Антонимы, Перефразирование, Объяснение, Структурирование). Клик по пункту = только запоминает выбор + закрывает. Обычный клик по кнопке = выполняет выбранный режим. Выбор в localStorage. Title кнопки обновляется

### Тайпрайтер-строка

21. ✅ **scroll-padding-bottom** — CSS scroll-padding-bottom на textarea. Настройка в «Разное»: строки отступа снизу (0-10, по умолчанию 0). Конвертация строки→пиксели через lineHeight*20

### AiTransform — AI трансформация текста

3. ✅ **ai-transform.js** — модуль (по аналогии с InlineAI для Obsidian)
4. ✅ **Ctrl+K** — popup с полем ввода и кнопкой отправки
5. ✅ **Кнопка в футере блока** — иконка часов перед тезаурусом
6. ✅ **Если текст не выделен** — запрос ко всему тексту блока
7. ✅ **Текст НЕ заменяется** до нажатия ✓ в diff-панели
8. ✅ **Diff** — большое изменение (>50%): только ответ; небольшое: добавления зелёным
9. ✅ **Отмена (✕/ПКМ)** — возвращает оригинал
10. ✅ **История запросов** — ↑↓ навигация, хранение в localStorage
11. ✅ **Diff как text-linter** — A−/A+ размер, копирование, компактные кнопки ✓/✕

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
19. ✅ **Меню по долгому клику** — 400мс удержание на кнопке: выпадающее меню (Тезаурус, Антонимы, Перефразирование, Объяснение, Структурирование). Клик по пункту = только запоминает выбор + закрывает. Обычный клик по кнопке = выполняет выбранный режим. Выбор в localStorage. Title кнопки обновляется

### Меню груминга

15. ✅ **Тултипы** — `title` для всех 13 пунктов + кастомный тултип через `mouseenter/mouseleave` с задержкой 1800ms, `position: fixed`, fade-in анимация

### SmartPlaceholders

16. ✅ **Регулярка case-insensitive** — `/\{\{llm:...\}\}/gi` вместо `/g`
17. ✅ **Кнопка** — `{{llm:...}}` вместо `{{Ilm:...}}`
18. ✅ **Прямой вызов** — `SmartPlaceholders.fillAll()` вместо `window.SmartPlaceholders?.fillAll?.()`

### Git коммиты (эта сессия)

```
07748c0 fix: меню тезауруса — выбор только запоминает, не выполняет; Тезаурус первым пунктом
63bda6a feat: меню тезауруса по долгому клику — антонимы, перефразирование, объяснение, структурирование
22aa4d2 docs: обновлен HANDOFF.md — AiTransform
5a4c365 fix: AiTransform — все замечания исправлены
e430af1 docs: обновлен HANDOFF.md — AiTransform
5dc57cd fix: AiTransform — текст не заменяется до принятия, diff с подсветкой
d344244 docs: обновлен HANDOFF.md — AiTransform
e77ef05 fix: AiTransform — исправлена кнопка + diff как text-linter
0202678 docs: обновлен HANDOFF.md — AiTransform
4918751 docs: обновлен HANDOFF.md — AiTransform
6b8aa69 fix: AiTransform — исправления по замечаниям
9830d3b revert: откат SlashAI — / уже используется
faa2297 fix: хоткеи работают на любой раскладке (EN/RU)
b4db6a8 fix: тезаурус — замена целого слова а не вставки в середину
b5bc3cb fix: тезаурус по хоткее — сохранение позиции ДО LLM-запроса
```

## Ключевые файлы

- `ai-transform.js` (~300 строк) — AI трансформация текста, diff-панель, история запросов
- `llm-features.js` (~4400 строк) — MiniChat, PromptGrader, Thesaurus, _runGroomInChat, SmartPlaceholders
- `llm-core.js` (~1890 строк) — request(), _extractContent, _parseSSE, _parseNDJSON, LLMCache
- `blocks.js` (~3100 строк) — переводчик (sequential), меню груминга (тултипы), кнопка AiTransform
- `ui.js` (~2020 строк) — Preview (scroll sync, backtick fix)
- `app.js` (~920 строк) — хоткеи (e.code), Ctrl+K для AiTransform
- `notepad.js` (~760 строк) — хоткеи (e.code)
- `diff-engine.js` (~185 строк) — DiffEngine.compute/renderHtml для diff-панелей

## Architecture Decisions

- **e.code для хоткеев** — `e.code='KeyT'` вместо `e.key.toLowerCase()==='t'` потому что `e.key` зависит от раскладки
- **AiTransform diff** — большой изменение (>50% длины): показывает ответ; небольшое: только добавления зелёным
- **AiTransform whole text** — если текст не выделен, запрос применяется ко всему тексту блока
- **ensureSession(idx)** — переключает MiniChat на нужную сессию, если юзер переключился во время async LLM-запроса
- **reasoning_content fallback** — `||` вместо `??` потому что пустая строка `""` !== `null/undefined`
- **Sequential translate** — `Promise.all` конфликтует с `_activeController.abort()` в Translator
- **_fixUnclosedBackticks** — подсчёт ` на строке; нечётное → закрыть. Работает до marked.parse()
- **Сленг**: пользователь называет dropdown "тултип" — имей в виду
- **Тезаурус меню** — клик по пункту = только выбор (не выполнение). Обычный клик по кнопке = выполнение выбранного режима. Режим в localStorage

## Ранее выполнено (архив)

- Prompt Loom Ultra Light, LLM MiniChat, Groom меню, Python Embedded, структура превью, якоря, подсказки с навигацией, Sticky/TODO/Table, Уголёк (Ember), переводчик, мульти-колонки 2-5, drag-and-drop вкладок
