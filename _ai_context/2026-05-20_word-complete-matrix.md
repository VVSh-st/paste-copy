# 2026-05-20 WordComplete matrix accept effect

Задача: добавить визуальный Mercury/Matrix/Inception-like эффект подтверждения подсказки автодополнения слов.

Затронутые файлы:
- index.html — добавлены настройки opt-wc-accept-effect и opt-wc-effect-ms.
- app.js — синхронизация и сохранение настроек в State layout.
- word-complete.js — добавлен модуль WordAcceptEffect и запуск эффекта при Tab-accept.
- styles.css — добавлены стили .wc-accept-effect.

Логика:
- Подсказка всё ещё принимается сразу через setRangeText, чтобы не ломать undo/input/state.
- Поверх вставленного текста рисуется fixed overlay в позиции прежнего inline hint.
- Overlay быстро перебирает случайные glyphs, а итоговые буквы фиксируются в случайном порядке до заданной длительности.
- Эффект отключается через меню и автоматически отключается при prefers-reduced-motion: reduce.
