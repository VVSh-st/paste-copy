# HANDOFF — Paste/Copy

## Текущий статус

### В работе

**Квадратный таймер (обводка по периметру)**
- Статус: визуальный аудит применён (~9/10), нужна проверка в браузере
- Файлы: `timer.js`, `index.html`, `styles.css`
- Коммиты: `37aa292` (базовая), `91eaaf9` (фикс display), `366ad0b` (аудит), `3afa6d7` (повторный аудит), `67a9475` (визуал), `2dec017` (trail-анимация), `50ae50a` (trail 5с + пасхалка), `609b61e` (направление trail), `825a855` (rAF trail + flash), `35041d5` (упрощение: ghost удалён)
- Следующий шаг: проверка в браузере

**Баг: сниппеты не обновляются в пикере после редактирования** — закрыт
- Коммит: `19af0c6`

**Баг: облачные сниппеты не сохраняют правки** — закрыт, подтверждено пользователем
- Коммиты: `c5d6110`, `5ecadd9`, `f884f6c`, `50a2ec8`

### Завершено в этой сессии

**Доработка: кнопка «Скопировать текст на следующую вкладку»**
- Если текст выделен — копирует только выделение; если нет — весь текст
- После копирования: курсор в конец (выделение) или в начало (весь текст) + фокус
- Файлы: `blocks.js`
- Коммиты: `be62d6e`, `9abaed0`, `c074101`

**Доработка: якоря — позиция маркера**
- Многократные попытки исправить сдвиг маркера на 1+ строку на длинном тексте
- **Итог:** откат к рабочей старой версии (`anchors_old.js`) — `TreeWalker` + `Range` через `_getMirror` на `document.body` + `rawTop = pos.y - scrollY - taPt`
- ⚠️ Добавлен комментарий-предупреждение: не менять `_measurePos`/`_renderMarkers`/`_renderMarkersNoGutter` без веской причины
- Файлы: `anchors.js`
- Коммит: `80e9c99`

**Доработка: якоря — удаление из меню по одинарному клику**
- Было: двойное нажатие на ✕ → подтверждение → удаление
- Стало: одинарный клик на ✕ → удаление
- Файлы: `anchors.js`
- Коммит: `c3d01a8`

**Аудит app.js** — 3 раунда (ответ 3 (8).txt + ответ 3 (9).txt + ответ 3 (10).txt), 10 исправлений
- **#1 [критично]** Async IIFE `.catch()` — ловит ошибки bootstrap
- **#2 [критично]** `importFile`: `_importBusy` guard, `MAX_IMPORT_BYTES` 10MB, `reader.onerror`
- **#3 [важно]** `revokeObjectURL` 1с → 10с (4 места)
- **#4 [важно]** Column resizer rAF batching
- **#5 [UX]** `prev-download` Toast при пустом превью
- **#6 [perf]** `State.onChange(queueFullRender)` rAF batching
- **#7 [читабельность]** `WC_EFFECT_MIN_MS/MAX_MS/STEP_MS`
- Раунд 2: Auto-backup перед импортом, Preview resizer rAF
- Раунд 3: Финальная позиция ресайзеров в mouseup
- Коммиты: `6591bc1`, `d4b9a02`, `2c2b7f3`

**Аудит llm-core.js** — 2 раунда (ответ 3 (11).txt + ответ 3 (12).txt), 8 исправлений из 13
- **#3 [high]** SSE `typeof delta === 'string'` — Anthropic `message_delta` объект
- **#1 [high]** 429-backoff: `baseRetries - retries`
- **#2 [high]** HTTP ошибки: только 429 и 5xx ретраятся
- **#4 [medium]** Retry counter reset после успешного ответа
- **#6 [low]** SSE `reader.cancel()` после `[DONE]`
- **#7 [low]** `retries=0`: `|| 2` → `?? 2`
- Раунд 2: NDJSON typeof guard, `_clearDangerButton` при close()
- Коммиты: `97ed4fb`, `77f4772`

**Аудит text-skeletonizer.js** — 2 раунда, GPT-5.5-mini, 8.5-9/10
- Коммиты: `9862e28`, `744df66`

**Аудит text-skeletonizer-worker.js** — 1 раунд, 7.5-8/10 → ~9/10
- Коммит: `515e50d`

**Аудит text-expander.js** — 1 раунд, 8/10
- Коммит: `65c7701`

**Аудит flowchart.js** — 3 раунда, 7/10 → ~8.5/10
- Коммиты: `dbf78c8`, `bae5367`, `5b788b5`, `bc75995`, `eb2b7ed`, `e48ce87`, `359f8fc`

**Spellcheck по умолчанию ВКЛ** — Коммит: `0be0fd2`

**Удаление Korean из переводчика** — Коммит: `54d959b`

**Промпт для аудита llm-core.js** — файл `аудит llm-core.txt`
- Коммит: `0aae0e4`

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `timer.js` | Новый модуль квадратного таймера |
| `index.html` | Кнопка #btn-timer, подключение timer.js |
| `styles.css` | Стили таймера |
| `blocks.js` | Transfer button: selected text + cursor pos; spellcheck |
| `anchors.js` | Позиция маркера (откат к старой версии) + одинарный клик удаление + warning comment |
| `app.js` | catch bootstrap + importFile guards + revokeObjectURL 10s + resizer rAF + fullRender batching + magic numbers + toast |
| `llm-core.js` | SSE typeof + retry backoff + non-retryable + retry reset + reader.cancel + retries=0 + NDJSON guard + modal close |
| `text-skeletonizer.js` | cache key + LRU + worker validation + negation window |
| `text-skeletonizer-worker.js` | negation sync + safety |
| `text-expander.js` | cleanup + dedupe + insertToken + localStorage error |
| `flowchart.js` | forceLayout + edge hit-area + node/canvas delete + XSS + SVG traversal |
| `state.js` | `spellCheck: true` |
| `translator.js` | удалён Korean |

### Аудиторские файлы (не коммитятся)
| Файл | Содержание |
|------|------------|
| `Ответ 2 (4-10).txt` | Аудит text-skeletonizer, worker, text-expander, flowchart (GPT-5.5-mini) |
| `ответ 3 (8-10).txt` | Аудит app.js 3 раунда (Claude Sonnet 4) |
| `ответ 3 (11-12).txt` | Аудит llm-core.js 2 раунда (Claude Sonnet 4) |
| `аудит llm-core.txt` | Промпт для аудита llm-core.js |

## Как работает
- **TextExpander**: trigger `ё` → dropdown с фильтрацией → вставка с обработкой регистра
- **useCount**: инкремент при каждой вставке, влияет на ranking
- **NinjaCursor**: декоративный курсор-шлейф, mirror-div для caret rect
- **DiffEngine**: LCS по строкам, токенизация по словам, fallback с рекурсивным diff
- **Flowchart**: SVG визуализация блок-схем/графов, Sugiyama + force-directed layout
- **Spellcheck**: включён по умолчанию
- **Anchors**: `TreeWalker` + `Range` через `_getMirror` на `document.body` (⚠️ не менять)

## Следующий шаг
1. Разобраться с багом моргания dropdown (race condition `selectionchange`)
2. Рассмотреть паттерны prompt-loom.js для навигации
