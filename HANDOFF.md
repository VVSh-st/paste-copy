# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg, *.txt не сохраняй).

Здесь есть skill "E:\CODE\Paste_copy\Skill" используй при необходимости.


Есть MCP инструменты, используй при необходимости.

Мне отвечай по русски.

## Status — В РАБОТЕ

### Уголёк (ember.js): взвешенное смешение + переделка пасхалки + предупреждение

**Выполнено:**

1. ✅ Взвешенное смешение геометрии: `_geomWeight = 0.35 + 0.65 * (mag / maxMag)` вместо `skipGeometry = true/false` — теперь одновременно видно главное движение + лёгкий отголосок второго эффекта
2. ✅ `mag` добавлен во все geom-эффекты (wiggle, stretch, sleepySag, gust) в tryStart и test extras
3. ✅ Glint позиция: `glintX = 45 + k * 20 + phase * 10` — блик плавно скользит через k (силу эффекта), без телепортации
4. ✅ Частицы пепла: `rise: -20…-10px` (было -36…-20), холодный `rgba(180,170,165)`, `scalePulse` на пике пути
5. ✅ emberDeform: амплитуда ±12-14% (было ±6-7%), `--deformPhase` случайный сдвиг фазы при init
6. ✅ Пасхалка переписана: замах 150мс, полёт 350мс easeIn→easeOut, приземление 200мс, осмотр 1800мс с паузами, «руки в боки» 300мс, залп 18 пепла+8 искр, заглатывание кольцом (`ringExpand: -3px→+3px`)
7. ✅ Предупреждающий импульс: heatBoost 0.5 + 6 spark + ringImpulse при падении до 1-2 сегментов
8. ✅ `Ember.onClick(fn)` — публичный хук для прокидывания колбэка

**Активные файлы:**

- `ember.js` (~2585 строк): weighted geometry, glow/ash/particle fixes, egg rewrite, warning pulse, onClick hook
- `ember-styles.css` (~489 строк): emberDeform ±12-14%, ash rgba(180,170,165), --deformPhase

### Архив предыдущих сессий

**Anchor gutter background highlight bug** — `Blocks.render()` + `Anchors._renderMarkersAll()` race condition
**Переводчик** (`translator.js`) — Google→MS→legacy fallback, 9 языков
**Кнопки перевода** — в блоках, блокноте, мини-чате
**Структура превью** — навигация + подсветка фона
**Якоря** — TreeWalker+Range позиционирование

## Architecture Decisions

- `_geomWeight = 0.35 + 0.65 * (mag / maxMag)` — каждый geom-эффект получает пропорциональный вклад в позу вместо бинарного skipGeometry
- `pose.squash` → инверсная компрессия scaleX/scaleY (volume preservation), border-radius = вторичный органический слой
- `igniteCrackSide`: pool по физическим углам градиентов (лево/право), не по фиксированному индексу
- `--ringPulse` + `--ringExpand` CSS variable для заглатывания кольцом (ringExpand в минус = сжатие к центру)
- Background throttle: skip rAF кадров при неактивном окне (< 250ms между кадрами)
- Hot-reload: `state.lastInitTime` для пропуска birth-анимации при быстрых перезагрузках

## Commits (последняя сессия)

```
4c7da45 feat(ember): real squash-stretch geometry, dominant effect system, egg amplification, ring swallow, background throttle, hot-reload persistence
8b0b1ff Задание v2: баги (tilt, nextDue, typing, egg, clamp, reduceMotion), визуал (flicker, wind hue, heatwave, crust, crumb glow, ash color), setStatus API, click blow + tooltip
d683246 Ember: per-tab state — каждая вкладка хранит свой lastEditTime
1a8e7ac Fix: ember z-index выше textarea, overflow:visible
3b6eea1 Задание: баг dt, пасхалка 9 фаз, горячие точки, ветер, IntersectionObserver, storage fallback
```
