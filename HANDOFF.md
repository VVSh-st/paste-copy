# HANDOFF — Paste/Copy

## Текущий статус

### Аудиты MiniMax-M3 (задания 6-12)

Обработаны аудиты 7 файлов. Применены безопасные фиксы, опасные/ложные пропущены.

| Файл | Аудит | Что починено |
|------|-------|-------------|
| **app.js** | #6 | Хоткеи в полях ввода: `Ctrl+Z/Y/T/W` пропускаются при `inField` (нативный undo работает, вкладки не закрываются случайно) |
| **blocks.js** | #7 | Копирование таблицы: `% 5` → `State.SUBTABS_COUNT` |
| **ui.js** | #8 | `_dragTabId` перенесена в IIFE-scope; `hadFocus` исключает `tab-rename-input` |
| **state.js** | #9 | `fontSize` в `migrate()`: `12` → `13.5` |
| **timer.js** | #11 | `_ensurePaths()` zero-size guard; `_playCompletionSound()` → `ctx.resume()` |
| **intelligence-core.js** | #12 | 5 фиксов (см. ниже) |

### Аудит intelligence-core.js (задание 12) — 5 фиксов

| # | Категория | Что исправлено |
|---|-----------|---------------|
| **#1/#2** | важно | Устаревшая подсказка (вкладка/текст изменился) удаляется из `lastSuggestions`/`lastMenuSuggestions` после `refresh()` — пользователь не видит её повторно |
| **#4** | важно | `hasMeaningfulDiff` — diff выбирается по типу suggestion (`pinned-baseline-compare` → `pinnedBaselineDrift`, `named-version-compare` → `namedVersionDrift`), а не первый попавшийся |
| **#5** | минорно | Ключи дедупа в `prepareSuggestions` теперь включают `prev.id` как fallback |
| **#7** | минорно | `computeFinality` — добавлен `Number.isFinite(score)` guard |
| **#8** | важно | `refresh()` — `lastRefreshSnapshotKey` обновляется только при успешном `captureSnapshot` |

**Пропущено:** #3 (blockCount>=2 — продуктовое решение), #6 (parsePlacementChoice — не требуется), #9 (Map-итерация — ES2015+ безопасно), #10 (version-timeline строка — уже защищена `skipped > 0`), #11 (escapeHtml — внутренний код), #12 (prompt() — низкий приоритет).

### Пасхалка таймера (easter egg)

`_playCompletionSound()` → добавлен `ctx.resume()` для AudioContext.

### Save-to-txt задержка (2-4 сек)

`ta.onblur` временно снимается перед скачиванием и восстанавливается через 1 сек.

### Системные промпты — редизайн вкладки (#ltab-prompts)

**Спека:** `Задание_промпты.md`

**Изменения:**
- **CSS**: единый accent цвет, статус-бейджи, дропдаун меню, компактные строки, anti-jump
- **HTML**: новая шапка, дропдаун `⋮`, иконки
- **JS**: `_selectPromptKey` единая точка видимости, удалён `_showStoragePanel`/`_hideStoragePanel`

### Аудиторские фиксы модулей

| Модуль | Что починено |
|--------|-------------|
| **user-memory.js** | Белый список в `normalizeProfile`, сброс `shown`/`score`, `Object.create(null)` |
| **spell-check.js** | CRLF нормализация, `maskPlaceholders` offset, `AbortError` guard, per-chunk timeout |
| **quality-detectors.js** | `matchAll`, DRY similarity, именованные константы |
| **word-complete.js** | Gist dirty flush, double-build fix, scroll listener leak |
| **ai-transform.js** | AbortError UI unlock, empty `_origText` guard |
| **translator.js** | `restoreTemplates` backreference fix, `stats.totalChars` once |
| **keyboard-trainer.js** | Clamp viewport, pointer guard, settings fix, drag fix, focus management |
| **ninja-cursor.js** | Аудиторские фиксы |

### Изменённые файлы (сессия)

| Файл | Изменения |
|------|-----------|
| `intelligence-core.js` | Стale suggestion removal, hasMeaningfulDiff cross-type, snapshot key poisoning, NaN guard, dedup key |
| `styles.css` | Редизайн промптов: anti-jump, статус-бейджи, дропдаун |
| `index.html` | Структура `#ltab-prompts`: шапка, дропдаун, иконки |
| `llm-core.js` | `_selectPromptKey` единая точка видимости, дропдаун `⋮` |
| `user-memory.js` | Белый список, сброс shown/score, Object.create(null) |
| `spell-check.js` | CRLF, maskPlaceholders, AbortError, per-chunk timeout |
| `quality-detectors.js` | matchAll, DRY, константы |
| `word-complete.js` | Gist dirty, double-build, scroll leak |
| `ai-transform.js` | AbortError unlock, _origText guard |
| `translator.js` | backreference fix, totalChars once |
| `keyboard-trainer.js` | Clamp, pointer guard, settings, drag, focus |
| `ninja-cursor.js` | Аудиторские фиксы |
| `app.js` | Hotkey `!inField` guard for Z/Y/T/W |
| `ui.js` | `_dragTabId` IIFE scope, `hadFocus` rename exclusion |
| `state.js` | fontSize 12→13.5 in migrate |
| `timer.js` | `_ensurePaths` zero-size, AudioContext resume |
| `blocks.js` | Table copy SUBTABS_COUNT, save-to-txt blur skip |
| `text-expander.js` | Мелкие аудиторские фиксы |

## Как работает
- **KeyboardTrainer**: singleton-панель → toggle → keydown → flash + auto RU/EN → drag/resize → настройки → ghost/slim/on-screen/problem/focus/mouse-through → зоны пальцев → shifted → цвет → прозрачность → stay visible → экстранный режим
- **Timer easter egg**: клик → count up 0..99 → 3-мин pulse → звук → auto-countdown 99..0
- **Intelligence**: `intelligence-core.js` = events + context snapshot + scoring + prediction → `smart-suggestions.js` = UI strip + menu

## Следующий шаг
1. Проверить вкладку «Системные промпты» в браузере
2. Проверить клавиатуру в браузере
3. Проверить «Сохранить в .txt» — задержка должна исчезнуть
4. Проверить таймер easter egg — звук должен играть
5. Next-key hint, статистика ошибок
