# HANDOFF — Paste/Copy

## Текущий статус

### В работе

**Баг: dropdown TextExpander моргает после ввода триггера ё**
- Симптом: меню появляется и сразу пропадает
- Расследование: прочитаны `text-expander.js`, `blocks.js`, `prompt-loom.js`
- Подозрение: race condition между `input` → `_showDropdown` и `selectionchange` → `_hideDropdown`
- Следующий шаг: проверить `WordComplete.handleInput(ta)` — вызывается до `TextExpander.handleInput`, может модифицировать textarea и вызвать `selectionchange`, который закроет dropdown

**Аудит text-linter.js** — 3 раунда, MiniMax M3
- Раунд 1 (`Ответ (17).txt`): 0 critical, 0 high, 3 medium, 6 low
  - `[medium] collectHintsFromLine infinite loop` — zero-length match guard
  - `[medium] hasTemplatePlaceholderAtEdge dead code` — удалена
  - `[medium] closeGear listener leak` — `closeGearFn` cleanup
  - `[low] getBlockSelector fallback` — экранирование `]`/`)`
  - `[low] renderHints data-line` — `escapeHtml(String(hint.line))`
  - `[low] expandReplacement docs` — комментарий токенов
  - `[low] panel.innerHTML` — SECURITY-комментарий
  - `[low] removeInvisibleChars hint` — soft hyphen \\u00AD
  - `[low] normalizeNbsp hint` — односложные союзы
- Раунд 2 (`Ответ 2 (1).txt`): 1 high + 1 low → `collapseBlankLines` добавлен второй проход `/\n{3,}/g`
- Раунд 3 (`Ответ 2 (2).txt`): 1 high + 1 low
  - `[high] renderInlineDiff empty run collapse` — пустые ops (≥3) сворачиваются в `diff-run-summary` с числом строк
  - `[low] stats.blanks` — считает оба прохода collapseBlankLines
  - Добавлен CSS: `.diff-run-summary`, `.diff-run-count`

**Аудит text-skeletonizer.js** (ожидание ответа аудитора)
- Промпт: `аудит text-skeletonizer.txt` (MiniMax M3)
- 508 строк, IIFE: извлечение структуры текста, лемматизация, Web Worker, кэш

### Завершено в этой сессии

**Diff noise collapse** — сворачивание пустых строк в diff (Локальная причёска)
- Задание: вместо N красных `↵` показывать один `↵ …N строк…`
- Корень: `llm-features.js` (LLMFeatures.DiffEngine) — отдельный от `diff-engine.js` движок
- Проблема: `compute()` выдавал один `del` op с 8 newlines, а `groupSize >= 3` его пропускал (groupSize=1)
- Фикс: `_collapseWhitespaceRuns(ops)` — `totalNewlines >= 3` вместо `groupSize >= 3`
- Рендер: `_renderClassicOp`/`_renderMatrixOp` — при `_collapsed` рендерят `↵ …N строк…`
- CSS: `.diff-run-summary`/`.diff-run-count` в `styles.css` (snap-diff) и `text-linter.js` (shadow DOM)

1. **Аудит ninja-cursor.js** — 3 раунда, коммит `691740c` + новые фиксы
   - Раунд 1 (MiniMax M3, `Ответ (8).txt`): 9 фиксов — `isConnected`, `whiteSpace`, `NBSP`, `--nc-offset-y`, `click` event, `MAX_SCROLL_FRAMES`, deferred resync, `_scrollMode`, `aria-hidden`
   - Раунд 2 (MiniMax M3, `Ответ (15).txt`): 3 high + 6 medium + 3 low → applied: `_onInput` race (`_needResync` для edit events), `_disposed` flag + rAF guard, `_runTick` DRY helper, `_hide` сброс `_lastPos`
   - Раунд 3 (MiniMax M3, `Ответ (16).txt`): 1 high + 2 medium + 2 low → applied: `_disposed` guard в `_tick` (до/после rAF) и `_animate` rAF-callback

2. **Аудит diff-engine.js** — 5 раундов, Codex GPT-5
   - Раунд 1 (`Ответ (9).txt`): 1 critical + 3 high + 5 medium + 4 low → все applied
   - Раунд 2 (`Ответ (10).txt`): 1 critical + 2 high + 4 medium + 4 low → applied: depth guard, empty tokens, escHtml, normalize fix
   - Раунд 3 (`Ответ (11).txt`): 0 critical + 2 high + 3 medium + 3 low → applied: NaN depth, splitLinesPreserveBreaks self-contained, extractTextFromSnapshot typeof checks
   - Раунд 4 (`Ответ (12).txt`): 2 high + 3 medium + 4 low → applied: computeDiff CRLF normalization, WeakSet cyclic refs, renderInlineDiff O(n²), escHtml control chars
   - Раунд 5 (`Ответ (14).txt`): 1 high + 2 medium + 2 low → applied: `_lineDiff` unified, whitespace collapse, eq-merge across `\n`

