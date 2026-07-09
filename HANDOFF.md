# HANDOFF — Paste/Copy

## Текущий статус

### В работе

**Квадратный таймер (обводка по периметру)**
- Статус: визуальный аудит применён (~9/10), нужна проверка в браузере
- Файлы: `timer.js`, `index.html`, `styles.css`
- Коммиты: `37aa292` (базовая), `91eaaf9` (фикс display), `366ad0b` (аудит), `3afa6d7` (повторный аудит), `67a9475` (визуал), `2dec017` (trail-анимация), `50ae50a` (trail 5с + пасхалка), `609b61e` (направление trail), `825a855` (rAF trail + flash), `35041d5` (упрощение: ghost удалён)
- Что исправлено по шестому аудиту (замена функций):
  - **CRITICAL:** Trail через `requestAnimationFrame` — CSS transition на `stroke-dasharray` не работает в браузерах
  - **HIGH:** `_injectStyles()` — CSS инжектируется из JS, гарантированно применяется
  - **HIGH:** `_flashEffect()` — `drop-shadow` + `brightness` flash при достижении 99/0
  - **LOW:** `_cancelGhost()` — отмена rAF + скрытие ghost
- Что исправлено по пятому аудиту:
  - **HIGH:** `onPointerUp` — проверка `_pointerDownPos === null` перед стартом (свайп за пределы кнопки на тач)
  - **HIGH:** SVG `<rect>` → `<path>` (старт обводки от 12 часов)
  - **MEDIUM:** Анимация смены минуты (`_prevMinutes` + CSS `@keyframes timerDigitFlip`)
  - **MEDIUM:** `setIdleVisual()` — очистка анимации перед установкой '0'
  - **LOW:** `onLostCapture` — сброс `_longPressFired`
  - **LOW:** `destroy` — сброс `_prevMinutes`
  - **LOW:** `startCountDown` — `closeInlineInput()` перед `updateDisplay()`
- Что исправлено по первому аудиту:
  - **HIGH:** `resetToIdle()` теперь очищает long-press (гонка правый клик → setTimeout)
  - **HIGH:** `pointerleave` не отменяет long-press для mouse hover (только touch/stylus)
  - **MEDIUM:** Строгая валидация полей в `restoreState()` (mode/startTs/targetMinutes)
  - **MEDIUM:** Очистка повреждённых данных через `clearPersisted()`
  - **MEDIUM:** `safeSet()` обёртка для `Storage._set` (ловит QuotaExceededError)
  - **MEDIUM:** `ResizeObserver` инвалидирует кэш периметра при resize
  - **MEDIUM:** `lostpointercapture` обработчик для жестов ОС
  - **MEDIUM:** CSS transition 0.9s → 1s (синхронизация с tick)
  - **LOW:** `_initialized` guard от двойной инициализации
  - **LOW:** `closeInlineInput()` очищает `inputEl.value`, обёртка `try/catch`
- Следующий шаг: проверка в браузере

**Баг: сниппеты не обновляются в пикере после редактирования**
- Симптом: изменение текста в блоке Сниппеты не отражалось при вводе через "/" или кнопку "Вставить сниппет"
- Причина: `getAllSnippetsAndCommands()` в `state.js` собирала данные только из `commands` блоков, игнорируя `snippets` блоки
- Фикс: добавлен сбор из `snippets` типа с фильтрацией по `enabled` и дедупликацией по `value`
- Коммит: `19af0c6`

**Баг: облачные сниппеты не сохраняют правки (показано на скриншоте)**
- Симптом: изменение текста облачного сниппета не сохранялось → при вставке через "/" вставлялась старая версия
- Причина: `renderCommandsBody` в `blocks.js` использовал `State.updateLive()` для облачных сниппетов — обновлял память, но не вызывал `emit()` для сохранения в localStorage
- Фикс: заменено на `State.update()` для title и value облачных сниппетов
- Коммит: `c5d6110`
- Уточнение: `State.update()` на каждый тик вызывал ре-рендер → инпут пересоздавался → фокус терялся
- Исправлено: `oninput` → `updateLive` (без ре-рендера), `onblur` → `update` (сохранение)
- Коммит: `5ecadd9`
- Ещё не работало: `State.updateLive()` вызывает `scheduleSave()` с 600мс дебаунсом — при быстром уходе со страницы не успевало сохраниться
- Исправлено: `onblur` → `State.snapshot()` + `Storage.save(State.serialize())` — немедленное сохранение
- Коммит: `f884f6c`
- **Корневая причина**: `getGlobalSnippets()` возвращает浅ковые копии `{...item}`. Редактирование `item.value` в `oninput` меняло копию, а не оригинал в `globalSnippets`. `serialize()` сериализовал неизменённые оригиналы.
- Добавлены `State.updateGlobalSnippetLive(id, fn)` и `State.updateGlobalSnippet(id, fn)` — мутация оригинального объекта + emitLive/emit
- `oninput` → `updateGlobalSnippetLive` (без ре-рендера), `onblur` → `updateGlobalSnippet` (полное сохранение)
- Коммит: `50a2ec8`
- **Подтверждено работает** пользователем

