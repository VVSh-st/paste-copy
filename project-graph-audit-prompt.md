# Промпт-задание: Аудит project-graph.js

## Файл под аудит

- **Имя файла:** `project-graph.js`, примерно 1496 строк
- **Назначение:** Локальная карта проекта для Intelligence Layer — хранит и управляет снапшотами промптов (структура блоков, хеши, мета), отношениями между блоками (oftenWith, derivedFrom), baselines, и вычисляет структурное/ролевое сходство между версиями. IIFE, всё приватное, публичный API через `window.ProjectGraph`.
- **Публичный API:** `STORAGE_KEY`, `captureSnapshot`, `findSimilarPrompt`, `getFrequentCompanions`, `captureNamedVersion`, `captureBaselineFromCurrent`, `getNamedVersions`, `getNamedVersionById`, `getPinnedBaseline`, `pinBaseline`, `unpinBaseline`, `comparePinnedBaselineToCurrent`, `compareNamedVersions`, `compareNamedVersionToCurrent`, `findNamedVersionDrift`, `getRetention`, `setRetention`, `cleanup`, `findOftenWith`, `findDerivedFrom`, `findVersionTimeline`, `findRoleGaps`, `buildSnapshotDiff`, `normalizeTitle`, `titleRole`, `roleLabel`, `roleOrderIndex`, `getBlockNode`, `getDiagnostics`, `exportData`, `importData`, `reset`, `save`
- **Зависимости:** `window.State` (getActive — текущий таб), `window.Preview` (getText — текущий текст), `window.PromptLoom` (classify — классификация блоков), `window.QualityDetectors` (estimateTokens), `window.Intelligence` (hashText), `localStorage` (напрямую через `localStorage.getItem/setItem`, НЕ через `Storage._set/_get`)
- **Кто вызывает:** `intelligence-core.js` — основной потребитель (findSimilarPrompt, findOftenWith, findDerivedFrom, findVersionTimeline, findNamedVersionDrift, comparePinnedBaselineToCurrent, findRoleGaps, captureSnapshot), `smart-suggestions.js` — UI для управления (getDiagnostics, getRetention, setRetention, cleanup, reset)

---

## Чек-лист известных классов багов этого проекта

### Совпадающие/дублирующие обработчики одного взаимодействия
- Не применимо — модуль не имеет UI-обработчиков, чистый data/analysis слой.

### Устаревшие данные при асинхронных операциях
- Модуль синхронный, async-операций нет. Все вызовы (`captureSnapshot`, `findSimilarPrompt`, и т.д.) блокирующие. Опасности устаревших данных нет.

