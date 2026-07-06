# HANDOFF — Paste/Copy Project

## Модули

### text-expander.js
- **~1550 строк**, 9 раундов аудита, **100 фиксов**. Коммит `12df6f0`.
- Основные: RU/EN trigger, space trigger без dropdown, async clipboard safety, dropdown session guard, save rollback, long press fixes, rAF race protection.
- Аудит #9: дефолт Ё→пусто, Escape щадит форму, case transform ≤120, `_doInsert` проверяет `_activeTa`, `_save()` кеш payload, `_showAddShortcutError()` хелпер.
- Статус: код стабилен, ожидает браузерного тестирования.

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
- **~2350 строк**, промпт-задание для аудитора создано (`prompt-loom-audit-prompt.md`).
- Ожидает результатов аудита.
- Ключевые зоны: XSS через innerHTML (6 мест), clipboard patching, execCommand deprecated, similarity performance, CSS injection ~200 строк.

### ember.js
- **Патч от аудитора (Ответ 2.txt)**. Коммит `46b9d51`.
- Egg localStorage fallback: `catch` фиксирует `eggTriggeredDay` в памяти при переполнении квоты.
- Anomaly spark: +150px дальность (100→400), шире угол (0.45π→1.0π), +20% частота (0.32→0.384), longer dur (1900ms), выше trail chance.

## Следующий шаг
1. Применить результаты аудита `prompt-loom.js`
2. Браузерное тестирование `text-expander.js`:
   - `Ёabc` + пробел → expansion БЕЗ открытого dropdown
   - Ё + query + Enter → вставка через dropdown
   - Long press → панель, Escape → закрыта
   - Clipboard expansion → pending state, однократная вставка
3. Браузерное тестирование `user-memory.js`:
   - Импорт повреждённого профиля → нормализация
   - `importData()` с некорректным объектом → try/catch
   - `getProfile()` → deepClone, не mutable reference
4. Браузерное тестирование `smart-suggestions.js`:
   - Escape → закрывает только верхний modal
   - Retention inputs → валидация границ
   - Strip при отсутствии `#preview-bar` → fallback в body
