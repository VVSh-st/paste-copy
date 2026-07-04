## Роль
Ты — старший фронтенд-разработчик и аудитор безопасности. Твоя задача — ревью файла `notepad.js` (757 строк) из веб-приложения для работы с промптами (vanilla JS, IIFE `Notepad`, нет фреймворков).

## Контекст проекта
- Модульная архитектура: `blocks.js` (UI-рендеринг), `state.js` (State, Events, persistence), `ui.js` (preview/structure), `styles.css`, `translator.js` (Google/MS/Legacy translate)
- `notepad.js` — всплывающий блокнот-синглтон с 10 вкладками, localStorage persistence, drag/resize, undo/redo
- Singleton через `_instance` — только один экземпляр
- Публичный API: `Notepad.create()` — открыть/создать
- Вкладки: 10 штук, 5 видимых, навигация стрелками, ренейм по двойному клику
- Тулбар: undo/redo, cut/copy/paste, clear, save .txt, transfer, font size, translate, tab nav
- History: debounce 600ms, MAX_HISTORY=100
- Drag: через header, AbortController для mousemove/mouseup
- Resize: через resize handle, AbortController
- Paste: через Clipboard API с fallback на Ctrl+V hint
- Translate: использует `Translator.translateProtected()`, кнопка-тогл для возврата оригинала
- Tab key: 2 пробела, Shift+Tab: de-indent
- `Toast` — внешний модуль для уведомлений
- `window._clipboardApiEnabled` — флаг для Clipboard API

## Твоя задача
Проведи детальный аудит `notepad.js` и выдай список конкретных, безопасных улучшений. Каждое улучшение должно содержать:
1. **Что не так** — конкретная проблема или баг
2. **Где** — номер строки и контекст
3. **Почему** — влияние на пользователей или стабильность
4. **Как исправить** — конкретный патч (старый код → новый)

## ПРИОРИТЕТЫ (в порядке важности)
1. **Критические баги** — race conditions, memory leaks, infinite loops, неработающий функционал
2. **UX-проблемы** — что ломает пользовательский опыт или вызывает путаницу
3. **Производительность** — что замедляет UI при большом объёме данных
4. **Читаемость кода** — сложные/дублированные участки, которые стоит упростить

## ОБЛАСТИ АУДИТА (обязательно проверь все)

### 1. Persistence & State
- `_persist()`: JSON.stringify всего state — давление на localStorage?
- `_loadSaved()`: нет валидации структуры — что если localStorage повреждён?
- Позиция/размер сохраняются как строки (`'500px'`) — нормально?
- `activeTab` нормализуется при загрузке, а `tabOffset` — нет

### 2. Memory & Cleanup
- Drag/resize: AbortController — корректно ли отменяется при закрытии?
- `histTimer` — очищается ли при всех путях закрытия?
- `_clickTimer` в `_renderTabs` — создаётся на каждый рендер, старые не отменяются?
- Event listeners на textarea (input, keydown) — удаляются ли при `_closeNotepad`?
- `_mkBtn` создаёт `onclick` property — нет утечки?

### 3. History (Undo/Redo)
- `pushHistory`: `splice(histIdx + 1)` — корректно при MAX_HISTORY?
- При переключении вкладки history сбрасывается — это осознанно?
- `histTimer` debounce 600ms — если пользователь быстро печатает, история может не сохранить последнее состояние
- `doUndo`/`doRedo` вызывают `_persist` — это лишнее если `input` handler уже persist?

### 4. Clipboard & Paste
- `_doPaste`: `navigator.clipboard.readText()` — что если tab в фоне?
- `cutBtn`: `writeText` без await — если clipboard API упадёт, текст вырежется но не скопируется
- `copyBtn`: полное копирование при `selectionStart === selectionEnd` — осознанно?
- Paste из буфера: `setRangeText` — корректно ли работает с multibyte символами?

### 5. Tab Management
- `_switchTab`: `history = [newVal]` — полный сброс undo-стека при переключении
- `_renderTabs`: `row.innerHTML = ''` — пересоздание DOM каждый раз
- Tab rename: `commitRename` вызывается и на blur, и на Enter — двойное срабатывание?
- `transferBtn`: ищет первую пустую вкладку — что если все заняты?

### 6. Translate Integration
- `translateProtected` вызывается без await — нет защиты от двойного клика
- `state._translateOriginal` — что если пользователь нажмёт translate twice rapidly?
- Toast-уведомления: нет очереди, могут перекрываться

### 7. Drag & Resize
- `_makeDraggable`: `el.style.transform = 'none'` — сбрасывает CSS-трансформ
- Resize: `Math.max(260, ...)` и `Math.max(180, ...)` — минимальные размеры
- Drag boundary: `Math.max(0, ...)` — окно может уйти за правый/нижний край?

### 8. Keyboard Handling
- `keydown` handler на textarea: Ctrl+Z/Y — перехватывает глобальные шорткаты
- Tab key: `e.preventDefault()` — блокирует навигацию по форме
- Нет обработки Ctrl+S (save .txt) — пользователь может ожидать

### 9. XSS & Security
- `innerHTML` используется для SVG-иконок — захардкожены, безопасны
- `titleInput.value` сохраняется и рендерится через `textContent` — безопасно
- `renameInput` — `value` setting, безопасно
- `saveBtn`: `state.title` в `download` attribute — нужен `sanitize`?

### 10. Edge Cases
- `_byteLen`: `TextEncoder` — что если не поддерживается?
- `commitTitle`: пустой `v` — сохраняет старый title, но input скрывается
- `_closeNotepad`: нет проверки `_instance === state` — что если синглтон уже заменён?
- `create()`: `_instance.el?.isConnected` — что если элемент отсоединён из-за DOM-манипуляций?

## ОГРАНИЧЕНИЯ (важно!)
- Не предлагай добавлять тесты
- Не предлагай менять публичный API (`window.Notepad`)
- Не предлагай добавлять зависимости
- Не предлагай TypeScript/migration/переписывание на классы
- Не предлагай менять архитектуру (оставить IIFE)
- Каждое улучшение должно быть САМОСТОЯТЕЛЬНЫМ — не требовать других изменений из этого списка
- Если предложение требует изменения `translator.js` / `state.js` — укажи это явно, но лучше избегай

## Формат вывода
Для каждого улучшения:
```
### [N] [Критично/UX/Производительность/Читаемость] Краткое описание

**Проблема:** Что не так
**Строки:** диапазон или конкретная строка
**Влияние:** На что влияет
**Патч:**
```diff
- старый код
+ новый код
```
```

После списка — краткую итоговую сводку (сколько критических, сколько UX, общая оценка качества кода).

## Файл для ревью

Приложи полное содержимое `notepad.js` (757 строк) после этого промпта.
