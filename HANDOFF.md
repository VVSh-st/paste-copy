# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты *.jpg и *.txt не сохраняй).

Skill: `E:\CODE\Paste_copy\Skill`. MCP инструменты — при необходимости.

Отвечай по-русски.

**Сленг пользователя:**
- **пики** = задачи
- **тултип** = dropdown / popup
- **колонка** = column
- **ресайзер** = resizer
- **дропдаун** = dropdown
- **блок** = block (элемент UI)

## Status — ТЕКУЩАЯ СЕССИЯ (2026-06-30)

### Новый модуль: Словари и справочники

1. ✅ **dictionaries.js** — новый модуль с тезаурусом (Datamuse API), проверкой грамматики (LanguageTool API) и определением языка.
2. ✅ **Тезаурус синонимов** — Alt+D или кнопка в тулбаре. Бесплатный API, не требует ключа. Показывает синонимы и ассоциации, клик заменяет слово.
3. ✅ **Проверка грамматики** — Ctrl+Shift+G или кнопка в тулбаре. LanguageTool API, подсветка ошибок с предложениями исправлений.
4. ✅ **Определение языка** — автоматическое определение языка текста, индикатор в статус-баре.
5. ✅ **CSS стили** — добавлены в ember-styles.css для popup словаря и маркеров ошибок.
6. ✅ **Горячие клавиши** — Alt+D (тезаурус), Ctrl+Shift+G (грамматика), Escape (закрытие popup).

### Аудит от Big Brother — исправлено

1. ✅ **Unicode word boundary** — `\b` не работает с кириллицей. Замена на lookaround `(?<![\p{L}\p{N}_])${pattern}(?![\p{L}\p{N}_])` + флаг `u`. 3 места: `state.js:755` (makeSearchRe), `ui.js:1124` (makeRe), `ui.js:1240` (renderResults). Коммит `909e034`.

2. ✅ **Дедупка сниппетов** — `getAllSnippetsAndCommands()` в `state.js:885-907`: локальные сниппеты/команды проходят через `normalizeSnippetValue()` перед `seen.has/seen.add`. Коммит `909e034`.

3. ✅ **Orphan hover effects** — RAF-циклы и тултипы переживающие re-render. Единый реестр `_pendingHoverEffects` (Set), `cleanupHoverEffects()` вызывается в `_doRender()` перед `cleanupObservers()`. Три паттерна зарегистрированы: marquee заголовка (`_cleanupMq`), тултип саб-вкладки (`_cleanupTip`), тултип груминга (`_cleanupGroomTip`). Коммит `67335b8`.

4. ✅ **DnD асимметрия** — комментарий в `blocks.js:2807` объясняющий为什么 compact-блоки вставляются после (splice +1), non-compact — перед (splice idx). Коммит `67335b8`.

### Откаты (не применять)

- **Автопрокрутка textarea с scroll margin** — 12 коммитов, все откачены (`56f4102`). Причина: textarea расширяется под контент → scrollHeight === clientHeight → скролл невозможен. Динамическая высота ломает UX. Откладывается на потом.

- **Ghost/авто-завершение — правила скрытия** — 7 коммитов, все откачены (`bc96f89`). Пользователь откатил. Причина: правила (afterChar, selectionchange, space-before-cursor) восприняты как плохие. Фича откладывается.

## Ключевые файлы

- `state.js` (~934 строки) — makeSearchRe, getAllSnippetsAndCommands, DEFAULT_LAYOUT
- `ui.js` (~2023 строки) — makeRe, renderResults
- `blocks.js` (~2999 строки) — _pendingHoverEffects, cleanupHoverEffects, _doRender, createHeader, createSubtabNav, groomMenu, DnD
- `llm-features.js` (~4231 строки) — AutoPoet, _runGroomInChat, SmartPlaceholders
- `llm-core.js` (~1885 строки) — request(), _extractContent, cache
- `word-complete.js` (~1212 строки) — InlineHint, WordComplete
- `dictionaries.js` (~350 строки) — Thesaurus (Datamuse), Grammar (LanguageTool), LangDetect

## Decisions

- **Lookaround вместо \b** — `\b` не понимает Unicode-буквы. Lookaround нулевой ширины, не ломает `lastIndex`
- **_pendingHoverEffects** — аналог observerMap для ResizeObserver. Единый реестр вместо трёх точечных патчей
- **DnD комментарий** — асимметрия compact/non-compact осознанная (flushCompact группирует compact в строку)

## Git (этап)

```
bc96f89 revert: откат всех доработок ghost/авто-завершения (7 коммитов)
56f4102 revert: откат автопрокрутки textarea с scroll margin (12 коммитов)
67335b8 fix: orphan hover effects — единый реестр _pendingHoverEffects
909e034 fix: Unicode word boundary + нормализация дедупки сниппетов
```

## Next Step

Ждать нового задания от пользователя. Текущий код чист, все эксперименты откачены.
