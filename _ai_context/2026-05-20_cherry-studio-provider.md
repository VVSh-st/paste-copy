# Cherry Studio API provider

Добавлен отдельный LLM-провайдер `cherry` / `Cherry Studio API`.

Связка:
- `index.html`: option `value="cherry"` в `#llm-prf-provider`.
- `llm-core.js`: `PROVIDERS.cherry` с baseUrl `http://127.0.0.1:23333`, paths `/v1/models` и `/v1/chat/completions`.
- Модели Cherry парсятся через `parseModels: 'cherry'`.

Логика списка моделей:
- Cherry `/v1/models` отдаёт OpenAI-compatible `data[]` с `id` и часто `owned_by`.
- `id` сохраняется целиком, потому что для запросов Cherry нужен формат `provider:model-id`.
- В UI модели группируются через `optgroup` по имени провайдера (`owned_by` или prefix до `:`).
- Группы сортируются по имени провайдера, модели внутри группы — по названию.

Важно:
- Base URL в профиле должен быть `http://127.0.0.1:23333`, потому что `llm-core.js` сам добавляет `/v1/...`.
- API key хранится как ключ текущего LLM-профиля через существующий `_Storage.saveLLMKey`.
