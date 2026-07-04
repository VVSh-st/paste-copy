## Роль
Ты — старший фронтенд-разработчик и аудитор безопасности. Твоя задача — ревью файла `translator.js` (504 строки) из веб-приложения для работы с промптами (vanilla JS, IIFE `Translator`, нет фреймворков).

## Контекст проекта
- Модульная архитектура: `blocks.js` (UI-рендеринг), `state.js` (State, Events, persistence), `ui.js` (preview/structure), `styles.css`
- Модуль `translator.js` — клиентский переводчик текста через 3 бэкенда: Google Translate API, Microsoft Edge Translate API, Legacy fallback (gtx)
- IIFE `Translator` с публичным API через объект-модуль
- Кэш в localStorage (LRU, TTL 7 дней, до 2000 записей)
- История переводов в localStorage (до 50 записей)
- Настройки (targetLang, engine) в localStorage
- Защита шаблонов: `{{...}}`, `$VAR`, `${...}`, `[[...]]`, `%...%`, `{N}`, `!теги` — не переводятся
- Обнаружение языка: кириллица/латиница, китайский/японский, корейский, арабский
- AbortController для отмены активных запросов
- Retry с exponential backoff + circuit breaker (блокировка при 3+ ошибках)
- Пакетная отправка: Google — по 50, Microsoft — по 100, Legacy — параллельно по 5

## Твоя задача
Проведи детальный аудит `translator.js` и выдай список конкретных, безопасных улучшений. Каждое улучшение должно содержать:
1. **Что не так** — конкретная проблема или баг
2. **Где** — номер строки и контекст
3. **Почему** — влияние на пользователей или стабильность
4. **Как исправить** — конкретный патч (старый код → новый)

## ПРИОРИТЕТЫ (в порядке важности)
1. **Критические баги** — race conditions, memory leaks, infinite loops, неработающий функционал, утечки токенов/ключей
2. **Безопасность** — XSS через decodeHtmlEntities, утечка API-ключей, injection в шаблонах
3. **UX-проблемы** — что ломает пользовательский опыт или вызывает путаницу
4. **Производительность** — что замедляет UI при большом объёме данных, localStorage pressure
5. **Читаемость кода** — сложные/дублированные участки, которые стоит упростить

## ОБЛАСТИ АУДИТА (обязательно проверь все)

### 1. Безопасность (Security)
- `decodeHtmlEntities` через `document.createElement('textarea')` — XSS вектор?
- Google API key scraping с внешнего URL — что если ответ подменён?
- Шаблоны: regex `TMPL_RE` — может ли пользовательский текст сломать защиту?
- `localStorage` — нет шифрования, что если там чувствительные данные?
- `encodeURIComponent` в legacy — достаточно ли для защиты от injection?

### 2. Race Conditions
- `_activeController.abort()` — что если translate() вызван параллельно дважды?
- Cache load/save — concurrent writes в localStorage?
- `flushCache` + `scheduleCacheSave` — нет ли гонки между timeout и beforeunload?
- `fetchGoogleKey` / `fetchMsToken` — параллельные вызовы перезаписывают токен?

### 3. Error Handling
- Google: `r.status === 429` — а что с другими ошибками (403, 500)?
- Microsoft: `r.status === 401 || 403` — а что с 500?
- Legacy: `catch {}` — молчаливое проглатывание ошибок
- `retry` — canRetry callback: `e?.status !== 429` — retry на 429? (нет, наоборот: retry если НЕ 429)
- `translateGoogle`: chunk с null результатами — `results.push(...chunk.map(() => null))` — что если часть чанка уже обработана?

### 4. Cache & Storage
- `cacheGet` TTL check: `v.ts && Date.now() - v.ts > CACHE_TTL` — а если `ts` отсутствует (старые записи)?
- `cacheSet`: `cache.size > MAX_CACHE` — удаление первого ключа Map (FIFO) — это LRU?
- `flushCache`: `.slice(-MAX_CACHE)` — зачем slice если уже проверили size?
- localStorage: JSON.stringify整个Map — давление при 2000 записях
- `_cacheDirty` flag: что если flushCache бросил исключение — flag сброшен, данные потеряны?

### 5. Google API
- `fetchGoogleKey`: URL захардкожен — Google может его изменить
- Regex `x-goog-api-key` — а если формат ответа изменится?
- `translateHtml`: `application/json+protobuf` — нестандартный content-type
- API key хранится в замыкании — при утечке (DevTools)他是可见的

### 6. Microsoft API
- `fetchMsToken`: токен хранится в переменной — TTL 480000ms (8 мин), а токен может протухнуть раньше
- `translateMs`: `zh → zh-Hans` — а `zh-TW` (Traditional)?
- Authorization header: `'Bearer ' + token` — пробел после Bearer?

### 7. Legacy Fallback
- `translateLegacyOne`: URL `translate.googleapis.com/translate_a/single` — неофициальный API, может быть заблокирован
- Конкурентность: 5 воркеров параллельно — Google может забанить за rate limit
- `retry` с `e?.status !== 429` — retry на 429? (нет: callback возвращает true если можно retry, 429 → false → НЕ retry)

### 8. Template Protection
- `TMPL_RE`: `![а-яёА-ЯЁ]+` — захватывает `!привет` в середине предложения
- `restoreTemplates`: fuzzy regex через `split('').join('\\s*')` — что если токен был переведён?
- Токены `__TRPL0__` — что если пользовательский текст содержит эту подстроку?

### 9. Language Detection
- `detectLangHint`: смешанный текст (`mixed`) — needsTranslation вернёт true → будет переводить смешанный текст
- `needsTranslation`: `targetLang === 'ru' && lang?.code === 'ru'` — пропускает перевод, а если `lang === null`?
- Юникод-диапазоны: `\u3400-\u9FFF` — не включает расширенные CJK-блоки

### 10. Performance
- `norm()` вызывается на каждый текст — два regex pass (ZW + WS)
- `JSON.stringify([lang, text])` для каждого cache lookup — аллокация
- `history.slice(-MAX_HISTORY)` при каждом добавлении — аллокация
- `_stats.totalChars` — суммирование длин текстов, но не используется в UI

## ОГРАНИЧЕНИЯ (важно!)
- Не предлагай добавлять тесты
- Не предлагай менять публичный API (`window.Translator` / возвращаемый объект)
- Не предлагай добавлять зависимости
- Не предлагай TypeScript/migration/переписывание на классы
- Не предлагай менять архитектуру (оставить IIFE)
- Каждое улучшение должно быть САМОСТОЯТЕЛЬНЫМ — не требовать других изменений из этого списка
- Если предложение требует изменения `state.js` / `ui.js` — укажи это явно, но лучше избегай

## Формат вывода
Для каждого улучшения:
```
### [N] [Критично/Безопасность/UX/Производительность/Читаемость] Краткое описание

**Проблема:** Что не так
**Строки:** диапазон или конкретная строка
**Влияние:** На что влияет
**Патч:**
```diff
- старый код
+ новый код
```
```

После списка — краткую итоговую сводку (сколько критических, сколько по безопасности, сколько UX, общая оценка качества кода).

## Файл для ревью

Приложи полное содержимое `translator.js` (504 строки) после этого промпта.
