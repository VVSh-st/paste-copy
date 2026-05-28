# Slash wrap and hidden audit

Изменения:
- blocks.js: навигация slash-меню учитывает KeyboardEvent.repeat. При удержании ArrowDown/ArrowUp список доходит до края и остаётся там; следующий отдельный физический нажим зацикливает список.
- llm-features.js: глобальное действие LLM «groom» больше не вызывает несуществующий prompt key `groom_style`; заменено на существующий режим `edit` (`groom_edit`).

Проверки:
- Статическая проверка JS-синтаксиса через браузер: app.js, blocks.js, llm-core.js, llm-features.js, ui.js, state.js, storage.js, word-complete.js — OK.
- Проверка duplicate id в DOM — не найдено.
- Проверка `data-llm` → `LLMFeatures.handleAction()` — необработанных команд не найдено.
- Проверка prompt keys после правки — пропавших ключей не найдено.

Затронутые файлы:
- blocks.js
- llm-features.js
