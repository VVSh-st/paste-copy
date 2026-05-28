Изменения (llm-monitor):

- Прокси: исправлен HTTP запрос через raw-socket туннель — добавлен явный заголовок Host в request line для requestViaProxy (server.js).
  Причина: часть origin-серверов возвращает Not Found/400 при отсутствии Host (особенно при работе через CONNECT / некоторые прокси).

- UI:
  - Увеличены размеры input/button (min-height/padding), чтобы поля и кнопки были удобнее.
  - Скроллбар сделан более компактным и темным (Firefox scrollbar-color + WebKit rules).
  - Добавлено запоминание высоты окна .app через ResizeObserver + localStorage, восстановление при старте.

Затронутые файлы:
- E:\Cherry_studio\Monitor\llm-monitor\server.js
- E:\Cherry_studio\Monitor\llm-monitor\public\index.html

Edge cases:
- localStorage может быть недоступен/битый JSON — обработано try/catch.
- Чтобы не спамить localStorage, сохранение высоты дебаунсится (120ms).
