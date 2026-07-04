# Prompt: ember.js + ember-styles.css — GPT audit round 1

Ты — GPT-5, coding agent. Проведи аудит двух файлов: `ember.js` (~3016 строк) и `ember-styles.css` (~607 строк).

**Контекст проекта:**
- IIFE-модуль `Ember`, vanilla JS, без фреймворков
- "Уголёк" — живой визуальный индикатор состояния проекта (38×34px)
- rAF-цикл с физикой: дыхание, деформация, парение, heat zones, crack layers
- Particle system (ash, sparks, crumbs) с object pooling (40 элементов)
- Peek state machine (idle → noticing → peeking → looking → blinking → retracting)
- Easter egg (пасхалка, 9 фаз анимации, 1000+ символов ввода)
- Preview scare animation (испуг при открытии превью)
- Reaction system на действия пользователя (blockCollapse, delete, translate, copy, etc.)
- BroadcastChannel + localStorage sync между вкладками
- IntersectionObserver для visibility
- FPS monitoring + low-fps mode (пропуск кадров при <30fps)
- ~80 CSS custom properties для визуальных параметров
- CSS keyframe animations: emberDeform, hazeDrift, glowFlicker, shimmerPulse, landingFade

## Что искать

### Приоритет 1: Критично
- Memory leaks: event listeners на document/window без cleanup, IntersectionObserver, BroadcastChannel
- rAF loop: не останавливается при уходе со страницы, утечка при destroy()
- DOM: createElement без remove, particle pool растёт бесконечно при нагрузке
- State corruption: BroadcastChannel/lStorage гонки при одновременном обновлении с разных вкладок

### Приоритет 2: Производительность
- rAF callback:过多 calculations per frame (80+ style.setProperty calls)
- Particle system: splice() в цикле, linear search в releaseEl/acquireEl
- CSS: will-change на всех particle elements, backdrop-filter в shimmerPulse
- reduceMotion: пропуск кадров через счётчик вместо паузы rAF

### Приоритет 3: UX
- Tooltip: setTimeout без проверки destroyed state
- Easter egg: triggeredToday хранится в localStorage, сбрасывается при переполнении
- Test mode: ПКМ тестирование не отключается автоматически

### Приоритет 4: Читаемость
- 90+ переменных уровня модуля
- update() — функция 380+ строк с вложенными switch/case
- Дублирование логики дыхания в egg.active и normal ветках

## Формат вывода

Для каждого предложенного исправления:
- Номер, тип (Критично/Перф/UX/Чит), краткое описание
- Строки (номера или ~номера)
- Влияние (1-2 предложения)
- Патч (diff)

Не предлагай косметические правки. Сосредоточься на проблемах, которые реально влияют на stability, performance или memory.
