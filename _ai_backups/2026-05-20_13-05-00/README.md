# Backup note

Затронутые файлы в этой сессии:
- blocks.js
- llm-features.js

Перед правкой релевантные места были прочитаны через MCP `read/grep`.

Правки точечные:
1. `blocks.js`: в обработчике slash-меню `keydown` добавлена проверка `e.repeat`, чтобы удержание стрелки не зацикливало список на краю.
2. `llm-features.js`: вызов `groomBlock(block.id, 'style')` заменён на `groomBlock(block.id, 'edit')`, потому что prompt key `groom_style` отсутствует, а `groom_edit` есть.

Для восстановления предыдущих версий также есть более ранние полные бэкапы проекта в соседних папках `_ai_backups`.
