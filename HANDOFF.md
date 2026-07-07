# HANDOFF — Paste/Copy Project

## Модули

### text-expander.js
- **~1750 строк**, 2 итерации рефакторинга. Коммиты `d9c1c9d`, `d6ca839`.
- Итерация 1: глобальный trigger, поле `shortcut`, компактный input row, токены `{{title}}`, `{{datetime}}`, `{{cursor}}`, `{{blockIndex}}`.
- Итерация 2: shortener modes (`word`/`acronym`/`glue`), digits modifier, SVG-иконки в панели.
- Баг-фиксы: multi-char trigger в selectionchange, `{{cursor}}` порядок (до dispatchEvent), `_getTriggerPattern()` дубликат `ё`.
- `_settings.shortener = { mode: 'word', digits: false }` — persistence через Gist sync.
- Статус: код готов. Ожидает браузерного тестирования.

### user-memory.js
- **~610 строк**, 4 раунда аудита, **26 фиксов**. Коммиты `60ee697`, `0424ca0`, `8d0cbca`, `1c5239d`.
- Аудит #1 (6): `safePlainObject` + `FORBIDDEN_KEYS`, `pruneObjectKeys` для словарей, `tabId`/`blockId` санитизация, `calculateSuggestionScore` хелпер, `beforeunload` flush, `getFeatureStats`/`ensureFeatureStats` split, `chars=0` verbosity skip.
- Аудит #2 (6): `sanitizeKey` + `ALLOWED_OUTCOMES`, `pruneObjectKeys` для `byType`/`dismissedUntil`/`disabledTypes`, `type` обрезан до 64, `addSuccessfulStructure` санитизация, `getProfile()` deepClone.
- Аудит #3 (6): `safeNumber`/`safeDuration`/`safeCounter`, `saveNow()` boolean, deepClone в getters, `sanitizeKey` для title, `safeCounter` для counters.
- Аудит #4 (7): `sanitizeStoredEvent`, `normalizeSuggestionStats`, `style`/`personalScores` нормализация, `safePlainObject(maxKeyLength)`, `frequentSnippetHashes` update, `dismissedUntil`/`disabledTypes` нормализация, `importData` try/catch.
- Статус: модуль значительно укреплён, все критичные injection/drift проблемы закрыты.

### smart-suggestions.js
- **~1090 строк**, 2 раунда аудита, **8 фиксов**. Коммиты `6f192f2`, `7656b45`.
- Аудит #1 (4): `esc()` для numeric stats, rAF throttle `positionMenu`, Escape только верхний modal, `openReport` focus save.
- Аудит #2 (4): `esc()` универсальная (`??`, `'` escaping), `ensureStrip()` fallback в body, `readNumberInput()` валидация retention, `readRetentionFromReport()` дедупликация.
- Статус: XSS-защита усилена, retention input валидирован, lifecycle улучшен.

### prompt-loom.js
- **~2480 строк**, 6 раундов аудита, **53 фикса**. Коммиты `12df6f0`, `e1b44fe`, `428ba7b`, `97e9ae2`, `a2ecebb`, `32a70d2`, `cdd20a6`.
- Аудит #1 (13): looksSensitive расширена, renderUltraLightCard whitespace bug, hoverOpenTimer shadowing, patchClipboard try/catch + save original, execCommand Range fallback, saveState toast + cooldown, inlineSession document.contains guard, TOKEN_SYNONYMS/STOP_WORDS на уровень модуля, getInsertTarget clipboard fallback, mergeSimilarItem pinned guard, tooltip 2000 chars, ultraWrapText удалена, dataset.plTip.
- Аудит #2 (11): MAX_ITEMS pinned cap, insertIntoEditable return check, insertItem remove record('snippet'), paste handler password/private/autocomplete, copy handler target check, isEditable stricter types, looksSensitive env regex fix, storage toast cooldown, meta whitelist, loadState normalizeItem, loadSettings normalization.
- Аудит #3 (8): renderPanelList skip when closed, isEditable remove number, contenteditable success flag, loadSettings explicit normalization, looksSensitive cookie/session/JWT, suggest/created toast dedup, undoSnippet extracted.
- Аудит #4 (7): mergeSimilarItem save old text to variants, patchClipboard record after writeText resolves, paste handler check defaultPrevented, isEditable remove email, acceptPaletteIndex verify trigger range, addSnippet global first then fallback, showVariableTip track block IDs.
- Аудит #5 (5): openPanel renderPanelList, findMergeTarget snippet source guard, patchClipboard activeElement context check, normalizeItem variants normalization, toggleVariants check insert result.
- Аудит #6 (6): getAllBlocks safe access, isExistingSnippetValue safe access, isLoomExcluded helper, focusin/input exclude private elements, getInsertTarget block-textarea excluded check, patchClipboard document.hasFocus.
- Статус: модуль значительно укреплён. Приватностьclipboard/history, lifecycle guardы, data-private/data-no-loom boundary, localStorage resilience, State API robustness — все закрыты.

