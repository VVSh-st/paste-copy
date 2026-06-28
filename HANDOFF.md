# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.

Есть MCP инструменты, используй при необходимости.

Мне отвечай по-русски.

## Status — В РАБОТЕ

### Новые блоки: Sticky Note + TODO + Table + IndexedDB Backup

**Выполнено:**

1. ✅ **local-backup.js** — IndexedDB модуль для локальных копий (max 30, prune с учётом immortal)
2. ✅ **Sticky Note** — блок-заметка с 5 цветами (yellow/green/blue/pink/gray), SVG-иконка с перечёркнутым кружком (badge "не в превью"), color palette в заголовке, не попадает в превью
3. ✅ **TODO Checklist** — 5 подвкладок `<12345>`, чекбоксы с line-through, drag-reorder пунктов, счётчик done/total, badge `#N` (как text-блок)
4. ✅ **Table** — 5 подвкладок, сетка 1-4 (max 15) столбцов через `< >` стрелки, +/- строки, копирование на следующую подвкладку с переключением, badge `#N`
5. ✅ **IndexedDB в GistSync** — `LocalBackup.save()` после каждого push
6. ✅ **Вкладка «Локальные копии»** — max 3 видимых + scroll, кнопка ☠ (защита от вытеснения), ↺ восстановление (safety snapshot), ⬇ скачивание JSON, hover-тултипы
7. ✅ **Compact layout** — consecutive sticky/todo/table оборачиваются в `.blocks-row` flex-контейнер, drag-and-drop ставит их рядом
8. ✅ **Structure menu** — todo/table входят в структуру превью, скрываются при previewDisabled
9. ✅ **buildOrderMap** — todo/table участвуют в нумерации `#N` для превью

**Активные файлы:**

- `local-backup.js` (~90 строк): IndexedDB модуль, toggleImmortal, prune с immortal
- `blocks.js` (~2800 строк): renderStickyBody, renderTodoBody, renderTableBody, createTodoSubtabNav, createColsPicker, compact layout
- `ui.js` (~1860 строк): makeSticky, makeTodo, makeTable, Preview skip sticky, Structure menu
- `state.js` (~920 строк): makeBlock для sticky/todo/table, migrate с 5 подвкладками
- `gist-sync.js` (~1820 строк): LocalBackup.save после push, _loadBackups, _renderBackupsHTML, toggleImmortal
- `styles.css` (~5760 строк): .block-type-sticky, .block-type-todo, .block-type-table, .blocks-row, .backup-*
- `index.html` (~1820 строк): menu items для sticky/todo/table, script local-backup.js

### Уголёк (ember.js): Economy Mode + 3D Glow

**Выполнено:**

1. ✅ **Economy Mode** — двойной клик по Угольку переключает reduceMotion (ON/OFF), rAF skip 5/6, очистка частиц/segmentEffects при входе, toast уведомление
2. ✅ **3D Glow усиление** — mix-blend-mode: screen, увеличен inset/radius/blur,更强 box-shadow, повышен idle glow/brightness, glowFlicker 4-step
3. ✅ **Weighted geometry** — `_geomWeight = 0.35 + 0.65 * (mag / maxMag)`
4. ✅ **Пасхалка** — замах 150мс, полёт 350мс, заглатывание кольцом
5. ✅ **Предупреждающий импульс** — heatBoost 0.5 + 6 spark при падении сегментов

**Активные файлы:**

- `ember.js` (~3000 строк): Economy Mode toggle, weighted geometry, glow/ash/particle, egg rewrite, warning pulse
- `ember-styles.css` (~560 строк): 3D glow mix-blend-mode, emberDeform, ember-eco-toast

### Архив предыдущих сессий

**Anchor gutter background highlight bug** — `Blocks.render()` + `Anchors._renderMarkersAll()` race condition
**Переводчик** (`translator.js`) — Google→MS→legacy fallback, 9 языков
**Кнопки перевода** — в блоках, блокноте, мини-чате
**Структура превью** — навигация + подсветка фона
**Якоря** — TreeWalker+Range позиционирование

## Architecture Decisions

- Sticky/TODO/Table кластеризуются через `.blocks-row` flex, max 4 в ряд при drag-and-drop
- Table: `< >` стрелки для столбцов (max 15), +/− строки, копирование на следующую подвкладку
- TODO/Table используют badge `#N` как text-блок (порядок в превью), клик toggle preview
- `buildOrderMap` учитывает todo/table для нумерации превью
- `State.updateLive()` + `State.snapshot()` вместо `State.update()` в todo/table для избежания полного re-render
- IndexedDB: `LocalBackup` с toggleImmortal, prune с учётом immortal записей
- Economy Mode: `reduceMotion` toggle через dblclick, очистка всех визуальных эффектов при входе
- 3D Glow: `mix-blend-mode: screen` для additive blending на тёмном фоне

## Commits (последняя сессия)

```
72857fd fix: buildOrderMap добавлен todo/table для #N badge, Structure скрывает previewDisabled блоки
617c63f fix: table/todo badge как у text — #N с preview toggle, убран кастомный дизайн
237d3a9 fix: table/todo — отдельная кнопка preview, muted кнопки, Structure menu, copy-to-subtab
1e64f19 fix: Table UI переделан — сетка с border, +/- строки, < > столбцов внизу
629e9ff fix: createColsPicker(b, el) → createColsPicker(b) — el undefined in createHeader
184d692 feat: Table block — 5 подвкладок, сетка 1-4 столбцов, inline edit, markdown preview
afec772 fix: subtab навигация — активный кружок центрируется
0d46b4f feat: 3D glow усиление — mix-blend-mode:screen,更强 box-shadow
34dbf32 fix: Economy Mode — очистка частиц при входе в эконом-режим
077bd47 feat: двойной клик по Угольку — Economy Mode toggle
9bb8443 feat: локальные копии — max 3 видимых + scroll, кнопка ☠, hover-тултипы
b8a1acd fix: sticky badge — перечёркнутый кружок поверх иконки
5be7e71 fix: uid() → State.uid() для кнопки Добавить, SVG-иконки
ef3fbd5 fix: добавить Sticky и TODO в меню добавления блоков
7fa3094 feat: Sticky Note + TODO Checklist + IndexedDB Backup в GistSync
```