### Завершено в этой сессии
- Симптом: меню появляется и сразу пропадает
- Расследование: прочитаны `text-expander.js`, `blocks.js`, `prompt-loom.js`
- Подозрение: race condition между `input` → `_showDropdown` и `selectionchange` → `_hideDropdown`
- Следующий шаг: проверить `WordComplete.handleInput(ta)` — вызывается до `TextExpander.handleInput`, может модифицировать textarea и вызвать `selectionchange`, который закроет dropdown

### Завершено в этой сессии

**Аудит llm-core.js** — 2 раунда (ответ 3 (11).txt + ответ 3 (12).txt), 8 исправлений из 13
- **#3 [high]** SSE `[object Object]` — `typeof delta === 'string'` guard (Anthropic `message_delta` объект ломал вывод)
- **#1 [high]** 429-backoff отрицательный — `baseRetries - retries` вместо `3 - retries`
- **#2 [high]** Все HTTP ошибки ретраятся — теперь только 429 и 5xx
- **#4 [medium]** Общий retry counter — `retries = baseRetries` после успешного ответа
- **#6 [low]** SSE reader не отменяется — `reader.cancel().catch(()=>{})` после `[DONE]`
- **#7 [low]** retries=0 невозможно — `|| 2` → `?? 2`
- Пропущено: **#5** (пустой ответ ретраится — разумно), **#8** (estimateTokens CJK — опционально)
- Коммит: `97ed4fb`
- Раунд 2 (ответ 3 (12).txt) — 2 из 5:
  - **#3 [low]** NDJSON `typeof delta === 'string'` guard (единообразие с SSE)
  - **#5 [low]** `_clearDangerButton` при `close()` модала (сброс armed-кнопок)
  - **#1 [medium]** Тело ответа не читается — пропущено (`_readErrorText` уже дренирует)
  - **#2 [medium]** Текст ошибки теряется — пропужено (дублирует #1)
  - **#4 [low]** `json.delta` fallback мёртвый код — пропужено (работает корректно)
  - Коммит: `77f4772`

**Аудит app.js** — 3 раунда (ответ 3 (8).txt + ответ 3 (9).txt + ответ 3 (10).txt), 10 исправлений
- **#1 [критично]** Async IIFE `.catch()` — теперь ловит ошибки bootstrap + показывает пользователю
- **#2 [критично]** `importFile`: `_importBusy` guard, `MAX_IMPORT_BYTES` 10MB, `reader.onerror`
- **#3 [важно]** `revokeObjectURL` 1с → 10с во всех местах скачивания (4 шт.)
- **#4 [важно]** Column resizer `mousemove` → rAF batching (убран layout thrashing)
- **#5 [UX]** `prev-download` — Toast при пустом превью
- **#6 [perf]** `State.onChange(queueFullRender)` вместо прямого `fullRender` — rAF batching
- **#7 [читабельность]** Магические числа в `optWcEffectMs` → `WC_EFFECT_MIN_MS/MAX_MS/STEP_MS`
- Коммит: `6591bc1`
- Раунд 2 (ответ 3 (9).txt) — 2 из 4 внедрены:
  - **#1 [важно]** Auto-backup перед деструктивным импортом (max 3 бэкапа в localStorage)
  - **#2 [UX]** Preview resizer rAF batching (согласовано с column resizer)
  - **#3 [читабельность]** Дублирование `setLayout`+`scheduleSave` — пропущено (рефакторинг 15+ обработчиков, высокий риск)
  - **#4 [perf]** TreeWalker вместо `querySelectorAll` — пропущено (опциональная микро-оптимизация)
  - Коммит: `d4b9a02`
