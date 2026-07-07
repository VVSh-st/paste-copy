# HANDOFF — Paste/Copy

## Текущий статус

### Завершено
- **Сниппеты refactor**: убран блок `snippets` из дефолта, `commands` переименован в "Сниппеты", глобальные сниппеты (облачные) в блоке с edit/delete/on-off
- **Миграция**: `snippets` → `commands` при загрузке, фильтрация старых дефолтных значений
- **Дедупликация**: несколько `commands` блоков объединяются в один
- **Prompt Loom**: исправлены TDZ ошибки (`VALID_SOURCES`, `META_WHITELIST`, `_loadFailed`), история корректно загружается после F5
- **Cache-busting**: `prompt-loom.js?v=3` в index.html

### Текущие файлы (изменённые)
| Файл | Что изменено |
|------|-------------|
| `state.js` | defaultBlocks без snippets, commands title='Сниппеты', миграция snippets→commands, дедупликация, clearGlobalSnippets, toggleGlobalSnippet |
| `blocks.js` | renderCommandsBody с облачными сниппетами, SVG eye/eyeOff, badge скрыт для commands |
| `ui.js` | makeCmds пустой, _typeIcons без snippets |
| `prompt-loom.js` | TDZ fixes: VALID_SOURCES, META_WHITELIST, _loadFailed перенесены до loadState() |
| `index.html` | snippets кнопка удалена, commands переименована, prompt-loom.js?v=3 |
| `styles.css` | global-snippet-section, btn-icon-active |
| `help.js` | обновлено описание блока Сниппеты |
| `gist-sync.js` | calcTotalChars учитывает commands + globalSnippets |
| `llm-features.js` | snippets → commands |
| `word-complete.js` | snippets → commands |

### Известные ограничения
- `defaultSnippets()` и `defaultCommands()` возвращают `[]` — пользователь добавляет свои через Loom
- Старые шаблоны с блоком snippets автоматически конвертируются в commands

## Проверка
1. Новый layout: блок "Сниппеты" (type: commands) без дефолтных items
2. Облачные сниппеты: edit/delete/on-off работает, `/` меню учитывает enabled
3. Миграция: старый snippets блок → commands
4. Prompt Loom: история переживает F5
