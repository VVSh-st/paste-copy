# Промпт для аудита безопасности/корректности/качества кода

## Модуль: `gist-sync.js`

Это модуль синхронизации состояния приложения Paste/Copy с GitHub Gist. Работает как в браузере (Userscript), так и в расширениях/Electron. Использует GM_xmlhttpRequest для обхода CORS.

## Структура модуля

- **GistSync** — IIFE, экспортируется как `window.GistSync`
- **GithubApi** — обёртка над GitHub REST API (PAT + Device Flow OAuth)
- **Cipher** — AES-GCM шифрование через Web Crypto API (PBKDF2 100K итераций)
- **Compress** — deflate-raw сжатие через CompressionStream API
- **LocalStorage** — ключи `gs_token`, `gs_gist_id`, `gs_last_sync`, `gs_dirty`, `gs_pwd`, `gs_settings`, `gs_cloud_hist`, `gs_history_filter`
- **UI** — модальное окно с настройками, историей, статистикой, кнопками push/pull

## Что проверять

### Безопасность
1. Хранение GitHub токена в localStorage — риски? Есть ли XSS-векторы для кражи?
2. Хранение пароля шифрования в localStorage (`gs_pwd`) — это нормально?
3. OAuth Device Flow — безопасен ли `CLIENT_ID` в клиентском коде?
4. Шифрование: корректность AES-GCM + PBKDF2? Salt/IV генерируются правильно?
5. Есть ли XSS через innerHTML в UI-рендеринге (`renderModal`, `_renderBackupsHTML`)?
6. Токен передаётся в `Authorization: Bearer` заголовке — есть ли утечки?
7. `esc()` функция — полная ли экранировка для HTML-атрибутов?
8. `data-tip`, `data-sha`, `data-ts` атрибуты — безопасны ли они?
9. `confirm()` и `prompt()` — используются ли безопасно?
10. `URL.createObjectURL` для скачивания — правильный ли `revokeObjectURL`?

### Корректность и гонки
11. `_pushing` guard — защищает ли от параллельных push? А `_wordlistPushing`?
12. Debounce логика — корректна ли? Может ли push потеряться?
13. `_hasChanges()` через `_quickHash` — надёжна ли эвристика?
14. `withRetry` — корректно ли обрабатывает transient ошибки?
15. `_needsOverwriteProtection()` — может ли вернуть ложное срабатывание?
16. Race condition между `push()` и `pull()`?
17. `schedulePush()` — может ли вызваться после `disconnect()`?
18. `localStorage` quota — обрабатывается ли при записи?
19. `validateJsonString()` — покрывает ли edge cases обрезанных JSON?
20. `_getFullContent()` для truncated gist files — корректно ли загружает raw_url?

### Приватность
21. Gist приватный (`public: false`) — достаточно ли?
22. `description: 'paste-copy-sync'` — раскрывает ли название приложения?
23. `CLIENT_ID` публичный — это нормально для OAuth Device Flow?
24. Пароль шифрования хранится в localStorage в открытом виде — это ок?

### Производительность
25. `renderModal()` пересоздаёт весь HTML при каждом обновлении — это нормально для модалки?
26. `_quickHash` — достаточно быстрый для частых вызовов?
27. `calcTotalChars()` — O(tabs × blocks) — проблема при большом количестве?

### Архитектура
28. Зависимости от внешних объектов: `State`, `Storage`, `Toast`, `LocalBackup`, `GM_xmlhttpRequest`
29. Есть ли cleanup/uninit?
30. Обработка ошибок: все ли async ошибки перехвачены?

## Важно

- Модуль работает в Userscript среде (Tampermonkey/Violentmonkey) и в расширениях
- `GM_xmlhttpRequest` используется для обхода CORS — это штатное поведение
- `navigator.clipboard.writeText` используется для копирования user_code при OAuth — это не патч, а одноразовый вызов
- Не предлагайте over-engineering: виртуализацию, AbortController для глобальных listeners, uninstall(), переработку архитектуры
- Не предлагайте смену CLIENT_ID — он публичный по спецификации OAuth Device Flow
- Не предлагайте отказ от localStorage для токена — это стандартная практика для Userscript
- Не предлагайте замену innerHTML на DOM API для всего UI — это не критично для модалки

## Формат ответа

Для каждой проблемы укажите:
- Номер и название
- Строки (приблизительно)
- Категория: важно / вопрос / минорно
- Описание проблемы
- Предложение по исправлению (конкретный код)
- Оценка: XSS / гонка / приватность / корректность / производительность

Критичные XSS/инъекции — если не найдены, скажите прямо.
