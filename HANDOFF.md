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

### Новый модуль: Offline-тезаурус (dictionaries.js)

1. ✅ **dictionaries.js** — offline-тезаурус на Datamuse API (бесплатный, без ключа) + определение языка.
2. ✅ **Тезаурус** — Alt+D, работает как existing LLM-тезаурус: ← → цикл, Enter принять, Esc отмена. Показывает синонимы и ассоциации.
3. ✅ **Определение языка** — индикатор языка (RU/EN/DE/FR/ES/IT) в статус-баре, автоматическое определение.
4. ✅ **Кэш** — результаты кэшируются в localStorage (TTL 24ч, макс 500 записей).

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
- `dictionaries.js` (~200 строки) — offline-тезаурус (Datamuse), LangDetect

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
