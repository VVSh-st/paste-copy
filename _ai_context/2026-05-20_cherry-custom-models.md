# Cherry Studio custom models

Что изменено:
- `llm-core.js` теперь для провайдера `Cherry Studio API` грузит `/v1/models` не только без фильтра, но и с `providerType=openai`, `openai-response`, `anthropic`, `gemini`.
- Это нужно, потому что Cherry Studio может отдавать кастомные/включённые профили не в общей первой выдаче, а в выдачах по типу провайдера.
- Модели объединяются и dedupe-ятся по `id` в `_parseCherryModels()`.
- Поддержаны дополнительные поля модели: `provider_id`, `providerId`, `provider.id`, `owned_by`, `ownedBy`, `name`, `label`.
- Отображение групп расширено для `GitHub Copilot`, `Hugging Face`, `Electron Hub`, `New API`, `Mistral AI`, `Z.ai`, `SiliconFlow`.

Важно:
- Значение option остаётся полным Cherry model id, например `000:gpt-5.5-pro` или `openrouter:baidu/qianfan-ocr-fast:free`.
- Визуальная label в списке — короткое имя модели внутри группы провайдера.
