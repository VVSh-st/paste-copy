# HANDOFF — Paste/Copy

## Текущий статус

### Аудиты MiniMax-M3 (задания 6-11)

Обработаны аудиты 6 файлов. Применены безопасные фиксы, опасные/ложные пропущены.

| Файл | Аудит | Что починено |
|------|-------|-------------|
| **app.js** | #6 | Хоткеи в полях ввода: `Ctrl+Z/Y/T/W` теперь пропускаются при фокусе в `<input>`/`<textarea>` (нативный text-undo работает, вкладки не закрываются случайно) |
| **blocks.js** | #7 | Копирование таблицы: `% 5` → `State.SUBTABS_COUNT` (20 вместо 5) |
| **ui.js** | #8 | `_dragTabId` перенесена из `render()` в IIFE-scope (drag не теряется при re-render); `hadFocus` исключает `tab-rename-input` (фокус сохраняется при rename) |
| **state.js** | #9 | `fontSize` в `migrate()`: `12` → `13.5` (синхронизация с `makeBlock`) |
| **index.html** | #10 | Без изменений (все находки minor/questions) |
| **timer.js** | #11 | `_ensurePaths()` → `false` при zero-size кнопке; `_playCompletionSound()` → добавлен `ctx.resume()` для AudioContext |

### Пасхалка таймера (easter egg)

**Исправлено:** `_playCompletionSound()` не играл звук — `AudioContext` запускался в `suspended`-состоянии без `ctx.resume()`. Теперь после 3-минутного pulse звук играет корректно.

### Save-to-txt задержка (2-4 сек)

**Исправлено:** Клик «Сохранить в .txt» блокировался `ta.onblur` → `State.snapshot()` (синхронный `JSON.stringify` всего состояния). Теперь `ta.onblur` временно снимается перед скачиванием и восстанавливается через 1 сек.

### Системные промпты — редизайн вкладки (#ltab-prompts)

**Спека:** `Системные промпты.txt` + `Задание_промпты.md`

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
| **blocks.js** | Table copy `SUBTABS_COUNT`, save-to-txt blur fix |
| **app.js** | Hotkey guard for input fields |
| **ui.js** | `_dragTabId` scope, rename focus preservation |
| **state.js** | fontSize migrate default |
| **timer.js** | `_ensurePaths` zero-size guard, AudioContext resume |

### Изменённые файлы (сессия)

| Файл | Изменения |
|------|-----------|
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
| `app.js` | Hotkey `!inField` guard for Z/Y/T/W |
| `ui.js` | `_dragTabId` IIFE scope, `hadFocus` rename exclusion |
| `state.js` | fontSize 12→13.5 in migrate |
| `timer.js` | `_ensurePaths` zero-size, AudioContext resume |
| `blocks.js` | Table copy SUBTABS_COUNT, save-to-txt blur skip |

## Как работает
- **KeyboardTrainer**: singleton-панель → toggle → keydown → flash + auto RU/EN → drag/resize → настройки → ghost/slim/on-screen/problem/focus/mouse-through → зоны пальцев → shifted → цвет → прозрачность → stay visible → экстранный режим
- **Timer easter egg**: клик → count up 0..99 → 3-мин pulse → звук → auto-countdown 99..0

## Следующий шаг
1. Проверить вкладку «Системные промпты» в браузере
2. Проверить клавиатуру в браузере
3. Проверить «Сохранить в .txt» — задержка должна исчезнуть
4. Проверить таймер easter egg — звук должен играть
5. Next-key hint, статистика ошибок
