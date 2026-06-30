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

### MindMap — полный цикл разработки (rounds 1–4)

#### Round 1 — Багфиксы + фундамент

1. ✅ **Баг: line overflow в _drawTree** — проверка `lineNum > 2` перенесена в начало `forEach` (была после push)
2. ✅ **Баг: дубль stroke-width** — убран повторный `setAttribute('stroke-width', '1')` в tree
3. ✅ **Баг: nodeMap коллизия** — дедупликация слов в `_drawGraph` (Map по тексту + indices), `nodeMap` по индексу
4. ✅ **ResizeObserver** — пересчёт viewport при ресайзе canvas, сброс zoom/pan
5. ✅ **Мёртвый код** — `_panel` оставлена локальной в `_ensureOverlay`
6. ✅ **Viewport `<g>` группа** — все элементы рендера внутри `_viewport` с единым transform
7. ✅ **Zoom колесом к курсору** — factor 1.12, clamp 0.4–4x, удержание точки под курсором
8. ✅ **Pan мышью** — drag с порогом 3px (`movedEnough`), cursor grab/grabbing
9. ✅ **Cursor parallax** — `data-depth` на группах, throttle через rAF, 40px амплитуда
10. ✅ **Bloom filter** — двухуровневый `feGaussianBlur` (6+12 stdDeviation) вместо простого glow
11. ✅ **Radial gradients** — "светящийся шар" для circle/ellipse (cx=35% cy=30%)
12. ✅ **Glassmorphism** — `backdrop-filter: blur(20px) saturate(140%)`, inset glow, preserve-3d
13. ✅ **Tilt-эффект** — perspective(1000px) rotateX/Y ±4deg на панели

#### Round 2 — Добивка 2.5D

14. ✅ **Баг: чёрная дыра в clusters** — убран `filter="shadow"` с ellipse (feDropShadow просвечивал сквозь градиент)
15. ✅ **Баг: наезд кластеров** — `dist = max(Math.min(W,H)*0.28, maxR*1.3)` вместо фиксированного 0.28
16. ✅ **Панель прозрачна** — background `rgba(20,22,30,0.55/0.45)` вместо `rgba(255,255,255,0.04/0.01)`
17. ✅ **Инерция pan** — velocity 0.92 затухание, `cancelAnimationFrame` при mousedown
18. ✅ **Smooth zoom-to-node** — даблклик → `_smoothZoomTo(x, y, 2)`, cubic-bezier 0.4s
19. ✅ **Atmospheric blur** — `(0.3 - depth) * 3` px, один раз при рендере. **Disabled для hierarchy/timeline**
20. ✅ **Stagger animation** — `mm-enter` на внешнем `<g>`, parallax на вложенном `<g>`, 25ms задержка
21. ✅ **Изогнутые линии** — квадратичные Безье `Q` вместо `line` (0.15 изгиб)
22. ✅ **Звёздный фон** — `floor(W*H/9000)` частиц, depth 0.05

#### Round 3 — Управление, кэш, jump-to-word

23. ✅ **Слайдер зума** — вертикальный range `rotate(-90deg)`, min=40 max=400, double-click reset
24. ✅ **Proximity reveal** — обобщённый `_setupProximityReveal(el, radius)`: controls 150px, zoom 120px
25. ✅ **Синхронизация слайдера** — wheel→slider, slider→zoom, reset→100
26. ✅ **Airy buttons** — `rgba(255,255,255,0.03)` + `backdrop-filter: blur(6px)`
27. ✅ **Кэш результата** — `open()` проверяет `_data`, показывает кэш без LLM
28. ✅ **Кнопка ↻ (refresh)** — spinning animation, блокировка wheel/mousedown во время загрузки
29. ✅ **Click/dblclick split** — 220ms таймер, click→jump-to-word, dblclick→zoom
30. ✅ **Jump-to-word** — CustomEvent `mindmap:jump-word`, handler в blocks.js: regex поиск, setSelectionRange, scrollTop, jump-highlight 2с
31. ✅ **Jump-to-word fix** — убран `\b` из regex (не работает с кириллицей), fallback: фокус на первом блоке + тост

#### Round 4 — Режимы "Иерархия" и "Таймлайн"

32. ✅ **Рефакторинг: `_attachWordInteractions`** — click→jump + dblclick→zoom, переиспользуется в Words/Hierarchy
33. ✅ **Рефакторинг: `_gradIdFor` + `_ensureGradient`** — градиенты на лету с кэшированием
34. ✅ **Рефакторинг: `_wrapTextLines`** — перенос строк, переиспользуется в Tree/Timeline
35. ✅ **Рефакторинг: `_emptyMsg`** — заглушка для пустых данных
36. ✅ **Промпт mindmap (llm-core.js)** — добавлены `hierarchy` (tree max 3 уровня) и `steps` (процесс). maxTokens 3000
37. ✅ **Промпт mindmap fix** —.steps: "break into 3-8 logical steps" вместо "only if process/procedure"
38. ✅ **Режим "Иерархия" (M)** — рекурсивный radial tree, layout по углам, кривые Безье, bloom на корне
39. ✅ **Режим "Таймлайн" (→)** — горизонтальная лента карточек 240×120, стрелки с маркером `#arrow-head`
40. ✅ **Timeline: wrap title** — заголовок переносится (max 2 строки), описание смещается вниз

