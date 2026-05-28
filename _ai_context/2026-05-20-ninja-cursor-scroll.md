# Ninja cursor scroll fix

Файл: `ninja-cursor.js`.

Проблема: во время скролла декоративный fixed-курсор компенсировал смещение через `--nc-offset-y` и визуально ездил по экрану отдельно от поля ввода.

Исправление: на scroll/wheel курсор скрывается, offset сбрасывается, после стабилизации скролла позиция caret синхронизируется без анимации через `{ animate: false }`.

Проверка: приложение открыто через `file:///E:/Cherry_studio/index.html`, `NinjaCursor` доступен, при synthetic scroll `.nc-wrapper --nc-vis` становится `hidden`, `.nc-caret` сбрасывается в базовый класс.