- Раунд 3 (ответ 3 (10).txt) — 1 из 1:
  - **#1 [UX]** Финальная позиция ресайзеров в `mouseup` — apply перед сбросом (column + preview)
  - Коммит: `2c2b7f3`

**Аудит text-skeletonizer.js** — 2 раунда, GPT-5.5-mini, оценка 8.5-9/10
- Раунд 1 (`Ответ 2 (4).txt`): 2 high + 5 medium + 3 low → applied:
  - `[high]` Worker result validation — `typeof result !== 'string'` → fallback
  - `[medium]` Cache key: `level:text.length:hash` вместо `level:hash`
  - `[medium]` `_setCache` + `_cacheKey` хелперы — единая LRU логика
  - `[medium]` Negation window — 3 слова назад вместо 1
  - `[low]` Удалён мёртвый параметр `opts` из `_configForLevel`
- Раунд 2 (`Ответ 2 (5).txt`): 2 medium → applied:
  - `[medium]` `slice().some()` → прямой цикл (убраны аллокации)
  - `[medium]` JSDoc: `process()` = sync, `processAsync()` = async + Worker
- Коммиты: `9862e28`, `744df66`

**Аудит text-skeletonizer-worker.js** — 1 раунд, GPT-5.5-mini, оценка 7.5-8/10 → ~9/10
- (`Ответ 2 (6).txt`): 1 high + 3 medium → applied:
  - `[high]` Negation window sync — 1→3 слова (drift с основным модулем)
  - `[medium]` `e.data || {}` + try/catch вокруг деструктуризации
  - `[medium]` `String(err.message || err)` вместо `err.message`
  - `[medium]` `typeof text !== 'string'` guard
- Коммит: `515e50d`

**Аудит text-expander.js** — 1 раунд, GPT-5.5-mini, оценка 8/10
- (`Ответ 2 (7).txt`): 4 critical + 2 perf → applied:
  - `[critical]` `_dropdownCleanup` — listener cleanup при destroy()/hideDropdown()
  - `[critical]` `_dedupeShortcutsByKey` — spread entries перед итерацией
  - `[critical]` `insertToken` — защита от async clipboard race
  - `[critical]` localStorage corruption — Toast.show вместо пустого catch
  - `[perf]` Mirror DOM — diff check `!==` перед textContent
- Коммит: `65c7701`

**Spellcheck по умолчанию ВКЛ**
- `state.js`: `spellCheck: false` → `spellCheck: true`
- `blocks.js`: `ta.spellcheck = false` → `ta.spellcheck = b.spellcheck !== false`
- Коммит: `0be0fd2`

**Аудит flowchart.js** — 2 раунда, GPT-5.5-mini, оценка 7/10 → ~8.5/10
- Раунд 1 (`Ответ 2 (8).txt`): 3 high + 4 medium + 2 low → applied:
  - `[high]` `_forceLayout(reset)` — все узлы movable + сброс координат при mode switch
  - `[medium]` Адаптивные итерации: `min(200, 60 + n*3)`
  - `[medium]` Гравитация к центру для disconnected nodes
  - `[low]` `cancelAnimationFrame(_inertiaRaf)` в `close()`
  - `[low/medium]` XSS tooltip — innerHTML → DOM API
  - `[medium]` LLM JSON validation — dedupe ids + filter invalid edges
- Раунд 2 (`Ответ 2 (9).txt`): 2 high + 2 medium + 1 low → applied:
  - `[high]` Edge hit-area — невидимый path 35px для контекстного меню
  - `[medium]` Удаление узлов по ПКМ — прямое, без tooltip
  - `[medium]` Удаление полотен по ПКМ — без удержания
  - `[low]` Удалена кнопка "Обновить анализ" + spinning
- Раунд 3 (`Ответ 2 (10).txt`): 1 high + 2 medium → applied:
  - `[high]` SVG parent traversal — `_findNodeElement()` вместо `closest()`
  - `[medium]` Edge hit-area увеличен до 35px + `pointerEvents: stroke`
  - `[medium]` `confirm()` перед удалением полотна → позже убран по запросу
- Баг-фикс: `insertBefore` ошибка — `_styleEdge` возвращает hit, append в callers
- Баг-фикс: connect mode — `classList.add/remove` → `setAttribute` для SVG
- Баг-фикс: orphan edges — fallback `_drawEdgeSimple` для edges не в `_routeData`
- Коммиты: `dbf78c8`, `bae5367`, `5b788b5`, `bc75995`, `eb2b7ed`, `e48ce87`, `359f8fc`

