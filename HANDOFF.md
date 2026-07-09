# HANDOFF — Paste/Copy

## Текущий статус

### В работе

**Баг: dropdown TextExpander моргает после ввода триггера ё**
- Симптом: меню появляется и сразу пропадает
- Расследование: прочитаны `text-expander.js`, `blocks.js`, `prompt-loom.js`
- Подозрение: race condition между `input` → `_showDropdown` и `selectionchange` → `_hideDropdown`
- Следующий шаг: проверить `WordComplete.handleInput(ta)` — вызывается до `TextExpander.handleInput`, может модифицировать textarea и вызвать `selectionchange`, который закроет dropdown

### Завершено в этой сессии

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
| `text-skeletonizer.js` | cache key + LRU + worker validation + negation window + JSDoc |
| `text-skeletonizer-worker.js` | negation sync + onmessage safety + type guard |
| `text-expander.js` | dropdown cleanup + dedupe safety + insertToken + localStorage error + mirror diff |
| `flowchart.js` | forceLayout fix + edge hit-area + node delete + canvas delete + XSS + LLM validation + SVG traversal + connect fix |
| `state.js` | `spellCheck: true` |
| `blocks.js` | `ta.spellcheck = b.spellcheck !== false` |
| `translator.js` | удалён Korean |

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
