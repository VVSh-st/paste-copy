# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй "E:\CODE\Paste_copy\2026-06-21_20-35.jpg").

## Status — В РАБОТЕ

### Текущая проблема: фон подсветки якоря пропадает

**Баг**: при перемещении курсора в другой текстовый блок, фон подсветки якоря (`.anchor-marker-gutter`) пропадает, хотя левый маркер (`.anchor-marker-line`) остаётся.

**Корень**: `Blocks.render()` делает `colLeft.innerHTML = ''` при полном перерендере (вызывается из `fullRender()` через `State.onChange`). `_doRender()` запускается через `requestAnimationFrame`, а `Anchors._renderMarkersAll()` тоже через `requestAnimationFrame` — но из `fullRender()`. Порядок rAF-колбэков: `_doRender()` → `_renderMarkersAll()`, т.е. DOM пересоздаётся ПЕРЕД отрисовкой маркеров. Однако баг воспроизводится и без полного перерендера — предположительно из-за `State.onLive` → `_renderMarkersAll()`, который вызывается ДО пересоздания DOM и не учитывает будущее состояние.

**Что уже пробовано (не помогло)**:
- Добавлены `focusin` и `input` обработчики в anchors.js
- clamping `rawTop` для gutter (как для line marker)
- Убран `overflow: hidden` конфликт в CSS `.anchor-marker-gutter`

**Направление для следующей сессии**: рассмотреть перенос `_renderMarkersAll()` из `fullRender()` в callback после `_doRender()`, либо хранить маркеры как data-атрибуты/перерисовывать их из `_doRender()`.

### Выполнено ранее

**1. Переводчик** (`translator.js`, новый модуль)

- Google → Microsoft → legacy fallback каскадный пайплайн
- Кэш в localStorage (debounced flush 3с + beforeunload)
- Защита шаблонов: `{{...}}`, `$VAR`, `!теги` не переводятся
- Детекция языка: ru/en/mixed/zh/ko/ar
- Декодировка HTML-сущностей (`&#39;` → `'`)
- **9 языков**: RU, EN, DE, FR, ES, IT, 中文, 日本語, 한국어 (было 15)
- История переводов (до 50 записей)

**2. Кнопка перевода в футере блока** (`blocks.js`)

- SVG глобус в стиле Feather Icons
- Клик → перевод выделенного/всего текста
- Повторный клик → возврат оригинала из сохранённого состояния
- Длинное нажатие → dropdown выбора языка
- Анимация ⏳ при загрузке

**3. Кнопка перевода в блокноте** (`notepad.js`)

- SVG глобус в toolbar
- Та же логика: клик=перевод, повторный=возврат

**4. Кнопка перевода в мини-чате** (`llm-features.js`)

- SVG глобус на ответах LLM
- Авто-определение: кириллица → EN, латиница → RU
- Toggle оригинал/перевод

**5. Структура превью — навигация** (`ui.js`)

- Клик по пункту меню → скроллит к заголовку в превью (MD + текстовый режим)
- Auto-close code fences между блоками (`_closeOpenFences`)
- Код-блоки (>80% кода) исключены из меню структуры
- Заголовки внутри `<pre>/<code>` пропускаются при поиске

**6. Структура превью — подсветка** (`ui.js`, `styles.css`)

- Фон-индикатор (`.structure-active-bg`) плавно скользит пропорционально скроллу превью
- CSS transition `.12s ease-out`

**7. Превью — XSS защита** (`ui.js`)

- HTML-сущности экранируются перед `marked.parse()` (`<` → `&lt;`)

**8. Превью — двойной клик** (`app.js`)

- Двойной клик на шапку превью (`#preview-bar`) → свернуть/развернуть

**9. Якоря — позиционирование маркеров** (`anchors.js`)

- `_measurePos` переписан с canvas measureText на TreeWalker + Range (зеркало)
- Точное позиционирование символа через DOM дерево зеркала
- Подсветка фона: clamping позиции, корректная ширина при переносе строк
- CSS: убран конфликт `left: 3px; right: 0` у `.anchor-marker-gutter`

### Архив предыдущих сессий

**Gist Sync — якоря в статистике** (`gist-sync.js`)
**Help — документация якорей** (`help.js`)
**Inline Diff** (`diff-engine.js`)

## Active Files

- `translator.js` (~470 строк) — ядро переводчика (9 языков)
- `anchors.js` (~500 строк) — якоря, TreeWalker+Range позиционирование
- `blocks.js` — translate button, `current-line-wrap`, `_doRender()` пересоздаёт DOM
- `app.js` — `fullRender()`, `liveRender()`, dblclick на превью
- `ui.js` — Preview, Structure menu, Search
- `styles.css` — `.anchor-marker-gutter` (z-index:2), `.structure-active-bg`
- `notepad.js` — translate button в toolbar
- `llm-features.js` — translate button в мини-чате
- `diff-engine.js` — LCS diff
- `gist-sync.js` — anchorCount в stats
- `help.js` — карточка якорей

## Architecture Decisions

- TreeWalker+Range вместо canvas measureText для позиционирования якорей
- Mirror div (`visibility:hidden`) копирует CSS textarea для точного переноса строк
- Translator: Google/MS/legacy fallback с debounce cache flush
- `_doRender()` пересоздаёт DOM через `colLeft.innerHTML = ''` — маркеры нужно пересоздавать ПОСЛЕ этого

## Commits (последняя сессия)

```
22c7f0f fix: clamp gutter position and fix CSS z-index for anchor background highlight
cf0f387 fix: re-render anchor markers on focus change and input
589d29f fix: improved anchor marker positioning with TreeWalker+Range, reduced translator languages
```
