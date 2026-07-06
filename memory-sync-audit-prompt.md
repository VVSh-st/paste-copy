# Аудитор: memory-sync.js

## Что аудитор должен сделать

Провести **один раунд** комплексного аудита `E:\CODE\Paste_copy\memory-sync.js` (~847 строк) по安全性, корректности и качеству. Вернуть **нумерованный список** проблем в формате:

- **Строки:** ( approximate )
- **Категория:** важно / минорно / вопрос
- **Оценка:** (security / correctness / privacy / UX)
- **Описание**
- **Предложение по исправлению** (с кодом)

## Что это за модуль

`MemorySync` — приватная синхронизация безопасных метаданных (хэши, титулы, роли, счётчики, структуры) в GitHub Gist. Полный текст пользовательских данных **не отправляется**.

**Ключевые особенности:**
- Токен и Gist ID берутся из `localStorage` GistSync (`gs_token`, `gs_gist_id`)
- Push/Pull с rate limiting: 6 запросов/час, 30с между запросами
- Auto-push каждые 3ч, auto-pull каждые 24ч (при включённых настройках)
- Обёрткаsave-хуков UserMemory/ProjectGraph для авто-триггера sync
- Модалка с `innerHTML` рендерингом
- `escapeHtml()` для XSS-защиты в HTML-шаблонах
- `stableBundleForSync()` убирает волатильные поля (recentEvents, counters.events, counters.sessions)
- FNV-1a хэш для определения изменений
- `suppressSchedule` флаг для предотвращения sync-циклов
- `pushInFlight` / `pullInFlight` для предотвращения параллельных операций
- localStorage для настроек с try/catch на quota

**Зависимости:** `window.UserMemory`, `window.ProjectGraph`, `window.GistSync`, `window.Toast`, `window.Intelligence` (опционально)

## Чего НЕ делать (over-engineering)

Не предлагать:
- Переход с localStorage на что-то другое (это userscript, localStorage — норма)
- Замену innerHTML на DOM API (модалка маленькая, innerHTML приемлем)
- Обёртку каждого localStorage.setItem в lsSet/lsGet (уже есть try/catch в критичных местах)
- Добавление TypeScript/JSDoc типизации
- Внедрение state machine для push/pull flow
- Добавление unit-тестов (не в scope)
- Замену fetch на GM_xmlhttpRequest (модуль работает в браузере, не в userscript-окружении для API-запросов — хотя GistSync использует GM_xmlhttpRequest, memory-sync делает прямой fetch)
- Добавление retry логики (rate limiting уже покрывает основные случаи)
- Шифрование payload (метаданные не приватные — хэши, титулы, роли)

## Ключевые зоны для проверки

1. **Race conditions:** push/pullInFlight, pushTimer, suppressSchedule — могут ли возникнуть состояния гонки?
2. **Rate limiting:** корректность窗口, REQUEST_WINDOW_MS, MIN_REQUEST_GAP_MS — может ли клиент превысить серверный rate limit GitHub?
3. **XSS:** `escapeHtml()` используется последовательно для всех данных из localStorage/External?
4. **localStorage:** все ли критичные записи обёрнуты в try/catch?
5. **Hash collision:** FNV-1a 32-bit — приемлемо для dirty-check или нужен более надёжный хэш?
6. **Wrap hooks:** `wrapSaveHooks()` — безопасна ли обёртка? Может ли она сломать оригинальные методы?
7. **Suppress schedule:** `suppressSchedule` — корректно ли сбрасывается при ошибках?
8. **Pull:** после importData в caller'е — помечается ли sync-статус корректно (как в gist-sync после #2)?
9. **Gist ID / token:** используются из localStorage GistSync — что если GistSync отключён/очищен?
10. **Параллельные вызовы:** push() возвращает промис через pushInFlight — что если вызов будет отменён?

## Формат ответа

Нумерованный список от 1 до N. В конце — краткий итог (самые важные исправления). Пропускайте пункты, которые входят в список "не делать" выше.