### gist-sync.js
- **~1910 строк**, 4 раунда аудита, **27 фиксов**. Коммиты `3de0814`, `6189feb`, `0c76597`, `8559ece`.
- Аудит #1 (14): push() race condition fix (null return check), hash from snapshot (not current state), sync lock for push/pull/restore, saveCloudHistory quota try/catch, backup metadata normalization (safeNum), cloud history data attribute normalization, duplicate id -> class for backup buttons, loadSettings explicit type normalization with clampNum, CompressionStream await write/close, Cipher.decrypt buffer validation, _quickHash with string length, withRetry for 502/503/504, raw_url removed from console.log, revokeObjectURL delayed.
- Аудит #2 (4): AES-GCM block push when password empty, _lastPushedHash persisted across reload (K_LAST_HASH), K_DIRTY cleared only if hash matches pushed, PAT input autocomplete='off'.
- Аудит #3 (3): pull() split into fetch + markPulledSynced (no premature sync marking), decompress() DecompressionStream check, schedulePush() K_DIRTY try/catch.
- Аудит #4 (6): Compress.supported checks both streams, schedulePush _hasChanges before dirty, _doPush sync lock reschedule, _quickHash dual hash (djb2+FNV-1a), parseBody form-encoded check, Storage.save before State.load in all handlers.
- Статус: четвёртый раунд завершён. Модуль укреплён. Готов к браузерному тестированию.

### memory-sync.js
- **~940 строк**, 4 раунда аудита, **20 фиксов**. Коммиты `1e9dd4f`, `3827dc7`, `8804ded`.
- Аудит #1 (0): аудитор запутал модули — все 6 пунктов относились к gist-sync.js.
- Аудит #2 (6): `document.title` удалён из sync payload, `localBudget` обработка в `pull()`, `pauseAfterRateLimit` dirty только для push, `rollbackRequestCount` при AbortError, `getValidatedGistId()`, `escapeHtml` одинарные кавычки.
- Аудит #3 (10): bundle/hash в try/catch, auto-pull таймер 24ч, schemaVersion валидация, truncated проверка, assertPayloadSize 1.5MB, partial import state, abort timer в finally, localStorage try/catch, stableStringify sorted keys, isRateLimitError + rateLimitRemaining.
- Аудит #3.1 (4): **request() сделан async** (finally блок корректно ждёт fetch), assertPayloadSize считает UTF-8 байты через TextEncoder, suppressSchedule save/restore в pull(), maskGistId в diagnostics.
- Статус: аудит завершён. Критичный баг с timeout исправлен. Готов к браузерному тестированию.

### quality-detectors.js
- **~361 строк**, 1 раунд аудита, **6 фиксов**. Коммит `7f9a6a1`.
- Аудит #1 (6): `getTextBlocks` depth limit (max 20), `similarityScore` валидация внешнего результата (Number.isFinite + clamp), `findDuplicates` предвычисление tokenSet (avoid redundant normalization), `analyzePreview` кеш блоков (1 обход вместо 5), `estimateStructure` инкрементальная сборка текста (вместо join-then-slice).
- Статус: аудит завершён. Модуль чистый (нет innerHTML, нет сети, нет сохранения). Готов к браузерному тестированию.

### mindmap.js
- **~2220 строк**, 28 раундов аудита, **~270 фиксов**. Коммиты `c576109`, `0865ded`.
- Аудит #28 (2): spinner race condition (finally guard `seq === _requestSeq`), jump-to-word через Shift+click.
- Статус: 28 раундов завершены. Готов к браузерному тестированию.

### storage.js
- Баг-фикс (`a07c3a2`): `_lastSavedRaw` кеш обновлялся до попытки сохранения. При quota exceeded localStorage `_set()` возвращал `false`, данные падали в IndexedDB (async), но `_lastSavedRaw` уже был обновлён → следующий `save()` пропускался через `raw === _lastSavedRaw` → `return true`. Теперь `_lastSavedRaw` обновляется только после успешного сохранения.

### state.js
- Баг-фикс (`32fb513`): миграция subtabs для text-блоков выбрасывала поля `completed` и `blocked`, оставляя только `label`/`value`. Галочка "выполнено" и блокировка не сохранялись между сессиями.

### blocks.js
- Баг-фикс (`432c002`): кнопки A+/A− вызывали `State.update()` → `emit()` → полный `render()` всех блоков → визуальное дёрганье. Заменено на `State.updateLive()` + прямое обновление `ta.style.fontSize`.

## Следующий шаг
1. Браузерское тестирование `gist-sync.js`:
   - Push/Pull/Restore параллельно → sync lock блокирует вторую операцию
   - Push во время активного push → dirty остаётся true
   - Pull → State.load() упадёт → dirty НЕ очищается (markPulledSynced не вызван)
   - AES-GCM без пароля → push блокируется с ошибкой
   - Quota ошибка localStorage → push не падает