3. **TextExpander: useCount, smart candidates, dropdown** (коммит `574f1da`)
   - `useCount`/`lastUsedAt` в shortcut: `_normalizeShortcut`, `_addShortcut`, `createFromSelection`
   - Инкремент при успешной вставке (sync + async)
   - Smart candidates: `_getWordCandidates`, `_getAcronymCandidates`, `_getGlueCandidates`
   - `generateSmartShortName`: перебор альтернатив в режиме, fallback на цифры
   - Ranking в dropdown: exact → starts (length ↑) → includes (position ↑), useCount tiebreak
   - Dropdown: `VISIBLE=6`, `ROW_HEIGHT=28`, preview=25 символов, `scrollbar-width: thin`
   - Mouse wheel навигация по пунктам dropdown
   - Category в таблице: `max-width: 110px` + truncate

### Изменённые файлы
| Файл | Что изменено |
|------|-------------|
| `ninja-cursor.js` | 9 аудит-фиксов (critical/high/medium/low) |
| `diff-engine.js` | 11 аудит-фиксов + renderInlineDiff empty run collapse |
| `llm-features.js` | `_collapseWhitespaceRuns` + `_renderClassicOp`/`_renderMatrixOp` collapsed handling |
| `text-linter.js` | 10 аудит-фиксов + collapseBlankLines fix + CSS |
| `text-expander.js` | useCount, smart candidates, dropdown ranking, wheel nav, 6 rows |
| `styles.css` | `.te-table-category` max-width, `.te-dd-item` height 28px, `.text-expander-dropdown` scrollbar-width: thin, `.snap-diff-body .diff-run-summary/.diff-run-count` |

### Аудиторские файлы (не коммитятся)
| Файл | Содержание |
|------|------------|
| `Ответ (8).txt` | Аудит ninja-cursor.js v1 (MiniMax M3) |
| `Ответ (10).txt` | Аудит diff-engine.js v1 (Codex GPT-5) |
| `Ответ (11).txt` | Аудит diff-engine.js v2 (Codex GPT-5) |
| `Ответ (12).txt` | Аудит diff-engine.js v3 (Codex GPT-5) |
| `Ответ (13).txt` | Аудит diff-engine.js v4 (Codex GPT-5) |
| `Ответ (14).txt` | Аудит diff-engine.js v5 — final (Codex GPT-5) |
| `Ответ (15).txt` | Аудит ninja-cursor.js v2 (MiniMax M3) |
| `Ответ (16).txt` | Аудит ninja-cursor.js v3 — final (MiniMax M3) |
| `Ответ (17).txt` | Аудит text-linter.js v1 (MiniMax M3) |
| `Ответ 2 (1).txt` | Аудит text-linter.js v2 — collapseBlankLines (MiniMax M3) |
| `Ответ 2 (2).txt` | Аудит text-linter.js v3 — renderInlineDiff + stats (MiniMax M3) |
| `аудит diff-engine.txt` | Промпт для аудита diff-engine.js |
| `аудит text-linter.txt` | Промпт для аудита text-linter.js |
| `аудит text-skeletonizer.txt` | Промпт для аудита text-skeletonizer.js |

## Как работает
- **TextExpander**: trigger `ё` → dropdown с фильтрацией → вставка с обработкой регистра
- **useCount**: инкремент при каждой вставке, влияет на ranking в dropdown и панели
- **Smart candidates**: при автогенерации пробует слова/акроним/склейку по очереди, потом цифры
- **NinjaCursor**: декоративный курсор-шлейф, mirror-div для caret rect, анимация через CSS
- **DiffEngine (diff-engine.js)**: LCS по строкам (Int32Array), токенизация по словам (\b), fallback с рекурсивным построчным diff, нормализация CRLF. Используется в snap-diff overlay
- **DiffEngine (llm-features.js)**: отдельный движок внутри `LLMFeatures`, используется text-linter'ом и LLM-фичами. `_collapseWhitespaceRuns` сворачивает пустые строки (totalNewlines ≥ 3) в одну метку `↵ …N строк…`

## Следующий шаг
1. Разобраться с багом моргания dropdown (race condition `selectionchange`)
2. Рассмотреть паттерны prompt-loom.js для навигации (wrap-around, wheel)
