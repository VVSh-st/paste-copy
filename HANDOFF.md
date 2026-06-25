# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй "E:\CODE\Paste_copy\2026-06-21_20-35.jpg").

## Status — ГОТОВО

### Выполнено в последней сессии

**1. Переводчик** (`translator.js`, новый модуль)

- Google → Microsoft → legacy fallback каскадный пайплайн
- Кэш в localStorage (debounced flush 3с + beforeunload)
- Защита шаблонов: `{{...}}`, `$VAR`, `!теги` не переводятся
- Детекция языка: ru/en/mixed/zh/ko/ar
- Декодировка HTML-сущностей (`&#39;` → `'`)
- 15 языков для перевода
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

**5. Исправления переводчика** (баги)

- `addHistory` не экспортировалась в публичный API
- Повторный клик не возвращал оригинал (блок footer + блокнот)
- Смешанный текст (ru+en) детектировался как "уже EN"
- HTML-сущности в ответах Google/MS
- Превью-перевод убран (не нужен)

**6. Структура превью — навигация** (`ui.js`)

- Клик по пункту меню → скроллит к заголовку в превью (MD + текстовый режим)
- Auto-close code fences между блоками (`_closeOpenFences`)
- Код-блоки (>80% кода) исключены из меню структуры
- Заголовки внутри `<pre>/<code>` пропускаются при поиске

**7. Структура превью — подсветка** (`ui.js`, `styles.css`)

- Фон-индикатор (`.structure-active-bg`) плавно скользит пропорционально скроллу превью
- `ratio = scrollTop / (scrollHeight - clientHeight)` → `top = ratio * (totalH - bgH)`
- При достижении конца превью → привязка к последнему пункту
- CSS transition `.12s ease-out`

**8. Превью — XSS защита** (`ui.js`)

- HTML-сущности экранируются перед `marked.parse()` (`<` → `&lt;`)
- `<script>` как текст больше не ломает превью

**9. Превью — двойной клик** (`app.js`)

- Двойной клик на шапку превью (`#preview-bar`) → свернуть/развернуть
- Курсор `pointer` на заголовке "Превью"

**10. Переводчик — исправления пайплайна** (`translator.js`)

- `accept()` убрана проверка `tr === src` (шорткаты могут совпадать)
- `translateGoogle` / `translateMs` — try-catch на JSON парсинг
- Debounced cache flush вместо записи на каждый `cacheSet`

### Архив предыдущих сессий

**Gist Sync — якоря в статистике** (`gist-sync.js`)
- `getStats()` — `anchorCount`, `_pushImpl()`, модалка, история, сравнение

**Help — документация якорей** (`help.js`)
- Хоткеи: `Ctrl+Shift+1/2/3`, карточка "Якоря"

**Inline Diff** (`diff-engine.js`)
- LCS diff, кнопка 🔍, панель diff в модалке

**Меню структуры блоков** (`ui.js`, `styles.css`)

## Active Files

- `translator.js` (~470 строк) — ядро переводчика
- `diff-engine.js` (~183 строки) — модуль diff
- `gist-sync.js` — anchorCount в stats/истории/сравнении
- `help.js` — карточка якорей + хоткеи
- `ui.js` — Preview, Search, Snapshots, Templates, **Structure menu**, **Translate integration**
- `styles.css` — **.structure-active-bg**, **.translate-btn**, **.translate-dropdown**
- `app.js` — dblclick на превью, init translator
- `anchors.js` (~440 строк) — якоря
- `blocks.js` — translate button в футере блока
- `notepad.js` — translate button в toolbar
- `llm-features.js` — translate button в мини-чате

## Architecture Decisions

- Diff: переиспользован LCS из llm-features.js
- Code fence: `_closeOpenFences()` закрывает незакрытые ``` между блоками
- XSS: `html: false` в marked + ручное экранирование `<`, `>`, `&` перед parse
- Structure menu: плавный фон-индикатор пропорционально скроллу (не IntersectionObserver)
- Translator: Google/MS/legacy fallback с debounce cache flush
- Код-блоки (>80% контента в fence) исключены из структуры

## Known Limitations

- Diff показывает только активную подвкладку каждого блока
- Palette якорей не группирует по вкладкам
- Переводчик не поддерживает сохранение пары "оригинал→перевод" для long-press меню

## Commits (последняя сессия)

```
(не зафиксированы — все изменения в working tree)
```