#### Визуальные фиксы

41. ✅ **Depth blur** — коэффициент 6→3, порог 0.3→0.4. **Disabled для hierarchy/timeline**
42. ✅ **Clusters: баланс** — radial gradient `fill-opacity: 0.35`, stroke 1px `color+40`
43. ✅ **Clusters: random gradient direction** — уникальный `radialGradient` на каждый эллипс, `cx/cy` рандом 20–80%

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

### Hotkeys — раскладка

44. ✅ **e.code вместо e.key** — хоткеи работают на любой раскладке (EN/RU). `e.code='KeyT'` вместо `e.key.toLowerCase()==='t'`. Исправлено в app.js, ui.js, notepad.js

### Git коммиты (mindmap, эта сессия)

```
0010e02 mindmap clusters: random gradient direction per ellipse (cx/cy randomized 20-80%)
22cc38c mindmap clusters: balanced — radial gradient at 35% opacity, readable text
9278795 mindmap clusters: subtle ellipses — lighter fill, thinner stroke, text-first
3e036f5 mindmap jump-to-word: fix Cyrillic search (drop \b), show first block + toast if word not found
43877f9 mindmap: reduce depth blur coefficient 6→3, disable blur for hierarchy/timeline modes
71f1937 mindmap timeline: wrap title text, widen cards 240x120
7e946f1 mindmap round 4: hierarchy + timeline modes, prompt update, refactor
7ac3c9c mindmap prompt: relax steps rules — always try to find logical progression
6c7b4e3 mindmap round 3: zoom slider, airy buttons, result cache + refresh, click/dblclick split, jump-to-word
264f969 mindmap round 2: bugfixes, starfield, curved links, depth blur, stagger, inertia, smooth zoom
4be7af8 mindmap: visual upgrade — bugfixes, viewport, zoom/pan, parallax, neon/glass, tilt
```

### Ключевые файлы

- `mindmap.js` (~925 строк) — MindMap: SVG-визуализация (6 режимов: words/graph/tree/clusters/hierarchy/timeline), zoom/pan/inertia, parallax, stagger, bloom/glass, jump-to-word
- `mindmap.css` (~110 строк) — стили оверлея, glass-панели, airy-кнопки, zoom-slider, mm-enter/pulse анимации
- `ai-transform.js` (~300 строк) — AI трансформация текста, diff-панель, история запросов
- `llm-features.js` (~4400 строк) — MiniChat, PromptGrader, Thesaurus, _runGroomInChat, SmartPlaceholders
- `llm-core.js` (~1894 строк) — request(), _extractContent, _parseSSE, _parseNDJSON, LLMCache, prompts (mindmap с hierarchy/steps)
- `blocks.js` (~3153 строк) — переводчик (sequential), меню груминга (тултипы), кнопка AiTransform, mindmap:jump-word handler
- `ui.js` (~2020 строк) — Preview (scroll sync, backtick fix)
- `app.js` (~920 строк) — хоткеи (e.code), Ctrl+K для AiTransform
- `notepad.js` (~760 строк) — хоткеи (e.code)
- `diff-engine.js` (~185 строк) — DiffEngine.compute/renderHtml для diff-панелей

## Architecture Decisions

- **e.code для хоткеев** — `e.code='KeyT'` вместо `e.key.toLowerCase()==='t'` потому что `e.key` зависит от раскладки
- **MindMap viewport `<g>`** — все элементы в одной группе с единым transform (zoom/pan/parallax)
- **MindMap stagger vs parallax** — анимация на внешнем `<g class="mm-enter">`, parallax на вложенном `<g data-depth>` — конфликт transform решён вложенностью
- **MindMap depth blur** — disabled для hierarchy/timeline (текст для чтения), coefficient 3 для остальных
- **MindMap clusters gradient** — уникальный radialGradient на каждый эллипс (cx/cy рандом 20–80%) для разнообразия
- **MindMap jump-to-word** — CustomEvent `mindmap:jump-word` из mindmap.js, handler в blocks.js (разделение ответственности)
- **MindMap regex** — без `\b` (не работает с кириллицей), простой substring поиск
- **MindMap cache** — `_data` хранится между открытиями, refresh кнопка ↻ для перезапроса
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