### Regex и Юникод
- `normalizeTitle()` (строка 268): `replace(/\s+/g, ' ')` — безопасно, не использует `\b`.
- `titleMatchesAlias()` (строка 271-278): `replace(/[«»"'`.,:;!?()[\]{}]/g, ' ')` — безопасно, не использует `\b`.
- **Вопрос:** есть ли `\b` где-либо? Нет, регулярки простые и работают с кириллицей корректно.

### CSS/DOM видимость
- Не применимо — модуль не оперирует DOM.

### Дублирование логики (DRY)
- **Дублирование `protectedSnapshotIds` / `protectedBlockHashes` / `protectedTextHashes`:** в `trimGraph()` (строки 497-508) и `pruneOldSnapshots()` (строки 463-466) — `getPinnedSnapshotIds()` вызывается дважды в `trimGraph()` (один раз для `protectedSnapshotIds`, другой раз внутри `pruneOldSnapshots` через `trimSnapshotsByLimit`). Не баг, но повторная работа.
- **Дублирование `structureSimilarity` + `roleSimilarity` + `similarityFromSets`:** вызываются из `findRoleGaps()` (строка 993-996) — `roleSimilarity(current, snapshot)` и `structureSimilarity(current, snapshot)` вычисляются для каждого кандидата, но `structureSimilarity` уже вызывает `roleSimilarity` внутри себя (строка 708). Это **двойная работа** — `roleSimilarity` вычисляется дважды для каждого кандидата в `findRoleGaps`.
- **`diffArrays()` и `buildSnapshotDiff()`:** `diffArrays` вызывается 3 раза в `buildSnapshotDiff` для title/role/hash — нет дублирования, нормально.
- **Дублирование `makeCurrentSnapshot` vs `captureSnapshot` (makeBlockFingerprint + makeStructureSignature + makeRoleSignature):** обе функции собирают одинаковые данные о текущем табе. `makeCurrentSnapshot` (строка 1279) — виртуальный снапшот без сохранения, `captureSnapshot` — с сохранением. Схожая логика, но сознательно разделена (read-only vs write). Минорно.

### Асимметрия между похожими ветками кода
- **`comparePinnedBaselineToCurrent` vs `compareNamedVersionToCurrent`:** почти идентичны, но `comparePinnedBaselineToCurrent` (строка 1264) ищет baseline → передаёт в `compareNamedVersionToCurrent`. Корректно, нет асимметрии.

### Скоуп и незапрошенные добавления
- Нет ТЗ приложено — модуль существовал до меня, оцениваю как есть.

### Данные (таблицы/константы), а не только логики
- **`TITLE_ROLE_ALIASES` (строки 28-39):** маппинг ролей на алиасы. Ключи: `role`, `context`, `task`, `requirements`, `format`, `examples`, `code`, `notes`, `improvements`, `snippets`. Алиасы — массивы строк на EN и RU. Проверено — дубликатов нет, все ключи уникальны.
- **`ROLE_ORDER` (строки 54-65):** массив из 10 элементов, совпадает с ключами `ROLE_LABELS` и `TITLE_ROLE_ALIASES`. Проверено — нет пропущенных/лишних.
- **`ROLE_LABELS` (строки 41-52):** 10 ключей, совпадают с `ROLE_ORDER`. Проверено.
- **Магические числа:** `0.72` (SIMILAR_STRUCTURE_THRESHOLD), `0.48`, `0.34`, `0.18`, `0.82`, `0.94` (в `structureSimilarity`), `0.86` (в `similarityFromSets`), `0.58` (пороги confidence в нескольких местах), `0.045`, `0.035` — веса в формулах confidence. Все "подобранные эмпирически". Не баг, но при будущей настройке — источник ошибок.

### Производительность в горячих путях
- **`captureSnapshot()` (строка 557):** O(N²) для построения пар `oftenWith` (вложенные циклы строка 611-624). Ограничен `pairLimit = max(80, min(1200, maxRelations * 2))`. При 240 блоках — до 1200 итераций. Это **дорого**, но occurs при каждом снапшоте (каждые ≥20 сек cooldown). Допустимо.
- **`structureSimilarity()` (строка 685):** `similarityFromSets` × 3 + арифметика. Вызывается из `findSimilarPrompt`, `findOftenWith`, `findDerivedFrom`, `findVersionTimeline`, `findRoleGaps`, `compareSnapshots`. В `findRoleGaps` вызывается для каждого кандидата (до ~N снапшотов). Ограничен `pairLimit` в `captureSnapshot`, но в `findRoleGaps` — полный перебор. При 80 снапшотах — 80 вызовов `structureSimilarity`, каждый ~O(M) где M = количество блоков. **Нормально** для 80 снапшотов × 20 блоков.
- **`_simCache` (Map):** кэш результатов `structureSimilarity`. Ограничен 1000 записями (строка 717). Очищается при `captureSnapshot`, `setRetention`, `cleanup`, `reset`. Корректно.
- **`saveSoon()` (строка 230):** debounce 500ms. Корректно.
- **`saveNow()` (строка 235):** `JSON.stringify(graph)` — может быть дорого при больших графах (80 снапшотов × ~1KB = ~80KB). Один раз за 500ms debounce. Нормально.
- **Напрямую `localStorage.getItem/setItem` (строки 142, 241, 1448):** не через `Storage._set/_get`. Если `Storage` добавит compression или quota management — project-graph не получит его автоматически. **Отдельная находка**: модуль игнорирует общий Storage-слой проекта.

### Очистка ресурсов
- `saveTimer` (setTimeout): очищается в `saveNow()` и `saveSoon()`. Корректно.
- `_simCache` (Map): очищается при `captureSnapshot`, `setRetention`, `cleanup`, `reset`. При превышении 1000 — `clear()` (строка 717). Корректно.
- Нет RAF, нет MutationObserver, нет таймеров кроме `saveTimer`. Чисто.
- `saveNow` retry при ошибке (строка 246): `setTimeout(saveNow, 5000)` — но если ошибка повторяется, будет бесконечный retry с интервалом 5с. Не критично (QuotaExceededError не ретраится), но при других ошибках — потенциальный infinite retry. **Минорно**.

---

## Формат ответа

Для каждого найденного вопроса/проблемы укажи:
- Номер строки (approx)
- Категория: критично / важно / минорно / вопрос
- Описание проблемы
- Предложение по исправлению (если применимо)

Не предлагай исправления для мелочей — просто пометь как "вопрос". Сфокусируйся на критичных и важных проблемах.

## Ограничения

- Файл: `E:\CODE\Paste_copy\project-graph.js`
- Это IIFE, всё приватное, публичный API через `window.ProjectGraph`
- Зависимости: `window.State`, `window.Preview`, `window.PromptLoom`, `window.QualityDetectors`, `window.Intelligence`, `localStorage` (напрямую)
- Модуль НЕ использует `Storage._set/_get` — пишет в `localStorage` напрямую
- Потребители: `intelligence-core.js` (основной), `smart-suggestions.js` (UI)
