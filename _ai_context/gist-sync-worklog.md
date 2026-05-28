# Gist Sync context

- Main files: `gist-sync.js`, `styles.css`, plus storage changes already added earlier (`storage.js`, `app.js`).
- Current focus: compact Sync → GitHub Gist modal, consistent rounded/translucent UI, history-first layout.
- Recent features: immortal history entries (`☠`), history filters, compare panel, IndexedDB fallback for large local state.
- Current pass: Gist-модалка history-first; настройки автосохраняются; поля Задержка/Триггер/История выровнены через 12-колоночную сетку; статистика — компактная строка из 6 иконок с tooltip и коротким storage (`LS`/`IDB`); storage tooltip показывает размер JSON и процент от лимита Gist; manual Push открывает inline-панель комментария вместо `prompt()`; floating tooltip закреплён поверх интерфейса и не должен обрезаться краями; опасные действия истории спрятаны в меню `⋯`, на кнопке меню есть бейдж количества аварийных IndexedDB-снимков; оставшийся prompt перед восстановлением убран — создаётся стандартная ☠-метка.
- Keep comments in code short, Russian style: `// =Блок=`.

Prompt line to add:
Всегда перед правками через MCP читай релевантные места, делай бэкап затронутых файлов в `_ai_backups/YYYY-MM-DD_HH-mm-ss/`, а межчатовый контекст проекта храни в `_ai_context/`.
