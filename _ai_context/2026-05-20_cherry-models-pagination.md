# Cherry Studio API models pagination fix

Изменено в `llm-core.js`.

Причина:
- `GET /v1/models` у Cherry Studio API поддерживает `offset`/`limit` и может возвращать страницу, а не полный список.
- Старый код запрашивал `/v1/models` без pagination, поэтому моделей было мало.
- `_shortModelLabel()` дополнительно превращал длинные OpenRouter ids вроде `baidu/qianfan-ocr-fast:free` в `…/free`, из-за чего названия казались неполными.

Что сделано:
- Для provider `cherry` добавлена paginated загрузка через `limit=500&offset=N` до `total`.
- Учитывается `json.limit`, если сервер ограничивает размер страницы ниже запрошенного.
- Добавлен dedupe моделей по `id`.
- Для Cherry-моделей `option.textContent` теперь показывает полный model id без provider prefix, а не `_shortModelLabel()`.
- Разбор `provider:model` стал безопаснее: если `owned_by` известен, prefix снимается только когда он реально есть. Суффиксы типа `:free` больше не превращаются в label `free`.

Проверка:
- Browser MCP загрузил `file:///E:/Cherry_studio/index.html` без syntax errors.
- Mock fetch подтвердил две страницы `/v1/models?limit=500&offset=0` и `offset=2`, итог 3 модели.
- Проверены labels: `baidu/qianfan-ocr-fast:free`, `minimax/minimax-m2.5:free`, `ministal-3b-latest`.