**Удаление Korean из переводчика**
- `translator.js`: удалена запись `{ code: 'ko', name: '한국어', flag: '🇰🇷' }`
- Коммит: `54d959b`

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `timer.js` | Новый модуль квадратного таймера |
| `index.html` | Добавлена кнопка #btn-timer, подключение timer.js |
| `styles.css` | Стили для таймера (анимация, пульсация) |
| `text-skeletonizer.js` | cache key + LRU + worker validation + negation window + JSDoc |
| `text-skeletonizer-worker.js` | negation sync + onmessage safety + type guard |
| `text-expander.js` | dropdown cleanup + dedupe safety + insertToken + localStorage error + mirror diff |
| `flowchart.js` | forceLayout fix + edge hit-area + node delete + canvas delete + XSS + LLM validation + SVG traversal + connect fix |
| `state.js` | `spellCheck: true` |
| `blocks.js` | `ta.spellcheck = b.spellcheck !== false` |
| `translator.js` | удалён Korean |
| `app.js` | catch bootstrap + importFile guards + revokeObjectURL 10s + resizer rAF + fullRender batching + magic numbers + empty preview toast |
| `llm-core.js` | SSE typeof guard + retry backoff fix + non-retryable errors + retry reset + reader.cancel + retries=0 |

### Аудиторские файлы (не коммитятся)
| Файл | Содержание |
|------|------------|
| `Ответ 2 (4).txt` | Аудит text-skeletonizer.js v1 (GPT-5.5-mini) |
| `Ответ 2 (5).txt` | Аудит text-skeletonizer.js v2 — re-audit (GPT-5.5-mini) |
| `Ответ 2 (6).txt` | Аудит text-skeletonizer-worker.js (GPT-5.5-mini) |
| `Ответ 2 (7).txt` | Аудит text-expander.js (GPT-5.5-mini) |
| `Ответ 2 (8).txt` | Аудит flowchart.js v1 — focus on graph mode (GPT-5.5-mini) |
| `Ответ 2 (9).txt` | Аудит flowchart.js v2 — UX удаления (GPT-5.5-mini) |
| `Ответ 2 (10).txt` | Аудит flowchart.js v3 — connect + hit-area (GPT-5.5-mini) |
| `аудит text-skeletonizer.txt` | Промпт для аудита text-skeletonizer.js |
| `аудит text-skeletonizer-worker.txt` | Промпт для аудита text-skeletonizer-worker.js |
| `аудит flowchart.txt` | Промпт для аудита flowchart.js |
| `ответ 3 (8).txt` | Аудит app.js раунд 1 (Claude Sonnet 4) |
| `ответ 3 (9).txt` | Аудит app.js раунд 2 (Claude Sonnet 4) |
| `ответ 3 (10).txt` | Аудит app.js раунд 3 — финальный (Claude Sonnet 4) |
| `ответ 3 (11).txt` | Аудит llm-core.js раунд 1 (Claude Sonnet 4) |
| `ответ 3 (12).txt` | Аудит llm-core.js раунд 2 (Claude Sonnet 4) |

## Как работает
- **TextExpander**: trigger `ё` → dropdown с фильтрацией → вставка с обработкой регистра
- **useCount**: инкремент при каждой вставке, влияет на ranking в dropdown и панели
- **Smart candidates**: при автогенерации пробует слова/акроним/склейку по очереди, потом цифры
- **NinjaCursor**: декоративный курсор-шлейф, mirror-div для caret rect, анимация через CSS
- **DiffEngine (diff-engine.js)**: LCS по строкам (Int32Array), токенизация по словам (\b), fallback с рекурсивным построчным diff, нормализация CRLF
- **DiffEngine (llm-features.js)**: отдельный движок внутри `LLMFeatures`, `_collapseWhitespaceRuns` сворачивает пустые строки (totalNewlines ≥ 3) в `↵ …N строк…`
- **Flowchart**: SVG визуализация блок-схем/графов, Sugiyama layout (flow), force-directed (graph), LLM-интеграция, canvas management
- **Spellcheck**: включён по умолчанию, переключается кнопкой в footer

## Следующий шаг
1. Разобраться с багом моргания dropdown (race condition `selectionchange`)
2. Рассмотреть паттерны prompt-loom.js для навигации (wrap-around, wheel)