2. Браузерское тестирование `text-expander.js`:
   - Глобальный trigger: смена `ё` → `/` работает
   - Дефолтный trigger: `ёзаме `, `Ёзаме `, `` `заме `` работают
   - Dropdown: `ёза` → открытие, Enter → вставка + пробел
   - Multi-char trigger: `;;заме ` → работает (selectionchange корректен)
   - Панель: `[ё] [shortcut] [General ▼] [Add Key]`
   - Shortener modes: word/acronym/glue иконки работают, digits toggle
   - Word mode: `Замечание: мне не написали` → `заме`
   - Acronym mode: `Нужно доработать интерфейс` → `нди`
   - Glue mode (autoLength=8): `Нужно доработать интерфейс` → `нужнодор`
   - Digits on: `заме` → `заме1`, если занято → `заме2`
   - Токены: `{{title}}`, `{{datetime}}`, `{{cursor}}`, `{{blockIndex}}`
   - `{{cursor}}` устанавливает позицию курсора (до dispatchEvent)
   - Long press → панель, Escape → закрыта
   - Clipboard expansion → pending state
   - Gist sync: serialize/load совместим со старыми данными
3. Браузерское тестирование `user-memory.js`:
   - Импорт повреждённого профиля → нормализация
   - `importData()` с некорректным объектом → try/catch
   - `getProfile()` → deepClone, не mutable reference
4. Браузерское тестирование `smart-suggestions.js`:
   - Escape → закрывает только верхний modal
   - Retention inputs → валидация границ
   - Strip при отсутствии `#preview-bar` → fallback в body
5. Браузерское тестирование `prompt-loom.js`:
   - Copy/paste в [data-private] поле → НЕ записывается в историю
   - Вставка из палитры в [data-no-loom] → fallback в clipboard
   - При закрытой панели record() → НЕ перерисовывает 500 карточек
   - OAuth Device Flow → clipboard с user_code
   - Ctrl+S → immediate push в Gist
6. Браузерское тестирование `memory-sync.js`:
    - Auto-push → не чаще 1 раза в 3ч
    - Rate limit → пауза + восстановление
    - Pull → importData → sync status обновляется
    - Wrap hooks → UserMemory.save() триггерит schedulePush
    - Pull → localBudget error → warn toast (не error)
    - Rate limit во время pull → dirty НЕ ставится
    - AbortError → requestCount откатывается
    - Auto-pull таймер → через 24ч pull запускается автоматически
    - Pull с неверным schemaVersion → ошибка, не импорт
    - Pull с truncated файлом → ошибка, не импорт
    - Pull > 1.5MB → ошибка, не импорт
    - Зависший fetch → abort через 15с (request() async + finally)
7. Браузерское тестирование `quality-detectors.js`:
    - analyzePreview → blocks кешируются (1 walk вместо 5)
    - findDuplicates → tokenSet предвычислен, нормализация не повторяется
    - similarityScore от PromptLoom → non-number не крашит
    - getTextBlocks с циклическими данными → depth limit, не stack overflow
    - estimateStructure → текст собирается инкрементально
8. Браузерское тестирование `mindmap.js`:
    - LLM JSON с невалидными полями → _normalizeData не падает
    - nodeMap с ключом "toString" / "constructor" → Map, нет конфликта
    - open() при пустом preview → toast, overlay НЕ открывается
    - open() при _loading → overlay + "Анализирую..."
    - close() во время inertia → RAF останавливается
    - close() → _requestSeq++ инвалидирует fetch
    - Spinner race condition: быстрый refresh → spinner НЕ снимается старым запросом
    - Shift+click по слову → jump-to-word с курсором
    - Graph: клик по ноде → jump-to-word
    - Hierarchy глубиной 10 → обрезается до 5
    - Graph links → nodeMap.get() работает, линии рисуются
    - Graph links "Безопасность" vs "безопасность" → graphKey совпадает
    - Клик по слову → exact: true/false в CustomEvent
    - _drawWords: слово 80 символов при маленьком canvas → fontSize scale
    - Timeline: 6 шагов → карточки одинаковой высоты, стрелки в центре gap
    - Timeline: 15 шагов → max 8 шагов, помещается в canvas
    - Graph dedup: "API" + "api" + " API " → один узел
    - _wrapTextLines: длинный токен без пробелов → дробится на части
    - Word cloud: слово из текста 10 раз → больше, чем LLM-тема с weight 8
    - Wheel zoom / drag pan → работают (setupSvgListeners вызван)
    - ResizeObserver: resize canvas → re-render; status text change → НЕ re-render
    - Смена текста Preview → _data сбрасывается, строится новое облако
    - Pan/zoom во время _loading → работает (не блокируется)
    - Word cloud: LLM-тема не в тексте → маленькое + stroke outline
